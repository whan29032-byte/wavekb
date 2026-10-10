import { PUBLISHED_BOOK_IDS, type KnowledgeIndex } from "../knowledge/index.ts";
import { assertWaveChart, type WaveChart } from "./wave-chart.ts";

export const PUBLIC_ANALYSIS_SCHEMA = "wavekb-public-analysis-v1";
type RecordValue = Record<string, unknown>;
type PublicationOptions = {
  sourceVisibility?: "public_books" | "private_research";
  privateSourceTerms?: readonly string[];
  // Only server-derived data; chart_spec from a model is never projected.
  waveChart?: WaveChart | null;
};
const SOURCE_MARKER = /(?:https?:\/\/|file:\/\/|www\.|\/(?:Users|home|private|var|tmp|opt|srv|mnt|etc)\/|[a-z]:[\\/]|~\/|\.\.?\/|\.hermes|\/knowledge\/|(?:source[_ -]?(?:id|title|path)|knowledge[_ -]?id|private_sources|retrieval_debug)|(?:hermes|local|private)[-_:](?:knowledge|theory|research|source|kb)|\b[hs]_[a-f0-9]{32}\b|\.(?:md|pdf|epub|txt|jsonl?|sqlite|db|ya?ml)(?:\b|$))/iu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
const HEX = /^[a-f0-9]{64}$/;
const JOB_STATUSES = new Set(["queued", "pending", "running", "waiting_retry", "succeeded", "failed", "cancelled", "canceled"]);
const RESULT_STRINGS = ["instrument", "timeframe", "analysis_level", "parent_trend", "current_pattern", "current_subwave"] as const;
// Only rule IDs actually emitted by the public rule gate, never arbitrary
// identifiers supplied by a model or future private research runtime.
const PUBLIC_RULE_IDS = new Set(["ewp-rule-impulse-core"]);

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function safeText(value: unknown, maximum: number, terms: readonly string[]): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  const normalized = value.normalize("NFKC").toLocaleLowerCase("und")
    .replace(/%([0-9a-f]{2})/gu, (match, hex: string) => Number.parseInt(hex, 16) <= 127 ? String.fromCharCode(Number.parseInt(hex, 16)) : match)
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gu, (match, hex: string | undefined, decimal: string | undefined) => {
      const number = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return number <= 127 ? String.fromCharCode(number) : match;
    });
  if (CONTROL.test(value) || CONTROL.test(normalized) || SOURCE_MARKER.test(normalized) || terms.some((term) => term && normalized.includes(term.normalize("NFKC").toLocaleLowerCase("und")))) {
    throw Object.assign(new Error("private_source_disclosure"), { code: "private_source_disclosure" });
  }
  return value;
}
function textList(value: unknown, maximum: number, length: number, terms: readonly string[]): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const values = value.map((item) => safeText(item, length, terms));
  return values.some((item) => item === null) ? null : values as string[];
}
function publicBookSnippet(text: string): string {
  const snippet = text.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 280);
  try { return safeText(snippet, 280, []) ?? "请查看公开书籍对应页面。"; }
  catch {
    // A published appendix can contain build-file inventories. Keep the public
    // book link without publishing that file list or inventing a theory summary.
    return "请查看公开书籍对应页面；此片段含目录或来源标记，未直接展示。";
  }
}
function scenarios(value: unknown, terms: readonly string[]): RecordValue[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const result: RecordValue[] = [];
  for (const item of value) {
    if (!record(item)) return null;
    const key = safeText(item.key, 120, terms);
    const pattern = safeText(item.pattern, 240, terms);
    const conditions = textList(item.conditions, 100, 2000, terms);
    const invalidations = textList(item.invalidations, 100, 2000, terms);
    if (!key || !pattern || !conditions || !invalidations || typeof item.confidence !== "number"
      || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) return null;
    const violations: RecordValue[] = [];
    if (Array.isArray(item.violations)) {
      for (const violation of item.violations.slice(0, 100)) {
        if (!record(violation) || typeof violation.rule_id !== "string" || !PUBLIC_RULE_IDS.has(violation.rule_id)) continue;
        const message = safeText(violation.message, 2000, terms);
        if (message !== null) violations.push({ rule_id: violation.rule_id, message });
      }
    }
    // Keep the rule decision, but never knowledge_page_id or arbitrary nested
    // diagnostics. Public rule IDs are not private document references.
    result.push({ key, pattern, conditions, invalidations, confidence: item.confidence,
      ...(violations.length ? { violations } : {}) });
  }
  return result;
}

