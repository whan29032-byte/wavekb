import type { PublicStrategyProjection } from "@wavekb/domain/trading-review";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WaveKbChartEngine } from "@/lib/trading/chart-engine";
import { PublicStrategyChart } from "./public-strategy-chart";

const createEngine = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trading/chart-engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/trading/chart-engine")>();
  return { ...original, createWaveKbChartEngine: createEngine };
});

const projection = {
  schema_version: "wavekb-public-strategy-snapshot-v1",
  renderer_schema_version: "wavekb-public-trade-chart-v1",
  calculation_engine_version: "openalgo-charts-2.7.5",
  provider: "binance",
  product: "usdt_perpetual",
  symbol: "BTCUSDT",
  direction: "long",
  timeframe: "1m",
  price_type: "trade",
  range: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-01T00:03:00.000Z" },
  snapshot_status: "closed",
  candles: [
    { series_basis: "trade", open_time: "2026-11-01T00:00:00.000Z", close_time: "2026-11-01T00:01:00.000Z", open: "100", high: "103", low: "99", close: "102", volume: "10", status: "final", gap_before: false, gap_after: false },
    { series_basis: "trade", open_time: "2026-11-01T00:01:00.000Z", close_time: "2026-11-01T00:02:00.000Z", open: "102", high: "105", low: "101", close: "104", volume: "12", status: "final", gap_before: false, gap_after: false },
    { series_basis: "trade", open_time: "2026-11-01T00:02:00.000Z", close_time: "2026-11-01T00:03:00.000Z", open: "104", high: "106", low: "103", close: "105", volume: "9", status: "final", gap_before: false, gap_after: false },
  ],
  markers: [
    { marker_key: "public-open", occurred_at: "2026-11-01T00:00:10.000Z", price: "100.5", allocation_role: "open", side: "buy", position_side: "long", liquidity: "maker" },
    { marker_key: "public-close", occurred_at: "2026-11-01T00:02:10.000Z", price: "105", allocation_role: "close", side: "sell", position_side: "long", liquidity: "taker" },
  ],
  public_annotations: [{ marker_key: "public-open", body: "等待突破确认", tags: ["计划内"] }],
  indicators: [{
    id: "public-sma",
    indicator_id: "sma",
    settings: { length: 20 },
    pane_index: 1,
    series: [{ points: [
      { time: "2026-11-01T00:00:00.000Z", value: "100.25" },
      { time: "2026-11-01T00:01:00.000Z", value: null },
      { time: "2026-11-01T00:02:00.000Z", value: "104.5" },
    ] }],
  }],
  drawings: [{
    id: "public-trend",
    tool: "trend-line",
    points: [{ time: 1_793_491_200, price: 100 }, { time: 1_793_491_320, price: 105 }],
    style: { lineWidth: 2 },
    paneIndex: 0,
    locked: true,
    visible: true,
    zIndex: 1,
  }],
  coverage: { status: "complete", source: "public_api", fetched_at: "2026-11-01T00:03:30.000Z", gaps: [] },
  show_quantity: false,
  show_absolute_pnl: false,
  price_return_rate: "4.477611940298507462",
  price_return_label: "价格收益率（不含手续费、资金费、掉期和杠杆）",
  warnings: [],
} satisfies PublicStrategyProjection;

type EngineSpies = WaveKbChartEngine & {
  setCandles: ReturnType<typeof vi.fn>;
  setCandleGaps: ReturnType<typeof vi.fn>;
  setFillClusters: ReturnType<typeof vi.fn>;
  setMarkers: ReturnType<typeof vi.fn>;
  setFrozenIndicatorSeries: ReturnType<typeof vi.fn>;
  setIndicators: ReturnType<typeof vi.fn>;
  setDrawings: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  markerClick(markerId: string | null): void;
  moveViewport(viewport: { from: number; to: number }): void;
};

function engineSpies(): EngineSpies {
  let markerListener: ((markerId: string | null) => void) | null = null;
  let viewportListener: ((viewport: { from: number; to: number }) => void) | null = null;
  const engine = {
    setCandles: vi.fn(),
    setCandleGaps: vi.fn(),
    setFillClusters: vi.fn(),
    setMarkers: vi.fn(),
    setFrozenIndicatorSeries: vi.fn(),
    setIndicators: vi.fn(async () => []),
    setDrawings: vi.fn(async () => undefined),
    armDrawingTool: vi.fn(async () => undefined),
    cancelDrawingTool: vi.fn(() => false),
    undoDrawings: vi.fn(() => false),
    redoDrawings: vi.fn(() => false),
    getDrawings: vi.fn(() => ({ schemaVersion: "wavekb-chart-drawings-v1" as const, drawings: [] })),
    setDrawingVisibility: vi.fn(() => false),
    setDrawingText: vi.fn(() => false),
    removeDrawing: vi.fn(() => false),
    subscribeDrawings: vi.fn(() => vi.fn()),
    subscribeDrawingTool: vi.fn(() => vi.fn()),
    subscribeMarkerClicks: vi.fn((listener) => { markerListener = listener; return vi.fn(() => { markerListener = null; }); }),
    setTheme: vi.fn(),
    resize: vi.fn(),
    setViewport: vi.fn(),
    getViewport: vi.fn(() => ({ from: 0, to: 2 })),
    subscribeViewport: vi.fn((listener) => { viewportListener = listener; return vi.fn(() => { viewportListener = null; }); }),
    destroy: vi.fn(),
    markerClick(markerId: string | null) { markerListener?.(markerId); },
    moveViewport(viewport: { from: number; to: number }) { viewportListener?.(viewport); },
  };
  return engine as unknown as EngineSpies;
}

