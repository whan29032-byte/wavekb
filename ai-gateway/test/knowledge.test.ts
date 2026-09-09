import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  normalizeAiRunRequest,
  type KnowledgeScope,
} from "../src/knowledge/contracts.ts";
import {
  buildKnowledgeIndex,
  type KnowledgeChunk,
  type KnowledgeIndex,
} from "../src/knowledge/index.ts";
import { buildKnowledgeQuery } from "../src/knowledge/query.ts";
import { retrieveKnowledge } from "../src/knowledge/retrieve.ts";

const artifactPath = fileURLToPath(
  new URL("../knowledge/retrieval-index.json", import.meta.url),
);
const BOOK_IDS = [
  "elliott-wave-principle-tenth-edition",
  "elliott-wave-natural-law",
  "chan-theory-complete",
] as const;
const CLIENT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    request_version: 2,
    client_request_id: CLIENT_REQUEST_ID,
    task_type: "wave_analysis",
    step: 5,
    analysis_schema_version: "workbench-v1",
    knowledge_scope: { mode: "all" },
    ...overrides,
  };
}

function withTemporaryArtifact(
  mutate: (artifact: Record<string, any>) => void,
  inspect: (path: string) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), "wavekb-index-"));
  const path = join(directory, "retrieval-index.json");
  try {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, any>;
    mutate(artifact);
    writeFileSync(path, JSON.stringify(artifact));
    inspect(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the committed retrieval artifact loads the exact published catalog", () => {
  const index = buildKnowledgeIndex(artifactPath);
  assert.equal(index.schemaVersion, "wavekb-ai-knowledge-v1");
  assert.match(index.knowledgeVersion, /^[0-9a-f]{64}$/);
  assert.deepEqual(index.books.map((book) => book.bookId), BOOK_IDS);
  assert.ok(index.chunks.length > 0);
});

test("scope normalization accepts all and each published single book", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  assert.deepEqual(normalizeAiRunRequest(validRequest(), catalog).knowledge_scope, {
    mode: "all",
  });
  for (const book_id of BOOK_IDS) {
    assert.deepEqual(
      normalizeAiRunRequest(validRequest({
        knowledge_scope: { mode: "single", book_id },
      }), catalog).knowledge_scope,
      { mode: "single", book_id },
    );
  }
});

test("the exact deployed legacy request normalizes to a deterministic all-books v2 request", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  const legacy = {
    task_type: "wave_analysis",
    step: 5,
    schema_version: "workbench-v1",
  };
  const context = {
    ownerId: "22222222-2222-4222-8222-222222222222",
    analysisId: "33333333-3333-4333-8333-333333333333",
  };
  const normalized = normalizeAiRunRequest(legacy, catalog, context);
  assert.deepEqual(normalized, {
    request_version: 2,
    client_request_id: normalized.client_request_id,
    task_type: "wave_analysis",
    step: 5,
    analysis_schema_version: "workbench-v1",
    knowledge_scope: { mode: "all" },
  });
  assert.match(normalized.client_request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(normalizeAiRunRequest(legacy, catalog, context).client_request_id, normalized.client_request_id);
  assert.notEqual(
    normalizeAiRunRequest({ ...legacy, step: 6 }, catalog, context).client_request_id,
    normalized.client_request_id,
  );
});

test("legacy compatibility accepts only the exact historical own-key shape", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  const context = { ownerId: "owner", analysisId: "analysis" };
  const legacy = { task_type: "wave_analysis", step: 5, schema_version: "workbench-v1" };
  const inherited = Object.assign(Object.create({ marker: true }), legacy);
  const extra = { ...legacy, client_request_id: CLIENT_REQUEST_ID };
  const symbol = Object.assign({ ...legacy }, { [Symbol("query")]: "hidden" });
  const nonEnumerable = { ...legacy };
  Object.defineProperty(nonEnumerable, "query", { value: "hidden", enumerable: false });
  for (const input of [inherited, extra, symbol, nonEnumerable]) {
    assert.throws(() => normalizeAiRunRequest(input, catalog, context));
  }
});

test("scope normalization rejects malformed, ambiguous, and unpublished scopes", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  const invalid = [
    validRequest({ request_version: 1 }),
    validRequest({ knowledge_scope: { mode: "unknown" } }),
    validRequest({ knowledge_scope: { mode: "single", book_id: "not-published" } }),
    validRequest({ knowledge_scope: { mode: "single", book_ids: [BOOK_IDS[0]] } }),
    validRequest({ knowledge_scope: { mode: "single" } }),
    validRequest({ knowledge_scope: { mode: "all", book_id: BOOK_IDS[0] } }),
    validRequest({ knowledge_scope: ["all"] }),
    validRequest({ knowledge_scope: { mode: "all", extra: true } }),
  ];
  for (const input of invalid) {
    assert.throws(() => normalizeAiRunRequest(input, catalog));
  }
});

