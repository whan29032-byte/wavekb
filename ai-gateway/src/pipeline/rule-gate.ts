import type { AnalysisResult, ScenarioResult } from "../schemas/analysis-result.ts";
import type { WaveChart } from "../research/wave-chart.ts";

type Wave = { start: number; end: number };
type ScenarioInput = {
  pattern: string;
  direction?: "up" | "down";
  waves?: Record<string, Wave>;
  anchors?: Record<string, number>;
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
  const pattern = isRecord(stepData["5"]) ? stepData["5"].pattern : undefined;
  const structural = isRecord(stepData["6"]) ? stepData["6"] : {};
  const shared = scenarioInput({ ...structural, pattern });
  const result: Record<string, ScenarioInput> = {};
  for (const key of ["primary", "alternative_a", "alternative_b"]) {
    const specificValue = isRecord(structural[key])
      ? { ...structural[key], pattern }
      : structural[key];
    const specific = scenarioInput(specificValue);
    if (specific ?? shared) result[key] = (specific ?? shared) as ScenarioInput;
  }
  return result;
}

/** Apply existing theory rules to the exact supplied candle anchors used on
 * the chart. Partial/uncertain counts remain candidates, never filled in. */
export function scenarioInputsFromWaveChart(
  chart: WaveChart, boundedAnalysis: Record<string, unknown>, candidates: readonly ScenarioResult[] = [],
): Record<string, ScenarioInput> {
  const stepData = isRecord(boundedAnalysis.step_data) ? boundedAnalysis.step_data : {};
  const pattern = isRecord(stepData["5"]) ? stepData["5"].pattern : undefined;
  const result: Record<string, ScenarioInput> = {};
  for (const scenario of chart.scenarios) {
    // The contract admits one degree: 0..5 OR 0+i..v. Extra correction
    // annotations must not bypass either complete or partial impulse rules.
    const minorLabels = ["i", "ii", "iii", "iv", "v"];
    const numeric = new Map<string, number>();
    for (const point of scenario.points) {
      if (/^[0-5]$/u.test(point.label)) numeric.set(point.label, point.price);
      const minor = minorLabels.indexOf(point.label);
      if (minor >= 0) numeric.set(String(minor + 1), point.price);
    }
    if (numeric.size < 2) continue;
    const candidatePattern = candidates.find((candidate) => candidate.key === scenario.key)?.pattern;
    const waves: Record<string, Wave> = {};
    for (let wave = 1; wave <= 5; wave++) {
      const start = numeric.get(String(wave - 1));
      const end = numeric.get(String(wave));
      if (start !== undefined && end !== undefined) waves[`w${wave}`] = { start, end };
    }
    const selectedPattern = candidatePattern === "impulse" ? candidatePattern : pattern;
    if (typeof selectedPattern === "string") result[scenario.key] = { pattern: selectedPattern, direction: scenario.direction, waves, anchors: Object.fromEntries(numeric) };
  }
  return result;
}

function impulseViolations(scenario: ScenarioInput): Violation[] {
  const waves = scenario.waves ?? {};
  const { w1, w2, w3, w4, w5 } = waves;
  const p0 = scenario.anchors?.["0"] ?? w1?.start;
  const p1 = scenario.anchors?.["1"] ?? w1?.end;
  const p2 = scenario.anchors?.["2"] ?? w2?.end;
  const p3 = scenario.anchors?.["3"] ?? w3?.end;
  const p4 = scenario.anchors?.["4"] ?? w4?.end;
  const up = scenario.direction !== "down";
  const violations: Violation[] = [];
  const add = (failed: boolean, message: string) => {
    if (failed) violations.push({
      rule_id: "ewp-rule-impulse-core",
      knowledge_page_id: "core-impulse",
      message,
    });
  };
  // Known endpoints suffice for these comparisons; do not invent missing
  // intermediate points, or let an omitted point bypass an observed conflict.
  if (p0 !== undefined && p2 !== undefined) add(up ? p2 < p0 : p2 > p0, "浪2越过浪1起点。");
  if (p1 !== undefined && p3 !== undefined) add(up ? p3 <= p1 : p3 >= p1, "浪3未超过浪1终点。");
  if (w1 && w3 && w5) {
    const lengths = [Math.abs(w1.end - w1.start), Math.abs(w3.end - w3.start), Math.abs(w5.end - w5.start)];
    add(lengths[1]! < lengths[0]! && lengths[1]! < lengths[2]!, "浪3成为最短浪。");
  }
  if (p1 !== undefined && p4 !== undefined) add(up ? p4 < p1 : p4 > p1, "普通推动浪浪4进入浪1价格区域。");
  return violations;
}

export function applyRuleGate(
  result: AnalysisResult,
  scenarioInputs: Record<string, ScenarioInput>,
  options: { fallbackToPrimary?: boolean } = {},
): AnalysisResult {
  const valid: ScenarioResult[] = [];
  const eliminated = [...result.eliminated_scenarios];
  for (const scenario of result.valid_scenarios) {
    const input = scenarioInputs[scenario.key] ?? (options.fallbackToPrimary === false ? undefined : scenarioInputs.primary);
    const violations = input?.pattern === "impulse" ? impulseViolations(input) : [];
    if (violations.length) eliminated.push({ ...scenario, violations });
    else valid.push(scenario);
  }
  return { ...result, valid_scenarios: valid, eliminated_scenarios: eliminated };
}
