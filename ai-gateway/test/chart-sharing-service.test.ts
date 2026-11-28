import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { TradeChartProjection } from "@wavekb/domain/trading-review";
import { ChartSharingService, readPublicStrategySnapshot, type ChartShareSource, type ChartSharingStore } from "../src/trading/chart-sharing-service.ts";

const owner = "22a11111-2222-4222-8222-222222222222";
const cycle = "11a11111-1111-4111-8111-111111111111";
const other = "33a11111-3333-4333-8333-333333333333";
const post = "44a11111-4444-4444-8444-444444444444";
const snapshot = "55a11111-5555-4555-8555-555555555555";
const from = "2026-11-26T10:00:10.000Z";
const opened = "2026-11-26T10:00:20.000Z";
const closed = "2026-11-26T10:00:40.000Z";
const to = "2026-11-26T10:00:50.000Z";
const candleOpen = "2026-11-26T10:00:00.000Z";
const candleClose = "2026-11-26T10:01:00.000Z";
const expires = "2026-11-26T10:16:00+00:00";
const request = { cycle_revision: 2, chart_state_version: 0, timeframe: "1m", from, to };

function fixture() {
  const source: ChartShareSource = {
    revision: 2, chart_state_version: 0, fill_digest: "fill-id-digest", source_fingerprint: "0".repeat(64),
    opened_at: opened, closed_at: closed, drawings: [], price_type: "trade",
    trade: {
      id: cycle, revision: 2, provider: "binance", product: "usdt_perpetual", symbol: "BTC/USDT",
      direction: "long", entry_price: "100", exit_price: "102", completeness: "complete", account_currency: "USDT",
      quantity: "0.012345678901234567", net_pnl: "0.024691357802469134",
    },
  };
  const chart: TradeChartProjection = {
    schema_version: "wavekb-trade-chart-projection-v1", cycle_id: cycle, cycle_revision: 2,
    provider: "binance", product: "usdt_perpetual", native_symbol: "BTCUSDT", symbol: "BTC/USDT",
    direction: "long", opened_at: opened, closed_at: closed, timeframe: "1m", price_type: "trade",
    range: { from, to }, chart_state: null,
    candles: [{ provider: "binance", product: "usdt_perpetual", native_symbol: "BTCUSDT", normalized_symbol: "BTC/USDT",
      timeframe: "1m", series_basis: "trade", open_time: candleOpen, close_time: candleClose, open: "100", high: "104",
      low: "95", close: "102", volume: "100", source: "public_api", status: "final",
      source_timestamp: candleClose, fetched_at: candleClose, gap_before: false, gap_after: false }],
    coverage: { source: "public_api", status: "complete", fetched_at: candleClose, gaps: [], unavailable_reason: null },
    warnings: [],
    markers: [{
      marker_key: "private-marker", fill_id: "314", occurred_at: opened, price: "100",
      side: "buy", allocation_role: "open", sort_order: 0, position_side: "long", liquidity: "maker",
      allocated_quantity: source.trade.quantity, provider_fill_id_mask: "••••0324",
      annotation: { id: other, body: "可分享到复盘的备忘", tags: [], version: 1, image_count: 1, remap_status: "current" },
    }],
  };
  let preview: Parameters<ChartSharingStore["savePreview"]>[0] | null = null;
  let result: Parameters<ChartSharingStore["publishPreview"]>[0] | null = null;
  const store: ChartSharingStore = {
    loadSource: async (ownerId, cycleId) => ownerId === owner && cycleId === cycle ? source : null,
    savePreview: async (input) => { preview = input; return expires; },
    loadPreview: async (key) => {
      if (!preview || preview.owner_id !== key.owner_id || preview.cycle_id !== key.cycle_id
        || preview.token_hash !== key.token_hash || preview.idempotency_key !== key.idempotency_key) return null;
      return preview;
    },
    publishPreview: async (input) => {
      result = input;
      return { post_id: post, snapshot_id: snapshot, replayed: false };
    },
  };
  let query: Record<string, unknown> | null = null;
  const workbench = { getChart: async (ownerId: string, cycleId: string, chartQuery: Record<string, unknown>) => {
    assert.equal(ownerId, owner);
    assert.equal(cycleId, cycle);
    query = chartQuery;
    return { ...chart, range: { from: String(chartQuery.from), to: String(chartQuery.to) } };
  } };
  return {
    chart, source, store, workbench, service: new ChartSharingService(store, workbench),
    saved: () => preview, published: () => result, lastQuery: () => query,
  };
}

test("uses owner-bound server facts, freezes full boundary candles and stores only a hashed preview token", async () => {
  const f = fixture();
  const result = await f.service.createPreview(owner, cycle, { ...request, annotation_fill_ids: ["314"], show_quantity: true });
  assert.deepEqual(result.projection.range, { from: candleOpen, to: candleClose });
  assert.deepEqual(result.projection.public_annotations.map(({ body }) => body), ["可分享到复盘的备忘"]);
  assert.equal(result.projection.quantity, f.source.trade.quantity);
  assert.equal(Object.hasOwn(result.projection, "absolute_pnl"), false);
  assert.equal(Object.hasOwn(result.projection.markers[0]!, "fill_id"), false);
  assert.equal(result.expires_at, expires);
  assert.equal(f.saved()?.token_hash, createHash("sha256").update(result.preview_token).digest("hex"));
  assert.equal(f.saved()?.source_fingerprint, f.source.source_fingerprint);
  assert.equal(f.saved()?.projection_digest, result.projection_digest);
  assert.equal(JSON.stringify(f.saved()).includes(result.preview_token), false);
});

