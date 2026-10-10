import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPrivateTheorySnapshot, rankPrivateTheory, privateTheoryDigest } from "../src/research/private-theory.ts";
import { KnowledgeRuntime } from "../src/knowledge/runtime.ts";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import type { ResolvedUserConnection } from "../src/secrets/user-connection.ts";

const exporter = await import(new URL("../../scripts/lib/hermes-theory-artifact.mjs", import.meta.url).href);
function artifactFixture(t: test.TestContext) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-private-runtime-test-")));
  fs.chmodSync(dir, 0o700); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "references"), { mode: 0o700 });
  for (const [i, file] of (exporter.HERMES_THEORY_SOURCE_ALLOWLIST as string[]).entries()) {
    fs.writeFileSync(path.join(dir, file), `# 结构 ${i}\n推动浪与波浪结构是候选判断。应观察浪2起点、浪4价格与失效条件。\n`, { mode: 0o600 });
  }
  return exporter.buildCuratedHermesTheoryArtifact({ sourceRoot: dir });
}
function signedTextCopy(artifact: any, text: string, chunkBoundary?: number) {
  const copy = structuredClone(artifact), source = copy.sources[0];
  const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
  source.curated.sha256 = sha(text); source.curated.bytes = Buffer.byteLength(text, "utf8");
  source.receipt.curatedSha256 = source.curated.sha256;
  const { transformSha256: _oldReceipt, ...receipt } = source.receipt;
  source.receipt.transformSha256 = privateTheoryDigest(receipt);
  const parts = chunkBoundary ? [text.slice(0, chunkBoundary), text.slice(chunkBoundary)] : [text];
  copy.chunks = [...parts.map((part, i) => ({ sourceId: source.id, index: i, text: part, authority: "supplement",
    sha256: sha(part), id: `h_${sha(`${source.id}\0${i}\0${part}`).slice(0, 32)}` })), ...copy.chunks.filter((chunk: any) => chunk.sourceId !== source.id)];
  const { artifactSha256: _oldArtifact, ...payload } = copy;
  copy.artifactSha256 = privateTheoryDigest(payload);
  return copy;
}
const index = buildKnowledgeIndex();
const analysis = { instrument: "BTCUSDT", primary_timeframe: "4h", market: "crypto", step_data: { "5": { pattern: "impulse", notes: "波浪结构" } } };
const request = { request_version: 2, client_request_id: "11111111-1111-4111-8111-111111111111", task_type: "wave_analysis", step: 5, analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "all" } };
const model = { instrument: "BTCUSDT", timeframe: "4h", analysis_level: "4h", parent_trend: "unknown", current_pattern: "candidate", current_subwave: "unknown", valid_scenarios: [], eliminated_scenarios: [], unknown_fields: [], knowledge_citations: [] };

test("server v2 loader checks canonical digest, immutable original/review provenance, and returns opaque supplements only", (t) => {
  const artifact = artifactFixture(t);
  const loaded = loadPrivateTheorySnapshot(artifact, artifact.artifactSha256);
  assert.equal(loaded.artifactSha256, artifact.artifactSha256);
  assert.ok(loaded.chunks.every((chunk) => Object.keys(chunk).sort().join(",") === "authority,id,text"));
  assert.ok(rankPrivateTheory(loaded, "推动浪结构").length > 0);
  assert.doesNotMatch(JSON.stringify(loaded.chunks), /references|source-pages|original|curated|sha256/);
  assert.throws(() => loadPrivateTheorySnapshot(artifact, crypto.createHash("sha256").update(JSON.stringify(artifact)).digest("hex")), /^Error: private_theory_unavailable$/);
  for (const change of [
    (a: any) => { a.schemaVersion = "hermes-private-theory-v1"; },
    (a: any) => { a.sources[0].original.version = "old"; },
    (a: any) => { a.sources[0].receipt.counts.noticeAdded = 0; },
    (a: any) => { a.sources[0].curated.bytes++; },
    (a: any) => { a.chunks[0].text = "api_key=synthetic"; },
    (a: any) => { a.extra = "metadata"; },
  ]) { const copy = structuredClone(artifact); change(copy); assert.throws(() => loadPrivateTheorySnapshot(copy, copy.artifactSha256), /^Error: private_theory_unavailable$/); }
});

test("enabled private research fails closed before audit/provider if active snapshot is missing or invalid", async (t) => {
  const artifact = artifactFixture(t); let calls = 0;
  for (const active of [null, { artifact, expectedSha256: "a".repeat(64) }]) {
    const runtime = new KnowledgeRuntime({ database: { request: async () => { calls++; return []; } }, privateResearchEnabled: true,
      privateRepository: { loadActiveArtifact: async () => active, recordRetrieval: async () => { calls++; } } });
    await assert.rejects(runtime.run({ job: { id: "job", task_type: "wave_analysis", input_payload: request }, analysis,
      connection: { contextTokens: 131072, maxOutputTokens: 4096, provider: { invoke: async () => { calls++; } } } as unknown as ResolvedUserConnection }), { message: "knowledge_unavailable" });
  }
  assert.equal(calls, 0);
});

