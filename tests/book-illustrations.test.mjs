import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { applyBookIllustrations, reviewedBookIllustrations } from "../scripts/lib/book-illustrations.mjs";
import { applyBookReadingCorrections, reviewedBookCorrections } from "../scripts/lib/book-reading-corrections.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
bytes.write("IHDR", 12); bytes.writeUInt32BE(20, 16); bytes.writeUInt32BE(30, 20);
const book = { id: "sample", pdf_pages: 2, source_page_count: 20, sha256: "a".repeat(64) };
const figure = { id: "sample-figure", reading_page: 2, image_pdf_page: 1, source_image_name: "FormXob.abc.jpg", source_image_sha256: "b".repeat(64), crop: [0, 0, 20, 30], asset_path: "assets/books/sample/figure-p001.png", asset_sha256: hash(bytes), width: 20, height: 30, after_heading: "精确标题", caption: "原图", original_pdf_page: 15, original_book_page: 10 };
const entry = { book_id: book.id, source_pdf_sha256: book.sha256, illustrations: [figure] };
const document = (value = entry) => ({ schema_version: 1, books: [value] });
const pages = [{ page: 1, text: "正文第一页" }, { page: 2, text: "## 精确标题\n\n5-3-5、(A)、0.618 原文" }];
const apply = (overrides = {}) => applyBookIllustrations({ book, pages, illustrationSet: reviewedBookIllustrations(document(), [book]).get(book.id), sourcePdfSha256: book.sha256, readAsset: () => bytes, ...overrides });

test("adds explicitly cross-page illustrations without mutating or rewriting any text", () => {
  const before = JSON.stringify(pages);
  const result = apply();
  assert.equal(JSON.stringify(pages), before);
  assert.deepEqual(result.map(({ illustrations, ...page }) => page), pages);
  assert.equal(result[0].illustrations, undefined);
  assert.equal(result[1].illustrations[0].image_pdf_page, 1);
});

test("fails closed for unsafe paths, unknown books, duplicate identity and incomplete source evidence", () => {
  assert.throws(() => reviewedBookIllustrations(document(), []), /Unknown/);
  for (const invalid of [{ asset_path: "assets/books/sample/../secret.png" }, { asset_path: "assets/books/other/figure.png" }, { source_image_sha256: "" }, { reading_page: 3 }, { crop: [0, 0, 19, 30] }, { original_pdf_page: 21 }]) {
    assert.throws(() => reviewedBookIllustrations(document({ ...entry, illustrations: [{ ...figure, ...invalid }] }), [book]));
  }
  assert.throws(() => reviewedBookIllustrations(document({ ...entry, illustrations: [figure, figure] }), [book]), /duplicate/);
  assert.throws(() => reviewedBookIllustrations(document({ ...entry, source_pdf_sha256: "c".repeat(64) }), [book]), /version mismatch/);
});

test("rejects changed source PDFs, missing or ambiguous headings, wrong bytes and dimensions", () => {
  assert.throws(() => apply({ sourcePdfSha256: "c".repeat(64) }), /PDF SHA-256 mismatch/);
  assert.throws(() => apply({ pages: [{ page: 2, text: "## 模糊标题" }] }), /heading missing/);
  assert.throws(() => apply({ pages: [{ page: 2, text: "## 精确标题\n\n## 精确标题" }] }), /ambiguous/);
  assert.throws(() => apply({ readAsset: () => Buffer.from("changed") }), /asset SHA-256 mismatch/);
  assert.throws(() => apply({ illustrationSet: { ...entry, illustrations: [{ ...figure, width: 21 }] } }), /dimensions mismatch/);
});

test("reviewed 14 images match compiled reading pages, byte hashes, dimensions and exact source headings", () => {
  const library = read("knowledge/source/library.json");
  const illustrations = reviewedBookIllustrations(read("knowledge/reading/book-illustrations.json"), library.books);
  const corrections = reviewedBookCorrections(read("knowledge/reading/text-corrections.json"), library.books);
  const compiled = read("packages/knowledge/src/knowledge.json");
  assert.equal(illustrations.size, 1);
  const natural = illustrations.get("elliott-wave-natural-law");
  assert.equal(natural.illustrations.length, 14);
  assert.deepEqual(natural.illustrations.map((image) => image.reading_page).sort((a, b) => a - b), [5, 7, 8, 9, 11, 12, 16, 18, 21, 22, 23, 24, 26, 28]);
  const grid = natural.illustrations.find((image) => image.reading_page === 18);
  assert.equal(grid.image_pdf_page, 17);
  assert.ok(grid.caption.includes("网格"));
  assert.ok(natural.illustrations.find((image) => image.reading_page === 26).caption.includes("类比"));
  for (const book of library.books) {
    const source = read(book.text_path);
    const sourcePdfSha256 = hash(fs.readFileSync(path.join(root, book.pdf_path)));
    const corrected = applyBookReadingCorrections({ book, pages: source.pages, correction: corrections.get(book.id), sourcePdfSha256 });
    const expected = applyBookIllustrations({ book, pages: corrected, illustrationSet: illustrations.get(book.id), sourcePdfSha256, readAsset: (file) => fs.readFileSync(path.join(root, file)) });
    assert.deepEqual(compiled.library.books.find((entry) => entry.id === book.id).text_pages, expected);
    assert.deepEqual(expected.map(({ illustrations, ...page }) => page), corrected);
  }
});
