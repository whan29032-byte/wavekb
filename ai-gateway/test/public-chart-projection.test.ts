import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DrawingSpecV1, FillMarker, TradeChartProjection } from "@wavekb/domain/trading-review";
import {
  digestPublicStrategyProjection,
  projectPublicStrategy,
  type PublicStrategyProjectionInput,
} from "../src/trading/public-chart-projection.ts";

const cycleId = "11111111-1111-4111-8111-111111111111";
const noteId = "33333333-3333-4333-8333-333333333333";
const rawFillId = "900719925474099312345";
const lastPrice = "115.000000000000000001";
const from = "2026-11-24T07:58:00.000Z";
const midpoint = "2026-11-24T07:59:00.000Z";
const to = "2026-11-24T08:00:00.000Z";

function fixture(): PublicStrategyProjectionInput {
  const drawings: DrawingSpecV1[] = [
    {
      id: "private-position-id", tool: "long-position", paneIndex: 0, zIndex: 0,
      points: [{ time: Date.parse(from) / 1_000, price: 100 }, { time: Date.parse(midpoint) / 1_000, price: 115 }],
      style: { accountSize: 123456.789, risk: 13.75, showLabels: true },
      properties: { showHeader: true, showLossSize: true, showTargetLabel: true, showStopLabel: true,
        showPrices: true, stopTime: Date.parse(midpoint) / 1_000, stopPrice: 90 },
    },
    {
      id: "private-text-id", tool: "text", paneIndex: 0, zIndex: 1,
      points: [{ time: Date.parse(midpoint) / 1_000, price: 115 }], style: {},
      text: { value: "波段终点" },
    },
  ];
  const firstMarker: FillMarker = {
    marker_key: "private-marker-1", fill_id: rawFillId,
    occurred_at: "2026-11-24T07:58:30.000Z", price: "100", allocated_quantity: "0.017532196543218771",
    allocation_role: "open", sort_order: 0, side: "buy", position_side: "long",
    liquidity: "maker", provider_fill_id_mask: "••••a1b2",
    annotation: { id: noteId, body: "等待确认", tags: ["计划"], image_count: 1, version: 3, remap_status: "current" },
  };
  const projection: TradeChartProjection = {
    schema_version: "wavekb-trade-chart-projection-v1", cycle_id: cycleId, cycle_revision: 3,
    provider: "binance", product: "usdt_perpetual", symbol: "BTC/USDT", native_symbol: "PRIVATE_NATIVE_PRODUCT_NAME",
    direction: "long", timeframe: "1m", price_type: "trade",
    opened_at: firstMarker.occurred_at, closed_at: "2026-11-24T07:59:30.000Z",
    range: { from, to },
    candles: [
      { provider: "binance", product: "usdt_perpetual", native_symbol: "PRIVATE_NATIVE_PRODUCT_NAME", normalized_symbol: "BTC/USDT",
        timeframe: "1m", series_basis: "trade", open_time: from, close_time: midpoint, open: "100", high: "121", low: "98",
        close: "108", volume: "27", source: "public_api", status: "final", source_timestamp: midpoint, fetched_at: to,
        gap_before: false, gap_after: false },
      { provider: "binance", product: "usdt_perpetual", native_symbol: "PRIVATE_NATIVE_PRODUCT_NAME", normalized_symbol: "BTC/USDT",
        timeframe: "1m", series_basis: "trade", open_time: midpoint, close_time: to, open: "108", high: "122", low: "99",
        close: lastPrice, volume: "33", source: "public_api", status: "final", source_timestamp: to, fetched_at: to,
        gap_before: false, gap_after: false },
    ],
    markers: [firstMarker, {
      ...firstMarker, marker_key: "private-marker-2", fill_id: "900719925474099312346", occurred_at: "2026-11-24T07:59:30.000Z",
      price: lastPrice, allocation_role: "close", sort_order: 1, side: "sell",
      annotation: { id: "44444444-4444-4444-8444-444444444444", body: "未选择的私人笔记", tags: [], image_count: 0, version: 1, remap_status: "current" },
    }],
    coverage: { status: "complete", source: "public_api", fetched_at: to, unavailable_reason: null, gaps: [] },
    warnings: [],
    chart_state: {
      schema_version: "wavekb-trade-chart-v1", cycle_id: cycleId, cycle_revision: 3,
      timeframe: "1m", price_type: "trade", viewport: { from: 0, to: 2 },
      indicators: [{ instanceId: "private-rsi-id", indicatorId: "rsi", settings: { length: 14, source: "close" }, paneIndex: 1 }],
      drawings, version: 1, updated_at: to,
    },
  };
  return {
    projection,
    trade: {
      id: cycleId, revision: 3, provider: "binance", product: "usdt_perpetual", symbol: "BTC/USDT",
      direction: "long", entry_price: "100", exit_price: lastPrice, completeness: "complete",
      account_currency: "USDT", quantity: firstMarker.allocated_quantity, net_pnl: "-9384.127456789212",
      ...{ account_label: "PRIVATE_ACCOUNT_LABEL", connection_id: "PRIVATE_CONNECTION_ID", fees: "443211.127897423",
        funding_or_swap: "945577.2112345", dividends: "78568.3329", native_position_id: "PRIVATE_POSITION_ID",
        balance: "9357845123.2444", equity: "89761521112.1", seed_envelope: { secret: "PRIVATE_CREDENTIAL", image_path: "PRIVATE_PATH" } },
    },
    snapshotSeed: Buffer.alloc(32, 5),
    choices: { annotation_fill_ids: [rawFillId], drawing_ids: ["private-position-id", "private-text-id"] },
    computedIndicators: [{ instanceId: "private-rsi-id", series: [{ points: [{ time: from, value: null }, { time: midpoint, value: "56.11" }] }] }],
    fillPnl: new Map([[rawFillId, "4912.338789234"], ["900719925474099312346", "-37.5"]]),
  };
}