test("matching canonical signatures do not bypass private text checks or split-boundary protections", (t) => {
  const artifact = artifactFixture(t), original = artifact.chunks[0].text as string;
  for (const malicious of ["sk_live_syntheticsecret", "bot_token=synthetic", "context_token:synthetic", "seed_phrase=synthetic",
    "eyJsynthetic.payload.signature", "auth.json", "用户：私聊", "https://example.invalid", "%2fUsers%2fexample", "&#47;Users&#47;example",
    "references/old-source.md", "\\\\host\\sensitive", "user_id=synthetic"]) {
    const copy = signedTextCopy(artifact, `${original}\n${malicious}`);
    assert.throws(() => loadPrivateTheorySnapshot(copy, copy.artifactSha256), /^Error: private_theory_unavailable$/, malicious);
  }
  const crossing = `${original}\n%2fUsers%2fexample`, split = crossing.indexOf("%2fUsers") + 4;
  const copy = signedTextCopy(artifact, crossing, split);
  assert.throws(() => loadPrivateTheorySnapshot(copy, copy.artifactSha256), /^Error: private_theory_unavailable$/);
  const noNotice = signedTextCopy(artifact, "推动浪结构，没有补充理论边界告知。");
  assert.throws(() => loadPrivateTheorySnapshot(noNotice, noNotice.artifactSha256), /^Error: private_theory_unavailable$/);
});

test("private research uses service-only audit, opaque prompt fragments and reference-free output without changing public primary sources", async (t) => {
  const artifact = artifactFixture(t); const requests: any[] = [], audits: any[] = [];
  const runtime = new KnowledgeRuntime({ database: { request: async () => { throw new Error("owner-readable audit must not receive private data"); } },
    privateResearchEnabled: true, privateRepository: { loadActiveArtifact: async () => ({ artifact, expectedSha256: artifact.artifactSha256 }), recordRetrieval: async (value) => { audits.push(value); } } });
  const connection = { modelName: "mock", contextTokens: 131072, maxOutputTokens: 4096, temperature: .2, timeoutMs: 1000,
    provider: { invoke: async (req: any) => { requests.push(req); return { text: JSON.stringify({ ...model, knowledge_citations: [artifact.chunks[0].id] }), usage: { inputTokens: 2, outputTokens: 3 }, finishReason: "stop" }; } } } as ResolvedUserConnection;
  const result = await runtime.run({ job: { id: "job", task_type: "wave_analysis", input_payload: request }, analysis, connection });
  assert.equal((result.output as any).source_visibility, "private_research");
  assert.deepEqual((result.output as any).knowledge_citations, []); assert.deepEqual(result.output.citations, []);
  assert.equal(result.knowledgeVersion, index.knowledgeVersion);
  assert.equal(requests.length, 1); assert.equal(audits.length, 1); assert.ok(audits[0].chunkIds.length > 0);
  const prompt = requests[0].messages[0].content as string;
  assert.match(prompt, /supplementary_untrusted_fragments/); assert.match(requests[0].system, /eleventh edition/);
  assert.doesNotMatch(prompt, /references\/source|book-distillation|curation-receipt|originalSha256|privateSourceTerms/);
  assert.doesNotMatch(JSON.stringify(result.output), /h_[a-f0-9]{32}|s_[a-f0-9]{32}|artifactSha256|curation|references/);
});

test("private audit failure fails closed and single-public-book scope is not broadened", async (t) => {
  const artifact = artifactFixture(t); let providerCalls = 0; const audits: any[] = [];
  const connection = { modelName: "mock", contextTokens: 131072, maxOutputTokens: 4096, temperature: .2, timeoutMs: 1000,
    provider: { invoke: async () => { providerCalls++; return { text: JSON.stringify(model), usage: { inputTokens: 2, outputTokens: 3 }, finishReason: "stop" }; } } } as unknown as ResolvedUserConnection;
  const repository = { loadActiveArtifact: async () => ({ artifact, expectedSha256: artifact.artifactSha256 }), recordRetrieval: async (value: any) => { audits.push(value); throw new Error("private internal source/path"); } };
  const runtime = new KnowledgeRuntime({ database: { request: async () => [] }, privateResearchEnabled: true, privateRepository: repository });
  await assert.rejects(runtime.run({ job: { id: "job", task_type: "wave_analysis", input_payload: { ...request, knowledge_scope: { mode: "single", book_id: "elliott-wave-principle-eleventh-edition" } } }, analysis, connection }), { message: "knowledge_unavailable" });
  assert.equal(providerCalls, 0); assert.deepEqual(audits[0].chunkIds, []);
});

test("private names and opaque source IDs in narrative are rejected with exact provider usage retained", async (t) => {
  const artifact = artifactFixture(t);
  for (const narrative of [artifact.chunks[0].id, artifact.privateSourceTerms[0]]) {
    let calls = 0;
    const runtime = new KnowledgeRuntime({ database: { request: async () => [] }, privateResearchEnabled: true,
      privateRepository: { loadActiveArtifact: async () => ({ artifact, expectedSha256: artifact.artifactSha256 }), recordRetrieval: async () => {} } });
    const connection = { modelName: "mock", contextTokens: 131072, maxOutputTokens: 4096, temperature: .2, timeoutMs: 1000,
      provider: { invoke: async () => { calls++; return { text: JSON.stringify({ ...model, current_pattern: narrative }), usage: { inputTokens: 11, outputTokens: 13 }, finishReason: "stop" }; } } } as unknown as ResolvedUserConnection;
    await assert.rejects(runtime.run({ job: { id: "job", task_type: "wave_analysis", input_payload: request }, analysis, connection }),
      (error: any) => error.code === "invalid_model_output" && error.message === "invalid_model_output"
        && error.provider.usage.inputTokens === 11 && error.provider.usage.outputTokens === 13);
    assert.equal(calls, 1, "publication disclosure is not a license for extra provider attempts");
  }
});
