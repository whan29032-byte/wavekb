import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const source = read("knowledge/source/book-text/elliott-wave-principle-eleventh-edition.json");
const compiled = read("packages/knowledge/src/knowledge.json").library.books.find((book) => book.id === source.book_id);
const retrieval = read("ai-gateway/knowledge/retrieval-index.json");
// Reviewed PDF/font evidence: CID 14 in Adobe-Korea1 is a mathematical minus,
// not disposable whitespace. These literal source fragments guard the actual
// generated files, independently of the producer's own text-cleaning function.
const reviewed = [
  { page: 134, count: 4, fragments: ["0.6182=1-0.618", "0.6183=0.618-0.6182", "0.6184=0.6182-0.6183", "0.6185=0.6183-0.6184"] },
  { page: 139, count: 1, fragments: ["(5-1)/2=0.618"] },
  { page: 179, count: 6, fragments: ["1022-(1022-572)×0.618=744", "1005-(1005-572)×0.618=", "1005-(885-784)×2.618=742"] },
  { page: 188, count: 5, fragments: ["5+或-0", "8+或-0", "13+或-0", "21+或-1", "34+或-1"] },
  { page: 189, count: 4, fragments: ["55+或-2", "89+或-2", "144+或-3", "233+或-3"] },
];

test("the import audit distinguishes removed list markers from recovered mathematical operators", () => {
  assert.equal(source.source_pdf_sha256, "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073");
  assert.deepEqual(source.pages.filter((page) => page.extraction.mapped_math_characters.length).map((page) => page.page), reviewed.map((page) => page.page));
  assert.equal(source.pages.reduce((count, page) => count + (page.extraction.raw_control_characters["U+0007"] || 0), 0), 79);
  assert.equal(source.pages.reduce((count, page) => count + (page.extraction.removed_control_characters["U+0007"] || 0), 0), 79);
  assert.equal(source.pages.reduce((count, page) => count + (page.extraction.raw_control_characters["U+000E"] || 0), 0), 20);
  for (const page of source.pages) {
    assert.equal(page.extraction.removed_control_characters["U+000E"], undefined);
    assert.equal(page.extraction.human_review, "not_complete");
    assert.doesNotMatch(page.text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u);
  }
});

for (const expected of reviewed) {
  test(`original PDF page ${expected.page}: preserves the exact minus expressions through reading and AI retrieval`, () => {
    const page = source.pages[expected.page - 1];
    assert.equal(page.page, expected.page);
    assert.deepEqual(page.extraction.mapped_math_characters.map(({ source_codepoint, replacement, count }) => ({ source_codepoint, replacement, count })), [{ source_codepoint: "U+000E", replacement: "-", count: expected.count }]);
    const compact = page.text.replace(/\s/gu, "");
    for (const fragment of expected.fragments) assert.ok(compact.includes(fragment), `Missing source expression: ${fragment}`);
    assert.equal(compiled.text_pages[expected.page - 1].text, page.text);
    const chunks = retrieval.chunks.filter((chunk) => chunk.bookId === source.book_id && chunk.pdfPages.includes(expected.page));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, page.text);
    assert.equal(chunks[0].sourceId, "ewp-11-zh-2021");
    assert.equal(chunks[0].contentStatus, "generated");
  });
}
