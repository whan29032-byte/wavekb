import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import { KnowledgeRuntime } from "../src/knowledge/runtime.ts";
import { researchModelInput } from "../src/research/model-input.ts";
import { assertPublishedAnalysisOutput, publicAiJob, publicAnalysisOutput } from "../src/research/publication.ts";
import { buildWaveChart, normalizeChartSpec, type ChartInput, type WaveChart } from "../src/research/wave-chart.ts";
import type { NormalizedAiRunRequest } from "../src/knowledge/contracts.ts";
import type { ProviderRequest, ProviderResult } from "../src/providers/types.ts";
import { finalizeResult } from "../src/pipeline/validate-result.ts";

const original = buildKnowledgeIndex();
const evidence = { ...original.chunks.find((chunk) => chunk.bookId === "elliott-wave-natural-law")!, searchable: "target impulse", text: "Contextual theory evidence." };
const index = { ...original, chunks: [evidence] };
const request = { request_version: 2, client_request_id: "11111111-1111-4111-8111-111111111111", task_type: "wave_analysis",
  step: 6, analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "all" } } as NormalizedAiRunRequest;
const chartContext = { schema_version: "wavekb-chart-context-v1", instrument: "target", timeframe: "4h" };
function candles(prices = [100, 120, 110, 160, 140, 175]): ChartInput {
  return { schema_version: "wavekb-chart-input-v1", bars: prices.map((price, i) => ({ time: 1700000000 + i * 14400, open: price, high: price + 2, low: price - 2, close: price })) };
}
function spec(prices = [100, 120, 110, 160, 140, 175]) {
  return { scenarios: [{ key: "primary", direction: "up", points: prices.map((_, i) => ({ bar_index: i, field: "close", label: i < 6 ? String(i) : "A", certainty: "candidate" })), invalidation: null }] };
}
function candidate(extra: Record<string, unknown> = {}) {
  return { instrument: "target", timeframe: "4h", analysis_level: "4h", parent_trend: "up", current_pattern: "impulse", current_subwave: "5",
    valid_scenarios: [{ key: "primary", pattern: "impulse", conditions: ["结构保持"], invalidations: ["越过起点"], confidence: 0.6 }],
    eliminated_scenarios: [], knowledge_citations: [evidence.chunkId], unknown_fields: [], ...extra };
}
function analysis(input: ChartInput = candles()) {
  return { instrument: "target", primary_timeframe: "4h", owner_id: "private-owner", step_data: {
    "5": { pattern: "impulse" }, "6": { chart_data: input, chart_context: chartContext } } };
}
function outcome(value: unknown, finishReason = "stop"): ProviderResult {
  return { text: JSON.stringify(value), usage: { inputTokens: 5, outputTokens: 4 }, finishReason };
}
function fixture(outcomes = [outcome(candidate({ chart_spec: spec() }))], contextTokens = 32768) {
  const requests: ProviderRequest[] = [];
  const audits: unknown[] = [];
  const runtime = new KnowledgeRuntime({ loadIndex: () => index, database: { request: async (_path, options) => { audits.push(options?.body); return []; } } });
  const connection = { id: "connection", ownerId: "private-owner", modelName: "test-only-model", timeoutMs: 1000,
    temperature: 0, maxOutputTokens: 4096, contextTokens, provider: { invoke: async (value: ProviderRequest) => {
      requests.push(value); return outcomes[Math.min(requests.length - 1, outcomes.length - 1)]!;
    } } };
  const run = (current: Record<string, unknown> = analysis(), step = 6) => runtime.run({
    job: { id: "job", task_type: "wave_analysis", input_payload: { ...request, step }, knowledge_version: index.knowledgeVersion }, analysis: current, connection });
  return { run, requests, audits };
}

