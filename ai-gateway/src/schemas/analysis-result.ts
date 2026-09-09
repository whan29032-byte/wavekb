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

const REQUIRED_RESULT_KEYS = new Set([
  "instrument", "timeframe", "analysis_level", "parent_trend", "current_pattern",
  "current_subwave", "valid_scenarios", "eliminated_scenarios", "knowledge_citations",
  "unknown_fields",
]);
const ALLOWED_RESULT_KEYS = new Set([...REQUIRED_RESULT_KEYS, "risk"]);
const SCENARIO_KEYS = new Set(["key", "pattern", "conditions", "invalidations", "confidence"]);

function schemaError(message: string): never {
  throw new Error(`analysis result schema: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value)
    || value.length > 100
    || value.some((item) => typeof item !== "string" || item.length > 2_000)) {
    schemaError(`${field} must be a string array`);
  }
}

function assertScenario(value: unknown): asserts value is ScenarioResult {
  if (!isRecord(value)) schemaError("scenario must be an object");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== SCENARIO_KEYS.size
    || keys.some((key) => typeof key !== "string" || !SCENARIO_KEYS.has(key))) {
    schemaError("scenario fields are invalid");
  }
  if (typeof value.key !== "string" || !value.key || value.key.length > 120
    || typeof value.pattern !== "string" || !value.pattern || value.pattern.length > 240
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) {
    schemaError("scenario values are invalid");
  }
  exactStringArray(value.conditions, "scenario conditions");
  exactStringArray(value.invalidations, "scenario invalidations");
}

export function assertAnalysisShape(value: unknown): asserts value is AnalysisResult {
  if (!isRecord(value)) schemaError("result must be an object");
  const item = value;
  const keys = Reflect.ownKeys(item);
  if (keys.some((key) => typeof key !== "string" || !ALLOWED_RESULT_KEYS.has(key))
    || [...REQUIRED_RESULT_KEYS].some((key) => !Object.hasOwn(item, key))) {
    schemaError("result fields are invalid");
  }
  const requiredStrings = [
    "instrument", "timeframe", "analysis_level", "parent_trend",
    "current_pattern", "current_subwave",
  ];
  if (requiredStrings.some((key) => typeof item[key] !== "string" || String(item[key]).length > 2_000)) {
    schemaError("result is missing required string fields");
  }
  for (const key of ["valid_scenarios", "eliminated_scenarios"] as const) {
    if (!Array.isArray(item[key]) || item[key].length > 20) schemaError(`${key} must be an array`);
    item[key].forEach(assertScenario);
  }
  exactStringArray(item.knowledge_citations, "knowledge_citations");
  exactStringArray(item.unknown_fields, "unknown_fields");
  if (new Set(item.knowledge_citations).size !== item.knowledge_citations.length) {
    schemaError("knowledge_citations must be unique");
  }
  if (Object.hasOwn(item, "risk")) {
    if (!isRecord(item.risk)
      || Object.values(item.risk).some((number) => typeof number !== "number" || !Number.isFinite(number))) {
      schemaError("risk must contain finite numbers");
    }
  }
}
