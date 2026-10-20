import type { Metadata } from "next";
import { Coins } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@wavekb/ui";
import { AdminRewards } from "@/components/admin-rewards";
import { AdminRewardLottery } from "@/components/admin-reward-lottery";
import { requireAdminActor } from "@/lib/admin/auth";
import { getAdminRewardStore } from "@/lib/admin/rewards-server-repository";
import { getAdminRewardLottery } from "@/lib/admin/reward-lottery-server-repository";

export const metadata: Metadata = { title: "积分商城管理" };

export default async function AdminRewardsPage() {
  const actor = await requireAdminActor("/admin/rewards");
  if (!actor) return null;
  const [store, lottery] = await Promise.all([getAdminRewardStore(), getAdminRewardLottery()]);
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><PageHeader eyebrow="Commerce & rewards" title="积分商城" description="管理抽奖活动、独立奖池、商品、库存、铭牌授权与兑换订单。用户积分调整已经归入用户管理。" icon={<Coins aria-hidden size={18} weight="duotone" className="text-primary" />} /><AdminRewardLottery actorId={actor.id} initialStore={lottery} /><AdminRewards actorId={actor.id} initialStore={store} /></main>;
}
