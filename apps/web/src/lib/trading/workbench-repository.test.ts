import type { ChartStateV1, FillMarkerAnnotationV1, TradeChartProjection } from "@wavekb/domain/trading-review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTradeChart,
  saveTradeChartState,
  saveTradeFillAnnotation,
} from "./workbench-repository";

const fetchMock = vi.fn();
const cycleId = "22222222-2222-4222-8222-222222222222";

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
