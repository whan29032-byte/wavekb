import { describe, expect, it } from "vitest";
import { CORE_BOOK_ID, getKnowledgeBook, getKnowledgeBookCatalog } from "./book-catalog";

describe("knowledge book catalog", () => {
  it("presents the core work and two extension works as three distinct books", () => {
    const books = getKnowledgeBookCatalog();

    expect(books).toHaveLength(3);
    expect(books.map((book) => book.id)).toEqual([
      CORE_BOOK_ID,
      "elliott-wave-natural-law",
      "chan-theory-complete",
    ]);
    expect(books[0].kind).toBe("core");
    expect(books.slice(1).every((book) => book.kind === "extension")).toBe(true);
    expect(new Set(books.map((book) => book.href)).size).toBe(3);
  });

  it("keeps extension source metadata separate from the core rule book", () => {
    expect(getKnowledgeBook(CORE_BOOK_ID)?.source).toBeNull();
    expect(getKnowledgeBook("elliott-wave-natural-law")?.source?.pdf_pages).toBe(36);
  });
});
