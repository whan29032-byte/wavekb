import "server-only";
import type { RewardLotteryState } from "@wavekb/domain";
import { createClient } from "@/lib/supabase/server";
import { normalizeRewardLotteryState } from "./lottery-client-repository";

export async function getMyRewardLottery(): Promise<RewardLotteryState | null> {
  const client = await createClient();
  const result = await client.rpc("get_my_reward_lottery");
  if (result.error) throw result.error;
  return normalizeRewardLotteryState(result.data);
}
