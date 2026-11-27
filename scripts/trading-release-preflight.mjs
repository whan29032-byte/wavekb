import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS = ["binance", "okx", "bybit", "bitget", "exness"];
const FLAG_BY_PROVIDER = {
  binance: "TRADING_PROVIDER_BINANCE_ENABLED",
  okx: "TRADING_PROVIDER_OKX_ENABLED",
  bybit: "TRADING_PROVIDER_BYBIT_ENABLED",
  bitget: "TRADING_PROVIDER_BITGET_ENABLED",
  exness: "TRADING_PROVIDER_EXNESS_ENABLED",
};
const SAFE_ORIGINS = {
  binance: new Set(["https://fapi.binance.com", "https://testnet.binancefuture.com"]),
  okx: new Set(["https://www.okx.com"]),
  bybit: new Set(["https://api.bybit.com"]),
  bitget: new Set(["https://api.bitget.com"]),
  exness: new Set(["https://my.exness.com"]),
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function strictBoolean(value, name) {
  invariant(typeof value === "boolean", `${name} must be a boolean`);
  return value;
}

function normalizedOrigin(value, provider) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${provider} origin is invalid`); }
  invariant(parsed.username === "" && parsed.password === "" && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "", `${provider} origin is unsafe`);
  const origin = parsed.origin;
  invariant(SAFE_ORIGINS[provider].has(origin), `${provider} origin is not approved`);
  return origin;
}

export function validateTradingRelease(input) {
  invariant(input && typeof input === "object", "release input is required");
  invariant(input.expectedSchemaVersion === "202611270002", "expected schema marker is invalid");
  invariant(input.schemaVersion === input.expectedSchemaVersion, "database schema is not current");
  invariant(/^[0-9a-f]{40}$/.test(input.releaseSha ?? ""), "release SHA is invalid");
  invariant(/^[0-9a-f]{40}$/.test(input.rollbackTarget ?? ""), "rollback target is invalid");
  const sameCodeRollback = strictBoolean(input.sameCodeRollback, "sameCodeRollback");
  invariant(sameCodeRollback === (input.releaseSha === input.rollbackTarget), "rollback mode does not match code state");

  const workbenchEnabled = strictBoolean(input.flags?.TRADING_WORKBENCH_V2_ENABLED, "TRADING_WORKBENCH_V2_ENABLED");
  const enabledProviders = PROVIDERS.filter((provider) => strictBoolean(input.flags?.[FLAG_BY_PROVIDER[provider]], FLAG_BY_PROVIDER[provider]));
  if (workbenchEnabled) invariant(enabledProviders.length > 0, "at least one provider must be enabled with the workbench");
  for (const provider of PROVIDERS) normalizedOrigin(input.providerOrigins?.[provider], provider);

  const lastRun = Date.parse(input.worker?.lastRunAt ?? "");
  const now = Number(input.now ?? Date.now());
  invariant(Number.isFinite(lastRun) && Number.isFinite(now), "worker timestamp is invalid");
  invariant(lastRun <= now && now - lastRun <= 30 * 60_000, "trading worker is stale");
  invariant(Number.isInteger(input.worker?.checked) && input.worker.checked >= 0, "worker checked counter is invalid");
  invariant(
    Number.isInteger(input.worker?.failed) && input.worker.failed >= 0 && input.worker.failed <= input.worker.checked,
    "worker failed counter is invalid",
  );

  return {
    schemaVersion: input.schemaVersion,
    workbenchEnabled,
    enabledProviders,
    rollbackTarget: input.rollbackTarget,
    sameCodeRollback,
    worker: {
      lastRunAt: new Date(lastRun).toISOString(),
      checked: input.worker.checked,
      failed: input.worker.failed,
    },
  };
}

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

export function inspectTradingReleaseFiles(root) {
  const migrationDirectory = path.join(root, "supabase", "migrations");
  const migrations = fs.readdirSync(migrationDirectory)
    .filter((name) => /^20261124000[12]_/.test(name))
    .sort();
  invariant(migrations.length === 2, "the two trading migrations must both be present");
  invariant(migrations[0] === "202611240001_multi_exchange_trade_review.sql", "multi-exchange migration order is invalid");
  invariant(migrations[1] === "202611240002_trade_review_ai.sql", "trade-review AI migration order is invalid");

  const migration = read(root, "supabase/migrations/202611240001_multi_exchange_trade_review.sql");
  const server = read(root, "ai-gateway/src/server.ts");
  const worker = read(root, "ai-gateway/src/trading-worker.ts");
  const legacyCompatibility = migration.includes("create_binance_exchange_connection_v2")
    && server.includes('path === "/v1/user/exchange-connection"')
    && server.includes('path === "/v1/user/exchange-connections"');
  invariant(legacyCompatibility, "legacy single-account compatibility routes are missing");
  const retentionMaintenance = migration.includes("purge_due_trading_data")
    && worker.includes('/rest/v1/rpc/purge_due_trading_data');
  invariant(retentionMaintenance, "retention maintenance is not wired to the worker");

  const readOnlyProviders = PROVIDERS.filter((provider) => {
    const source = read(root, `ai-gateway/src/trading/providers/${provider}.ts`);
    const forbidden = [
      /method:\s*["'](?:PUT|PATCH|DELETE)["']/i,
      /\/api\/v\d+\/(?:trade\/order|order\/create|order\/place)/i,
      /\b(?:place|create|submit|cancel)(?:Order|Trade)\b/,
    ];
    return forbidden.every((pattern) => !pattern.test(source));
  });
  invariant(readOnlyProviders.length === PROVIDERS.length, "a provider adapter contains a trading mutation surface");

  return { migrations, legacyCompatibility, retentionMaintenance, readOnlyProviders };
}

function envBoolean(name) {
  const value = process.env[name];
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be set to true or false`);
}

