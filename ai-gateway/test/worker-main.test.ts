import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { KnowledgeRuntime } from "../src/knowledge/runtime.ts";
import { classifyProviderError } from "../src/jobs/router.ts";
import type { KnowledgeChunk, KnowledgeIndex } from "../src/knowledge/index.ts";
import type { ProviderRequest, ProviderResult } from "../src/providers/types.ts";
import { AiJobWorker, type ClaimedJob } from "../src/worker-main.ts";

const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
});

const CONNECTION_ID = "44444444-4444-4444-8444-444444444444";

const baseJob: ClaimedJob = {
  id: "job-1",
  owner_id: "22222222-2222-4222-8222-222222222222",
  analysis_id: "33333333-3333-4333-8333-333333333333",
  user_connection_id: CONNECTION_ID,
  task_type: "wave_analysis",
  knowledge_version: "e50017a8f53a9d78e65bfa51871de50864c8f4ebb0e7cabe2d68018a04b5da61",
  input_payload: {
    request_version: 2,
    client_request_id: "11111111-1111-4111-8111-111111111111",
    task_type: "wave_analysis",
    step: 5,
    analysis_schema_version: "workbench-v1",
    knowledge_scope: { mode: "single", book_id: "elliott-wave-natural-law" },
  },
};

const analysis = {
  id: baseJob.analysis_id,
  owner_id: baseJob.owner_id,
  instrument: "BTCUSDT",
  market: "crypto",
  primary_timeframe: "4h",
  parent_timeframe: "1d",
  child_timeframe: "1h",
  holding_style: "swing",
  step_data: { "5": { pattern: "三角形", notes: "等待确认" } },
  risk_result: { reward_risk: 3.2, max_loss: 100 },
};

type RecordedCall = { path: string; method?: string; body?: Record<string, unknown> };

function validModelResult(overrides: Record<string, unknown> = {}) {
  return {
    instrument: "BTCUSDT",
    timeframe: "4h",
    analysis_level: "4 hour",
    parent_trend: "up",
    current_pattern: "triangle",
    current_subwave: "unknown",
    valid_scenarios: [],
    eliminated_scenarios: [],
    knowledge_citations: [],
    unknown_fields: [],
    ...overrides,
  };
}

function chunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    chunkId: "natural-law-chunk",
    bookId: "elliott-wave-natural-law",
    sourceId: "natural-law-source",
    sequence: 1,
    title: "Natural law evidence",
    headingPath: ["Evidence"],
    text: "Trusted extension evidence.",
    kind: "page",
    authority: "contextual",
    contentStatus: "generated",
    pdfPages: [7],
    href: "/knowledge/books/elliott-wave-natural-law#page-7",
    topics: ["target"],
    searchable: "target evidence",
    contentSha256: "b".repeat(64),
    ...overrides,
  };
}

function fixtureIndex(chunks: KnowledgeChunk[]): KnowledgeIndex {
  return {
    schemaVersion: "wavekb-ai-knowledge-v1",
    knowledgeVersion: baseJob.knowledge_version as string,
    books: [
      {
        bookId: "elliott-wave-principle-tenth-edition",
        title: "Elliott Wave Principle, Tenth Edition",
        role: "core",
        sourceArtifacts: [{ sourceId: "core-source", authority: "primary" }],
      },
      {
        bookId: "elliott-wave-natural-law",
        title: "Elliott Wave Natural Law",
        role: "extension",
        sourceArtifacts: [{ sourceId: "natural-law-source", authority: "contextual" }],
      },
      {
        bookId: "chan-theory-complete",
        title: "Chan Theory Complete",
        role: "extension",
        sourceArtifacts: [{ sourceId: "chan-source", authority: "contextual" }],
      },
    ],
    chunks,
  };
}

type ProviderOutcome = ProviderResult | Error;

