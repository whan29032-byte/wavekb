import assert from "node:assert/strict";
import test from "node:test";
import type { TradeChartProjection } from "@wavekb/domain/trading-review";
import { calculatePublicStrategyStudies } from "../src/trading/public-strategy-study-compute.ts";

const iso = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();

function projection(provider: TradeChartProjection["provider"] = "binance"): TradeChartProjection {
  const product = provider === "exness" ? "cfd" : "usdt_perpetual";
  const priceType = provider === "exness" ? "bid" : "trade";
  const symbol = provider === "exness" ? "XAUUSD" : "BTCUSDT";
  return {
    schema_version: "wavekb-trade-chart-projection-v1",
    cycle_id: "11111111-1111-4111-8111-111111111111",
    cycle_revision: 1, provider, product, symbol, native_symbol: symbol, direction: "long",
    timeframe: "1m", price_type: priceType, opened_at: iso(0), closed_at: iso(4),
    range: { from: iso(0), to: iso(5) }, markers: [], chart_state: null, warnings: [],
    coverage: { status: "complete", source: "public_api", fetched_at: iso(5), gaps: [], unavailable_reason: null },
    candles: Array.from({ length: 5 }, (_, minute) => ({
      provider, product, native_symbol: symbol, normalized_symbol: symbol, timeframe: "1m",
      series_basis: priceType, open_time: iso(minute), close_time: iso(minute + 1),
      open: String(100 + minute), high: String(101 + minute), low: String(99 + minute),
      close: String(100 + minute), volume: "20", source: "public_api",
      source_timestamp: iso(minute + 1), fetched_at: iso(5), status: "final", gap_before: false, gap_after: false,
    })),
  };
}

test("freezes real OpenAlgo study values at their candle times, including warmup nulls", async () => {
  const result = await calculatePublicStrategyStudies(projection(), [
    { instanceId: "private-sma", indicatorId: "sma", settings: { length: 3 } },
  ]);
  assert.deepEqual(result, [{
    instanceId: "private-sma",
    series: [{ points: [null, null, "101", "102", "103"].map((value, minute) => ({ time: iso(minute), value })) }],
  }]);
});

test("stores shifted Ichimoku values at their final plotted timestamps", async () => {
  const result = await calculatePublicStrategyStudies(projection(), [
    {
      instanceId: "private-ichimoku", indicatorId: "ichimoku",
      settings: { conversionPeriod: 1, basePeriod: 2, laggingSpanPeriod: 3, displacement: 1 },
    },
  ]);
  assert.deepEqual(result[0]?.series[3]?.points.map(({ value }) => value), [null, null, null, "101", "102"]);
  assert.deepEqual(result[0]?.series[4]?.points.map(({ value }) => value), ["101", "102", "103", "104", null]);
});

test("rejects a volume-dependent study when the source reports quote ticks", async () => {
  await assert.rejects(calculatePublicStrategyStudies(projection("exness"), [
    { instanceId: "private-vwap", indicatorId: "vwap" },
  ]), /public_strategy_indicator_unavailable/);
});
