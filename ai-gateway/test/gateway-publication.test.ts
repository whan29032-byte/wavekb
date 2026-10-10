import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import { SupabaseGatewayApi } from "../src/routes/gateway-api.ts";
import type { ManagedModel } from "../src/secrets/managed-connection.ts";

const index = buildKnowledgeIndex();
const owner = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";
const modelId = "33333333-3333-4333-8333-333333333333";
const request = {
  request_version: 2, client_request_id: "44444444-4444-4444-8444-444444444444",
  task_type: "wave_analysis", step: 5, analysis_schema_version: "workbench-v1",
  knowledge_scope: { mode: "all" },
};
const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-test-only-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-only-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), AUTH_SITE_URL: "https://knowledge.example.com",
  MEMBERSHIP_MANAGED_AI_ENABLED: "true",
});
const model: ManagedModel = {
  id: modelId, provider_id: "provider", name: "operator-model", timeout_ms: 60_000,
  max_output_tokens: 4096, context_tokens: 32768, temperature: 0.2,
  provider: { id: "provider", adapter: "openai_compatible", base_url: "https://model.example/v1" },
};
const connection = {
  id: "connection", label: "owned model", adapter: "openai_compatible", base_url: "https://model.example/v1",
  model_name: "model-a", timeout_ms: 60_000, max_output_tokens: 4096, context_tokens: 32768, temperature: 0.2,
};
const privatePath = "/Users/example/.hermes/knowledge/private-example.md";
function rawJob(executionSource: "byok" | "managed") {
  return {
    id: "job", owner_id: owner, analysis_id: analysisId, status: "succeeded", execution_source: executionSource,
    created_at: "2026-10-11T00:00:00Z", knowledge_version: index.knowledgeVersion,
    input_payload: { ...request, private_source: privatePath }, accepted_request: request,
    connection_snapshot: { base_url: connection.base_url, provider: "internal-provider", api_key: "test-only-secret" },
    worker_id: "private-worker", actual_model_id: modelId, managed_model_id: modelId,
    prompt_version_ids: ["private-prompt"], private_sources: [privatePath],
    output_payload: {
      schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research",
      instrument: "BTCUSDT", timeframe: "4h", analysis_level: "intermediate", parent_trend: "up",
      current_pattern: "impulse", current_subwave: "3", knowledge_version: index.knowledgeVersion,
      valid_scenarios: [{ key: "primary", pattern: "impulse", conditions: ["等待价格确认"], invalidations: ["跌破结构起点"], confidence: 0.6,
        private_source: privatePath, violations: [{ rule_id: "ewp-rule-impulse-core", knowledge_page_id: privatePath, message: "结构条件未满足" }] }],
      eliminated_scenarios: [], unknown_fields: ["结构尚待确认"], risk: { max_loss: 5 },
      citations: [{ href: privatePath, title: "private-example" }], knowledge_citations: ["hermes:private-kb"],
      retrieval_debug: { sources: [privatePath] }, nested_private_data: { api_key: "test-only-secret" },
    },
    error_code: null, error_message: null,
  };
}
function assertPublicJob(result: unknown) {
  const job = result as Record<string, unknown>;
  assert.equal(job.id, "job");
  assert.equal(job.analysis_id, analysisId);
  assert.equal(job.status, "succeeded");
  assert.deepEqual(Object.keys(job).sort(), ["analysis_id", "created_at", "error_code", "error_message", "execution_source", "id", "knowledge_version", "output_payload", "status"].sort());
  const serialized = JSON.stringify(job);
  for (const hidden of [privatePath, "private-worker", "test-only-secret", "private-prompt", "internal-provider", connection.base_url,
    "connection_snapshot", "input_payload", "accepted_request", "knowledge_page_id", "retrieval_debug", "nested_private_data"]) {
    assert.ok(!serialized.includes(hidden), `public DTO leaked ${hidden}`);
  }
  const output = job.output_payload as Record<string, unknown>;
  assert.equal(output.schema_version, "wavekb-public-analysis-v1");
  assert.deepEqual(output.citations, []);
  assert.deepEqual(output.knowledge_citations, []);
  assert.ok(Array.isArray(output.analysis_basis) && output.analysis_basis.length === 1);
  assert.deepEqual(output.risk, { max_loss: 5 });
}