test("request and scope records reject prototype-backed contract fields", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  const customPrototype = Object.assign(
    Object.create({ marker: true }),
    validRequest(),
  ) as Record<string, unknown>;
  const { request_version: _requestVersion, ...withoutVersion } = validRequest();
  const inheritedVersion = Object.assign(
    Object.create({ request_version: 2 }),
    withoutVersion,
  ) as Record<string, unknown>;
  const inheritedMode = Object.assign(
    Object.create({ mode: "single" }),
    { book_id: BOOK_IDS[0], junk: true },
  );
  assert.throws(() => normalizeAiRunRequest(customPrototype, catalog));
  assert.throws(() => normalizeAiRunRequest(inheritedVersion, catalog));
  assert.throws(() => normalizeAiRunRequest(validRequest({ knowledge_scope: inheritedMode }), catalog));
});

test("request and scope records accept exact null-prototype objects", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  const scope = Object.assign(Object.create(null), { mode: "single", book_id: BOOK_IDS[0] });
  const input = Object.assign(Object.create(null), validRequest({ knowledge_scope: scope }));
  assert.deepEqual(normalizeAiRunRequest(input, catalog).knowledge_scope, {
    mode: "single",
    book_id: BOOK_IDS[0],
  });
});

test("request normalization rejects non-enumerable extra own keys", () => {
  const input = validRequest();
  Object.defineProperty(input, "query", { value: "hidden-query", enumerable: false });
  assert.throws(() => normalizeAiRunRequest(input, buildKnowledgeIndex(artifactPath).books));
});

test("scope normalization rejects non-enumerable extra own keys", () => {
  const scope = { mode: "all" };
  Object.defineProperty(scope, "query", { value: "hidden-query", enumerable: false });
  assert.throws(() => normalizeAiRunRequest(
    validRequest({ knowledge_scope: scope }),
    buildKnowledgeIndex(artifactPath).books,
  ));
});

test("request normalization rejects symbol own keys", () => {
  const input = Object.assign(validRequest(), { [Symbol("query")]: "hidden-query" });
  assert.throws(() => normalizeAiRunRequest(input, buildKnowledgeIndex(artifactPath).books));
});

test("scope normalization rejects symbol own keys", () => {
  const scope = Object.assign({ mode: "all" }, { [Symbol("query")]: "hidden-query" });
  assert.throws(() => normalizeAiRunRequest(
    validRequest({ knowledge_scope: scope }),
    buildKnowledgeIndex(artifactPath).books,
  ));
});

test("artifact loading rejects unapproved chunk enums", () => {
  for (const [field, value] of [
    ["contentStatus", "invented"],
    ["kind", "vector"],
    ["authority", "superuser"],
  ] as const) {
    withTemporaryArtifact(
      (artifact) => { artifact.chunks[0][field] = value; },
      (path) => assert.throws(() => buildKnowledgeIndex(path)),
    );
  }
});

test("artifact loading rejects zero and negative PDF pages", () => {
  for (const page of [0, -1]) {
    withTemporaryArtifact(
      (artifact) => { artifact.chunks[0].pdfPages = [page]; },
      (path) => assert.throws(() => buildKnowledgeIndex(path)),
    );
  }
});

test("artifact loading enforces core and extension role coherence", () => {
  const mutations = [
    (artifact: Record<string, any>) => { artifact.books[0].role = "extension"; },
    (artifact: Record<string, any>) => { artifact.books[1].role = "core"; },
    (artifact: Record<string, any>) => { artifact.chunks[0].authority = "contextual"; },
    (artifact: Record<string, any>) => { artifact.chunks[0].contentStatus = "generated"; },
    (artifact: Record<string, any>) => { artifact.chunks[0].kind = "page"; },
    (artifact: Record<string, any>) => { artifact.chunks[0].sourceId = "unapproved-source"; },
    (artifact: Record<string, any>) => { artifact.books[0].sourceArtifacts[0].authority = "supplement"; },
    (artifact: Record<string, any>) => { artifact.chunks.at(-1).authority = "primary"; },
    (artifact: Record<string, any>) => { artifact.chunks.at(-1).contentStatus = "verified"; },
    (artifact: Record<string, any>) => { artifact.chunks.at(-1).kind = "unit"; },
  ];
  for (const mutate of mutations) {
    withTemporaryArtifact(mutate, (path) => assert.throws(() => buildKnowledgeIndex(path)));
  }
});

