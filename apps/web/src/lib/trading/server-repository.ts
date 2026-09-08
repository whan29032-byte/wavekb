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
    rank_no: Number(item.rank_no || 0),
    user_id: String(item.user_id || ""),
    public_uid: Number(item.public_uid || 0),
    display_name: String(item.display_name || ""),
    avatar_url: item.avatar_url ? String(item.avatar_url) : null,
    display_title: String(item.display_title || ""),
    nameplate_style: String(item.nameplate_style || "classic"),
    return_rate: Number(item.return_rate || 0),
    current_equity_usdt: String(item.current_equity_usdt ?? "0"),
    cumulative_profit_usdt: String(item.cumulative_profit_usdt ?? "0"),
    tracking_started_at: String(item.tracking_started_at || ""),
    last_synced_at: String(item.last_synced_at || ""),
  })) as TradingLeaderboardEntry[];
}