for (const route of ["byok_new", "byok_recovery", "managed_new", "managed_recovery", "poll"] as const) {
  test(`${route} returns one public projection while preserving owner checks and internal idempotency`, async () => {
    const source = route.startsWith("managed") ? "managed" : "byok";
    const raw = rawJob(source);
    const calls: Array<{ path: string; body?: unknown }> = [];
    let inspected = 0;
    const database = {
      async userForJwt() { return null; },
      async request(path: string, options?: { method?: string; body?: unknown }) {
        calls.push({ path, body: options?.body });
        if (path.startsWith("/rest/v1/workbench_analyses?")) {
          assert.ok(path.includes(`owner_id=eq.${owner}`));
          return [{ id: analysisId, owner_id: owner, schema_version: "workbench-v1" }];
        }
        if (path.startsWith("/rest/v1/user_ai_connections?")) return [connection];
        if (path.startsWith("/rest/v1/ai_jobs?idempotency_key=")) {
          assert.ok(path.includes(`owner_id=eq.${owner}`));
          return route.endsWith("recovery") ? [raw] : [];
        }
        if (path === "/rest/v1/ai_jobs" && options?.method === "POST") {
          const body = options.body as Record<string, unknown>;
          assert.deepEqual(body.input_payload, request);
          assert.equal(body.owner_id, owner);
          assert.equal(body.idempotency_key, `${owner}:${analysisId}:${request.client_request_id}`);
          assert.equal(body.knowledge_version, index.knowledgeVersion);
          assert.equal((body.connection_snapshot as Record<string, unknown>).base_url, connection.base_url);
          if (route === "byok_recovery") throw Object.assign(new Error("duplicate"), { code: "23505", status: 409 });
          return [raw];
        }
        if (path === "/rest/v1/rpc/enqueue_membership_ai_job") {
          const body = options?.body as Record<string, unknown>;
          assert.deepEqual(body.p_input_payload, request);
          assert.equal(body.p_owner_id, owner);
          assert.equal(body.p_user_connection_id, null);
          assert.equal(body.p_managed_model_id, modelId);
          assert.equal(body.p_idempotency_key, `${owner}:${analysisId}:${request.client_request_id}`);
          return raw;
        }
        if (path.startsWith("/rest/v1/ai_jobs?id=eq.job")) {
          assert.ok(path.includes(`owner_id=eq.${owner}`));
          return [raw];
        }
        throw new Error(`Unexpected database request: ${path}`);
      },
    };
    const gateway = new SupabaseGatewayApi({ ...config, MEMBERSHIP_MANAGED_AI_ENABLED: route !== "managed_recovery" }, {
      database, managedConnections: { inspect: async () => { inspected++; return model; } },
    });
    const result = route === "poll" ? await gateway.getJob(owner, "job")
      : await gateway.enqueueJob(owner, analysisId, { ...request, execution_mode: source });
    assertPublicJob(result);
    assert.equal(inspected, route === "managed_new" ? 1 : 0);
    assert.deepEqual(raw.accepted_request, request, "public projection must not mutate internal accepted input");
    assert.equal(raw.connection_snapshot.api_key, "test-only-secret");
    if (route === "managed_recovery") assert.ok(calls.every((call) => call.path !== "/rest/v1/rpc/enqueue_membership_ai_job"));
  });
}

test("private narrative disclosures and raw error messages never enter polling responses", async () => {
  const raw = rawJob("managed");
  raw.output_payload.valid_scenarios[0]!.conditions = [privatePath];
  const gateway = new SupabaseGatewayApi(config, { database: {
    userForJwt: async () => null,
    request: async () => [{ ...raw, error_code: "private_source_disclosure", error_message: `internal source: ${privatePath}` }],
  } });
  const result = await gateway.getJob(owner, "job") as Record<string, unknown>;
  assert.equal(result.output_payload, null);
  assert.equal(result.error_code, "analysis_unavailable");
  assert.equal(result.error_message, "AI 候选分析未完成，请稍后重试或检查模型连接。");
  assert.ok(!JSON.stringify(result).includes(privatePath));
});

for (const executionSource of ["byok", "managed"] as const) {
  test(`${executionSource} recovery compares internal accepted request before publishing a DTO`, async () => {
    const raw = rawJob(executionSource);
    const gateway = new SupabaseGatewayApi(config, { database: {
      userForJwt: async () => null,
      async request(path: string) {
        if (path.startsWith("/rest/v1/workbench_analyses?")) return [{ schema_version: "workbench-v1" }];
        if (path.startsWith("/rest/v1/user_ai_connections?")) return [connection];
        if (path === "/rest/v1/ai_jobs") throw Object.assign(new Error("duplicate"), { code: "23505", status: 409 });
        if (path.startsWith("/rest/v1/ai_jobs?idempotency_key=")) return [raw];
        throw new Error(`Unexpected database request: ${path}`);
      },
    } });
    await assert.rejects(gateway.enqueueJob(owner, analysisId, { ...request, step: 6, execution_mode: executionSource }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
  });
}

test("polling a missing or foreign-owner job still returns 404", async () => {
  const gateway = new SupabaseGatewayApi(config, { database: {
    userForJwt: async () => null,
    request: async (path: string) => { assert.ok(path.includes(`owner_id=eq.${owner}`)); return []; },
  } });
  await assert.rejects(gateway.getJob(owner, "foreign-job"), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
});
