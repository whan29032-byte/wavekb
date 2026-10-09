import { createHash } from "node:crypto";

const PRIMARY_BOOK = "elliott-wave-principle-eleventh-edition";
const PRIMARY_SOURCE = "ewp-11-zh-2021";
const PRIMARY_SHA256 = "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Reading priority never rewrites the provenance of the existing canonical Units.
export function validateSourcePageImages({ book, pages, sourcePdfSha256, readAsset }) {
  if (book.source_kind !== "original_pdf") {
    if (pages.some((page) => page.source_image)) throw new Error(`Unexpected original source images: ${book.id}`);
    return;
  }
  if (book.id !== PRIMARY_BOOK || book.source_id !== PRIMARY_SOURCE || book.edition !== 11
    || book.role !== "core" || book.pdf_pages !== 321 || book.source_page_count !== 321
    || book.sha256 !== PRIMARY_SHA256 || sourcePdfSha256 !== PRIMARY_SHA256) {
    throw new Error(`Original source identity mismatch: ${book.id}`);
  }
  if (pages.length !== 321) throw new Error(`Incomplete original source pages: ${book.id}`);
  const seenIds = new Set();
  for (const [index, page] of pages.entries()) {
    const image = page.source_image;
    const expectedPath = `assets/source-pages/page-${String(index + 1).padStart(3, "0")}.png`;
    if (!["text_layer_extracted", "image_only"].includes(page.extraction?.status)
      || page.extraction?.human_review !== "not_complete"
      || (page.extraction.status === "image_only" && page.text !== "[本页无可提取文字，请查看原页。]")) {
      throw new Error(`Original source extraction status mismatch: ${book.id}/${page.page}`);
    }
    if (page.page !== index + 1 || !String(page.text || "").trim()
      || !image || image.source_id !== PRIMARY_SOURCE || image.edition !== 11
      || image.authority !== "primary" || image.figure_type !== "source_page_scan"
      || image.pdf_page !== page.page || image.asset_path !== expectedPath
      || !/^[a-z0-9-]+$/.test(image.id || "") || seenIds.has(image.id)
      || !String(image.caption || "").trim() || !/^[a-f0-9]{64}$/.test(image.asset_sha256 || "")) {
      throw new Error(`Original source page binding mismatch: ${book.id}/${page.page}`);
    }
    seenIds.add(image.id);
    const bytes = readAsset(image.asset_path);
    if (createHash("sha256").update(bytes).digest("hex") !== image.asset_sha256) {
      throw new Error(`Original source image SHA-256 mismatch: ${image.id}`);
    }
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)
      || bytes.toString("ascii", 12, 16) !== "IHDR"
      || !Number.isInteger(image.width) || image.width < 1
      || !Number.isInteger(image.height) || image.height < 1
      || bytes.readUInt32BE(16) !== image.width || bytes.readUInt32BE(20) !== image.height) {
      throw new Error(`Original source PNG dimensions mismatch: ${image.id}`);
    }
  }
}
