import { createHash } from "node:crypto";
import {
  normalizeTradeReviewAiRequest,
  type NormalizedTradeReviewAiRequest,
  type TradeReviewKnowledgeScope,
} from "../knowledge/contracts.ts";
import {
  buildKnowledgeIndex,
  PUBLISHED_BOOK_IDS,
  type KnowledgeChunk,
  type KnowledgeIndex,
  type PublishedBookId,
} from "../knowledge/index.ts";
import { retrieveKnowledge } from "../knowledge/retrieve.ts";
import type { ProviderResult } from "../providers/types.ts";
import type { ResolvedUserConnection } from "../secrets/user-connection.ts";

const SCHEMA_VERSION = "wavekb-trade-review-v1" as const;
const MODEL_KEYS = new Set([
  "fact_summary",
  "discipline_observations",
  "wave_structure_hypothesis",
  "knowledge_citations",
  "next_checklist",
]);
const PUBLIC_KEYS = new Set([
  "schema_version",
  "knowledge_version",
  "scope",
  ...MODEL_KEYS,
  "citations",
]);
const FORBIDDEN_ADVICE = /买入|卖出|做多|做空|开仓|加仓|减仓|(?:保证|承诺).{0,8}(?:收益|盈利)|稳赚|必赚|无风险收益/iu;
const UNKNOWN_EVIDENCE = /未知|证据不足|无法确定|不能确定|不足以/iu;

type RecordValue = Record<string, unknown>;

export type TradeReviewContext = {
  trade: RecordValue;
  review: RecordValue | null;
};

export type TradeReviewCitation = {
  knowledge_id: string;
  book_id: PublishedBookId;
  book_title: string;
  title: string;
  source_id: string;
  pages: number[];
  href: string;
  snippet: string;
};

export type TradeReviewOutput = {
  schema_version: typeof SCHEMA_VERSION;
  knowledge_version: string;
  scope: TradeReviewKnowledgeScope;
  fact_summary: string[];
  discipline_observations: Array<{ observation: string; basis: "user_statement" | "model_inference" }>;
  wave_structure_hypothesis: { status: "unknown"; summary: string; evidence_limit: string };
  knowledge_citations: string[];
  citations: TradeReviewCitation[];
  next_checklist: string[];
};

export type TradeReviewAiJob = {
  id: string;
  owner_id: string;
  analysis_id: null;
  trade_cycle_id: string;
  trade_cycle_revision: number;
  task_type: "trade_review";
  input_payload: Record<string, unknown>;
  trade_context: TradeReviewContext;
  knowledge_version?: string | null;
};

export type TradeReviewRuntimeResult = {
  output: TradeReviewOutput;
  normalizedRequest: NormalizedTradeReviewAiRequest;
  knowledgeVersion: string;
  provider: { usage: ProviderResult["usage"]; providerRequestId?: string } | null;
};

type Database = { request(path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<any> };

function record(value: unknown): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: RecordValue, keys: Set<string>): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.size && own.every((key) => typeof key === "string" && keys.has(key));
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    && !FORBIDDEN_ADVICE.test(value);
}

function textList(value: unknown, maximumItems: number, maximumLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems
    && value.every((item) => safeText(item, maximumLength));
}

function invalidOutput(): never {
  throw Object.assign(new Error("invalid_trade_review_output"), { code: "invalid_model_output" });
}

function validateModelOutput(value: unknown, allowedCitations: Set<string>): Omit<TradeReviewOutput, "schema_version" | "knowledge_version" | "scope" | "citations"> {
  if (!record(value) || !exactKeys(value, MODEL_KEYS)) invalidOutput();
  if (!textList(value.fact_summary, 12, 500) || !value.fact_summary.length
    || !textList(value.next_checklist, 12, 500) || !value.next_checklist.length) invalidOutput();
  if (!Array.isArray(value.discipline_observations) || value.discipline_observations.length > 12
    || value.discipline_observations.some((item) => !record(item)
      || !exactKeys(item, new Set(["observation", "basis"]))
      || !safeText(item.observation, 500)
      || !["user_statement", "model_inference"].includes(String(item.basis)))) invalidOutput();
  const hypothesis = value.wave_structure_hypothesis;
  if (!record(hypothesis) || !exactKeys(hypothesis, new Set(["status", "summary", "evidence_limit"]))
    || hypothesis.status !== "unknown" || !safeText(hypothesis.summary, 800)
    || !safeText(hypothesis.evidence_limit, 800)
    || !UNKNOWN_EVIDENCE.test(`${hypothesis.summary} ${hypothesis.evidence_limit}`)) invalidOutput();
  if (!Array.isArray(value.knowledge_citations) || value.knowledge_citations.length > 20
    || new Set(value.knowledge_citations).size !== value.knowledge_citations.length
    || value.knowledge_citations.some((id) => typeof id !== "string" || !allowedCitations.has(id))) invalidOutput();
  return value as Omit<TradeReviewOutput, "schema_version" | "knowledge_version" | "scope" | "citations">;
}

