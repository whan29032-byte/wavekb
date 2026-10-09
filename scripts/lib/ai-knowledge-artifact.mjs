import crypto from "node:crypto";

export const AI_KNOWLEDGE_SCHEMA_VERSION = "wavekb-ai-knowledge-v1";
export const CORE_BOOK_ID = "elliott-wave-principle-eleventh-edition";
export const SUPPLEMENT_BOOK_ID = "elliott-wave-principle-tenth-edition";

const MAX_PAGE_CHUNK_CHARACTERS = 6_000;
const ORIGINAL_SOURCE_ID = "ewp-11-zh-2021";
const ORIGINAL_PDF_SHA256 = "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073";
const UNIT_SOURCES = [
  { sourceId: "ewp-10-zh-2016", edition: 10, pageCount: 280 },
  { sourceId: ORIGINAL_SOURCE_ID, edition: 11, pageCount: 321 },
];
const EXTENSION_BOOK_IDS = ["elliott-wave-natural-law", "chan-theory-complete"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

export function normalizeSearchText(text) {
  const normalized = String(text ?? "").normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  const bigrams = [];
  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
    const characters = [...match[0]];
    for (let index = 0; index < characters.length - 1; index += 1) bigrams.push(`${characters[index]}${characters[index + 1]}`);
  }
  return [normalized, ...unique(bigrams)].join(" ");
}

function contentText(parts) {
  return unique(parts.flat(Infinity).map((part) => String(part ?? "").trim())).join("\n\n");
}

function supplementChunks(units, initialSequence) {
  return units.map((unit, index) => {
    // A reviewed cross-edition mapping is not the source of the Unit's prose.
    // Cite the actual source, including the 36 Units retained from edition 11.
    const citationRefs = [unit.source];
    const headingPath = unique(citationRefs.flatMap((source) => [source.chapter, source.section]));
    const topics = unique([unit.type, ...(unit.tags || []), ...(unit.chapter_refs || [])]);
    const text = contentText([
      unit.title,
      unit.summary,
      unit.content || unit.statement,
      unit.conditions,
      unit.invalidations,
      unit.guidelines,
      unit.examples,
      unit.common_mistakes,
    ]);
    return {
      chunkId: `${SUPPLEMENT_BOOK_ID}::unit::${unit.id}`,
      bookId: SUPPLEMENT_BOOK_ID,
      sourceId: `${unit.source.source_id}::canonical-units`,
      sequence: initialSequence + index + 1,
      title: unit.title,
      headingPath,
      text,
      kind: "unit",
      authority: "supplement",
      contentStatus: "verified",
      pdfPages: unique(citationRefs.flatMap((source) => source.pdf_pages || [])).sort((left, right) => left - right),
      href: `/knowledge/unit-${unit.id}`,
      topics,
      searchable: normalizeSearchText(contentText([unit.title, headingPath, topics, text])),
      contentSha256: sha256(text),
    };
  });
}

