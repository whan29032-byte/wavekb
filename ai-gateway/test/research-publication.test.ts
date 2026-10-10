import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import { assertPublishedAnalysisOutput, publicAiJob, publicAnalysisOutput } from "../src/research/publication.ts";

const index = buildKnowledgeIndex();
const publicId = index.chunks[0]!.chunkId;
const candidate = () => ({
  instrument: "BTCUSDT", timeframe: "4h", analysis_level: "4h", parent_trend: "up",
  current_pattern: "impulse", current_subwave: "3",
  valid_scenarios: [{ key: "main", pattern: "推动结构候选", conditions: ["上行结构保持完整"], invalidations: ["价格跌破起点"], confidence: 0.6 }],
  eliminated_scenarios: [], unknown_fields: [], knowledge_citations: [publicId, "private-theory-chunk"],
  knowledge_version: index.knowledgeVersion,
  risk: { max_loss: 5 },
  citations: [{ knowledge_id: publicId, book_title: "PRIVATE TITLE", href: "file:///Users/example/private.md" }],
  private_sources: [{ title: "PRIVATE TITLE", path: "/Users/example/private.md" }],
  local_manifest: { nested: { source_id: "private-theory-chunk" } },
  learning_basis: [{ status: "verified", summary: "an unsupported model claim" }],
});

test("private-source mode preserves reasoning and drops all source references, including otherwise public citations", () => {
  const output = publicAnalysisOutput(candidate(), index, { sourceVisibility: "private_research", privateSourceTerms: ["PRIVATE TITLE"] })!;
  assert.equal(output.schema_version, "wavekb-public-analysis-v1");
  assert.equal(output.source_visibility, "private_research");
  assert.deepEqual(output.citations, []);
  assert.deepEqual(output.knowledge_citations, []);
  assert.deepEqual(output.analysis_basis, [{ kind: "structure", summary: "推动结构候选", conditions: ["上行结构保持完整"], invalidations: ["价格跌破起点"] }]);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE TITLE|Users|private\.md|private-theory-chunk|local_manifest|verified/);
  assertPublishedAnalysisOutput(output);
});

test("public citations are reconstructed from the approved artifact, not model-supplied labels and links", () => {
  const output = publicAnalysisOutput(candidate(), index)!;
  assert.deepEqual(output.knowledge_citations, [publicId]);
  assert.equal((output.citations as Record<string, unknown>[])[0]?.book_id, index.chunks[0]?.bookId);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE TITLE|file:\/\/|private-theory-chunk/);
});

test("every approved public chunk survives publication and write validation without exposing appendix file inventories", () => {
  for (const chunk of index.chunks) {
    const output = publicAnalysisOutput({ ...candidate(), knowledge_citations: [chunk.chunkId] }, index)!;
    assert.equal((output.citations as Record<string, unknown>[])[0]?.knowledge_id, chunk.chunkId);
    assertPublishedAnalysisOutput(output);
    assert.deepEqual(publicAnalysisOutput(output, index), output, "public projection must be idempotent");
  }
  const appendix = index.chunks.find((chunk) => chunk.chunkId === "chan-theory-complete::page::p0025")!;
  const output = publicAnalysisOutput({ ...candidate(), knowledge_citations: [appendix.chunkId] }, index)!;
  const snippet = (output.citations as Record<string, unknown>[])[0]?.snippet;
  assert.doesNotMatch(String(snippet), /\.(?:md|pdf)\b/iu);
  assert.match(String(snippet), /未直接展示/u);
});

test("mismatched or private version fingerprints never become public book versions", () => {
  const output = publicAnalysisOutput({ ...candidate(), knowledge_version: "f".repeat(64), scope: { mode: "single", book_id: "private-book", local_path: "private.md" } }, index)!;
  assert.equal(output.knowledge_version, undefined);
  assert.equal(output.scope, undefined);
  assert.deepEqual(output.citations, []);
  assert.deepEqual(output.knowledge_citations, []);
});

for (const text of [
  "依据/Users/example/theory.md判断", "C:\\private\\theory.md", "../references/rules.md", "file:///tmp/source.pdf",
  "source_id private", "knowledge_id private", "private_sources contains metadata", "local-kb-private",
  "摘要https://example.test/private", "私人书名", "姓名\u200b引用", "path\u0000hidden",
  "%2fUsers%2fexample%2fsource%2emd", "&#x2f;Users&#47;example&#47;source.md", "h_" + "a".repeat(32),
]) {
  test(`rejects private narrative marker ${JSON.stringify(text)}`, () => {
    assert.throws(() => publicAnalysisOutput({ ...candidate(), current_pattern: text }, index,
      { privateSourceTerms: ["私人书名"] }), /private_source_disclosure/);
  });
}

test("unknown nested provenance is removed while numerical risk and public rule decisions survive", () => {
  const value = candidate();
  value.valid_scenarios[0] = { ...value.valid_scenarios[0], violations: [{ rule_id: "ewp-rule-impulse-core", message: "推动结构不成立", knowledge_page_id: "private-theory-chunk", local_path: "private.md" }] } as never;
  const output = publicAnalysisOutput(value, index)!;
  assert.deepEqual((output.valid_scenarios as Record<string, unknown>[])[0]?.violations, [{ rule_id: "ewp-rule-impulse-core", message: "推动结构不成立" }]);
  assert.deepEqual(output.risk, { max_loss: 5 });
  assert.doesNotMatch(JSON.stringify(output), /knowledge_page_id|local_path|private-theory-chunk/);
});

