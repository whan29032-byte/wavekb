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
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><ChartLineUp aria-hidden size={18} weight="duotone" />只读账户连接治理</span><h1 className="text-3xl font-semibold tracking-[-0.035em]">交易排行</h1><p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">查看连接状态、公开范围与同步异常。后台永远不显示 API 明文、账户余额、仓位或订单；停用会撤销密钥并留下审计记录。</p></header><AdminTradingConnections connections={connections} /></main>;
}
