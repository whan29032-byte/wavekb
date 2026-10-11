import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { SupabaseGatewayApi } from "../src/routes/gateway-api.ts";
import { buildServer } from "../src/server.ts";
import { decryptSecret, type EncryptedSecret } from "../src/secrets/crypto.ts";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "22222222-2222-4222-8222-222222222222";
const KEY = "test-only-api-key-never-a-real-credential";
const config = loadConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-role-test-only-long",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-only-long", AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com", ALLOWED_PROVIDER_HOSTS: "api.deepseek.com,192.168.1.10" });
const input = { name: "独立 DeepSeek", adapter: "openai_compatible", base_url: "https://api.deepseek.com/v1", api_key: KEY };
type Call = { path: string; method?: string; body?: unknown };
function fixture(options: { insertError?: unknown; secretError?: unknown; malformedRows?: unknown; enabled?: boolean } = {}) {
  const calls: Call[] = [];
  const database = {
    userForJwt: async (token: string) => token === "admin-token" ? { id: ACTOR } : null,
    request: async (path: string, request?: { method?: string; body?: unknown }) => {
      calls.push({ path, ...request });
      if (path.startsWith("/rest/v1/profiles?")) return [{ id: ACTOR, role: "admin", account_status: "active" }];
      if (path === "/rest/v1/ai_providers") {
        if (options.insertError) throw options.insertError;
        if ("malformedRows" in options) return options.malformedRows;
        return [{ id: PROVIDER, name: input.name, adapter: input.adapter, base_url: input.base_url, enabled: options.enabled ?? true }];
      }
      if (path === "/rest/v1/ai_provider_secrets") { if (options.secretError) throw options.secretError; return null; }
      if (path === `/rest/v1/ai_providers?id=eq.${PROVIDER}` && request?.method === "DELETE") return null;
      throw new Error("unexpected test database access");
    },
  };
  const api = new SupabaseGatewayApi(config, { database });
  const server = buildServer({ config, api });
  const save = (payload: unknown = input) => server.inject({ method: "POST", url: "/v1/admin/providers", headers: { authorization: "Bearer admin-token" }, payload });
  return { calls, api, server, save };
}
function safeResponse(response: { statusCode: number; body: string; json(): unknown }, status: number, code: string) {
  assert.equal(response.statusCode, status); assert.deepEqual(response.json(), { error: code });
  assert.doesNotMatch(response.body, /api\.deepseek|192\.168|\/private|database body|submitted-key|test-only-api-key|password|ciphertext/u);
}

test("admin provider URL validation exposes fixed diagnosable errors before any credential/database write", async () => {
  for (const base_url of ["not a URL", "http://api.deepseek.com/v1", "https://user:password@api.deepseek.com/v1",
    "javascript:alert(1)", "https://api.deepseek.com/v1?key=submitted-key", "https://api.deepseek.com/v1#private"]) {
    const f = fixture(); safeResponse(await f.save({ ...input, base_url }), 400, "invalid_provider_url");
    assert.equal(f.calls.filter((call) => call.method).length, 0);
  }
  for (const base_url of ["https://unapproved.example/v1", "http://127.0.0.1:1234", "https://192.168.1.10/v1"]) {
    const f = fixture(); safeResponse(await f.save({ ...input, base_url }), 403, "provider_host_not_allowed");
    assert.equal(f.calls.filter((call) => call.method).length, 0);
  }
});
test("admin provider field failures are safe and do not coerce nonstring credentials", async () => {
  for (const change of [{ name: "x" }, { name: "a".repeat(81) }, { adapter: "unknown" }]) {
    const f = fixture(); safeResponse(await f.save({ ...input, ...change }), 400, "invalid_request");
    assert.equal(f.calls.filter((call) => call.method).length, 0);
  }
  for (const api_key of [undefined, "", "   ", {}, "line\nprivate", "a".repeat(16_385)]) {
    const f = fixture(); safeResponse(await f.save({ ...input, api_key }), 400, "invalid_api_key");
    assert.equal(f.calls.filter((call) => call.method).length, 0);
  }
});
test("provider name conflicts and other insertion failures never echo PostgREST diagnostics", async () => {
  const detail = "database body /private submitted-key password";
  for (const error of [Object.assign(new Error(detail), { status: 409 }), Object.assign(new Error(detail), { code: "23505" })]) {
    const f = fixture({ insertError: error }); safeResponse(await f.save(), 409, "provider_name_conflict");
    assert.equal(f.calls.filter((call) => call.path === "/rest/v1/ai_provider_secrets").length, 0);
  }
  for (const error of [new Error(detail), Object.assign(new Error(detail), { status: 401 }), Object.assign(new Error(detail), { status: 500 })]) {
    const f = fixture({ insertError: error }); safeResponse(await f.save(), 502, "provider_save_failed");
  }
  for (const malformedRows of [null, [], [{ id: "/private" }]]) {
    const f = fixture({ malformedRows }); safeResponse(await f.save(), 502, "provider_save_failed");
  }
});
test("secret-save failures compensate the new provider and return no raw key/body, including secret conflicts", async () => {
  for (const status of [409, 500]) {
    const f = fixture({ secretError: Object.assign(new Error("database body /private submitted-key password"), { status }) });
    safeResponse(await f.save(), 502, "provider_save_failed");
    assert.equal(f.calls.filter((call) => call.method === "DELETE" && call.path === `/rest/v1/ai_providers?id=eq.${PROVIDER}`).length, 1);
  }
});
test("safe provider save encrypts the supplied key, preserves enabled semantics and does not call a model", async () => {
  for (const enabled of [true, false]) {
    const f = fixture({ enabled }); const response = await f.save();
    assert.equal(response.statusCode, 201);
    assert.deepEqual((response.json() as any).provider, { id: PROVIDER, name: input.name, adapter: input.adapter,
      base_url: input.base_url, enabled, last_four: KEY.slice(-4) });
    assert.equal(response.body.includes(KEY), false); assert.equal(response.body.includes("ciphertext"), false);
    const secret = f.calls.find((call) => call.path === "/rest/v1/ai_provider_secrets")!.body as EncryptedSecret & { provider_id: string };
    assert.equal(secret.provider_id, PROVIDER); assert.notEqual(secret.ciphertext, KEY);
    assert.equal(decryptSecret(secret, config.AI_SECRET_MASTER_KEY), KEY);
    assert.equal(f.calls.filter((call) => call.method === "POST").length, 2);
  }
});
test("v3 enqueue image binding failures survive the server safe error projection", async () => {
  const f = fixture();
  const server = buildServer({ config, api: Object.assign(Object.create(f.api), {
    enqueueJob: async () => { throw Object.assign(new Error("invalid_image_input"), { statusCode: 409 }); },
  }) });
  safeResponse(await server.inject({ method: "POST", url: `/v1/analyses/${PROVIDER}/ai-run`,
    headers: { authorization: "Bearer admin-token" }, payload: {} }), 409, "invalid_image_input");
});
