import crypto from "node:crypto";

export const AI_KNOWLEDGE_SCHEMA_VERSION = "wavekb-ai-knowledge-v1";
export const CORE_BOOK_ID = "elliott-wave-principle-tenth-edition";

const MAX_PAGE_CHUNK_CHARACTERS = 6_000;

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

function coreChunks(units, sourceId) {
  return units.map((unit, index) => {
    const sourceRefs = unit.source_refs?.length ? unit.source_refs : [unit.source].filter(Boolean);
    const primaryRefs = sourceRefs.filter((source) => source.authority === "primary");
    const citationRefs = primaryRefs.length ? primaryRefs : sourceRefs;
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
      chunkId: `${CORE_BOOK_ID}::unit::${unit.id}`,
      bookId: CORE_BOOK_ID,
      sourceId,
      sequence: index + 1,
      title: unit.title,
      headingPath,
      text,
      kind: "unit",
      authority: citationRefs[0]?.authority === "supplement" ? "supplement" : "primary",
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

function extensionChunks(book, pageSource, sourceId, initialSequence) {
  let sequence = initialSequence;
  return [...pageSource.pages].sort((left, right) => left.page - right.page).flatMap((page) => {
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
        authority: "contextual",
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
  const coreSourceId = unique(units.flatMap((unit) => (unit.source_refs?.length ? unit.source_refs : [unit.source]).map((source) => source?.source_id)))[0];
  if (!coreSourceId) throw new Error("Canonical Units do not identify a source");

  const coreSourceSha = sha256(stableJson(units));
  const books = [{
    bookId: CORE_BOOK_ID,
    title: "艾略特波浪理论：市场行为的关键（原书第10版）",
    role: "core",
    description: "按原书来源整理的已核验规则、指南、识别步骤与失效边界。",
    coverAsset: "assets/books/elliott-wave-principle-tenth-edition-cover.svg",
    topics: unique(units.flatMap((unit) => unit.tags || [])).sort(),
    readingGuides: [],
    boundaries: [],
    rightsStatus: "unknown",
    sourceArtifacts: [{
      sourceId: coreSourceId,
      kind: "canonical_units",
      sha256: coreSourceSha,
      pageCount: null,
      authority: "primary",
      derivation: "verified",
      redistributionAllowed: null,
    }],
  }];

  const chunks = coreChunks(units, coreSourceId);
  for (const book of library.books) {
    const pageSource = pageSources[book.id];
    if (!pageSource || pageSource.book_id !== book.id) throw new Error(`Missing page source for ${book.id}`);
    const sourceId = `${book.id}::distilled-pdf`;
    books.push({
      bookId: book.id,
      title: book.title,
      role: "extension",
      description: book.description,
      coverAsset: book.cover_path,
      topics: [...book.topics],
      readingGuides: [...book.reading_guide],
      boundaries: [...book.boundaries],
      rightsStatus: book.rights_status,
      sourceArtifacts: [{
        sourceId,
        kind: "distilled_pdf",
        sha256: book.sha256,
        pageCount: book.pdf_pages,
        authority: "contextual",
        derivation: "distilled",
        redistributionAllowed: book.redistribution_allowed,
      }],
    });
    chunks.push(...extensionChunks(book, pageSource, sourceId, chunks.length));
  }

  const semanticPayload = { schemaVersion: AI_KNOWLEDGE_SCHEMA_VERSION, books, chunks };
  return { schemaVersion: AI_KNOWLEDGE_SCHEMA_VERSION, knowledgeVersion: sha256(stableJson(semanticPayload)), books, chunks };
}
