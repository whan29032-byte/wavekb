import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import { normalizeAiRunRequest } from "../src/knowledge/contracts.ts";
import { KnowledgeRuntime } from "../src/knowledge/runtime.ts";
import { publicAiJob } from "../src/research/publication.ts";
import type { ProviderRequest } from "../src/providers/types.ts";
import type { VisionImageReaderPort } from "../src/research/vision-images.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const IMAGE = "33333333-3333-4333-8333-333333333333";
const LATER_IMAGE = "44444444-4444-4444-8444-444444444444";
const original = buildKnowledgeIndex();
const evidence = { ...original.chunks.find((chunk) => chunk.bookId === "elliott-wave-natural-law")!, searchable: "target impulse", text: "Contextual theory evidence." };
const index = { ...original, chunks: [evidence] };
const baseRequest = { request_version: 2, client_request_id: OWNER, task_type: "wave_analysis", step: 6,
  analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "all" } };
const visionRequest = { ...baseRequest, request_version: 3, vision_image_ids: [IMAGE], vision_context: { instrument: "target", timeframe: "4h" } };
const analysis = { id: ANALYSIS, owner_id: OWNER, instrument: "target", primary_timeframe: "4h", step_data: {
  "5": { pattern: "impulse" }, "6": { vision_image_ids: [IMAGE] }, "7": { vision_image_ids: [LATER_IMAGE] } } };
function candidate(extra = {}) { return { instrument: "target", timeframe: "4h", analysis_level: "unknown", parent_trend: "unknown",
  current_pattern: "unknown", current_subwave: "unknown", valid_scenarios: [], eliminated_scenarios: [],
  knowledge_citations: [evidence.chunkId], unknown_fields: ["Screenshot prices are unverified."], ...extra }; }
function fixture(options: { supportsImages?: boolean; contextTokens?: number; outcomes?: unknown[]; readerFailure?: Error } = {}) {
  const requests: ProviderRequest[] = []; const reads: Parameters<VisionImageReaderPort["load"]>[0][] = [];
  const runtime = new KnowledgeRuntime({ loadIndex: () => index, database: { request: async () => [] },
    imageReader: { load: async (input) => { reads.push(input); if (options.readerFailure) throw options.readerFailure;
      return input.imageIds.map((imageId) => ({ imageId, mimeType: "image/png", dataUrl: "data:image/png;base64,c3ludGhldGlj" })); } } });
  const connection = { id: "connection", ownerId: OWNER, modelName: "deepseek-flash", maxOutputTokens: 4096,
    contextTokens: options.contextTokens ?? 32768, timeoutMs: 1000, temperature: 0,
    provider: { supportsImages: () => options.supportsImages ?? true, invoke: async (input: ProviderRequest) => {
      requests.push(input); const value = options.outcomes?.[Math.min(requests.length - 1, options.outcomes.length - 1)] ?? candidate();
      return { text: JSON.stringify(value), usage: { inputTokens: 1044, outputTokens: 50 }, finishReason: "stop" }; } } };
  const run = (input: Record<string, unknown> = visionRequest, current: Record<string, unknown> = analysis) => runtime.run({
    job: { id: "job", owner_id: OWNER, analysis_id: ANALYSIS, task_type: "wave_analysis", input_payload: input }, analysis: current, connection });
  return { run, requests, reads };
}

test("v3 strictly binds a nonempty fixed image selection; v2 rejects implicit image fields", () => {
  assert.deepEqual(normalizeAiRunRequest(visionRequest, index.books).vision_image_ids, [IMAGE]);
  assert.throws(() => normalizeAiRunRequest({ ...visionRequest, request_version: 2 }, index.books));
  for (const change of [{ vision_image_ids: [] }, { vision_image_ids: [IMAGE, IMAGE] }, { vision_image_ids: ["https://secret.invalid/image"] },
    { vision_context: { ...visionRequest.vision_context, path: "/private" } }, { step: 1 }, { step: 8 }]) {
    assert.throws(() => normalizeAiRunRequest({ ...visionRequest, ...change }, index.books));
  }
});

