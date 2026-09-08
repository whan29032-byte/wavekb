
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { childrenOf, knowledgeData, type KnowledgeTheme } from "@wavekb/knowledge";
import { KnowledgeExplorer } from "@/components/knowledge-explorer";
import { CORE_BOOK_ID, getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import { buildLibrarySearchDocuments } from "@/lib/knowledge/book-reading";
import { publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: "知识库",
  description: "按图书、主题、问题和章节阅读已核验的波浪理论知识。",
  path: "/knowledge",
});

function unitsInTheme(theme: KnowledgeTheme): string[] {
  return [...theme.unit_ids, ...theme.children.flatMap(unitsInTheme)];
}

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
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

export default function KnowledgePage() {
  const data = knowledgeData();
  const books = getKnowledgeBookCatalog(data);
  const coreCount = data.pages.filter((page) => page.kind === "core").length;
  const listItems = [
    ...data.pages.map(({ id, title, kind, parent, sections, search_terms, source_refs }) => ({
      id,
      title,
      kind,
      parent,
      searchText: [
        ...sections.flatMap((section) => [...section.paragraphs, ...section.items]),
        ...search_terms,
        ...source_refs.flatMap((source) => [source.chapter, source.section, source.source_id, ...source.figures]),
      ].join(" "),
    })),
    ...books.map((book) => ({
      id: `book-${book.id}`,
      title: book.title,
      kind: book.kind === "core" ? "core" as const : "candidate" as const,
      parent: null,
      href: book.href,
      searchText: [book.edition, book.description, ...book.topics].join(" "),
    })),
    ...buildLibrarySearchDocuments(data).filter((document) => document.bookId !== CORE_BOOK_ID).map((document) => ({
      id: document.id,
      title: `${document.bookTitle} · ${document.title}`,
      kind: "generated" as const,
      parent: null,
      href: document.href,
      searchText: document.text,
    })),
  ];

  return (
    <main className="mx-auto grid max-w-6xl gap-12 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-4 border-b pb-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-3">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] md:text-5xl">知识库</h1>
          <p className="max-w-[68ch] text-base leading-7 text-muted-foreground">从一本书开始，也可以按主题、问题或原书章节定位规则。所有核心结论都保留来源与失效边界。</p>
        </div>
        <p className="text-sm tabular-nums text-muted-foreground"><strong className="text-foreground">{coreCount}</strong> 个核心知识条目</p>
      </header>

      <KnowledgeExplorer items={listItems} />

      <section className="grid gap-5" aria-labelledby="book-shelf-title">
        <header className="grid gap-1">
          <h2 id="book-shelf-title" className="text-2xl font-semibold tracking-tight">选择一本书</h2>
          <p className="text-sm leading-6 text-muted-foreground">核心主书提供站内规则依据；扩展资料用于交叉阅读，不覆盖核心结论。</p>
        </header>
        <div className="grid gap-6 lg:grid-cols-3">
          {books.map((book) => (
            <Link key={book.id} href={book.href} className="group grid grid-cols-[7.25rem_minmax(0,1fr)] gap-4 border-t pt-4 focus-visible:rounded-lg">
              <div className="relative aspect-[.71] overflow-hidden rounded-lg border bg-muted">
                <Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="7.25rem" className="object-contain" />
              </div>
              <span className="grid min-w-0 content-start gap-2">
                <span className="flex flex-wrap items-center gap-2 text-xs"><strong className={book.kind === "core" ? "text-primary" : "text-muted-foreground"}>{book.label}</strong><span className="text-muted-foreground">{book.edition}</span></span>
                <strong className="text-lg leading-6 group-hover:text-primary">{book.title}</strong>
                <span className="line-clamp-3 text-sm leading-6 text-muted-foreground">{book.description}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-foreground">{book.itemCount} {book.itemLabel}<ArrowRight aria-hidden size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <nav className="grid border-y sm:grid-cols-3 sm:divide-x" aria-label="知识库阅读方式">
        <a href="#theme-routes" className="flex items-center justify-between gap-3 px-4 py-4 text-sm font-semibold hover:bg-muted">按主题学习<ArrowRight aria-hidden size={16} /></a>
        <a href="#question-routes" className="flex items-center justify-between gap-3 border-t px-4 py-4 text-sm font-semibold hover:bg-muted sm:border-t-0">按问题查答案<ArrowRight aria-hidden size={16} /></a>
        <a href="#chapter-routes" className="flex items-center justify-between gap-3 border-t px-4 py-4 text-sm font-semibold hover:bg-muted sm:border-t-0">按原书章节阅读<ArrowRight aria-hidden size={16} /></a>
      </nav>

      <section className="grid gap-4" aria-labelledby="knowledge-source-title">
        <header><h2 id="knowledge-source-title" className="text-2xl font-semibold tracking-tight">知识来源</h2></header>
        <div className="divide-y border-y">
          {data.roots.map((root) => {
            const children = childrenOf(root.id);
            const first = children[0];
            return (
              <div key={root.id} className="grid gap-3 py-5 md:grid-cols-[14rem_minmax(0,1fr)_auto] md:items-start">
                <div><h3 className="font-semibold">{root.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{root.kind === "core" ? "第10版核心规则、指南和历史观察" : "训练、复盘与交叉核验资料"}</p></div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">{children.slice(0, 5).map((page) => <Link key={page.id} href={`/knowledge/${page.id}`} className="text-sm text-muted-foreground hover:text-primary hover:underline">{page.title}</Link>)}</div>
                {first ? <Link href={`/knowledge/${first.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">开始阅读<ArrowRight aria-hidden size={15} /></Link> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section id="theme-routes" className="grid scroll-mt-24 gap-4" aria-labelledby="theme-routes-title">
        <header className="grid gap-1"><h2 id="theme-routes-title" className="text-2xl font-semibold tracking-tight">按八大主题学习</h2><p className="text-sm text-muted-foreground">每个主题按知识条目组织，正文只维护一份。</p></header>
        <div className="grid border-y sm:grid-cols-2 lg:grid-cols-4">
          {data.themes.map((theme, index) => {
            const unitIds = unitsInTheme(theme);
            return unitIds[0] ? <Link key={theme.id} href={`/knowledge/themes/${theme.id}`} className={`grid gap-1 px-4 py-4 hover:bg-muted ${index >= 2 ? "border-t lg:border-t-0" : index ? "border-t sm:border-l sm:border-t-0" : ""} ${index >= 4 ? "lg:border-t" : ""}`}><strong className="text-sm leading-5">{theme.title}</strong><span className="text-xs text-muted-foreground">{unitIds.length} 个知识条目</span></Link> : null;
          })}
        </div>
      </section>

      <section id="question-routes" className="grid scroll-mt-24 gap-4" aria-labelledby="question-routes-title">
        <header className="grid gap-1"><h2 id="question-routes-title" className="text-2xl font-semibold tracking-tight">按问题查答案</h2><p className="text-sm text-muted-foreground">从判断问题进入规则、证据和失效管理。</p></header>
        <div className="grid gap-x-8 md:grid-cols-2">
          {data.questions.map((question) => <Link key={question.id} href={`/knowledge/questions/${question.id}`} className="flex items-start justify-between gap-4 border-t py-4 hover:text-primary"><span><strong className="block text-sm leading-6">{question.question}</strong><span className="text-xs text-muted-foreground">{question.required_unit_ids.length} 个必读 · {question.optional_unit_ids.length} 个辅助</span></span><ArrowRight aria-hidden size={16} className="mt-1 shrink-0" /></Link>)}
        </div>
      </section>

      <section id="chapter-routes" className="grid scroll-mt-24 gap-4" aria-labelledby="chapter-routes-title">
        <header className="grid gap-1"><h2 id="chapter-routes-title" className="text-2xl font-semibold tracking-tight">按原书章节阅读</h2><p className="text-sm text-muted-foreground">按原书顺序查看同一批核心知识条目。</p></header>
        <div className="grid gap-x-8 sm:grid-cols-2 md:grid-cols-3">
          {data.chapters.map((chapter) => chapter.unit_ids[0] ? <Link key={chapter.id} href={`/knowledge/chapters/${chapter.id}`} className="flex items-center justify-between gap-3 border-t py-3 text-sm hover:text-primary"><span><strong className="block">{chapterTitles[chapter.id] || chapter.id}</strong><span className="text-xs text-muted-foreground">{chapter.unit_ids.length} 个知识条目</span></span><ArrowRight aria-hidden size={16} /></Link> : null)}
        </div>
      </section>
    </main>
  );
}