test("request normalization validates UUID, step, task, schema, arrays, and string bounds", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  const invalid = [
    validRequest({ client_request_id: "not-a-uuid" }),
    validRequest({ client_request_id: "a".repeat(10_000) }),
    validRequest({ step: -1 }),
    validRequest({ step: 11 }),
    validRequest({ step: 1.5 }),
    validRequest({ task_type: "chat" }),
    validRequest({ task_type: ["wave_analysis"] }),
    validRequest({ analysis_schema_version: "workbench-v2" }),
    validRequest({ analysis_schema_version: ["workbench-v1"] }),
    [] as unknown as Record<string, unknown>,
  ];
  for (const input of invalid) {
    assert.throws(() => normalizeAiRunRequest(input, catalog));
  }
});

test("request normalization rejects client retrieval controls", () => {
  const catalog = buildKnowledgeIndex(artifactPath).books;
  for (const control of ["query", "weights", "path", "character_budget"]) {
    assert.throws(() => normalizeAiRunRequest(validRequest({ [control]: "attacker" }), catalog));
  }
});

test("knowledge queries use only bounded server analysis fields for the requested step", () => {
  const request = normalizeAiRunRequest(validRequest(), buildKnowledgeIndex(artifactPath).books);
  const query = buildKnowledgeQuery({
    owner_id: "must-not-leak",
    instrument: "BTCUSDT",
    market: "crypto",
    primary_timeframe: "4h",
    parent_timeframe: "1d",
    child_timeframe: "1h",
    holding_style: "swing",
    step_data: {
      "4": { notes: "wrong-step" },
      "5": { pattern: "三角形", notes: `bounded-${"n".repeat(2_000)}`, query: "attacker-query" },
    },
  }, request);
  assert.match(query, /BTCUSDT/);
  assert.match(query, /三角形/);
  assert.match(query, /bounded-/);
  assert.doesNotMatch(query, /must-not-leak|wrong-step|attacker-query/);
  assert.ok(query.length < 1_000);
});

function chunk(
  chunkId: string,
  bookId: typeof BOOK_IDS[number],
  searchable: string,
  options: Partial<KnowledgeChunk> = {},
): KnowledgeChunk {
  return {
    chunkId,
    bookId,
    sourceId: `${bookId}::source`,
    sequence: 1,
    title: chunkId,
    headingPath: [],
    text: options.text ?? chunkId,
    kind: "page",
    authority: "contextual",
    contentStatus: "generated",
    pdfPages: [1],
    href: `/knowledge/books/${bookId}#page-1`,
    topics: [],
    searchable,
    contentSha256: options.contentSha256 ?? chunkId.padEnd(64, "0").slice(0, 64),
    ...options,
  };
}

function fixtureIndex(chunks: KnowledgeChunk[]): KnowledgeIndex {
  return {
    schemaVersion: "wavekb-ai-knowledge-v1",
    knowledgeVersion: "a".repeat(64),
    books: BOOK_IDS.map((bookId, index) => ({
      bookId,
      title: bookId,
      role: index === 0 ? "core" as const : "extension" as const,
      sourceArtifacts: [{
        sourceId: `${bookId}::source`,
        authority: index === 0 ? "primary" as const : "contextual" as const,
      }],
    })),
    chunks,
  };
}

function retrieve(index: KnowledgeIndex, scope: KnowledgeScope, query = "target", budget = 100_000) {
  return retrieveKnowledge(index, { scope, query, characterBudget: budget });
}

test("single-book retrieval filters scope before ranking and never leaks another book", () => {
  const otherBook = Array.from({ length: 13 }, (_, index) => chunk(
    `a-${String(index).padStart(2, "0")}`,
    BOOK_IDS[0],
    "target",
    { authority: "primary", kind: "unit", topics: ["RULE"] },
  ));
  const wanted = chunk("wanted", BOOK_IDS[1], "target");
  const context = retrieve(fixtureIndex([...otherBook, wanted]), {
    mode: "single",
    book_id: BOOK_IDS[1],
  });
  assert.deepEqual(context.items.map((item) => item.chunkId), ["wanted"]);
  assert.ok(context.items.every((item) => item.bookId === BOOK_IDS[1]));
});

test("all-books retrieval caps every book at four and the merged context at twelve", () => {
  const chunks = BOOK_IDS.flatMap((bookId) => Array.from({ length: 5 }, (_, index) =>
    chunk(`${bookId}-${index}`, bookId, "target", { sequence: index + 1 })));
  const context = retrieve(fixtureIndex(chunks), { mode: "all" });
  assert.equal(context.items.length, 12);
  for (const bookId of BOOK_IDS) {
    assert.equal(context.items.filter((item) => item.bookId === bookId).length, 4);
  }
});

test("single-book retrieval returns at most eight matching chunks", () => {
  const chunks = Array.from({ length: 10 }, (_, index) =>
    chunk(`single-${index}`, BOOK_IDS[2], "target", { sequence: index + 1 }));
  assert.equal(retrieve(fixtureIndex(chunks), {
    mode: "single",
    book_id: BOOK_IDS[2],
  }).items.length, 8);
});

