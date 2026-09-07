import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowSquareOut, FilePdf } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { knowledgeData, type KnowledgeTheme } from "@wavekb/knowledge";
import { BookSearch, type BookSearchItem } from "@/components/book-search";
import { CORE_BOOK_ID, getKnowledgeBook, getKnowledgeBookCatalog, type CoreCatalogBook, type ExtensionCatalogBook } from "@/lib/knowledge/book-catalog";

type PageProps = { params: Promise<{ id: string }>; searchParams?: Promise<{ q?: string | string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return getKnowledgeBookCatalog().map((book) => ({ id: book.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const book = getKnowledgeBook(id);
  return book ? { title: book.title, description: book.description } : {};
}

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

function unitsInTheme(theme: KnowledgeTheme): string[] {
  return [...theme.unit_ids, ...theme.children.flatMap(unitsInTheme)];
}

const chapterTitles: Record<string, string> = {
  "front-matter": "前置内容",
  "chapter-01": "第一章",
  "chapter-02": "第二章",
  "chapter-03": "第三章",
  "chapter-04": "第四章",
  "chapter-05": "第五章",
  "chapter-06": "第六章",
  "chapter-07": "第七章",
  "chapter-08": "第八章",
  appendix: "附录",
  glossary: "词汇表",
  "publisher-postscript": "原出版者后记",
};

function CoreBookPage({ book, initialQuery }: { book: CoreCatalogBook; initialQuery: string }) {
  const data = knowledgeData();
  const corePages = data.pages.filter((page) => page.kind === "core");
  const searchItems: BookSearchItem[] = corePages.map((page) => ({
    id: page.id,
    title: page.title,
    text: [...page.sections.flatMap((section) => [section.title, ...section.paragraphs, ...section.items]), ...page.search_terms].join(" "),
    meta: page.source_refs[0]?.chapter || "核心知识",
    href: `/knowledge/${page.id}`,
  }));

  const options = [
    { title: "规则与指南", description: "先检查强制规则，再使用指南排序候选。", href: "/knowledge/core-system" },
    { title: "按问题查答案", description: `${data.questions.length} 条判断路径，连接规则、证据和失效管理。`, href: "/knowledge#question-routes" },
    { title: "按原书章节", description: "沿第10版章节顺序阅读同一批知识条目。", href: "#core-chapters" },
    { title: "术语表", description: "查看浪级、结构和比例相关术语。", href: "/knowledge/chapters/glossary" },
  ];

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-6 md:py-14">
      <Link href="/knowledge" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回知识库</Link>
      <header className="grid gap-6 border-b pb-8 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
        <div className="relative aspect-[.71] w-36 overflow-hidden rounded-lg border bg-muted sm:w-auto"><Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="10rem" className="object-cover" /></div>
        <div className="grid gap-4"><span className="text-sm font-semibold text-primary">{book.label} · {book.edition}</span><h1 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{book.title}</h1><p className="max-w-[64ch] text-base leading-7 text-muted-foreground">{book.description}</p><Link href="/knowledge/core-full-book" className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">开始阅读<ArrowRight aria-hidden size={16} /></Link></div>
      </header>

      <BookSearch bookId={book.id} items={searchItems} initialQuery={initialQuery} />

      <section className="grid gap-4" aria-labelledby="core-options-title">
        <h2 id="core-options-title" className="text-2xl font-semibold tracking-tight">阅读方式</h2>
        <div className="grid gap-x-8 md:grid-cols-2">
          {options.map((option) => <Link key={option.title} href={option.href} className="flex items-start justify-between gap-4 border-t py-4 hover:text-primary"><span><strong className="block text-sm">{option.title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span><ArrowRight aria-hidden size={16} className="mt-0.5 shrink-0" /></Link>)}
        </div>
      </section>

      <section className="grid gap-4" aria-labelledby="core-themes-title">
        <header className="grid gap-1"><h2 id="core-themes-title" className="text-2xl font-semibold tracking-tight">八大主题</h2><p className="text-sm text-muted-foreground">按实际分析任务选择主题。</p></header>
        <div className="grid gap-x-8 sm:grid-cols-2">
          {data.themes.map((theme) => {
            const units = unitsInTheme(theme);
            return units[0] ? <Link key={theme.id} href={`/knowledge/themes/${theme.id}`} className="flex items-center justify-between gap-3 border-t py-3 text-sm hover:text-primary"><span><strong className="block">{theme.title}</strong><span className="text-xs text-muted-foreground">{units.length} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link> : null;
          })}
        </div>
      </section>

      <section id="core-chapters" className="grid scroll-mt-24 gap-4" aria-labelledby="core-chapters-title">
        <header className="grid gap-1"><h2 id="core-chapters-title" className="text-2xl font-semibold tracking-tight">原书章节</h2><p className="text-sm text-muted-foreground">保留第10版原书顺序与来源页码。</p></header>
        <div className="grid gap-x-8 sm:grid-cols-2 md:grid-cols-3">
          {data.chapters.map((chapter) => <Link key={chapter.id} href={`/knowledge/chapters/${chapter.id}`} className="flex items-center justify-between gap-3 border-t py-3 text-sm hover:text-primary"><span><strong className="block">{chapterTitles[chapter.id] || chapter.id}</strong><span className="text-xs text-muted-foreground">{chapter.unit_ids.length} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link>)}
        </div>
      </section>
    </main>
  );
}

function ExtensionBookPage({ book, initialQuery }: { book: ExtensionCatalogBook; initialQuery: string }) {
  const source = book.source;
  const searchItems: BookSearchItem[] = source.text_pages.map((page) => ({
    id: `page-${page.page}`,
    title: `第 ${page.page} 页`,
    text: page.text,
    meta: "网页正文",
    href: `#page-${page.page}`,
  }));

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[minmax(0,1fr)_16rem] md:px-6 md:py-14">
      <article className="grid min-w-0 gap-9">
        <Link href="/knowledge" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden size={17} />返回知识库</Link>
        <header className="grid gap-6 border-b pb-8 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
          <div className="relative aspect-[.71] w-36 overflow-hidden rounded-lg border bg-muted sm:w-auto"><Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="10rem" className="object-cover" /></div>
          <div className="grid gap-4"><span className="text-sm font-semibold text-muted-foreground">{book.label} · {book.edition}</span><h1 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">{book.title}</h1><p className="max-w-[64ch] text-base leading-7 text-muted-foreground">{book.description}</p><div className="flex flex-wrap gap-3"><a href="#book-text" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">开始网页阅读<ArrowRight aria-hidden size={16} /></a><a href={assetUrl(source.pdf_path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-muted"><FilePdf aria-hidden size={18} />查看原 PDF<ArrowSquareOut aria-hidden size={15} /></a></div></div>
        </header>

        <BookSearch bookId={book.id} items={searchItems} initialQuery={initialQuery} />

        <nav className="grid border-y sm:grid-cols-4 sm:divide-x" aria-label="书内目录">
          <a href="#reading-guide" className="px-4 py-3 text-center text-sm font-semibold hover:bg-muted">阅读导览</a>
          <a href="#topics" className="border-t px-4 py-3 text-center text-sm font-semibold hover:bg-muted sm:border-t-0">主题</a>
          <a href="#book-text" className="border-t px-4 py-3 text-center text-sm font-semibold hover:bg-muted sm:border-t-0">网页正文</a>
          <a href="#boundaries" className="border-t px-4 py-3 text-center text-sm font-semibold hover:bg-muted sm:border-t-0">使用边界</a>
        </nav>

        <section className="grid gap-3"><h2 className="text-2xl font-semibold tracking-tight">收录范围</h2><p className="max-w-[76ch] text-base leading-8 text-foreground/90">{source.source_label}</p><p className="max-w-[76ch] text-base leading-8 text-foreground/90">{source.coverage_note}</p></section>

        <section id="reading-guide" className="grid scroll-mt-24 gap-4"><h2 className="text-2xl font-semibold tracking-tight">阅读导览</h2><div className="divide-y border-y">{source.reading_guide.map((item, index) => <article id={`guide-${index + 1}`} key={item.title} className="grid gap-2 py-5"><span className="text-xs font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><h3 className="text-lg font-semibold">{item.title}</h3><p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">{item.description}</p></article>)}</div></section>

        <section id="topics" className="grid scroll-mt-24 gap-4"><h2 className="text-2xl font-semibold tracking-tight">主题</h2><div className="grid gap-x-8 sm:grid-cols-2">{source.topics.map((topic) => <div key={topic} className="border-t py-3 text-sm font-medium">{topic}</div>)}</div></section>

        <section id="book-text" className="grid scroll-mt-24 gap-4" aria-labelledby="book-text-title">
          <header className="grid gap-1"><h2 id="book-text-title" className="text-2xl font-semibold tracking-tight">网页正文</h2><p className="text-sm leading-6 text-muted-foreground">正文按蒸馏版 PDF 页码转换，方便搜索与核对；复杂表格和图形仍请查看原 PDF。</p></header>
          <div className="divide-y border-y">
            {source.text_pages.map((page) => <section id={`page-${page.page}`} key={page.page} className="scroll-mt-24 py-7"><h3 className="mb-4 text-xs font-semibold tabular-nums text-primary">第 {page.page} 页</h3><p className="whitespace-pre-line text-[1.04rem] leading-8 text-foreground/90">{page.text}</p></section>)}
          </div>
        </section>

        <section id="boundaries" className="grid scroll-mt-24 gap-4"><h2 className="text-2xl font-semibold tracking-tight">使用边界</h2><ul className="grid max-w-[76ch] gap-2 pl-5 text-base leading-7 text-foreground/90">{source.boundaries.map((item) => <li key={item} className="list-disc pl-1 marker:text-primary">{item}</li>)}</ul></section>
      </article>

      <aside className="grid h-fit gap-5 md:sticky md:top-24">
        <div className="grid gap-3 border-t pt-4"><h2 className="text-sm font-semibold">文献资料</h2><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-muted-foreground"><dt>网页页数</dt><dd>{source.text_pages.length}</dd><dt>覆盖来源</dt><dd>{source.source_page_count.toLocaleString("zh-CN")}</dd><dt>生成日期</dt><dd>{source.generated_on}</dd><dt>校验值</dt><dd className="break-all font-mono text-[10px] leading-4">SHA-256 {source.sha256}</dd></dl></div>
        <nav className="grid gap-2 border-t pt-4" aria-label="本书快速目录"><h2 className="text-sm font-semibold">本书目录</h2><a href="#reading-guide" className="text-sm text-muted-foreground hover:text-primary">阅读导览</a><a href="#topics" className="text-sm text-muted-foreground hover:text-primary">主题</a><a href="#book-text" className="text-sm text-muted-foreground hover:text-primary">网页正文</a><a href="#boundaries" className="text-sm text-muted-foreground hover:text-primary">使用边界</a></nav>
      </aside>
    </main>
  );
}

export default async function KnowledgeBookDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const rawQuery = (await searchParams)?.q;
  const initialQuery = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery || "").slice(0, 80);
  const book = getKnowledgeBook(id);
  if (!book) notFound();
  return id === CORE_BOOK_ID && book.kind === "core" ? <CoreBookPage book={book} initialQuery={initialQuery} /> : book.kind === "extension" ? <ExtensionBookPage book={book} initialQuery={initialQuery} /> : notFound();
}