function runtimeInputFromEnv() {
  const flags = { TRADING_WORKBENCH_V2_ENABLED: envBoolean("TRADING_WORKBENCH_V2_ENABLED") };
  for (const name of Object.values(FLAG_BY_PROVIDER)) flags[name] = envBoolean(name);
  const releaseSha = process.env.TRADING_RELEASE_SHA;
  const rollbackTarget = process.env.TRADING_ROLLBACK_SHA;
  return {
    expectedSchemaVersion: "202611270002",
    schemaVersion: process.env.TRADING_SCHEMA_VERSION,
    releaseSha,
    rollbackTarget,
    sameCodeRollback: releaseSha === rollbackTarget,
    flags,
    providerOrigins: {
      binance: process.env.BINANCE_FUTURES_API_URL ?? "https://fapi.binance.com",
      okx: process.env.OKX_API_URL ?? "https://www.okx.com",
      bybit: process.env.BYBIT_API_URL ?? "https://api.bybit.com",
      bitget: process.env.BITGET_API_URL ?? "https://api.bitget.com",
      exness: process.env.EXNESS_API_URL ?? "https://my.exness.com",
    },
    worker: {
      lastRunAt: process.env.TRADING_WORKER_LAST_RUN_AT,
      checked: Number(process.env.TRADING_WORKER_CHECKED),
      failed: Number(process.env.TRADING_WORKER_FAILED),
    },
  };
}

function runtimeInputFromFile(file) {
  invariant(typeof file === "string" && file.length > 0, "runtime observation file is required");
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 32_768, "runtime observation file is unsafe");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const runtimeFileIndex = process.argv.indexOf("--runtime-file");
  let output;
  if (runtimeFileIndex !== -1) {
    invariant(process.argv.length === runtimeFileIndex + 2, "runtime mode accepts exactly one observation file");
    output = { runtime: validateTradingRelease(runtimeInputFromFile(process.argv[runtimeFileIndex + 1])) };
  } else {
    const root = path.resolve(import.meta.dirname, "..");
    const files = inspectTradingReleaseFiles(root);
    output = process.argv.includes("--static")
      ? { files }
      : { files, runtime: validateTradingRelease(runtimeInputFromEnv()) };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
