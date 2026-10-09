import { describe, expect, it } from "vitest";
import { CORE_BOOK_ID, SOURCE_BOOK_ID, UNIT_BOOK_ID, getKnowledgeBook, getKnowledgeBookCatalog } from "./book-catalog";

describe("knowledge book catalog", () => {
  it("prioritizes the eleventh edition without confusing reading mode and edition role", () => {
    const books = getKnowledgeBookCatalog();

    expect(CORE_BOOK_ID).toBe(SOURCE_BOOK_ID);
    expect(books).toHaveLength(4);
    expect(books.map((book) => book.id)).toEqual([
      CORE_BOOK_ID,
      UNIT_BOOK_ID,
      "elliott-wave-natural-law",
      "chan-theory-complete",
    ]);
    expect(books.map((book) => book.role)).toEqual(["core", "supplement", "extension", "extension"]);
    expect(books[0].kind).toBe("extension");
    expect(books[1].kind).toBe("core");
    expect(new Set(books.map((book) => book.href)).size).toBe(4);
  });

  it("keeps extension source metadata separate from the core rule book", () => {
    expect(getKnowledgeBook(CORE_BOOK_ID)?.source).toMatchObject({ source_id: "ewp-11-zh-2021", edition: 11, source_kind: "original_pdf", pdf_pages: 321 });
    expect(getKnowledgeBook(CORE_BOOK_ID)?.sourceArtifactLabel).toBe("第11版原书 PDF");
    expect(getKnowledgeBook(CORE_BOOK_ID)?.verifiedUnitCount).toBeNull();
    expect(getKnowledgeBook(CORE_BOOK_ID)?.readingViewCount).toBe(321);
    expect(getKnowledgeBook(UNIT_BOOK_ID)?.source).toBeNull();
    expect(getKnowledgeBook("elliott-wave-natural-law")?.source?.pdf_pages).toBe(36);
  });

  it("separates verified Units from reading views and labels derived PDFs truthfully", () => {
    const core = getKnowledgeBook(UNIT_BOOK_ID);
    const extension = getKnowledgeBook("elliott-wave-natural-law");

    expect(core?.verifiedUnitCount).toBe(117);
    expect(core?.readingViewCount).toBe(146);
    expect(core?.itemCount).toBe(117);
    expect(core?.title).toContain("第10版补充与版本对照");
    expect(core?.description).toContain("81个");
    expect(core?.description).toContain("36个");
    expect(extension?.sourceArtifactLabel).toBe("WaveKB 蒸馏 PDF");
  });
});