test("selected screenshot reaches user multimodal content without IDs, URLs or future screenshots in text", async () => {
  const f = fixture(); const result = await f.run();
  assert.deepEqual(f.reads, [{ ownerId: OWNER, analysisId: ANALYSIS, step: 6, imageIds: [IMAGE], instrument: "target", timeframe: "4h" }]);
  const parts = f.requests[0]!.messages[0]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  assert.equal(parts[0]!.type, "text"); assert.equal(parts[1]!.type, "image_url");
  assert.match(parts[1]!.image_url!.url, /^data:image\/png;base64,/);
  assert.doesNotMatch(parts[0]!.text!, new RegExp(`${IMAGE}|${LATER_IMAGE}|vision_image_ids|owner_id`));
  assert.equal((result.output as Record<string, unknown>).wave_chart, undefined, "a screenshot does not create candles");
  assert.equal(result.provider?.usage.inputTokens, 1044);
});

test("old jobs never read newly uploaded images; fixed v3 selection survives later draft removal", async () => {
  const text = fixture(); await text.run(baseRequest); assert.equal(text.reads.length, 0);
  assert.equal(typeof text.requests[0]!.messages[0]!.content, "string");
  const fixed = fixture(); await fixed.run(visionRequest, { ...analysis, step_data: { "5": { pattern: "impulse" }, "6": { vision_image_ids: [LATER_IMAGE] } } });
  assert.deepEqual(fixed.reads[0]!.imageIds, [IMAGE]);
});

test("unsupported model, owner, analysis, or instrument mismatches fail before any image download/model call", async () => {
  const unsupported = fixture({ supportsImages: false });
  await assert.rejects(unsupported.run(), /vision_model_required/);
  assert.equal(unsupported.reads.length, 0); assert.equal(unsupported.requests.length, 0);
  for (const change of [{ owner_id: LATER_IMAGE }, { id: LATER_IMAGE }, { instrument: "BTCUSDT" }, { primary_timeframe: "1d" }]) {
    const f = fixture(); await assert.rejects(f.run(visionRequest, { ...analysis, ...change }), /invalid_image_input/);
    assert.equal(f.reads.length, 0); assert.equal(f.requests.length, 0);
  }
});

test("image context reserves provider visual tokens rather than base64 byte length", async () => {
  const initial = fixture(); await initial.run(baseRequest);
  const sent = initial.requests[0]!;
  const repair = "The preceding output was invalid. Return one corrected JSON object only; do not add facts or citation IDs.";
  const contextTokens = Buffer.byteLength(sent.system) + Buffer.byteLength(String(sent.messages[0]!.content)) + Buffer.byteLength(repair) + 2048 + 4096 + 100;
  const text = fixture({ contextTokens }); await text.run(baseRequest);
  const vision = fixture({ contextTokens }); await assert.rejects(vision.run(), /input_context_too_large/);
  assert.equal(vision.reads.length, 0); assert.equal(vision.requests.length, 0);
});

test("single repair keeps the exact images and accounts for both calls without reading twice", async () => {
  const f = fixture({ outcomes: [{ incorrect: true }, candidate()] }); const result = await f.run();
  assert.equal(f.reads.length, 1); assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1]!.messages[0], f.requests[0]!.messages[0]);
  assert.equal(result.provider?.usage.inputTokens, 2088); assert.equal(result.provider?.usage.outputTokens, 100);
});

test("read failure is not silently converted to a text-only model call, and public errors do not leak paths", async () => {
  const f = fixture({ readerFailure: Object.assign(new Error("image_unavailable"), { code: "image_unavailable" }) });
  await assert.rejects(f.run(), /image_unavailable/); assert.equal(f.requests.length, 0);
  for (const code of ["vision_model_required", "invalid_image_input", "image_unavailable"]) {
    const publicJob = publicAiJob({ id: "job", status: "failed", error_code: code, error_message: "/private/secret" }, index);
    assert.equal(publicJob.error_code, code); assert.doesNotMatch(JSON.stringify(publicJob), /private\/secret/);
  }
});