test("latest bound candles reach the provider only once; metadata and future data do not", () => {
  const input = researchModelInput({ ...analysis(), step_data: {
    "2": { chart_data: candles([20, 21]), chart_context: chartContext }, "5": { pattern: "impulse" },
    "6": { chart_data: candles(), chart_context: chartContext }, "7": { chart_data: { private_source: "private.md" } } } }, request);
  assert.deepEqual((input.analysis as Record<string, unknown>).chart_data, candles());
  assert.equal(JSON.stringify(input).match(/wavekb-chart-input-v1/g)?.length, 1);
  assert.doesNotMatch(JSON.stringify(input), /private|chart_context|owner_id/);
  for (const context of [undefined, { ...chartContext, instrument: "BTCUSDT" }, { ...chartContext, timeframe: "1d" }]) {
    assert.throws(() => researchModelInput({ ...analysis(), step_data: { "6": { chart_data: candles(), chart_context: context } } }, request), /invalid_chart_input/);
  }
  for (const instrument of ["BINANCE:BTCUSDT", "COMEX:GC1!", "CME_MINI:ES1!", "BTC/USDT"]) {
    const input = researchModelInput({ ...analysis(), instrument, step_data: { "6": { chart_data: candles(), chart_context: { ...chartContext, instrument } } } }, request);
    assert.equal((input.analysis as Record<string, unknown>).instrument, instrument);
  }
});

test("server constructs and publishes the same candle-anchored candidate chart through polling", async () => {
  const f = fixture(); const result = await f.run();
  const output = result.output as unknown as Record<string, unknown>;
  const chart = output.wave_chart as WaveChart;
  assert.equal(chart.mode, "ohlc");
  assert.equal(chart.scenarios[0]?.points[2]?.price, 110);
  assert.equal(chart.scenarios[0]?.max_retracement?.amount, 20);
  assert.equal(chart.scenarios[0]?.max_retracement?.threshold, 155);
  assert.equal(output.chart_spec, undefined);
  assertPublishedAnalysisOutput(output);
  assert.deepEqual(publicAnalysisOutput(output, index), output);
  assert.deepEqual(publicAiJob({ id: "job", status: "succeeded", output_payload: output }, index).output_payload, output);
  assert.equal(f.requests.length, 1); assert.equal(f.audits.length, 1);
});

test("schema refuses invented prices, same-candle pivots, duplicate counts, and specs without candles", () => {
  const valid = candidate({ chart_spec: spec() });
  assert.throws(() => finalizeResult(valid, {}, new Set([evidence.chunkId])), /chart requires/);
  for (const change of [{ price: 999 }, { bar_index: 0 }, { label: "0" }, { bar_index: 128 }, { source_id: "private" }]) {
    const modified = structuredClone(spec()); Object.assign(modified.scenarios[0]!.points[1]!, change);
    assert.throws(() => finalizeResult(candidate({ chart_spec: modified }), {}, new Set([evidence.chunkId]), candles()));
  }
  assert.throws(() => normalizeChartSpec({ scenarios: [spec().scenarios[0], spec().scenarios[0]] }, candles()));
  assert.throws(() => finalizeResult(candidate({ chart_spec: { scenarios: [{ ...spec().scenarios[0], key: "alternative_a" }] } }), {}, new Set([evidence.chunkId]), candles()));
});

test("malformed latest input fails before audit/provider and never uses older valid candles", async () => {
  const f = fixture();
  await assert.rejects(f.run({ ...analysis(), step_data: { "2": { chart_data: candles(), chart_context: chartContext },
    "6": { chart_data: { schema_version: "wavekb-chart-input-v1", bars: [] }, chart_context: chartContext } } }), (error: unknown) => (error as { code: string }).code === "invalid_chart_input");
  assert.equal(f.requests.length, 0); assert.equal(f.audits.length, 0);
  const dto = publicAiJob({ id: "job", status: "failed", error_code: "invalid_chart_input", error_message: "private.md" }, index);
  assert.match(String(dto.error_message), /重新导入/); assert.doesNotMatch(JSON.stringify(dto), /private\.md/);
});

