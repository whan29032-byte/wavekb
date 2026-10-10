function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json;charset=utf-8"}
  });
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

async function rest(path: string, init?: RequestInit) {
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "database_request_failed");
  }
  return payload;
}

function parseStripeSignature(value: string) {
  const entries = value.split(",").map(item => item.split("="));
  const timestamp = entries.find(([key]) => key === "t")?.[1] || "";
  const signatures = entries.filter(([key]) => key === "v1").map(([, item]) => item);
  return {timestamp, signatures};
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function verify(rawBody: string, header: string) {
  const {timestamp, signatures} = parseStripeSignature(header);
  if (!/^\d+$/.test(timestamp) || !signatures.length || !Number.isFinite(Number(timestamp))) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("STRIPE_WEBHOOK_SECRET")),
    {name: "HMAC", hash: "SHA-256"},
    false,
    ["sign"]
  );
  const digest = hex(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  ));
  return signatures.some(signature => constantTimeEqual(digest, signature));
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({error: "method_not_allowed"}, 405);
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature") || "";
    if (!await verify(rawBody, signature)) {
      return json({error: "invalid_signature"}, 400);
    }
    const event = JSON.parse(rawBody);
    const supported = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired"
    ]);
    if (!supported.has(event.type)) return json({received: true});

    const session = event.data?.object || {};
    const orderId = String(session.metadata?.order_id || session.client_reference_id || "");
    if (!orderId) return json({error: "missing_order_id"}, 400);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
      || !/^evt_[A-Za-z0-9_]+$/.test(String(event.id || ""))
      || !/^cs_[A-Za-z0-9_]+$/.test(String(session.id || ""))) {
      return json({error: "payment_event_invalid"}, 400);
    }
    if (event.type !== "checkout.session.expired"
      && (!Number.isSafeInteger(session.amount_total) || session.amount_total < 0)) {
      return json({error: "payment_amount_mismatch"}, 409);
    }
    // Event persistence, duplicate handling, route/amount checks and the rights
    // transition share one database transaction. An unpaid completed Session
    // is recorded without granting access; async_payment_succeeded can follow.
    const result = await rest("rpc/apply_verified_mentor_payment_event", {
      method: "POST",
      body: JSON.stringify({
        p_event_id: event.id, p_event_type: event.type, p_order_id: orderId,
        p_provider_order_id: session.id, p_amount_cents: session.amount_total ?? null,
        p_currency: String(session.currency || ""), p_payment_status: String(session.payment_status || "")
      })
    });
    return json({received: true, duplicate: result.duplicate, applied: result.applied});
  } catch (error) {
    const code = String(error?.message || error);
    if (code === "order_not_found") return json({error: code}, 404);
    if (["payment_amount_mismatch", "order_payment_route_invalid", "payment_event_conflict"].includes(code)) return json({error: code}, 409);
    if (code === "payment_event_invalid") return json({error: code}, 400);
    return json({error: "payment_processing_failed"}, 500);
  }
});
