import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { normalizeTradeReviewAiRequest } from "../src/knowledge/contracts.ts";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import { SupabaseGatewayApi } from "../src/routes/gateway-api.ts";
import { buildServer } from "../src/server.ts";
import {
  assertPublishedTradeReviewOutput,
  publicTradeReviewJob,
  TradeReviewAiRuntime,
} from "../src/trading/ai-review.ts";
import { AiJobWorker } from "../src/worker-main.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const cycleId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const index = buildKnowledgeIndex();
const request = {
  request_version: 1,
  client_request_id: requestId,
  task_type: "trade_review",
  cycle_revision: 3,
  knowledge_scope: "all",
};
const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com",
});

test("trade-review request accepts all or an explicit published book set and rejects ambiguous input", () => {
  assert.deepEqual(normalizeTradeReviewAiRequest(request, index.books), request);
  const selected = {
    ...request,
    knowledge_scope: { book_ids: [index.books[2]!.bookId, index.books[0]!.bookId] },
  };
  assert.deepEqual(normalizeTradeReviewAiRequest(selected, index.books), selected);
  for (const invalid of [
    { ...request, knowledge_scope: { book_ids: [] } },
    { ...request, knowledge_scope: { book_ids: ["unpublished"] } },
    { ...request, knowledge_scope: { book_ids: [index.books[0]!.bookId, index.books[0]!.bookId] } },
    { ...request, analysis_id: cycleId },
    { ...request, cycle_revision: 0 },
  ]) assert.throws(() => normalizeTradeReviewAiRequest(invalid, index.books));
});

test("gateway enqueues one owner-scoped immutable trade revision with a sanitized context and stable idempotency", async () => {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const rawJob = {
    id: "job-1", owner_id: owner, analysis_id: null, trade_cycle_id: cycleId,
    trade_cycle_revision: 3, task_type: "trade_review", status: "queued",
    execution_source: "byok", input_payload: request, accepted_request: request,
    knowledge_version: index.knowledgeVersion, output_payload: null,
    created_at: "2026-11-24T00:00:00Z", finished_at: null,
  };
  let stored = false;
  const database = {
    async userForJwt() { return null; },
    async request(path: string, options?: { method?: string; body?: unknown }) {
      calls.push({ path, ...(options?.body ? { body: options.body as Record<string, unknown> } : {}) });
      if (path.startsWith("/rest/v1/trading_trade_cycles?")) {
        assert.ok(path.includes(`owner_id=eq.${owner}`));
        return [{ id: cycleId, owner_id: owner, connection_id: "account-1", provider: "binance", revision: 3,
          product: "usdt_perpetual", symbol: "BTCUSDT", direction: "long", opened_at: "2026-11-23T00:00:00Z",
          closed_at: "2026-11-23T02:00:00Z", entry_price: "100", exit_price: "110", quantity: "1",
          realized_pnl: "10", fees: "-1", funding_or_swap: "0", dividends: "0", net_pnl: "9",
          account_currency: "USDT", usd_net_pnl: "9", valuation_status: "direct", completeness: "complete", is_current: true }];
      }
      if (path.startsWith("/rest/v1/trading_trade_reviews?")) return [{ reason: "突破后追价", plan_compliance: "no", next_improvement: "等待确认", tags: ["纪律"], planned_stop_price: "95", planned_risk_amount: "5" }];
      if (path.startsWith("/rest/v1/user_ai_connections?")) return [{ id: connectionId, label: "my model", adapter: "openai_compatible", base_url: "https://model.example/v1", model_name: "model", max_output_tokens: 1024, context_tokens: 16000, temperature: 0.2, timeout_ms: 30000 }];
      if (path.startsWith("/rest/v1/ai_jobs?idempotency_key=")) return stored ? [rawJob] : [];
      if (path === "/rest/v1/ai_jobs" && options?.method === "POST") { stored = true; return [rawJob]; }
      throw new Error(`unexpected ${path}`);
    },
  };
  const gateway = new SupabaseGatewayApi(config, { database });
  const result = await gateway.enqueueTradeReviewJob(owner, cycleId, request) as Record<string, unknown>;
  const replay = await gateway.enqueueTradeReviewJob(owner, cycleId, request) as Record<string, unknown>;
  assert.equal(result.trade_cycle_id, cycleId);
  assert.equal(replay.id, result.id);
  assert.equal(calls.filter((call) => call.path === "/rest/v1/ai_jobs").length, 1);
  assert.equal(result.trade_cycle_revision, 3);
  const inserted = calls.find((call) => call.path === "/rest/v1/ai_jobs")!.body!;
  assert.equal(inserted.analysis_id, null);
  assert.equal(inserted.idempotency_key, `${owner}:trade:${cycleId}:3:${requestId}`);
  assert.equal(inserted.trade_cycle_id, cycleId);
  assert.equal(inserted.trade_cycle_revision, 3);
  const serialized = JSON.stringify(inserted.trade_context);
  for (const forbidden of ["raw_payload", "api_key", "secret", "leaderboard", "ranking", "connection_snapshot"]) {
    assert.ok(!serialized.includes(forbidden));
  }
});

