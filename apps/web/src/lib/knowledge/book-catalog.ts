import { knowledgeData, type KnowledgeData, type KnowledgeLibraryBook } from "@wavekb/knowledge";

export const SOURCE_BOOK_ID = "elliott-wave-principle-eleventh-edition";
export const CORE_BOOK_ID = SOURCE_BOOK_ID;
export const UNIT_BOOK_ID = "elliott-wave-principle-tenth-edition";

type CatalogBase = {
  id: string;
  role: "core" | "supplement" | "extension";
  title: string;
  edition: string;
  label: string;
  description: string;
  coverPath: string;
  href: string;
  itemCount: number;
  itemLabel: string;
  topics: string[];
};

export type CoreCatalogBook = CatalogBase & {
  kind: "core";
  source: null;
  verifiedUnitCount: number;
  readingViewCount: number;
  sourceArtifactLabel: null;
};

export type ExtensionCatalogBook = CatalogBase & {
  kind: "extension";
  source: KnowledgeLibraryBook;
  verifiedUnitCount: null;
  readingViewCount: number;
  sourceArtifactLabel: string;
};

export type KnowledgeBookCatalogEntry = CoreCatalogBook | ExtensionCatalogBook;

export function getKnowledgeBookCatalog(data: KnowledgeData = knowledgeData()): KnowledgeBookCatalogEntry[] {
  const corePages = data.pages.filter((page) => page.kind === "core");
  const coreBook: CoreCatalogBook = {
    id: UNIT_BOOK_ID,
    role: "supplement",
    kind: "core",
    source: null,
    title: "艾略特波浪理论 · 第10版补充与版本对照",
    edition: "第10版补充 · 含第11版整理条目",
    label: "补充资料",
    description: "保留现有117个已整理知识单元，其中81个以第10版为主来源、36个以第11版为主来源。逐条展示真实来源，作为第11版原书的补充与版本对照，并非第11版逐条核验后的全文。",
    coverPath: "assets/books/elliott-wave-principle-tenth-edition-cover.svg",
    href: `/knowledge/books/${UNIT_BOOK_ID}`,
    itemCount: 117,
    itemLabel: "个已核验知识单元",
    topics: data.themes.map((theme) => theme.title.replace(/^\d+\s*/, "")),
    verifiedUnitCount: 117,
    readingViewCount: corePages.length,
    sourceArtifactLabel: null,
  };

  const extensionBooks: ExtensionCatalogBook[] = data.library.books.map((book) => ({
    id: book.id,
    role: book.role === "core" ? "core" : "extension",
    kind: "extension",
    source: book,
    title: book.title,
    edition: book.eyebrow,
    label: book.role === "core" ? "核心主书" : "扩展资料",
    description: book.description,
    coverPath: book.cover_path,
    href: `/knowledge/books/${book.id}`,
    itemCount: book.pdf_pages,
    itemLabel: "页网页正文",
    topics: book.topics,
    verifiedUnitCount: null,
    readingViewCount: book.pdf_pages,
    sourceArtifactLabel: book.source_kind === "original_pdf" ? `第${book.edition}版原书 PDF` : "WaveKB 蒸馏 PDF",
  }));

  const priority = { core: 0, supplement: 1, extension: 2 };
  return [coreBook, ...extensionBooks].sort((left, right) => priority[left.role] - priority[right.role]);
}

export function getKnowledgeBook(id: string, data: KnowledgeData = knowledgeData()) {
  return getKnowledgeBookCatalog(data).find((book) => book.id === id) ?? null;
}
