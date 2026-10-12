import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Robot } from "@phosphor-icons/react/dist/ssr";
import { AiConnections } from "@/components/ai-connections";
import { HermesMemberAiCard } from "@/components/hermes-member-ai-card";
import { requireActiveMember } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "AI 模型" };

export default async function WorkbenchAiPage() {
  await requireActiveMember("/workbench/ai");
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <Link href="/workbench" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回交易工作台</Link>
      <header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Robot aria-hidden size={18} weight="duotone" />AI 控制中心</span><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">选择 AI 分析服务</h1><p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">Hermes 云端研究为会员专属，个人自带 Key 是独立选项。网站以第11版原书为主，第10版资料作为补充；既有规则校验和私人分析记录保持不变。</p></header>
      <HermesMemberAiCard />
      <AiConnections />
    </main>
  );
}
