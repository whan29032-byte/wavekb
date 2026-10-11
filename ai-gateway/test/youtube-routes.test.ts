import assert from "node:assert/strict";
import test from "node:test";
import { youtubeRoute, type YouTubeRouteApi } from "../src/youtube/routes.ts";
import { buildServer } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";
import { YOUTUBE_POLICY_VERSION } from "../src/youtube/contracts.ts";

const acceptedPolicy = { privacyTermsAccepted: true, policyVersion: YOUTUBE_POLICY_VERSION } as const;

function fake() {
  const calls: unknown[][] = [];
  const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); return { success: true }; };
  const api: YouTubeRouteApi = { getConnection: record("get"), authorize: record("authorize"), callback: record("callback"), settings: record("settings"), importHistory: record("history"), disconnect: record("disconnect") };
  return { calls, api };
}
test("YouTube routes use only the authenticated actor, not request posting authority", async () => {
  const { api, calls } = fake();
  const response = await youtubeRoute(api, "verified-owner", "POST", "/v1/youtube/authorize", { ownerId: "attacker", channelId: "unverified", importHistory: true, autoSync: false, ...acceptedPolicy });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [["authorize", "verified-owner", { importHistory: true, autoSync: false, ...acceptedPolicy }]]);
  assert.equal(response.headers["cache-control"], "no-store");
});
test("authorize refuses absent, false, coerced and old policy consent without calling the service", async () => {
  const { api, calls } = fake();
  for (const consent of [{}, { privacyTermsAccepted: true }, { policyVersion: YOUTUBE_POLICY_VERSION },
    { privacyTermsAccepted: false, policyVersion: YOUTUBE_POLICY_VERSION },
    { privacyTermsAccepted: "true", policyVersion: YOUTUBE_POLICY_VERSION },
    { privacyTermsAccepted: 1, policyVersion: YOUTUBE_POLICY_VERSION },
    { privacyTermsAccepted: true, policyVersion: "2026-10-10-youtube-v0" }]) {
    const result = await youtubeRoute(api, "owner", "POST", "/v1/youtube/authorize", { importHistory: true, autoSync: false, ...consent });
    assert.equal(result.statusCode, 400);
    assert.deepEqual(result.body, { error: "youtube_policy_consent_required" });
  }
  assert.deepEqual(calls, []);
});
test("bad consent, callback and unlink inputs cause no service mutation", async () => {
  const { api, calls } = fake();
  const inputs = [
    ["authorize", { importHistory: "true", autoSync: true, ...acceptedPolicy }],
    ["callback", { code: "private-code", state: "bad" }],
    ["callback", { code: "x".repeat(2049), state: "a".repeat(43) }],
    ["settings", { syncEnabled: 1 }],
    ["disconnect", { confirmRemoveSyncedPosts: false }],
  ] as const;
  for (const [action, payload] of inputs) assert.equal((await youtubeRoute(api, "owner", "POST", `/v1/youtube/${action}`, payload)).statusCode, 400);
  assert.deepEqual(calls, []);
});
test("settings, history and confirmed disconnect remain available without authorize consent", async () => {
  const { api, calls } = fake();
  assert.equal((await youtubeRoute(api, "owner", "POST", "/v1/youtube/settings", { syncEnabled: false })).statusCode, 200);
  assert.equal((await youtubeRoute(api, "owner", "POST", "/v1/youtube/import-history", {})).statusCode, 202);
  assert.equal((await youtubeRoute(api, "owner", "POST", "/v1/youtube/disconnect", { confirmRemoveSyncedPosts: true })).statusCode, 200);
  assert.deepEqual(calls, [["settings", "owner", { syncEnabled: false }], ["history", "owner"], ["disconnect", "owner", { confirmRemoveSyncedPosts: true }]]);
});
test("only exact supported methods and paths are exposed", async () => {
  const { api, calls } = fake();
  assert.equal((await youtubeRoute(api, "owner", "GET", "/v1/youtube/callback", {})).statusCode, 404);
  assert.equal((await youtubeRoute(api, "owner", "POST", "/v1/youtube/arbitrary", {})).statusCode, 404);
  assert.equal((await youtubeRoute(undefined, "owner", "GET", "/v1/youtube/connection", {})).statusCode, 503);
  assert.equal((await youtubeRoute(api, "owner", "POST", "/v1/youtube/import-history", {})).statusCode, 202);
  assert.deepEqual(calls, [["history", "owner"]]);
});
test("integration errors are fixed codes and never echo tokens or provider data", async () => {
  const { api } = fake();
  api.getConnection = async () => { throw Object.assign(new Error("private-refresh-token user@example.com"), { status: 503 }); };
  const result = await youtubeRoute(api, "owner", "GET", "/v1/youtube/connection", {});
  assert.deepEqual(result.body, { error: "youtube_service_unavailable" });
  api.getConnection = async () => { throw { code: "youtube_reconnect_required", status: 409 }; };
  const reconnect = await youtubeRoute(api, "owner", "GET", "/v1/youtube/connection", {});
  assert.equal(reconnect.statusCode, 409);
  assert.deepEqual(reconnect.body, { error: "youtube_reconnect_required" });
  api.getConnection = async () => { throw { code: "quota_exceeded", message: "unsafe upstream text" }; };
  const quota = await youtubeRoute(api, "owner", "GET", "/v1/youtube/connection", {});
  assert.equal(quota.statusCode, 429);
  assert.deepEqual(quota.body, { error: "youtube_quota_exceeded" });
});

test("integrated Gateway authenticates owner and enforces the site origin before YouTube", async () => {
  const config = loadConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-longer-than-twenty", SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty", AI_SECRET_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"), AUTH_SITE_URL: "https://wavekb.example/", ALLOWED_WEB_ORIGINS: "https://wavekb.example" });
  const { api: youtubeApi, calls } = fake();
  const rows = async () => [];
  const object = async () => ({});
  const api = {
    authorize: async (token: string) => token === "valid-user" ? { id: "actual-owner", role: "user" } : null,
    listDirectoryResources: rows, createDirectoryResource: object, updateDirectoryResource: object,
    deleteDirectoryResource: async () => {}, deleteOwnPost: rows, dashboard: object,
    listProviders: rows, createProvider: object, listUserConnections: rows,
    createUserConnection: object, setDefaultUserConnection: object, rotateUserConnectionSecret: object,
    enqueueJob: object, getJob: object,
  };
  const server = buildServer({ config, api, youtubeApi });
  assert.equal((await server.inject({ url: "/v1/youtube/connection" })).statusCode, 401);
  assert.equal((await server.inject({ method: "POST", url: "/v1/youtube/authorize", headers: { authorization: "Bearer valid-user", origin: "https://evil.example" }, payload: { importHistory: true, autoSync: true } })).statusCode, 403);
  assert.deepEqual(calls, []);
  const refusal = await server.inject({ method: "POST", url: "/v1/youtube/authorize", headers: { authorization: "Bearer valid-user", origin: "https://wavekb.example" }, payload: { ownerId: "other-owner", importHistory: true, autoSync: true } });
  assert.equal(refusal.statusCode, 400);assert.deepEqual(refusal.json(), { error: "youtube_policy_consent_required" });assert.deepEqual(calls, []);
  const response = await server.inject({ method: "POST", url: "/v1/youtube/authorize", headers: { authorization: "Bearer valid-user", origin: "https://wavekb.example" }, payload: { ownerId: "other-owner", importHistory: true, autoSync: true, ...acceptedPolicy } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [["authorize", "actual-owner", { importHistory: true, autoSync: true, ...acceptedPolicy }]]);
});
