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
  const config = loadConfig({ ...baseEnv, TRADING_WORKBENCH_V2_ENABLED: "true" });
  const server = buildServer({ config, now: () => new Date("2026-07-26T00:00:00Z") });
  const response = await server.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(Object.hasOwn(response.json() as object, "deployment"), true);
  assert.deepEqual((response.json() as { features: unknown }).features, {
    trading_workbench_v2: true,
    trading_fill_chart: false,
  });
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

test("private research defaults off and requires an explicit strict boolean", () => {
  assert.equal(loadConfig(baseEnv).HERMES_PRIVATE_RESEARCH_ENABLED, false);
  assert.equal(loadConfig({ ...baseEnv, HERMES_PRIVATE_RESEARCH_ENABLED: "true" }).HERMES_PRIVATE_RESEARCH_ENABLED, true);
  assert.equal(loadConfig({ ...baseEnv, HERMES_PRIVATE_RESEARCH_ENABLED: "false" }).HERMES_PRIVATE_RESEARCH_ENABLED, false);
  for (const invalid of ["1", "TRUE", "yes"]) {
    assert.throws(() => loadConfig({ ...baseEnv, HERMES_PRIVATE_RESEARCH_ENABLED: invalid }), /invalid boolean/);
  }
});

test("trading cutover and each provider use strict independent booleans", () => {
  const defaults = loadConfig(baseEnv);
  assert.equal(defaults.TRADING_WORKBENCH_V2_ENABLED, false);
  for (const key of [
    "TRADING_PROVIDER_BINANCE_ENABLED",
    "TRADING_PROVIDER_OKX_ENABLED",
    "TRADING_PROVIDER_BYBIT_ENABLED",
    "TRADING_PROVIDER_BITGET_ENABLED",
    "TRADING_PROVIDER_EXNESS_ENABLED",
  ] as const) assert.equal(defaults[key], false, key);
  const enabled = loadConfig({ ...baseEnv,
    TRADING_WORKBENCH_V2_ENABLED: "true", TRADING_PROVIDER_BINANCE_ENABLED: "true",
    TRADING_PROVIDER_OKX_ENABLED: "true", TRADING_PROVIDER_BYBIT_ENABLED: "true",
    TRADING_PROVIDER_BITGET_ENABLED: "true", TRADING_PROVIDER_EXNESS_ENABLED: "true" });
  assert.equal(enabled.TRADING_WORKBENCH_V2_ENABLED, true);
  assert.equal(enabled.TRADING_PROVIDER_EXNESS_ENABLED, true);
  assert.throws(() => loadConfig({ ...baseEnv, TRADING_PROVIDER_OKX_ENABLED: "yes" }), /invalid boolean/);
});

test("fill chart rollout defaults off and publishes only a strict boolean", async () => {
  assert.equal(loadConfig(baseEnv).TRADING_FILL_CHART_ENABLED, false);
  assert.equal(loadConfig({ ...baseEnv, TRADING_FILL_CHART_ENABLED: "false" }).TRADING_FILL_CHART_ENABLED, false);
  assert.throws(() => loadConfig({ ...baseEnv, TRADING_FILL_CHART_ENABLED: "yes" }), /invalid boolean/);
  const config = loadConfig({ ...baseEnv, TRADING_FILL_CHART_ENABLED: "true" });
  const server = buildServer({ config });
  try {
    const response = await server.inject({ method: "GET", url: "/health" });
    assert.equal((response.json() as { features: { trading_fill_chart: boolean } }).features.trading_fill_chart, true);
  } finally {
    await server.close();
  }
});