test("polling is owner-scoped and marks an older trade-review result stale", async () => {
  const output = validOutput([]);
  const raw = { id: "job-1", owner_id: owner, analysis_id: null, trade_cycle_id: cycleId, trade_cycle_revision: 2,
    task_type: "trade_review", status: "succeeded", execution_source: "byok", output_payload: output,
    error_code: null, error_message: null, knowledge_version: index.knowledgeVersion,
    created_at: "2026-11-24T00:00:00Z", finished_at: "2026-11-24T00:01:00Z" };
  const gateway = new SupabaseGatewayApi(config, { database: {
    userForJwt: async () => null,
    async request(path: string) {
      if (path.startsWith("/rest/v1/ai_jobs?")) { assert.ok(path.includes(`owner_id=eq.${owner}`)); return [raw]; }
      if (path.startsWith("/rest/v1/trading_trade_cycles?")) { assert.ok(path.includes(`owner_id=eq.${owner}`)); return [{ revision: 3 }]; }
      throw new Error(`unexpected ${path}`);
    },
  } });
  const job = await gateway.getJob(owner, "job-1") as Record<string, unknown>;
  assert.equal(job.stale, true);
  assert.equal(job.trade_cycle_id, cycleId);
  assert.ok(!JSON.stringify(job).includes("owner_id"));
});

test("authenticated server route accepts trade-review AI without exposing the workbench analysis route", async () => {
  let accepted: unknown[] = [];
  const server = buildServer({ config, api: {
    authorize: async (token: string) => token === "valid" ? { id: owner, role: "user" } : null,
    enqueueTradeReviewJob: async (...args: unknown[]) => { accepted = args; return { id: "job-1", status: "queued" }; },
  } as never });
  const response = await server.inject({ method: "POST", url: `/v1/user/trading-trades/${cycleId}/ai-review`, headers: { authorization: "Bearer valid" }, payload: request });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(accepted, [owner, cycleId, request]);
  assert.equal((response.json() as { job: { id: string } }).job.id, "job-1");
});

function validOutput(ids: string[]) {
  return {
    schema_version: "wavekb-trade-review-v1",
    knowledge_version: index.knowledgeVersion,
    scope: "all",
    fact_summary: ["该交易已平仓，净盈亏 9 USDT。"],
    discipline_observations: [{ observation: "用户记录了追价行为。", basis: "user_statement" }],
    wave_structure_hypothesis: { status: "unknown", summary: "现有成交事实无法确定波浪结构。", evidence_limit: "缺少价格序列与图表证据。" },
    knowledge_citations: ids,
    citations: [],
    next_checklist: ["复核入场前是否已有失效条件。"],
  };
}

test("runtime retrieves only selected books, cites supplied units and never sends private provider fields", async () => {
  const selectedBook = index.books[0]!.bookId;
  const selectedChunk = index.chunks.find((chunk) => chunk.bookId === selectedBook)!;
  let prompt = "";
  const runtime = new TradeReviewAiRuntime({
    database: { request: async (path: string, options?: { body?: unknown }) => {
      assert.equal(path, "/rest/v1/knowledge_retrievals");
      assert.equal((options?.body as Record<string, unknown>).task_type, "trade_review");
      return [{}];
    } },
    loadIndex: () => index,
  });
  const result = await runtime.run({
    job: { id: "job", owner_id: owner, analysis_id: null, trade_cycle_id: cycleId, trade_cycle_revision: 3,
      task_type: "trade_review", knowledge_version: index.knowledgeVersion,
      input_payload: { ...request, knowledge_scope: { book_ids: [selectedBook] } },
      trade_context: { trade: { symbol: selectedChunk.title, provider: "binance", direction: "long", net_pnl: "9", raw_payload: { api_key: "test-secret" }, leaderboard: 1 }, review: { reason: selectedChunk.title, plan_compliance: "no", next_improvement: "等待确认", ranking: 1 } } },
    connection: { id: connectionId, ownerId: owner, modelName: "model", timeoutMs: 30000, maxOutputTokens: 1024, contextTokens: 32000, temperature: 0.2,
      provider: { async invoke(input) { prompt = JSON.stringify(input); return { structured: {
        fact_summary: ["交易净盈亏为 9。"],
        discipline_observations: [{ observation: "用户自述未遵守计划。", basis: "user_statement" }],
        wave_structure_hypothesis: { status: "unknown", summary: "证据不足，波浪结构未知。", evidence_limit: "仅有成交事实。" },
        knowledge_citations: [selectedChunk.chunkId],
        next_checklist: ["复核计划与执行偏差。"],
      }, text: "", usage: { inputTokens: 20, outputTokens: 10 }, finishReason: "stop" }; } } },
  });
  assert.equal(result.output.citations.length, 1);
  assert.equal(result.output.citations[0]!.book_id, selectedBook);
  assert.ok(prompt.includes(selectedChunk.chunkId));
  for (const forbidden of ["api_key", "raw_payload", "leaderboard", "ranking"]) assert.ok(!prompt.includes(forbidden));
  assert.doesNotThrow(() => assertPublishedTradeReviewOutput(result.output));
});

