import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminRewardStore, RewardProductInput } from "@/lib/admin/rewards-types";

export type AdminRewardMutationGateway = {
  upsertProduct(input: RewardProductInput): Promise<string>;
  adjustPoints(userId: string, delta: number, note: string): Promise<{ balance: number; delta: number }>;
  updateRedemption(id: string, status: string, note: string): Promise<void>;
  grantNameplate(userId: string, productId: string, durationDays: number, equip: boolean): Promise<string>;
  revokeNameplate(entitlementId: string): Promise<void>;
};

function defaultGateway(client: SupabaseClient): AdminRewardMutationGateway {
  return {
    async upsertProduct(input) {
      const result = await client.rpc("admin_upsert_reward_product", {
        p_id: input.id || null,
        p_name: input.name.trim(),
        p_summary: input.summary.trim(),
        p_description: input.description.trim(),
        p_image_url: input.imageUrl?.trim() || null,
        p_category: input.category,
        p_product_type: input.productType,
        p_price_points: input.pricePoints,
        p_stock: input.stock,
        p_metadata: input.metadata,
        p_active: input.active,
        p_sort_order: input.sortOrder,
      });
      if (result.error) throw result.error;
      return String(result.data);
    },
    async adjustPoints(userId, delta, note) {
      const result = await client.rpc("admin_adjust_reward_points", { p_user: userId, p_delta: delta, p_note: note.trim() });
      if (result.error) throw result.error;
      return result.data;
    },
    async updateRedemption(id, status, note) {
      const result = await client.rpc("admin_update_reward_redemption", { p_id: id, p_status: status, p_note: note.trim() });
      if (result.error) throw result.error;
    },
    async grantNameplate(userId, productId, durationDays, equip) {
      const result = await client.rpc("admin_grant_nameplate", { p_user: userId, p_product: productId, p_duration_days: durationDays, p_equip: equip });
      if (result.error) throw result.error;
      return String(result.data);
    },
    async revokeNameplate(entitlementId) {
      const result = await client.rpc("admin_revoke_nameplate", { p_entitlement: entitlementId });
      if (result.error) throw result.error;
    },
  };
}

export function adminRewardMutations(client: SupabaseClient, injectedGateway?: AdminRewardMutationGateway) {
  const gateway = injectedGateway ?? defaultGateway(client);
  return {
    upsertProduct: (input: RewardProductInput) => gateway.upsertProduct(input),
    adjustPoints: (userId: string, delta: number, note: string) => gateway.adjustPoints(userId, delta, note),
    updateRedemption: (id: string, status: string, note: string) => gateway.updateRedemption(id, status, note),
    grantNameplate: (userId: string, productId: string, durationDays: number, equip: boolean) => gateway.grantNameplate(userId, productId, durationDays, equip),
    revokeNameplate: (entitlementId: string) => gateway.revokeNameplate(entitlementId),
  };
}

export async function loadAdminRewardStore(client: SupabaseClient): Promise<AdminRewardStore> {
  const [catalog, wallets, redemptions, entitlements] = await Promise.all([
    client.rpc("admin_list_reward_catalog"),
    client.rpc("admin_list_reward_wallets"),
    client.rpc("admin_list_reward_redemptions"),
    client.rpc("admin_list_nameplate_entitlements"),
  ]);
  for (const result of [catalog, wallets, redemptions, entitlements]) {
    if (result.error) throw result.error;
  }
  return {
    products: catalog.data ?? [],
    wallets: wallets.data ?? [],
    redemptions: redemptions.data ?? [],
    entitlements: entitlements.data ?? [],
  } as AdminRewardStore;
}
