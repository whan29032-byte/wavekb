import { createHash } from "node:crypto";

const digestPattern = /^[a-f0-9]{64}$/;
export const sha256Text = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export function reviewedBookCorrections(document, books) {
  if (document?.schema_version !== 1 || !Array.isArray(document.books)) {
    throw new Error("Invalid book reading corrections schema");
  }
  const knownBooks = new Map(books.map((book) => [book.id, book]));
  const reviewed = new Map();
  for (const correction of document.books) {
    const book = knownBooks.get(correction?.book_id);
    if (!book || reviewed.has(book.id)) throw new Error(`Unknown or duplicate corrected book: ${correction?.book_id}`);
    if (!digestPattern.test(correction.source_pdf_sha256 || "") || correction.source_pdf_sha256 !== book.sha256) {
      throw new Error(`Reading correction PDF version mismatch: ${book.id}`);
    }
    if (!Array.isArray(correction.pages)) throw new Error(`Missing corrected pages: ${book.id}`);
    const seenPages = new Set();
    for (const page of correction.pages) {
      if (!Number.isInteger(page.page) || page.page < 1 || page.page > book.pdf_pages || seenPages.has(page.page)) {
        throw new Error(`Invalid or duplicate corrected page: ${book.id}/${page.page}`);
      }
      seenPages.add(page.page);
      if (!digestPattern.test(page.original_text_sha256 || "") || typeof page.text !== "string" || !page.text.trim()
        || typeof page.reason !== "string" || !page.reason.trim()) {
        throw new Error(`Incomplete reading correction: ${book.id}/${page.page}`);
      }
    }
    reviewed.set(book.id, correction);
  }
  return reviewed;
}

export function applyBookReadingCorrections({ book, pages, correction, sourcePdfSha256 }) {
  if (sourcePdfSha256 !== book.sha256) throw new Error(`Source PDF SHA-256 mismatch: ${book.id}`);
  if (!correction) return pages.map((page) => ({ ...page }));
  if (correction.book_id !== book.id || correction.source_pdf_sha256 !== sourcePdfSha256) {
    throw new Error(`Reading correction source mismatch: ${book.id}`);
  }
  const replacements = new Map(correction.pages.map((page) => [page.page, page]));
  const corrected = pages.map((page) => {
    const replacement = replacements.get(page.page);
    if (!replacement) return { ...page };
    if (sha256Text(page.text) !== replacement.original_text_sha256) {
      throw new Error(`Reading correction original text changed: ${book.id}/${page.page}`);
    }
    replacements.delete(page.page);
    return { ...page, text: replacement.text };
  });
  if (replacements.size) throw new Error(`Reading correction page missing in source: ${book.id}`);
  return corrected;
}
