import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateSourcePageImages } from "../scripts/lib/source-page-images.mjs";

const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const hash = createHash("sha256").update(bytes).digest("hex");
const book = {
  id: "elliott-wave-principle-eleventh-edition", source_id: "ewp-11-zh-2021", edition: 11,
  role: "core", source_kind: "original_pdf", pdf_pages: 321, source_page_count: 321,
  sha256: "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073",
};
function input() {
  return {
    book: { ...book }, sourcePdfSha256: book.sha256, readAsset: () => bytes,
    pages: Array.from({ length: 321 }, (_, index) => ({
      page: index + 1, text: `原页 ${index + 1}`, extraction: { status: "text_layer_extracted", human_review: "not_complete" },
      source_image: {
        id: `ewp11-original-${index + 1}`, asset_path: `assets/source-pages/page-${String(index + 1).padStart(3, "0")}.png`,
        source_id: book.source_id, edition: 11, authority: "primary", figure_type: "source_page_scan",
        pdf_page: index + 1, caption: `第11版原书 PDF 第 ${index + 1} 页`, asset_sha256: hash, width: 1, height: 1,
      },
    })),
  };
}
test("validates all 321 source-bound original pages without changing text or metadata", () => {
  const value = input();
  const before = JSON.stringify(value.pages);
  let count = 0;
  value.readAsset = () => { count += 1; return bytes; };
  validateSourcePageImages(value);
  assert.equal(count, 321);
  assert.equal(JSON.stringify(value.pages), before);
});
test("rejects relabelled editions, changed PDFs and missing source pages", () => {
  for (const changes of [{ edition: 10 }, { source_id: "ewp-10-zh-2016" }, { role: "extension" }, { pdf_pages: 280 }]) {
    assert.throws(() => validateSourcePageImages({ ...input(), book: { ...book, ...changes } }), /identity mismatch/);
  }
  assert.throws(() => validateSourcePageImages({ ...input(), sourcePdfSha256: "a".repeat(64) }), /identity mismatch/);
  const value = input();
  value.pages.pop();
  assert.throws(() => validateSourcePageImages(value), /Incomplete original/);
});
test("rejects off-by-one pages, duplicate ids, unsafe paths and unbound images", () => {
  for (const changes of [{ pdf_page: 2 }, { id: "ewp11-original-2" }, { asset_path: "../page-001.png" }, { authority: "supplement" }, { source_id: "ewp-10-zh-2016" }]) {
    const value = input();
    Object.assign(value.pages[0].source_image, changes);
    assert.throws(() => validateSourcePageImages(value), /binding mismatch/);
  }
  const value = input();
  delete value.pages[0].source_image;
  assert.throws(() => validateSourcePageImages(value), /binding mismatch/);
});
test("rejects changed pixels, dimensions and non-PNG files", () => {
  const value = input();
  value.readAsset = () => Buffer.from("wrong file");
  assert.throws(() => validateSourcePageImages(value), /SHA-256 mismatch/);
  const dimensions = input();
  dimensions.pages[0].source_image.width = 2;
  assert.throws(() => validateSourcePageImages(dimensions), /dimensions mismatch/);
  const notPng = input();
  notPng.readAsset = () => Buffer.alloc(24);
  notPng.pages[0].source_image.asset_sha256 = createHash("sha256").update(Buffer.alloc(24)).digest("hex");
  assert.throws(() => validateSourcePageImages(notPng), /dimensions mismatch/);
});
test("does not silently accept source-page metadata attached to an unrelated distilled book", () => {
  const value = input();
  value.book.source_kind = "distilled_pdf";
  assert.throws(() => validateSourcePageImages(value), /Unexpected original/);
  assert.doesNotThrow(() => validateSourcePageImages({ book: { id: "other" }, pages: [{ page: 1, text: "蒸馏正文" }] }));
});
test("keeps image-only pages honest instead of treating placeholders as extracted or reviewed text", () => {
  const value = input();
  value.pages[0].extraction.status = "image_only";
  assert.throws(() => validateSourcePageImages(value), /extraction status mismatch/);
  value.pages[0].text = "[本页无可提取文字，请查看原页。]";
  assert.doesNotThrow(() => validateSourcePageImages(value));
  value.pages[0].extraction.human_review = "complete";
  assert.throws(() => validateSourcePageImages(value), /extraction status mismatch/);
});
