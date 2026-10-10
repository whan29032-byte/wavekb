const corsHeaders = {
  "access-control-allow-origin": Deno.env.get("SITE_ORIGIN") || "https://wavekb.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {...corsHeaders, "content-type": "application/json;charset=utf-8"}
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

function safeReturnUrl(value: unknown, fallbackHash: string) {
  const siteOrigin = env("SITE_ORIGIN");
  const fallback = `${siteOrigin}/${fallbackHash}`;
  try {
    const url = new URL(String(value || ""));
    return url.origin === new URL(siteOrigin).origin ? url.toString() : fallback;
  } catch (_) {
    return fallback;
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});
  if (request.method !== "POST") return json({error: "method_not_allowed"}, 405);

  try {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return json({error: "authentication_required"}, 401);
    }
    const userResponse = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
      headers: {
        apikey: env("SUPABASE_ANON_KEY"),
        authorization
      }
    });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) {
      return json({error: "authentication_required"}, 401);
    }
    const profiles = await rest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=account_status,public_uid&limit=1`);
    if (!user.email_confirmed_at || profiles?.[0]?.account_status !== "active" || profiles[0].public_uid == null) {
      return json({error: "account_ineligible"}, 403);
    }

    const body = await request.json();
    const orderId = String(body.orderId || "");
    const orders = await rest(
      `mentor_orders?id=eq.${encodeURIComponent(orderId)}&select=id,buyer_id,offer_id,offer_name_snapshot,amount_cents,currency,status,payment_provider,payment_method_id,provider_order_id`
    );
    const order = orders?.[0];
    if (!order || order.buyer_id !== user.id) {
      return json({error: "order_not_found"}, 404);
    }
    if (order.status === "paid") {
      return json({error: "order_already_paid"}, 409);
    }
    if (order.status !== "pending") {
      return json({error: "order_not_payable"}, 409);
    }
    if (order.payment_method_id != null || (order.payment_provider != null && order.payment_provider !== "stripe")) {
      return json({error: "order_payment_route_invalid"}, 409);
    }

    const offers = await rest(
      `mentor_offers?id=eq.${encodeURIComponent(order.offer_id)}&select=name`
    );
    const offerName = order.offer_name_snapshot || offers?.[0]?.name || "一对一波浪辅导";
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", safeReturnUrl(body.successUrl, "#mentors=success"));
    params.set("cancel_url", safeReturnUrl(body.cancelUrl, "#mentors=catalog"));
    params.set("client_reference_id", order.id);
    params.set("metadata[order_id]", order.id);
    params.set("payment_intent_data[metadata][order_id]", order.id);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", String(order.currency).toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(order.amount_cents));
    params.set("line_items[0][price_data][product_data][name]", offerName);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `wavekb-mentor-${order.id}`
      },
      body: params
    });
    const session = await stripeResponse.json().catch(() => null);
    if (!stripeResponse.ok || !session?.id || !session?.url) {
      throw new Error(session?.error?.message || "stripe_checkout_failed");
    }

    await rest("rpc/register_mentor_checkout_session", {
      method: "POST",
      body: JSON.stringify({
        p_actor: user.id, p_order_id: order.id, p_provider_order_id: session.id
      })
    });
    return json({checkoutUrl: session.url, orderId: order.id});
  } catch (error) {
    const code = String(error?.message || error);
    if (code === "account_ineligible") return json({error: code}, 403);
    if (["order_not_payable", "order_payment_route_invalid"].includes(code)) return json({error: code}, 409);
    return json({error: "checkout_unavailable"}, 500);
  }
});
