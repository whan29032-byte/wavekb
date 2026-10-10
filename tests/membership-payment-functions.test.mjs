import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const buyer = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const priceId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const webhookSecret = "whsec_membership_synthetic_test";
const environment = { SITE_ORIGIN: "https://membership-test.invalid", SUPABASE_URL: "https://database-test.invalid", SUPABASE_ANON_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", MEMBERSHIP_BILLING_ENABLED: "true", MEMBERSHIP_PAYMENT_MODE: "test", MEMBERSHIP_STRIPE_SECRET_KEY: "sk_test_synthetic", MEMBERSHIP_STRIPE_WEBHOOK_SECRET: webhookSecret };
const quote = { price_id: priceId, plan_key: "vip", price_revision: 1, plan_revision: 2, amount_minor: 5200, currency: "USD", term_months: 1 };
const order = { id: orderId, buyer_id: buyer, request_id: requestId, price_id: priceId, plan_key: "vip", amount_minor: 5200, currency: "USD", term_months: 1, title_snapshot: "VIP 会员", status: "pending", payment_mode: "test", livemode: false, provider_session_id: null, created_at: new Date().toISOString() };
const session = { id: "cs_test_membership", mode: "payment", livemode: false, status: "open", payment_status: "unpaid", client_reference_id: orderId, metadata: { domain: "membership", order_id: orderId, buyer_id: buyer }, amount_total: 5200, currency: "usd", expires_at: Math.floor(Date.now() / 1000) + 86400, url: "https://checkout.stripe.com/c/pay/synthetic-membership" };

async function load(name, fetcher, env = {}) {
  let handler;
  const calls = [];
  const source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
  vm.runInNewContext(stripTypeScriptTypes(source), { Deno: { env: { get: key => ({ ...environment, ...env })[key] }, serve: value => { handler = value; } },
    Response, URL, URLSearchParams, Date, TextEncoder, Uint8Array, AbortSignal, crypto: webcrypto,
    fetch: async (url, options = {}) => { calls.push({ url, options }); return fetcher(url, options); },
  });
  return { handler, calls };
}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function checkout(overrides = {}) {
  let registered;
  const result = await load("membership-checkout", async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return response({ id: buyer, email_confirmed_at: "2026-10-10T00:00:00Z", ...overrides.user });
    if (url.endsWith("/rpc/prepare_membership_order")) return response(overrides.prepareError ? { message: overrides.prepareError } : { ...order, ...overrides.order }, overrides.prepareError ? 400 : 200);
    if (url.includes("https://api.stripe.com/")) return response({ ...session, ...overrides.session });
    if (url.endsWith("/rpc/register_membership_checkout_session")) {
      registered = JSON.parse(options.body);
      if (overrides.registerError) return response({ message: overrides.registerError }, 500);
      return response({ ...order, provider_session_id: session.id, checkout_url: session.url, ...overrides.receipt });
    }
    throw new Error(`unexpected URL ${url}`);
  }, overrides.env);
  return { ...result, registered: () => registered, request: (extra = {}) => new Request("https://membership-test.invalid", { method: "POST", headers: { authorization: "Bearer synthetic-owner" }, body: JSON.stringify({ actorId: buyer, priceId, requestId, expectedQuote: quote, ...extra }) }) };
}

