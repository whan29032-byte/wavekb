import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Robot } from "@phosphor-icons/react/dist/ssr";
import { AiConnections } from "@/components/ai-connections";
import { requireActiveMember } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "AI 模型" };

export default async function WorkbenchAiPage() {
  await requireActiveMember("/workbench/ai");
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <Link href="/workbench" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回交易工作台</Link>
      <header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Robot aria-hidden size={18} weight="duotone" />AI 控制中心</span><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">连接你想使用的模型</h1><p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">模型选择权归你。网站内置第10版知识库、硬规则闸门和分析记录继续由 WaveKB 管理。</p></header>
      <AiConnections />
    </main>
  );
}