export function assertPublishedTradeReviewOutput(value: unknown): asserts value is TradeReviewOutput {
  if (!record(value) || !exactKeys(value, PUBLIC_KEYS) || value.schema_version !== SCHEMA_VERSION
    || typeof value.knowledge_version !== "string" || !/^[0-9a-f]{64}$/u.test(value.knowledge_version)
    || Buffer.byteLength(JSON.stringify(value), "utf8") > 96 * 1024) invalidOutput();
  const scope = value.scope;
  if (scope !== "all" && (!record(scope) || !exactKeys(scope, new Set(["book_ids"]))
    || !Array.isArray(scope.book_ids) || !scope.book_ids.length
    || new Set(scope.book_ids).size !== scope.book_ids.length
    || scope.book_ids.some((id) => typeof id !== "string" || !PUBLISHED_BOOK_IDS.includes(id as PublishedBookId)))) invalidOutput();
  if (!Array.isArray(value.citations) || value.citations.length > 20) invalidOutput();
  const citationIds = new Set<string>();
  for (const citation of value.citations) {
    if (!record(citation) || !exactKeys(citation, new Set(["knowledge_id", "book_id", "book_title", "title", "source_id", "pages", "href", "snippet"]))
      || !safeText(citation.knowledge_id, 240) || !safeText(citation.book_id, 120)
      || !PUBLISHED_BOOK_IDS.includes(citation.book_id as PublishedBookId)
      || !safeText(citation.book_title, 300) || !safeText(citation.title, 500)
      || !safeText(citation.source_id, 240) || !safeText(citation.snippet, 1000)
      || typeof citation.href !== "string" || !citation.href.startsWith("/knowledge/") || citation.href.includes("..")
      || !Array.isArray(citation.pages) || citation.pages.some((page) => !Number.isInteger(page) || Number(page) < 1)) invalidOutput();
    citationIds.add(citation.knowledge_id);
  }
  validateModelOutput({
    fact_summary: value.fact_summary,
    discipline_observations: value.discipline_observations,
    wave_structure_hypothesis: value.wave_structure_hypothesis,
    knowledge_citations: value.knowledge_citations,
    next_checklist: value.next_checklist,
  }, citationIds);
  if (citationIds.size !== value.citations.length || citationIds.size !== (value.knowledge_citations as string[]).length) invalidOutput();
}

function citation(chunk: KnowledgeChunk, index: KnowledgeIndex): TradeReviewCitation {
  const book = index.books.find((item) => item.bookId === chunk.bookId)!;
  return {
    knowledge_id: chunk.chunkId,
    book_id: chunk.bookId,
    book_title: book.title,
    title: chunk.title,
    source_id: chunk.sourceId,
    pages: chunk.pdfPages,
    href: chunk.href,
    snippet: chunk.text.slice(0, 280),
  };
}

function parseProviderResult(result: ProviderResult): unknown {
  if (result.structured !== undefined) return result.structured;
  if (!result.text || result.finishReason !== "stop") invalidOutput();
  try { return JSON.parse(result.text); } catch { invalidOutput(); }
}

function contextQuery(context: TradeReviewContext): string {
  const values = [context.trade.symbol, context.trade.direction, context.trade.product,
    context.review?.reason, context.review?.next_improvement, ...(Array.isArray(context.review?.tags) ? context.review.tags : [])];
  return values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(" ").slice(0, 4000);
}

