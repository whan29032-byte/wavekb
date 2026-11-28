import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = path.resolve(import.meta.dirname, "..");
const gatewayRequire = createRequire(new URL("../ai-gateway/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml");
const backendWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-backend-production.yml", import.meta.url), "utf8"));
const packageStep = backendWorkflow.jobs["migrate-and-deploy"].steps.find((step) => /Package immutable gateway release/.test(step.name));
const release = "a".repeat(40);

async function checkPackagedGateway(cwd) {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd,
    env: {
      SystemRoot: process.env.SystemRoot,
      PORT: String(port),
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key-123",
      SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key-123",
      AUTH_SITE_URL: "https://example.test",
      AI_SECRET_MASTER_KEY: Buffer.alloc(32, 5).toString("base64"),
      TRADING_FILL_CHART_ENABLED: "true",
      TRADING_FILL_CHART_PILOT_UIDS: "12345",
      TRADING_PUBLIC_STRATEGIES_ENABLED: "true",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    let response;
    const expires = Date.now() + 8000;
    for (; !response && child.exitCode === null && Date.now() < expires;) {
      response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }).catch(() => undefined);
      if (!response) await delay(100);
    }
    assert.ok(response, `The unpacked production gateway never answered /health:\n${stderr}`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.deployment, release);
    assert.equal(health.features.trading_fill_chart_pilot, true);
    assert.equal(health.features.trading_fill_chart, false);
  } finally {
    child.kill();
    await closed;
  }
}

test("the backend archive starts outside checkout with all four books and no PDFs or secrets", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-gateway-package-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const gateway = path.join(directory, "ai-gateway");
  fs.mkdirSync(gateway, { recursive: true });
  fs.cpSync(path.join(repoRoot, "ai-gateway", "package.json"), path.join(gateway, "package.json"));
  fs.cpSync(path.join(repoRoot, "ai-gateway", "src"), path.join(gateway, "src"), { recursive: true });
  fs.mkdirSync(path.join(gateway, "node_modules"));
  const charts = path.dirname(path.dirname(gatewayRequire.resolve("openalgo-charts")));
  fs.symlinkSync(charts, path.join(gateway, "node_modules/openalgo-charts"), process.platform === "win32" ? "junction" : "dir");
  const domain = path.join(directory, "packages/domain/src");
  fs.mkdirSync(domain, { recursive: true });
  for (const entry of ["community.ts", "trading-review.ts"]) {
    fs.copyFileSync(path.join(repoRoot, "packages/domain/src", entry), path.join(domain, entry));
  }
  fs.mkdirSync(path.join(directory, "scripts"));
  for (const name of ["trading-release-preflight.mjs", "package-gateway-release.mjs"]) {
    fs.cpSync(path.join(repoRoot, "scripts", name), path.join(directory, "scripts", name));
  }
  fs.mkdirSync(path.join(gateway, "knowledge"));
  fs.cpSync(
    path.join(repoRoot, "ai-gateway", "knowledge", "retrieval-index.json"),
    path.join(gateway, "knowledge", "retrieval-index.json"),
  );
  fs.writeFileSync(path.join(gateway, ".env"), "AI_SECRET_MASTER_KEY=must-not-ship\n");
  fs.writeFileSync(path.join(gateway, "knowledge", "source.pdf"), "must-not-ship");

  const packaged = spawnSync("bash", ["-c", packageStep.run], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_SHA: release },
  });
  assert.equal(packaged.status, 0, packaged.stderr);

  const listed = spawnSync("tar", ["-tzf", "wavekb-gateway.tar.gz"], { cwd: directory, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const entries = listed.stdout.split(/\r?\n/);
  for (const expected of ["package.json", "src/", "knowledge/retrieval-index.json", "DEPLOYMENT_VERSION", "release-preflight.mjs", "node_modules/@wavekb/domain/trading-review.js", "node_modules/openalgo-charts/dist/openalgo-charts.indicators.mjs", "node_modules/openalgo-charts/LICENSE"]) {
    assert.ok(entries.some((entry) => entry === expected || entry.startsWith(expected)), `${expected} must be packaged`);
  }
  assert.ok(!entries.some((entry) => /\.pdf$/i.test(entry)), "source PDFs must not be packaged");
  assert.ok(!entries.some((entry) => /(^|\/)\.env(?:\.|$)/.test(entry)), "environment secrets must not be packaged");

  const extracted = path.join(directory, "extracted");
  fs.mkdirSync(extracted);
  const unpacked = spawnSync("tar", ["-xzf", path.join(directory, "wavekb-gateway.tar.gz"), "-C", extracted], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  await checkPackagedGateway(extracted);

  const studies = spawnSync(process.execPath, [
    "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { calculatePublicStrategyStudies } from "./src/trading/public-strategy-study-compute.ts";

      const candles = ["1", "2", "3"].map((close, index) => ({
        series_basis: "trade", status: "final", volume: "1",
        open_time: new Date(1760000000000 + index * 60000).toISOString(),
        close_time: new Date(1760000000000 + (index + 1) * 60000).toISOString(),
        open: close, high: close, low: close, close,
      }));
      const studies = await calculatePublicStrategyStudies({
        provider: "binance", symbol: "BTCUSDT", timeframe: "1m", price_type: "trade", candles,
      }, [{ instanceId: "sma", indicatorId: "sma", settings: { length: 3 } }]);
      assert.deepEqual(studies[0].series[0].points.map(({ value }) => value), [null, null, "2"]);
    `,
  ], { cwd: extracted, encoding: "utf8", timeout: 10_000 });
  assert.equal(studies.status, 0, studies.stderr);
  const smoke = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'import { buildKnowledgeIndex } from "./src/knowledge/index.ts"; import { MembershipWalletWorker } from "./src/membership-wallet-worker.ts"; import { KnowledgeRuntime } from "./src/knowledge/runtime.ts"; import { buildWaveChart, assertWaveChart } from "./src/research/wave-chart.ts"; import { runTradingMaintenance } from "./src/trading-worker.ts"; import { runDiscordGameSettlement } from "./src/discord-game-settlement-worker.ts"; import { createExchangeConnectionService } from "./src/trading/connection-service.ts"; if(typeof runTradingMaintenance!=="function"||typeof runDiscordGameSettlement!=="function"||typeof createExchangeConnectionService!=="function")process.exit(3); const index = buildKnowledgeIndex(); if (index.books.length !== 4 || index.books[0].bookId !== "elliott-wave-principle-eleventh-edition") process.exit(1); const db={request:async()=>{throw new Error("disabled must not claim")}}; new KnowledgeRuntime({database:db}); const chart=buildWaveChart({instrument:"BTCUSDT",primary_timeframe:"4h",step_data:{6:{direction:"up",w1_start:100,w1_end:120,w2_end:110}}},{step:6}); assertWaveChart(chart); if(chart.scenarios[0].max_retracement.amount!==10)process.exit(2); await new MembershipWalletWorker({database:db,env:{},workerId:"package-smoke"}).run();',
  ], { cwd: extracted, encoding: "utf8" });
  assert.equal(smoke.status, 0, smoke.stderr);
});