function workerFixture(options: {
  auditFails?: boolean;
  currentAnalysis?: Record<string, unknown>;
  providerOutcomes?: ProviderOutcome[];
  loadIndex?: () => KnowledgeIndex;
  previousAttempts?: number;
  contextTokens?: number;
  usageLedgerFails?: boolean;
} = {}) {
  const events: string[] = [];
  const calls: RecordedCall[] = [];
  const database = {
    async request(path: string, request?: { method?: string; body?: Record<string, unknown> }) {
      calls.push({
        path,
        ...(request?.method ? { method: request.method } : {}),
        ...(request?.body ? { body: request.body } : {}),
      });
      if (path.startsWith("/rest/v1/ai_job_attempts?")) {
        return Array.from({ length: options.previousAttempts ?? 0 }, (_, index) => ({ id: `old-${index}` }));
      }
      if (path === "/rest/v1/ai_job_attempts") return [{ id: "attempt-1" }];
      if (path.startsWith("/rest/v1/profiles?")) return [{ id: baseJob.owner_id }];
      if (path.startsWith("/rest/v1/workbench_analyses?")) {
        return [options.currentAnalysis ?? analysis];
      }
      if (path === "/rest/v1/knowledge_retrievals") {
        events.push("audit");
        if (options.auditFails) throw new Error("audit unavailable");
        return [{ id: "retrieval-1" }];
      }
      if (path.startsWith("/rest/v1/ai_job_attempts?id=")) return null;
      if (path === "/rest/v1/ai_usage_ledger") {
        if (options.usageLedgerFails) throw new Error("usage ledger unavailable");
        return null;
      }
      if (path.startsWith("/rest/v1/ai_jobs?id=")) return null;
      throw new Error(`unexpected database path: ${path}`);
    },
  };
  let providerCalls = 0;
  let connectionResolutions = 0;
  const connectionRequests: Array<{ ownerId: string; connectionId: string }> = [];
  const providerRequests: ProviderRequest[] = [];
  const outcomes = [...(options.providerOutcomes ?? [{
    text: JSON.stringify(validModelResult()),
    usage: { inputTokens: 12, outputTokens: 7 },
    providerRequestId: "provider-request-1",
    finishReason: "stop",
  }])];
  const connections = {
    async resolve(ownerId: string, connectionId: string) {
      connectionResolutions += 1;
      connectionRequests.push({ ownerId, connectionId });
      return {
        id: CONNECTION_ID,
        ownerId: baseJob.owner_id,
        modelName: "model-a",
        timeoutMs: 60_000,
        maxOutputTokens: 4096,
        contextTokens: options.contextTokens ?? 32768,
        temperature: 0.2,
        provider: {
          async invoke(request: ProviderRequest) {
            providerCalls += 1;
            events.push("provider");
            providerRequests.push(request);
            const outcome = outcomes.shift();
            if (!outcome) throw new Error("unexpected provider invocation");
            if (outcome instanceof Error) throw outcome;
            return outcome;
          },
        },
      };
    },
  };
  const knowledgeRuntime = new KnowledgeRuntime({
    database,
    ...(options.loadIndex ? { loadIndex: options.loadIndex } : {}),
  });
  const worker = new AiJobWorker(config, "worker-1", {
    database,
    connections,
    now: () => 1_000,
    knowledgeRuntime,
  });
  return {
    worker,
    calls,
    events,
    providerRequests,
    providerCalls: () => providerCalls,
    connectionResolutions: () => connectionResolutions,
    connectionRequests,
  };
}

test("writes the retrieval audit before invoking the chosen provider", async () => {
  const fixture = workerFixture();
  await fixture.worker.runJob(baseJob);

  assert.deepEqual(fixture.events.slice(0, 2), ["audit", "provider"]);
  const retrieval = fixture.calls.find((call) => call.path === "/rest/v1/knowledge_retrievals");
  assert.equal(
    retrieval?.body?.query,
    "step 5 BTCUSDT crypto 4h 1d 1h swing 三角形 等待确认",
  );
  assert.equal(retrieval?.body?.task_type, "wave_analysis");
  assert.ok((retrieval?.body?.knowledge_ids as string[]).every((id) => (
    id.startsWith("elliott-wave-natural-law::")
  )));
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.deepEqual(patch?.body?.input_payload, baseJob.input_payload);
  assert.equal(patch?.body?.knowledge_version, baseJob.knowledge_version);
});

test("an audit write failure prevents every provider invocation", async () => {
  const fixture = workerFixture({ auditFails: true });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 0);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "failed");
});