const TRADE_CONTEXT_FIELDS = [
  "provider", "product", "symbol", "direction", "opened_at", "closed_at",
  "entry_price", "exit_price", "quantity", "realized_pnl", "fees",
  "funding_or_swap", "dividends", "net_pnl", "account_currency", "usd_net_pnl",
  "valuation_status", "completeness",
] as const;
const REVIEW_CONTEXT_FIELDS = [
  "reason", "plan_compliance", "next_improvement", "planned_stop_price", "planned_risk_amount",
] as const;

function promptContext(value: TradeReviewContext): TradeReviewContext {
  if (!record(value) || !record(value.trade)) invalidOutput();
  const trade: RecordValue = {};
  for (const key of TRADE_CONTEXT_FIELDS) {
    const field = value.trade[key];
    if (field === null || typeof field === "string" || typeof field === "number") trade[key] = field;
  }
  let review: RecordValue | null = null;
  if (value.review !== null && value.review !== undefined) {
    if (!record(value.review)) invalidOutput();
    review = {};
    for (const key of REVIEW_CONTEXT_FIELDS) {
      const field = value.review[key];
      if (field === null || typeof field === "string" || typeof field === "number") review[key] = field;
    }
    if (Array.isArray(value.review.tags)) {
      review.tags = value.review.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 32);
    }
  }
  return { trade, review };
}

function selectedKnowledge(index: KnowledgeIndex, scope: TradeReviewKnowledgeScope, query: string): KnowledgeChunk[] {
  if (scope === "all") return retrieveKnowledge(index, { scope: { mode: "all" }, query, characterBudget: 12_000 }).items;
  const merged: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  for (const bookId of scope.book_ids) {
    const items = retrieveKnowledge(index, { scope: { mode: "single", book_id: bookId }, query, characterBudget: 6_000 }).items;
    for (const item of items) if (!seen.has(item.chunkId) && merged.length < 12) { seen.add(item.chunkId); merged.push(item); }
  }
  return merged;
}

const SYSTEM = [
  "你是 WaveKB 的证据约束交易复盘助手，只分析已经发生的交易与用户自述。",
  "不得给出买入、卖出、做多、做空、加仓或收益承诺；不得把成交事实伪装成波浪结构证据。",
  "波浪/结构假设必须保持 unknown，并明确说明证据不足。引用只能使用输入中提供的 knowledge_id。",
  "输出一个 JSON 对象，且只能包含 fact_summary、discipline_observations、wave_structure_hypothesis、knowledge_citations、next_checklist。",
].join("\n");

export class TradeReviewAiRuntime {
  private readonly database: Database;
  private readonly index: KnowledgeIndex | null;
  constructor(dependencies: { database: Database; loadIndex?: () => KnowledgeIndex }) {
    this.database = dependencies.database;
    try { this.index = (dependencies.loadIndex ?? buildKnowledgeIndex)(); } catch { this.index = null; }
  }

