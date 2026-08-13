import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
};

test("gateway refuses to start without a 32-byte master key", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, AI_SECRET_MASTER_KEY: "short" }),
    /32-byte/,
  );
});

test("gateway never exposes server secrets in health response", async () => {
  const config = loadConfig(baseEnv);
  const server = buildServer({ config, now: () => new Date("2026-07-26T00:00:00Z") });
  const response = await server.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("server-role-key"), false);
  assert.equal(response.body.includes(config.AI_SECRET_MASTER_KEY.toString("base64")), false);
  await server.close();
});

test("gateway validates UID auth limits and site URL", () => {
  const config = loadConfig({
    ...baseEnv,
    AUTH_LOGIN_LIMIT_PER_15_MINUTES: "8",
    AUTH_UID_ACTION_LIMIT_PER_HOUR: "12",
    AUTH_FEATURE_ENABLED: "true",
  });
  assert.equal(config.AUTH_LOGIN_LIMIT_PER_15_MINUTES, 8);
  assert.equal(config.AUTH_UID_ACTION_LIMIT_PER_HOUR, 12);
  assert.equal(config.AUTH_FEATURE_ENABLED, true);
  assert.throws(
    () => loadConfig({ ...baseEnv, AUTH_SITE_URL: "not-a-url" }),
    /AUTH_SITE_URL/,
  );
});