function splitPageText(text) {
  const normalized = String(text ?? "").replace(/\r\n/gu, "\n").trim();
  if (normalized.length <= MAX_PAGE_CHUNK_CHARACTERS) return [normalized];
  const chunks = [];
  let current = "";
  for (const paragraph of normalized.split(/\n\s*\n/gu).map((part) => part.trim()).filter(Boolean)) {
    if (paragraph.length > MAX_PAGE_CHUNK_CHARACTERS) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < paragraph.length; start += MAX_PAGE_CHUNK_CHARACTERS) chunks.push(paragraph.slice(start, start + MAX_PAGE_CHUNK_CHARACTERS));
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_PAGE_CHUNK_CHARACTERS) {
      chunks.push(current);
      current = paragraph;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

function pageChunks(book, pageSource, sourceId, initialSequence, authority) {
  let sequence = initialSequence;
  return [...pageSource.pages].sort((left, right) => left.page - right.page).flatMap((page) => {
    // Reading retains image-only pages, but their explicit placeholder is not
    // extracted book content and must never enter the retrieval corpus.
    if (book.id === CORE_BOOK_ID && page.extraction?.status === "image_only") return [];
    if (!String(page.text ?? "").trim()) throw new Error(`Empty page text: ${book.id} / ${page.page}`);
    const parts = splitPageText(page.text);
    const pageId = `p${String(page.page).padStart(4, "0")}`;
    return parts.map((text, index) => {
      sequence += 1;
      const suffix = parts.length > 1 ? `-c${String(index + 1).padStart(2, "0")}` : "";
      const title = `${book.title} · 第 ${page.page} 页`;
      return {
        chunkId: `${book.id}::page::${pageId}${suffix}`,
        bookId: book.id,
        sourceId,
        sequence,
        title,
        headingPath: [book.title, `第 ${page.page} 页`],
        text,
        kind: "page",
        authority,
        contentStatus: "generated",
        pdfPages: [page.page],
        href: `/knowledge/books/${book.id}#page-${page.page}`,
        topics: [...book.topics],
        searchable: normalizeSearchText(contentText([title, book.topics, text])),
        contentSha256: sha256(text),
      };
    });
  });
}

export function buildAiKnowledgeArtifact({ units, library, pageSources }) {
  const originalBook = library.books.find((book) => book.id === CORE_BOOK_ID);
  if (!originalBook || originalBook.role !== "core" || originalBook.source_kind !== "original_pdf"
    || originalBook.source_id !== ORIGINAL_SOURCE_ID || originalBook.edition !== 11
    || originalBook.pdf_pages !== 321 || originalBook.sha256 !== ORIGINAL_PDF_SHA256) {
    throw new Error("The primary book must be the approved original eleventh-edition PDF");
  }
  if (library.books.length !== 3 || EXTENSION_BOOK_IDS.some((id) => !library.books.some((book) => book.id === id))) {
    throw new Error("Unexpected published source library");
  }
  for (const unit of units) {
    const source = UNIT_SOURCES.find((candidate) => candidate.sourceId === unit.source?.source_id);
    if (!source || !unit.source.pdf_pages?.length
      || unit.source.pdf_pages.some((page) => !Number.isInteger(page) || page < 1 || page > source.pageCount)) {
      throw new Error(`Canonical Unit has an unknown or invalid actual source: ${unit.id}`);
    }
  }

  const books = [];
  const chunks = [];
  function appendPageBook(book, authority) {
    const pageSource = pageSources[book.id];
    if (!pageSource || pageSource.book_id !== book.id) throw new Error(`Missing page source for ${book.id}`);
    const original = book.id === CORE_BOOK_ID;
    if (original && (pageSource.source_id !== ORIGINAL_SOURCE_ID || pageSource.edition !== 11
      || pageSource.source_pdf_sha256 !== ORIGINAL_PDF_SHA256 || pageSource.pages.length !== 321
      || new Set(pageSource.pages.map((page) => page.page)).size !== 321
      || pageSource.pages.some((page) => !Number.isInteger(page.page) || page.page < 1 || page.page > 321
        || !["text_layer_extracted", "image_only"].includes(page.extraction?.status)))) {
      throw new Error("Incomplete or unapproved eleventh-edition page source");
    }
    const sourceId = original ? ORIGINAL_SOURCE_ID : `${book.id}::distilled-pdf`;
    books.push({
      bookId: book.id,
      title: book.title,
      role: original ? "core" : "extension",
      description: book.description,
      coverAsset: book.cover_path,
      topics: [...book.topics],
      readingGuides: [...book.reading_guide],
      boundaries: [...book.boundaries],
      rightsStatus: book.rights_status,
      sourceArtifacts: [{
        sourceId,
        kind: original ? "original_pdf" : "distilled_pdf",
        sha256: book.sha256,
        pageCount: book.pdf_pages,
        ...(original ? { edition: 11 } : {}),
        authority,
        derivation: original ? "original" : "distilled",
        redistributionAllowed: book.redistribution_allowed,
      }],
    });
    chunks.push(...pageChunks(book, pageSource, sourceId, chunks.length, authority));
  }
  appendPageBook(originalBook, "primary");

  books.push({
    bookId: SUPPLEMENT_BOOK_ID,
    title: "艾略特波浪理论：第10版补充与版本对照知识",
    role: "extension",
    description: "保留既有已核验知识单元的正文与真实版本出处，作为第11版原书的补充和版本对照；每条引用均指向该单元实际来源，不将第11版条目误标为第10版。",
    coverAsset: "assets/books/elliott-wave-principle-tenth-edition-cover.svg",
    topics: unique(units.flatMap((unit) => unit.tags || [])).sort(),
    readingGuides: [],
    boundaries: [],
    rightsStatus: "unknown",
    sourceArtifacts: UNIT_SOURCES.map((source) => ({
      sourceId: `${source.sourceId}::canonical-units`,
      kind: "canonical_units",
      sha256: sha256(stableJson(units.filter((unit) => unit.source.source_id === source.sourceId))),
      pageCount: source.pageCount,
      edition: source.edition,
      authority: "supplement",
      derivation: "verified",
      redistributionAllowed: null,
    })),
  });
  chunks.push(...supplementChunks(units, chunks.length));
  for (const id of EXTENSION_BOOK_IDS) appendPageBook(library.books.find((book) => book.id === id), "contextual");

  const semanticPayload = { schemaVersion: AI_KNOWLEDGE_SCHEMA_VERSION, books, chunks };
  return { schemaVersion: AI_KNOWLEDGE_SCHEMA_VERSION, knowledgeVersion: sha256(stableJson(semanticPayload)), books, chunks };
}
