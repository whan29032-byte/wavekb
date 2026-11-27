import { expect, test, type Page } from "@playwright/test";
import type { ChartStateV1, TradeChartProjection } from "@wavekb/domain/trading-review";

async function openChart(page: Page, story: string) {
  await page.goto(`/iframe.html?id=workbench-trade-chart-fill-level--${story}&viewMode=story`);
  await expect(page.getByRole("heading", { name: "逐笔成交图表" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[aria-label='成交 K 线图'] canvas").first()).toBeVisible({ timeout: 15_000 });
  return page.getByRole("list", { name: "逐笔成交" });
}

test("the dense chart lists every fill and opens the selected memo by keyboard", async ({ page }) => {
  const fills = await openChart(page, "dense-fills");
  const rows = fills.getByRole("button");
  await expect(rows).toHaveCount(20);
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "成交备忘录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "同 K 线成交（8 笔）" })).toBeVisible();
});

test("gap and reversal facts remain readable at phone size and after rotation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fills = await openChart(page, "missing-candles");
  await expect(fills.getByRole("button")).toHaveCount(3);
  await expect(fills.getByText("该成交位于行情缺口，未附着到 K 线。")).toBeVisible();
  await page.getByText(/行情缺口（1 段，UTC）/).click();
  await expect(page.getByText("2026-11-01T00:05:00.000Z", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

  await page.setViewportSize({ width: 844, height: 390 });
  const reversed = await openChart(page, "reversal");
  await expect(reversed.getByRole("button")).toHaveCount(4);
  await expect(reversed.getByRole("button", { name: /反手新开/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(845);
});

const cycleId = "11111111-1111-4111-8111-111111111111";
const base = Date.parse("2026-11-01T00:00:00.000Z");
const time = (index: number) => new Date(base + index * 60_000).toISOString();

function chartFixture(candleCount: number): TradeChartProjection {
  return {
    schema_version: "wavekb-trade-chart-projection-v1",
    cycle_id: cycleId, cycle_revision: 1, symbol: "BTCUSDT", native_symbol: "BTCUSDT",
    provider: "binance", product: "usdt_perpetual", direction: "long",
    opened_at: time(1), closed_at: time(candleCount - 8), range: { from: time(0), to: time(candleCount) },
    timeframe: "1m", price_type: "trade", markers: [], warnings: [], chart_state: null,
    coverage: { status: "complete", source: "public_api", fetched_at: time(candleCount), gaps: [], unavailable_reason: null },
    candles: Array.from({ length: candleCount }, (_, index) => ({
      provider: "binance", product: "usdt_perpetual", native_symbol: "BTCUSDT", normalized_symbol: "BTCUSDT",
      timeframe: "1m", series_basis: "trade", open_time: time(index), close_time: time(index + 1),
      open: String(70_000 + index * 8), high: String(70_018 + index * 8),
      low: String(69_985 + index * 8), close: String(70_006 + index * 8), volume: "120",
      source: "public_api", source_timestamp: time(index + 1), fetched_at: time(candleCount),
      status: "final", gap_before: false, gap_after: false,
    })),
  };
}

test("renders the maximum 3,000-candle projection in Chromium", async ({ page }, info) => {
  await page.route("**/api/trading/trades/*/chart?*", (route) => route.fulfill({ json: { chart: chartFixture(3_000) } }));
  const start = performance.now();
  await openChart(page, "layout-persistence");
  const observedMilliseconds = Math.round(performance.now() - start);
  await info.attach("Time from navigation until Chromium chart visibility", {
    body: JSON.stringify({ candles: 3_000, observedMilliseconds }),
    contentType: "application/json",
  });
});

test("SMA, Fibonacci and Elliott drawings save through the chart endpoint and reappear after reload", async ({ page }) => {
  let saved: ChartStateV1 | null = null;
  const chart = chartFixture(40);
  await page.route("**/api/trading/trades/*/chart?*", (route) =>
    route.fulfill({ json: { chart: { ...chart, chart_state: saved } } }));
  await page.route("**/api/trading/trades/*/chart-state", async (route) => {
    const { expected_version, expected_updated_at, ...input } = route.request().postDataJSON();
    expect(expected_version).toBe(saved?.version ?? 0);
    expect(expected_updated_at).toBe(saved?.updated_at ?? null);
    saved = { ...input, cycle_id: cycleId, version: expected_version + 1, updated_at: time(41 + expected_version) };
    await route.fulfill({ json: { chart_state: saved } });
  });

  await openChart(page, "layout-persistence");
  await page.getByText("指标", { exact: true }).click();
  await page.getByLabel("搜索指标").fill("SMA");
  await page.getByRole("button", { name: "添加 SMA" }).click();
  await page.getByText("画线", { exact: true }).click();
  await page.getByLabel("搜索画线工具").fill("斐波那契回撤");
  const fibonacci = page.getByRole("button", { name: "斐波那契回撤", exact: true });
  await fibonacci.click();
  await expect(fibonacci).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator("[aria-label='成交 K 线图']").first();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The chart is not visible");
  await canvas.click({ position: { x: Math.floor(bounds.width * 0.22), y: 135 } });
  await canvas.click({ position: { x: Math.floor(bounds.width * 0.45), y: 210 } });

  await expect.poll(() => (saved as ChartStateV1 | null)?.drawings.map((drawing) => drawing.tool)).toEqual(["fib-retracement"]);
  await expect.poll(() => (saved as ChartStateV1 | null)?.indicators.map((indicator) => indicator.indicatorId)).toEqual(["sma"]);
  await page.getByLabel("搜索画线工具").fill("艾略特调整浪");
  const elliott = page.getByRole("button", { name: "艾略特调整浪", exact: true });
  await elliott.click();
  await expect(elliott).toHaveAttribute("aria-pressed", "true");
  for (const [fraction, y] of [[0.18, 250], [0.30, 195], [0.42, 225], [0.58, 150]] as const) {
    await canvas.click({ position: { x: Math.floor(bounds.width * fraction), y } });
  }
  await expect.poll(() => (saved as ChartStateV1 | null)?.drawings.map(({ tool }) => tool).sort())
    .toEqual(["elliott-correction", "fib-retracement"]);
  await page.reload();
  await page.getByText("图表对象", { exact: true }).click();
  await expect(page.getByRole("button", { name: "移除 SMA 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "隐藏 斐波那契回撤 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "隐藏 艾略特调整浪 1" })).toBeVisible();
});