test("membership checkout freezes SQL quote, uses one-time mode and binds an independent hosted session", async () => {
  const { handler, calls, request, registered } = await checkout();
  assert.deepEqual(await (await handler(request({ successUrl: "https://attacker.invalid/", amount: 1 }))).json(), { orderId, checkoutUrl: session.url });
  const creation = calls.find(call => call.url === "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(creation.options.body.get("mode"), "payment");
  assert.equal(creation.options.body.get("line_items[0][price_data][unit_amount]"), "5200");
  assert.equal(creation.options.body.get("metadata[domain]"), "membership");
  assert.equal(creation.options.body.get("payment_intent_data[metadata][buyer_id]"), buyer);
  assert.equal(creation.options.body.get("success_url"), `https://membership-test.invalid/membership?payment=return&order=${orderId}`);
  assert.equal(creation.options.headers["idempotency-key"], `wavekb-membership-${orderId}`);
  assert.deepEqual(registered(), { p_actor_id: buyer, p_order_id: orderId, p_session_id: session.id, p_checkout_url: session.url, p_expires_at: new Date(session.expires_at * 1000).toISOString(), p_livemode: false });
  assert.ok(calls.every(call => !call.url.includes("mentor_") && call.options.method !== "PATCH"));
});
test("unconfigured billing and test/live key mismatches cannot reach SQL or charge provider", async () => {
  for (const env of [{ MEMBERSHIP_BILLING_ENABLED: "false" }, { MEMBERSHIP_STRIPE_SECRET_KEY: "sk_live_synthetic" }, { MEMBERSHIP_PAYMENT_MODE: "invalid" }]) {
    const fixture = await checkout({ env });
    assert.equal((await fixture.handler(fixture.request())).status, 503);
    assert.equal(fixture.calls.length, 0);
  }
});
test("checkout validates current authenticated owner and confirmed email before order preparation", async () => {
  for (const [user, status] of [[{ id: other }, 401], [{ email_confirmed_at: null }, 403]]) {
    const fixture = await checkout({ user });
    assert.equal((await fixture.handler(fixture.request())).status, status);
    assert.equal(fixture.calls.length, 1);
  }
});
test("malformed membership requests never enter order preparation", async () => {
  const fixture = await checkout();
  assert.equal((await fixture.handler(fixture.request({ actorId: "not-a-uid" }))).status, 400);
  assert.equal((await fixture.handler(fixture.request({ expectedQuote: [] }))).status, 400);
  assert.equal(fixture.calls.length, 0);
});
test("order state, ownership and mode mismatches reject before calling Stripe", async () => {
  for (const [overrides, expected] of [[{ status: "paid" }, 409], [{ buyer_id: other }, 503], [{ price_id: other }, 503], [{ request_id: other }, 503], [{ livemode: true }, 503], [{ amount_minor: -1 }, 503]]) {
    const fixture = await checkout({ order: overrides });
    assert.equal((await fixture.handler(fixture.request())).status, expected);
    assert.equal(fixture.calls.some(call => call.url.includes("api.stripe.com")), false);
  }
});
test("changed quotes and other pending purchases remain explicit conflicts without diagnostics", async () => {
  for (const code of ["membership_quote_changed", "membership_pending_order_exists", "membership_billing_unavailable", "membership_plan_disabled", "membership_price_unavailable"]) {
    const fixture = await checkout({ prepareError: code });
    assert.deepEqual(await (await fixture.handler(fixture.request())).json(), { error: code });
  }
  const fixture = await checkout({ prepareError: "private details including request_conflict and synthetic-secret" });
  assert.deepEqual(await (await fixture.handler(fixture.request())).json(), { error: "membership_checkout_unavailable" });
});
test("session metadata, amount, one-time mode, live flag and provider URL must match frozen terms", async () => {
  for (const bad of [{ metadata: { domain: "mentor", order_id: orderId, buyer_id: buyer } }, { amount_total: 1 }, { mode: "subscription" }, { livemode: true }, { url: "https://attacker.invalid/" }]) {
    const fixture = await checkout({ session: bad });
    assert.equal((await fixture.handler(fixture.request())).status, 503);
    assert.equal(fixture.registered(), undefined);
  }
});
test("a registered session is retrieved and reused, never creating a replacement", async () => {
  const fixture = await checkout({ order: { provider_session_id: session.id } });
  assert.equal((await fixture.handler(fixture.request())).status, 200);
  assert.equal(fixture.calls.some(call => call.url === "https://api.stripe.com/v1/checkout/sessions"), false);
  assert.ok(fixture.calls.some(call => call.url.endsWith(`/checkout/sessions/${session.id}`)));
});
test("a complete session awaits verified payment instead of being granted or charged again", async () => {
  const fixture = await checkout({ order: { provider_session_id: session.id }, session: { status: "complete", payment_status: "paid" } });
  assert.equal((await fixture.handler(fixture.request())).status, 409);
  assert.equal(fixture.registered(), undefined);
});
test("unknown session-binding acknowledgements preserve stable original idempotency and expiry", async () => {
  const fixture = await checkout({ registerError: "private database diagnostic" });
  for (let attempt = 0; attempt < 2; ++attempt) assert.equal((await fixture.handler(fixture.request())).status, 503);
  const creates = fixture.calls.filter(call => call.url === "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(creates.length, 2);
  assert.equal(creates[0].options.body.toString(), creates[1].options.body.toString());
  assert.equal(creates[0].options.headers["idempotency-key"], creates[1].options.headers["idempotency-key"]);
  assert.ok(fixture.calls.every(call => !/cancel|revoke|grant/.test(call.url)));
});
test("a webhook winning the checkout acknowledgement race stays a pending-confirmation conflict", async () => {
  const fixture = await checkout({ receipt: { status: "paid" } });
  assert.equal((await fixture.handler(fixture.request())).status, 409);
  assert.deepEqual(await (await fixture.handler(fixture.request())).json(), { error: "membership_payment_confirmation_pending" });
  const stale = await checkout({ registerError: "order_not_payable" });
  assert.deepEqual(await (await stale.handler(stale.request())).json(), { error: "membership_order_not_payable" });
});

const paidSession = { ...session, status: "complete", payment_status: "paid", payment_intent: "pi_test_membership" };
const refund = { id: "re_test_membership", payment_intent: paidSession.payment_intent, amount: 5200, currency: "usd", status: "succeeded" };
function signedEvent(object = paidSession, type = "checkout.session.completed", extra = {}, signedAt = Math.floor(Date.now() / 1000)) {
  const timestamp = String(signedAt);
  const event = { id: "evt_test_membership", type, created: Number(timestamp), livemode: false, data: { object }, ...extra };
  const body = JSON.stringify(event), signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://membership-test.invalid", { method: "POST", body, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } });
}
async function webhook(overrides = {}) {
  return load("membership-payment-webhook", async (url, options) => {
    if (url.includes("/rpc/get_membership_payment_route")) return response({ id: orderId, buyer_id: buyer, provider_session_id: session.id, payment_intent_id: paidSession.payment_intent, livemode: false, amount_minor: 5200, currency: "USD", ...overrides.route });
    if (url.includes("/rpc/apply_verified_")) return overrides.error ? response({ message: overrides.error }, 400) : response({ duplicate: false, applied: true });
    if (url.includes("/checkout/sessions/")) return response({ ...paidSession, ...overrides.session });
    if (url.includes("/refunds/")) return response({ ...refund, ...overrides.refund });
    if (url.includes("/payment_intents/")) return response({ id: paidSession.payment_intent, livemode: false, currency: "usd", metadata: paidSession.metadata, ...overrides.intent });
    throw new Error(`unexpected URL ${url}`);
  }, overrides.env);
}
test("signed paid membership events verify canonical provider records then atomically apply only membership rights", async () => {
  const fixture = await webhook();
  assert.deepEqual(await (await fixture.handler(signedEvent())).json(), { received: true, duplicate: false, applied: true });
  const call = fixture.calls.find(call => call.url.includes("/rpc/"));
  const body = JSON.parse(call.options.body);
  assert.equal(body.p_buyer_id, buyer);
  assert.equal(body.p_amount_minor, 5200);
  assert.equal(body.p_payment_status, "paid");
  assert.equal(body.p_payment_intent_id, paidSession.payment_intent);
  assert.ok(call.url.endsWith("apply_verified_membership_payment_event"));
  assert.ok(fixture.calls.every(call => call.options.method !== "PATCH" && !call.url.includes("mentor_")));
});
test("completed-unpaid signed payload stays unpaid even after canonical provider state advances", async () => {
  const fixture = await webhook();
  assert.equal((await fixture.handler(signedEvent({ ...paidSession, payment_status: "unpaid", payment_intent: null }))).status, 200);
  const body = JSON.parse(fixture.calls.find(call => call.url.includes("/rpc/")).options.body);
  assert.equal(body.p_payment_status, "unpaid");
  assert.equal(body.p_payment_intent_id, null);
});
test("expired membership sessions preserve unpaid terminal events", async () => {
  const expired = { ...session, status: "expired", payment_intent: null };
  const fixture = await webhook({ session: expired });
  assert.equal((await fixture.handler(signedEvent(expired, "checkout.session.expired"))).status, 200);
  assert.equal(JSON.parse(fixture.calls.find(call => call.url.includes("/rpc/")).options.body).p_payment_intent_id, null);
});
test("a verified delayed payment failure closes a complete-unpaid session without granting rights", async () => {
  const failed = { ...paidSession, payment_status: "unpaid" };
  const fixture = await webhook({ session: failed, intent: { amount: 5200, status: "requires_payment_method" } });
  assert.equal((await fixture.handler(signedEvent(failed, "checkout.session.async_payment_failed"))).status, 200);
  const body = JSON.parse(fixture.calls.find(call => call.url.endsWith("apply_verified_membership_payment_event")).options.body);
  assert.equal(body.p_event_type, "checkout.session.async_payment_failed");
  assert.equal(body.p_payment_status, "unpaid");
});
test("pending processing, mismatched or successful intents cannot be falsely declared payment failures", async () => {
  const failed = { ...paidSession, payment_status: "unpaid" };
  for (const intent of [{ amount: 5200, status: "processing" }, { amount: 5200, status: "succeeded" }, { amount: 1, status: "requires_payment_method" }, { amount: 5200, status: "canceled", metadata: { ...paidSession.metadata, buyer_id: other } }]) {
    const fixture = await webhook({ session: failed, intent });
    assert.equal((await fixture.handler(signedEvent(failed, "checkout.session.async_payment_failed"))).status, 400);
    assert.equal(fixture.calls.some(call => call.url.endsWith("apply_verified_membership_payment_event")), false);
  }
});
test("webhook continues reconciling paid events when new billing has been disabled", async () => {
  const fixture = await webhook({ env: { MEMBERSHIP_BILLING_ENABLED: "false" } });
  assert.equal((await fixture.handler(signedEvent())).status, 200);
});
test("bad signature, duplicate timestamps, expired timestamps and mode mismatch cannot change the ledger", async () => {
  const fixture = await webhook();
  const bad = signedEvent(); bad.headers.set("stripe-signature", "t=1,v1=incorrect");
  assert.equal((await fixture.handler(bad)).status, 400);
  const duplicate = signedEvent(); duplicate.headers.append("stripe-signature", `t=${Math.floor(Date.now() / 1000)}`);
  assert.equal((await fixture.handler(duplicate)).status, 400);
  assert.equal((await fixture.handler(signedEvent(paidSession, "checkout.session.completed", {}, Math.floor(Date.now() / 1000) - 601))).status, 400);
  assert.equal((await fixture.handler(signedEvent(paidSession, "checkout.session.completed", { livemode: true }))).status, 409);
  assert.equal(fixture.calls.length, 0);
});
test("mentor domains and unsupported events cannot create website VIP membership", async () => {
  const fixture = await webhook();
  assert.equal((await fixture.handler(signedEvent({ ...paidSession, metadata: { ...paidSession.metadata, domain: "mentor" } }))).status, 200);
  assert.equal((await fixture.handler(signedEvent(paidSession, "customer.created"))).status, 200);
  assert.equal(fixture.calls.length, 0);
});
test("signed membership events still require canonical ownership, amounts, route and paid intent", async () => {
  for (const bad of [{ amount_total: 1 }, { metadata: { ...paidSession.metadata, buyer_id: other } }, { payment_intent: "pi_other" }, { payment_status: "unpaid" }]) {
    const fixture = await webhook({ session: bad });
    assert.equal((await fixture.handler(signedEvent())).status, 400);
    assert.equal(fixture.calls.some(call => call.url.includes("/rpc/")), false);
  }
});
test("refund reconciles the original registered session before revoking only its purchased period", async () => {
  const fixture = await webhook();
  assert.equal((await fixture.handler(signedEvent(refund, "refund.updated"))).status, 200);
  const call = fixture.calls.find(call => call.url.endsWith("apply_verified_membership_refund_event"));
  assert.equal(JSON.parse(call.options.body).p_refund_status, "succeeded");
  assert.ok(fixture.calls.some(call => call.url.endsWith("get_membership_payment_route")));
  assert.ok(fixture.calls.some(call => call.url.endsWith(`/checkout/sessions/${session.id}`)));
});
test("old pending refund events preserve their signed idempotency payload after provider completion", async () => {
  const fixture = await webhook();
  assert.equal((await fixture.handler(signedEvent({ ...refund, status: "pending" }, "refund.created"))).status, 200);
  const call = fixture.calls.find(call => call.url.endsWith("apply_verified_membership_refund_event"));
  assert.equal(JSON.parse(call.options.body).p_refund_status, "pending");
});
test("refunds cannot claim another owner's session or an unrelated payment intent", async () => {
  for (const overrides of [{ route: { buyer_id: other } }, { route: { provider_session_id: "wrong" } }, { session: { payment_intent: "pi_other" } }]) {
    const fixture = await webhook(overrides);
    assert.equal((await fixture.handler(signedEvent(refund, "refund.updated"))).status, 400);
    assert.equal(fixture.calls.some(call => call.url.endsWith("apply_verified_membership_refund_event")), false);
  }
});
test("conflicts are explicit but private provider/database messages cannot leak", async () => {
  for (const [code, publicCode] of [["payment_event_conflict", "membership_payment_event_conflict"], ["payment_amount_mismatch", "membership_payment_amount_mismatch"], ["order_payment_route_invalid", "membership_payment_route_invalid"], ["payment_mode_mismatch", "membership_payment_mode_mismatch"], ["order_not_found", "membership_order_not_found"]]) {
    const conflict = await webhook({ error: code });
    const result = await conflict.handler(signedEvent());
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { error: publicCode });
  }
  const privateError = await webhook({ error: "private diagnostic containing request_conflict and secret" });
  assert.deepEqual(await (await privateError.handler(signedEvent())).json(), { error: "membership_payment_processing_failed" });
});
