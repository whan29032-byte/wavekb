import type { NormalizedAiRunRequest } from "../knowledge/contracts.ts";
import { selectChartInput } from "./wave-chart.ts";

const FIELDS = ["instrument", "market", "primary_timeframe", "parent_timeframe", "child_timeframe", "holding_style"];
const STEP_FIELDS = new Set(["mode", "degree", "equity_curve", "same_degree_refresh", "segment_complete", "pattern", "direction",
  "w1_start", "w1_end", "w2_end", "w3_end", "w4_end", "w5_end", "primary", "alternative_a", "alternative_b",
  "equity", "risk_percent", "entry", "stop", "target", "contract_multiplier", "lot_size", "fees",
  "entry_condition", "invalidation", "actual_result", "lessons", "notes"]);
const SCENARIO_FIELDS = new Set(["pattern", "direction", "w1_start", "w1_end", "w2_end", "w3_end", "w4_end", "w5_end"]);
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function scalar(value: unknown, maximum: number): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, maximum);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

/** Data minimization for the external model, not the internal audit record. */
export function researchModelInput(analysis: Record<string, unknown>, request: NormalizedAiRunRequest): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = scalar(analysis[field], 128);
    if (value !== undefined) output[field] = value;
  }
  const steps: Record<string, unknown> = {};
  const sourceSteps = record(analysis.step_data) ? analysis.step_data : {};
  // Do not leak future/private review notes into an earlier analysis request.
  for (let step = 0; step <= request.step; step++) {
    const source = sourceSteps[String(step)];
    if (!record(source)) continue;
    const current: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(source)) {
      if (!STEP_FIELDS.has(field)) continue;
      if (["primary", "alternative_a", "alternative_b"].includes(field) && record(raw)) {
        current[field] = Object.fromEntries(Object.entries(raw).filter(([key]) => SCENARIO_FIELDS.has(key))
          .map(([key, value]) => [key, scalar(value, 128)]).filter(([, value]) => value !== undefined));
      } else if (field === "equity_curve" && Array.isArray(raw)) {
        current[field] = raw.slice(0, 100).filter((value) => typeof value === "number" && Number.isFinite(value));
      } else {
        const value = scalar(raw, ["notes", "lessons", "actual_result", "entry_condition", "invalidation"].includes(field) ? 512 : 128);
        if (value !== undefined) current[field] = value;
      }
    }
    steps[String(step)] = current;
  }
  // Send the latest validated dataset once, not every historical upload. Invalid
  // new input must fail before a provider request, never fall back silently.
  const chart = selectChartInput(analysis, request.step, { requireContext: true });
  return { analysis: { ...output, step_data: steps, ...(chart ? { chart_data: chart } : {}) }, request: {
    task_type: request.task_type, step: request.step, analysis_schema_version: request.analysis_schema_version,
    knowledge_scope: request.knowledge_scope,
  } };
}
