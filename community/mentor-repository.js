(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottMentorRepository = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function unwrap(result) {
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }

  function createMentorRepository(client, options) {
    const settings = options || {};
    const checkoutUrl = settings.checkoutUrl || "";

    async function accessToken() {
      const result = await client.auth.getSession();
      return result.data && result.data.session
        ? result.data.session.access_token
        : "";
    }

    return {
      async listCatalog() {
        return unwrap(await client.rpc("list_mentor_catalog"));
      },
      async getMentor(mentorId) {
        const rows = unwrap(await client.rpc("get_mentor_detail", {
          p_mentor_id: mentorId
        })) || [];
        return rows[0] || null;
      },
      async listMyAccess() {
        return unwrap(await client.rpc("list_my_mentor_access")) || [];
      },
      async listPaymentMethods(mentorId) {
        return unwrap(await client.rpc("list_mentor_payment_methods", {
          p_mentor_id: mentorId
        })) || [];
      },
      async getMySettings() {
        const result = unwrap(await client.rpc("get_my_mentor_settings"));
        return Array.isArray(result) ? result[0] || null : result;
      },
      async saveOffer(value) {
        const row = {
          ...(value.id ? {id: value.id} : {}),
          mentor_id: value.mentorId,
          name: value.name,
          description: value.description || "",
          price_cents: Math.max(0, Math.round(Number(value.price) * 100)),
          currency: "USDT",
          duration_days: Number(value.durationDays || 30),
          weekly_questions: Number(value.weeklyQuestions || 3),
          active: value.active !== false,
          sort_order: Number(value.sortOrder || 100),
          updated_at: new Date().toISOString()
        };
        return unwrap(await client.from("mentor_offers").upsert(row).select("*").single());
      },
      async savePaymentMethod(value) {
        const row = {
          ...(value.id ? {id: value.id} : {}),
          mentor_id: value.mentorId,
          kind: value.kind,
          label: value.label,
          account_name: value.accountName || "",
          account_value: value.accountValue,
          network: value.network || "",
          instructions: value.instructions || "",
          active: value.active !== false,
          sort_order: Number(value.sortOrder || 100),
          updated_at: new Date().toISOString()
        };
        return unwrap(await client.from("mentor_payment_methods").upsert(row).select("*").single());
      },
      async createManualOrder(offerId, paymentMethodId) {
        return unwrap(await client.rpc("create_manual_mentor_order", {
          p_offer_id: offerId,
          p_payment_method_id: paymentMethodId
        }));
      },
      async submitPaymentClaim(orderId, buyerNote) {
        return unwrap(await client.rpc("submit_mentor_payment_claim", {
          p_order_id: orderId,
          p_buyer_note: String(buyerNote || "").trim()
        }));
      },
      async createCheckout(offerId) {
        const order = unwrap(await client.rpc("create_mentor_order", {
          p_offer_id: offerId
        }));
        const orderId = Array.isArray(order) ? order[0] : order;
        const body = {
          orderId,
          successUrl: `${location.origin}${location.pathname}#mentors=success&order=${encodeURIComponent(orderId)}`,
          cancelUrl: `${location.origin}${location.pathname}#mentors=catalog`
        };
        let payload;
        if (checkoutUrl) {
          const response = await fetch(checkoutUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${await accessToken()}`
            },
            cache: "no-store",
            body: JSON.stringify(body)
          });
          payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || "支付通道尚未配置，请联系管理员。");
          }
        } else {
          const result = await client.functions.invoke("mentor-checkout", {body});
          if (result.error) throw result.error;
          payload = result.data || {};
        }
        if (!payload.checkoutUrl) {
          throw new Error(payload.error || "支付通道尚未配置，请联系管理员。");
        }
        return {orderId, checkoutUrl: payload.checkoutUrl};
      },
      async getThread(threadId) {
        const rows = unwrap(await client.rpc("get_mentor_thread", {
          p_thread_id: threadId
        })) || [];
        return rows[0] || null;
      },
      async listMessages(threadId) {
        return unwrap(await client.rpc("list_mentor_messages", {
          p_thread_id: threadId
        })) || [];
      },
      async sendMessage(threadId, body) {
        return unwrap(await client.rpc("send_mentor_message", {
          p_thread_id: threadId,
          p_body: body
        }));
      }
    };
  }

  return {createMentorRepository};
});
