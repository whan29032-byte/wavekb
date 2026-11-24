import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import {
  configuredTradingProviders,
  runTradingMaintenance,
  type TradingMaintenanceStore,
} from "../src/trading-worker.ts";
import type { TradingSyncStore } from "../src/trading/sync-service.ts";

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
};

test("provider flags select sync adapters independently", () => {
  assert.deepEqual(configuredTradingProviders(loadConfig(baseEnv)), []);
  const config = loadConfig({
    ...baseEnv,
    TRADING_PROVIDER_BINANCE_ENABLED: "true",
    TRADING_PROVIDER_BYBIT_ENABLED: "true",
  });
  assert.deepEqual(configuredTradingProviders(config), ["binance", "bybit"]);
});

test("provider sync flags can be staged before the workbench cutover", () => {
  const config = loadConfig({ ...baseEnv, TRADING_PROVIDER_OKX_ENABLED: "true" });
  assert.equal(config.TRADING_WORKBENCH_V2_ENABLED, false);
  assert.deepEqual(configuredTradingProviders(config), ["okx"]);
});

test("a maintenance batch always purges due private data after synchronization", async () => {
  const config = loadConfig({
    ...baseEnv,
    TRADING_WORKBENCH_V2_ENABLED: "true",
    TRADING_PROVIDER_BINANCE_ENABLED: "true",
  });
  const observed: { providers?: string[]; purgeAt?: string } = {};
  const store = {
    async listDueConnections(_limit: number, _cutoff: string, providers: ReadonlySet<string>) {
      observed.providers = [...providers];
      return [];
    },
  } as unknown as TradingSyncStore;
  const maintenanceStore: TradingMaintenanceStore = {
    async purgeDue(value) {
      observed.purgeAt = value;
      return 3;
    },
  };

  const result = await runTradingMaintenance(config, {
    store,
    maintenanceStore,
    now: () => Date.parse("2026-11-24T12:00:00.000Z"),
  });

  assert.deepEqual(result, { checked: 0, published: 0, skipped: 0, failed: 0, purged: 3 });
  assert.deepEqual(observed.providers, ["binance"]);
  assert.equal(observed.purgeAt, "2026-11-24T12:00:00.000Z");
});
