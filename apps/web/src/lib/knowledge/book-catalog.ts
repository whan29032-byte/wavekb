import { knowledgeData, type KnowledgeData, type KnowledgeLibraryBook } from "@wavekb/knowledge";

export const CORE_BOOK_ID = "elliott-wave-principle-tenth-edition";

type CatalogBase = {
  id: string;
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
};

export type ExtensionCatalogBook = CatalogBase & {
  kind: "extension";
  source: KnowledgeLibraryBook;
};

export type KnowledgeBookCatalogEntry = CoreCatalogBook | ExtensionCatalogBook;

export function getKnowledgeBookCatalog(data: KnowledgeData = knowledgeData()): KnowledgeBookCatalogEntry[] {
  const corePages = data.pages.filter((page) => page.kind === "core");
  const coreBook: CoreCatalogBook = {
    id: CORE_BOOK_ID,
    kind: "core",
    source: null,
    title: "艾略特波浪理论",
    edition: "第10版核心知识库",
    label: "核心主书",
    description: "按原书来源整理规则、指南、识别步骤与失效边界，是站内波浪理论判断的核心依据。",
    coverPath: "assets/books/elliott-wave-principle-tenth-edition-cover.svg",
    href: `/knowledge/books/${CORE_BOOK_ID}`,
    itemCount: corePages.length,
    itemLabel: "个已核验知识条目",
    topics: data.themes.map((theme) => theme.title.replace(/^\d+\s*/, "")),
  };

  const extensionBooks: ExtensionCatalogBook[] = data.library.books.map((book) => ({
    id: book.id,
    kind: "extension",
    source: book,
    title: book.title,
    edition: book.eyebrow,
    label: "扩展资料",
    description: book.description,
    coverPath: book.cover_path,
    href: `/knowledge/books/${book.id}`,
    itemCount: book.pdf_pages,
    itemLabel: "页网页正文",
    topics: book.topics,
  }));

  return [coreBook, ...extensionBooks];
}

export function getKnowledgeBook(id: string, data: KnowledgeData = knowledgeData()) {
  return getKnowledgeBookCatalog(data).find((book) => book.id === id) ?? null;
}
