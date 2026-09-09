import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PUBLISHED_BOOK_IDS = [
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
  for (const [index, book] of books.entries()) {
    const core = index === 0;
    if (book.role !== (core ? "core" : "extension")) invalidArtifact();
    const sourceAuthorities = new Map<string, KnowledgeAuthority>();
    for (const source of book.sourceArtifacts) {
      if (sourceAuthorities.has(source.sourceId)) invalidArtifact();
      if (core ? source.authority === "contextual" : source.authority !== "contextual") {
        invalidArtifact();
      }
      sourceAuthorities.set(source.sourceId, source.authority);
    }
    if (!sourceAuthorities.size) invalidArtifact();
    const bookChunks = chunks.filter((chunk) => chunk.bookId === book.bookId);
    if (!bookChunks.length) invalidArtifact();
    for (const chunk of bookChunks) {
      if (sourceAuthorities.get(chunk.sourceId) !== chunk.authority) invalidArtifact();
      if (core) {
        if (chunk.kind !== "unit"
          || chunk.contentStatus !== "verified"
          || chunk.authority === "contextual") {
          invalidArtifact();
        }
      } else if (chunk.kind !== "page"
        || chunk.contentStatus !== "generated"
        || chunk.authority !== "contextual") {
        invalidArtifact();
      }
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
