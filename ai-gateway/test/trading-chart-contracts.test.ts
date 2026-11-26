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
  points: [
    { time: 1_795_520_280_000, price: 60000 },
    { time: 1_795_520_340_000, price: 60100 },
  ],
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
      series_basis: "trade",
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
      gap_after: true,
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
      provider_fill_id_mask: "\u2022\u2022\u2022\u2022a1b2",
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
      status: "gapped",
      source: "public_api",
      fetched_at: "2026-11-24T08:00:00.000Z",
      gaps: [{ series_basis: "trade", from: "2026-11-24T07:59:00.000Z", to: "2026-11-24T08:00:00.000Z" }],
      unavailable_reason: null,
    },
    warnings: ["historical_gap"],
  };
}

test("validates a versioned chart state and projection without rounding decimals", () => {
  const projection = validProjection();
  assert.equal(assertTradeChartProjection(projection), projection);
  assert.equal(assertChartStateV1(projection.chart_state), projection.chart_state);
  assert.equal(projection.markers[0]?.fill_id, "900719925474099312345");
  assert.equal(projection.candles[0]?.open, "60000.000000000000000001");
});

test("accepts public two-anchor position inputs and bounded audited drawing settings", () => {
  const state = structuredClone(validProjection().chart_state) as Record<string, any>;
  state.drawings = [{
    id: "position-1",
    tool: "long-position",
    points: [
      { time: 1_795_520_280_000, price: 60_000 },
      { time: 1_795_520_340_000, price: 60_100 },
    ],
    style: { accountSize: 100_000, risk: 1, showLabels: true },
    properties: {
      showHeader: true,
      stopTime: 1_795_520_370_000,
      stopPrice: 59_850,
    },
    paneIndex: 0,
    zIndex: 0,
  }, {
    id: "trend-1",
    tool: "trend-line",
    points: validDrawing.points,
    style: { showStats: true },
    paneIndex: 0,
    zIndex: 1,
  }];
  assert.equal(assertChartStateV1(state), state);

  for (const style of [
    { accountSize: -1 },
    { accountSize: 1_000_000_000_000_001 },
    { risk: -0.1 },
    { risk: 100.1 },
  ]) {
    const invalid = structuredClone(state);
    invalid.drawings[0].style = style;
    assert.throws(() => assertChartStateV1(invalid), /trade_chart_invalid_drawing_style/);
  }

  const internalExpandedShape = structuredClone(state);
  internalExpandedShape.drawings[0].points.push({ time: 1_795_520_400_000, price: 59_900 });
  assert.throws(() => assertChartStateV1(internalExpandedShape), /trade_chart_invalid_drawing_points/);

  const nonPublicLabelAlignment = structuredClone(state);
  nonPublicLabelAlignment.drawings[0].text = { align: "center" };
  assert.throws(() => assertChartStateV1(nonPublicLabelAlignment), /trade_chart_invalid_drawing_text/);

  for (const properties of [
    { stopTime: 1_795_520_370_000 },
    { stopPrice: 59_850 },
    { stopTime: 10_000_000_000_001, stopPrice: 59_850 },
    { stopTime: 1_795_520_370_000, stopPrice: 1_100_000_000_000_000_000 },
  ]) {
    const invalidStop = structuredClone(state);
    invalidStop.drawings[0].properties = properties;
    assert.throws(() => assertChartStateV1(invalidStop), /trade_chart_invalid_drawing_properties/);
  }

  const invalidShowStats = structuredClone(state);
  invalidShowStats.drawings[1].style = { showStats: "yes" };
  assert.throws(() => assertChartStateV1(invalidShowStats), /trade_chart_invalid_drawing_style/);

  const unknownPositionProperty = structuredClone(state);
  unknownPositionProperty.drawings[0].properties = { stopTime: 1_795_520_370_000, stopPrice: 59_850, controllerPoint: {} };
  assert.throws(() => assertChartStateV1(unknownPositionProperty), /trade_chart_invalid_drawing_properties/);
});