test("a single-scope no-match succeeds without broadening or invoking a provider", async () => {
  const fixture = workerFixture({
    currentAnalysis: {
      ...analysis,
      instrument: "zzzxqvnomatch",
      market: "zzzxqvnomatch",
      primary_timeframe: "zzzxqvnomatch",
      parent_timeframe: "zzzxqvnomatch",
      child_timeframe: "zzzxqvnomatch",
      holding_style: "zzzxqvnomatch",
      step_data: { "5": { notes: "zzzxqvnomatch" } },
    },
  });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 0);
  const retrieval = fixture.calls.find((call) => call.path === "/rest/v1/knowledge_retrievals");
  assert.deepEqual(retrieval?.body?.knowledge_ids, []);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "succeeded");
  assert.deepEqual(patch?.body?.output_payload, {
    status: "insufficient_evidence",
    reason: "no_relevant_knowledge",
    scope: { mode: "single", book_id: "elliott-wave-natural-law" },
    knowledge_version: "e50017a8f53a9d78e65bfa51871de50864c8f4ebb0e7cabe2d68018a04b5da61",
    citations: [],
  });
});

test("the server expands retrieved citation ids from trusted index records", async () => {
  const fixture = workerFixture({
    currentAnalysis: { ...analysis, instrument: "target" },
    loadIndex: () => fixtureIndex([chunk()]),
    providerOutcomes: [{
      text: JSON.stringify(validModelResult({ knowledge_citations: ["natural-law-chunk"] })),
      usage: { inputTokens: 15, outputTokens: 9 },
      providerRequestId: "provider-citation",
      finishReason: "stop",
    }],
  });
  await fixture.worker.runJob(baseJob);

  const requestText = String(fixture.providerRequests[0]?.messages[0]?.content);
  assert.match(requestText, /<UNTRUSTED_KNOWLEDGE>/);
  assert.match(requestText, /<USER_INPUT>/);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  const output = patch?.body?.output_payload as Record<string, unknown>;
  assert.deepEqual(output.knowledge_citations, ["natural-law-chunk"]);
  assert.deepEqual(output.citations, [{
    knowledge_id: "natural-law-chunk",
    book_id: "elliott-wave-natural-law",
    book_title: "Elliott Wave Natural Law",
    title: "Natural law evidence",
    source_id: "natural-law-source",
    pages: [7],
    href: "/knowledge/books/elliott-wave-natural-law#page-7",
    snippet: "Trusted extension evidence.",
  }]);
});

test("extension-only retrieval excludes core prose while the tenth-edition hard-rule gate still runs", async () => {
  const coreChunk = chunk({
    chunkId: "core-rule",
    bookId: "elliott-wave-principle-tenth-edition",
    sourceId: "core-source",
    title: "Core rule",
    text: "CORE TENTH EDITION PROSE MUST NOT LEAK",
    kind: "unit",
    authority: "primary",
    contentStatus: "verified",
    pdfPages: [],
    href: "/knowledge/unit-core-rule",
    searchable: "target core",
    contentSha256: "c".repeat(64),
  });
  const currentAnalysis = {
    ...analysis,
    instrument: "target",
    step_data: {
      "5": {
        pattern: "impulse",
        direction: "up",
        w1_start: 100,
        w1_end: 120,
        w2_end: 110,
        w3_end: 160,
        w4_end: 140,
        w5_end: 175,
      },
      "6": {
        pattern: "impulse",
        direction: "up",
        w1_start: 100,
        w1_end: 120,
        w2_end: 90,
        w3_end: 140,
        w4_end: 125,
        w5_end: 150,
      },
    },
    risk_result: { reward_risk: 3.2, max_loss: 100 },
  };
  const fixture = workerFixture({
    currentAnalysis,
    loadIndex: () => fixtureIndex([coreChunk, chunk()]),
    providerOutcomes: [{
      text: JSON.stringify(validModelResult({
        current_pattern: "impulse",
        valid_scenarios: [{
          key: "model-renamed-candidate",
          pattern: "impulse",
          conditions: ["candidate"],
          invalidations: ["wave 2 origin"],
          confidence: 0.8,
        }],
        knowledge_citations: ["natural-law-chunk"],
        risk: { reward_risk: 99, max_loss: 999 },
      })),
      usage: { inputTokens: 20, outputTokens: 10 },
      finishReason: "stop",
    }],
  });
  await fixture.worker.runJob(baseJob);

  const requestText = String(fixture.providerRequests[0]?.messages[0]?.content);
  assert.doesNotMatch(requestText, /CORE TENTH EDITION PROSE MUST NOT LEAK/);
  assert.match(requestText, /Trusted extension evidence/);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  const output = patch?.body?.output_payload as Record<string, any>;
  assert.deepEqual(output.risk, { reward_risk: 3.2, max_loss: 100 });
  assert.equal(output.valid_scenarios.length, 0);
  assert.equal(output.eliminated_scenarios[0]?.key, "model-renamed-candidate");
  assert.equal(output.eliminated_scenarios[0]?.violations?.[0]?.rule_id, "ewp-rule-impulse-core");
  assert.equal(output.citations[0]?.book_id, "elliott-wave-natural-law");
});

