import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@wavekb/ui";
import { ResearchList } from "@/components/research-list";
import { readResearchCollection } from "@/lib/tline/server";
import { researchWindow } from "@/lib/tline/presentation";
import { directoryQuery, researchDirectory } from "@/lib/tline/directory";

export const metadata: Metadata = { title: "机构研报", description: "在 WaveKB 阅读 Tline 提供的近期机构研报与研究摘要。" };
export const dynamic = "force-dynamic";

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let window;
  let query;
  try { window = researchWindow(params); query = directoryQuery(params); } catch {
    return <main className="mx-auto max-w-5xl px-4 py-12"><h1 className="text-2xl font-semibold">机构研报</h1><p role="alert" className="my-4 text-sm">分页窗口无效或搜索条件有误，请重新查看最近 7 天。</p><Link href="/research" className="text-primary underline">重新打开研报</Link></main>;
  }
  const result = await readResearchCollection(window.since);
  const directory = researchDirectory(result.data, result.institutions, query);
  const href = (page: number) => `/research?${new URLSearchParams({ since: window.since, ...(query.q ? { q: query.q } : {}), ...(query.institution ? { institution: query.institution } : {}), page: String(page) })}`;
  const reset = `/research?${new URLSearchParams({ since: window.since })}`;
  return <main className="mx-auto grid max-w-5xl gap-6 px-4 py-9 md:px-6 md:py-12">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Tline · Research</p><h1 className="text-3xl font-semibold tracking-tight">机构研报</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">搜索最近 7 天进入数据源的机构研究、观点与相关资产，中文优先，全文分析在站内阅读。</p></div><Button asChild variant="secondary"><Link prefetch={false} href="/research">刷新最近研报</Link></Button></header>
    <form key={JSON.stringify([window.since, query.q, query.institution])} action="/research" role="search" aria-label="研报搜索与筛选" className="grid items-end gap-3 rounded-xl border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,15rem)_auto]">
      <input type="hidden" name="since" value={window.since} />
      <label className="grid min-w-0 gap-2 text-sm font-medium">搜索研报内容<input type="search" name="q" defaultValue={query.q} maxLength={200} placeholder="标题、机构、摘要或资产代码" className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base font-normal text-foreground focus-visible:outline-2 focus-visible:outline-primary" /></label>
      <label className="grid min-w-0 gap-2 text-sm font-medium">研究机构<select name="institution" defaultValue={query.institution} className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base font-normal text-foreground focus-visible:outline-2 focus-visible:outline-primary"><option value="">全部机构</option>{directory.institutionOptions.map((institution) => <option key={institution.slug} value={institution.slug}>{institution.name}</option>)}{query.institution && !directory.institutionOptions.some((item) => item.slug === query.institution) ? <option value={query.institution}>当前机构（暂无研报）</option> : null}</select></label>
      <Button type="submit" className="min-h-11">搜索研报</Button>
      <p className="text-xs leading-6 text-muted-foreground sm:col-span-3">覆盖此时间窗口全部 {directory.available} 篇，不限当前页；支持中英文内容和资产代码。多个关键词按同时匹配搜索。</p>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm text-muted-foreground"><p role="status">本页 {directory.items.length} 篇 · {query.q || query.institution ? "匹配" : "共"} {directory.total} 篇 · 每页 30 篇</p>{query.q || query.institution ? <Link prefetch={false} href={reset} className="inline-flex min-h-11 items-center text-primary hover:underline">清除筛选</Link> : <span className="text-xs">数据源共 {result.institutions.length} 家机构</span>}</div>
    {directory.items.length ? <ResearchList items={directory.items} /> : <section className="rounded-xl border border-dashed px-5 py-10"><h2 className="font-semibold">没有匹配的研报</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">试试更短的关键词、资产代码（如 SPX），或清除机构筛选。搜索范围为当前最近 7 天时间窗口。</p><Link prefetch={false} href={reset} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">查看全部研报</Link></section>}
    <nav aria-label="研报分页" className="flex flex-wrap items-center justify-between gap-3">
      <Button asChild={directory.page > 1} variant="secondary" disabled={directory.page === 1}>{directory.page > 1 ? <Link prefetch={false} href={href(directory.page - 1)}>上一页研报</Link> : "上一页研报"}</Button>
      <span className="text-sm tabular-nums text-muted-foreground">第 {directory.page} / {directory.pages} 页</span>
      <Button asChild={directory.page < directory.pages} variant="secondary" disabled={directory.page === directory.pages}>{directory.page < directory.pages ? <Link prefetch={false} href={href(directory.page + 1)}>下一页研报</Link> : "下一页研报"}</Button>
    </nav>
    <p className="text-xs leading-6 text-muted-foreground">增量起点：{new Date(window.since).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）。数据最多缓存 1 分钟。第三方研究仅供参考，不构成投资建议。</p>
  </main>;
}
