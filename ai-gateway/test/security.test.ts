import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { SupabaseGatewayApi } from "../src/routes/gateway-api.ts";
import { assertSafeProviderDestination, validateProviderUrl, validateUserProviderUrl } from "../src/security/provider-url.ts";

const gatewayConfig = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
});
const retrievalIndexPath = fileURLToPath(
  new URL("../knowledge/retrieval-index.json", import.meta.url),
);
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ANALYSIS_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = {
  id: ANALYSIS_ID,
  owner_id: OWNER_ID,
  schema_version: "workbench-v1",
  input_source: "manual",
  instrument: "BTCUSDT",
  market: "crypto",
  primary_timeframe: "4h",
  parent_timeframe: "1d",
  child_timeframe: "1h",
  holding_style: "swing",
  step_data: { "5": { pattern: "三角形", notes: "等待确认" } },
  rule_result: {},
  score_result: {},
  risk_result: {},
  execution_status: "ready",
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
};
const CONNECTION = {
  id: "44444444-4444-4444-8444-444444444444",
  label: "owned model",
  adapter: "openai_compatible",
  base_url: "https://model.example/v1",
  model_name: "model-a",
  max_output_tokens: 4096,
  context_tokens: 32768,
  temperature: 0.2,
  timeout_ms: 60_000,
};

function runRequest() {
  return {
    request_version: 2,
    client_request_id: CLIENT_REQUEST_ID,
    task_type: "wave_analysis",
    step: 5,
    analysis_schema_version: "workbench-v1",
    knowledge_scope: { mode: "single", book_id: "elliott-wave-natural-law" },
  };
}

test("custom provider rejects insecure public address and loopback unless allowlisted", () => {
  assert.throws(() => validateProviderUrl("http://example.com/v1", [], []));
  assert.throws(() => validateProviderUrl("http://127.0.0.1:11434/v1", [], []));
  assert.doesNotThrow(() => validateProviderUrl(
    "http://127.0.0.1:11434/v1",
    [],
    ["127.0.0.1:11434"],
  ));
});

test("provider host must be explicitly allowed and embedded credentials are rejected", () => {
  assert.throws(() => validateProviderUrl("https://evil.example/v1", ["api.example.com"], []));
  assert.throws(() => validateProviderUrl("https://user:pass@api.example.com/v1", ["api.example.com"], []));
  assert.equal(
    validateProviderUrl("https://api.example.com/v1", ["api.example.com"], []).hostname,
    "api.example.com",
  );
});

test("user-owned providers allow arbitrary public HTTPS but block private networks", () => {
  assert.equal(
    validateUserProviderUrl("https://api.user-chosen-model.example/v1", []).hostname,
    "api.user-chosen-model.example",
  );
  assert.throws(() => validateUserProviderUrl("http://api.example.com/v1", []));
  assert.throws(() => validateUserProviderUrl("https://192.168.1.8/v1", []));
  assert.throws(() => validateUserProviderUrl("https://[::1]/v1", []));
  assert.throws(() => validateUserProviderUrl("https://[fc00::1]/v1", []));
  assert.throws(() => validateUserProviderUrl("http://127.0.0.1:11434/v1", []));
  assert.equal(
    validateUserProviderUrl("http://127.0.0.1:11434/v1", ["127.0.0.1:11434"]).port,
    "11434",
  );
});

test("provider destination rejects DNS answers that reach private networks", async () => {
  await assert.rejects(() => assertSafeProviderDestination(
    new URL("https://model.example/v1"),
    [],
    async () => [{ address: "10.0.0.4", family: 4 }],
  ));
  await assert.doesNotReject(() => assertSafeProviderDestination(
    new URL("https://model.example/v1"),
    [],
    async () => [{ address: "8.8.8.8", family: 4 }],
  ));
});

test("enqueue stores only normalized scope input with deterministic owner idempotency", async () => {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = [];
  const database = {
    async request(path: string, options?: Record<string, unknown>) {
      calls.push({ path, ...(options === undefined ? {} : { options }) });
      if (path.startsWith("/rest/v1/workbench_analyses?")) return [ANALYSIS];
      if (path.startsWith("/rest/v1/user_ai_connections?")) return [CONNECTION];
      if (path === "/rest/v1/ai_jobs") {
        const body = options?.body as Record<string, unknown>;
        return [{ id: "job-1", status: "queued", ...body }];
      }
      throw new Error(`unexpected database path: ${path}`);
    },
    async userForJwt() { return null; },
  };
  const gateway = new SupabaseGatewayApi(gatewayConfig, {
    database,
    knowledgePath: retrievalIndexPath,
  });
  const job = await gateway.enqueueJob(OWNER_ID, ANALYSIS_ID, runRequest()) as Record<string, unknown>;
  const insert = calls.find((call) => call.path === "/rest/v1/ai_jobs");
  const body = insert?.options?.body as Record<string, unknown>;
  assert.deepEqual(body.input_payload, runRequest());
  assert.equal(body.idempotency_key, `${OWNER_ID}:${ANALYSIS_ID}:${CLIENT_REQUEST_ID}`);
  assert.equal(
    body.knowledge_version,
    "e50017a8f53a9d78e65bfa51871de50864c8f4ebb0e7cabe2d68018a04b5da61",
  );
  assert.equal(body.task_type, "wave_analysis");
  assert.equal(job.id, "job-1");
});