test("rejects unknown indicator settings and unsafe or unsupported drawings", () => {
  const unknownSetting = structuredClone(validProjection().chart_state) as Record<string, any>;
  unknownSetting.indicators[0].settings.callback = "alert(1)";
  assert.throws(() => assertChartStateV1(unknownSetting), /trade_chart_invalid_indicator_settings/);

  const unknownTool = structuredClone(validProjection().chart_state) as Record<string, any>;
  unknownTool.drawings[0].tool = "execute-script";
  assert.throws(() => assertChartStateV1(unknownTool), /trade_chart_invalid_drawing_tool/);

  const unsafeText = structuredClone(validProjection().chart_state) as Record<string, any>;
  unsafeText.drawings[0] = { ...validDrawing, id: "text-1", tool: "text", points: [validDrawing.points[0]], style: {}, text: { value: "<script>alert(1)</script>" } };
  assert.throws(() => assertChartStateV1(unsafeText), /trade_chart_invalid_drawing_text/);

  const wrongPointCount = structuredClone(validProjection().chart_state) as Record<string, any>;
  wrongPointCount.drawings[0].points = [wrongPointCount.drawings[0].points[0]];
  assert.throws(() => assertChartStateV1(wrongPointCount), /trade_chart_invalid_drawing_points/);

  const fibOnlyStyle = structuredClone(validProjection().chart_state) as Record<string, any>;
  fibOnlyStyle.drawings[0].style.levels = [{ ratio: 0.618 }];
  assert.throws(() => assertChartStateV1(fibOnlyStyle), /trade_chart_invalid_drawing_style/);

  const elliottOnlyProperties = structuredClone(validProjection().chart_state) as Record<string, any>;
  elliottOnlyProperties.drawings[0].properties = { degree: "primary" };
  assert.throws(() => assertChartStateV1(elliottOnlyProperties), /trade_chart_invalid_drawing_properties/);

  const textOnVertical = structuredClone(validProjection().chart_state) as Record<string, any>;
  textOnVertical.drawings[0] = { ...validDrawing, tool: "vertical-line", points: [validDrawing.points[0]], text: { color: "#fff" } };
  assert.throws(() => assertChartStateV1(textOnVertical), /trade_chart_invalid_drawing_text/);

  const missingTextValue = structuredClone(validProjection().chart_state) as Record<string, any>;
  missingTextValue.drawings[0] = { ...validDrawing, tool: "text", points: [validDrawing.points[0]], style: {}, text: { color: "#fff" } };
  assert.throws(() => assertChartStateV1(missingTextValue), /trade_chart_invalid_drawing_text/);
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

  const tooManyIntegerDigits = structuredClone(validProjection()) as Record<string, any>;
  tooManyIntegerDigits.markers[0].allocated_quantity = "123456789012345678901";
  assert.throws(() => assertTradeChartProjection(tooManyIntegerDigits), /trade_chart_invalid_marker_quantity/);

  const offsetTime = structuredClone(validProjection()) as Record<string, any>;
  offsetTime.markers[0].occurred_at = "2026-11-24T15:58:30+08:00";
  assert.throws(() => assertTradeChartProjection(offsetTime), /trade_chart_invalid_marker_time/);

  const unordered = structuredClone(validProjection()) as Record<string, any>;
  unordered.opened_at = "2026-11-24T07:58:00.000Z";
  unordered.markers.push({
    ...unordered.markers[0],
    marker_key: "fill-0",
    fill_id: "900719925474099312346",
    occurred_at: "2026-11-24T07:58:20.000Z",
    sort_order: 1,
  });
  assert.throws(() => assertTradeChartProjection(unordered), /trade_chart_invalid_marker_order/);

  const skippedSortOrder = structuredClone(validProjection()) as Record<string, any>;
  skippedSortOrder.markers[0].sort_order = 1;
  assert.throws(() => assertTradeChartProjection(skippedSortOrder), /trade_chart_invalid_marker_sort_order/);

  const beforeCycle = structuredClone(validProjection()) as Record<string, any>;
  beforeCycle.markers[0].occurred_at = "2026-11-24T07:58:20.000Z";
  assert.throws(() => assertTradeChartProjection(beforeCycle), /trade_chart_invalid_marker_lifetime/);

  const unsafeMask = structuredClone(validProjection()) as Record<string, any>;
  unsafeMask.markers[0].provider_fill_id_mask = "\u2022\u2022\u2022\u202212345678901234567890";
  assert.throws(() => assertTradeChartProjection(unsafeMask), /trade_chart_invalid_marker_mask/);

  const unsafeSymbol = structuredClone(validProjection()) as Record<string, any>;
  unsafeSymbol.symbol = "BTC/USDT api_key=secret";
  unsafeSymbol.candles[0].normalized_symbol = unsafeSymbol.symbol;
  assert.throws(() => assertTradeChartProjection(unsafeSymbol), /trade_chart_invalid_projection_symbol/);

  const rawWarning = structuredClone(validProjection()) as Record<string, any>;
  rawWarning.warnings = ["upstream said api_key=secret"];
  assert.throws(() => assertTradeChartProjection(rawWarning), /warnings/);
});

test("rejects false candle coverage evidence and accepts explicit empty coverage", () => {
  const wrongSource = structuredClone(validProjection()) as Record<string, any>;
  wrongSource.coverage.source = "signed_account";
  assert.throws(() => assertTradeChartProjection(wrongSource), /canonical_candles_invalid_coverage_source/);

  const falseComplete = structuredClone(validProjection()) as Record<string, any>;
  falseComplete.candles = [];
  falseComplete.coverage.status = "complete";
  falseComplete.coverage.gaps = [];
  falseComplete.warnings = [];
  assert.throws(() => assertTradeChartProjection(falseComplete), /canonical_candles_invalid_empty/);

  const empty = structuredClone(falseComplete) as Record<string, any>;
  empty.coverage.status = "empty";
  empty.warnings = ["empty_range"];
  assert.equal(assertTradeChartProjection(empty), empty);
});

test("rejects hidden and symbol-keyed chart fields", () => {
  const hiddenField = validProjection() as unknown as Record<string, any>;
  Object.defineProperty(hiddenField, "raw_provider_response", { value: {}, enumerable: false });
  assert.throws(() => assertTradeChartProjection(hiddenField), /trade_chart_invalid_projection_keys/);

  const symbolField = validProjection().chart_state as unknown as Record<string | symbol, unknown>;
  symbolField[Symbol("callback")] = () => undefined;
  assert.throws(() => assertChartStateV1(symbolField), /trade_chart_invalid_state_keys/);
});
