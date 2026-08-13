export type ScenarioResult = {
  key: string;
  pattern: string;
  conditions: string[];
  invalidations: string[];
  confidence: number;
  violations?: Array<{ rule_id: string; knowledge_page_id: string; message: string }>;
};

export type AnalysisResult = {
  instrument: string;
  timeframe: string;
  analysis_level: string;
  parent_trend: string;
  current_pattern: string;
  current_subwave: string;
  valid_scenarios: ScenarioResult[];
  eliminated_scenarios: ScenarioResult[];
  knowledge_citations: string[];
  unknown_fields: string[];
  risk?: Record<string, number>;
};

export function assertAnalysisShape(value: unknown): asserts value is AnalysisResult {
  if (!value || typeof value !== "object") throw new Error("analysis result must be an object");
  const item = value as Record<string, unknown>;
  const requiredStrings = [
    "instrument", "timeframe", "analysis_level", "parent_trend",
    "current_pattern", "current_subwave",
  ];
  if (requiredStrings.some((key) => typeof item[key] !== "string")) {
    throw new Error("analysis result is missing required string fields");
  }
  for (const key of ["valid_scenarios", "eliminated_scenarios", "knowledge_citations", "unknown_fields"]) {
    if (!Array.isArray(item[key])) throw new Error(`analysis result field ${key} must be an array`);
  }
}