test("all-books runtime searches every published book without forcing citations", async () => {
  let prompt = "";
  const query = index.books.map((book) => index.chunks.find((chunk) => chunk.bookId === book.bookId)!.title).join(" ");
  const runtime = new TradeReviewAiRuntime({ database: { request: async () => [{}] }, loadIndex: () => index });
  const result = await runtime.run({
    job: { id: "all-job", owner_id: owner, analysis_id: null, trade_cycle_id: cycleId, trade_cycle_revision: 3,
      task_type: "trade_review", knowledge_version: index.knowledgeVersion, input_payload: request,
      trade_context: { trade: { symbol: "BTCUSDT", direction: "long" }, review: { reason: query, plan_compliance: "yes", next_improvement: "复核" } } },
    connection: { id: connectionId, ownerId: owner, modelName: "model", timeoutMs: 30000, maxOutputTokens: 1024, contextTokens: 64000, temperature: 0.2,
      provider: { async invoke(input) { prompt = JSON.stringify(input); return { structured: {
        fact_summary: ["已读取交易事实。"], discipline_observations: [],
        wave_structure_hypothesis: { status: "unknown", summary: "证据不足，结构未知。", evidence_limit: "没有连续价格证据。" },
        knowledge_citations: [], next_checklist: ["复核记录。"],
      }, text: "", usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" }; } } },
  });
  for (const book of index.books) assert.ok(prompt.includes(book.bookId), book.bookId);
  assert.deepEqual(result.output.citations, []);
});

test("worker dispatches trade_review to the separate runtime and never loads workbench_analyses", async () => {
  const paths: string[] = [];
  const finalOutput = validOutput([]);
  assertPublishedTradeReviewOutput(finalOutput);
  const normalizedRequest = normalizeTradeReviewAiRequest(request, index.books);
  const connection = { id: connectionId, ownerId: owner, modelName: "model", timeoutMs: 30000, maxOutputTokens: 1024, contextTokens: 32000, temperature: 0.2,
    provider: { async invoke() { throw new Error("provider should be owned by injected runtime"); } } };
  const database = { async request(path: string, options?: { method?: string; body?: unknown }) {
    paths.push(path);
    if (path.startsWith("/rest/v1/ai_job_attempts?")) return [];
    if (path === "/rest/v1/ai_job_attempts" && options?.method === "POST") return [{ id: "attempt-1" }];
    if (path.startsWith("/rest/v1/profiles?")) return [{ id: owner }];
    if (path.startsWith("/rest/v1/ai_job_attempts?id=")) return [];
    if (path === "/rest/v1/ai_usage_ledger") return [];
    if (path.startsWith("/rest/v1/ai_jobs?id=")) return [];
    throw new Error(`unexpected ${path}`);
  } };
  const worker = new AiJobWorker(config, "test-worker", {
    database,
    connections: { resolve: async () => connection },
    tradeReviewRuntime: { run: async () => ({ output: finalOutput, normalizedRequest, knowledgeVersion: index.knowledgeVersion, provider: null }) },
  });
  await worker.runJob({ id: "job-1", owner_id: owner, analysis_id: null, trade_cycle_id: cycleId,
    trade_cycle_revision: 3, trade_context: { trade: { symbol: "BTCUSDT" }, review: null },
    user_connection_id: connectionId, execution_source: "byok", task_type: "trade_review",
    input_payload: request, knowledge_version: index.knowledgeVersion });
  assert.ok(paths.every((path) => !path.startsWith("/rest/v1/workbench_analyses?")));
  assert.ok(paths.some((path) => path.startsWith("/rest/v1/ai_jobs?id=eq.job-1")));
});

test("publication rejects invented citations, directional instructions, promises and false wave certainty", () => {
  const invalid = [
    { ...validOutput([]), knowledge_citations: ["invented"] },
    { ...validOutput([]), next_checklist: ["现在立即买入 BTC。"] },
    { ...validOutput([]), discipline_observations: [{ observation: "这个方法保证收益。", basis: "model_inference" }] },
    { ...validOutput([]), wave_structure_hypothesis: { status: "confirmed", summary: "第三浪确定", evidence_limit: "无" } },
  ];
  for (const output of invalid) assert.throws(() => assertPublishedTradeReviewOutput(output));
  const projected = publicTradeReviewJob({ id: "j", trade_cycle_id: cycleId, trade_cycle_revision: 3, status: "succeeded", execution_source: "byok", output_payload: validOutput([]), knowledge_version: index.knowledgeVersion, created_at: "now", error_code: null, error_message: null }, index, { stale: false });
  assert.equal(projected.stale, false);
});
