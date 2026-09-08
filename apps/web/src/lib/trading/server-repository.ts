import "server-only";
import type { TradingLeaderboardEntry } from "@wavekb/domain";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function listTradingLeaderboard(limit = 50): Promise<TradingLeaderboardEntry[]> {
  if (!publicSupabaseConfig().configured) return [];
  const client = await createClient();
  const result = await client.rpc("list_trading_leaderboard", { p_period: "realtime", p_limit: Math.min(Math.max(limit, 3), 100) });
  if (result.error) return [];
  return (result.data ?? []).map((item: Record<string, unknown>) => ({
    ...item,
    rank_no: Number(item.rank_no || 0),
    public_uid: Number(item.public_uid || 0),
    return_rate: Number(item.return_rate || 0),
    sample_count: Number(item.sample_count || 0),
  })) as TradingLeaderboardEntry[];
}
