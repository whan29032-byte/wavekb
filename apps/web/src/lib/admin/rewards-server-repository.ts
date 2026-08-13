import "server-only";
import { requireAdminActor } from "@/lib/admin/auth";
import type { AdminNameplateEntitlement, AdminRewardProduct, AdminRewardRedemption, AdminRewardStore, AdminRewardWallet } from "@/lib/admin/rewards-types";
import { createClient } from "@/lib/supabase/server";

export async function getAdminRewardStore(): Promise<AdminRewardStore> {
  const actor = await requireAdminActor("/admin/rewards");
  if (!actor) throw new Error("admin_required");
  const client = await createClient();
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
    products: ((catalog.data ?? []) as AdminRewardProduct[]).map((item) => ({ ...item, price_points: Number(item.price_points || 0), stock: Number(item.stock ?? -1), sort_order: Number(item.sort_order || 0) })),
    wallets: ((wallets.data ?? []) as AdminRewardWallet[]).map((item) => ({ ...item, public_uid: item.public_uid == null ? null : Number(item.public_uid), balance: Number(item.balance || 0), lifetime_earned: Number(item.lifetime_earned || 0) })),
    redemptions: ((redemptions.data ?? []) as AdminRewardRedemption[]).map((item) => ({ ...item, public_uid: item.public_uid == null ? null : Number(item.public_uid), quantity: Number(item.quantity || 0), points_spent: Number(item.points_spent || 0) })),
    entitlements: ((entitlements.data ?? []) as AdminNameplateEntitlement[]).map((item) => ({ ...item, public_uid: item.public_uid == null ? null : Number(item.public_uid) })),
  };
}
