import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PUBLISHED_BOOK_IDS = [
  "elliott-wave-principle-eleventh-edition",
  "elliott-wave-principle-tenth-edition",
  "elliott-wave-natural-law",
  "chan-theory-complete",
] as const;

export type PublishedBookId = typeof PUBLISHED_BOOK_IDS[number];
export type KnowledgeKind = "unit" | "page";
export type KnowledgeAuthority = "primary" | "supplement" | "contextual";
export type KnowledgeContentStatus = "verified" | "generated";

export type KnowledgeSourceArtifact = {
  sourceId: string;
  authority: KnowledgeAuthority;
  [key: string]: unknown;
};

export type KnowledgeBook = {
  bookId: PublishedBookId;
  title: string;
  role: "core" | "extension";
  sourceArtifacts: KnowledgeSourceArtifact[];
  [key: string]: unknown;
};

export type BookCatalog = readonly KnowledgeBook[];

export type KnowledgeChunk = {
  chunkId: string;
  bookId: PublishedBookId;
  sourceId: string;
  sequence: number;
  title: string;
  headingPath: string[];
  text: string;
  kind: KnowledgeKind;
  authority: KnowledgeAuthority;
  contentStatus: KnowledgeContentStatus;
  pdfPages: number[];
  href: string;
  topics: string[];
  searchable: string;
  contentSha256: string;
};

export type KnowledgeIndex = {
  schemaVersion: "wavekb-ai-knowledge-v1";
  knowledgeVersion: string;
  books: KnowledgeBook[];
  chunks: KnowledgeChunk[];
};

export const DEFAULT_KNOWLEDGE_INDEX_PATH = fileURLToPath(
  new URL("../../knowledge/retrieval-index.json", import.meta.url),
);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KNOWLEDGE_KINDS = new Set<KnowledgeKind>(["unit", "page"]);
const KNOWLEDGE_AUTHORITIES = new Set<KnowledgeAuthority>([
  "primary",
  "supplement",
  "contextual",
]);
const KNOWLEDGE_CONTENT_STATUSES = new Set<KnowledgeContentStatus>(["verified", "generated"]);
const BOOK_ROLES = new Set(["core", "extension"] as const);
const IMAGE_ONLY_ORIGINAL_PAGES = new Set([1, 2, 3, 231, 320, 321]);
const SOURCE_CONTRACTS: Record<PublishedBookId, {
  role: "core" | "extension";
  kind: KnowledgeKind;
  status: KnowledgeContentStatus;
  authority: KnowledgeAuthority;
  sources: { sourceId: string; kind: string; pageCount: number; derivation: string; edition?: number; sha256?: string }[];
}> = {
  "elliott-wave-principle-eleventh-edition": {
    role: "core", kind: "page", status: "generated", authority: "primary",
    sources: [{
      sourceId: "ewp-11-zh-2021", kind: "original_pdf", pageCount: 321, edition: 11,
      derivation: "original", sha256: "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073",
    }],
  },
  "elliott-wave-principle-tenth-edition": {
    role: "extension", kind: "unit", status: "verified", authority: "supplement",
    sources: [
      { sourceId: "ewp-10-zh-2016::canonical-units", kind: "canonical_units", pageCount: 280, edition: 10, derivation: "verified" },
      { sourceId: "ewp-11-zh-2021::canonical-units", kind: "canonical_units", pageCount: 321, edition: 11, derivation: "verified" },
    ],
  },
  "elliott-wave-natural-law": {
    role: "extension", kind: "page", status: "generated", authority: "contextual",
    sources: [{
      sourceId: "elliott-wave-natural-law::distilled-pdf", kind: "distilled_pdf", pageCount: 36, derivation: "distilled",
      sha256: "1f82195dec1e89f9b5012776cc3913daf001bf04f9c077a885618a856b9b226a",
    }],
  },
  "chan-theory-complete": {
    role: "extension", kind: "page", status: "generated", authority: "contextual",
    sources: [{
      sourceId: "chan-theory-complete::distilled-pdf", kind: "distilled_pdf", pageCount: 25, derivation: "distilled",
      sha256: "9bd13525f6c2ef05faf38c6f604645561ae9948cb0105d4a6ee7c6b3a2e8bc3a",
    }],
  },
};