test("equal scores use deterministic sequence and chunk-id tie ordering", () => {
  const chunks = [
    chunk("z", BOOK_IDS[0], "target", { sequence: 2 }),
    chunk("b", BOOK_IDS[0], "target", { sequence: 1 }),
    chunk("a", BOOK_IDS[0], "target", { sequence: 1 }),
  ];
  assert.deepEqual(
    retrieve(fixtureIndex(chunks), { mode: "single", book_id: BOOK_IDS[0] })
      .items.map((item) => item.chunkId),
    ["a", "b", "z"],
  );
});

test("retrieval honors the character budget and suppresses content duplicates", () => {
  const duplicateHash = "d".repeat(64);
  const chunks = [
    chunk("first", BOOK_IDS[0], "target", { text: "12345", contentSha256: duplicateHash }),
    chunk("duplicate", BOOK_IDS[0], "target", { text: "12345", contentSha256: duplicateHash, sequence: 2 }),
    chunk("too-large", BOOK_IDS[0], "target", { text: "123456", sequence: 3 }),
  ];
  const context = retrieve(fixtureIndex(chunks), { mode: "single", book_id: BOOK_IDS[0] }, "target", 5);
  assert.deepEqual(context.items.map((item) => item.chunkId), ["first"]);
  assert.equal(context.totalCharacters, 5);
});

test("all-books duplicate suppression does not consume a book result slot", () => {
  const duplicateHash = "d".repeat(64);
  const chunks = [
    chunk("one", BOOK_IDS[0], "target", { contentSha256: duplicateHash, sequence: 1 }),
    chunk("duplicate", BOOK_IDS[0], "target", { contentSha256: duplicateHash, sequence: 2 }),
    chunk("two", BOOK_IDS[0], "target", { sequence: 3 }),
    chunk("three", BOOK_IDS[0], "target", { sequence: 4 }),
    chunk("four", BOOK_IDS[0], "target", { sequence: 5 }),
  ];
  assert.deepEqual(
    retrieve(fixtureIndex(chunks), { mode: "all" }).items.map((item) => item.chunkId),
    ["one", "two", "three", "four"],
  );
});

test("CJK query bigrams match normalized artifact bigrams", () => {
  const index = fixtureIndex([chunk("triangle", BOOK_IDS[1], "三角 角形")]);
  assert.deepEqual(
    retrieve(index, { mode: "single", book_id: BOOK_IDS[1] }, "三角形")
      .items.map((item) => item.chunkId),
    ["triangle"],
  );
});

test("title and heading matches rank above topics and body matches", () => {
  const index = fixtureIndex([
    chunk("body", BOOK_IDS[0], "target", { text: "target", sequence: 1 }),
    chunk("topic", BOOK_IDS[0], "target", { topics: ["target"], sequence: 2 }),
    chunk("heading", BOOK_IDS[0], "target", { headingPath: ["target"], sequence: 3 }),
    chunk("title", BOOK_IDS[0], "target", { title: "target", sequence: 4 }),
  ]);
  assert.deepEqual(
    retrieve(index, { mode: "single", book_id: BOOK_IDS[0] }).items.map((item) => item.chunkId),
    ["title", "heading", "topic", "body"],
  );
});

test("same-book authority and knowledge type break equal-field ties", () => {
  const index = fixtureIndex([
    chunk("context", BOOK_IDS[0], "target", { text: "target", sequence: 1 }),
    chunk("guide", BOOK_IDS[0], "target", {
      text: "target",
      authority: "supplement",
      topics: ["GUIDELINE"],
      sequence: 2,
    }),
    chunk("rule", BOOK_IDS[0], "target", {
      text: "target",
      authority: "primary",
      topics: ["RULE"],
      sequence: 3,
    }),
  ]);
  assert.deepEqual(
    retrieve(index, { mode: "single", book_id: BOOK_IDS[0] }).items.map((item) => item.chunkId),
    ["rule", "guide", "context"],
  );
});

test("irrelevant books add no forced chunks and no matches are explicit", () => {
  const index = fixtureIndex([
    chunk("match", BOOK_IDS[0], "target"),
    chunk("irrelevant-b", BOOK_IDS[1], "unrelated"),
    chunk("irrelevant-c", BOOK_IDS[2], "unrelated"),
  ]);
  const matched = retrieve(index, { mode: "all" });
  assert.deepEqual(matched.items.map((item) => item.chunkId), ["match"]);
  assert.equal(matched.noMatch, false);
  const empty = retrieve(index, { mode: "all" }, "absent");
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalCharacters, 0);
  assert.equal(empty.noMatch, true);
  assert.equal(empty.boundary, "UNTRUSTED_KNOWLEDGE");
});
