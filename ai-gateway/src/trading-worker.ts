import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { TradingProvider } from "@wavekb/domain/trading-review";
import { loadConfig, type GatewayConfig } from "./config.ts";
import { formatWorkerMetric } from "./worker-main.ts";
import { BinanceTradingProviderAdapter } from "./trading/providers/binance.ts";
import { BitgetTradingProviderAdapter } from "./trading/providers/bitget.ts";
import { BybitTradingProviderAdapter } from "./trading/providers/bybit.ts";
import { ExnessTradingProviderAdapter } from "./trading/providers/exness.ts";
import { OkxTradingProviderAdapter } from "./trading/providers/okx.ts";
import { createTradingProviderRegistry } from "./trading/providers/registry.ts";
import {
  SupabaseTradingSyncStore,
  TradingSyncService,
  type SyncBatchResult,
  type TradingSyncStore,
} from "./trading/sync-service.ts";

const allProviders: TradingProvider[] = ["binance", "okx", "bybit", "bitget", "exness"];

export function createTradingSyncService(
  config: GatewayConfig,
  dependencies: {
    store?: TradingSyncStore;
    enabledProviders?: readonly TradingProvider[];
    workerId?: string;
    now?: () => number;
  } = {},
) {
  const enabledProviders = dependencies.enabledProviders ?? allProviders;
  const adapters = createTradingProviderRegistry([
    new BinanceTradingProviderAdapter(config.BINANCE_FUTURES_API_URL),
    new OkxTradingProviderAdapter(),
    new BybitTradingProviderAdapter(),
    new BitgetTradingProviderAdapter(),
    new ExnessTradingProviderAdapter(),
  ], enabledProviders);
  return new TradingSyncService({
    store: dependencies.store ?? new SupabaseTradingSyncStore(config),
    adapters,
    enabledProviders: new Set(enabledProviders),
    workerId: dependencies.workerId ?? randomUUID(),
    identityKey: config.TRADING_ACCOUNT_HMAC_KEY,
    masterKey: config.AI_SECRET_MASTER_KEY,
    syncIntervalMs: config.TRADING_SYNC_MINUTES * 60_000,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
}

export async function runTradingSyncBatch(
  config: GatewayConfig,
  dependencies: Parameters<typeof createTradingSyncService>[1] = {},
  limit = 100,
): Promise<SyncBatchResult> {
  return createTradingSyncService(config, dependencies).syncDueConnections(limit);
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain) {
  const started = Date.now();
  const result = await runTradingSyncBatch(loadConfig(process.env));
  process.stdout.write(`${formatWorkerMetric("trading_sync", { ...result, duration_ms: Date.now() - started })}\n`);
}