class ResizeObserverStub {
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
}

beforeEach(() => {
  createEngine.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const className = String((element as HTMLElement).className);
    const backgroundColor = className.includes("bg-primary") ? "rgb(63, 111, 159)"
      : className.includes("bg-success") ? "rgb(29, 110, 78)"
        : className.includes("bg-destructive") ? "rgb(180, 35, 46)"
          : className.includes("bg-warning") ? "rgb(153, 92, 0)"
            : "rgb(255, 255, 255)";
    return {
      backgroundColor,
      color: "rgb(24, 33, 44)",
      borderTopColor: className.includes("border-border-subtle") ? "rgb(230, 235, 241)" : "rgb(216, 222, 231)",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PublicStrategyChart", () => {
  it("renders immutable privacy, source, return, and accessible marker facts without a browser", () => {
    const html = renderToString(<PublicStrategyChart projection={projection} />);

    expect(html).toContain("公开策略图");
    expect(html).toContain("仓位数量未公开");
    expect(html).toContain("绝对盈亏未公开");
    expect(html).toContain("价格收益率（不含手续费、资金费、掉期和杠杆）");
    expect(html).toContain("4.477611940298507462%");
    expect(html).toContain("等待突破确认");
    expect(html).toContain("2026-11-01T00:03:30.000Z");
    expect(html).not.toContain("讨论这笔成交");
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("feeds stored candles, marker facts, frozen indicator points, and locked drawings to the chart", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    render(<PublicStrategyChart projection={projection} />);

    await waitFor(() => expect(engine.setCandles).toHaveBeenCalledWith([
      { time: 1_793_491_200, open: 100, high: 103, low: 99, close: 102, volume: 10 },
      { time: 1_793_491_260, open: 102, high: 105, low: 101, close: 104, volume: 12 },
      { time: 1_793_491_320, open: 104, high: 106, low: 103, close: 105, volume: 9 },
    ]));
    expect(engine.setIndicators).not.toHaveBeenCalled();
    expect(engine.setFrozenIndicatorSeries).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "public-sma:0",
        paneIndex: 1,
        points: [{ time: 1_793_491_200, value: 100.25 }, { time: 1_793_491_260, value: null }, { time: 1_793_491_320, value: 104.5 }],
      }),
    ]);
    expect(engine.setDrawings).toHaveBeenCalledWith({
      schemaVersion: "wavekb-chart-drawings-v1",
      drawings: [expect.objectContaining({ id: "public-trend", locked: true, visible: true })],
    });
    expect(engine.setViewport).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("button", { name: /切换周期|加载更多/ })).toBeNull();
  });

  it("keeps marker selection keyboard-accessible and clamps panning to the stored candle range", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    render(<PublicStrategyChart projection={projection} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledOnce());

    const close = screen.getByRole("button", { name: /平仓.*105/ });
    fireEvent.click(close);
    expect(close.getAttribute("aria-pressed")).toBe("true");
    expect(engine.setMarkers.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fill:public-close", bold: true }),
    ]));

    engine.moveViewport({ from: -4, to: 8 });
    expect(engine.setViewport).toHaveBeenLastCalledWith({ from: 0, to: 2 });
  });

  it("focuses a public route marker and links only that marker to its encoded discussion target", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    const linkedProjection: PublicStrategyProjection = {
      ...projection,
      markers: projection.markers.map((marker) => marker.marker_key === "public-close"
        ? { ...marker, marker_key: "public/close?" }
        : marker),
    };

    render(
      <PublicStrategyChart
        projection={linkedProjection}
        activeMarkerKey="public/close?"
        commentsPostId="post/id with space"
      />,
    );

    const close = screen.getByRole("button", { name: /平仓.*105/ });
    expect(close.getAttribute("aria-pressed")).toBe("true");
    const discussion = screen.getByRole("link", { name: "讨论这笔成交" });
    expect(discussion.getAttribute("href")).toBe(
      "/community/post/post%2Fid%20with%20space?marker=public%2Fclose%3F#comments-title",
    );
    expect(screen.getAllByRole("link", { name: "讨论这笔成交" })).toHaveLength(1);
  });

  it("retains the static summary and complete marker list when chart initialization fails", async () => {
    createEngine.mockRejectedValue(new Error("canvas unavailable"));
    render(<PublicStrategyChart projection={projection} />);

    expect((await screen.findByRole("alert")).textContent).toContain("图表未能加载");
    expect(screen.getByText("3 根 K 线")).toBeTruthy();
    expect(screen.getByText("2 笔成交")).toBeTruthy();
    expect(screen.getByRole("button", { name: /开仓.*100.5/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /平仓.*105/ })).toBeTruthy();
  });
});
