import type { NormalizedAiRunRequest } from "./contracts.ts";

const ANALYSIS_FIELDS = [
  "instrument",
  "market",
  "primary_timeframe",
  "parent_timeframe",
  "child_timeframe",
  "holding_style",
] as const;
const STEP_FIELDS = new Set([
  "mode", "degree", "equity_curve", "same_degree_refresh", "segment_complete",
  "pattern", "direction", "w1_start", "w1_end", "w2_end", "w3_end", "w4_end",
  "w5_end", "primary", "alternative_a", "alternative_b", "equity", "risk_percent",
  "entry", "stop", "target", "contract_multiplier", "lot_size", "fees",
  "entry_condition", "invalidation", "actual_result", "lessons", "notes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return "";
  }
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

export function buildKnowledgeQuery(
  analysis: Record<string, unknown>,
  request: NormalizedAiRunRequest,
): string {
  const parts = [`step ${request.step}`];
  for (const field of ANALYSIS_FIELDS) {
    const value = bounded(analysis[field], 128);
    if (value) parts.push(value);
  }
  const stepData = isRecord(analysis.step_data) ? analysis.step_data : {};
  const currentStep = stepData[String(request.step)];
  const current = isRecord(currentStep) ? currentStep : {};
  for (const [key, raw] of Object.entries(current)) {
    if (!STEP_FIELDS.has(key)) continue;
    const value = bounded(raw, key === "notes" ? 512 : 128);
    if (value) parts.push(value);
  }
  return parts.join(" ");
}
