import type { AnalysisResult, ScenarioResult } from "../schemas/analysis-result.ts";

type Wave = { start: number; end: number };
type ScenarioInput = {
  pattern: string;
  direction?: "up" | "down";
  waves?: Record<string, Wave>;
};
type Violation = { rule_id: string; knowledge_page_id: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function scenarioInput(value: unknown): ScenarioInput | null {
  if (!isRecord(value) || typeof value.pattern !== "string") return null;
  const direction = value.direction === "down" ? "down" : "up";
  const points = ["w1_start", "w1_end", "w2_end", "w3_end", "w4_end", "w5_end"]
    .map((key) => finiteNumber(value[key]));
  if (points.some((point) => point === null)) return { pattern: value.pattern, direction };
  const w1Start = points[0] as number;
  const w1End = points[1] as number;
  const w2End = points[2] as number;
  const w3End = points[3] as number;
  const w4End = points[4] as number;
  const w5End = points[5] as number;
  return {
    pattern: value.pattern,
    direction,
    waves: {
      w1: { start: w1Start, end: w1End },
      w2: { start: w1End, end: w2End },
      w3: { start: w2End, end: w3End },
      w4: { start: w3End, end: w4End },
      w5: { start: w4End, end: w5End },
    },
  };
}

export function scenarioInputsFromAnalysis(
  analysis: Record<string, unknown>,
): Record<string, ScenarioInput> {
  const stepData = isRecord(analysis.step_data) ? analysis.step_data : {};
  const structural = isRecord(stepData["5"]) ? stepData["5"] : {};
  const shared = scenarioInput(structural);
  const result: Record<string, ScenarioInput> = {};
  for (const key of ["primary", "alternative_a", "alternative_b"]) {
    const specific = scenarioInput(structural[key]);
    if (specific ?? shared) result[key] = (specific ?? shared) as ScenarioInput;
  }
  return result;
}

function impulseViolations(scenario: ScenarioInput): Violation[] {
  const waves = scenario.waves ?? {};
  const { w1, w2, w3, w4, w5 } = waves;
  if (!w1 || !w2 || !w3 || !w4 || !w5) return [];
  const up = scenario.direction !== "down";
  const violations: Violation[] = [];
  const add = (failed: boolean, message: string) => {
    if (failed) violations.push({
      rule_id: "ewp-rule-impulse-core",
      knowledge_page_id: "core-impulse",
      message,
    });
  };
  add(up ? w2.end < w1.start : w2.end > w1.start, "浪2越过浪1起点。");
  add(up ? w3.end <= w1.end : w3.end >= w1.end, "浪3未超过浪1终点。");
  const lengths = [
    Math.abs(w1.end - w1.start),
    Math.abs(w3.end - w2.end),
    Math.abs(w5.end - w4.end),
  ];
  add((lengths[1] ?? 0) < (lengths[0] ?? 0) && (lengths[1] ?? 0) < (lengths[2] ?? 0), "浪3成为最短浪。");
  add(up ? w4.end < w1.end : w4.end > w1.end, "普通推动浪浪4进入浪1价格区域。");
  return violations;
}

export function applyRuleGate(
  result: AnalysisResult,
  scenarioInputs: Record<string, ScenarioInput>,
): AnalysisResult {
  const valid: ScenarioResult[] = [];
  const eliminated = [...result.eliminated_scenarios];
  for (const scenario of result.valid_scenarios) {
    const input = scenarioInputs[scenario.key] ?? scenarioInputs.primary;
    const violations = input?.pattern === "impulse" ? impulseViolations(input) : [];
    if (violations.length) eliminated.push({ ...scenario, violations });
    else valid.push(scenario);
  }
  return { ...result, valid_scenarios: valid, eliminated_scenarios: eliminated };
}
