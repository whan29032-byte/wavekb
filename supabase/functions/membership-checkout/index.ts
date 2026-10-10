// Independent one-time membership checkout. Never reuse mentor orders or grant
// rights from a return URL. All amounts and terms come from a frozen SQL quote.
const cors = {
  "access-control-allow-origin": Deno.env.get("SITE_ORIGIN") || "https://wavekb.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...cors, "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } }); }
function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error("membership_checkout_unavailable"); return value; }
function paymentConfig() {
  const mode = env("MEMBERSHIP_PAYMENT_MODE");
  const key = env("MEMBERSHIP_STRIPE_SECRET_KEY");
  if (!["test", "live"].includes(mode) || !new RegExp(`^(sk|rk)_${mode}_`).test(key)) throw new Error("membership_checkout_unavailable");
  return { mode, key };
}
async function rpc(name: string, body: Record<string, unknown>) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.message || "membership_checkout_unavailable");
  return value;
}
function checkoutUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("membership_checkout_unavailable");
  const url = new URL(value);
  if (url.origin !== "https://checkout.stripe.com" || url.username || url.password) throw new Error("membership_checkout_unavailable");
  return value;
}
function validateSession(session: Record<string, any>, order: Record<string, any>, actorId: string, mode: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(session.id || "") || session.mode !== "payment" || session.livemode !== (mode === "live")
    || session.metadata?.domain !== "membership" || session.metadata?.order_id !== order.id || session.metadata?.buyer_id !== actorId
    || session.client_reference_id !== order.id || session.amount_total !== order.amount_minor || String(session.currency).toUpperCase() !== order.currency
    || !Number.isSafeInteger(session.expires_at)) throw new Error("membership_checkout_unavailable");
  if (session.status !== "open" || session.payment_status !== "unpaid" || session.expires_at <= Date.now() / 1000) throw new Error("membership_payment_confirmation_pending");
  checkoutUrl(session.url);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    // Turning new purchases off must not turn off the separate webhook handler.
    if (Deno.env.get("MEMBERSHIP_BILLING_ENABLED") !== "true") return json({ error: "membership_checkout_unavailable" }, 503);
    const config = paymentConfig();
    const authorization = request.headers.get("authorization") || "";
    if (!/^Bearer \S+$/.test(authorization)) return json({ error: "authentication_required" }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "membership_input_invalid" }, 400); }
    if (!body || !uuid(body.actorId) || !uuid(body.priceId) || !uuid(body.requestId) || !body.expectedQuote || typeof body.expectedQuote !== "object" || Array.isArray(body.expectedQuote)) return json({ error: "membership_input_invalid" }, 400);
    const authResponse = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: env("SUPABASE_ANON_KEY"), authorization }, signal: AbortSignal.timeout(10000) });
    const user = await authResponse.json().catch(() => null);
    if (!authResponse.ok || !user?.id || user.id !== body.actorId) return json({ error: "authentication_required" }, 401);
    if (!user.email_confirmed_at) return json({ error: "account_ineligible" }, 403);
    // This service-only transaction independently checks active profile/UID,
    // revisions, mode, published price, idempotency and other pending orders.
    const order = await rpc("prepare_membership_order", { p_actor_id: user.id, p_price_id: body.priceId, p_request_id: body.requestId, p_expected_quote: body.expectedQuote });
    if (!order || !uuid(order.id) || order.buyer_id !== user.id || order.request_id !== body.requestId || order.price_id !== body.priceId
      || !Number.isSafeInteger(order.amount_minor) || order.amount_minor <= 0 || order.amount_minor > 100000000
      || !["USD", "CNY", "HKD"].includes(order.currency) || ![1, 12].includes(order.term_months)
      || order.payment_mode !== config.mode || order.livemode !== (config.mode === "live")) throw new Error("membership_checkout_unavailable");
    if (order.status !== "pending") return json({ error: "membership_order_not_payable", orderId: order.id }, 409);
    const createdAt = Date.parse(order.created_at);
    if (!Number.isFinite(createdAt) || createdAt > Date.now() + 60000) throw new Error("membership_checkout_unavailable");
    const origin = new URL(env("SITE_ORIGIN"));
    if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("membership_checkout_unavailable");
    let session;
    if (order.provider_session_id) {
      if (!/^cs_[A-Za-z0-9_]+$/.test(order.provider_session_id)) throw new Error("membership_checkout_unavailable");
      const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.provider_session_id)}`, { headers: { authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(15000) });
      session = await response.json().catch(() => null);
      if (!response.ok || session?.id !== order.provider_session_id) throw new Error("membership_checkout_unavailable");
    } else {
      // Stripe may prune an idempotency key after 24h. Never recreate an old
      // unacknowledged external session after that protection window.
      if (createdAt + 86400000 < Date.now() + 1800000) throw new Error("membership_payment_confirmation_pending");
      const params = new URLSearchParams({ mode: "payment", client_reference_id: order.id,
        success_url: `${origin.origin}/membership?payment=return&order=${order.id}`,
        cancel_url: `${origin.origin}/membership?payment=cancelled&order=${order.id}`,
        "metadata[domain]": "membership", "metadata[order_id]": order.id, "metadata[buyer_id]": user.id,
        "payment_intent_data[metadata][domain]": "membership", "payment_intent_data[metadata][order_id]": order.id, "payment_intent_data[metadata][buyer_id]": user.id,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": order.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(order.amount_minor),
        "line_items[0][price_data][product_data][name]": `${order.title_snapshot} · ${order.term_months === 12 ? "年费" : "月费"}`,
        // A stable expiry is essential: retries must have exactly the same Stripe
        // parameters, not a new timestamp that conflicts with the original key.
        expires_at: String(Math.floor(createdAt / 1000) + 86400),
      });
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${config.key}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `wavekb-membership-${order.id}` }, body: params, signal: AbortSignal.timeout(15000) });
      session = await response.json().catch(() => null);
      if (!response.ok || !session) throw new Error("membership_checkout_unavailable");
    }
    validateSession(session, order, user.id, config.mode);
    const receipt = await rpc("register_membership_checkout_session", { p_actor_id: user.id, p_order_id: order.id, p_session_id: session.id, p_checkout_url: session.url, p_expires_at: new Date(session.expires_at * 1000).toISOString(), p_livemode: session.livemode });
    if (!receipt || receipt.id !== order.id || receipt.buyer_id !== user.id || receipt.provider_session_id !== session.id || receipt.checkout_url !== session.url) throw new Error("membership_checkout_unavailable");
    // The verified webhook may win the race after session retrieval. A terminal
    // receipt is not a failed creation, and must never initiate another purchase.
    if (receipt.status !== "pending") throw new Error("membership_payment_confirmation_pending");
    return json({ orderId: order.id, checkoutUrl: checkoutUrl(session.url) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "membership_checkout_unavailable";
    if (/authentication_required/.test(code)) return json({ error: "authentication_required" }, 401);
    if (/account_ineligible/.test(code)) return json({ error: "account_ineligible" }, 403);
    if (["membership_quote_changed", "membership_pending_order_exists", "membership_order_not_payable", "membership_payment_confirmation_pending", "membership_price_unavailable", "membership_plan_disabled", "membership_billing_unavailable", "request_conflict"].includes(code)) return json({ error: code }, 409);
    if (code === "order_not_payable") return json({ error: "membership_order_not_payable" }, 409);
    // A timeout or missing acknowledgement never cancels an order, creates a
    // replacement request or pretends no external session exists.
    return json({ error: "membership_checkout_unavailable" }, 503);
  }
});
