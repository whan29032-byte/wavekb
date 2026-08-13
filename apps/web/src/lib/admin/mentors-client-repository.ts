import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminMentorOrder, MentorCatalogInput, MentorOfferInput, MentorPaymentInput } from "@/lib/admin/mentors-types";

const transitions: Record<AdminMentorOrder["status"], AdminMentorOrder["status"][]> = {
  pending: ["pending", "paid", "cancelled", "failed"],
  failed: ["failed", "pending", "paid", "cancelled"],
  paid: ["paid", "refunded", "cancelled"],
  cancelled: ["cancelled", "pending"],
  refunded: ["refunded"],
};

export function mentorOrderTransitions(status: AdminMentorOrder["status"]) { return transitions[status] || [status]; }

export function adminMentorMutations(client: SupabaseClient) {
  return {
    async saveCatalog(input: MentorCatalogInput) {
      const result = await client.rpc("admin_upsert_mentor_catalog", { p_mentor_id: input.mentorId || null, p_offer_id: input.offerId || null, p_owner_id: input.ownerId || null, p_display_name: input.displayName.trim(), p_headline: input.headline.trim(), p_bio: input.bio.trim(), p_avatar_url: input.avatarUrl?.trim() || null, p_specialties: input.specialties, p_active: input.active, p_sort_order: input.sortOrder, p_offer_name: input.offerName.trim() || "一对一波浪辅导", p_price_cents: input.priceCents, p_currency: "USDT", p_duration_days: input.durationDays, p_weekly_questions: input.weeklyQuestions });
      if (result.error) throw result.error;
      const offerId = String((result.data as { offer_id?: string })?.offer_id || input.offerId || "");
      if (offerId) { const restored = await client.from("mentor_offers").update({ active: input.offerActive }).eq("id", offerId).select("id").maybeSingle(); if (restored.error || !restored.data) throw restored.error || new Error("offer_update_failed"); }
      return result.data as { mentor_id: string; offer_id: string };
    },
    async createOffer(input: MentorOfferInput) { const result = await client.from("mentor_offers").insert(input).select("id").single(); if (result.error) throw result.error; return result.data.id as string; },
    async updateOffer(id: string, input: Partial<MentorOfferInput>) { const result = await client.from("mentor_offers").update(input).eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("offer_update_failed"); },
    async deleteOffer(id: string) { const result = await client.from("mentor_offers").delete().eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("offer_delete_failed"); },
    async createPayment(input: MentorPaymentInput) { const result = await client.from("mentor_payment_methods").insert(input).select("id").single(); if (result.error) throw result.error; return result.data.id as string; },
    async updatePayment(id: string, input: Partial<MentorPaymentInput>) { const result = await client.from("mentor_payment_methods").update(input).eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("payment_update_failed"); },
    async deletePayment(id: string) { const result = await client.from("mentor_payment_methods").delete().eq("id", id).select("id").maybeSingle(); if (result.error || !result.data) throw result.error || new Error("payment_delete_failed"); },
    async updateOrder(order: AdminMentorOrder, nextStatus: AdminMentorOrder["status"]) {
      if (!mentorOrderTransitions(order.status).includes(nextStatus)) throw new Error("order_transition_invalid");
      const patch: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
      if (nextStatus === "paid" && !order.paid_at) patch.paid_at = new Date().toISOString();
      const result = await client.from("mentor_orders").update(patch).eq("id", order.id).eq("status", order.status).select("id,status").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("order_changed_concurrently");
      return result.data;
    },
  };
}
