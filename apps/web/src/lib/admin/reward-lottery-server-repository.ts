import "server-only";
import { requireAdminActor } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import type { AdminRewardLotteryStore } from "./reward-lottery-types";
import { normalizeAdminRewardLottery } from "./reward-lottery-client-repository";

export async function getAdminRewardLottery(): Promise<AdminRewardLotteryStore> {
  const actor = await requireAdminActor("/admin/rewards");
  if (!actor) throw new Error("admin_required");
  const client = await createClient();
  const result = await client.rpc("admin_get_reward_lottery");
  if (result.error) throw result.error;
  return normalizeAdminRewardLottery(result.data);
}
