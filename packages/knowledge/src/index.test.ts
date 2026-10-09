import { describe, expect, it } from "vitest";
import { childrenOf, getKnowledgePage, knowledgeData, searchKnowledge } from "./index";

describe("knowledge package", () => {
  it("preserves all verified pages with unique identifiers", () => {
    const data = knowledgeData();
    const pages = data.pages;
    expect(data.schema_version).toBe(2);
    expect(pages).toHaveLength(161);
    expect(new Set(pages.map((page) => page.id)).size).toBe(161);
    expect(data.themes).toHaveLength(8);
    expect(data.questions).toHaveLength(18);
    expect(data.relations).toHaveLength(174);
  });

  it("resolves the hierarchy and full page content", () => {
    const page = getKnowledgePage("unit-ewp-method-nominal-vs-real");
    expect(page?.sections.length).toBeGreaterThan(5);
    expect(childrenOf("full-methods").length).toBeGreaterThan(0);
  });

  it("finds a rule from its title or body", () => {
    expect(searchKnowledge("失效条件").length).toBeGreaterThan(0);
    expect(searchKnowledge("第一章").length).toBeGreaterThan(0);
  });

  it("keeps primary and supplement images in separate fields", () => {
    const page = getKnowledgePage("unit-ewp-rule-impulse-core");
    expect(page?.primary_figures.every((asset) => asset.authority === "primary")).toBe(true);
    expect(page?.supplement_figures.every((asset) => asset.authority === "supplement")).toBe(true);
    expect(page?.source_images).toEqual([]);
    expect(page?.figures).toEqual([]);
  });

  it("separates the original primary book and extension documents from the canonical Unit set", () => {
    const books = knowledgeData().library.books;
    expect(books.map((book) => book.id)).toEqual(["elliott-wave-natural-law", "chan-theory-complete", "elliott-wave-principle-eleventh-edition"]);
    expect(books.every((book) => book.pdf_path.startsWith("assets/books/") && (book.id === "elliott-wave-principle-eleventh-edition" ? book.cover_path === "assets/source-pages/page-001.png" : book.cover_path.startsWith("assets/books/")))).toBe(true);
    expect(books.every((book) => book.pdf_pages > 0 && book.source_page_count > 0 && book.reading_guide.length > 0 && book.boundaries.length > 0)).toBe(true);
    expect(books.every((book) => book.text_pages.length === book.pdf_pages && book.text_pages.every((page) => page.text.length > 0))).toBe(true);
    expect(books.every((book) => book.rights_status === "unknown" && book.redistribution_allowed === null)).toBe(true);
    expect(books.every((book) => (book.id === "elliott-wave-principle-eleventh-edition" ? book.source_provenance === "user_provided_original_pdf" : book.source_provenance === "unknown") && book.derivative_of === null)).toBe(true);
  });

  it("retains all 321 original eleventh-edition pages without labelling extracted text as reviewed Units", () => {
    const books = knowledgeData().library.books;
    expect(books.filter((book) => book.role === "core")).toHaveLength(1);
    const original = books.find((book) => book.role === "core")!;
    expect(original).toMatchObject({
      id: "elliott-wave-principle-eleventh-edition", source_kind: "original_pdf", edition: 11,
      source_id: "ewp-11-zh-2021", pdf_pages: 321,
      sha256: "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073",
    });
    expect(original.text_pages.map((page) => page.page)).toEqual(Array.from({ length: 321 }, (_, index) => index + 1));
    expect(original.text_pages.filter((page) => page.extraction?.status === "text_layer_extracted")).toHaveLength(315);
    expect(original.text_pages.filter((page) => page.extraction?.status === "image_only").map((page) => page.page)).toEqual([1, 2, 3, 231, 320, 321]);
    expect(original.text_pages.every((page) => page.extraction?.human_review === "not_complete" && page.source_image?.source_id === "ewp-11-zh-2021" && page.source_image.edition === 11 && page.source_image.pdf_page === page.page)).toBe(true);
  });
});
