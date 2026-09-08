import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PUBLISHED_BOOK_IDS = [
  "elliott-wave-principle-tenth-edition",
  "elliott-wave-natural-law",
  "chan-theory-complete",
] as const;

export type PublishedBookId = typeof PUBLISHED_BOOK_IDS[number];

export type KnowledgeBook = {
  bookId: PublishedBookId;
  title: string;
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
  kind: string;
  authority: string;
  contentStatus: string;
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
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) invalidArtifact();
  return value as number[];
}

function publishedBookId(value: unknown): PublishedBookId {
  if (typeof value !== "string" || !PUBLISHED_BOOK_IDS.includes(value as PublishedBookId)) {
    invalidArtifact();
  }
  return value as PublishedBookId;
}

function parseBook(value: unknown): KnowledgeBook {
  if (!isRecord(value)) invalidArtifact();
  return {
    ...value,
    bookId: publishedBookId(value.bookId),
    title: requiredString(value, "title"),
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
    kind: requiredString(value, "kind"),
    authority: requiredString(value, "authority"),
    contentStatus: requiredString(value, "contentStatus"),
    pdfPages: numberArray(value.pdfPages),
    href,
    topics: stringArray(value.topics),
    searchable: requiredString(value, "searchable"),
    contentSha256,
  };
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
  return {
    schemaVersion: "wavekb-ai-knowledge-v1",
    knowledgeVersion: parsed.knowledgeVersion,
    books,
    chunks,
  };
}
