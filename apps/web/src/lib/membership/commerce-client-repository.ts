import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCommercePlan, parseCommerceSettings, parseMembershipCatalog, parseMembershipCommerceAdminStore, parseMembershipPrice, parseMyMembershipCommerce,
  type MembershipCurrency, type MembershipPaymentMode } from "./commerce-types";

export function membershipCommerceRepository(client: SupabaseClient, actorId: string) {
  async function rpc(name: string, parameters?: Record<string, unknown>, authenticated = true) {
    if (authenticated) {
      const auth = await client.auth.getUser();
      if (auth.error || auth.data.user?.id !== actorId) throw new Error("authentication_required");
    }
    const result = await client.rpc(name, parameters);
    if (result.error) throw result.error;
    if (authenticated) {
      const auth = await client.auth.getUser();
      if (auth.error || auth.data.user?.id !== actorId) throw new Error("authentication_required");
    }
    return result.data as unknown;
  }
  const invalid = () => { throw new Error("membership_commerce_response_invalid"); };
  return {
    async catalog() { return parseMembershipCatalog(await rpc("list_membership_catalog", undefined, false)); },
    async mine() {
      const value = parseMyMembershipCommerce(await rpc("get_my_membership_commerce", { p_actor_id: actorId }));
      if (value.effective.user_id !== actorId || value.orders.some((o) => o.buyer_id !== actorId)) invalid();
      return value;
    },
    async adminStore() { return parseMembershipCommerceAdminStore(await rpc("admin_membership_commerce_store", { p_actor_id: actorId })); },
    async savePrice(input: { id: string; planKey: string; termMonths: 1 | 12; amountMinor: number; currency: MembershipCurrency; published: boolean; revision: number; reason: string; requestId: string }) {
      const value = parseMembershipPrice(await rpc("admin_save_membership_price", { p_price_id: input.id, p_plan_key: input.planKey, p_term_months: input.termMonths,
        p_amount_minor: input.amountMinor, p_currency: input.currency, p_published: input.published, p_expected_revision: input.revision,
        p_reason: input.reason, p_request_id: input.requestId, p_actor_id: actorId }));
      if (value.id !== input.id || value.plan_key !== input.planKey || value.term_months !== input.termMonths || value.amount_minor !== input.amountMinor
        || value.currency !== input.currency || value.published !== input.published || value.revision !== input.revision + 1) invalid();
      return value;
    },
    async saveEntitlements(input: { planKey: string; aiDailyLimit: number; mentorDiscountBps: number; revision: number; reason: string; requestId: string }) {
      const value = parseCommercePlan(await rpc("admin_save_membership_entitlements", { p_plan_key: input.planKey, p_ai_daily_limit: input.aiDailyLimit,
        p_mentor_discount_bps: input.mentorDiscountBps, p_expected_revision: input.revision, p_reason: input.reason, p_request_id: input.requestId, p_actor_id: actorId }));
      if (value.key !== input.planKey || value.ai_daily_limit !== input.aiDailyLimit || value.mentor_discount_bps !== input.mentorDiscountBps || value.revision !== input.revision + 1) invalid();
      return value;
    },
    async saveSettings(input: { billingEnabled: boolean; paymentMode: MembershipPaymentMode; revision: number; reason: string; requestId: string }) {
      const value = parseCommerceSettings(await rpc("admin_save_membership_commerce_settings", { p_billing_enabled: input.billingEnabled, p_payment_mode: input.paymentMode,
        p_expected_revision: input.revision, p_reason: input.reason, p_request_id: input.requestId, p_actor_id: actorId }));
      if (value.billing_enabled !== input.billingEnabled || value.payment_mode !== input.paymentMode || value.revision !== input.revision + 1) invalid();
      return value;
    },
  };
}
