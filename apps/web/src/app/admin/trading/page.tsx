import type { Metadata } from "next";
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr";
import { AdminTradingConnections } from "@/components/admin-trading-connections";
import { requireAdminActor } from "@/lib/admin/auth";
import { listAdminTradingConnections } from "@/lib/admin/server-repository";

export const metadata: Metadata = { title: "交易排行治理" };

export default async function AdminTradingPage() {
  const actor = await requireAdminActor("/admin/trading");
  if (!actor) return null;
  const connections = await listAdminTradingConnections();
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><ChartLineUp aria-hidden size={18} weight="duotone" />只读账户连接治理</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">交易排行</h1><p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">查看连接状态、公开范围与同步异常，并为排行榜设置公开显示余额。后台不显示真实账户余额、仓位或订单；自定义值只影响排行榜展示，不参与收益率计算。</p></header><AdminTradingConnections connections={connections} /></main>;
}
