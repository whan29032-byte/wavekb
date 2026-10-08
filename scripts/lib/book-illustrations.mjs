import { createHash } from "node:crypto";

const digest = /^[a-f0-9]{64}$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// A separately reviewed presentation layer: never rewrite source text or Units.
export function reviewedBookIllustrations(document, books) {
  if (document?.schema_version !== 1 || !Array.isArray(document.books)) throw new Error("Invalid book illustrations schema");
  const known = new Map(books.map((book) => [book.id, book]));
  const reviewed = new Map();
  const ids = new Set();
  const paths = new Set();
  for (const entry of document.books) {
    const book = known.get(entry?.book_id);
    if (!book || reviewed.has(book.id)) throw new Error(`Unknown or duplicate illustrated book: ${entry?.book_id}`);
    if (!digest.test(entry.source_pdf_sha256 || "") || entry.source_pdf_sha256 !== book.sha256) throw new Error(`Illustration PDF version mismatch: ${book.id}`);
    if (!Array.isArray(entry.illustrations) || !entry.illustrations.length) throw new Error(`Missing illustrations: ${book.id}`);
    for (const figure of entry.illustrations) {
      if (!/^[a-z0-9-]+$/.test(figure.id || "") || ids.has(figure.id)) throw new Error(`Invalid or duplicate illustration id: ${figure.id}`);
      ids.add(figure.id);
      if (!/^assets\/books\/[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(figure.asset_path || "")
        || !figure.asset_path.startsWith(`assets/books/${book.id}/`) || paths.has(figure.asset_path)) throw new Error(`Unsafe or duplicate illustration path: ${figure.asset_path}`);
      paths.add(figure.asset_path);
      for (const field of ["reading_page", "image_pdf_page"]) {
        if (!Number.isInteger(figure[field]) || figure[field] < 1 || figure[field] > book.pdf_pages) throw new Error(`Invalid illustration ${field}: ${figure.id}`);
      }
      for (const field of ["original_pdf_page", "original_book_page"]) {
        if (!Number.isInteger(figure[field]) || figure[field] < 1 || figure[field] > book.source_page_count) throw new Error(`Invalid illustration ${field}: ${figure.id}`);
      }
      if (!digest.test(figure.asset_sha256 || "") || !digest.test(figure.source_image_sha256 || "")
        || !/^FormXob\.[a-f0-9]+\.jpg$/.test(figure.source_image_name || "")) throw new Error(`Missing illustration provenance: ${figure.id}`);
      if (![figure.after_heading, figure.caption].every((value) => typeof value === "string" && value.trim())) throw new Error(`Missing illustration placement or caption: ${figure.id}`);
      const crop = figure.crop;
      if (!Array.isArray(crop) || crop.length !== 4 || !crop.every((value) => Number.isInteger(value) && value >= 0)
        || crop[2] <= crop[0] || crop[3] <= crop[1] || crop[2] - crop[0] !== figure.width || crop[3] - crop[1] !== figure.height) throw new Error(`Invalid illustration crop dimensions: ${figure.id}`);
    }
    reviewed.set(book.id, entry);
  }
  return reviewed;
}

export function applyBookIllustrations({ book, pages, illustrationSet, sourcePdfSha256, readAsset }) {
  if (sourcePdfSha256 !== book.sha256) throw new Error(`Illustration source PDF SHA-256 mismatch: ${book.id}`);
  if (!illustrationSet) return pages.map((page) => ({ ...page }));
  if (illustrationSet.book_id !== book.id || illustrationSet.source_pdf_sha256 !== sourcePdfSha256) throw new Error(`Illustration source mismatch: ${book.id}`);
  const byPage = new Map();
  for (const figure of illustrationSet.illustrations) {
    const page = pages.find((candidate) => candidate.page === figure.reading_page);
    const matchingHeadings = page?.text.split(/\r?\n/).filter((line) => line.match(/^#{2,4}\s+(.+)$/)?.[1] === figure.after_heading) || [];
    if (matchingHeadings.length !== 1) throw new Error(`Illustration heading missing or ambiguous: ${figure.id}`);
    const bytes = readAsset(figure.asset_path);
    if (createHash("sha256").update(bytes).digest("hex") !== figure.asset_sha256) throw new Error(`Illustration asset SHA-256 mismatch: ${figure.id}`);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString("ascii", 12, 16) !== "IHDR"
      || bytes.readUInt32BE(16) !== figure.width || bytes.readUInt32BE(20) !== figure.height) throw new Error(`Illustration PNG dimensions mismatch: ${figure.id}`);
    const figures = byPage.get(page.page) || [];
    figures.push({ ...figure });
    byPage.set(page.page, figures);
  }
  return pages.map((page) => ({ ...page, ...(byPage.has(page.page) ? { illustrations: byPage.get(page.page) } : {}) }));
}
