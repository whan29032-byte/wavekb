import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { applyBookReadingCorrections, reviewedBookCorrections, sha256Text } from "../scripts/lib/book-reading-corrections.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const book = { id: "sample", pdf_pages: 2, sha256: "a".repeat(64) };
const originalText = "(A) → 5-3-5；0.618、61.8%\n\n原有段落";
const correction = { book_id: book.id, source_pdf_sha256: book.sha256, pages: [{ page: 1, original_text_sha256: sha256Text(originalText), text: "## 标题\n\n" + originalText, reason: "仅恢复已对照的独立标题" }] };
const overlay = (entry = correction) => ({ schema_version: 1, books: [entry] });

test("applies reviewed corrections without mutating source text or page numbering", () => {
  const pages = [{ page: 1, text: originalText }, { page: 2, text: "第二页" }];
  const before = JSON.stringify(pages);
  const result = applyBookReadingCorrections({ book, pages, correction: reviewedBookCorrections(overlay(), [book]).get(book.id), sourcePdfSha256: book.sha256 });
  assert.equal(JSON.stringify(pages), before);
  assert.deepEqual(result.map((page) => page.page), [1, 2]);
  assert.equal(result[0].text, correction.pages[0].text);
  assert.equal(result[1].text, pages[1].text);
  assert.ok(result[0].text.includes("(A) → 5-3-5；0.618、61.8%"));
});

test("rejects a changed source PDF, changed extraction, or wrong book", () => {
  const input = { book, pages: [{ page: 1, text: originalText }], correction, sourcePdfSha256: book.sha256 };
  assert.throws(() => applyBookReadingCorrections({ ...input, sourcePdfSha256: "b".repeat(64) }), /PDF SHA-256 mismatch/);
  assert.throws(() => applyBookReadingCorrections({ ...input, pages: [{ page: 1, text: "新版原文" }] }), /original text changed/);
  assert.throws(() => applyBookReadingCorrections({ ...input, correction: { ...correction, book_id: "other" } }), /source mismatch/);
});

test("rejects unknown books, duplicated pages, out-of-range pages, and missing evidence", () => {
  assert.throws(() => reviewedBookCorrections(overlay(), []), /Unknown/);
  assert.throws(() => reviewedBookCorrections(overlay({ ...correction, pages: [...correction.pages, ...correction.pages] }), [book]), /duplicate corrected page/);
  assert.throws(() => reviewedBookCorrections(overlay({ ...correction, pages: [{ ...correction.pages[0], page: 3 }] }), [book]), /Invalid/);
  assert.throws(() => reviewedBookCorrections(overlay({ ...correction, pages: [{ ...correction.pages[0], reason: "" }] }), [book]), /Incomplete/);
  assert.throws(() => reviewedBookCorrections(overlay({ ...correction, source_pdf_sha256: "b".repeat(64) }), [book]), /version mismatch/);
});

test("compiled four-book content matches the hash-bound overlay and retains all 61 distilled and 321 original pages", () => {
  const library = read("knowledge/source/library.json");
  const corrections = reviewedBookCorrections(read("knowledge/reading/text-corrections.json"), library.books);
  const compiled = read("packages/knowledge/src/knowledge.json");
  let pageCount = 0;
  for (const entry of library.books) {
    const source = read(entry.text_path);
    const digest = sha256Text(fs.readFileSync(path.join(root, entry.pdf_path)));
    const expected = applyBookReadingCorrections({ book: entry, pages: source.pages, correction: corrections.get(entry.id), sourcePdfSha256: digest });
    assert.deepEqual(compiled.library.books.find((value) => value.id === entry.id).text_pages.map(({ illustrations, ...page }) => page), expected);
    pageCount += expected.length;
  }
  assert.equal(pageCount, 382);
  assert.equal(compiled.library.books.filter((book) => book.source_kind !== "original_pdf").reduce((total, book) => total + book.text_pages.length, 0), 61);
  assert.equal(compiled.library.books.find((book) => book.source_kind === "original_pdf").text_pages.length, 321);
  assert.equal(compiled.pages.filter((page) => page.id.startsWith("unit-")).length, 117);
  const publicIds = new Set(compiled.pages.map((page) => page.id));
  for (const page of compiled.pages) assert.ok(page.related_page_ids.every((id) => publicIds.has(id)), page.id);
});

test("all non-cover corrections preserve every original non-whitespace character in order", () => {
  const library = read("knowledge/source/library.json");
  const corrections = read("knowledge/reading/text-corrections.json");
  let checked = 0;
  for (const entry of corrections.books) {
    const source = read(library.books.find((value) => value.id === entry.book_id).text_path);
    for (const page of entry.pages) {
      // This one cover was separately checked against the PDF: a duplicated
      // extracted footer is removed and the visible statistics are restored.
      if (entry.book_id === "chan-theory-complete" && page.page === 1) continue;
      const original = source.pages.find((value) => value.page === page.page).text.replace(/\s/g, "");
      const corrected = page.text.replace(/\s/g, "");
      let cursor = 0;
      for (const character of original) {
        const next = corrected.indexOf(character, cursor);
        assert.notEqual(next, -1, `${entry.book_id}/${page.page}: missing or reordered ${character}`);
        cursor = next + character.length;
      }
      checked += 1;
    }
  }
  assert.equal(checked, 48);
});

test("restored Chan category counts sum to the source total and all 108 lessons remain", () => {
  const compiled = read("packages/knowledge/src/knowledge.json");
  const pages = compiled.library.books.find((value) => value.id === "chan-theory-complete").text_pages;
  const coverageTable = pages.find((page) => page.page === 23).text;
  const counts = [...coverageTable.matchAll(/^\|[^|]+\|\s*(\d+)\s*\|/gm)].map((match) => Number(match[1]));
  assert.deepEqual(counts, [561, 114, 106, 95, 83, 66, 39, 36, 20, 15]);
  assert.equal(counts.reduce((total, value) => total + value, 0), 1135);
  const lessons = [...pages.filter((page) => page.page >= 19 && page.page <= 22).map((page) => page.text).join("\n").matchAll(/教你炒股票(\d+)：/g)].map((match) => Number(match[1]));
  assert.deepEqual(lessons, Array.from({ length: 108 }, (_, index) => index + 1));
});
