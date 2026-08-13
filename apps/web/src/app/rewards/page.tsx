import type { Metadata } from "next";
import { RewardCenter } from "@/components/reward-center";
import { requireActiveMember } from "@/lib/auth/dal";
import { getMyRewardCenter, listRewardLeaderboard } from "@/lib/rewards/server-repository";

export const metadata: Metadata = { title: "积分商城", description: "查看研究积分、成长任务、排行榜和可兑换权益。" };

export default async function RewardsPage() {
  const actor = await requireActiveMember("/rewards");
  const [center, leaderboard] = await Promise.all([getMyRewardCenter(), listRewardLeaderboard(20)]);
  return <main className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14"><RewardCenter actorId={actor.id} initialCenter={center} leaderboard={leaderboard} /></main>;
}
