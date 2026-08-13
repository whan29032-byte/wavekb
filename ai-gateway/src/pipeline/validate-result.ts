import { assertAnalysisShape, type AnalysisResult } from "../schemas/analysis-result.ts";

export function validateAnalysisResult(
  value: unknown,
  knownKnowledgeIds: Set<string>,
): AnalysisResult {
  assertAnalysisShape(value);
  const result = structuredClone(value);
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
): AnalysisResult {
  const validated = validateAnalysisResult(modelResult, knownKnowledgeIds);
  return { ...validated, risk: structuredClone(calculatedRisk) };
}
