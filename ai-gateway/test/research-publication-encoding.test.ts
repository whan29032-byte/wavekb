import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeIndex } from "../src/knowledge/index.ts";
import { assertPublishedAnalysisOutput, publicAiJob, publicAnalysisOutput } from "../src/research/publication.ts";

// Synthetic corpus metadata only. These tests never load private source text.
const index: KnowledgeIndex = {
  schemaVersion: "wavekb-ai-knowledge-v1", knowledgeVersion: "a".repeat(64), books: [], chunks: [],
};
const opaqueId = `h_${"b".repeat(32)}`;
const candidate = (unknown: string[] = []) => ({
  instrument: "BTCUSDT", timeframe: "4h", analysis_level: "4h", parent_trend: "up",
  current_pattern: "推动结构候选", current_subwave: "3",
  valid_scenarios: [], eliminated_scenarios: [], unknown_fields: unknown,
  knowledge_citations: [], citations: [],
});
const percentEncode = (value: string) => [...Buffer.from(value)].map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");
function nestedPercent(value: string, depth: number): string {
  let encoded = percentEncode(value);
  for (let layer = 1; layer < depth; layer++) encoded = encoded.replace(/%/gu, "%25");
  return encoded;
}
const privateOutput = () => publicAnalysisOutput(candidate(), index, { sourceVisibility: "private_research" })!;
function assertDisclosure(callback: () => unknown) {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "private_source_disclosure");
    assert.equal((error as Error & { code?: string }).code, "private_source_disclosure");
    return true;
  });
}

test("double-encoded opaque IDs fail projection and final publication without returning the ID", () => {
  const encoded = `h%255F${"b".repeat(32)}`;
  assertDisclosure(() => publicAnalysisOutput(candidate([encoded]), index, {
    sourceVisibility: "private_research", privateSourceTerms: [opaqueId],
  }));
  assertDisclosure(() => assertPublishedAnalysisOutput({ ...privateOutput(), unknown_fields: [encoded] }));
});

for (const [label, encoded] of [
  ["nested percent source path", nestedPercent("/Users/synthetic/guide.md", 3)],
  ["nested percent private URL", nestedPercent("https://synthetic.example/source", 3)],
  ["nested decimal entity opaque ID", `h&#38;#95;${"b".repeat(32)}`],
  ["nested hexadecimal entity opaque ID", `h&#x26;#x5f;${"b".repeat(32)}`],
  ["mixed percent and numeric entities", `h%26%23x26%3B%235f%3B${"b".repeat(32)}`],
  ["mixed named and numeric entities", `h&amp;#x5f;${"b".repeat(32)}`],
  ["nested named percent entity", `h&amp;percnt;255F${"b".repeat(32)}`],
  ["named separator entities", "&sol;Users&sol;synthetic&sol;guide&period;md"],
  ["numeric source path without semicolons", "&#47Users&#47synthetic&#47guide&#46md"],
  ["fullwidth encoding markers", `ｈ％２５５Ｆ${"b".repeat(32)}`],
  ["nested encoded zero-width control", nestedPercent("结构\u200b条件", 2)],
] as const) {
  test(`rejects ${label} in both publication boundaries`, () => {
    assertDisclosure(() => publicAnalysisOutput(candidate([encoded]), index, { sourceVisibility: "private_research" }));
    assertDisclosure(() => assertPublishedAnalysisOutput({ ...privateOutput(), unknown_fields: [encoded] }));
  });
}

test("encoded non-ASCII private source terms are checked without publishing the decoded term", () => {
  const term = "合成内部标题";
  for (const encoded of [nestedPercent(term, 2), [...term].map((char) => `&#${char.codePointAt(0)};`).join("")]) {
    assertDisclosure(() => publicAnalysisOutput(candidate([encoded]), index, {
      sourceVisibility: "private_research", privateSourceTerms: [term],
    }));
  }
});

test("residual encoding over the bounded decode budget and unknown entities are rejected", () => {
  for (const encoded of [nestedPercent(opaqueId, 12), "候选&unknownentity;", "候选%FF", "候选&#x110000;", "候选&#55296;"]) {
    assert.ok(encoded.length < 2000);
    assertDisclosure(() => publicAnalysisOutput(candidate([encoded]), index));
    assertDisclosure(() => assertPublishedAnalysisOutput({ ...privateOutput(), unknown_fields: [encoded] }));
  }
});

test("encoded markers fail closed in nested basis, scenario and narrative fields", () => {
  const encoded = nestedPercent(opaqueId, 2);
  const output = privateOutput();
  for (const altered of [
    { ...output, current_pattern: encoded },
    { ...output, valid_scenarios: [{ key: "primary", pattern: "候选", conditions: [encoded], invalidations: [], confidence: 0.6 }] },
    { ...output, eliminated_scenarios: [{ key: "primary", pattern: encoded, conditions: [], invalidations: [], confidence: 0.6 }] },
    { ...output, analysis_basis: [{ kind: "structure", summary: "候选", conditions: [], invalidations: [encoded] }] },
  ]) assertDisclosure(() => assertPublishedAnalysisOutput(altered));
});

test("polling hides an encoded historical disclosure and uses only fixed error text", () => {
  const encoded = nestedPercent(opaqueId, 2);
  const job = publicAiJob({ id: "synthetic-job", status: "succeeded", output_payload: { ...privateOutput(), unknown_fields: [encoded] },
    error_code: "private_source_disclosure", error_message: encoded }, index);
  assert.equal(job.output_payload, null);
  assert.equal(job.error_code, "analysis_unavailable");
  assert.equal(job.error_message, "AI 候选分析未完成，请稍后重试或检查模型连接。");
  assert.equal(JSON.stringify(job).includes(encoded), false);
  assert.equal(JSON.stringify(job).includes(opaqueId), false);
});

test("polling omits encoded metadata markers while retaining valid job metadata", () => {
  const encoded = nestedPercent(opaqueId, 2);
  const job = publicAiJob({ id: encoded, analysis_id: "synthetic-analysis", status: "pending",
    created_at: nestedPercent("/Users/synthetic/source", 2), updated_at: "2026-10-11T02:00:00Z", finished_at: null }, index);
  assert.equal(Object.hasOwn(job, "id"), false);
  assert.equal(Object.hasOwn(job, "created_at"), false);
  assert.equal(job.analysis_id, "synthetic-analysis");
  assert.equal(job.updated_at, "2026-10-11T02:00:00Z");
  assert.equal(job.finished_at, null);
  assert.equal(job.status, "pending");
  assert.equal(JSON.stringify(job).includes(encoded), false);
});

test("ordinary percentages and harmless encoded Unicode retain their exact original display text", () => {
  const safe = ["回撤阈值 5%，参考 10%", "候选回撤 38.2%", "A&B 条件待确认", "&lt;50%", nestedPercent("结构候选", 2)];
  const value = candidate(safe);
  const original = structuredClone(value);
  const output = publicAnalysisOutput(value, index, { sourceVisibility: "private_research" })!;
  assert.deepEqual(output.unknown_fields, safe);
  assert.deepEqual(value, original, "publication may not rewrite original input");
  assertPublishedAnalysisOutput(output);
  assert.deepEqual(publicAnalysisOutput(output, index), output);
});