test("invalid JSON gets one same-provider repair and never succeeds with the raw output", async () => {
  const fixture = workerFixture({
    providerOutcomes: [{
      text: "this is not JSON",
      usage: { inputTokens: 3, outputTokens: 2 },
      providerRequestId: "bad-1",
      finishReason: "stop",
    }, {
      text: "this is still not JSON",
      usage: { inputTokens: 5, outputTokens: 7 },
      providerRequestId: "bad-2",
      finishReason: "stop",
    }],
  });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 2);
  assert.equal(fixture.connectionResolutions(), 1);
  assert.deepEqual(fixture.connectionRequests, [{
    ownerId: baseJob.owner_id,
    connectionId: baseJob.user_connection_id,
  }]);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "failed");
  assert.equal(patch?.body?.error_code, "invalid_model_output");
  assert.equal(Object.hasOwn(patch?.body ?? {}, "output_payload"), false);
  const attemptPatch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_job_attempts?id="));
  assert.equal(attemptPatch?.body?.provider_request_id, "bad-2");
  const usage = fixture.calls.find((call) => call.path === "/rest/v1/ai_usage_ledger");
  assert.deepEqual(usage?.body, {
    job_id: baseJob.id,
    attempt_id: "attempt-1",
    owner_id: baseJob.owner_id,
    input_tokens: 8,
    output_tokens: 9,
    cost_amount: 0,
    cost_confirmed: false,
  });
  assert.equal(fixture.calls.some((call) => call.path.startsWith("/rest/v1/workbench_analyses")
    && call.method === "PATCH"), false);
});

test("the runtime preserves first-call accounting while retaining a thrown repair error classification", async () => {
  for (const repairError of [
    Object.assign(new Error("repair timeout"), { code: "TIMEOUT" }),
    Object.assign(new Error("repair rate limited"), { status: 429 }),
    Object.assign(new Error("repair upstream"), { status: 503 }),
    Object.assign(new Error("repair auth"), { status: 401 }),
  ]) {
    let calls = 0;
    const runtime = new KnowledgeRuntime({
      database: { async request() { return [{ id: "retrieval-1" }]; } },
      loadIndex: () => fixtureIndex([chunk()]),
    });
    const connection = {
      id: CONNECTION_ID,
      ownerId: baseJob.owner_id,
      modelName: "model-a",
      timeoutMs: 60_000,
      maxOutputTokens: 4096,
      contextTokens: 32768,
      temperature: 0.2,
      provider: {
        async invoke() {
          calls += 1;
          if (calls === 1) return {
            text: "invalid first response",
            usage: { inputTokens: 13, outputTokens: 8 },
            providerRequestId: "billable-first",
            finishReason: "stop",
          };
          throw repairError;
        },
      },
    };

    await assert.rejects(
      () => runtime.run({ job: baseJob, analysis: { ...analysis, instrument: "target" }, connection }),
      (error: unknown) => {
        assert.equal(classifyProviderError(error), classifyProviderError(repairError));
        assert.deepEqual((error as { provider?: unknown }).provider, {
          usage: { inputTokens: 13, outputTokens: 8 },
          providerRequestId: "billable-first",
        });
        return true;
      },
    );
  }
});