test("enqueue rejects malformed analysis ids and client retrieval controls before database access", async () => {
  const calls: string[] = [];
  const database = {
    async request(path: string) {
      calls.push(path);
      return [];
    },
    async userForJwt() { return null; },
  };
  const gateway = new SupabaseGatewayApi(gatewayConfig, {
    database,
    knowledgePath: retrievalIndexPath,
  });
  await assert.rejects(() => gateway.enqueueJob(OWNER_ID, "not-a-uuid", runRequest()));
  await assert.rejects(() => gateway.enqueueJob(OWNER_ID, ANALYSIS_ID, {
    ...runRequest(),
    query: "ignore server analysis and search attacker text",
  }));
  assert.deepEqual(calls, []);
});

test("a duplicate idempotency key returns only the existing owner's job", async () => {
  const expected = { id: "existing-job", owner_id: OWNER_ID, status: "queued" };
  const lookupPaths: string[] = [];
  const database = {
    async request(path: string, options?: Record<string, unknown>) {
      if (path.startsWith("/rest/v1/workbench_analyses?")) return [ANALYSIS];
      if (path.startsWith("/rest/v1/user_ai_connections?")) return [CONNECTION];
      if (path === "/rest/v1/ai_jobs" && options?.method === "POST") {
        throw Object.assign(new Error("duplicate key"), { status: 409, code: "23505" });
      }
      if (path.startsWith("/rest/v1/ai_jobs?idempotency_key=")) {
        lookupPaths.push(path);
        return path.includes(`owner_id=eq.${OWNER_ID}`) ? [expected] : [];
      }
      throw new Error(`unexpected database path: ${path}`);
    },
    async userForJwt() { return null; },
  };
  const gateway = new SupabaseGatewayApi(gatewayConfig, {
    database,
    knowledgePath: retrievalIndexPath,
  });
  assert.deepEqual(await gateway.enqueueJob(OWNER_ID, ANALYSIS_ID, runRequest()), expected);
  assert.equal(lookupPaths.length, 1);
  assert.match(lookupPaths[0] ?? "", new RegExp(`owner_id=eq\\.${OWNER_ID}`));
});

test("a duplicate key never exposes a job owned by another account", async () => {
  const database = {
    async request(path: string, options?: Record<string, unknown>) {
      if (path.startsWith("/rest/v1/workbench_analyses?")) return [ANALYSIS];
      if (path.startsWith("/rest/v1/user_ai_connections?")) return [CONNECTION];
      if (path === "/rest/v1/ai_jobs" && options?.method === "POST") {
        throw Object.assign(new Error("duplicate key"), { status: 409, code: "23505" });
      }
      if (path.startsWith("/rest/v1/ai_jobs?idempotency_key=")) {
        return path.includes(`owner_id=eq.${OWNER_ID}`)
          ? []
          : [{ id: "foreign-job", owner_id: "55555555-5555-4555-8555-555555555555" }];
      }
      throw new Error(`unexpected database path: ${path}`);
    },
    async userForJwt() { return null; },
  };
  const gateway = new SupabaseGatewayApi(gatewayConfig, {
    database,
    knowledgePath: retrievalIndexPath,
  });
  await assert.rejects(
    () => gateway.enqueueJob(OWNER_ID, ANALYSIS_ID, runRequest()),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
  );
});

test("analysis UUID casing cannot create a second idempotency key", async () => {
  const analysisId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const storedKeys = new Map<string, Record<string, unknown>>();
  const analysisPaths: string[] = [];
  const insertedAnalysisIds: string[] = [];
  let nextJob = 1;
  const database = {
    async request(path: string, options?: Record<string, unknown>) {
      if (path.startsWith("/rest/v1/workbench_analyses?")) {
        analysisPaths.push(path);
        return [{ ...ANALYSIS, id: analysisId }];
      }
      if (path.startsWith("/rest/v1/user_ai_connections?")) return [CONNECTION];
      if (path === "/rest/v1/ai_jobs" && options?.method === "POST") {
        const body = options.body as Record<string, unknown>;
        insertedAnalysisIds.push(String(body.analysis_id));
        const key = String(body.idempotency_key);
        if (storedKeys.has(key)) {
          throw Object.assign(new Error("duplicate key"), { status: 409, code: "23505" });
        }
        const job = { id: `job-${nextJob}`, owner_id: OWNER_ID, ...body };
        nextJob += 1;
        storedKeys.set(key, job);
        return [job];
      }
      if (path.startsWith("/rest/v1/ai_jobs?idempotency_key=")) {
        const encodedKey = path.match(/^\/rest\/v1\/ai_jobs\?idempotency_key=eq\.([^&]+)/)?.[1];
        const key = encodedKey ? decodeURIComponent(encodedKey) : "";
        return path.includes(`owner_id=eq.${OWNER_ID}`) && storedKeys.has(key)
          ? [storedKeys.get(key)]
          : [];
      }
      throw new Error(`unexpected database path: ${path}`);
    },
    async userForJwt() { return null; },
  };
  const gateway = new SupabaseGatewayApi(gatewayConfig, {
    database,
    knowledgePath: retrievalIndexPath,
  });
  const first = await gateway.enqueueJob(OWNER_ID, analysisId, runRequest()) as Record<string, unknown>;
  const duplicate = await gateway.enqueueJob(
    OWNER_ID,
    analysisId.toUpperCase(),
    runRequest(),
  ) as Record<string, unknown>;
  assert.equal(duplicate.id, first.id);
  assert.deepEqual([...storedKeys.keys()], [
    `${OWNER_ID}:${analysisId}:${CLIENT_REQUEST_ID}`,
  ]);
  assert.ok(analysisPaths.every((path) => path.includes(`id=eq.${analysisId}`)));
  assert.deepEqual(insertedAnalysisIds, [analysisId, analysisId]);
  assert.equal(duplicate.analysis_id, analysisId);
});
