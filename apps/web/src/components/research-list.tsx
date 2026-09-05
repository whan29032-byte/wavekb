import Link from "next/link";
import { ArrowRight, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { ResearchView } from "@/lib/tline/presentation";

export function ResearchDate({ date }: { date: string | null }) {
  return date ? <time dateTime={date}>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(date))}</time> : <span>未提供发布日期</span>;
}

export function ResearchList({ items }: { items: ResearchView[] }) {
  if (!items.length) return <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">当前页没有研报。若有下一页，可继续查看；不会使用示例数据填充。</p>;
  return <div className="divide-y rounded-xl border bg-surface">{items.map((item, index) => <article key={item.id || index} className="grid gap-3 p-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6 sm:p-6">
    <div className="flex flex-wrap items-baseline gap-2 text-xs leading-6 sm:block"><strong className="block break-words text-sm font-semibold text-primary">{item.institution}</strong><span className="text-muted-foreground"><ResearchDate date={item.date} /></span></div>
    <div className="min-w-0"><h2 className="break-words text-lg font-semibold leading-7">{item.id ? <Link prefetch={false} href={`/research/${encodeURIComponent(item.id)}`} className="hover:text-primary focus-visible:rounded focus-visible:outline-2 focus-visible:outline-primary">{item.title}</Link> : item.title}</h2>{item.summary ? <p className="mt-2 line-clamp-3 break-words text-sm leading-7 text-muted-foreground">{item.summary}</p> : null}{item.id ? <Link prefetch={false} href={`/research/${encodeURIComponent(item.id)}`} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">阅读研报<ArrowRight aria-hidden size={16} /></Link> : null}</div>
  </article>)}</div>;
}

export function ResearchArticle({ item }: { item: ResearchView }) {
  return <article className="min-w-0">
    <header className="border-b pb-7"><div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><strong className="text-primary">{item.institution}</strong><ResearchDate date={item.date} /></div><h1 className="mt-4 break-words text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{item.title}</h1></header>
    <div className="grid gap-8 py-8 text-sm leading-8">
      {item.summary ? <section><h2 className="mb-2 text-lg font-semibold">研报摘要</h2><p className="whitespace-pre-wrap break-words">{item.summary}</p></section> : <p className="text-muted-foreground">数据源未提供摘要。</p>}
      {[["核心论点", item.arguments], ["风险提示", item.risks]].map(([title, points]) => (points as string[]).length ? <section key={title as string}><h2 className="mb-2 text-lg font-semibold">{title}</h2><ul className="list-disc space-y-2 pl-5">{(points as string[]).map((point, index) => <li key={index} className="break-words">{point}</li>)}</ul></section> : null)}
      {item.numbers.length ? <section><h2 className="mb-3 text-lg font-semibold">关键数据</h2><dl className="divide-y rounded-lg border bg-surface px-4">{item.numbers.map((number, index) => <div key={index} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-3"><dt className="text-muted-foreground">{number.label}</dt><dd className="font-semibold tabular-nums">{number.value}</dd></div>)}</dl></section> : null}
      {item.interpretation ? <section><h2 className="mb-2 text-lg font-semibold">数据源解读</h2><p className="whitespace-pre-wrap break-words">{item.interpretation}</p></section> : null}
    </div>
    <footer className="border-t pt-5 text-xs leading-6 text-muted-foreground"><p>内容由 Tline API 提供，按源数据展示。机构观点及数据源解读不代表 WaveKB 立场，不构成投资建议。</p>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline">核对机构原文<ArrowSquareOut aria-hidden size={15} /></a> : null}</footer>
  </article>;
}