test("rule gate checks actual candle anchors including extra correction labels and partial counts", async () => {
  for (const prices of [[100, 120, 90, 160, 140, 175], [100, 120, 90, 160, 140, 175, 180], [100, 120, 90]]) {
    const f = fixture([outcome(candidate({ chart_spec: spec(prices) }))]);
    const output = (await f.run(analysis(candles(prices)))).output as unknown as Record<string, any>;
    assert.equal(output.valid_scenarios.length, 0);
    assert.equal(output.eliminated_scenarios[0]?.violations[0]?.rule_id, "ewp-rule-impulse-core");
    assert.equal(output.wave_chart.scenarios.length, 0, "eliminated model count must not survive in chart");
    assert.ok(output.wave_chart.bars.length, "supplied price data remains available without fabricated counts");
  }
});

test("minor Roman impulse counts obey the same rules and ambiguous degrees are rejected", async () => {
  for (const [prices, direction] of [
    [[100, 120, 90, 160, 140, 175], "up"],
    [[100, 120, 90], "up"],
    [[100, 120, 90, 160, 140, 175, 180], "up"],
    [[200, 180, 210, 140, 160, 125], "down"],
  ] as const) {
    const chartSpec = spec([...prices]);
    chartSpec.scenarios[0]!.direction = direction;
    chartSpec.scenarios[0]!.points.forEach((point, i) => { point.label = ["0", "i", "ii", "iii", "iv", "v", "A"][i]!; });
    const f = fixture([outcome(candidate({ chart_spec: chartSpec }))]);
    const output = (await f.run(analysis(candles([...prices])))).output as unknown as Record<string, any>;
    assert.equal(output.valid_scenarios.length, 0);
    assert.equal(output.eliminated_scenarios[0]?.violations[0]?.rule_id, "ewp-rule-impulse-core");
    assert.equal(output.wave_chart.scenarios.length, 0);
  }
  const valid = spec();
  valid.scenarios[0]!.points.forEach((point, i) => { point.label = ["0", "i", "ii", "iii", "iv", "v"][i]!; });
  assert.equal(((await fixture([outcome(candidate({ chart_spec: valid }))]).run()).output as unknown as Record<string, any>).valid_scenarios.length, 1);
  for (const labels of [["0", "i", "i"], ["0", "ii", "i"], ["0", "1", "ii"], ["i", "0", "ii"]]) {
    const malformed = spec([100, 120, 110]);
    malformed.scenarios[0]!.points.forEach((point, i) => { point.label = labels[i]!; });
    assert.throws(() => normalizeChartSpec(malformed, candles([100, 120, 110])));
  }
  for (const labels of [["0", "2"], ["0", "ii"], ["1", "3"], ["i", "iii"], ["1", "4"], ["i", "iv"]]) {
    const partial = spec([100, 90]);
    partial.scenarios[0]!.points.forEach((point, i) => { point.label = labels[i]!; });
    const output = (await fixture([outcome(candidate({ chart_spec: partial }))]).run(analysis(candles([100, 90])))).output as unknown as Record<string, any>;
    assert.equal(output.valid_scenarios.length, 0, `known endpoints ${labels.join(',')} must not bypass rules`);
  }
  const chart = buildWaveChart(analysis(), { step: 6, chartSpec: valid })!;
  const malformedPublic = structuredClone(chart);
  malformedPublic.scenarios[0]!.points[2]!.label = "i";
  assert.throws(() => assertPublishedAnalysisOutput({ ...publicAnalysisOutput(candidate(), index, { waveChart: chart }), wave_chart: malformedPublic }));
});

test("latest manual structure and the rule gate use one price source; future steps are ignored", async () => {
  const good = { direction: "up", w1_start: 100, w1_end: 120, w2_end: 110, w3_end: 160, w4_end: 140, w5_end: 175 };
  const changed = { ...good, w2_end: 90 };
  const current = { instrument: "target", primary_timeframe: "4h", step_data: { "5": { pattern: "impulse", ...good }, "6": { primary: good }, "7": { primary: changed } } };
  const f = fixture([outcome(candidate())]);
  const output = (await f.run(current, 7)).output as unknown as Record<string, any>;
  assert.equal(output.valid_scenarios.length, 0); assert.equal(output.wave_chart, undefined);
  const earlier = (await fixture([outcome(candidate())]).run(current, 5)).output as unknown as Record<string, any>;
  assert.equal(earlier.valid_scenarios.length, 1); assert.equal(earlier.wave_chart.scenarios[0].points[2].price, 110);
});

