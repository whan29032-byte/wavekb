import type { SupabaseClient } from "@supabase/supabase-js";
import type { RewardCenter } from "@wavekb/domain";

export type RewardMutationGateway = {
  checkIn(): Promise<{ points: number; balance: number; streak: number }>;
  redeem(productId: string): Promise<{ redemption_id: string; entitlement_id?: string | null; status: string; balance: number }>;
  equip(entitlementId: string): Promise<{ equipped: boolean; style: string; expires_at: string }>;
};

function defaultGateway(client: SupabaseClient): RewardMutationGateway {
  return {
    async checkIn() {
      const result = await client.rpc("reward_daily_checkin");
      if (result.error) throw result.error;
      return result.data;
    },
    async redeem(productId) {
      const result = await client.rpc("redeem_reward_product", { p_product: productId, p_quantity: 1 });
      if (result.error) throw result.error;
      return result.data;
    },
    async equip(entitlementId) {
      const result = await client.rpc("equip_my_nameplate", { p_entitlement: entitlementId });
      if (result.error) throw result.error;
      return result.data;
    },
  };
}

export function rewardMutations(client: SupabaseClient, injectedGateway?: RewardMutationGateway) {
  const gateway = injectedGateway ?? defaultGateway(client);
  return {
    checkIn: () => gateway.checkIn(),
    redeem: (productId: string) => gateway.redeem(productId),
    equip: (entitlementId: string) => gateway.equip(entitlementId),
  };
}

export async function loadRewardCenter(client: SupabaseClient): Promise<RewardCenter> {
  const result = await client.rpc("get_my_reward_center");
  if (result.error) throw result.error;
  const value = (result.data || {}) as Partial<RewardCenter>;
  return {
    wallet: { balance: Number(value.wallet?.balance || 0), lifetime_earned: Number(value.wallet?.lifetime_earned || 0) },
    checked_today: Boolean(value.checked_today),
    streak: Number(value.streak || 0),
    products: Array.isArray(value.products) ? value.products : [],
    nameplates: Array.isArray(value.nameplates) ? value.nameplates : [],
    ledger: Array.isArray(value.ledger) ? value.ledger : [],
  };
}
