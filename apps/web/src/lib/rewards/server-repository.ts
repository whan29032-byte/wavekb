import "server-only";
import type { RewardCenter, RewardLeaderboardEntry } from "@wavekb/domain";
import { createClient } from "@/lib/supabase/server";

export async function getMyRewardCenter(): Promise<RewardCenter> {
  const client = await createClient();
  const result = await client.rpc("get_my_reward_center");
  if (result.error) throw result.error;
  const value = (result.data || {}) as Partial<RewardCenter>;
  return {
    wallet: {
      balance: Number(value.wallet?.balance || 0),
      lifetime_earned: Number(value.wallet?.lifetime_earned || 0),
    },
    checked_today: Boolean(value.checked_today),
    streak: Number(value.streak || 0),
    products: Array.isArray(value.products) ? value.products : [],
    nameplates: Array.isArray(value.nameplates) ? value.nameplates : [],
    ledger: Array.isArray(value.ledger) ? value.ledger : [],
  };
}

export async function listRewardLeaderboard(limit = 20): Promise<RewardLeaderboardEntry[]> {
  const client = await createClient();
  const result = await client.rpc("list_reward_leaderboard", { p_limit: Math.min(Math.max(Number(limit || 20), 3), 50) });
  if (result.error) throw result.error;
  return (result.data ?? []).map((item: Record<string, unknown>) => ({
    ...item,
    rank_no: Number(item.rank_no || 0),
    balance: Number(item.balance || 0),
    lifetime_earned: Number(item.lifetime_earned || 0),
  })) as RewardLeaderboardEntry[];
}