/** Owner-readable output. Never use this object as the internal provenance log. */
export function publicAnalysisOutput(
  value: unknown,
  index: KnowledgeIndex,
  options: PublicationOptions = {},
): RecordValue | null {
  if (!record(value)) return null;
  // Missing policy is the sole legacy compatibility case. Unknown explicit
  // policies must never silently enable public citations.
  if ((value.source_visibility !== undefined && !["public_books", "private_research"].includes(String(value.source_visibility)))
    || (value.schema_version !== undefined && value.schema_version !== PUBLIC_ANALYSIS_SCHEMA)) return null;
  const visibility = options.sourceVisibility ?? (value.source_visibility === "private_research" ? "private_research" : "public_books");
  const terms = options.privateSourceTerms ?? [];
  const version = value.knowledge_version === index.knowledgeVersion ? index.knowledgeVersion : null;
  const scope = record(value.scope) ? value.scope : null;
  const base = {
    schema_version: PUBLIC_ANALYSIS_SCHEMA,
    source_visibility: visibility,
    // Only the public book version can enter this owner-readable field.
    ...(version ? { knowledge_version: version } : {}),
    ...(scope?.mode === "all" ? { scope: { mode: "all" } }
      : scope?.mode === "single" && index.books.some((book) => book.bookId === scope.book_id)
        ? { scope: { mode: "single", book_id: scope.book_id } } : {}),
  };
  if (value.status === "insufficient_evidence") {
    return { ...base, status: "insufficient_evidence", reason: "no_relevant_knowledge", knowledge_citations: [], citations: [], analysis_basis: [] };
  }
  const output: RecordValue = { ...base };
  for (const key of RESULT_STRINGS) {
    const text = safeText(value[key], 2000, terms);
    if (text === null) return null;
    output[key] = text;
  }
  const valid = scenarios(value.valid_scenarios, terms);
  const eliminated = scenarios(value.eliminated_scenarios, terms);
  const unknown = textList(value.unknown_fields, 100, 2000, terms);
  if (!valid || !eliminated || !unknown) return null;
  output.valid_scenarios = valid;
  output.eliminated_scenarios = eliminated;
  output.unknown_fields = unknown;
  if (record(value.risk) && Object.entries(value.risk).every(([key, number]) => /^[a-z][a-z0-9_]{0,60}$/u.test(key)
    && safeText(key, 61, terms) !== null && typeof number === "number" && Number.isFinite(number))) {
    output.risk = { ...value.risk };
  }
  const publicIds = visibility === "public_books" && version && Array.isArray(value.knowledge_citations)
    ? new Set(value.knowledge_citations.filter((id): id is string => typeof id === "string")) : new Set<string>();
  const chunks = index.chunks.filter((chunk) => publicIds.has(chunk.chunkId));
  const books = new Map(index.books.map((book) => [book.bookId, book]));
  output.knowledge_citations = chunks.map((chunk) => chunk.chunkId);
  // Reconstruct from the approved public artifact. Never trust a model's
  // book_title, source_id, snippet or href, even with a valid-looking book ID.
  output.citations = chunks.map((chunk) => ({
    knowledge_id: chunk.chunkId, book_id: chunk.bookId,
    book_title: books.get(chunk.bookId)!.title, title: chunk.title,
    source_id: chunk.sourceId, pages: [...chunk.pdfPages], href: chunk.href,
    snippet: publicBookSnippet(chunk.text),
  }));
  output.analysis_basis = valid.slice(0, 12).map((scenario) => ({
    // A model candidate is not independently verified learning evidence.
    kind: "structure", summary: String(scenario.pattern).slice(0, 500),
    conditions: (scenario.conditions as string[]).slice(0, 6).map((text) => text.slice(0, 280)),
    invalidations: (scenario.invalidations as string[]).slice(0, 6).map((text) => text.slice(0, 280)),
  }));
  const chart = Object.hasOwn(options, "waveChart") ? options.waveChart
    : value.schema_version === PUBLIC_ANALYSIS_SCHEMA ? value.wave_chart : undefined;
  if (chart !== undefined && chart !== null) {
    assertWaveChart(chart);
    safeText(chart.instrument, 64, terms);
    safeText(chart.timeframe, 32, terms);
    const keys = new Set(valid.map((scenario) => scenario.key));
    const blocked = new Set(eliminated.map((scenario) => scenario.key));
    if (chart.scenarios.some((scenario) => !keys.has(scenario.key) || blocked.has(scenario.key))) return null;
    output.wave_chart = structuredClone(chart);
  }
  return output;
}

