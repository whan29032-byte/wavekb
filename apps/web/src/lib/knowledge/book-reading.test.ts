import { describe, expect, it } from "vitest";
import { knowledgeData } from "@wavekb/knowledge";
import { buildBookReadingModel, buildLibrarySearchDocuments } from "./book-reading";
import { CORE_BOOK_ID } from "./book-catalog";

describe("book reading navigation model", () => {
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
    const core = buildBookReadingModel(CORE_BOOK_ID, data)!;
    for (const document of core.searchDocuments) expect(articleIds.has(document.href.replace("/knowledge/", ""))).toBe(true);
    const extensionPageCount = data.library.books.reduce((count, book) => count + book.text_pages.length, 0);
    expect(buildLibrarySearchDocuments(data)).toHaveLength(core.searchDocuments.length + extensionPageCount);
  });
});
