import { describe, expect, it } from "vitest";
import { knowledgeData } from "@wavekb/knowledge";
import { buildBookReadingModel, buildLibrarySearchDocuments } from "./book-reading";
import { CORE_BOOK_ID, UNIT_BOOK_ID } from "./book-catalog";

describe("book reading navigation model", () => {
  it("orders complete search document groups by main book, comparison collection, then extensions", () => {
    const documents = buildLibrarySearchDocuments(knowledgeData());
    expect([...new Set(documents.map((document) => document.bookId))]).toEqual([CORE_BOOK_ID, UNIT_BOOK_ID, "elliott-wave-natural-law", "chan-theory-complete"]);
    expect(documents[0]?.bookId).toBe(CORE_BOOK_ID);
    expect(documents.at(-1)?.bookId).toBe("chan-theory-complete");
    expect(new Set(documents.map((document) => document.id)).size).toBe(documents.length);
  });

  it("keeps all original eleventh-edition pages and exact source images but excludes image-only placeholders from search", () => {
    const data = knowledgeData();
    const source = data.library.books.find((book) => book.id === CORE_BOOK_ID)!;
    const model = buildBookReadingModel(CORE_BOOK_ID, data)!;
    expect(model.content.pages.map((page) => page.page)).toEqual(Array.from({ length: 321 }, (_, index) => index + 1));
    expect(model.searchDocuments).toHaveLength(source.text_pages.filter((page) => page.extraction?.status !== "image_only").length);
    expect(model.searchDocuments).toHaveLength(315);
    for (const page of model.content.pages) {
      expect(page.text).toBe(source.text_pages[page.page - 1]!.text);
      expect(page.sourceImage).toMatchObject({ source_id: "ewp-11-zh-2021", edition: 11, pdf_page: page.page, figure_type: "source_page_scan" });
      expect(page.sourceImage?.asset_path).toBe(`assets/source-pages/page-${String(page.page).padStart(3, "0")}.png`);
      if (page.imageOnly) expect(model.searchDocuments.some((document) => document.href.endsWith(`#page-${page.page}`))).toBe(false);
    }
    expect(model.sourceArtifact?.label).toBe("第11版原书 PDF");
    expect(model.sourceArtifact?.href).not.toContain("distilled");
    expect(model.readingOptions.find((option) => option.title === "第10版补充与版本对照")?.href).toBe(`/knowledge/books/${UNIT_BOOK_ID}`);
    expect(model.searchDocuments.every((document) => document.meta.startsWith("第11版原书 PDF 第"))).toBe(true);
  });

  it("keeps every extension page reference in the actual distilled-page set", () => {
    const data = knowledgeData();
    for (const book of data.library.books) {
      const model = buildBookReadingModel(book.id, data)!;
      const pages = new Set(model.content.pages.map((page) => page.page));
      expect(pages.size).toBe(book.text_pages.length);
      for (const document of model.searchDocuments) {
        const page = Number(/#page-(\d+)$/.exec(document.href)?.[1]);
        expect(pages.has(page), document.href).toBe(true);
      }
      for (const entry of model.navigationEntries.filter((entry) => entry.generated)) {
        expect(pages.has(Number(entry.href.replace("#page-", ""))), entry.href).toBe(true);
      }
    }
  });

  it("omits section links when the corresponding body is absent", () => {
    const data = structuredClone(knowledgeData());
    const source = data.library.books[0]!;
    source.reading_guide = [];
    source.topics = [];
    source.boundaries = [];
    const model = buildBookReadingModel(source.id, data)!;
    expect(model.readingOptions.map((option) => option.href)).toEqual(["#book-text"]);
    expect(model.navigationEntries.filter((entry) => !entry.generated).map((entry) => entry.href)).toEqual(["#book-text"]);
  });

  it("preserves reviewed line breaks in body text but compacts the search index", () => {
    const data = structuredClone(knowledgeData());
    const source = data.library.books[0]!;
    source.text_pages[0]!.text = "第一段\n\n比例 0.618 ≤ 1\n第二段";
    const model = buildBookReadingModel(source.id, data)!;
    expect(model.content.pages[0]!.text).toBe(source.text_pages[0]!.text);
    expect(model.searchDocuments[0]!.text).toBe("第一段 比例 0.618 ≤ 1 第二段");
  });

  it("indexes structural markdown as readable text without losing mathematical symbols", () => {
    const data = structuredClone(knowledgeData());
    const source = data.library.books[0]!;
    source.text_pages[0]!.text = "## 比例表\n\n| 结构 | 比例 |\n| --- | --- |\n| 回撤 | 0.618 ≤ 1 |\n\n公式 |a| ≤ b。";
    const model = buildBookReadingModel(source.id, data)!;
    expect(model.content.pages[0]!.text).toBe(source.text_pages[0]!.text);
    expect(model.searchDocuments[0]!.text).toBe("比例表 结构 / 比例 回撤 / 0.618 ≤ 1 公式 |a| ≤ b。");
    expect(model.searchDocuments[0]!.text).not.toContain("##");
    expect(model.searchDocuments[0]!.text).not.toContain("| --- |");
  });

  it("preserves the core book's actual migrated article references", () => {
    const data = knowledgeData();
    const articleIds = new Set(data.pages.filter((page) => page.kind === "core").map((page) => page.id));
    const core = buildBookReadingModel(UNIT_BOOK_ID, data)!;
    for (const document of core.searchDocuments) expect(articleIds.has(document.href.replace("/knowledge/", ""))).toBe(true);
    const extensionPageCount = data.library.books.reduce((count, book) => count + book.text_pages.filter((page) => page.extraction?.status !== "image_only").length, 0);
    expect(buildLibrarySearchDocuments(data)).toHaveLength(core.searchDocuments.length + extensionPageCount);
  });
});