test("unknown explicit schema or source policy fails closed instead of being upgraded to public citations", () => {
  for (const source_visibility of ["unknown_private", "mixed_research", null, 1]) {
    assert.equal(publicAnalysisOutput({ ...candidate(), source_visibility }, index), null);
  }
  assert.equal(publicAnalysisOutput({ ...candidate(), schema_version: "unapproved" }, index), null);
  const output = publicAnalysisOutput(candidate(), index, { sourceVisibility: "private_research" })!;
  assert.deepEqual(publicAnalysisOutput(output, index), output, "second projection must preserve private policy");
});

test("private source IDs cannot hide in the public rule identifier field", () => {
  const value = candidate();
  value.valid_scenarios[0] = { ...value.valid_scenarios[0], violations: [{ rule_id: "private-theory-chunk", message: "结构失效" }] } as never;
  const output = publicAnalysisOutput(value, index, { sourceVisibility: "private_research", privateSourceTerms: ["private-theory-chunk"] })!;
  assert.doesNotMatch(JSON.stringify(output), /private-theory-chunk/);
});

test("owner job DTO hides connection/worker/request metadata and uses fixed error messages", () => {
  const job = publicAiJob({ id: "job-1", analysis_id: "analysis-1", status: "failed", execution_source: "managed",
    knowledge_version: index.knowledgeVersion, output_payload: candidate(),
    worker_id: "machine-private", accepted_request: { source_id: "private" },
    connection_snapshot: { api_key: "secret", base_url: "https://private.example" },
    error_code: "secret_failure", error_message: "PRIVATE TITLE /Users/example/source.md" }, index);
  assert.equal(job.id, "job-1");
  assert.equal(job.error_code, "analysis_unavailable");
  assert.doesNotMatch(JSON.stringify(job), /machine-private|accepted_request|api_key|private\.example|PRIVATE TITLE|Users/);
});

test("context rejection exposes only a fixed actionable message, not its original input or diagnostics", () => {
  const job = publicAiJob({ id: "job-1", status: "failed", error_code: "input_context_too_large",
    error_message: "private input /Users/example/source.md", input_payload: { notes: "private" } }, index);
  assert.equal(job.error_code, "input_context_too_large");
  assert.match(String(job.error_message), /精简/);
  assert.doesNotMatch(JSON.stringify(job), /private|Users|source\.md|input_payload/);
});

test("a leaked narrative in a historical task fails closed without returning a path-bearing error", () => {
  const job = publicAiJob({ id: "job-1", status: "succeeded", output_payload: { ...candidate(), instrument: "/Users/example/source.md" } }, index);
  assert.equal(job.output_payload, null);
  assert.doesNotMatch(JSON.stringify(job), /Users|source\.md/);
});

test("alternate runtime raw metadata is rejected by the write-side guard", () => {
  const output = publicAnalysisOutput(candidate(), index)!;
  assert.throws(() => assertPublishedAnalysisOutput({ ...output, private_sources: ["source.md"] }), /invalid_public_analysis/);
  assert.throws(() => assertPublishedAnalysisOutput({ ...output, source_visibility: "private_research" }), /invalid_public_analysis/);
  assert.throws(() => assertPublishedAnalysisOutput({ ...output, valid_scenarios: [{ ...(output.valid_scenarios as Record<string, unknown>[])[0], source: "source.md" }] }), /invalid_public_analysis/);
});

test("write-side guard validates every nested public field and the no-evidence branch", () => {
  const output = publicAnalysisOutput(candidate(), index)!;
  for (const changed of [
    { current_pattern: "../references/private.md" }, { risk: { "source_id": 5 } },
    { analysis_basis: [{ kind: "structure", summary: "safe", conditions: ["../references/private.md"], invalidations: [] }] },
    { analysis_basis: [{ kind: "verified", summary: "not verified", conditions: [], invalidations: [] }] },
    { scope: { mode: "all", private_sources: [] } },
    { citations: [{ ...(output.citations as Record<string, unknown>[])[0], local_file: "secret.md" }] },
    { citations: [{ ...(output.citations as Record<string, unknown>[])[0], href: "file:///Users/example/private.md" }] },
    { knowledge_version: "private-snapshot" },
  ]) assert.throws(() => assertPublishedAnalysisOutput({ ...output, ...changed }));
  const empty = publicAnalysisOutput({ status: "insufficient_evidence" }, index)!;
  assert.throws(() => assertPublishedAnalysisOutput({ ...empty, current_pattern: "extra unvalidated text" }));
  assert.throws(() => assertPublishedAnalysisOutput({ ...empty, reason: "/Users/example/private.md" }));
});

test("missing evidence and malformed legacy outputs do not gain invented learning claims", () => {
  const output = publicAnalysisOutput({ status: "insufficient_evidence", knowledge_version: index.knowledgeVersion }, index)!;
  assert.deepEqual(output.analysis_basis, []);
  assert.equal(output.learning_basis, undefined);
  assertPublishedAnalysisOutput(output);
  assert.equal(publicAnalysisOutput({ raw: "PRIVATE TITLE" }, index), null);
});