test("malformed chart triggers only one same-provider repair and accounts for both requests", async () => {
  const invalid = spec(); Object.assign(invalid.scenarios[0]!.points[1]!, { price: 999 });
  const f = fixture([outcome(candidate({ chart_spec: invalid })), outcome(candidate({ chart_spec: spec() }))]);
  const result = await f.run();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1]?.temperature, 0);
  assert.deepEqual(result.provider?.usage, { inputTokens: 10, outputTokens: 8 });
  const failed = fixture([outcome(candidate({ chart_spec: invalid }))]);
  await assert.rejects(failed.run(), (error: unknown) => {
    const value = error as { code: string; provider: { usage: unknown } }; assert.equal(value.code, "invalid_model_output");
    assert.deepEqual(value.provider.usage, { inputTokens: 10, outputTokens: 8 }); return true;
  });
  assert.equal(failed.requests.length, 2);
});

test("explicit truncated or filtered JSON never becomes a successful chart without repair", async () => {
  for (const reason of ["length", "content_filter", "tool_calls"]) {
    const f = fixture([outcome(candidate({ chart_spec: spec() }), reason), outcome(candidate({ chart_spec: spec() }))]);
    const result = await f.run(); assert.equal(f.requests.length, 2); assert.equal(result.provider?.usage.outputTokens, 8);
    const failed = fixture([outcome(candidate({ chart_spec: spec() }), reason)]);
    await assert.rejects(failed.run(), (error: unknown) => (error as { code: string }).code === "invalid_model_output");
  }
});

test("candle serialization still respects the actual complete prompt plus repair budget", async () => {
  const input = candles(Array.from({ length: 128 }, (_, i) => 100 + i));
  const f = fixture([outcome(candidate())], 8192);
  await assert.rejects(f.run(analysis(input)), (error: unknown) => (error as { code: string }).code === "input_context_too_large");
  assert.equal(f.requests.length, 0); assert.equal(f.audits.length, 0);
});

test("public chart contains no raw spec or provenance, remains private and rejects stale or injected data", () => {
  const chart = buildWaveChart(analysis(), { step: 6, chartSpec: spec() })!;
  const value = { ...candidate(), knowledge_version: index.knowledgeVersion, chart_spec: { source_path: "private.md" } };
  const output = publicAnalysisOutput(value, index, { sourceVisibility: "private_research", waveChart: chart })!;
  assertPublishedAnalysisOutput(output); assert.deepEqual(output.citations, []);
  assert.equal(output.chart_spec, undefined); assert.doesNotMatch(JSON.stringify(output), /source_path|private\.md/);
  assert.throws(() => publicAnalysisOutput(value, index, { waveChart: { ...chart, instrument: "私人书名" }, privateSourceTerms: ["私人书名"] }), /private_source_disclosure/);
  for (const invalid of [{ ...chart, source_path: "private.md" }, { ...chart, schema_version: "unapproved" },
    { ...chart, scenarios: [{ ...chart.scenarios[0], max_retracement: { ...chart.scenarios[0]?.max_retracement, amount: 99 } }] }]) {
    assert.throws(() => assertPublishedAnalysisOutput({ ...output, wave_chart: invalid }));
    assert.equal(publicAiJob({ status: "succeeded", output_payload: { ...output, wave_chart: invalid } }, index).output_payload, null);
  }
  const legacy = publicAnalysisOutput({ ...value, wave_chart: chart }, index)!;
  assert.equal(legacy.wave_chart, undefined, "legacy/raw model charts must not gain a publication contract");
  assert.equal(publicAnalysisOutput({ ...value, eliminated_scenarios: value.valid_scenarios }, index, { waveChart: chart }), null);
});
