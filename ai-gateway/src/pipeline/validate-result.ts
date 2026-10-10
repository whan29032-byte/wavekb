import { assertAnalysisShape, type AnalysisResult } from "../schemas/analysis-result.ts";
import { normalizeChartSpec, type ChartInput } from "../research/wave-chart.ts";

export function validateAnalysisResult(
  value: unknown,
  knownKnowledgeIds: Set<string>,
  chartInput?: ChartInput | null,
): AnalysisResult {
  assertAnalysisShape(value, chartInput);
  const result = structuredClone(value);
  if (result.chart_spec !== undefined && chartInput) result.chart_spec = normalizeChartSpec(result.chart_spec, chartInput);
  for (const citation of result.knowledge_citations) {
    if (!knownKnowledgeIds.has(citation)) {
      throw new Error(`invalid knowledge citation: ${citation}`);
    }
  }
  for (const scenario of result.valid_scenarios) {
    if (!scenario.key || !scenario.pattern || !(scenario.confidence >= 0 && scenario.confidence <= 1)) {
      throw new Error("invalid scenario");
    }
  }
  return result;
}

export function finalizeResult(
  modelResult: unknown,
  calculatedRisk: Record<string, number>,
  knownKnowledgeIds: Set<string>,
  chartInput?: ChartInput | null,
): AnalysisResult {
  const validated = validateAnalysisResult(modelResult, knownKnowledgeIds, chartInput);
  return { ...validated, risk: structuredClone(calculatedRisk) };
}
