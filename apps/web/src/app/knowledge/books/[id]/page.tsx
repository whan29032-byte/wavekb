
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowSquareOut, CaretDown, FilePdf } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { knowledgeData } from "@wavekb/knowledge";
import { BookSearch } from "@/components/book-search";
import { getKnowledgeBook, getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import { buildBookReadingModel } from "@/lib/knowledge/book-reading";
import { publicMetadata } from "@/lib/seo";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string | string[]; section?: string | string[] }>;
};
export const dynamicParams = false;
export function generateStaticParams() { return getKnowledgeBookCatalog().map((book) => ({ id: book.id })); }
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const book = getKnowledgeBook((await params).id);
  return book ? publicMetadata({ title: book.title, description: book.description, path: `/knowledge/books/${book.id}`, type: "article" }) : {};
}

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

export default async function KnowledgeBookDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const queryParams = await searchParams;
  const rawQuery = queryParams?.q;
  const rawSection = queryParams?.section;
  const initialQuery = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery || "").slice(0, 80);
  const requestedSection = Array.isArray(rawSection) ? rawSection[0] : rawSection;
  const activeCoreSection = requestedSection === "themes" || requestedSection === "questions" || requestedSection === "chapters" ? requestedSection : null;
  const model = buildBookReadingModel(id, knowledgeData());
  if (!model) notFound();
  const { book, content } = model;

  return <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-6 md:py-14">
    <Link href="/knowledge" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回知识库</Link>
    <header className="grid gap-6 border-b pb-8 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
      <div className="relative aspect-[.71] w-36 overflow-hidden rounded-lg border bg-muted sm:w-auto"><Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="10rem" className="object-contain" /></div>
      <div className="grid gap-4"><span className={`text-sm font-semibold ${book.kind === "core" ? "text-primary" : "text-muted-foreground"}`}>{book.label} · {book.edition}</span><h1 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{book.title}</h1><p className="max-w-[64ch] text-base leading-7 text-muted-foreground">{book.description}</p><div className="flex flex-wrap gap-3"><a href={model.hero.primaryHref} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">{model.hero.primaryLabel}<ArrowRight aria-hidden size={16} /></a>{model.sourceArtifact ? <a href={model.sourceArtifact.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-muted"><FilePdf aria-hidden size={18} />查看 {model.sourceArtifact.label}<ArrowSquareOut aria-hidden size={15} /></a> : null}</div></div>
    </header>

    {book.kind === "core" ? <p className="text-sm tabular-nums text-muted-foreground"><strong className="text-foreground">{book.verifiedUnitCount} 个已核验 Units</strong>；来源：{book.edition}，按原书章节、页码和主题整理。</p> : <p className="text-sm text-muted-foreground">这是扩展资料的可检索阅读视图，不是已核验 Units 或原书章节。</p>}
    <BookSearch bookId={book.id} items={model.searchDocuments} initialQuery={initialQuery} />

    {book.kind === "core" ? <nav className="grid gap-4" aria-labelledby="core-book-content-title">
      <header className="grid gap-1"><h2 id="core-book-content-title" className="text-2xl font-semibold tracking-tight">本书内容</h2><p className="text-sm leading-6 text-muted-foreground">按主题、实际问题或原书目录进入；列表默认收起，需要时再展开。</p></header>
      <div className="divide-y border-y">
        <details id="core-themes" open={activeCoreSection === "themes"} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden"><span><strong className="block text-base">主题学习</strong><span className="mt-1 block text-xs text-muted-foreground">{content.themes.length} 个主题 · 按知识条目组织</span></span><CaretDown aria-hidden size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-x-8 border-t pb-2 sm:grid-cols-2">{content.themes.map((theme) => <Link key={theme.id} href={`/knowledge/themes/${theme.id}`} className="flex items-center justify-between gap-3 border-b py-3 text-sm hover:text-primary"><span><strong className="block">{theme.title}</strong><span className="text-xs text-muted-foreground">{theme.count} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link>)}</div>
        </details>
        <details id="core-questions" open={activeCoreSection === "questions"} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden"><span><strong className="block text-base">问题解答</strong><span className="mt-1 block text-xs text-muted-foreground">{content.questions.length} 条判断路径 · 连接规则、证据和失效管理</span></span><CaretDown aria-hidden size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-x-8 border-t md:grid-cols-2">{content.questions.map((question) => <Link key={question.id} href={`/knowledge/questions/${question.id}`} className="flex items-start justify-between gap-4 border-b py-4 hover:text-primary"><span><strong className="block text-sm leading-6">{question.question}</strong><span className="text-xs text-muted-foreground">{question.requiredCount} 个必读 · {question.optionalCount} 个辅助</span></span><ArrowRight aria-hidden size={16} className="mt-1 shrink-0" /></Link>)}</div>
        </details>
        <details id="core-chapters" open={activeCoreSection === "chapters"} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden"><span><strong className="block text-base">原书目录</strong><span className="mt-1 block text-xs text-muted-foreground">{content.chapters.length} 个章节 · 按第10版顺序阅读</span></span><CaretDown aria-hidden size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-x-8 border-t sm:grid-cols-2 md:grid-cols-3">{content.chapters.map((chapter) => <Link key={chapter.id} href={`/knowledge/chapters/${chapter.id}`} className="flex items-center justify-between gap-3 border-b py-3 text-sm hover:text-primary"><span><strong className="block">{chapter.title}</strong><span className="text-xs text-muted-foreground">{chapter.count} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link>)}</div>
        </details>
      </div>
    </nav> : <>
      <section className="grid gap-4" aria-labelledby="reading-options-title"><h2 id="reading-options-title" className="text-2xl font-semibold tracking-tight">阅读方式</h2><div className="grid gap-x-8 md:grid-cols-2">{model.readingOptions.map((option) => <a key={option.title} href={option.href} className="flex items-start justify-between gap-4 border-t py-4 hover:text-primary"><span><strong className="block text-sm">{option.title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span><ArrowRight aria-hidden size={16} className="mt-0.5 shrink-0" /></a>)}</div></section>
      <nav className="grid gap-2 border-y py-4 sm:grid-cols-2" aria-label="本书导航"><div className="sm:col-span-2"><strong className="text-sm">生成页面导航</strong><span className="ml-2 text-xs text-muted-foreground">由蒸馏 PDF 页码生成，不是已核验章节。</span></div>{model.navigationEntries.map((entry) => <a key={entry.href} href={entry.href} className="text-sm text-muted-foreground hover:text-primary">{entry.generated ? "生成 · " : ""}{entry.title}</a>)}</nav>
    </>}

    {content.readingGuide.length ? <section id="reading-guide" className="grid gap-4"><h2 className="text-2xl font-semibold tracking-tight">阅读导览</h2><div className="divide-y border-y">{content.readingGuide.map((item, index) => <article key={item.title} className="grid gap-2 py-5"><span className="text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><h3 className="text-lg font-semibold">{item.title}</h3><p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">{item.description}</p></article>)}</div></section> : null}
    {content.topics.length ? <section id="topics" className="grid gap-4"><h2 className="text-2xl font-semibold tracking-tight">主题</h2><div className="grid gap-x-8 sm:grid-cols-2">{content.topics.map((topic) => <div key={topic} className="border-t py-3 text-sm font-medium">{topic}</div>)}</div></section> : null}
    {content.pages.length ? <section id="book-text" className="grid gap-4"><header className="grid gap-1"><h2 className="text-2xl font-semibold tracking-tight">网页正文</h2><p className="text-sm leading-6 text-muted-foreground">正文按蒸馏 PDF 页码转换，方便搜索与核对；复杂表格和图形请查看 WaveKB 蒸馏 PDF。</p></header><div className="divide-y border-y">{content.pages.map((page) => <section id={`page-${page.page}`} key={page.page} className="scroll-mt-24 py-7"><h3 className="mb-4 text-xs font-semibold tabular-nums text-primary">第 {page.page} 页</h3><p className="whitespace-pre-line text-[1.04rem] leading-8 text-foreground/90">{page.text}</p></section>)}</div></section> : null}
    {model.boundaries.length ? <section id="boundaries" className="grid gap-4"><h2 className="text-2xl font-semibold tracking-tight">使用边界</h2><ul className="grid max-w-[76ch] gap-2 pl-5 text-base leading-7 text-foreground/90">{model.boundaries.map((item) => <li key={item} className="list-disc pl-1 marker:text-primary">{item}</li>)}</ul></section> : null}
  </main>;
}
