import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { AuthRateLimiter } from "../src/security/auth-rate-limit.ts";
import { buildServer } from "../src/server.ts";

const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
  AUTH_FEATURE_ENABLED: "true",
  AUTH_LOGIN_LIMIT_PER_15_MINUTES: "2",
  AUTH_UID_ACTION_LIMIT_PER_HOUR: "4",
  ALLOWED_WEB_ORIGINS: "https://knowledge.example.com",
});

const pendingState = {
  candidateUids: [583104],
  selectedUid: 583104,
  refreshesUsed: 0,
  refreshesRemaining: 3,
  expiresAt: "2026-07-26T05:00:00Z",
  status: "pending" as const,
  publicUid: null,
};

const authApi = {
  async login() {
    return {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "user-1",
        public_uid: 583104,
        display_name: "Wave",
        role: "user",
      },
    };
  },
  async selectionState(token: string) {
    if (token !== "confirmed-token") {
      throw Object.assign(new Error("authentication_required"), { statusCode: 401 });
    }
    return pendingState;
  },
  async startSelection() {
    return pendingState;
  },
  async refreshSelection() {
    return { ...pendingState, refreshesUsed: 1, refreshesRemaining: 2 };
  },
  async selectCandidate() {
    return pendingState;
  },
  async completeSelection() {
    return { ...pendingState, status: "completed" as const, publicUid: 583104 };
  },
};

test("public login is no-store and never echoes the password", async () => {
  const server = buildServer({
    config,
    authApi,
    authRateLimiter: new AuthRateLimiter(config.AI_SECRET_MASTER_KEY, () => 0),
  });
  const response = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: {
      origin: "https://knowledge.example.com",
      "x-forwarded-for": "203.0.113.8",
    },
    payload: {
      identifier: "583104",
      password: "correct horse battery staple",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes("correct horse battery staple"), false);
  assert.equal((response.json() as any).session.user.public_uid, 583104);
});

test("UID selection requires a bearer token", async () => {
  const server = buildServer({ config, authApi });
  const denied = await server.inject({
    method: "GET",
    url: "/api/auth/uid-selection/status",
    headers: { origin: "https://knowledge.example.com" },
  });
  assert.equal(denied.statusCode, 401);

  const accepted = await server.inject({
    method: "GET",
    url: "/api/auth/uid-selection/status",
    headers: {
      origin: "https://knowledge.example.com",
      authorization: "Bearer confirmed-token",
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual((accepted.json() as any).selection.candidateUids, [583104]);
});

test("UID candidate selection, refresh, and completion reach the backend", async () => {
  const calls: Array<{ action: string; token: string; uid?: unknown }> = [];
  const routedApi = {
    ...authApi,
    async refreshSelection(token: string) {
      calls.push({ action: "refresh", token });
      return { ...pendingState, refreshesUsed: 1, refreshesRemaining: 2 };
    },
    async selectCandidate(token: string, uid: unknown) {
      calls.push({ action: "select", token, uid });
      return { ...pendingState, selectedUid: Number(uid) };
    },
    async completeSelection(token: string) {
      calls.push({ action: "complete", token });
      return { ...pendingState, status: "completed" as const, publicUid: 583104 };
    },
  };
  const server = buildServer({
    config,
    authApi: routedApi,
    authRateLimiter: new AuthRateLimiter(config.AI_SECRET_MASTER_KEY, () => 0),
  });
  const request = (url: string, payload: unknown = {}) => server.inject({
    method: "POST",
    url,
    headers: {
      origin: "https://knowledge.example.com",
      authorization: "Bearer confirmed-token",
      "x-forwarded-for": "203.0.113.9",
    },
    payload,
  });

  const refreshed = await request("/api/auth/uid-selection/refresh");
  const selected = await request("/api/auth/uid-selection/select", { uid: 583104 });
  const completed = await request("/api/auth/uid-selection/complete");

  assert.equal(refreshed.statusCode, 200);
  assert.equal((refreshed.json() as any).selection.refreshesRemaining, 2);
  assert.equal(selected.statusCode, 200);
  assert.equal((selected.json() as any).selection.selectedUid, 583104);
  assert.equal(completed.statusCode, 200);
  assert.equal((completed.json() as any).selection.status, "completed");
  assert.deepEqual(calls, [
    { action: "refresh", token: "confirmed-token" },
    { action: "select", token: "confirmed-token", uid: 583104 },
    { action: "complete", token: "confirmed-token" },
  ]);
});

test("login rate limit returns Retry-After without calling the provider", async () => {
  let calls = 0;
  const limitedApi = {
    ...authApi,
    async login() {
      calls += 1;
      return authApi.login();
    },
  };
  const server = buildServer({
    config,
    authApi: limitedApi,
    authRateLimiter: new AuthRateLimiter(config.AI_SECRET_MASTER_KEY, () => 0),
  });
  const request = {
    method: "POST",
    url: "/api/auth/login",
    headers: {
      origin: "https://knowledge.example.com",
      "x-forwarded-for": "203.0.113.8",
    },
    payload: { identifier: "583104", password: "wrong" },
  };
  await server.inject(request);
  await server.inject(request);
  const denied = await server.inject(request);

  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers["retry-after"], "900");
  assert.equal(calls, 2);
});

test("a forged forwarded address cannot bypass the login rate limit", async () => {
  const server = buildServer({
    config,
    authApi,
    authRateLimiter: new AuthRateLimiter(config.AI_SECRET_MASTER_KEY, () => 0),
  });
  const request = (forgedAddress: string) => server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: {
      origin: "https://knowledge.example.com",
      "x-forwarded-for": `${forgedAddress}, 203.0.113.10`,
    },
    payload: { identifier: "583104", password: "wrong" },
  });

  await request("198.51.100.1");
  await request("198.51.100.2");
  const denied = await request("198.51.100.3");

  assert.equal(denied.statusCode, 429);
});

test("auth routes reject unapproved origins", async () => {
  const server = buildServer({ config, authApi });
  const response = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "https://evil.example" },
    payload: { identifier: "583104", password: "secret" },
  });
  assert.equal(response.statusCode, 403);
});
