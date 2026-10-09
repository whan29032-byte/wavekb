import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildAiKnowledgeArtifact, normalizeSearchText } from "../scripts/lib/ai-knowledge-artifact.mjs";
import { applyBookReadingCorrections, reviewedBookCorrections, sha256Text } from "../scripts/lib/book-reading-corrections.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const CORE_BOOK_ID = "elliott-wave-principle-eleventh-edition";
const SUPPLEMENT_BOOK_ID = "elliott-wave-principle-tenth-edition";
const SHA256 = /^[a-f0-9]{64}$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function readJsonl(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8").trim().split(/\r?\n/).map(JSON.parse);
}

function sourceInputs() {
  const library = readJson("knowledge/source/library.json");
  const corrections = reviewedBookCorrections(readJson("knowledge/reading/text-corrections.json"), library.books);
  return {
    units: readJsonl("knowledge/units/all.jsonl"),
    library,
    pageSources: Object.fromEntries(library.books.map((book) => {
      const source = readJson(book.text_path);
      const sourcePdfSha256 = sha256Text(fs.readFileSync(path.join(repositoryRoot, book.pdf_path)));
      return [book.id, { ...source, pages: applyBookReadingCorrections({ book, pages: source.pages, correction: corrections.get(book.id), sourcePdfSha256 }) }];
    })),
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

test("builds the deterministic four-book retrieval contract with original edition 11 first", () => {
  const artifact = buildAiKnowledgeArtifact(sourceInputs());
  const chunksFor = (bookId) => artifact.chunks.filter((chunk) => chunk.bookId === bookId);

  assert.equal(artifact.schemaVersion, "wavekb-ai-knowledge-v1");
  assert.match(artifact.knowledgeVersion, SHA256);
  assert.deepEqual(artifact.books.map((book) => book.bookId), [
    "elliott-wave-principle-eleventh-edition",
    "elliott-wave-principle-tenth-edition",
    "elliott-wave-natural-law",
    "chan-theory-complete",
  ]);
  assert.deepEqual(artifact.books.map((book) => book.role), ["core", "extension", "extension", "extension"]);
  assert.equal(chunksFor(SUPPLEMENT_BOOK_ID).filter((chunk) => chunk.kind === "unit").length, 117);
  assert.ok(chunksFor(CORE_BOOK_ID).every((chunk) => chunk.kind === "page" && chunk.authority === "primary" && chunk.contentStatus === "generated"));
  assert.ok(chunksFor(SUPPLEMENT_BOOK_ID).every((chunk) => chunk.kind === "unit" && chunk.authority === "supplement" && chunk.contentStatus === "verified"));
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
    chunksFor(SUPPLEMENT_BOOK_ID).map((chunk) => chunk.chunkId),
    sourceInputs().units.map((unit) => `${SUPPLEMENT_BOOK_ID}::unit::${unit.id}`),
  );
  assert.deepEqual(
    chunksFor("elliott-wave-natural-law").map((chunk) => chunk.chunkId),
    Array.from({ length: 36 }, (_, index) => `elliott-wave-natural-law::page::p${String(index + 1).padStart(4, "0")}`),
  );
});

test("edition 11 reads all 321 pages but indexes only 315 actual text-layer pages", () => {
  const inputs = sourceInputs();
  const pages = inputs.pageSources[CORE_BOOK_ID].pages;
  const artifact = buildAiKnowledgeArtifact(inputs);
  const chunks = artifact.chunks.filter((chunk) => chunk.bookId === CORE_BOOK_ID);
  const imageOnlyPages = pages.filter((page) => page.extraction.status === "image_only").map((page) => page.page);
  assert.equal(pages.length, 321);
  assert.deepEqual(imageOnlyPages, [1, 2, 3, 231, 320, 321]);
  assert.equal(new Set(chunks.flatMap((chunk) => chunk.pdfPages)).size, 315);
  assert.ok(chunks.every((chunk) => !imageOnlyPages.includes(chunk.pdfPages[0])));
  assert.ok(chunks.every((chunk) => !chunk.text.includes("[本页无可提取文字，请查看原页。]")));
  assert.deepEqual(artifact.books[0].sourceArtifacts[0], {
    sourceId: "ewp-11-zh-2021",
    kind: "original_pdf",
    sha256: "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073",
    pageCount: 321,
    edition: 11,
    authority: "primary",
    derivation: "original",
    redistributionAllowed: null,
  });
  for (const page of pages.filter((page) => page.extraction.status === "text_layer_extracted")) {
    const pageChunks = chunks.filter((chunk) => chunk.pdfPages[0] === page.page);
    assert.ok(pageChunks.length > 0, `Real text page ${page.page} must remain indexed`);
    assert.ok(pageChunks.every((chunk) => page.text.includes(chunk.text)), `Page ${page.page} must contain no invented prose`);
  }
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

test("the supplemental collection retains actual edition and page citations without mutating Units", () => {
  const inputs = sourceInputs();
  const originalUnits = JSON.stringify(inputs.units);
  const artifact = buildAiKnowledgeArtifact(inputs);
  assert.equal(JSON.stringify(inputs.units), originalUnits);
  const book = artifact.books.find((book) => book.bookId === SUPPLEMENT_BOOK_ID);
  assert.match(book.title, /第10版补充与版本对照/);
  const chunks = artifact.chunks.filter((chunk) => chunk.bookId === SUPPLEMENT_BOOK_ID);
  for (const [sourceId, edition, pageCount, count] of [
    ["ewp-10-zh-2016", 10, 280, 81],
    ["ewp-11-zh-2021", 11, 321, 36],
  ]) {
    const units = inputs.units.filter((unit) => unit.source.source_id === sourceId);
    const source = book.sourceArtifacts.find((source) => source.sourceId === `${sourceId}::canonical-units`);
    assert.equal(units.length, count);
    assert.equal(source.edition, edition);
    assert.equal(source.pageCount, pageCount);
    assert.equal(source.authority, "supplement");
    assert.equal(source.sha256, createHash("sha256").update(JSON.stringify(stableValue(units))).digest("hex"));
    assert.equal(chunks.filter((chunk) => chunk.sourceId === source.sourceId).length, count);
    for (const unit of units) {
      const chunk = chunks.find((chunk) => chunk.chunkId.endsWith(`::unit::${unit.id}`));
      assert.equal(chunk.sourceId, source.sourceId);
      assert.deepEqual(chunk.pdfPages, [...new Set(unit.source.pdf_pages)].sort((left, right) => left - right));
      assert.equal(chunk.href, `/knowledge/unit-${unit.id}`);
    }
  }
  const mappedEleventh = inputs.units.find((unit) => unit.source.source_id === "ewp-11-zh-2021"
    && unit.source_refs?.some((source) => source.source_id === "ewp-10-zh-2016"));
  assert.ok(mappedEleventh, "Fixture must include the real cross-edition citation hazard");
  const mappedChunk = chunks.find((chunk) => chunk.chunkId.endsWith(`::unit::${mappedEleventh.id}`));
  assert.deepEqual(mappedChunk.pdfPages, mappedEleventh.source.pdf_pages);
  assert.equal(mappedChunk.sourceId, "ewp-11-zh-2021::canonical-units");
});

test("rejects unknown actual Unit sources and forged primary original metadata", () => {
  for (const mutate of [
    (inputs) => { inputs.units[0].source.source_id = "unknown-source"; },
    (inputs) => { inputs.units[0].source.pdf_pages = [322]; },
    (inputs) => { inputs.library.books.find((book) => book.id === CORE_BOOK_ID).edition = 10; },
    (inputs) => { inputs.library.books.find((book) => book.id === CORE_BOOK_ID).source_kind = "distilled_pdf"; },
    (inputs) => { inputs.pageSources[CORE_BOOK_ID].source_pdf_sha256 = "a".repeat(64); },
    (inputs) => { inputs.pageSources[CORE_BOOK_ID].pages.pop(); },
  ]) {
    const inputs = sourceInputs();
    mutate(inputs);
    assert.throws(() => buildAiKnowledgeArtifact(inputs));
  }
});

test("the committed artifact is byte-for-byte current", () => {
  const artifact = buildAiKnowledgeArtifact(sourceInputs());
  const committed = fs.readFileSync(path.join(repositoryRoot, "ai-gateway/knowledge/retrieval-index.json"), "utf8");
  assert.equal(committed, `${JSON.stringify(artifact, null, 2)}\n`);
});
