import type { Metadata } from "next";
import { AdminAiCenter } from "@/components/admin-ai-center";
import { requireAdminActor } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "AI 治理" };

export default async function AdminAiPage() {
  const actor = await requireAdminActor("/admin/ai");
  if (!actor) return null;
  return <main className="grid gap-8 p-4 md:p-8"><header className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em]">网站 AI 治理中心</h1><p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">管理员管理网站知识、规则闸门、审计、费用和可选的平台备用接口。用户自带模型仍由用户自己管理。</p></header><AdminAiCenter /></main>;
}
