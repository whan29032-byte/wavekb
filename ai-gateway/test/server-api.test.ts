import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
});

let lastEnqueue: unknown[] = [];

const api = {
  async authorize(token: string) {
    if (token === "admin-token") return { id: "admin-1", role: "admin" };
    if (token === "user-token") return { id: "user-1", role: "user" };
    return null;
  },
  async listDirectoryResources(includeInactive = false) {
    return [{
      id: "r1",
      platform: "x",
      name: "Wave Research",
      url: "https://x.com/waveresearch",
      avatar_url: "https://unavatar.io/x/waveresearch",
      active: includeInactive ? false : true,
      sort_order: 10,
    }];
  },
  async createDirectoryResource(input: any) {
    return { id: "r2", ...input, avatar_url: "https://unavatar.io/x/newwave" };
  },
  async updateDirectoryResource(resourceId: string, input: any) {
    return { id: resourceId, ...input };
  },
  async deleteDirectoryResource() {},
  async deleteOwnPost(postId: string, actor: any) {
    return [`${actor.id}/${postId}/image.png`];
  },
  async dashboard() {
    return { calls_today: 2, tokens_today: 90, cost_today: 0.01 };
  },
  async listProviders() {
    return [{ id: "p1", name: "Mock", adapter: "openai_compatible", last_four: "1234" }];
  },
  async createProvider() {
    return { id: "p2", name: "New", adapter: "openai_compatible", last_four: "5678" };
  },
  async listUserConnections(ownerId: string) {
    return [{
      id: "c1",
      owner_id: ownerId,
      label: "我的模型",
      model_name: "model-a",
      secret_mask: "••••1234",
      is_default: true,
    }];
  },
  async createUserConnection(ownerId: string) {
    return {
      id: "c2",
      owner_id: ownerId,
      label: "新接口",
      secret_mask: "••••5678",
      is_default: false,
    };
  },
  async setDefaultUserConnection(ownerId: string, connectionId: string) {
    return { id: connectionId, owner_id: ownerId, is_default: true, secret_mask: "••••1234" };
  },
  async rotateUserConnectionSecret(ownerId: string, connectionId: string) {
    return { id: connectionId, owner_id: ownerId, secret_mask: "••••9999", key_version: 2 };
  },
  async enqueueJob(ownerId: string, analysisId: string, input: Record<string, unknown>) {
    lastEnqueue = [ownerId, analysisId, input];
    return { id: "j1", owner_id: ownerId, analysis_id: analysisId, status: "queued" };
  },
  async getJob(_ownerId: string, jobId: string) {
    return { id: jobId, status: "queued" };
  },
  async listTradingLeaderboard(...args: string[]) {
    return [{ rank_no: 1, public_uid: 583104, display_name: "Wave", return_rate: args.length ? -1 : 0.2, current_equity_usdt: 1470, cumulative_profit_usdt: 170 }];
  },
  async getExchangeConnection() {
    return { id: "e1", status: "active", secret_mask: "••••ABCD" };
  },
  async createExchangeConnection() {
    return { id: "e1", status: "active", secret_mask: "••••ABCD" };
  },
  async syncExchangeConnection() {
    return { id: "e1", status: "active", secret_mask: "••••ABCD" };
  },
  async disconnectExchangeConnection() {
    return { id: "e1", status: "disabled", secret_mask: "••••ABCD" };
  },
  async setExchangeConnectionPublic(_ownerId: string, enabled: boolean) {
    return { id: "e1", status: "active", public_enabled: enabled, public_amounts_consented: enabled, secret_mask: "••••ABCD" };
  },
  async listAdminExchangeConnections() {
    return [{ id: "11111111-1111-4111-8111-111111111111", owner: { public_uid: 583104 }, status: "active", secret_mask: "••••ABCD" }];
  },
  async disableAdminExchangeConnection() {
    return { id: "11111111-1111-4111-8111-111111111111", status: "disabled", secret_mask: "••••ABCD" };
  },
  async setAdminExchangeDisplayEquity(_actorId: string, _connectionId: string, displayEquity: string | null) {
    return { id: "11111111-1111-4111-8111-111111111111", status: "active", public_display_equity_usdt: displayEquity, secret_mask: "••••ABCD" };
  },
};

