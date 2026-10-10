import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGrantReceipt, parseMembershipAdminStore, parseMyMembership, parsePlanReceipt } from "@/lib/membership/types";

export function membershipRepository(client: SupabaseClient, actorId: string) {
  async function rpc(name: string, parameters?: Record<string, unknown>) {
    const auth = await client.auth.getUser();
    if (auth.error || auth.data.user?.id !== actorId) throw new Error("authentication_required");
    const result = await client.rpc(name, parameters);
    if (result.error) throw result.error;
    const current = await client.auth.getUser();
    if (current.error || current.data.user?.id !== actorId) throw new Error("authentication_required");
    return result.data as unknown;
  }
  return {
    async mine() { return parseMyMembership(await rpc("get_my_membership")); },
    async adminStore(uid: number | null = null) { return parseMembershipAdminStore(await rpc("admin_membership_store", { p_public_uid: uid, p_actor_id: actorId })); },
    async savePlan(input: { key: string; title: string; description: string; benefits: Record<string, string>; enabled: boolean; revision: number; reason: string; requestId: string }) {
      const result = await rpc("admin_save_membership_plan", { p_key: input.key, p_title: input.title, p_description: input.description, p_benefits: input.benefits, p_enabled: input.enabled, p_expected_revision: input.revision, p_reason: input.reason, p_request_id: input.requestId, p_actor_id: actorId });
      const receipt=parsePlanReceipt(result);
      if (receipt.key!==input.key || receipt.revision!==input.revision+1 || receipt.title!==input.title.trim() || receipt.description!==input.description
        || receipt.enabled!==input.enabled || Object.keys(receipt.benefits).length!==Object.keys(input.benefits).length || Object.entries(input.benefits).some(([key,value])=>receipt.benefits[key]!==value)) throw new Error("membership_response_invalid");
      return receipt;
    },
    async change(input: { userId: string; planKey: string; action: "grant" | "extend" | "revoke"; endsAt: string | null; revision: number; reason: string; requestId: string }) {
      const result = await rpc("admin_change_membership", { p_user_id: input.userId, p_plan_key: input.planKey, p_action: input.action, p_ends_at: input.endsAt, p_expected_revision: input.revision, p_reason: input.reason, p_request_id: input.requestId, p_actor_id: actorId });
      const receipt=parseGrantReceipt(result);
      if (receipt.user_id!==input.userId || receipt.plan_key!==input.planKey || receipt.revision!==input.revision+1
        || receipt.status!==(input.action==="revoke" ? "revoked" : "active") || (input.action!=="revoke" && Date.parse(receipt.ends_at)!==Date.parse(input.endsAt || ""))) throw new Error("membership_response_invalid");
      return receipt;
    },
  };
}
