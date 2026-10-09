
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowSquareOut, CaretDown, FilePdf } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { knowledgeData } from "@wavekb/knowledge";
import { BookSearch } from "@/components/book-search";
import { BookPageNavigation } from "@/components/book-page-navigation";
import { BookReadingLink } from "@/components/book-reading-link";
import { KnowledgeBookText } from "@/components/knowledge-book-text";
import { KnowledgeOriginalPage } from "@/components/knowledge-original-page";
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
  const originalSource = book.kind === "extension" && book.source.source_kind === "original_pdf" ? book.source : null;
  const illustrationCount = content.pages.reduce((count, page) => count + (page.illustrations?.length || 0), 0);

  return <main className="mx-auto grid min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 py-10 md:px-6 md:py-14">
    <Link href="/knowledge" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回知识库</Link>
    <header className="grid gap-6 border-b pb-8 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
      <div className="relative aspect-[.71] w-36 overflow-hidden rounded-lg border bg-muted sm:w-auto"><Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="10rem" className="object-contain" /></div>
      <div className="grid gap-4"><span className={`text-sm font-semibold ${book.role === "core" ? "text-primary" : "text-muted-foreground"}`}>{book.label} · {book.edition}</span><h1 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{book.title}</h1><p className="max-w-[64ch] text-base leading-7 text-muted-foreground">{book.description}</p><div className="flex flex-wrap gap-3"><BookReadingLink href={model.hero.primaryHref} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{model.hero.primaryLabel}<ArrowRight aria-hidden size={16} /></BookReadingLink>{model.sourceArtifact ? <a href={model.sourceArtifact.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-muted"><FilePdf aria-hidden size={18} />查看 {model.sourceArtifact.label}<ArrowSquareOut aria-hidden size={15} /></a> : null}</div></div>
    </header>

    {book.kind === "core" ? <p className="text-sm tabular-nums text-muted-foreground"><strong className="text-foreground">{book.verifiedUnitCount} 个已核验 Units</strong>；保留第10版与第11版来源条目，实际版次与页码逐条标注。这是补充与版本对照集合，不是第11版全文。</p> : <p className="text-sm text-muted-foreground">{originalSource ? `第${originalSource.edition}版原书共${content.pages.length}个 PDF 页面；文字来自原书文本层，未逐页人工复核。含图表的原页按需展开，本阅读视图不是117个已核验 Units。` : "这是扩展资料的可检索阅读视图，不是已核验 Units 或原书章节。"}</p>}
    <BookSearch bookId={book.id} items={model.searchDocuments} initialQuery={initialQuery} />

    {book.kind === "core" ? <nav className="grid gap-4" aria-labelledby="core-book-content-title">
      <header className="grid gap-1"><h2 id="core-book-content-title" className="text-2xl font-semibold tracking-tight">本书内容</h2><p className="text-sm leading-6 text-muted-foreground">按主题、实际问题或原书目录进入；列表默认收起，需要时再展开。</p></header>
      <div className="divide-y border-y">
        <details id="core-themes" open={activeCoreSection === "themes"} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden"><span><strong className="block text-base">主题学习</strong><span className="mt-1 block text-xs text-muted-foreground">{content.themes.length} 个主题 · 按知识条目组织</span></span><CaretDown aria-hidden size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-x-8 border-t pb-2 sm:grid-cols-2">{content.themes.map((theme) => <Link prefetch={false} key={theme.id} href={`/knowledge/themes/${theme.id}`} className="flex min-h-11 items-center justify-between gap-3 border-b py-3 text-sm hover:text-primary"><span><strong className="block">{theme.title}</strong><span className="text-xs text-muted-foreground">{theme.count} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link>)}</div>
        </details>
        <details id="core-questions" open={activeCoreSection === "questions"} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden"><span><strong className="block text-base">问题解答</strong><span className="mt-1 block text-xs text-muted-foreground">{content.questions.length} 条判断路径 · 连接规则、证据和失效管理</span></span><CaretDown aria-hidden size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-x-8 border-t md:grid-cols-2">{content.questions.map((question) => <Link prefetch={false} key={question.id} href={`/knowledge/questions/${question.id}`} className="flex min-h-11 items-start justify-between gap-4 border-b py-4 hover:text-primary"><span><strong className="block text-sm leading-6">{question.question}</strong><span className="text-xs text-muted-foreground">{question.requiredCount} 个必读 · {question.optionalCount} 个辅助</span></span><ArrowRight aria-hidden size={16} className="mt-1 shrink-0" /></Link>)}</div>
        </details>
        <details id="core-chapters" open={activeCoreSection === "chapters"} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden"><span><strong className="block text-base">原书目录</strong><span className="mt-1 block text-xs text-muted-foreground">{content.chapters.length} 个章节 · 原有章节索引与版本对照</span></span><CaretDown aria-hidden size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-x-8 border-t sm:grid-cols-2 md:grid-cols-3">{content.chapters.map((chapter) => <Link prefetch={false} key={chapter.id} href={`/knowledge/chapters/${chapter.id}`} className="flex min-h-11 items-center justify-between gap-3 border-b py-3 text-sm hover:text-primary"><span><strong className="block">{chapter.title}</strong><span className="text-xs text-muted-foreground">{chapter.count} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link>)}</div>
        </details>
      </div>
    </nav> : <>
      <section className="grid gap-4" aria-labelledby="reading-options-title"><h2 id="reading-options-title" className="text-2xl font-semibold tracking-tight">阅读方式</h2><div className="grid gap-x-8 md:grid-cols-2">{model.readingOptions.map((option) => <BookReadingLink key={option.title} href={option.href} className="flex min-h-11 items-start justify-between gap-4 border-t py-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span><strong className="block text-sm">{option.title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span><ArrowRight aria-hidden size={16} className="mt-0.5 shrink-0" /></BookReadingLink>)}</div></section>
      <nav className="grid gap-3 border-y py-4 sm:grid-cols-2" aria-label="本书导航"><div className="sm:col-span-2"><strong className="text-sm">生成页面导航</strong><span className="ml-2 text-xs text-muted-foreground">{originalSource ? `按第${originalSource.edition}版原书 PDF 页码导航，不是已核验章节。` : "由蒸馏 PDF 页码生成，不是已核验章节。"}</span></div><div className="flex flex-wrap gap-2 sm:col-span-2">{model.navigationEntries.filter((entry) => !entry.generated).map((entry) => <BookReadingLink key={entry.href} href={entry.href} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{entry.title}</BookReadingLink>)}</div><BookPageNavigation bookId={book.id} pageNumbers={content.pages.map((page) => page.page)} /></nav>
    </>}

    {content.readingGuide.length ? <section id="reading-guide" tabIndex={-1} className="grid scroll-mt-24 gap-4 focus-visible:outline-2 focus-visible:outline-primary"><h2 className="text-2xl font-semibold tracking-tight">阅读导览</h2><div className="divide-y border-y">{content.readingGuide.map((item, index) => <article key={item.title} className="grid gap-2 py-5"><span className="text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><h3 className="text-lg font-semibold">{item.title}</h3><p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">{item.description}</p></article>)}</div></section> : null}
    {content.topics.length ? <section id="topics" tabIndex={-1} className="grid scroll-mt-24 gap-4 focus-visible:outline-2 focus-visible:outline-primary"><h2 className="text-2xl font-semibold tracking-tight">主题</h2><div className="grid gap-x-8 sm:grid-cols-2">{content.topics.map((topic) => <div key={topic} className="border-t py-3 text-sm font-medium">{topic}</div>)}</div></section> : null}
    {content.pages.length ? <section id="book-text" tabIndex={-1} className="grid min-w-0 scroll-mt-24 gap-4 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-primary"><header className="grid gap-1"><h2 className="text-2xl font-semibold tracking-tight">网页正文</h2><p className="text-sm leading-6 text-muted-foreground">{originalSource ? `正文对应第${originalSource.edition}版原书 PDF 页码；文字提取不替代图表、浪标和排版，展开当前页原图核对。无可提取文字的页面也保留真实原图。` : illustrationCount ? `正文按蒸馏 PDF 页码转换，已恢复 ${illustrationCount} 组对应原图（含制图网格）；点击图片可放大核对图号与浪标。完整排版请查看 WaveKB 蒸馏 PDF。` : "正文按蒸馏 PDF 页码转换，方便搜索与核对；复杂表格和图形请查看 WaveKB 蒸馏 PDF。"}</p></header><div className="divide-y border-y">{content.pages.map((page, index) => <section id={`page-${page.page}`} key={page.page} tabIndex={-1} className="scroll-mt-24 py-7 focus-visible:outline-2 focus-visible:outline-primary"><header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-xs font-semibold tabular-nums text-primary">第 {page.page} 页</h3><nav aria-label={`第 ${page.page} 页阅读导航`} className="flex gap-2">{index > 0 ? <BookReadingLink href={`#page-${content.pages[index - 1]!.page}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">上一页</BookReadingLink> : null}{index < content.pages.length - 1 ? <BookReadingLink href={`#page-${content.pages[index + 1]!.page}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">下一页</BookReadingLink> : null}</nav></header><KnowledgeBookText text={page.text} illustrations={page.illustrations} />{originalSource?.source_id && originalSource.edition && page.sourceImage ? <KnowledgeOriginalPage asset={page.sourceImage} sourceId={originalSource.source_id} edition={originalSource.edition} page={page.page} /> : null}</section>)}</div></section> : null}
    {model.boundaries.length ? <section id="boundaries" tabIndex={-1} className="grid scroll-mt-24 gap-4 focus-visible:outline-2 focus-visible:outline-primary"><h2 className="text-2xl font-semibold tracking-tight">使用边界</h2><ul className="grid max-w-[76ch] gap-2 pl-5 text-base leading-7 text-foreground/90">{model.boundaries.map((item) => <li key={item} className="list-disc pl-1 marker:text-primary">{item}</li>)}</ul></section> : null}
  </main>;
}