/** The same job DTO is used by new jobs, idempotent recovery and polling. */
export function publicAiJob(value: unknown, index: KnowledgeIndex): RecordValue {
  if (!record(value)) return {};
  const job: RecordValue = {};
  for (const key of ["id", "analysis_id", "created_at", "updated_at", "finished_at"] as const) {
    if (typeof value[key] === "string" && value[key].length <= 120 && !SOURCE_MARKER.test(value[key])) job[key] = value[key];
    else if (value[key] === null) job[key] = null;
  }
  if (typeof value.status === "string" && JOB_STATUSES.has(value.status)) job.status = value.status;
  if (value.execution_source === "byok" || value.execution_source === "managed") job.execution_source = value.execution_source;
  if (typeof value.knowledge_version === "string" && HEX.test(value.knowledge_version) && value.knowledge_version === index.knowledgeVersion) {
    job.knowledge_version = index.knowledgeVersion;
  }
  if (value.error_code !== null && value.error_code !== undefined) {
    job.error_code = value.error_code === "input_context_too_large" ? "input_context_too_large"
      : value.error_code === "invalid_chart_input" ? "invalid_chart_input" : "analysis_unavailable";
    job.error_message = job.error_code === "input_context_too_large"
      ? "分析输入超过当前模型的上下文预算，请精简已有步骤的备注后重试。"
      : job.error_code === "invalid_chart_input" ? "K 线或标的／周期绑定未通过校验，请核对当前分析并重新导入 1–128 根有效 K 线，时间使用 Unix 秒。"
        : "AI 候选分析未完成，请稍后重试或检查模型连接。";
  } else { job.error_code = null; job.error_message = null; }
  if (value.output_payload === null || value.output_payload === undefined) job.output_payload = null;
  else {
    try { job.output_payload = publicAnalysisOutput(value.output_payload, index); }
    catch { job.output_payload = null; }
  }
  return job;
}

