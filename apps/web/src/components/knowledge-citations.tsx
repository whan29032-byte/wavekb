export type KnowledgeCitation = {
  knowledge_id: string;
  book_id: string;
  book_title: string;
  title: string;
  source_id: string;
  pages: number[];
  href: string;
  snippet: string;
};

const CORE_BOOK_ID = "elliott-wave-principle-tenth-edition";
const EXTENSION_BOOK_IDS = new Set(["elliott-wave-natural-law", "chan-theory-complete"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeCitation(value: unknown): value is KnowledgeCitation {
  if (!isRecord(value)) return false;
  const strings = ["knowledge_id", "book_id", "book_title", "title", "source_id", "href", "snippet"] as const;
  const href = value.href;
  const bookId = value.book_id;
  const pages = value.pages;
  if (strings.some((key) => typeof value[key] !== "string")
    || typeof href !== "string" || typeof bookId !== "string"
    || !Array.isArray(pages) || pages.some((page) => !Number.isInteger(page) || page < 1)
    || href.includes("%") || href.includes("..") || href.includes("://")) return false;
  if (bookId === CORE_BOOK_ID) return /^\/knowledge\/unit-[a-z0-9-]+$/.test(href);
  if (!EXTENSION_BOOK_IDS.has(bookId)) return false;
  const match = new RegExp(`^/knowledge/books/${bookId}#page-([1-9][0-9]*)$`).exec(href);
  return Boolean(match && pages.includes(Number(match[1])));
}

export function KnowledgeCitations({ citations }: { citations?: unknown }) {
  const trusted = Array.isArray(citations) ? citations.filter(isSafeCitation) : [];
  if (!trusted.length) return null;

  return <section className="grid gap-3 border-t pt-4" aria-labelledby="knowledge-citations-heading">
    <h3 id="knowledge-citations-heading" className="font-semibold">本次知识依据</h3>
    <ul className="grid gap-3">{trusted.map((citation) => {
      const extension = EXTENSION_BOOK_IDS.has(citation.book_id);
      const pages = citation.pages.join("、");
      return <li key={`${citation.book_id}:${citation.knowledge_id}`} className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
        <p className="font-semibold">{citation.book_title}</p>
        <p>{citation.title}</p>
        <p className="text-xs text-muted-foreground">{extension ? `蒸馏 PDF 第 ${pages} 页` : `PDF 第 ${pages} 页`} · {citation.source_id}</p>
        <p className="text-xs leading-5 text-muted-foreground">{citation.snippet}</p>
        <a className="w-fit text-xs font-semibold text-primary hover:underline" href={citation.href}>打开知识原文</a>
      </li>;
    })}</ul>
  </section>;
}
