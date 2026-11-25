import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  inspectTradingReleaseFiles,
  validateTradingRelease,
} from "../scripts/trading-release-preflight.mjs";

const sha = "1".repeat(40);
const rollback = "2".repeat(40);
const now = Date.parse("2026-11-24T12:00:00Z");
const flags = {
  TRADING_WORKBENCH_V2_ENABLED: true,
  TRADING_PROVIDER_BINANCE_ENABLED: true,
  TRADING_PROVIDER_OKX_ENABLED: true,
  TRADING_PROVIDER_BYBIT_ENABLED: true,
  TRADING_PROVIDER_BITGET_ENABLED: true,
  TRADING_PROVIDER_EXNESS_ENABLED: true,
};
const hosts = {
  binance: "https://fapi.binance.com",
  okx: "https://www.okx.com",
  bybit: "https://api.bybit.com",
  bitget: "https://api.bitget.com",
  exness: "https://my.exness.com",
};

function release(overrides = {}) {
  return {
    expectedSchemaVersion: "202611250001",
    schemaVersion: "202611250001",
    releaseSha: sha,
    rollbackTarget: rollback,
    sameCodeRollback: false,
    flags,
    providerOrigins: hosts,
    worker: { lastRunAt: "2026-11-24T11:55:00Z", checked: 5, failed: 0 },
    now,
    ...overrides,
  };
}

test("accepts a current reversible release and emits only safe operational fields", () => {
  const result = validateTradingRelease(release({ secrets: { api_key: "must-not-leak" } }));
  assert.deepEqual(result.enabledProviders, ["binance", "okx", "bybit", "bitget", "exness"]);
  assert.equal(result.workbenchEnabled, true);
  assert.equal(result.schemaVersion, "202611250001");
  assert.equal(result.rollbackTarget, rollback);
  assert.equal(result.sameCodeRollback, false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|api_key|secret/i);
});

test("accepts an explicit same-code configuration rollback target", () => {
  const result = validateTradingRelease(release({ rollbackTarget: sha, sameCodeRollback: true }));
  assert.equal(result.rollbackTarget, sha);
  assert.equal(result.sameCodeRollback, true);
});

test("allows one provider or the total workbench to be disabled for rollback", () => {
  const partial = validateTradingRelease(release({ flags: { ...flags, TRADING_PROVIDER_EXNESS_ENABLED: false } }));
  assert.equal(partial.enabledProviders.includes("exness"), false);
  const fallback = validateTradingRelease(release({ flags: { ...flags, TRADING_WORKBENCH_V2_ENABLED: false } }));
  assert.equal(fallback.workbenchEnabled, false);
});

test("accepts isolated account failures from a completed worker run as degraded", () => {
  const result = validateTradingRelease(release({
    worker: { lastRunAt: "2026-11-24T11:55:00Z", checked: 5, failed: 1 },
  }));
  assert.deepEqual(result.worker, {
    lastRunAt: "2026-11-24T11:55:00.000Z",
    checked: 5,
    failed: 1,
  });
});

test("fails closed on schema drift, unsafe origins, stale workers and invalid rollback state", () => {
  const invalid = [
    release({ schemaVersion: "202611240001" }),
    release({ providerOrigins: { ...hosts, okx: "http://attacker.invalid" } }),
    release({ worker: { lastRunAt: "2026-11-24T10:00:00Z", checked: 5, failed: 0 } }),
    release({ worker: { lastRunAt: "2026-11-24T11:55:00Z", checked: 5, failed: -1 } }),
    release({ worker: { lastRunAt: "2026-11-24T11:55:00Z", checked: 5, failed: 6 } }),
    release({ rollbackTarget: sha }),
    release({ sameCodeRollback: true }),
    release({ flags: { ...flags, TRADING_PROVIDER_OKX_ENABLED: "yes" } }),
  ];
  for (const value of invalid) assert.throws(() => validateTradingRelease(value));
});

test("repository preflight enforces migration order, compatibility routes, retention and read-only adapters", () => {
  const result = inspectTradingReleaseFiles(path.resolve(import.meta.dirname, ".."));
  assert.deepEqual(result.migrations, ["202611240001_multi_exchange_trade_review.sql", "202611240002_trade_review_ai.sql"]);
  assert.equal(result.legacyCompatibility, true);
  assert.equal(result.retentionMaintenance, true);
  assert.deepEqual(result.readOnlyProviders, ["binance", "okx", "bybit", "bitget", "exness"]);
});

test("packaged runtime mode validates a bounded safe observation file without repository files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-trading-preflight-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "runtime.json");
  fs.writeFileSync(input, JSON.stringify(release()), { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    path.resolve(import.meta.dirname, "../scripts/trading-release-preflight.mjs"),
    "--runtime-file",
    input,
  ], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.runtime.enabledProviders, ["binance", "okx", "bybit", "bitget", "exness"]);
  assert.equal(Object.hasOwn(output, "files"), false);
});
