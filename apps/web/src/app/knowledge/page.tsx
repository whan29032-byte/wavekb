
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { knowledgeData } from "@wavekb/knowledge";
import { KnowledgeExplorer } from "@/components/knowledge-explorer";
import { CORE_BOOK_ID, getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import { buildLibrarySearchDocuments } from "@/lib/knowledge/book-reading";
import { publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: "知识库",
  description: "选择图书并通过书内搜索、主题、问题和章节阅读已核验的波浪理论知识。",
  path: "/knowledge",
});

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

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
          <p className="max-w-[68ch] text-base leading-7 text-muted-foreground">选择一本书，再通过书内搜索、主题、问题或原书章节定位内容。所有核心结论都保留来源与失效边界。</p>
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

    </main>
  );
}
