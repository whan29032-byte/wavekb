import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildAiKnowledgeArtifact, normalizeSearchText } from "../scripts/lib/ai-knowledge-artifact.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const CORE_BOOK_ID = "elliott-wave-principle-tenth-edition";
const SHA256 = /^[a-f0-9]{64}$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function readJsonl(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8").trim().split(/\r?\n/).map(JSON.parse);
}

function sourceInputs() {
  const library = readJson("knowledge/source/library.json");
  return {
    units: readJsonl("knowledge/units/all.jsonl"),
    library,
    pageSources: Object.fromEntries(library.books.map((book) => [book.id, readJson(book.text_path)])),
  };
}

function assertSafeRelativeHref(href) {
  assert.match(href, /^\/knowledge\/[a-z0-9-]+(?:\/[a-z0-9-]+)?(?:[#?][^\\]*)?$/);
  assert.ok(!href.includes(".."));
  assert.ok(!href.includes("://"));
}

test("normalizes Unicode, case, whitespace, and emits deterministic CJK bigrams", () => {
  assert.equal(normalizeSearchText("  ＷＡＶＥ\n波浪理论  "), "wave 波浪理论 波浪 浪理 理论");
});

test("builds the deterministic three-book retrieval contract from canonical sources", () => {
  const artifact = buildAiKnowledgeArtifact(sourceInputs());
  const chunksFor = (bookId) => artifact.chunks.filter((chunk) => chunk.bookId === bookId);

  assert.equal(artifact.schemaVersion, "wavekb-ai-knowledge-v1");
  assert.match(artifact.knowledgeVersion, SHA256);
  assert.deepEqual(artifact.books.map((book) => book.bookId), [
    "elliott-wave-principle-tenth-edition",
    "elliott-wave-natural-law",
    "chan-theory-complete",
  ]);
  assert.equal(chunksFor(CORE_BOOK_ID).filter((chunk) => chunk.kind === "unit").length, 117);
  assert.deepEqual(new Set(chunksFor("elliott-wave-natural-law").flatMap((chunk) => chunk.pdfPages)).size, 36);
  assert.deepEqual(new Set(chunksFor("chan-theory-complete").flatMap((chunk) => chunk.pdfPages)).size, 25);
  assert.ok(chunksFor("chan-theory-complete").every((chunk) => chunk.authority === "contextual"));

  assert.equal(new Set(artifact.books.map((book) => book.bookId)).size, artifact.books.length);
  assert.equal(new Set(artifact.chunks.map((chunk) => chunk.chunkId)).size, artifact.chunks.length);
  const sourceIds = artifact.books.flatMap((book) => book.sourceArtifacts.map((source) => source.sourceId));
  assert.equal(new Set(sourceIds).size, sourceIds.length);
  const sourcesByBook = new Map(artifact.books.map((book) => [
    book.bookId,
    new Map(book.sourceArtifacts.map((source) => [source.sourceId, source])),
  ]));
  for (const chunk of artifact.chunks) {
    const source = sourcesByBook.get(chunk.bookId)?.get(chunk.sourceId);
    assert.ok(source, `${chunk.chunkId} source must belong to its book`);
    assert.equal(chunk.authority, source.authority, `${chunk.chunkId} authority must match its source`);
  }
  assert.ok(artifact.books.every((book) => book.sourceArtifacts.length > 0));
  assert.ok(artifact.books.flatMap((book) => book.sourceArtifacts).every((source) => SHA256.test(source.sha256)));
  assert.ok(artifact.chunks.every((chunk) => chunk.text.trim() && chunk.searchable.trim()));
  assert.ok(artifact.chunks.every((chunk) => SHA256.test(chunk.contentSha256)));
  assert.ok(artifact.chunks.every((chunk) => (assertSafeRelativeHref(chunk.href), true)));

  assert.deepEqual(
    chunksFor(CORE_BOOK_ID).map((chunk) => chunk.chunkId),
    sourceInputs().units.map((unit) => `${CORE_BOOK_ID}::unit::${unit.id}`),
  );
  assert.deepEqual(
    chunksFor("elliott-wave-natural-law").map((chunk) => chunk.chunkId),
    Array.from({ length: 36 }, (_, index) => `elliott-wave-natural-law::page::p${String(index + 1).padStart(4, "0")}`),
  );
});

test("the committed artifact is byte-for-byte current", () => {
  const artifact = buildAiKnowledgeArtifact(sourceInputs());
  const committed = fs.readFileSync(path.join(repositoryRoot, "ai-gateway/knowledge/retrieval-index.json"), "utf8");
  assert.equal(committed, `${JSON.stringify(artifact, null, 2)}\n`);
});
