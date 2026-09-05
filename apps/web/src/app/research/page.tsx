import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@wavekb/ui";
import { ResearchList } from "@/components/research-list";
import { ResearchRefresh } from "@/components/research-refresh";
import { researchView } from "@/lib/tline/presentation";
import { readResearchDirectory } from "@/lib/tline/server";

export const metadata: Metadata = { title: "机构研报", description: "在 WaveKB 阅读已同步保存的近期机构研报与研究摘要。" };
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function localTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function recovery() {
  return <main className="mx-auto max-w-5xl px-4 py-12 md:px-6"><h1 className="text-2xl font-semibold">机构研报</h1><p role="alert" className="my-4 text-sm leading-7">分页窗口无效或搜索条件有误，请重新查看最近 7 天。</p><Link href="/research" className="inline-flex min-h-11 items-center text-primary underline">重新打开研报</Link></main>;
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  let result: Awaited<ReturnType<typeof readResearchDirectory>>;
  try {
    result = await readResearchDirectory(params);
  } catch (error) {
    if (error instanceof Error && /时间窗口|Invalid research filters/.test(error.message)) return recovery();
    throw error;
  }

  const { query, window, state } = result;
  const values = (page: number, filters = true) => ({
    since: window.since,
    until: window.until,
    ...(filters && query.q ? { q: query.q } : {}),
    ...(filters && query.institution ? { institution: query.institution } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  });
  const href = (page: number, filters = true) => `/research?${new URLSearchParams(values(page, filters))}`;
  const latestSearch = new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.institution ? { institution: query.institution } : {}) });
  const latestHref = `/research${latestSearch.size ? `?${latestSearch}` : ""}`;
  const alreadyLatest = params.since === undefined && params.until === undefined && params.page === undefined;
  const reset = href(1, false);

  return <main className="mx-auto grid max-w-5xl gap-6 px-4 py-9 md:px-6 md:py-12">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Tline · Research</p><h1 className="text-3xl font-semibold tracking-tight">机构研报</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">搜索最近 7 天已同步保存的机构研究、观点与相关资产。中文优先，站内展示已保存的摘要与分析字段。</p></div>
      <ResearchRefresh href={latestHref} alreadyLatest={alreadyLatest} />
    </header>

    {!result.initialized ? <section className="rounded-xl border border-dashed bg-surface px-5 py-10" aria-live="polite"><h2 className="font-semibold">研报正在准备</h2><p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">本地研报目录尚未完成首次同步。后台准备完成后，这里会自动提供已保存内容；网站其他功能不受影响。</p></section> : <>
      <section className="grid gap-2 rounded-xl border bg-surface px-4 py-3 text-sm" aria-label="研报同步状态">
        <p><span className="font-medium text-foreground">最近成功同步：</span><span className="text-muted-foreground">{localTime(state.lastSuccess!)}（北京时间）</span></p>
        <p className="text-xs leading-6 text-muted-foreground">后台计划每 10 分钟同步一次；刷新列表只重新读取本地已保存内容。</p>
      </section>
      {result.delayed ? <p role="alert" className="rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm leading-7 text-foreground">研报更新延迟，正在继续展示截至 {localTime(state.lastSuccess!)} 的已保存内容。后台恢复后会按计划更新。</p> : null}

      <form key={JSON.stringify([window.since, window.until, query.q, query.institution])} action="/research" role="search" aria-label="研报搜索与筛选" className="grid items-end gap-3 rounded-xl border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,15rem)_auto]">
        <input type="hidden" name="since" value={window.since} />
        <input type="hidden" name="until" value={window.until} />
        <label className="grid min-w-0 gap-2 text-sm font-medium">搜索研报内容<input type="search" name="q" defaultValue={query.q} maxLength={200} placeholder="标题、机构、摘要或资产代码" className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base font-normal text-foreground focus-visible:outline-2 focus-visible:outline-primary" /></label>
        <label className="grid min-w-0 gap-2 text-sm font-medium">研究机构<select name="institution" defaultValue={query.institution} className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base font-normal text-foreground focus-visible:outline-2 focus-visible:outline-primary"><option value="">全部机构</option>{result.institutionOptions.map((institution) => <option key={institution.slug} value={institution.slug}>{institution.name}</option>)}{query.institution && !result.institutionOptions.some((item) => item.slug === query.institution) ? <option value={query.institution}>当前机构（暂无研报）</option> : null}</select></label>
        <Button type="submit" className="min-h-11">搜索研报</Button>
        <p className="text-xs leading-6 text-muted-foreground sm:col-span-3">覆盖此固定时间窗口全部 {result.available} 篇，不限当前页；支持中英文内容和资产代码。多个关键词按同时匹配搜索。</p>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm text-muted-foreground"><p role="status">本页 {result.data.length} 篇 · {query.q || query.institution ? "匹配" : "共"} {result.total} 篇 · 每页 30 篇</p>{query.q || query.institution ? <Link prefetch={false} href={reset} className="inline-flex min-h-11 items-center text-primary hover:underline">清除筛选</Link> : <span className="text-xs">目录收录 {result.institutions.length} 家机构</span>}</div>

      {result.data.length ? <ResearchList items={result.data.map((row) => researchView(row, result.institutions))} /> : <section className="rounded-xl border border-dashed px-5 py-10"><h2 className="font-semibold">{query.q || query.institution ? "没有匹配的研报" : "暂无已同步研报"}</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">{query.q || query.institution ? "试试更短的关键词、资产代码（如 SPX），或清除机构筛选。搜索范围为当前固定时间窗口。" : "本次同步已成功完成，但当前时间窗口没有可展示的研报。后台会继续按计划检查更新。"}</p>{query.q || query.institution ? <Link prefetch={false} href={reset} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">查看全部研报</Link> : null}</section>}

      <nav aria-label="研报分页" className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild={result.page > 1} variant="secondary" disabled={result.page === 1}>{result.page > 1 ? <Link prefetch={false} href={href(result.page - 1)}>上一页研报</Link> : "上一页研报"}</Button>
        <span className="text-sm tabular-nums text-muted-foreground">第 {result.page} / {result.pages} 页</span>
        <Button asChild={result.page < result.pages} variant="secondary" disabled={result.page === result.pages}>{result.page < result.pages ? <Link prefetch={false} href={href(result.page + 1)}>下一页研报</Link> : "下一页研报"}</Button>
      </nav>
      <p className="text-xs leading-6 text-muted-foreground">固定窗口：{localTime(window.since)} 至 {localTime(window.until)}（北京时间）。第三方研究仅供参考，不构成投资建议。</p>
    </>}
  </main>;
}