function invalidArtifact(): never {
  throw new Error("invalid knowledge index artifact");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value || value.length > 20_000) invalidArtifact();
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalidArtifact();
  return value as string[];
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)
    || value.some((item) => !Number.isInteger(item) || Number(item) <= 0)) {
    invalidArtifact();
  }
  return value as number[];
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>): T {
  if (typeof value !== "string" || !allowed.has(value as T)) invalidArtifact();
  return value as T;
}

function publishedBookId(value: unknown): PublishedBookId {
  if (typeof value !== "string" || !PUBLISHED_BOOK_IDS.includes(value as PublishedBookId)) {
    invalidArtifact();
  }
  return value as PublishedBookId;
}

function parseBook(value: unknown): KnowledgeBook {
  if (!isRecord(value)) invalidArtifact();
  if (!Array.isArray(value.sourceArtifacts)) invalidArtifact();
  const sourceArtifacts = value.sourceArtifacts.map((source): KnowledgeSourceArtifact => {
    if (!isRecord(source)) invalidArtifact();
    return {
      ...source,
      sourceId: requiredString(source, "sourceId"),
      authority: enumValue(source.authority, KNOWLEDGE_AUTHORITIES),
    };
  });
  return {
    ...value,
    bookId: publishedBookId(value.bookId),
    title: requiredString(value, "title"),
    role: enumValue(value.role, BOOK_ROLES),
    sourceArtifacts,
  };
}

function parseChunk(value: unknown): KnowledgeChunk {
  if (!isRecord(value)) invalidArtifact();
  const href = requiredString(value, "href");
  if (!href.startsWith("/knowledge/") || href.includes("://") || href.includes("..")) {
    invalidArtifact();
  }
  const sequence = value.sequence;
  if (!Number.isInteger(sequence) || Number(sequence) < 1) invalidArtifact();
  const contentSha256 = requiredString(value, "contentSha256");
  if (!SHA256_PATTERN.test(contentSha256)) invalidArtifact();
  return {
    chunkId: requiredString(value, "chunkId"),
    bookId: publishedBookId(value.bookId),
    sourceId: requiredString(value, "sourceId"),
    sequence: Number(sequence),
    title: requiredString(value, "title"),
    headingPath: stringArray(value.headingPath),
    text: requiredString(value, "text"),
    kind: enumValue(value.kind, KNOWLEDGE_KINDS),
    authority: enumValue(value.authority, KNOWLEDGE_AUTHORITIES),
    contentStatus: enumValue(value.contentStatus, KNOWLEDGE_CONTENT_STATUSES),
    pdfPages: numberArray(value.pdfPages),
    href,
    topics: stringArray(value.topics),
    searchable: requiredString(value, "searchable"),
    contentSha256,
  };
}

