import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const buyer = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";

async function checkout(overrides = {}) {
  const calls = [];
  let handler;
  const source = await readFile(new URL("../supabase/functions/mentor-checkout/index.ts", import.meta.url), "utf8");
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Deno: { env: { get: (name) => ({ SITE_ORIGIN: "https://site-test.invalid", SUPABASE_URL: "https://database-test.invalid", SUPABASE_ANON_KEY: "local-test-public", SUPABASE_SERVICE_ROLE_KEY: "local-test-service", STRIPE_SECRET_KEY: "local-test-stripe" })[name] }, serve: (value) => { handler = value; } },
    Response, URL, URLSearchParams, Date,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      let payload;
      if (url.includes("/auth/v1/user")) payload = { id: buyer, email_confirmed_at: "2026-10-10T00:00:00Z", ...overrides.user };
      else if (url.includes("/rest/v1/profiles?")) payload = [{ account_status: "active", public_uid: 11111, ...overrides.profile }];
      else if (url.includes("/rest/v1/mentor_orders?")) payload = [{ id: orderId, buyer_id: buyer, offer_id: "offer-test", amount_cents: 10000, currency: "USD", status: "pending", payment_provider: null, payment_method_id: null, ...overrides.order }];
      else if (url.includes("/rest/v1/mentor_offers?")) payload = [{ name: "Test-only offer" }];
      else if (url.includes("api.stripe.com")) payload = { id: "cs_test_checkout", url: "https://stripe-test.invalid/checkout" };
      else if (url.includes("/rpc/register_mentor_checkout_session")) payload = null;
      else throw new Error(`Unexpected mocked URL: ${url}`);
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const request = () => new Request("https://site-test.invalid", { method: "POST", body: JSON.stringify({ orderId, successUrl: "https://untrusted-test.invalid/redirect" }), headers: { authorization: "Bearer local-test-user" } });
  return { handler, calls, request };
}

test("hosted checkout keeps buyer authentication, one-time mode and safe return URLs, then binds its session by RPC", async () => {
  const { handler, calls, request } = await checkout();
  assert.equal((await handler(request())).status, 200);
  const stripe = calls.find((call) => call.url.includes("api.stripe.com"));
  assert.equal(stripe.options.body.get("mode"), "payment");
  assert.equal(stripe.options.body.get("success_url"), "https://site-test.invalid/#mentors=success");
  const registration = calls.find((call) => call.url.includes("register_mentor_checkout_session"));
  assert.deepEqual(JSON.parse(registration.options.body), { p_actor: buyer, p_order_id: orderId, p_provider_order_id: "cs_test_checkout" });
  assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
});

test("banned and unconfirmed buyers are rejected before any provider checkout call", async () => {
  for (const override of [{ profile: { account_status: "banned" } }, { user: { email_confirmed_at: null } }]) {
    const { handler, calls, request } = await checkout(override);
    assert.equal((await handler(request())).status, 403);
    assert.equal(calls.some((call) => call.url.includes("api.stripe.com")), false);
  }
});

test("checkout rejects another buyer's order and cannot convert a manual purchase to Stripe", async () => {
  for (const [override, status] of [[{ order: { buyer_id: "other-buyer" } }, 404], [{ order: { payment_provider: "manual", payment_method_id: "method-test" } }, 409]]) {
    const { handler, calls, request } = await checkout(override);
    assert.equal((await handler(request())).status, status);
    assert.equal(calls.some((call) => call.url.includes("api.stripe.com")), false);
  }
});
