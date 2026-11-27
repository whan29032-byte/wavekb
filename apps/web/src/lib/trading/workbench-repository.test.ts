import type { ChartStateV1, FillMarkerAnnotationV1, PublicStrategyProjection, TradeChartProjection } from "@wavekb/domain/trading-review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPublicStrategySnapshot,
  getTradeChart,
  previewPublicStrategy,
  publishPublicStrategy,
  saveTradeChartState,
  saveTradeFillAnnotation,
} from "./workbench-repository";

const fetchMock = vi.fn();
const cycleId = "22222222-2222-4222-8222-222222222222";
const digest = "a".repeat(64);
const previewInput = {
  cycle_revision: 7, chart_state_version: 2, timeframe: "1h" as const,
  from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z",
  show_quantity: false, show_absolute_pnl: true, annotation_fill_ids: ["42"],
};
const publishInput = {
  preview_token: "one-time-preview", idempotency_key: cycleId, projection_digest: digest,
  board: "idea_sharing" as const, title: "复盘", body: "公开策略",
};

const projection = {
  schema_version: "wavekb-trade-chart-projection-v1",
  cycle_id: cycleId,
  cycle_revision: 7,
  provider: "binance",
  product: "usdt_perpetual",
  symbol: "BTC/USDT",
  native_symbol: "BTCUSDT",
  direction: "long",
  opened_at: "2026-11-01T00:00:00.000Z",
  closed_at: "2026-11-01T01:00:00.000Z",
  timeframe: "1h",
  price_type: "trade",
  range: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" },
  candles: [],
  markers: [{
    marker_key: "7:42",
    fill_id: "42",
    occurred_at: "2026-11-01T00:15:00.000Z",
    price: "70000.125",
    allocated_quantity: "0.001",
    allocation_role: "open",
    sort_order: 0,
    side: "buy",
    position_side: "long",
    liquidity: "maker",
    provider_fill_id_mask: "••••1234",
    annotation: null,
  }],
  chart_state: null,
  coverage: {
    status: "unavailable",
    source: null,
    fetched_at: null,
    gaps: [],
    unavailable_reason: "upstream_unavailable",
  },
  warnings: ["candles_unavailable"],
} satisfies TradeChartProjection;

const chartState = {
  schema_version: "wavekb-trade-chart-v1",
  cycle_id: cycleId,
  cycle_revision: 7,
  timeframe: "1h",
  price_type: "trade",
  viewport: { from: 1_795_824_000, to: 1_795_910_400 },
  indicators: [],
  drawings: [],
  version: 3,
  updated_at: "2026-11-27T00:00:00.000Z",
} satisfies ChartStateV1;