function validateBookRoleCoherence(books: KnowledgeBook[], chunks: KnowledgeChunk[]): void {
  const allSourceIds = new Set<string>();
  for (const book of books) {
    const contract = SOURCE_CONTRACTS[book.bookId];
    const firstSource = contract.sources[0];
    if (!firstSource) invalidArtifact();
    if (book.role !== contract.role || book.sourceArtifacts.length !== contract.sources.length) invalidArtifact();
    const sources = new Map<string, KnowledgeSourceArtifact>();
    for (const [index, source] of book.sourceArtifacts.entries()) {
      const expected = contract.sources[index];
      if (!expected) invalidArtifact();
      if (allSourceIds.has(source.sourceId) || source.sourceId !== expected.sourceId
        || source.authority !== contract.authority || source.kind !== expected.kind
        || source.pageCount !== expected.pageCount || source.derivation !== expected.derivation
        || source.edition !== expected.edition || typeof source.sha256 !== "string"
        || !SHA256_PATTERN.test(source.sha256) || (expected.sha256 && source.sha256 !== expected.sha256)) {
        invalidArtifact();
      }
      allSourceIds.add(source.sourceId);
      sources.set(source.sourceId, source);
    }
    const bookChunks = chunks.filter((chunk) => chunk.bookId === book.bookId);
    if (!bookChunks.length) invalidArtifact();
    for (const chunk of bookChunks) {
      const source = sources.get(chunk.sourceId);
      if (!source || chunk.authority !== contract.authority || chunk.kind !== contract.kind
        || chunk.contentStatus !== contract.status || !chunk.pdfPages.length
        || chunk.pdfPages.some((page) => page > Number(source.pageCount))) {
        invalidArtifact();
      }
      if (contract.kind === "page") {
        const page = chunk.pdfPages[0];
        if (page === undefined) invalidArtifact();
        if (chunk.pdfPages.length !== 1
          || chunk.href !== `/knowledge/books/${book.bookId}#page-${page}`
          || !chunk.chunkId.startsWith(`${book.bookId}::page::p${String(page).padStart(4, "0")}`)) invalidArtifact();
        if (book.role === "core" && (IMAGE_ONLY_ORIGINAL_PAGES.has(page)
          || chunk.text.includes("[本页无可提取文字，请查看原页。]"))) invalidArtifact();
      } else if (!chunk.chunkId.startsWith(`${book.bookId}::unit::`)
        || chunk.href !== `/knowledge/unit-${chunk.chunkId.slice(`${book.bookId}::unit::`.length)}`) invalidArtifact();
    }
    if (contract.kind === "page") {
      const pageCount = firstSource.pageCount;
      const expectedPages = Array.from({ length: pageCount }, (_, index) => index + 1)
        .filter((page) => book.role !== "core" || !IMAGE_ONLY_ORIGINAL_PAGES.has(page));
      const actualPages = new Set(bookChunks.flatMap((chunk) => chunk.pdfPages));
      if (actualPages.size !== expectedPages.length || expectedPages.some((page) => !actualPages.has(page))) invalidArtifact();
    } else {
      const secondSource = contract.sources[1];
      if (!secondSource || bookChunks.length !== 117
        || bookChunks.filter((chunk) => chunk.sourceId === firstSource.sourceId).length !== 81
        || bookChunks.filter((chunk) => chunk.sourceId === secondSource.sourceId).length !== 36) invalidArtifact();
    }
  }
}

export function buildKnowledgeIndex(path = DEFAULT_KNOWLEDGE_INDEX_PATH): KnowledgeIndex {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || parsed.schemaVersion !== "wavekb-ai-knowledge-v1") invalidArtifact();
  if (typeof parsed.knowledgeVersion !== "string" || !SHA256_PATTERN.test(parsed.knowledgeVersion)) {
    invalidArtifact();
  }
  if (!Array.isArray(parsed.books) || !Array.isArray(parsed.chunks)) invalidArtifact();
  const books = parsed.books.map(parseBook);
  if (books.length !== PUBLISHED_BOOK_IDS.length
    || books.some((book, index) => book.bookId !== PUBLISHED_BOOK_IDS[index])) {
    invalidArtifact();
  }
  const chunks = parsed.chunks.map(parseChunk);
  const chunkIds = new Set(chunks.map((chunk) => chunk.chunkId));
  if (!chunks.length || chunkIds.size !== chunks.length) invalidArtifact();
  validateBookRoleCoherence(books, chunks);
  return {
    schemaVersion: "wavekb-ai-knowledge-v1",
    knowledgeVersion: parsed.knowledgeVersion,
    books,
    chunks,
  };
}
