import type { AnalysisResult, ScenarioResult } from "../schemas/analysis-result.ts";

type Wave = { start: number; end: number };
type ScenarioInput = {
  pattern: string;
  direction?: "up" | "down";
  waves?: Record<string, Wave>;
};
type Violation = { rule_id: string; knowledge_page_id: string; message: string };

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
    const input = scenarioInputs[scenario.key];
    const violations = input?.pattern === "impulse" ? impulseViolations(input) : [];
    if (violations.length) eliminated.push({ ...scenario, violations });
    else valid.push(scenario);
  }
  return { ...result, valid_scenarios: valid, eliminated_scenarios: eliminated };
}