const annotation = {
  id: "33333333-3333-4333-8333-333333333333",
  body: "Followed the plan.",
  tags: ["discipline"],
  image_count: 0,
  version: 2,
  remap_status: "current",
} satisfies FillMarkerAnnotationV1;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("strategy share browser repository", () => {
  it("fetches a public snapshot without session credentials", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "not_found" }, { status: 404 }));
    await expect(getPublicStrategySnapshot(cycleId)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/public-strategies/${cycleId}`, { credentials: "omit", cache: "no-cache" });
  });

  it("returns the generated preview and publishes with the original token and digest", async () => {
    const { from, to } = previewInput;
    const previewChart = {
      schema_version: "wavekb-public-strategy-snapshot-v1", renderer_schema_version: "wavekb-public-trade-chart-v1",
      calculation_engine_version: "openalgo-charts-2.7.5", provider: "binance", product: "usdt_perpetual", symbol: "BTC/USDT",
      direction: "long", timeframe: "1h", price_type: "trade", range: { from, to }, snapshot_status: "closed",
      candles: [{ series_basis: "trade", open_time: from, close_time: to, open: "25", high: "30", low: "25", close: "30", volume: null, status: "final", gap_before: false, gap_after: false }],
      markers: [{ marker_key: "b".repeat(32), occurred_at: from, price: "25", allocation_role: "open", side: "buy", position_side: "long", liquidity: "maker" }],
      coverage: { status: "complete", source: "public_api", fetched_at: to, gaps: [] }, public_annotations: [], indicators: [], drawings: [],
      show_quantity: false, show_absolute_pnl: true, absolute_pnl: { amount: "0.15", currency: "USDT" },
      price_return_label: "价格收益率", price_return_rate: "20", warnings: ["hidden_value_may_be_inferred"],
    } satisfies PublicStrategyProjection;
    const preview = {
      preview_token: publishInput.preview_token, idempotency_key: publishInput.idempotency_key, projection_digest: digest,
      expires_at: "2026-11-27T00:00:00.000Z", projection: previewChart,
    };
    const success = { post_id: cycleId, snapshot_id: cycleId, replayed: true };
    fetchMock.mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(Response.json(success));
    await expect(previewPublicStrategy(cycleId, previewInput)).resolves.toMatchObject({
      preview_token: publishInput.preview_token, idempotency_key: cycleId, projection_digest: digest, projection: preview.projection,
    });
    await expect(publishPublicStrategy(cycleId, publishInput)).resolves.toEqual(success);
    for (const [action, input] of [["share-preview", previewInput], ["share-publish", publishInput]] as const) {
      expect(fetchMock).toHaveBeenCalledWith(`/api/trading/trades/${cycleId}/${action}`, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
      });
    }
  });

  it.each([
    [409, "public_strategy_preview_stale", "stale_preview"],
    [410, "public_strategy_preview_expired", "expired_preview"],
    [409, "public_strategy_preview_consumed", "consumed_preview"],
    [400, "public_strategy_text_unsafe", "privacy_validation"],
    [503, "trading_gateway_unavailable", "gateway_unavailable"],
    [429, "rate_limited", "rate_limited"],
  ])("provides a distinct browser error for %s %s", async (status, error, reason) => {
    fetchMock.mockResolvedValue(Response.json({ error }, { status }));
    await expect(publishPublicStrategy(cycleId, publishInput)).rejects.toMatchObject({ status, code: error, reason });
  });

  it("maps an interrupted publish to a retryable gateway error without modifying idempotency", async () => {
    fetchMock.mockRejectedValue(new TypeError("private network failure"));
    await expect(publishPublicStrategy(cycleId, publishInput)).rejects.toMatchObject({ reason: "gateway_unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("trade chart browser repository", () => {
  it("loads the owner projection with a bounded encoded query and no cache", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ chart: projection }), { status: 200 }));
    await expect(getTradeChart(cycleId, {
      timeframe: "1h",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-02T00:00:00.000Z",
    })).resolves.toEqual(projection);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/trading/trades/${cycleId}/chart?timeframe=1h&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T00%3A00%3A00.000Z`,
      { cache: "no-store" },
    );
    const serialized = JSON.stringify(projection);
    for (const forbidden of ["api_key", "credential", "raw_upstream", "access_point", "gateway_host", "storage_path"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("saves chart state with optimistic revision/version fields only", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ chart_state: chartState }), { status: 200 }));
    const input = {
      cycle_revision: 7,
      schema_version: "wavekb-trade-chart-v1" as const,
      timeframe: "1h" as const,
      price_type: "trade" as const,
      viewport: chartState.viewport,
      indicators: [],
      drawings: [],
      expected_version: 2,
      expected_updated_at: "2026-11-26T00:00:00.000Z",
    };

    await expect(saveTradeChartState(cycleId, input)).resolves.toEqual(chartState);
    expect(fetchMock).toHaveBeenCalledWith(`/api/trading/trades/${cycleId}/chart-state`, {
      method: "PUT",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("saves one fill annotation without exposing image storage paths in the response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ annotation }), { status: 200 }));
    const input = {
      annotation_id: annotation.id,
      cycle_revision: 7,
      body: annotation.body,
      tags: annotation.tags,
      images: [],
      expected_version: 1,
      deleted: false,
    };

    await expect(saveTradeFillAnnotation(cycleId, "42", input)).resolves.toEqual(annotation);
    expect(fetchMock).toHaveBeenCalledWith(`/api/trading/trades/${cycleId}/fills/42/annotation`, {
      method: "PUT",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(JSON.stringify(annotation)).not.toContain("storage_path");
  });
});
