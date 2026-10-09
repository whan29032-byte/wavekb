import type { KnowledgeAsset, KnowledgeBookIllustration, KnowledgeData } from "@wavekb/knowledge";
import { UNIT_BOOK_ID, getKnowledgeBook, getKnowledgeBookCatalog, type KnowledgeBookCatalogEntry } from "./book-catalog";
import { readingTextToPlainText } from "./reading-text";

export type BookSearchDocument = {
  id: string;
  title: string;
  text: string;
  meta: string;
  href: string;
  bookId: string;
  bookTitle: string;
};

export type BookReadingModel = {
  book: KnowledgeBookCatalogEntry;
  hero: { primaryHref: string; primaryLabel: string };
  searchDocuments: BookSearchDocument[];
  readingOptions: Array<{ title: string; description: string; href: string }>;
  navigationEntries: Array<{ title: string; href: string; generated?: boolean }>;
  content: {
    themes: Array<{ id: string; title: string; count: number }>;
    questions: Array<{ id: string; question: string; requiredCount: number; optionalCount: number }>;
    chapters: Array<{ id: string; title: string; count: number }>;
    readingGuide: Array<{ title: string; description: string }>;
    topics: string[];
    pages: Array<{ page: number; text: string; illustrations?: KnowledgeBookIllustration[]; sourceImage?: KnowledgeAsset; imageOnly?: boolean }>;
  };
  sourceArtifact: { label: string; href: string } | null;
  boundaries: string[];
};

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function assetUrl(assetPath: string) {
  const base = (process.env.NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

function chapterTitle(id: string) {
  const titles: Record<string, string> = {
    "front-matter": "前置内容", "chapter-01": "第一章", "chapter-02": "第二章", "chapter-03": "第三章",
    "chapter-04": "第四章", "chapter-05": "第五章", "chapter-06": "第六章", "chapter-07": "第七章",
    "chapter-08": "第八章", appendix: "附录", glossary: "词汇表", "publisher-postscript": "原出版者后记",
  };
  return titles[id] || id;
}

export function buildBookReadingModel(bookId: string, data: KnowledgeData): BookReadingModel | null {
  const book = getKnowledgeBook(bookId, data);
  if (!book) return null;

  if (book.id === UNIT_BOOK_ID && book.kind === "core") {
    const corePages = data.pages.filter((page) => page.kind === "core");
    return {
      book,
      hero: { primaryHref: "/knowledge/core-full-book", primaryLabel: "开始阅读" },
      searchDocuments: corePages.map((page) => ({
        id: page.id,
        title: page.title,
        text: normalizedText([...page.sections.flatMap((section) => [section.title, ...section.paragraphs, ...section.items]), ...page.search_terms].join(" ")),
        meta: page.source_refs[0]?.chapter || "核心知识",
        href: `/knowledge/${page.id}`,
        bookId: book.id,
        bookTitle: book.title,
      })),
      readingOptions: [
        { title: "规则与指引", description: "先检查强制规则，再使用指南排序候选。", href: "/knowledge/core-system" },
        { title: "按问题查答案", description: `${data.questions.length} 条判断路径，连接规则、证据和失效管理。`, href: `${book.href}?section=questions#core-questions` },
        { title: "按原书章节", description: "沿原有章节索引阅读版本对照知识条目；来源版次逐条标注。", href: `${book.href}?section=chapters#core-chapters` },
        { title: "术语表", description: "查看浪级、结构和比例相关术语。", href: "/knowledge/chapters/glossary" },
      ],
      navigationEntries: [
        { title: "规则与指引", href: "/knowledge/core-system" },
        { title: "八大主题", href: `${book.href}?section=themes#core-themes` },
        { title: "问题解答", href: `${book.href}?section=questions#core-questions` },
        { title: "原书章节", href: `${book.href}?section=chapters#core-chapters` },
      ],
      content: {
        themes: data.themes.map((theme) => ({ id: theme.id, title: theme.title, count: [...theme.unit_ids, ...theme.children.flatMap((child) => child.unit_ids)].length })),
        questions: data.questions.map((question) => ({
          id: question.id,
          question: question.question,
          requiredCount: question.required_unit_ids.length,
          optionalCount: question.optional_unit_ids.length,
        })),
        chapters: data.chapters.map((chapter) => ({ id: chapter.id, title: chapterTitle(chapter.id), count: chapter.unit_ids.length })),
        readingGuide: [], topics: [], pages: [],
      },
      sourceArtifact: null,
      boundaries: [],
    };
  }

  if (book.kind !== "extension") return null;
  const source = book.source;
  const originalSource = source.source_kind === "original_pdf";
  // Preserve reviewed paragraph/table layout in the reading body; compact only the search index.
  const pages = source.text_pages.map((page) => ({ page: page.page, text: page.text, ...(page.illustrations?.length ? { illustrations: page.illustrations } : {}), ...(page.source_image ? { sourceImage: page.source_image } : {}), ...(page.extraction?.status === "image_only" ? { imageOnly: true } : {}) }));
  const availableSections = new Set([
    ...(source.reading_guide.length ? ["#reading-guide"] : []),
    ...(source.topics.length ? ["#topics"] : []),
    ...(pages.length ? ["#book-text"] : []),
    ...(source.boundaries.length ? ["#boundaries"] : []),
  ]);
  return {
    book,
    hero: { primaryHref: "#book-text", primaryLabel: "开始网页阅读" },
    searchDocuments: pages.filter((page) => !page.imageOnly).map((page) => ({
      id: `${book.id}::page::p${String(page.page).padStart(4, "0")}`,
      title: `第 ${page.page} 页`, text: normalizedText(readingTextToPlainText(page.text)), meta: originalSource ? `第${source.edition}版原书 PDF 第 ${page.page} 页` : "网页正文",
      href: `/knowledge/books/${book.id}#page-${page.page}`,
      bookId: book.id, bookTitle: book.title,
    })),
    readingOptions: [
      { title: "阅读导览", description: "按主题和使用目的安排交叉阅读。", href: "#reading-guide" },
      { title: "主题", description: "从资料覆盖的主题进入内容。", href: "#topics" },
      { title: "网页正文", description: originalSource ? `按第${source.edition}版原书 PDF 页码阅读，原页图表按需展开。` : "按蒸馏 PDF 页码阅读可检索正文。", href: "#book-text" },
      { title: "使用边界", description: "了解资料的来源、范围和不能替代的判断。", href: "#boundaries" },
    ].filter((option) => availableSections.has(option.href)).concat(originalSource ? [{ title: "第10版补充与版本对照", description: "查看现有117个整理条目，真实来源版次逐条标注；不等同于第11版全文。", href: `/knowledge/books/${UNIT_BOOK_ID}` }] : []),
    navigationEntries: [
      { title: "阅读导览", href: "#reading-guide" }, { title: "主题", href: "#topics" },
      { title: "网页正文", href: "#book-text" }, { title: "使用边界", href: "#boundaries" },
      ...pages.map((page) => ({ title: `第 ${page.page} 页`, href: `#page-${page.page}`, generated: true })),
    ].filter((entry) => ("generated" in entry && entry.generated) || availableSections.has(entry.href)),
    content: { themes: [], questions: [], chapters: [], readingGuide: source.reading_guide, topics: source.topics, pages },
    sourceArtifact: { label: book.sourceArtifactLabel, href: assetUrl(source.pdf_path) },
    boundaries: source.boundaries,
  };
}

export function buildLibrarySearchDocuments(data: KnowledgeData) {
  return getKnowledgeBookCatalog(data).map((book) => book.id)
    .flatMap((bookId) => buildBookReadingModel(bookId, data)?.searchDocuments || []);
}