test("rejects foreign, stale and client-supplied sensitive facts before fetching candles", async () => {
  const f = fixture();
  await assert.rejects(f.service.createPreview(other, cycle, request), { message: "public_strategy_source_not_found" });
  await assert.rejects(f.service.createPreview(owner, cycle, { ...request, chart_state_version: 4 }), { statusCode: 409 });
  await assert.rejects(f.service.createPreview(owner, cycle, { ...request, quantity: "999" }), { statusCode: 400 });
  assert.equal(f.lastQuery(), null);
  assert.equal(f.saved(), null);
});

test("drops an assembled preview if the server source changes during the candle fetch", async () => {
  const f = fixture();
  const getChart = f.workbench.getChart;
  f.workbench.getChart = async (...args) => {
    const chart = await getChart(...args);
    f.source.source_fingerprint = "1".repeat(64);
    return chart;
  };
  await assert.rejects(f.service.createPreview(owner, cycle, request), { message: "public_strategy_preview_stale" });
  assert.equal(f.saved(), null);
});

test("publishes only the server-stored digest and exact owner token, without visibility overrides", async () => {
  const f = fixture();
  const preview = await f.service.createPreview(owner, cycle, request);
  const input = {
    preview_token: preview.preview_token, idempotency_key: preview.idempotency_key, projection_digest: preview.projection_digest,
    board: "case_submission", title: "我的波浪复盘案例", body: "这笔交易的开仓和平仓依据，以及下一次复盘中需要注意的执行细节。",
  };
  await assert.rejects(f.service.publish(other, cycle, input), { statusCode: 404 });
  await assert.rejects(f.service.publish(owner, cycle, { ...input, show_quantity: true }), { statusCode: 400 });
  await assert.rejects(f.service.publish(owner, cycle, { ...input, projection_digest: "2".repeat(64) }), { statusCode: 409 });
  assert.equal(f.published(), null);
  assert.deepEqual(await f.service.publish(owner, cycle, input), { post_id: post, snapshot_id: snapshot, replayed: false });
  assert.equal(f.published()?.projection_digest, preview.projection_digest);
  assert.equal(f.published()?.token_hash, f.saved()?.token_hash);
  assert.equal(Object.hasOwn(f.published()!, "projection"), false);
});

test("public reads use guest RLS, omit private metadata, and reject corrupt storage", async () => {
  const f = fixture();
  const preview = await f.service.createPreview(owner, cycle, request);
  const row = { id: snapshot, post_id: post, projection: preview.projection, projection_digest: preview.projection_digest,
    source_fingerprint: "not-public", owner_id: owner };
  const configuration = { SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "guest-key" };
  const result = await readPublicStrategySnapshot(configuration, snapshot, async (url, init) => {
    const target = new URL(String(url));
    assert.equal(target.pathname, "/rest/v1/public_strategy_snapshots");
    assert.equal(target.searchParams.get("id"), `eq.${snapshot}`);
    assert.deepEqual(init?.headers, { apikey: "guest-key", accept: "application/json" });
    assert.equal(init?.cache, "no-store");
    return Response.json([row]);
  });
  assert.deepEqual(result, { id: snapshot, post_id: post, projection: preview.projection, projection_digest: preview.projection_digest });
  assert.equal(await readPublicStrategySnapshot(configuration, snapshot, async () => Response.json([])), null);
  await assert.rejects(readPublicStrategySnapshot(configuration, snapshot,
    async () => Response.json([{ ...row, projection_digest: "1".repeat(64) }])), { statusCode: 503 });
});

test("a guest reads the frozen default share without private fills or edits made after publication", async () => {
  const f = fixture();
  const preview = await f.service.createPreview(owner, cycle, {
    ...request, show_quantity: false, show_absolute_pnl: false,
    annotation_fill_ids: [], drawing_ids: [], indicator_instance_ids: [],
  });
  await f.service.publish(owner, cycle, {
    preview_token: preview.preview_token, idempotency_key: preview.idempotency_key, projection_digest: preview.projection_digest,
    board: "case_submission", title: "我要验证的交易复盘", body: "发布确认后，这个快照应保持不变，不反映之后修改的交易备注。",
  });
  const persisted = structuredClone(f.saved()!.projection);
  f.chart.markers[0]!.annotation!.body = "private update after publication";
  f.chart.candles[0]!.close = "103";

  const result = await readPublicStrategySnapshot({ SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "guest-key" }, snapshot,
    async () => Response.json([{ id: snapshot, post_id: post, projection: persisted, projection_digest: preview.projection_digest }]));
  const publicChart = result?.projection;
  assert.ok(publicChart);
  assert.equal(publicChart.candles[0]?.close, "102");
  assert.deepEqual(publicChart.public_annotations, []);
  assert.equal(Object.hasOwn(publicChart, "quantity"), false);
  assert.equal(Object.hasOwn(publicChart, "absolute_pnl"), false);
  assert.equal(Object.hasOwn(publicChart.markers[0]!, "quantity"), false);
  assert.equal(Object.hasOwn(publicChart.markers[0]!, "fill_id"), false);
  assert.doesNotMatch(JSON.stringify(publicChart), /private update after publication|可分享到复盘的备忘/);
});