test("produces separate opaque marker, study and drawing IDs and never copies private provider data", () => {
  const input = fixture();
  const { projection: publicChart, canonicalJson, digest } = projectPublicStrategy(input);
  assert.equal(publicChart.candles[1]?.close, lastPrice);
  assert.match(publicChart.markers[0]!.marker_key, /^[0-9a-f]{32}$/);
  assert.notEqual(publicChart.markers[0]!.marker_key, publicChart.markers[1]!.marker_key);
  assert.deepEqual(publicChart.public_annotations, [{ marker_key: publicChart.markers[0]!.marker_key, body: "等待确认", tags: ["计划"] }]);
  assert.deepEqual(publicChart.indicators[0]?.series, [{ points: [{ time: from, value: null }, { time: midpoint, value: "56.11" }] }]);
  assert.equal(publicChart.drawings[1]?.text?.value, "波段终点");
  assert.match(publicChart.drawings[0]!.id, /^[0-9a-f]{32}$/);
  for (const secret of [cycleId, noteId, rawFillId, "••••a1b2", "PRIVATE_", "private-marker", "private-text-id",
    "private-rsi-id", "private-position-id", "未选择的私人笔记", "443211.127897423", "945577.2112345", "78568.3329",
    "9357845123.2444", "89761521112.1", "123456.789", "13.75", "image_count", "accountSize", '"risk"']) {
    assert.equal(canonicalJson.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(digest, createHash("sha256").update(canonicalJson).digest("hex"));
  const fromDatabase = Object.fromEntries(Object.entries(JSON.parse(canonicalJson)).reverse());
  assert.equal(digestPublicStrategyProjection(fromDatabase), digest);
  assert.equal(projectPublicStrategy({ ...input, choices: { ...input.choices, drawing_ids: ["private-text-id", "private-position-id"] } }).digest, digest);
  assert.notEqual(projectPublicStrategy({ ...input, snapshotSeed: Buffer.alloc(32, 7) }).projection.markers[0]?.marker_key, publicChart.markers[0]?.marker_key);
});

for (const showQuantity of [false, true]) {
  for (const showPnl of [false, true]) {
    test(`physically projects quantity=${showQuantity} and absolute P&L=${showPnl}`, () => {
      const input = fixture();
      const { projection, canonicalJson } = projectPublicStrategy({
        ...input,
        choices: { ...input.choices, show_quantity: showQuantity, show_absolute_pnl: showPnl },
      });
      assert.equal(projection.show_quantity, showQuantity);
      assert.equal(projection.show_absolute_pnl, showPnl);
      assert.equal(Object.hasOwn(projection, "quantity"), showQuantity);
      assert.equal(Object.hasOwn(projection, "absolute_pnl"), showPnl);
      assert.equal(Object.hasOwn(projection.markers[0]!, "quantity"), showQuantity);
      assert.equal(Object.hasOwn(projection.markers[0]!, "absolute_pnl"), showPnl);
      assert.equal(projection.warnings?.includes("hidden_value_may_be_inferred"), showQuantity !== showPnl);
      assert.equal(canonicalJson.includes("0.017532196543218771"), showQuantity);
      assert.equal(canonicalJson.includes("4912.338789234"), showPnl);
      assert.equal(canonicalJson.includes("-9384.127456789212"), showPnl);
      assert.equal(canonicalJson.includes("123456.789"), false);
      assert.equal(projection.drawings[0]?.properties?.showLossSize, false);
    });
  }
}

test("calculates percent price return with exact decimal arithmetic and reports unavailable prices", () => {
  const input = fixture();
  assert.equal(projectPublicStrategy(input).projection.price_return_rate, "15.000000000000000001");
  input.projection.direction = input.trade.direction = "short";
  const { projection } = projectPublicStrategy(input);
  assert.equal(projection.price_return_rate, "-15.000000000000000001");
  assert.doesNotMatch(projection.price_return_label ?? "", /ROI/iu);
  input.trade.completeness = "incomplete_opening_history";
  assert.equal(projectPublicStrategy(input).projection.price_return_rate, null);
  input.projection.closed_at = null;
  input.trade.completeness = "open";
  input.trade.exit_price = null;
  const open = projectPublicStrategy(input).projection;
  assert.equal(open.snapshot_status, "open_at_snapshot");
  assert.equal(open.price_return_rate, "-15.000000000000000001");
  assert.match(open.price_return_label ?? "", /未实现.*2026-11-24T08:00:00.000Z/u);
});

test("shares only explicit notes and drawings and never recomputes or drops a requested study", () => {
  const input = fixture();
  const { projection } = projectPublicStrategy({ ...input, choices: { indicator_instance_ids: [] } });
  assert.deepEqual(projection.public_annotations, []);
  assert.deepEqual(projection.drawings, []);
  assert.deepEqual(projection.indicators, []);
  assert.throws(() => projectPublicStrategy({ ...input, computedIndicators: [] }), /public_strategy_indicator_output_missing/);
  assert.throws(() => projectPublicStrategy({ ...input, choices: { annotation_fill_ids: ["401"] } }), /public_strategy_selection_invalid/);
  assert.throws(() => projectPublicStrategy({ ...input, choices: { drawing_ids: ["another-revision"] } }), /public_strategy_selection_invalid/);
  assert.throws(() => projectPublicStrategy({ ...input, choices: { indicator_instance_ids: ["elsewhere"] } }), /public_strategy_selection_invalid/);
});

test("makes an explicitly selected hidden drawing visible in the preview so its text cannot ship unseen", () => {
  const input = fixture();
  input.projection.chart_state!.drawings[1]!.visible = false;
  const { projection } = projectPublicStrategy(input);
  assert.equal(projection.drawings[1]?.visible, true);
  assert.equal(projection.drawings[1]?.text?.value, "波段终点");
});

test("rejects source schemas, private nested extras, unsafe text, and malformed public numeric inputs", () => {
  const input = fixture();
  assert.throws(() => projectPublicStrategy({
    ...input,
    projection: { ...input.projection, schema_version: "foreign-v2" } as unknown as TradeChartProjection,
  }), /public_strategy_source_invalid/);
  for (const unsafe of ["打开 https://private.example/api?key=abcdef", "编码错误 \uD800", "Ｂｅａｒｅｒ\u0000"]) {
    input.projection.markers[0]!.annotation!.body = unsafe;
    assert.throws(() => projectPublicStrategy(input), /public_strategy_text_unsafe/);
  }
  input.projection.markers[0]!.annotation!.body = "安全正文";
  Object.assign(input.projection.candles[0]!, { raw_payload: { api_key: "private" } });
  assert.throws(() => projectPublicStrategy(input), /public_strategy_source_invalid/);
  const clean = fixture();
  assert.throws(() => projectPublicStrategy({
    ...clean,
    computedIndicators: [{ instanceId: "private-rsi-id", series: [{ points: [{ time: from, value: Infinity as unknown as string }] }] }],
  }), /public_strategy_indicator_output_invalid/);
  clean.projection.chart_state!.drawings[0]!.points[0]!.price = NaN;
  assert.throws(() => projectPublicStrategy(clean), /public_strategy_source_invalid/);
});

test("stops publishing a whole candle that extends outside the authorized snapshot range", () => {
  const input = fixture();
  input.projection.range = { from: "2026-11-24T07:58:01.000Z", to };
  assert.throws(() => projectPublicStrategy(input), /public_strategy_coverage_invalid/);
});

test("stops out-of-window drawings and larger-than-budget payloads before computing a digest", () => {
  const input = fixture();
  input.projection.chart_state!.drawings[0]!.points[0]!.time -= 60;
  assert.throws(() => projectPublicStrategy(input), /public_strategy_drawing_outside_range/);
  const tooLarge = fixture();
  const first = tooLarge.projection.markers[0]!;
  tooLarge.projection.markers = Array.from({ length: 400 }, (_, index) => ({
    ...first, fill_id: String(index + 1000), marker_key: `private-${index}`, sort_order: index,
    annotation: { ...first.annotation!, body: "验".repeat(4_800) },
  }));
  tooLarge.choices = { annotation_fill_ids: tooLarge.projection.markers.map(({ fill_id }) => fill_id), indicator_instance_ids: [] };
  assert.throws(() => projectPublicStrategy(tooLarge), /public_strategy_payload_too_large/);
});