  async run(input: { job: TradeReviewAiJob; connection: ResolvedUserConnection }): Promise<TradeReviewRuntimeResult> {
    if (!this.index || (input.job.knowledge_version && input.job.knowledge_version !== this.index.knowledgeVersion)) {
      throw Object.assign(new Error("knowledge_unavailable"), { code: "knowledge_unavailable" });
    }
    if (input.job.owner_id !== input.connection.ownerId || input.job.analysis_id !== null
      || input.job.task_type !== "trade_review") invalidOutput();
    const normalizedRequest = normalizeTradeReviewAiRequest(input.job.input_payload, this.index.books);
    if (normalizedRequest.cycle_revision !== input.job.trade_cycle_revision) invalidOutput();
    const safeContext = promptContext(input.job.trade_context);
    const query = contextQuery(safeContext);
    const items = selectedKnowledge(this.index, normalizedRequest.knowledge_scope, query);
    await this.database.request("/rest/v1/knowledge_retrievals", {
      method: "POST", headers: { prefer: "return=representation" }, body: {
        job_id: input.job.id,
        query,
        task_type: "trade_review",
        knowledge_ids: items.map((item) => item.chunkId),
        source_ids: [...new Set(items.map((item) => item.sourceId))],
        token_budget: input.connection.contextTokens,
        context_hash: createHash("sha256").update(JSON.stringify(items.map((item) => [item.chunkId, item.contentSha256]))).digest("hex"),
      },
    });
    const base = {
      schema_version: SCHEMA_VERSION,
      knowledge_version: this.index.knowledgeVersion,
      scope: normalizedRequest.knowledge_scope,
    } as const;
    if (!items.length) {
      const output: TradeReviewOutput = { ...base,
        fact_summary: ["已读取交易事实，但没有检索到与本次记录直接相关的知识条目。"],
        discipline_observations: [],
        wave_structure_hypothesis: { status: "unknown", summary: "现有证据不足，波浪与结构未知。", evidence_limit: "缺少可验证的连续价格或图表结构证据。" },
        knowledge_citations: [], citations: [], next_checklist: ["补充入场依据、失效条件和执行偏差后再复盘。"] };
      assertPublishedTradeReviewOutput(output);
      return { output, normalizedRequest, knowledgeVersion: this.index.knowledgeVersion, provider: null };
    }
    const knowledge = items.map((item) => ({ knowledge_id: item.chunkId, book_id: item.bookId, title: item.title, pages: item.pdfPages, text: item.text }));
    const prompt = `${SYSTEM}\n\n<UNTRUSTED_KNOWLEDGE>\n${JSON.stringify(knowledge)}\n</UNTRUSTED_KNOWLEDGE>\n\n<TRADE_FACTS_AND_USER_REVIEW>\n${JSON.stringify(safeContext)}\n</TRADE_FACTS_AND_USER_REVIEW>`;
    const providerRequest = { model: input.connection.modelName, system: SYSTEM,
      messages: [{ role: "user" as const, content: prompt }], maxOutputTokens: input.connection.maxOutputTokens,
      temperature: input.connection.temperature, timeoutMs: input.connection.timeoutMs, responseFormat: "json_object" as const };
    let result = await input.connection.provider.invoke(providerRequest);
    let usage = { ...result.usage };
    let modelOutput: ReturnType<typeof validateModelOutput>;
    try { modelOutput = validateModelOutput(parseProviderResult(result), new Set(items.map((item) => item.chunkId))); }
    catch {
      result = await input.connection.provider.invoke({ ...providerRequest, temperature: 0, messages: [...providerRequest.messages,
        { role: "user" as const, content: "上次输出未通过格式、引用或安全校验。仅按原证据返回合规 JSON，不得添加事实或交易指令。" }] });
      usage = { inputTokens: usage.inputTokens + result.usage.inputTokens, outputTokens: usage.outputTokens + result.usage.outputTokens };
      modelOutput = validateModelOutput(parseProviderResult(result), new Set(items.map((item) => item.chunkId)));
    }
    const byId = new Map(items.map((item) => [item.chunkId, item]));
    const output: TradeReviewOutput = { ...base, ...modelOutput,
      citations: modelOutput.knowledge_citations.map((id) => citation(byId.get(id)!, this.index!)) };
    assertPublishedTradeReviewOutput(output);
    return { output, normalizedRequest, knowledgeVersion: this.index.knowledgeVersion,
      provider: { usage, ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}) } };
  }
}

export function publicTradeReviewJob(value: RecordValue, _index: KnowledgeIndex, options: { stale: boolean }): RecordValue {
  const output = value.output_payload;
  let publicOutput: TradeReviewOutput | null = null;
  if (output !== null && output !== undefined) {
    try { assertPublishedTradeReviewOutput(output); publicOutput = output; } catch { publicOutput = null; }
  }
  const failed = value.status === "failed";
  return {
    id: String(value.id || ""),
    trade_cycle_id: String(value.trade_cycle_id || ""),
    trade_cycle_revision: Number(value.trade_cycle_revision || 0),
    status: String(value.status || "failed"),
    execution_source: value.execution_source === "managed" ? "managed" : "byok",
    knowledge_version: typeof value.knowledge_version === "string" ? value.knowledge_version : null,
    output_payload: publicOutput,
    error_code: failed ? "trade_review_unavailable" : null,
    error_message: failed ? "AI 复盘建议暂时无法生成，请稍后重试或检查模型连接。" : null,
    created_at: typeof value.created_at === "string" ? value.created_at : null,
    finished_at: typeof value.finished_at === "string" ? value.finished_at : null,
    stale: options.stale,
  };
}