/** Final write-side guard; alternate runtimes must not bypass publication. */
export function assertPublishedAnalysisOutput(value: unknown): asserts value is RecordValue {
  const fail: () => never = () => { throw Object.assign(new Error("invalid_public_analysis"), { code: "invalid_model_output" }); };
  const allowed = new Set(["schema_version", "source_visibility", "knowledge_version", "scope", "status", "reason",
    ...RESULT_STRINGS, "valid_scenarios", "eliminated_scenarios", "unknown_fields", "risk",
    "knowledge_citations", "citations", "analysis_basis", "wave_chart"]);
  if (!record(value) || value.schema_version !== PUBLIC_ANALYSIS_SCHEMA
    || !["public_books", "private_research"].includes(String(value.source_visibility))
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))) {
    fail();
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 128 * 1024) fail();
  if (value.knowledge_version !== undefined && (typeof value.knowledge_version !== "string" || !HEX.test(value.knowledge_version))) fail();
  if (value.scope !== undefined && (!record(value.scope)
    || (value.scope.mode === "all" ? Object.keys(value.scope).length !== 1
      : value.scope.mode !== "single" || Object.keys(value.scope).length !== 2
        || !PUBLISHED_BOOK_IDS.includes(value.scope.book_id as typeof PUBLISHED_BOOK_IDS[number])))) fail();
  if (!Array.isArray(value.citations) || value.citations.length > 100
    || !Array.isArray(value.knowledge_citations) || value.knowledge_citations.length > 100
    || new Set(value.knowledge_citations).size !== value.knowledge_citations.length
    || !Array.isArray(value.analysis_basis) || value.analysis_basis.length > 12) fail();
  if (value.source_visibility === "private_research" && (value.citations.length !== 0 || value.knowledge_citations.length !== 0)) fail();
  if (value.status === "insufficient_evidence") {
    const emptyKeys = new Set(["schema_version", "source_visibility", "knowledge_version", "scope", "status", "reason", "knowledge_citations", "citations", "analysis_basis"]);
    if (value.reason !== "no_relevant_knowledge" || Object.keys(value).some((key) => !emptyKeys.has(key))
      || value.citations.length || value.knowledge_citations.length || value.analysis_basis.length) fail();
    return;
  }
  if (value.status !== undefined || value.reason !== undefined) fail();
  for (const field of RESULT_STRINGS) if (safeText(value[field], 2000, []) === null) fail();
  if (!textList(value.unknown_fields, 100, 2000, [])) fail();
  if (value.risk !== undefined && (!record(value.risk) || Object.entries(value.risk).some(([key, number]) => !/^[a-z][a-z0-9_]{0,60}$/u.test(key)
    || safeText(key, 61, []) === null || typeof number !== "number" || !Number.isFinite(number)))) fail();
  // Validate nested objects again: alternate runtimes must not append
  // provenance or diagnostics after the normal projection.
  const expectedScenarioKeys = new Set(["key", "pattern", "conditions", "invalidations", "confidence", "violations"]);
  for (const field of ["valid_scenarios", "eliminated_scenarios"]) {
    if (!Array.isArray(value[field]) || value[field].some((item) => !record(item)
      || Object.keys(item).some((key) => !expectedScenarioKeys.has(key)))
      || !scenarios(value[field], [])) fail();
  }
  if (value.wave_chart !== undefined) {
    assertWaveChart(value.wave_chart);
    if (safeText(value.wave_chart.instrument, 64, []) === null || safeText(value.wave_chart.timeframe, 32, []) === null) fail();
    const keys = new Set((value.valid_scenarios as RecordValue[]).map((scenario) => scenario.key));
    const blocked = new Set((value.eliminated_scenarios as RecordValue[]).map((scenario) => scenario.key));
    if (value.wave_chart.scenarios.some((scenario) => !keys.has(scenario.key) || blocked.has(scenario.key))) fail();
  }
  for (const field of ["valid_scenarios", "eliminated_scenarios"]) {
    for (const scenario of (value[field] as RecordValue[] | undefined) ?? []) {
      if (scenario.violations === undefined) continue;
      if (!Array.isArray(scenario.violations) || scenario.violations.length > 100 || scenario.violations.some((item) => !record(item)
        || Object.keys(item).length !== 2 || Object.keys(item).some((key) => !["rule_id", "message"].includes(key))
        || typeof item.rule_id !== "string" || !PUBLIC_RULE_IDS.has(item.rule_id) || safeText(item.message, 2000, []) === null)) fail();
    }
  }
  for (const basis of value.analysis_basis) {
    if (!record(basis) || Object.keys(basis).length !== 4
      || Object.keys(basis).some((key) => !["kind", "summary", "conditions", "invalidations"].includes(key))
      || !["structure", "hypothesis"].includes(String(basis.kind)) || !safeText(basis.summary, 500, [])
      || !textList(basis.conditions, 6, 280, []) || !textList(basis.invalidations, 6, 280, [])) fail();
  }
  for (const id of value.knowledge_citations) if (!safeText(id, 240, [])) fail();
  const citationKeys = new Set(["knowledge_id", "book_id", "book_title", "title", "source_id", "pages", "href", "snippet"]);
  for (const citation of value.citations) {
    if (!record(citation) || Object.keys(citation).length !== citationKeys.size || Object.keys(citation).some((key) => !citationKeys.has(key))
      || !PUBLISHED_BOOK_IDS.includes(citation.book_id as typeof PUBLISHED_BOOK_IDS[number])
      || !["knowledge_id", "book_title", "title", "source_id", "snippet"].every((key) => safeText(citation[key], 2000, []) !== null)
      || !value.knowledge_citations.includes(citation.knowledge_id)
      || !Array.isArray(citation.pages) || citation.pages.length > 321 || citation.pages.some((page) => !Number.isInteger(page) || page < 1 || page > 321)
      || typeof citation.href !== "string"
      || !(citation.book_id === "elliott-wave-principle-tenth-edition"
        ? /^\/knowledge\/unit-[a-z0-9-]+$/u.test(citation.href)
        : new RegExp(`^/knowledge/books/${citation.book_id}#page-([1-9][0-9]*)$`, "u").test(citation.href))) fail();
  }
}
