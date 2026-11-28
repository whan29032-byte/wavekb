import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

async function freePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("test_port_unavailable");
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

test("real HTTP enforces the chart raw-byte limit, preserves the AI limit, and copies failure security headers", async () => {
  const config = loadConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
    AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
    AUTH_SITE_URL: "https://knowledge.example.com/",
    ALLOWED_WEB_ORIGINS: "https://knowledge.example.com",
    TRADING_FILL_CHART_ENABLED: "true",
  });
  let chartSaves = 0;
  let aiEnqueues = 0;
  let failChartSave = false;
  const server = buildServer({
    config,
    api: {
      async authorize(token: string) {
        return token === "user-token" ? { id: "user-1", role: "user" } : null;
      },
      async enqueueJob() {
        aiEnqueues += 1;
        return { id: "job-1", status: "queued" };
      },
    } as any,
    tradingWorkbench: {
      async saveChartState() {
        chartSaves += 1;
        if (failChartSave) {
          throw Object.assign(new Error("invalid_trade_chart_request"), { statusCode: 400 });
        }
        return { version: 1 };
      },
    } as any,
  });
  const port = await freePort();
  await server.listen({ port, host: "127.0.0.1" });
  const headers = {
    authorization: "Bearer user-token",
    "content-type": "application/json",
    origin: "https://knowledge.example.com",
  };
  const compact = JSON.stringify({ schema_version: "wavekb-trade-chart-v1" });
  const padded = compact + " ".repeat(40_980 - Buffer.byteLength(compact));
  try {
    const oversizedChart = await fetch(
      `http://127.0.0.1:${port}/v1/user/trading-trades/33333333-3333-4333-8333-333333333333/chart-state`,
      { method: "PUT", headers, body: padded },
    );
    assert.equal(oversizedChart.status, 413);
    assert.deepEqual(await oversizedChart.json(), { error: "request_too_large" });
    assert.equal(chartSaves, 0, "oversized chart JSON must be rejected before parsing or saving");

    const largeAiRun = await fetch(`http://127.0.0.1:${port}/v1/analyses/a1/ai-run`, {
      method: "POST",
      headers,
      body: padded,
    });
    assert.equal(largeAiRun.status, 202);
    assert.equal(aiEnqueues, 1, "the general AI payload limit must not be reduced to 32 KiB");

    failChartSave = true;
    const failedChart = await fetch(
      `http://127.0.0.1:${port}/v1/user/trading-trades/33333333-3333-4333-8333-333333333333/chart-state`,
      { method: "PUT", headers, body: "{}" },
    );
    assert.equal(failedChart.status, 400);
    assert.deepEqual(await failedChart.json(), { error: "invalid_trade_chart_request" });
    assert.equal(failedChart.headers.get("cache-control"), "no-store");
    assert.equal(failedChart.headers.get("pragma"), "no-cache");
    assert.equal(failedChart.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await server.close();
  }
});