test("the worker ledgers the first billable response before retrying or terminalizing a thrown repair failure", async () => {
  for (const [repairError, expectedStatus] of [
    [Object.assign(new Error("repair timeout"), { code: "TIMEOUT" }), "waiting_retry"],
    [Object.assign(new Error("repair auth"), { status: 401 }), "failed"],
  ] as const) {
    const fixture = workerFixture({
      currentAnalysis: { ...analysis, instrument: "target" },
      loadIndex: () => fixtureIndex([chunk()]),
      providerOutcomes: [{
        text: "invalid first response",
        usage: { inputTokens: 13, outputTokens: 8 },
        providerRequestId: "billable-first",
        finishReason: "stop",
      }, repairError],
    });
    await fixture.worker.runJob(baseJob);

    const usage = fixture.calls.find((call) => call.path === "/rest/v1/ai_usage_ledger");
    assert.deepEqual(usage?.body, {
      job_id: baseJob.id,
      attempt_id: "attempt-1",
      owner_id: baseJob.owner_id,
      input_tokens: 13,
      output_tokens: 8,
      cost_amount: 0,
      cost_confirmed: false,
    });
    const attempt = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_job_attempts?id="));
    assert.equal(attempt?.body?.provider_request_id, "billable-first");
    const job = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
    assert.equal(job?.body?.status, expectedStatus);
  }
});

test("a failed usage-ledger write cannot prevent invalid model output from terminalizing the job", async () => {
  const fixture = workerFixture({
    usageLedgerFails: true,
    providerOutcomes: [{
      text: "invalid initial output",
      usage: { inputTokens: 2, outputTokens: 1 },
      providerRequestId: "failed-ledger-1",
      finishReason: "stop",
    }, {
      text: "invalid repair output",
      usage: { inputTokens: 3, outputTokens: 2 },
      providerRequestId: "failed-ledger-2",
      finishReason: "stop",
    }],
  });

  let rejection: unknown;
  try {
    await fixture.worker.runJob(baseJob);
  } catch (error) {
    rejection = error;
  }

  assert.equal(fixture.providerCalls(), 2);
  assert.equal(fixture.calls.filter((call) => call.path === "/rest/v1/ai_usage_ledger").length, 1);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "failed");
  assert.equal(patch?.body?.error_code, "invalid_model_output");
  assert.equal(Object.hasOwn(patch?.body ?? {}, "available_at"), false);
  assert.equal(rejection, undefined);
  assert.equal(fixture.calls.some((call) => call.path.startsWith("/rest/v1/workbench_analyses")
    && call.method === "PATCH"), false);
});

test("a forged citation cannot succeed after the single format repair", async () => {
  const fixture = workerFixture({
    currentAnalysis: { ...analysis, instrument: "target" },
    loadIndex: () => fixtureIndex([chunk()]),
    providerOutcomes: [{
      text: JSON.stringify(validModelResult({ knowledge_citations: ["forged-core-id"] })),
      usage: { inputTokens: 4, outputTokens: 3 },
      providerRequestId: "forged-1",
      finishReason: "stop",
    }, {
      text: JSON.stringify(validModelResult({ knowledge_citations: ["forged-core-id"] })),
      usage: { inputTokens: 6, outputTokens: 5 },
      providerRequestId: "forged-2",
      finishReason: "stop",
    }],
  });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 2);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "failed");
  assert.equal(patch?.body?.error_code, "invalid_model_output");
  assert.equal(Object.hasOwn(patch?.body ?? {}, "output_payload"), false);
  const attemptPatch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_job_attempts?id="));
  assert.equal(attemptPatch?.body?.provider_request_id, "forged-2");
  const usage = fixture.calls.find((call) => call.path === "/rest/v1/ai_usage_ledger");
  assert.deepEqual(usage?.body, {
    job_id: baseJob.id,
    attempt_id: "attempt-1",
    owner_id: baseJob.owner_id,
    input_tokens: 10,
    output_tokens: 8,
    cost_amount: 0,
    cost_confirmed: false,
  });
  assert.equal(fixture.calls.some((call) => call.path.startsWith("/rest/v1/workbench_analyses")
    && call.method === "PATCH"), false);
});

test("an authentication failure ends immediately without fallback or retry scheduling", async () => {
  const authError = Object.assign(new Error("bad key"), { code: "AUTH", status: 401 });
  const fixture = workerFixture({ providerOutcomes: [authError] });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 1);
  assert.equal(fixture.connectionResolutions(), 1);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "failed");
  assert.equal(patch?.body?.error_code, "auth");
  assert.equal(Object.hasOwn(patch?.body ?? {}, "available_at"), false);
});

