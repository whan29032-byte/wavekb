import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { WALLET_ROUTES } from "../ai-gateway/src/membership-wallet/contracts.ts";

const buyer = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333", priceId = "44444444-4444-4444-8444-444444444444", requestId = "55555555-5555-4555-8555-555555555555";
const environment = { SITE_ORIGIN: "https://membership-test.invalid", SUPABASE_URL: "https://database-test.invalid", SUPABASE_ANON_KEY: "synthetic-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", MEMBERSHIP_WALLET_ENABLED: "true" };
const routes = {
  "tron-usdt": { chain: "tron", asset: "USDT", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", recipient: "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL" },
  "ethereum-usdt": { chain: "ethereum", asset: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", recipient: `0x${"1".repeat(40)}` },
  "ethereum-usdc": { chain: "ethereum", asset: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", recipient: `0x${"1".repeat(40)}` },
  "base-usdc": { chain: "base", asset: "USDC", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", recipient: `0x${"1".repeat(40)}` },
};
const quote = { price_id: priceId, plan_key: "vip", price_revision: 1, plan_revision: 2, amount_minor: 5200, currency: "USD", term_months: 1, route_revision: 3 };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
test("SQL, browser, Edge and worker share the same exact four mainnet route identities", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202610100005_membership_wallet_payments.sql", import.meta.url), "utf8");
  const browser = await readFile(new URL("../apps/web/src/lib/membership/wallet-types.ts", import.meta.url), "utf8");
  const edge = await readFile(new URL("../supabase/functions/membership-wallet-checkout/index.ts", import.meta.url), "utf8");
  const definitions = source => Object.fromEntries(Array.from(source.matchAll(/"([a-z]+-(?:usdt|usdc))":\s*\{\s*chain:\s*"([a-z]+)",\s*asset:\s*"(USDT|USDC)",\s*contract:\s*"([^"]+)"/g), match => [match[1], { chain: match[2], asset: match[3], contract: match[4] }]));
  const seeds = Object.fromEntries(Array.from(sql.matchAll(/\('([a-z]+-(?:usdt|usdc))','([a-z]+)','(USDT|USDC)','([^']+)'\)/g), match => [match[1], { chain: match[2], asset: match[3], contract: match[4] }]));
  const worker = Object.fromEntries(Object.entries(WALLET_ROUTES).map(([id, { chain, asset, contract }]) => [id, { chain, asset, contract }]));
  assert.equal(Object.keys(seeds).length, 4);
  assert.deepEqual(definitions(browser), seeds); assert.deepEqual(definitions(edge), seeds); assert.deepEqual(worker, seeds);
  assert.deepEqual(Object.keys(worker), ["tron-usdt", "ethereum-usdt", "ethereum-usdc", "base-usdc"]);
});
function order(routeId = "ethereum-usdt") {
  return { id: orderId, buyer_id: buyer, request_id: requestId, price_id: priceId, plan_key: "vip", price_revision: 1, plan_revision: 2,
    route_id: routeId, route_revision: 3, ...routes[routeId], term_months: 1, title_snapshot: "VIP", description_snapshot: "测试冻结报价",
    benefits_snapshot: ["专属内容"], ai_daily_limit_snapshot: 50, mentor_discount_bps_snapshot: 1000,
    amount_units: "52000123", base_amount_units: "52000000", amount_decimal: "52.000123", status: "pending", paid_at: null,
    created_at: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() };
}
async function fixture(overrides = {}) {
  let handler;
  const calls = [], stableOrder = { ...order(overrides.routeId), ...overrides.order };
  const source = await readFile(new URL("../supabase/functions/membership-wallet-checkout/index.ts", import.meta.url), "utf8");
  vm.runInNewContext(stripTypeScriptTypes(source), { Deno: { env: { get: name => ({ ...environment, ...overrides.env })[name] }, serve: value => { handler = value; } },
    Response, URL, Date, Uint8Array, AbortSignal, crypto: webcrypto, fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/auth/v1/user")) return response({ id: buyer, email_confirmed_at: "2026-10-10T00:00:00Z", ...overrides.user }, overrides.authStatus || 200);
      if (url.endsWith("/rpc/prepare_membership_wallet_order")) {
        if (overrides.rpcThrow) throw new Error("private database key and endpoint diagnostic");
        return overrides.rpcError ? response({ message: overrides.rpcError }, 400) : response(stableOrder);
      }
      throw new Error(`unexpected payment operation ${url}`);
    } });
  return { handler, calls, stableOrder, request: (extra = {}, headers = {}) => new Request("https://membership-test.invalid", { method: "POST", headers: { authorization: "Bearer synthetic-owner", ...headers },
    body: JSON.stringify({ actorId: buyer, priceId, requestId, routeId: overrides.routeId || "ethereum-usdt", expectedQuote: quote, ...extra }) }) };
}
for (const routeId of Object.keys(routes)) {
  test(`wallet invoice ${routeId} uses authenticated owner and frozen SQL quote with no transaction or Stripe call`, async () => {
    const value = await fixture({ routeId });
    const result = await value.handler(value.request({ recipient: "attacker", amount: "1", verified: true, txHash: "public-claim", finalized: true }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { order: value.stableOrder });
    assert.deepEqual(JSON.parse(value.calls[1].options.body), { p_actor_id: buyer, p_price_id: priceId, p_route_id: routeId, p_request_id: requestId, p_expected_quote: quote });
    assert.equal(value.calls[0].options.headers.authorization, "Bearer synthetic-owner");
    assert.equal(value.calls[1].options.headers.authorization, "Bearer synthetic-service");
    assert.ok(value.calls.every(call => call.url.startsWith(environment.SUPABASE_URL) && !/stripe|grant|refund|transfer|broadcast/.test(call.url)));
  });
}
test("wallet defaults disabled and missing service configuration never creates an invoice", async () => {
  for (const env of [{ MEMBERSHIP_WALLET_ENABLED: undefined }, { MEMBERSHIP_WALLET_ENABLED: "false" }, { MEMBERSHIP_WALLET_ENABLED: "TRUE" },
    { SUPABASE_SERVICE_ROLE_KEY: undefined }, { SUPABASE_URL: "http://database-test.invalid" }]) {
    const value = await fixture({ env });
    assert.equal((await value.handler(value.request())).status, 503);
    assert.equal(value.calls.length, 0);
  }
});
test("missing real recipient or SQL enable gate is an explicit unavailable conflict, not an invoice", async () => {
  const disabled = await fixture({ rpcError: "membership_wallet_unavailable" });
  assert.deepEqual(await (await disabled.handler(disabled.request())).json(), { error: "membership_wallet_unavailable" });
  const missing = await fixture({ order: { recipient: null } });
  assert.equal((await missing.handler(missing.request())).status, 503);
});
test("cross-user actor and unconfirmed email cannot prepare invoices", async () => {
  for (const [user, status] of [[{ id: other }, 401], [{ email_confirmed_at: null }, 403]]) {
    const value = await fixture({ user });
    assert.equal((await value.handler(value.request())).status, status);
    assert.equal(value.calls.length, 1);
  }
  const value = await fixture();
  assert.equal((await value.handler(value.request({}, { authorization: "" }))).status, 401);
  assert.equal(value.calls.length, 0);
});
test("invalid or expired bearer and authentication outages remain distinct", async () => {
  for (const [authStatus, expected] of [[401, 401], [403, 401], [503, 503]]) {
    const value = await fixture({ authStatus });
    assert.equal((await value.handler(value.request())).status, expected);
    assert.equal(value.calls.length, 1);
  }
});
test("only exact eight-key USD frozen quote and four supported routes can prepare", async () => {
  for (const input of [{ routeId: "tron-usdc" }, { routeId: "base-usdt" }, { routeId: "__proto__" }, { actorId: "not-a-user" }, { expectedQuote: [] },
    { expectedQuote: { ...quote, route_revision: 0 } }, { expectedQuote: { ...quote, route_id: "ethereum-usdt" } }, { expectedQuote: { ...quote, currency: "USDT" } },
    { expectedQuote: { ...quote, amount_minor: "5200" } }, { expectedQuote: { ...quote, term_months: "1" } }, { expectedQuote: { ...quote, price_id: other } }]) {
    const value = await fixture(); assert.equal((await value.handler(value.request(input))).status, 400); assert.equal(value.calls.length, 0);
  }
});
test("known SQL conflicts return safe exact codes without changing existing orders", async () => {
  for (const code of ["membership_wallet_unavailable", "membership_wallet_quote_changed", "membership_price_unavailable", "membership_plan_disabled",
    "membership_pending_order_exists", "request_conflict", "membership_wallet_amount_pool_exhausted"]) {
    const value = await fixture({ rpcError: code }), result = await value.handler(value.request());
    assert.equal(result.status, 409); assert.deepEqual(await result.json(), { error: code });
  }
  const diagnostic = await fixture({ rpcError: "private diagnostic containing request_conflict and service-key" });
  assert.deepEqual(await (await diagnostic.handler(diagnostic.request())).json(), { error: "wallet_checkout_unavailable" });
});
test("returned SQL invoice must match owner, request, price, route, issuer, exact units and frozen revisions", async () => {
  for (const override of [{ buyer_id: other }, { request_id: other }, { price_id: other }, { route_id: "base-usdc" }, { chain: "base" }, { asset: "USDC" },
    { contract: `0x${"f".repeat(40)}` }, { recipient: `0x${"0".repeat(40)}` }, { amount_units: "52000000" }, { amount_units: "52010000" },
    { amount_decimal: "52" }, { base_amount_units: "1000000" }, { route_revision: 4 }, { term_months: 12 }, { status: "enabled" }, { expires_at: "bad" }]) {
    const value = await fixture({ order: override }); assert.equal((await value.handler(value.request())).status, 503);
  }
});
test("TRON recipient Base58 checksum is validated instead of a superficial address regex", async () => {
  const value = await fixture({ routeId: "tron-usdt", order: { recipient: "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeM" } });
  assert.equal((await value.handler(value.request())).status, 503);
});
test("original terminal and expired invoices are returned without replacement or another charge", async () => {
  for (const status of ["expired", "paid", "review", "revoked"]) {
    const value = await fixture({ order: { status } });
    const result = await value.handler(value.request()); assert.equal(result.status, 200); assert.deepEqual(await result.json(), { order: value.stableOrder });
    assert.equal(value.calls.length, 2);
  }
});
test("unknown preparation acknowledgement preserves identical request and never cancels or replaces", async () => {
  const value = await fixture({ rpcThrow: true });
  for (let attempt = 0; attempt < 2; ++attempt) assert.deepEqual(await (await value.handler(value.request())).json(), { error: "wallet_checkout_unavailable" });
  const prepares = value.calls.filter(call => call.url.includes("prepare_membership_wallet_order"));
  assert.equal(prepares.length, 2); assert.equal(prepares[0].options.body, prepares[1].options.body);
  assert.ok(value.calls.every(call => !/cancel|revoke|grant|refund|settle/.test(call.url)));
});
test("preflight and unsupported methods have no authenticated side effects", async () => {
  const value = await fixture();
  assert.equal((await value.handler(new Request("https://membership-test.invalid", { method: "OPTIONS" }))).status, 200);
  assert.equal((await value.handler(new Request("https://membership-test.invalid"))).status, 405);
  assert.equal(value.calls.length, 0);
});
