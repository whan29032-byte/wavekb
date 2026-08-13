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
  if (!timestamp || !signatures.length) return false;
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

    const orders = await rest(
      `mentor_orders?id=eq.${encodeURIComponent(orderId)}&select=id,amount_cents,currency,status`
    );
    const order = orders?.[0];
    if (!order) return json({error: "order_not_found"}, 404);
    if (
      event.type !== "checkout.session.expired"
      && (
        Number(session.amount_total) !== Number(order.amount_cents)
        || String(session.currency || "").toUpperCase() !== String(order.currency).toUpperCase()
      )
    ) {
      return json({error: "payment_amount_mismatch"}, 409);
    }

    const eventResult = await fetch(
      `${env("SUPABASE_URL")}/rest/v1/mentor_payment_events?on_conflict=event_id`,
      {
        method: "POST",
        headers: {
          apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
          authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
          "content-type": "application/json",
          prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify({
          event_id: event.id,
          provider: "stripe",
          event_type: event.type,
          order_id: order.id
        })
      }
    );
    const insertedEvents = await eventResult.json().catch(() => []);
    if (!eventResult.ok) throw new Error("payment_event_store_failed");
    if (!insertedEvents.length) return json({received: true, duplicate: true});

    const paid = event.type !== "checkout.session.expired";
    await rest(`mentor_orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: "PATCH",
      headers: {prefer: "return=minimal"},
      body: JSON.stringify({
        status: paid ? "paid" : "cancelled",
        payment_provider: "stripe",
        provider_order_id: session.id || null,
        paid_at: paid ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
    });
    return json({received: true});
  } catch (error) {
    return json({error: String(error?.message || error)}, 500);
  }
});