test("timeout, rate-limit, and upstream failures keep the existing three-attempt bound", async () => {
  for (const error of [
    Object.assign(new Error("timeout"), { code: "TIMEOUT" }),
    Object.assign(new Error("limited"), { status: 429 }),
    Object.assign(new Error("upstream"), { status: 503 }),
  ]) {
    const waiting = workerFixture({ providerOutcomes: [error] });
    await waiting.worker.runJob(baseJob);
    const waitingPatch = waiting.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
    assert.equal(waitingPatch?.body?.status, "waiting_retry");
    assert.equal(waitingPatch?.body?.worker_id, null);

    const exhausted = workerFixture({ providerOutcomes: [error], previousAttempts: 2 });
    await exhausted.worker.runJob(baseJob);
    const exhaustedPatch = exhausted.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
    assert.equal(exhaustedPatch?.body?.status, "failed");
    assert.equal(Object.hasOwn(exhaustedPatch?.body ?? {}, "available_at"), false);
  }
});

test("artifact corruption and unavailable pinned versions fail without a provider call", async () => {
  const corrupt = workerFixture({ loadIndex: () => { throw new Error("corrupt artifact"); } });
  await corrupt.worker.runJob(baseJob);
  assert.equal(corrupt.providerCalls(), 0);
  const corruptPatch = corrupt.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(corruptPatch?.body?.error_code, "knowledge_unavailable");

  const mismatch = workerFixture({ loadIndex: () => ({
    ...fixtureIndex([chunk()]),
    knowledgeVersion: "d".repeat(64),
  }) });
  await mismatch.worker.runJob(baseJob);
  assert.equal(mismatch.providerCalls(), 0);
  const mismatchPatch = mismatch.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(mismatchPatch?.body?.error_code, "knowledge_unavailable");
});

test("unsafe encoded citation routes are rejected before provider invocation", async () => {
  const fixture = workerFixture({
    currentAnalysis: { ...analysis, instrument: "target" },
    loadIndex: () => fixtureIndex([chunk({
      href: "/knowledge/books/elliott-wave-natural-law/%2e%2e/admin#page-7",
    })]),
  });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 0);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.error_code, "knowledge_unavailable");
});

test("the retrieval character budget shrinks below the chosen provider context limit", async () => {
  const oversized = chunk({
    text: `target ${"x".repeat(1_800)}`,
    searchable: "target",
  });
  const fixture = workerFixture({
    currentAnalysis: { ...analysis, instrument: "target" },
    contextTokens: 7_000,
    loadIndex: () => fixtureIndex([oversized]),
  });
  await fixture.worker.runJob(baseJob);

  assert.equal(fixture.providerCalls(), 0);
  const retrieval = fixture.calls.find((call) => call.path === "/rest/v1/knowledge_retrievals");
  assert.equal(retrieval?.body?.token_budget, 856);
  assert.deepEqual(retrieval?.body?.knowledge_ids, []);
});

test("the normalized payload is revalidated before retrieval or provider access", async () => {
  const fixture = workerFixture();
  await fixture.worker.runJob({
    ...baseJob,
    input_payload: { ...baseJob.input_payload, query: "client override" },
  });

  assert.equal(fixture.providerCalls(), 0);
  assert.equal(fixture.calls.some((call) => call.path === "/rest/v1/knowledge_retrievals"), false);
  const patch = fixture.calls.find((call) => call.path.startsWith("/rest/v1/ai_jobs?id="));
  assert.equal(patch?.body?.status, "failed");
  assert.equal(Object.hasOwn(patch?.body ?? {}, "output_payload"), false);
});

test("the artifact loader runs once for multiple jobs handled by one runtime", async () => {
  let loads = 0;
  const fixture = workerFixture({
    currentAnalysis: { ...analysis, instrument: "target" },
    loadIndex: () => {
      loads += 1;
      return fixtureIndex([chunk()]);
    },
    providerOutcomes: [
      { text: JSON.stringify(validModelResult()), usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" },
      { text: JSON.stringify(validModelResult()), usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" },
    ],
  });
  await fixture.worker.runJob(baseJob);
  await fixture.worker.runJob({ ...baseJob, id: "job-2" });

  assert.equal(loads, 1);
  assert.equal(fixture.providerCalls(), 2);
});
