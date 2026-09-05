import type { Metadata } from "next";
import Link from "next/link";
import { ChartLineUp, LockKey, Plus, Robot } from "@phosphor-icons/react/dist/ssr";
import { PRIVATE_ENTRY_KINDS, plainTextExcerpt, type PrivateEntryKind } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { requireActiveMember } from "@/lib/auth/dal";
import { listPrivateEntries, listWorkbenchAnalyses } from "@/lib/workbench/server-repository";
import { Pagination } from "@/components/pagination";
import { paginationHref, parsePage } from "@/lib/pagination";

export const metadata: Metadata = { title: "交易工作台" };

const filters: Array<{ value: "all" | PrivateEntryKind; label: string }> = [
  { value: "all", label: "全部记录" },
  { value: "review", label: "复盘" },
  { value: "journal", label: "交易日记" },
  { value: "draft", label: "研究草稿" },
];

const kindLabels: Record<PrivateEntryKind, string> = { review: "复盘", journal: "交易日记", draft: "研究草稿" };

export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ type?: string | string[]; page?: string | string[]; analysisPage?: string | string[] }> }) {
  const actor = await requireActiveMember("/workbench");
  const params = await searchParams;
  const kind = typeof params.type === "string" && PRIVATE_ENTRY_KINDS.has(params.type as PrivateEntryKind) ? params.type as PrivateEntryKind : undefined;
  const entryPage = parsePage(params.page);
  const analysisPage = parsePage(params.analysisPage);
  const [entryResult, analysisResult] = await Promise.all([listPrivateEntries(actor.id, kind, entryPage), listWorkbenchAnalyses(actor.id, analysisPage)]);
  const entries = entryResult.items;
  const analyses = analysisResult.items;
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><LockKey aria-hidden size={18} weight="duotone" />仅当前账号可见</span><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">交易工作台</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">集中保存分析流程、复盘、交易日记和研究草稿。公开发布会生成独立副本，不会暴露私人核验字段。</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="secondary"><Link href="/workbench/ai"><Robot aria-hidden size={18} />AI 模型</Link></Button><Button asChild><Link href="/workbench/analysis/new?step=0"><ChartLineUp aria-hidden size={18} />新建分析</Link></Button><Button asChild size="large"><Link href="/workbench/entries/new?kind=review"><Plus aria-hidden size={18} />新建记录</Link></Button></div></header>

      <section className="grid gap-4" aria-labelledby="analysis-list-title"><div className="flex items-end justify-between gap-4"><div><h2 id="analysis-list-title" className="text-xl font-semibold">分析流程</h2><p className="mt-1 text-sm text-muted-foreground">11 步结构分析、硬规则检查、风险计算与 AI 候选任务。</p></div><span className="text-sm text-muted-foreground">本页 {analyses.length} 条</span></div>{analyses.length ? <div className="grid gap-3 sm:grid-cols-2">{analyses.map((analysis) => <Link key={analysis.id} href={`/workbench/analysis/${analysis.id}?step=0`} className="grid gap-3 rounded-xl border bg-surface p-5 hover:border-primary/45"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{analysis.execution_status}</span><span className="text-xs text-muted-foreground">{analysis.market}</span></div><h3 className="font-semibold">{analysis.instrument} · {analysis.primary_timeframe}</h3><p className="text-xs text-muted-foreground">更新于 {new Date(analysis.updated_at).toLocaleString("zh-CN")}</p></Link>)}</div> : <div className="rounded-xl border border-dashed bg-surface p-6 text-sm text-muted-foreground">{analysisPage > 1 ? "本页没有分析流程，请返回上一页。" : "还没有结构分析。新建后可逐步记录环境、级别、规则、风险、执行和复盘。"}</div>}<Pagination page={analysisResult.page} hasNext={analysisResult.hasNext} pathname="/workbench" pageKey="analysisPage" query={{ type: kind, page: entryPage > 1 ? entryPage : undefined }} /></section>

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="私人记录类型">{filters.map((filter) => { const selected = (kind || "all") === filter.value; return <Link key={filter.value} href={paginationHref("/workbench", 1, { type: filter.value === "all" ? undefined : filter.value, analysisPage: analysisPage > 1 ? analysisPage : undefined })} aria-current={selected ? "page" : undefined} className={`rounded-lg border px-3 py-2.5 text-center text-sm font-medium ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:border-primary/45 hover:text-foreground"}`}>{filter.label}</Link>; })}</nav>

      {entries.length ? <section className="grid gap-3" aria-label="私人记录列表">{entries.map((entry) => <Link key={entry.id} href={`/workbench/entries/${entry.id}`} className="grid gap-3 rounded-xl border bg-surface p-5 hover:border-primary/45 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{kindLabels[entry.kind]}</span>{entry.market ? <span className="text-xs text-muted-foreground">{entry.market}</span> : null}{entry.instrument ? <span className="text-xs font-medium">{entry.instrument}</span> : null}{entry.timeframe ? <span className="text-xs text-muted-foreground">{entry.timeframe}</span> : null}</div><h2 className="mt-3 truncate text-lg font-semibold">{entry.title}</h2><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{plainTextExcerpt(entry.body, 180) || "尚未填写正文"}</p></div><time className="text-xs tabular-nums text-muted-foreground" dateTime={entry.updated_at}>更新于 {new Date(entry.updated_at).toLocaleDateString("zh-CN")}</time></Link>)}</section> : <section className="grid place-items-center gap-4 rounded-xl border border-dashed bg-surface px-5 py-14 text-center"><div className="grid size-12 place-items-center rounded-xl bg-muted text-primary"><LockKey aria-hidden size={24} weight="duotone" /></div><div><h2 className="font-semibold">{entryPage > 1 ? "本页没有私人记录" : `还没有${kind ? kindLabels[kind] : "私人记录"}`}</h2><p className="mt-1 text-sm text-muted-foreground">{entryPage > 1 ? "请返回上一页查看较新的记录。" : "从一次真实判断开始，之后可以继续编辑或整理成公开副本。"}</p></div><Button asChild variant="secondary"><Link href={`/workbench/entries/new?kind=${kind || "review"}`}>{entryPage > 1 ? "创建记录" : "创建第一条记录"}</Link></Button></section>}
      <Pagination page={entryResult.page} hasNext={entryResult.hasNext} pathname="/workbench" query={{ type: kind, analysisPage: analysisPage > 1 ? analysisPage : undefined }} />
    </main>
  );
}
