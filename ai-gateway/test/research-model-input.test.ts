import assert from "node:assert/strict";
import test from "node:test";
import { researchModelInput } from "../src/research/model-input.ts";
import type { NormalizedAiRunRequest } from "../src/knowledge/contracts.ts";
const request = { request_version: 2, client_request_id: "11111111-1111-4111-8111-111111111111",
  task_type: "wave_analysis", step: 6, analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "all" } } as NormalizedAiRunRequest;
test("external model receives bounded analysis fields, not owners, provenance, storage or future reviews", () => {
  const input = researchModelInput({ id: "internal-id", owner_id: "internal-owner", email: "private@example.test", local_file: "private.md",
    instrument: "BTCUSDT", market: "crypto", risk_result: { source_id: "private" },
    step_data: { "5": { pattern: "impulse", notes: "等待确认", source_id: "private" },
      "6": { primary: { direction: "up", w1_start: 10, w1_end: 20, source_id: "private" } },
      "10": { lessons: "future private review" } } }, request);
  assert.deepEqual(input, { analysis: { instrument: "BTCUSDT", market: "crypto", step_data: {
    "5": { pattern: "impulse", notes: "等待确认" }, "6": { primary: { direction: "up", w1_start: 10, w1_end: 20 } } } },
    request: { task_type: "wave_analysis", step: 6, analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "all" } } });
  assert.doesNotMatch(JSON.stringify(input), /internal-|private|owner_id|client_request_id|source_id/);
});
test("model input bounds strings and arrays, rejects nested unknown objects and non-finite numbers", () => {
  const input = researchModelInput({ instrument: "A".repeat(2000), holding_style: { source: "private" }, step_data: {
    "2": { notes: "N".repeat(2000), direction: Infinity, equity_curve: Array(200).fill(100), primary: { w1_start: Infinity } } } }, request);
  const analysis = input.analysis as Record<string, unknown>;
  const steps = analysis.step_data as Record<string, Record<string, unknown>>;
  assert.equal(String(analysis.instrument).length, 128);
  assert.equal(analysis.holding_style, undefined);
  assert.equal(String(steps["2"]!.notes).length, 512);
  assert.equal((steps["2"]!.equity_curve as number[]).length, 100);
  assert.equal(steps["2"]!.direction, undefined);
  assert.deepEqual(steps["2"]!.primary, {});
});
