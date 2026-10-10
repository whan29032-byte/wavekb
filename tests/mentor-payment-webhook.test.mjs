import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const orderId = "11111111-1111-4111-8111-111111111111";
const secret = "whsec_synthetic_local_test";

async function webhook(mock) {
  let handler;
  const calls = [];
  const source = await readFile(new URL("../supabase/functions/mentor-payment-webhook/index.ts", import.meta.url), "utf8");
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Deno: { env: { get: (name) => ({ STRIPE_WEBHOOK_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-service", SUPABASE_URL: "https://local-test.invalid" })[name] }, serve: (value) => { handler = value; } },
    crypto: webcrypto, TextEncoder, Response, Date,
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, payload: JSON.parse(options.body) });
      return mock ? mock(url, options) : new Response(JSON.stringify({ duplicate: false, applied: true }), { status: 200 });
    },
  });
  return { calls, handler };
}

function signedRequest(overrides = {}, timestamp = String(Math.floor(Date.now() / 1000))) {
  const body = JSON.stringify({ id: "evt_test_signed", type: "checkout.session.completed", data: { object: {
    id: "cs_test_signed", metadata: { order_id: orderId }, amount_total: 10000, currency: "usdt", payment_status: "paid", ...overrides,
  } } });
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://local-test.invalid", { method: "POST", body, headers: { "stripe-signature": `t=${timestamp},v1=${digest}` } });
}

test("verified paid events make one transactional service RPC and never patch a table", async () => {
  const { handler, calls } = await webhook();
  const result = await handler(signedRequest());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { received: true, duplicate: false, applied: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://local-test.invalid/rest/v1/rpc/apply_verified_mentor_payment_event");
  assert.deepEqual(calls[0].payload, { p_event_id: "evt_test_signed", p_event_type: "checkout.session.completed", p_order_id: orderId, p_provider_order_id: "cs_test_signed", p_amount_cents: 10000, p_currency: "usdt", p_payment_status: "paid" });
});

test("unpaid payment_status reaches the atomic ledger without being relabelled paid", async () => {
  const { handler, calls } = await webhook(() => new Response(JSON.stringify({ duplicate: false, applied: false }), { status: 200 }));
  assert.deepEqual(await (await handler(signedRequest({ payment_status: "unpaid" }))).json(), { received: true, duplicate: false, applied: false });
  assert.equal(calls[0].payload.p_payment_status, "unpaid");
});

test("bad signatures and expired or nonnumeric signed timestamps never reach the database", async () => {
  const { handler, calls } = await webhook();
  const request = signedRequest();
  request.headers.set("stripe-signature", `t=${Math.floor(Date.now() / 1000)},v1=incorrect`);
  assert.equal((await handler(request)).status, 400);
  assert.equal((await handler(signedRequest({}, String(Math.floor(Date.now() / 1000) - 600)))).status, 400);
  assert.equal((await handler(signedRequest({}, "invalid"))).status, 400);
  assert.equal(calls.length, 0);
});

test("malformed session and amounts fail closed before database access", async () => {
  const { handler, calls } = await webhook();
  assert.equal((await handler(signedRequest({ id: "wrong" }))).status, 400);
  assert.equal((await handler(signedRequest({ amount_total: "10000" }))).status, 409);
  assert.equal((await handler(signedRequest({ amount_total: -1 }))).status, 409);
  assert.equal(calls.length, 0);
});

test("route and amount conflicts preserve conflict status without exposing database detail", async () => {
  const mismatch = await webhook(() => new Response(JSON.stringify({ message: "payment_amount_mismatch" }), { status: 400 }));
  assert.equal((await mismatch.handler(signedRequest())).status, 409);
  const failed = await webhook(() => new Response(JSON.stringify({ message: "private database diagnostic" }), { status: 500 }));
  const response = await failed.handler(signedRequest());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "payment_processing_failed" });
});
