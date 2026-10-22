import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminMentorOrder, AdminMentorService, MentorCatalogInput, MentorOfferInput, MentorPaymentInput } from "@/lib/admin/mentors-types";

const transitions: Record<AdminMentorOrder["status"], AdminMentorOrder["status"][]> = {
  pending: ["pending", "paid", "cancelled", "failed"],
  failed: ["failed", "pending", "paid", "cancelled"],
  paid: ["paid", "refunded", "cancelled"],
  cancelled: ["cancelled"],
  refunded: ["refunded"],
};

export function mentorOrderTransitions(status: AdminMentorOrder["status"]) { return transitions[status] || [status]; }

export function adminMentorMutations(client: SupabaseClient) {
  return {
    async saveCatalog(input: MentorCatalogInput) {
      const result = await client.rpc("admin_upsert_mentor_catalog_v2", { p_mentor_id: input.mentorId || null, p_offer_id: input.offerId || null, p_owner_id: input.ownerId || null, p_display_name: input.displayName.trim(), p_headline: input.headline.trim(), p_bio: input.bio.trim(), p_avatar_url: input.avatarUrl?.trim() || null, p_specialties: input.specialties, p_active: input.active, p_sort_order: input.sortOrder, p_offer_name: input.offerName.trim() || "一对一波浪辅导", p_price_cents: input.priceCents, p_currency: "USDT", p_duration_days: input.durationDays, p_weekly_questions: input.weeklyQuestions, p_offer_active: input.offerActive });
      if (result.error) throw result.error;
      return result.data as { mentor_id: string; offer_id: string; reused_mentor: boolean };
    },
    async createOffer(input: MentorOfferInput) { const result = await client.from("mentor_offers").insert(input).select("id").single(); if (result.error) throw result.error; return result.data.id as string; },
    async updateOffer(id: string, input: Partial<MentorOfferInput>) { const result = await client.from("mentor_offers").update(input).eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("offer_update_failed"); },
    async deleteOffer(id: string) { const result = await client.from("mentor_offers").delete().eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("offer_delete_failed"); },
    async createPayment(input: MentorPaymentInput) { const result = await client.from("mentor_payment_methods").insert(input).select("id").single(); if (result.error) throw result.error; return result.data.id as string; },
    async updatePayment(id: string, input: Partial<MentorPaymentInput>) { const result = await client.from("mentor_payment_methods").update(input).eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("payment_update_failed"); },
    async deletePayment(id: string) { const result = await client.from("mentor_payment_methods").delete().eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("payment_delete_failed"); },
    async updateOrder(order: AdminMentorOrder, nextStatus: AdminMentorOrder["status"]) {
      if (!mentorOrderTransitions(order.status).includes(nextStatus)) throw new Error("order_transition_invalid");
      const result = await client.rpc("admin_transition_mentor_order", {
        p_order_id: order.id, p_expected_status: order.status, p_status: nextStatus, p_reason: "后台订单状态更新",
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("order_changed_concurrently");
      return result.data;
    },
    async updateService(service: AdminMentorService, nextStatus: "active" | "completed" | "disputed" | "revoked", reason: string) {
      const result = await client.rpc("admin_transition_mentor_service", {
        p_entitlement_id: service.id, p_expected_status: service.stored_status, p_status: nextStatus, p_reason: reason.trim(),
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("service_changed_concurrently");
      return result.data;
    },
  };
}
