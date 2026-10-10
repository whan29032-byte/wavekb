// Create/recover an invoice only. This endpoint never signs or submits a chain
// transaction, trusts a payment claim, calls Stripe, or grants membership.
const cors = {
  "access-control-allow-origin": Deno.env.get("SITE_ORIGIN") || "https://wavekb.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const routes: Record<string, { chain: string; asset: string; contract: string }> = {
  "tron-usdt": { chain: "tron", asset: "USDT", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
  "ethereum-usdt": { chain: "ethereum", asset: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  "ethereum-usdc": { chain: "ethereum", asset: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  "base-usdc": { chain: "base", asset: "USDC", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...cors, "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } }); }
function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error("wallet_checkout_unavailable"); return value; }
function serverConfig() {
  const url = new URL(env("SUPABASE_URL"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("wallet_checkout_unavailable");
  return { origin: url.origin, anon: env("SUPABASE_ANON_KEY"), service: env("SUPABASE_SERVICE_ROLE_KEY") };
}
function validQuote(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const quote = value as Record<string, unknown>;
  return Object.keys(quote).sort().join(",") === "amount_minor,currency,plan_key,plan_revision,price_id,price_revision,route_revision,term_months"
    && uuid(quote.price_id) && typeof quote.plan_key === "string" && /^[a-z][a-z0-9_-]{1,47}$/.test(quote.plan_key)
    && integer(quote.price_revision) && integer(quote.plan_revision) && integer(quote.route_revision)
    && integer(quote.amount_minor) && Number(quote.amount_minor) <= 100000000 && quote.currency === "USD" && (quote.term_months === 1 || quote.term_months === 12);
}
async function validTronAddress(value: unknown): Promise<boolean> {
  if (typeof value !== "string" || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const hex = number.toString(16).padStart(50, "0");
  if (hex.length !== 50) return false;
  const bytes = new Uint8Array(hex.match(/../g)!.map(part => parseInt(part, 16)));
  if (bytes[0] !== 0x41) return false;
  const checksum = new Uint8Array(await crypto.subtle.digest("SHA-256", await crypto.subtle.digest("SHA-256", bytes.slice(0, 21))));
  return bytes.slice(21).every((byte, index) => byte === checksum[index]);
}
async function validateOrder(order: Record<string, any>, input: Record<string, any>) {
  const route = routes[input.routeId]!;
  if (!order || !uuid(order.id) || order.buyer_id !== input.actorId || order.request_id !== input.requestId || order.price_id !== input.priceId
    || order.route_id !== input.routeId || order.chain !== route.chain || order.asset !== route.asset || order.contract !== route.contract
    || order.route_revision !== input.expectedQuote.route_revision || order.price_revision !== input.expectedQuote.price_revision
    || order.plan_revision !== input.expectedQuote.plan_revision || order.plan_key !== input.expectedQuote.plan_key || order.term_months !== input.expectedQuote.term_months
    || !["pending", "expired", "paid", "review", "revoked"].includes(order.status)
    || typeof order.amount_units !== "string" || !/^[1-9][0-9]{0,77}$/.test(order.amount_units)
    || typeof order.base_amount_units !== "string" || !/^[1-9][0-9]{0,77}$/.test(order.base_amount_units)) throw new Error("wallet_checkout_unavailable");
  const amount = BigInt(order.amount_units), base = BigInt(order.base_amount_units);
  if (base !== BigInt(input.expectedQuote.amount_minor) * 10000n || amount <= base || amount - base > 9999n
    || order.amount_decimal !== `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, "0")}`) throw new Error("wallet_checkout_unavailable");
  if (route.chain === "tron" ? !await validTronAddress(order.recipient)
    : typeof order.recipient !== "string" || !/^0x[0-9a-f]{40}$/.test(order.recipient) || /^0x0{40}$/.test(order.recipient)) throw new Error("wallet_checkout_unavailable");
  const created = Date.parse(order.created_at), expires = Date.parse(order.expires_at);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || created > Date.now() + 60000) throw new Error("wallet_checkout_unavailable");
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    // Independent deployment kill switch plus independent SQL wallet/route/
    // recipient gates. A missing real receiving address cannot create invoices.
    if (Deno.env.get("MEMBERSHIP_WALLET_ENABLED") !== "true") return json({ error: "wallet_checkout_unavailable" }, 503);
    const config = serverConfig();
    const authorization = request.headers.get("authorization") || "";
    if (!/^Bearer \S+$/.test(authorization)) return json({ error: "authentication_required" }, 401);
    let body;
    try {
      if (Number(request.headers.get("content-length") || 0) > 16384) throw new Error();
      const raw = await request.text();
      if (raw.length > 16384) throw new Error();
      body = JSON.parse(raw);
    } catch { return json({ error: "membership_input_invalid" }, 400); }
    if (!body || !uuid(body.actorId) || !uuid(body.priceId) || !uuid(body.requestId) || typeof body.routeId !== "string" || !Object.hasOwn(routes, body.routeId)
      || !validQuote(body.expectedQuote) || body.expectedQuote.price_id !== body.priceId) return json({ error: "membership_input_invalid" }, 400);
    const authResponse = await fetch(`${config.origin}/auth/v1/user`, { redirect: "error", headers: { apikey: config.anon, authorization }, signal: AbortSignal.timeout(10000) });
    const user = await authResponse.json().catch(() => null);
    if (authResponse.status === 401 || authResponse.status === 403) return json({ error: "authentication_required" }, 401);
    if (!authResponse.ok) throw new Error("wallet_checkout_unavailable");
    if (user?.id !== body.actorId) return json({ error: "authentication_required" }, 401);
    if (!user.email_confirmed_at) return json({ error: "account_ineligible" }, 403);
    const response = await fetch(`${config.origin}/rest/v1/rpc/prepare_membership_wallet_order`, { method: "POST", redirect: "error",
      headers: { apikey: config.service, authorization: `Bearer ${config.service}`, "content-type": "application/json" },
      body: JSON.stringify({ p_actor_id: user.id, p_price_id: body.priceId, p_route_id: body.routeId, p_request_id: body.requestId, p_expected_quote: body.expectedQuote }),
      signal: AbortSignal.timeout(15000) });
    const order = await response.json().catch(() => null);
    if (!response.ok) throw new Error(order?.message || "wallet_checkout_unavailable");
    await validateOrder(order, body);
    // Repeated requests return the original immutable invoice, including an
    // existing terminal state. Neither timeouts nor terminal states replace it.
    return json({ order });
  } catch (error) {
    const code = error instanceof Error ? error.message : "wallet_checkout_unavailable";
    if (code === "account_ineligible") return json({ error: code }, 403);
    if (code === "membership_input_invalid") return json({ error: code }, 400);
    if (["membership_wallet_unavailable", "membership_wallet_quote_changed", "membership_price_unavailable", "membership_plan_disabled",
      "membership_pending_order_exists", "request_conflict", "membership_wallet_amount_pool_exhausted"].includes(code)) return json({ error: code }, 409);
    // Preserve the request checkpoint on unknown acknowledgements. Do not
    // return provider/DB diagnostics or suggest the user pay a replacement.
    return json({ error: "wallet_checkout_unavailable" }, 503);
  }
});
