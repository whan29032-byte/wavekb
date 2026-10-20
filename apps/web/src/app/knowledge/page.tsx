
import type { Metadata } from "next";
import Image from "next/image";
import { ReadingPriorityLink as Link } from "@/components/reading-priority-link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { knowledgeData } from "@wavekb/knowledge";
import { Badge, Card, PageHeader } from "@wavekb/ui";
import { KnowledgeExplorer } from "@/components/knowledge-explorer";
import { getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";
import { buildLibrarySearchDocuments } from "@/lib/knowledge/book-reading";
import { knowledgePageSourceLabels, sourceEditionLabel } from "@/lib/knowledge/source-labels";
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
  const pageItems = data.pages.map(({ id, title, kind, parent, sections, search_terms, source_refs }) => ({
      id,
      title,
      kind,
      parent,
      label: kind === "core" ? `补充与版本对照 · ${knowledgePageSourceLabels({ source_refs }).join(" / ")}` : "辅助资料",
      searchText: [
        ...sections.flatMap((section) => [...section.paragraphs, ...section.items]),
        ...search_terms,
        ...source_refs.flatMap((source) => [source.chapter, source.section, source.source_id, ...source.figures]),
      ].join(" "),
    }));
  const documents = buildLibrarySearchDocuments(data);
  const listItems = [
    ...books.flatMap((book) => [{
      id: `book-${book.id}`,
      title: book.title,
      kind: book.role === "core" ? "core" as const : "candidate" as const,
      parent: null,
      href: book.href,
      label: `${book.label} · ${book.edition}`,
      searchText: [book.edition, book.description, ...book.topics].join(" "),
    }, ...(book.kind === "core" ? pageItems.filter((item) => item.kind === "core") : documents.filter((document) => document.bookId === book.id).map((document) => ({
      id: document.id,
      title: `${document.bookTitle} · ${document.title}`,
      kind: "generated" as const,
      parent: null,
      href: document.href,
      label: book.source.source_kind === "original_pdf" ? `${sourceEditionLabel(book.source.source_id, book.source.edition)}原书文字层提取 · 未逐页核验` : "蒸馏生成页面",
      searchText: document.text,
    })))]),
    ...pageItems.filter((item) => item.kind !== "core"),
  ];

  return (
    <main className="mx-auto grid max-w-6xl gap-12 px-4 py-10 md:px-6 md:py-14">
      <PageHeader
        eyebrow="Knowledge library"
        title="知识库"
        description="选择一本书，再通过书内搜索、主题、问题或原书章节定位内容。所有核心结论都保留来源与失效边界。"
        actions={<p className="text-sm tabular-nums text-muted-foreground"><strong className="text-foreground">{coreCount}</strong> 个已整理知识条目</p>}
      />

      <KnowledgeExplorer items={listItems} />

      <section className="grid gap-5" aria-labelledby="book-shelf-title">
        <header className="grid gap-1">
          <span className="eyebrow">Reading sources</span>
          <h2 id="book-shelf-title" className="text-2xl font-semibold tracking-tight">选择一本书</h2>
          <p className="text-sm leading-6 text-muted-foreground">第11版原书为主；第10版补充与版本对照保留现有整理条目，其他资料用于交叉阅读。文字、图表和页码均保留真实来源版次。</p>
        </header>
        <div className="grid gap-4 lg:grid-cols-3">
          {books.map((book) => (
            <Card asChild key={book.id} variant="interactive" padding="sm" className="group">
              <Link href={book.href} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4">
                <div className="relative aspect-[.71] overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-subtle">
                  <Image src={assetUrl(book.coverPath)} alt={`${book.title}封面`} fill sizes="6.5rem" className="object-contain" />
                </div>
                <span className="grid min-w-0 content-start gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={book.role === "core" ? "primary" : "neutral"} size="sm">{book.label}</Badge>
                    <span className="text-xs text-muted-foreground">{book.edition}</span>
                  </span>
                  <strong className="text-lg leading-6 group-hover:text-primary">{book.title}</strong>
                  <span className="line-clamp-3 text-sm leading-6 text-muted-foreground">{book.description}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-foreground">{book.itemCount} {book.itemLabel}<ArrowRight aria-hidden size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
                </span>
              </Link>
            </Card>
          ))}
        </div>
      </section>

    </main>
  );
}
