// The endpoint has its own signing secret. It must remain active while new
// purchases are disabled so late payments and refunds can still be reconciled.
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } }); }
function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error("membership_payment_processing_failed"); return value; }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function equal(left: string, right: string) { if (left.length !== right.length) return false; let different = 0; for (let i = 0; i < left.length; ++i) different |= left.charCodeAt(i) ^ right.charCodeAt(i); return different === 0; }
async function verify(body: string, header: string) {
  const parts = header.split(",").map(value => value.trim().split("="));
  const timestamps = parts.filter(([name]) => name === "t");
  const signatures = parts.filter(([name, value]) => name === "v1" && /^[0-9a-f]{64}$/.test(value || "")).map(([, value]) => value);
  const timestamp = timestamps[0]?.[1];
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamp || "") || !Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("MEMBERSHIP_STRIPE_WEBHOOK_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))).map(value => value.toString(16).padStart(2, "0")).join("");
  return signatures.some(signature => equal(digest, signature));
}
async function rpc(name: string, body: Record<string, unknown>, ledger = true) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.message || "membership_payment_processing_failed");
  if (!value || (ledger && (typeof value.duplicate !== "boolean" || typeof value.applied !== "boolean"))) throw new Error("membership_payment_processing_failed");
  return value;
}
function config() {
  const mode = env("MEMBERSHIP_PAYMENT_MODE"), key = env("MEMBERSHIP_STRIPE_SECRET_KEY");
  if (!["test", "live"].includes(mode) || !new RegExp(`^(sk|rk)_${mode}_`).test(key)) throw new Error("membership_payment_processing_failed");
  return { mode, key };
}
async function stripe(path: string, key: string) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) throw new Error("membership_payment_processing_failed");
  return value;
}
function metadata(value: Record<string, any>) {
  if (value.metadata?.domain !== "membership") return null;
  if (!uuid(value.metadata.order_id) || !uuid(value.metadata.buyer_id)) throw new Error("membership_payment_event_invalid");
  return { orderId: value.metadata.order_id, buyerId: value.metadata.buyer_id };
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const body = await request.text();
    if (!await verify(body, request.headers.get("stripe-signature") || "")) return json({ error: "invalid_signature" }, 400);
    let event;
    try { event = JSON.parse(body); } catch { return json({ error: "membership_payment_event_invalid" }, 400); }
    const paymentTypes = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"];
    const refundTypes = ["refund.created", "refund.updated", "refund.failed"];
    if (!paymentTypes.includes(event?.type) && !refundTypes.includes(event?.type)) return json({ received: true });
    if (!/^evt_[A-Za-z0-9_]+$/.test(event.id || "") || !Number.isSafeInteger(event.created) || typeof event.livemode !== "boolean") return json({ error: "membership_payment_event_invalid" }, 400);
    const settings = config();
    if (event.livemode !== (settings.mode === "live")) return json({ error: "membership_payment_mode_mismatch" }, 409);
    let result;
    const object = event.data?.object;
    if (!object || typeof object !== "object") return json({ error: "membership_payment_event_invalid" }, 400);
    if (paymentTypes.includes(event.type)) {
      const target = metadata(object);
      if (!target) return json({ received: true, ignored: true }); // Never route mentor payments here.
      if (!/^cs_[A-Za-z0-9_]+$/.test(object.id || "") || object.mode !== "payment" || object.livemode !== event.livemode
        || object.client_reference_id !== target.orderId || !Number.isSafeInteger(object.amount_total) || object.amount_total <= 0
        || !["paid", "unpaid"].includes(object.payment_status) || !["usd", "cny", "hkd"].includes(object.currency)) return json({ error: "membership_payment_event_invalid" }, 400);
      // Retrieve the current provider record as well as validating the signed
      // event. A success query string and an unpaid completed session never grant.
      const session = await stripe(`checkout/sessions/${encodeURIComponent(object.id)}`, settings.key);
      const canonical = metadata(session);
      if (!canonical || canonical.orderId !== target.orderId || canonical.buyerId !== target.buyerId || session.id !== object.id || session.mode !== "payment"
        || session.livemode !== event.livemode || session.client_reference_id !== target.orderId || session.amount_total !== object.amount_total || session.currency !== object.currency) throw new Error("membership_payment_event_invalid");
      const expired = event.type === "checkout.session.expired";
      if (expired ? session.status !== "expired" : session.status !== "complete") throw new Error("membership_payment_event_invalid");
      const intent = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null;
      const canonicalIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
      if ((intent !== null && (!/^pi_[A-Za-z0-9_]+$/.test(intent) || intent !== canonicalIntent))
        || (object.payment_status === "paid" && (session.payment_status !== "paid" || intent === null))) throw new Error("membership_payment_event_invalid");
      if (event.type === "checkout.session.async_payment_failed") {
        // A completed but delayed-unpaid session has no further expiry event.
        // Close it only with signed failure plus canonical terminal failure proof,
        // never treating a pending/processing payment or a browser exit as failed.
        if (intent === null || object.payment_status !== "unpaid" || session.payment_status !== "unpaid") throw new Error("membership_payment_event_invalid");
        const failedIntent = await stripe(`payment_intents/${encodeURIComponent(intent)}`, settings.key);
        const failedTarget = metadata(failedIntent);
        if (!failedTarget || failedTarget.orderId !== target.orderId || failedTarget.buyerId !== target.buyerId
          || failedIntent.id !== intent || failedIntent.livemode !== event.livemode || failedIntent.amount !== object.amount_total
          || failedIntent.currency !== object.currency || !["requires_payment_method", "canceled"].includes(failedIntent.status)) throw new Error("membership_payment_event_invalid");
      }
      result = await rpc("apply_verified_membership_payment_event", { p_event_id: event.id, p_event_type: event.type,
        p_order_id: target.orderId, p_buyer_id: target.buyerId, p_session_id: object.id, p_payment_intent_id: intent,
        p_amount_minor: object.amount_total, p_currency: object.currency, p_payment_status: object.payment_status,
        p_livemode: event.livemode, p_paid_at: new Date(event.created * 1000).toISOString() });
    } else {
      if (!/^re_[A-Za-z0-9_]+$/.test(object.id || "") || !/^pi_[A-Za-z0-9_]+$/.test(object.payment_intent || "")) throw new Error("membership_payment_event_invalid");
      const refund = await stripe(`refunds/${encodeURIComponent(object.id)}`, settings.key);
      if (refund.id !== object.id || refund.payment_intent !== object.payment_intent || !Number.isSafeInteger(object.amount) || object.amount <= 0 || refund.amount !== object.amount
        || !["usd", "cny", "hkd"].includes(object.currency) || refund.currency !== object.currency
        || !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(object.status)
        || (object.status === "succeeded" && refund.status !== "succeeded")) throw new Error("membership_payment_event_invalid");
      const intent = await stripe(`payment_intents/${encodeURIComponent(refund.payment_intent)}`, settings.key);
      const target = metadata(intent);
      if (!target) return json({ received: true, ignored: true });
      if (intent.id !== refund.payment_intent || intent.livemode !== event.livemode || intent.currency !== refund.currency) throw new Error("membership_payment_event_invalid");
      const route = await rpc("get_membership_payment_route", { p_order_id: target.orderId }, false);
      if (route.id !== target.orderId || route.buyer_id !== target.buyerId || route.livemode !== event.livemode || route.currency !== refund.currency.toUpperCase()
        || !/^cs_[A-Za-z0-9_]+$/.test(route.provider_session_id || "")) throw new Error("membership_payment_event_invalid");
      const session = await stripe(`checkout/sessions/${encodeURIComponent(route.provider_session_id)}`, settings.key);
      const sessionTarget = metadata(session);
      const sessionIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (session.id !== route.provider_session_id || !sessionTarget || sessionTarget.orderId !== target.orderId || sessionTarget.buyerId !== target.buyerId
        || sessionIntent !== intent.id || session.mode !== "payment" || session.livemode !== event.livemode || session.amount_total !== route.amount_minor || session.currency !== refund.currency) throw new Error("membership_payment_event_invalid");
      result = await rpc("apply_verified_membership_refund_event", { p_event_id: event.id, p_order_id: target.orderId, p_buyer_id: target.buyerId,
        p_payment_intent_id: intent.id, p_refund_id: refund.id, p_amount_minor: object.amount, p_currency: object.currency,
        p_refund_status: object.status === "requires_action" ? "pending" : object.status, p_livemode: event.livemode });
    }
    return json({ received: true, duplicate: result.duplicate, applied: result.applied });
  } catch (error) {
    const code = error instanceof Error ? error.message : "membership_payment_processing_failed";
    if (/membership_payment_event_invalid/.test(code)) return json({ error: "membership_payment_event_invalid" }, 400);
    const conflicts: Record<string, string> = {
      payment_amount_mismatch: "membership_payment_amount_mismatch",
      order_payment_route_invalid: "membership_payment_route_invalid",
      payment_mode_mismatch: "membership_payment_mode_mismatch",
      payment_event_conflict: "membership_payment_event_conflict",
      order_not_found: "membership_order_not_found",
      request_conflict: "request_conflict",
    };
    if (Object.hasOwn(conflicts, code)) return json({ error: conflicts[code] }, 409);
    // No private database/provider diagnostics or credentials leave this handler.
    return json({ error: "membership_payment_processing_failed" }, 500);
  }
});
