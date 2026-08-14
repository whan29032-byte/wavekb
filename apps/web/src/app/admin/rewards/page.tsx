import type { Metadata } from "next";
import { Coins } from "@phosphor-icons/react/dist/ssr";
import { AdminRewards } from "@/components/admin-rewards";
import { requireAdminActor } from "@/lib/admin/auth";
import { getAdminRewardStore } from "@/lib/admin/rewards-server-repository";

export const metadata: Metadata = { title: "积分商城管理" };

export default async function AdminRewardsPage() {
  const actor = await requireAdminActor("/admin/rewards");
  if (!actor) return null;
  const store = await getAdminRewardStore();
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Coins aria-hidden size={18} weight="duotone" />数据库管理员操作</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">积分商城</h1><p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">管理商品、库存、铭牌授权与兑换订单。用户积分调整已经归入“用户管理”。</p></header><AdminRewards actorId={actor.id} initialStore={store} /></main>;
}
