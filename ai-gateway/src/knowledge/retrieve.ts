import type { KnowledgeScope } from "./contracts.ts";
import type { KnowledgeChunk, KnowledgeIndex, PublishedBookId } from "./index.ts";

const AUTHORITY_WEIGHT: Record<string, number> = {
  primary: 40,
  supplement: 10,
  contextual: 0,
};
const TYPE_WEIGHT: Record<string, number> = {
  RULE: 100,
  GUIDELINE: 70,
  METHOD: 50,
  CONFIRMATION: 50,
  HISTORICAL_CASE: 30,
  DEFINITION: 20,
  TERMINOLOGY: 20,
  CHARACTERISTIC: 20,
  THEORY_BOUNDARY: 20,
};

export type KnowledgeContext = {
  items: KnowledgeChunk[];
  totalCharacters: number;
  noMatch: boolean;
  boundary: "UNTRUSTED_KNOWLEDGE";
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/gu, " ").trim();
}

function queryTokens(query: string): string[] {
  const normalized = normalizeText(query);
  const tokens = normalized.split(/[^\p{Letter}\p{Number}]+/gu).filter(Boolean);
  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
    const characters = [...match[0]];
    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return [...new Set(tokens)];
}

function fieldScore(item: KnowledgeChunk, tokens: string[]): number {
  const title = normalizeText(item.title);
  const headings = normalizeText(item.headingPath.join(" "));
  const topics = normalizeText(item.topics.join(" "));
  const text = normalizeText(item.text);
  const searchable = normalizeText(item.searchable);
  let score = 0;
  let matched = false;
  for (const token of tokens) {
    const lengthWeight = Math.min([...token].length, 12);
    if (title.includes(token)) {
      score += 400 + lengthWeight;
      matched = true;
    } else if (headings.includes(token)) {
      score += 300 + lengthWeight;
      matched = true;
    } else if (topics.includes(token)) {
      score += 200 + lengthWeight;
      matched = true;
    } else if (text.includes(token) || searchable.includes(token)) {
      score += 100 + lengthWeight;
      matched = true;
    }
  }
  if (!matched) return 0;
  const typeWeight = item.topics.reduce(
    (best, topic) => Math.max(best, TYPE_WEIGHT[topic.toUpperCase()] ?? 0),
    0,
  );
  return score + (AUTHORITY_WEIGHT[item.authority] ?? 0) + typeWeight;
}

function rank(chunks: KnowledgeChunk[], tokens: string[]): KnowledgeChunk[] {
  return chunks.map((item) => ({ item, score: fieldScore(item, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || left.item.sequence - right.item.sequence
      || (left.item.chunkId < right.item.chunkId ? -1 : left.item.chunkId > right.item.chunkId ? 1 : 0))
    .map((entry) => entry.item);
}

function selectedContext(
  ranked: KnowledgeChunk[],
  limit: number,
  characterBudget: number,
  perBookLimit = limit,
): KnowledgeContext {
  const items: KnowledgeChunk[] = [];
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const bookCounts = new Map<PublishedBookId, number>();
  let totalCharacters = 0;
  for (const item of ranked) {
    if (items.length >= limit) break;
    if (seenIds.has(item.chunkId) || seenContent.has(item.contentSha256)) continue;
    if ((bookCounts.get(item.bookId) ?? 0) >= perBookLimit) continue;
    if (totalCharacters + item.text.length > characterBudget) continue;
    seenIds.add(item.chunkId);
    seenContent.add(item.contentSha256);
    items.push(item);
    bookCounts.set(item.bookId, (bookCounts.get(item.bookId) ?? 0) + 1);
    totalCharacters += item.text.length;
  }
  return {
    items,
    totalCharacters,
    noMatch: items.length === 0,
    boundary: "UNTRUSTED_KNOWLEDGE",
  };
}

function stableBookMerge(
  index: KnowledgeIndex,
  scoped: KnowledgeChunk[],
  tokens: string[],
): KnowledgeChunk[] {
  const rankedByBook = new Map<PublishedBookId, KnowledgeChunk[]>();
  for (const book of index.books) {
    rankedByBook.set(
      book.bookId,
      rank(scoped.filter((chunk) => chunk.bookId === book.bookId), tokens),
    );
  }
  const merged: KnowledgeChunk[] = [];
  const maximumLength = Math.max(0, ...[...rankedByBook.values()].map((items) => items.length));
  for (let position = 0; position < maximumLength; position += 1) {
    for (const book of index.books) {
      const item = rankedByBook.get(book.bookId)?.[position];
      if (item) merged.push(item);
    }
  }
  return merged;
}

export function retrieveKnowledge(
  index: KnowledgeIndex,
  request: { scope: KnowledgeScope; query: string; characterBudget: number },
): KnowledgeContext {
  const tokens = queryTokens(request.query);
  const characterBudget = Number.isFinite(request.characterBudget)
    ? Math.max(0, Math.floor(request.characterBudget))
    : 0;
  if (request.scope.mode === "single") {
    const bookId = request.scope.book_id;
    const scoped = index.chunks.filter((chunk) => chunk.bookId === bookId);
    return selectedContext(rank(scoped, tokens), 8, characterBudget);
  }
  const scoped = index.chunks;
  return selectedContext(stableBookMerge(index, scoped, tokens), 12, characterBudget, 4);
}