const userAdministrationApi = {
  async summary() {
    return {
      total_users: 12,
      banned_users: 1,
      muted_users: 2,
      admin_users: 2,
    };
  },
  async listUsers(_actor: any, input: any) {
    return {
      users: [{
        id: "62a6d9fa-f705-4e6e-9aa4-6bfcb13a4ce0",
        public_uid: 583104,
        display_name: "Wave",
      }],
      page: Number(input.page || 1),
      limit: 25,
      total: 1,
    };
  },
  async setStatus(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, account_status: input.status };
  },
  async setMute(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, muted_until: input.muted_until };
  },
  async setRole(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, role: input.role };
  },
  async setUid(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, public_uid: input.uid };
  },
  async listAudit() {
    return { entries: [{ action: "ban", target_uid: 583104 }], page: 1, limit: 50 };
  },
};

test("admin routes require both a valid token and admin role", async () => {
  const server = buildServer({ config, api });
  assert.equal((await server.inject({ url: "/v1/admin/providers" })).statusCode, 401);
  assert.equal((await server.inject({
    url: "/v1/admin/providers",
    headers: { authorization: "Bearer user-token" },
  })).statusCode, 403);
  const response = await server.inject({
    url: "/v1/admin/providers",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("api_key"), false);
});

test("external directory is public to read and admin-only to manage", async () => {
  const server = buildServer({ config, api });
  const publicList = await server.inject({ url: "/api/directory" });
  assert.equal(publicList.statusCode, 200);
  assert.equal((publicList.json() as any).resources[0].name, "Wave Research");

  const rejected = await server.inject({
    method: "POST",
    url: "/v1/admin/directory",
    headers: { authorization: "Bearer user-token" },
    payload: { platform: "x", url: "https://x.com/newwave" },
  });
  assert.equal(rejected.statusCode, 403);

  const created = await server.inject({
    method: "POST",
    url: "/v1/admin/directory",
    headers: { authorization: "Bearer admin-token" },
    payload: {
      platform: "x",
      name: "New Wave",
      url: "https://x.com/newwave",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal((created.json() as any).resource.name, "New Wave");
});

test("ordinary user can enqueue only through the site gateway", async () => {
  const server = buildServer({ config, api });
  const input = {
    request_version: 2,
    client_request_id: "11111111-1111-4111-8111-111111111111",
    task_type: "wave_analysis",
    step: 5,
    analysis_schema_version: "workbench-v1",
    knowledge_scope: {
      mode: "single",
      book_id: "elliott-wave-natural-law",
    },
  };
  const response = await server.inject({
    method: "POST",
    url: "/v1/analyses/a1/ai-run",
    headers: { authorization: "Bearer user-token" },
    payload: input,
  });
  assert.equal(response.statusCode, 202);
  assert.equal((response.json() as any).job.status, "queued");
  assert.equal(response.body.includes("moonshot"), false);
  assert.deepEqual(lastEnqueue, ["user-1", "a1", input]);
});

test("authenticated users delete posts only through the owner-scoped gateway route", async () => {
  const server = buildServer({ config, api });
  const postId = "11111111-1111-4111-8111-111111111111";
  assert.equal((await server.inject({
    method: "POST",
    url: `/v1/community/posts/${postId}/delete`,
  })).statusCode, 401);
  const response = await server.inject({
    method: "POST",
    url: `/v1/community/posts/${postId}/delete`,
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    deleted: true,
    storage_paths: [`user-1/${postId}/image.png`],
  });
});

test("users can manage only their own masked AI connections", async () => {
  const server = buildServer({ config, api });
  const list = await server.inject({
    url: "/v1/user/ai-connections",
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.includes("••••1234"), true);
  assert.equal(list.body.includes("api_key"), false);

  const created = await server.inject({
    method: "POST",
    url: "/v1/user/ai-connections",
    headers: { authorization: "Bearer user-token" },
    payload: {
      label: "新接口",
      adapter: "openai_compatible",
      base_url: "https://api.example.com/v1",
      model_name: "model-a",
      api_key: "secret-value-5678",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.includes("secret-value-5678"), false);
  assert.equal(created.body.includes("••••5678"), true);
});

test("trading leaderboard is public while exchange credentials remain owner-scoped and masked", async () => {
  const server = buildServer({ config, api });
  const board = await server.inject({ url: "/api/trading-leaderboard?period=7d" });
  assert.equal(board.statusCode, 200);
  assert.equal((board.json() as any).entries[0].return_rate, 0.2);
  assert.equal((board.json() as any).entries[0].current_equity_usdt, 1470);
  assert.equal((board.json() as any).entries[0].cumulative_profit_usdt, 170);
  assert.equal(board.headers["cache-control"], "no-store");

  assert.equal((await server.inject({ url: "/v1/user/exchange-connection" })).statusCode, 401);
  const created = await server.inject({
    method: "POST",
    url: "/v1/user/exchange-connection",
    headers: { authorization: "Bearer user-token" },
    payload: { api_key: "binance-api-key-super-secret", secret_key: "binance-secret-super-secret", read_only_ack: true },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.includes("binance-api-key-super-secret"), false);
  assert.equal(created.body.includes("binance-secret-super-secret"), false);
  assert.equal(created.body.includes("••••ABCD"), true);
  const publicConnection = await server.inject({
    method: "POST",
    url: "/v1/user/exchange-connection/public",
    headers: { authorization: "Bearer user-token" },
    payload: { public_enabled: true },
  });
  assert.equal(publicConnection.statusCode, 200);
  assert.equal((publicConnection.json() as any).connection.public_amounts_consented, true);
});

test("private trade chart routes are owner-authenticated, fixed, no-store and origin/body bounded", async () => {
  const cycleId = "11111111-1111-4111-8111-111111111111";
  const calls: unknown[] = [];
  const tradingWorkbench = {
    async getChart(ownerId: string, id: string, query: unknown) {
      calls.push(["get", ownerId, id, query]);
      return { schema_version: "wavekb-trade-chart-projection-v1", cycle_id: id, markers: [] };
    },
    async saveChartState(ownerId: string, id: string, input: unknown, accessToken: string) {
      calls.push(["state", ownerId, id, input, accessToken]);
      return { cycle_id: id, version: 2 };
    },
    async saveFillAnnotation(ownerId: string, id: string, fillId: string, input: unknown, accessToken: string) {
      calls.push(["annotation", ownerId, id, fillId, input, accessToken]);
      return { id: "22222222-2222-4222-8222-222222222222", fill_id: fillId, version: 2 };
    },
  } as any;
  const server = buildServer({ config, api, tradingWorkbench });

  assert.equal((await server.inject({ url: `/v1/user/trading-trades/${cycleId}/chart?timeframe=1m&from=2026-11-23T17%3A59%3A00.000Z&to=2026-11-23T18%3A03%3A00.000Z` })).statusCode, 401);
  const chart = await server.inject({
    url: `/v1/user/trading-trades/${cycleId}/chart?timeframe=1m&from=2026-11-23T17%3A59%3A00.000Z&to=2026-11-23T18%3A03%3A00.000Z`,
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(chart.statusCode, 200);
  assert.equal(chart.headers["cache-control"], "no-store");
  assert.deepEqual(calls[0], ["get", "user-1", cycleId, { timeframe: "1m", from: "2026-11-23T17:59:00.000Z", to: "2026-11-23T18:03:00.000Z" }]);

  const stateBody = { cycle_revision: 3, schema_version: "wavekb-trade-chart-v1", timeframe: "1m", price_type: "trade", viewport: { from: 1, to: 2 }, indicators: [], drawings: [], expected_version: 1, expected_updated_at: "2026-11-23T18:03:00.000Z" };
  const state = await server.inject({
    method: "PUT",
    url: `/v1/user/trading-trades/${cycleId}/chart-state`,
    headers: { authorization: "Bearer user-token", origin: "http://localhost:8765" },
    payload: stateBody,
  });
  assert.equal(state.statusCode, 200);
  assert.equal(state.headers["cache-control"], "no-store");
  assert.deepEqual(calls[1], ["state", "user-1", cycleId, stateBody, "user-token"]);

  const annotationBody = { annotation_id: "22222222-2222-4222-8222-222222222222", cycle_revision: 3, body: "note", tags: ["breakout"], images: [], expected_version: 1, deleted: false };
  const annotation = await server.inject({
    method: "PUT",
    url: `/v1/user/trading-trades/${cycleId}/fills/101/annotation`,
    headers: { authorization: "Bearer user-token", origin: "http://localhost:8765" },
    payload: annotationBody,
  });
  assert.equal(annotation.statusCode, 200);
  assert.equal(annotation.headers["cache-control"], "no-store");
  assert.deepEqual(calls[2], ["annotation", "user-1", cycleId, "101", annotationBody, "user-token"]);

  const foreignOrigin = await server.inject({
    method: "PUT",
    url: `/v1/user/trading-trades/${cycleId}/chart-state`,
    headers: { authorization: "Bearer user-token", origin: "https://evil.example" },
    payload: stateBody,
  });
  assert.equal(foreignOrigin.statusCode, 403);
  assert.deepEqual(foreignOrigin.json(), { error: "invalid_request" });
  const oversized = await server.inject({
    method: "PUT",
    url: `/v1/user/trading-trades/${cycleId}/fills/101/annotation`,
    headers: { authorization: "Bearer user-token", origin: "http://localhost:8765" },
    payload: { ...annotationBody, body: "x".repeat(32 * 1024) },
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal((await server.inject({
    url: `/v1/user/trading-trades/${cycleId}/chart/anything`,
    headers: { authorization: "Bearer user-token" },
  })).statusCode, 404);
});

test("private trade chart failures preserve only fixed safe codes and no-store headers", async () => {
  const cycleId = "11111111-1111-4111-8111-111111111111";
  const tradingWorkbench = {
    async getChart() {
      throw Object.assign(new Error("invalid_trade_chart_query"), {
        statusCode: 400,
        cause: new Error("private provider host and token"),
      });
    },
  } as any;
  const server = buildServer({ config, api, tradingWorkbench });
  const response = await server.inject({
    url: `/v1/user/trading-trades/${cycleId}/chart?timeframe=1m&from=a&to=b`,
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "invalid_trade_chart_query" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes("private provider host"), false);

  const conflictServer = buildServer({
    config,
    api,
    tradingWorkbench: {
      async saveChartState() {
        throw Object.assign(new Error("stale_trade_chart_state"), { status: 400 });
      },
    } as any,
  });
  const conflict = await conflictServer.inject({
    method: "PUT",
    url: `/v1/user/trading-trades/${cycleId}/chart-state`,
    headers: { authorization: "Bearer user-token", origin: "http://localhost:8765" },
    payload: {},
  });
  assert.equal(conflict.statusCode, 409, "known optimistic RPC conflicts must not inherit PostgREST's generic 400");
  assert.deepEqual(conflict.json(), { error: "stale_trade_chart_state" });
});

test("exchange validation preserves fixed Exness errors without exposing upstream details", async () => {
  const cases = [
    ["exness_invalid_api_key", 400],
    ["exness_invalid_signature", 400],
    ["exness_permission_denied", 400],
    ["exness_rate_limited", 429],
    ["exness_unavailable", 503],
    ["exness_invalid_private_key", 400],
    ["exness_credentials_required", 400],
    ["exness_discovery_not_allowed", 400],
  ] as const;
  for (const [code, statusCode] of cases) {
    const exchangeConnections = {
      async validate() {
        throw Object.assign(new Error(code), { statusCode, cause: new Error("private upstream detail") });
      },
    } as any;
    const server = buildServer({ config, api, exchangeConnections });
    const response = await server.inject({
      method: "POST",
      url: "/v1/user/exchange-connections/validate",
      headers: { authorization: "Bearer user-token" },
      payload: { provider: "exness", credentials: {}, read_only_ack: true },
    });
    assert.equal(response.statusCode, statusCode);
    assert.deepEqual(response.json(), { error: code });
    assert.equal(response.body.includes("private upstream detail"), false);
  }
});

test("manual sync preserves fixed Binance errors without exposing raw causes", async () => {
  const cases = [
    ["binance_rate_limited", 429],
    ["binance_trading_permission_not_allowed", 400],
    ["binance_invalid_history_payload", 400],
  ] as const;
  for (const [code, statusCode] of cases) {
    const tradingSync = {
      async syncConnection() {
        throw Object.assign(new Error(code), {
          statusCode,
          cause: new Error("private upstream detail"),
        });
      },
    } as any;
    const server = buildServer({
      config,
      api,
      exchangeConnections: {} as any,
      tradingSync,
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/user/exchange-connections/11111111-1111-4111-8111-111111111111/sync",
      headers: { authorization: "Bearer user-token" },
    });
    assert.equal(response.statusCode, statusCode);
    assert.deepEqual(response.json(), { error: code });
    assert.equal(response.body.includes("private upstream detail"), false);
  }
});

test("only admins can inspect or disable exchange connections", async () => {
  const server = buildServer({ config, api });
  assert.equal((await server.inject({ url: "/v1/admin/trading-connections", headers: { authorization: "Bearer user-token" } })).statusCode, 403);
  const list = await server.inject({ url: "/v1/admin/trading-connections", headers: { authorization: "Bearer admin-token" } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.includes("••••ABCD"), true);
  const disabled = await server.inject({ method: "POST", url: "/v1/admin/trading-connections/11111111-1111-4111-8111-111111111111/disable", headers: { authorization: "Bearer admin-token" }, payload: { reason: "收益异常核验" } });
  assert.equal(disabled.statusCode, 200);
  assert.equal((disabled.json() as any).connection.status, "disabled");
  const display = await server.inject({ method: "POST", url: "/v1/admin/trading-connections/11111111-1111-4111-8111-111111111111/display-equity", headers: { authorization: "Bearer admin-token" }, payload: { display_equity_usdt: "12345.67", reason: "统一榜单展示口径" } });
  assert.equal(display.statusCode, 200);
  assert.equal((display.json() as any).connection.public_display_equity_usdt, "12345.67");
});

test("user administration is isolated behind admin routes", async () => {
  const server = buildServer({ config, api, userAdministrationApi });
  const userList = await server.inject({
    url: "/v1/admin/users?query=583104&page=1",
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(userList.statusCode, 403);

  const adminList = await server.inject({
    url: "/v1/admin/users?query=583104&page=1",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(adminList.statusCode, 200);
  assert.equal((adminList.json() as any).users[0].public_uid, 583104);

  const changed = await server.inject({
    method: "POST",
    url: "/v1/admin/users/62a6d9fa-f705-4e6e-9aa4-6bfcb13a4ce0/status",
    headers: { authorization: "Bearer admin-token" },
    payload: { status: "banned", reason: "spam" },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal((changed.json() as any).user.account_status, "banned");

  const audit = await server.inject({
    url: "/v1/admin/moderation-audit",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(audit.statusCode, 200);
  assert.equal((audit.json() as any).entries[0].action, "ban");
});
