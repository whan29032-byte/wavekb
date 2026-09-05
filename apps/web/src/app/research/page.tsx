import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@wavekb/ui";
import { ResearchList } from "@/components/research-list";
import { readResearchPage } from "@/lib/tline/server";
import { researchView, researchWindow } from "@/lib/tline/presentation";

export const metadata: Metadata = { title: "机构研报", description: "在 WaveKB 阅读 Tline 提供的近期机构研报与研究摘要。" };
export const dynamic = "force-dynamic";

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let window;
  try { window = researchWindow(await searchParams); } catch {
    return <main className="mx-auto max-w-5xl px-4 py-12"><h1 className="text-2xl font-semibold">机构研报</h1><p role="alert" className="my-4 text-sm">分页窗口无效或已过期，请重新查看最近 7 天。</p><Link href="/research" className="text-primary underline">重新打开研报</Link></main>;
  }
  const result = await readResearchPage(window.since, window.cursor);
  const items = result.data.map((row) => researchView(row, result.institutions));
  const next = result.nextCursor ? `/research?${new URLSearchParams({ since: window.since, cursor: result.nextCursor })}` : null;
  return <main className="mx-auto grid max-w-5xl gap-7 px-4 py-9 md:px-6 md:py-12">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Tline · Research</p><h1 className="text-3xl font-semibold tracking-tight">机构研报</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">最近 7 天进入数据源的研究，中文优先。标题、机构与分析均来自 Tline，点击研报可在站内阅读。</p></div><Button asChild variant="secondary"><Link prefetch={false} href="/research">刷新最近研报</Link></Button></header>
    <div className="flex flex-wrap justify-between gap-2 border-b pb-3 text-xs text-muted-foreground"><span>本页 {items.length} 篇 · 数据源共 {result.institutions.length} 家机构</span><span>增量起点 {new Date(window.since).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span></div>
    <ResearchList items={items} />
    <nav aria-label="研报分页" className="flex items-center justify-between gap-4"><span className="text-xs text-muted-foreground">{next ? "按同一时间窗口继续翻页" : "已到当前时间窗口末页"}</span>{next ? <Button asChild variant="secondary"><Link prefetch={false} href={next}>下一页研报</Link></Button> : null}</nav>
    <p className="text-xs leading-6 text-muted-foreground">第三方研究仅供参考，不构成投资建议。数据最多缓存 1 分钟，未提供的内容不会补写。</p>
  </main>;
}
