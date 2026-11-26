import assert from "node:assert/strict";
import test from "node:test";
import type { TradeChartProjection } from "@wavekb/domain/trading-review";
import {
  assertChartStateV1,
  assertTradeChartProjection,
} from "../src/trading/chart-contracts.ts";

const validDrawing = {
  id: "line-1",
  tool: "trend-line" as const,
  points: [{ time: 1_795_520_280_000, price: 60000 }],
  style: { color: "#2962ff", lineWidth: 2, lineStyle: "solid" as const },
  paneIndex: 0,
  zIndex: 1,
};

function validProjection(): TradeChartProjection {
  return {
    schema_version: "wavekb-trade-chart-projection-v1",
    cycle_id: "11111111-1111-4111-8111-111111111111",
    cycle_revision: 2,
    provider: "binance",
    product: "usdt_perpetual",
    symbol: "BTC/USDT",
    native_symbol: "BTCUSDT",
    direction: "long",
    opened_at: "2026-11-24T07:58:30.000Z",
    closed_at: "2026-11-24T07:59:30.000Z",
    timeframe: "1m",
    price_type: "trade",
    range: {
      from: "2026-11-24T07:58:00.000Z",
      to: "2026-11-24T08:00:00.000Z",
    },
    candles: [{
      provider: "binance",
      product: "usdt_perpetual",
      native_symbol: "BTCUSDT",
      normalized_symbol: "BTC/USDT",
      timeframe: "1m",
      price_basis: "trade",
      open_time: "2026-11-24T07:58:00.000Z",
      close_time: "2026-11-24T07:59:00.000Z",
      open: "60000.000000000000000001",
      high: "60100.000000000000000001",
      low: "59900.000000000000000001",
      close: "60050.000000000000000001",
      volume: "123.000000000000000001",
      source: "public_api",
      source_timestamp: "2026-11-24T07:59:01.000Z",
      fetched_at: "2026-11-24T08:00:00.000Z",
      status: "final",
      gap_before: false,
      gap_after: false,
    }],
    markers: [{
      marker_key: "fill-1",
      fill_id: "900719925474099312345",
      occurred_at: "2026-11-24T07:58:30.000Z",
      price: "60000.000000000000000001",
      allocated_quantity: "0.000000000000000001",
      allocation_role: "open",
      sort_order: 0,
      side: "buy",
      position_side: "long",
      liquidity: "taker",
      provider_fill_id_mask: "••••a1b2",
      annotation: null,
    }],
    chart_state: {
      schema_version: "wavekb-trade-chart-v1",
      cycle_id: "11111111-1111-4111-8111-111111111111",
      cycle_revision: 2,
      timeframe: "1m",
      price_type: "trade",
      viewport: { from: 1_795_520_280_000, to: 1_795_520_400_000 },
      indicators: [{ instanceId: "rsi-1", indicatorId: "rsi", settings: { length: 14, source: "close" }, paneIndex: 1 }],
      drawings: [validDrawing],
      version: 3,
      updated_at: "2026-11-24T08:00:00.000Z",
    },
    coverage: {
      status: "complete",
      source: "public_api",
      fetched_at: "2026-11-24T08:00:00.000Z",
      gaps: [],
      unavailable_reason: null,
    },
    warnings: [],
  };
}

test("validates a versioned chart state and projection without rounding decimals", () => {
  const projection = validProjection();
  assert.equal(assertTradeChartProjection(projection), projection);
  assert.equal(assertChartStateV1(projection.chart_state), projection.chart_state);
  assert.equal(projection.markers[0]?.fill_id, "900719925474099312345");
  assert.equal(projection.candles[0]?.open, "60000.000000000000000001");
});

test("rejects unknown indicator settings and unsafe or unsupported drawings", () => {
  const unknownSetting = structuredClone(validProjection().chart_state) as Record<string, any>;
  unknownSetting.indicators[0].settings.callback = "alert(1)";
  assert.throws(() => assertChartStateV1(unknownSetting), /trade_chart_invalid_indicator_settings/);

  const unknownTool = structuredClone(validProjection().chart_state) as Record<string, any>;
  unknownTool.drawings[0].tool = "execute-script";
  assert.throws(() => assertChartStateV1(unknownTool), /trade_chart_invalid_drawing_tool/);

  const unsafeText = structuredClone(validProjection().chart_state) as Record<string, any>;
  unsafeText.drawings[0] = { ...validDrawing, id: "text-1", tool: "text", text: { value: "<script>alert(1)</script>" } };
  assert.throws(() => assertChartStateV1(unsafeText), /trade_chart_invalid_drawing_text/);
});

test("rejects duplicate IDs, oversized state, and non-finite coordinates", () => {
  const duplicateIndicators = structuredClone(validProjection().chart_state) as Record<string, any>;
  duplicateIndicators.indicators.push(structuredClone(duplicateIndicators.indicators[0]));
  assert.throws(() => assertChartStateV1(duplicateIndicators), /trade_chart_invalid_indicator_ids/);

  const tooManyDrawings = structuredClone(validProjection().chart_state) as Record<string, any>;
  tooManyDrawings.drawings = Array.from({ length: 201 }, (_, index) => ({ ...validDrawing, id: `line-${index}` }));
  assert.throws(() => assertChartStateV1(tooManyDrawings), /trade_chart_invalid_drawings/);

  const infinitePoint = structuredClone(validProjection().chart_state) as Record<string, any>;
  infinitePoint.drawings[0].points[0].price = Number.POSITIVE_INFINITY;
  assert.throws(() => assertChartStateV1(infinitePoint), /trade_chart_invalid_drawing_point/);
});

test("rejects projection leaks, float marker values, and non-UTC or unordered facts", () => {
  const credentialLeak = structuredClone(validProjection()) as Record<string, any>;
  credentialLeak.api_key = "must-not-cross-boundary";
  assert.throws(() => assertTradeChartProjection(credentialLeak), /trade_chart_invalid_projection_keys/);

  const floatQuantity = structuredClone(validProjection()) as Record<string, any>;
  floatQuantity.markers[0].allocated_quantity = 0.1;
  assert.throws(() => assertTradeChartProjection(floatQuantity), /trade_chart_invalid_marker_quantity/);

  const offsetTime = structuredClone(validProjection()) as Record<string, any>;
  offsetTime.markers[0].occurred_at = "2026-11-24T15:58:30+08:00";
  assert.throws(() => assertTradeChartProjection(offsetTime), /trade_chart_invalid_marker_time/);

  const unordered = structuredClone(validProjection()) as Record<string, any>;
  unordered.markers.push({
    ...unordered.markers[0],
    marker_key: "fill-0",
    fill_id: "900719925474099312346",
    occurred_at: "2026-11-24T07:58:20.000Z",
  });
  assert.throws(() => assertTradeChartProjection(unordered), /trade_chart_invalid_marker_order/);
});

test("rejects hidden and symbol-keyed chart fields", () => {
  const hiddenField = validProjection() as unknown as Record<string, any>;
  Object.defineProperty(hiddenField, "raw_provider_response", { value: {}, enumerable: false });
  assert.throws(() => assertTradeChartProjection(hiddenField), /trade_chart_invalid_projection_keys/);

  const symbolField = validProjection().chart_state as unknown as Record<string | symbol, unknown>;
  symbolField[Symbol("callback")] = () => undefined;
  assert.throws(() => assertChartStateV1(symbolField), /trade_chart_invalid_state_keys/);
});
