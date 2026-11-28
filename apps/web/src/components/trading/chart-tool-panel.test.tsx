// @vitest-environment jsdom
import type { DrawingSpecV1, TradeChartProjection } from "@wavekb/domain/trading-review";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WaveKbChartDrawingChange, WaveKbChartEngine } from "@/lib/trading/chart-engine";
import { TradingRepositoryError } from "@/lib/trading/workbench-repository";
import { ChartToolPanel } from "./chart-tool-panel";

const { saveState, readChart } = vi.hoisted(() => ({ saveState: vi.fn(), readChart: vi.fn() }));
vi.mock("@/lib/trading/workbench-repository", async (original) => ({
  ...await original<typeof import("@/lib/trading/workbench-repository")>(),
  saveTradeChartState: saveState,
  getTradeChart: readChart,
}));

const range = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-01T00:01:00.000Z" };
const projection: TradeChartProjection = {
  schema_version: "wavekb-trade-chart-projection-v1",
  cycle_id: "aaaaaaaa-1111-4111-8111-111111111111",
  cycle_revision: 7,
  provider: "binance", product: "usdt_perpetual",
  symbol: "BTCUSDT", native_symbol: "BTCUSDT",
  direction: "long", opened_at: range.from, closed_at: range.to,
  timeframe: "1m", price_type: "trade", range,
  candles: [{
    provider: "binance", product: "usdt_perpetual", timeframe: "1m",
    native_symbol: "BTCUSDT", normalized_symbol: "BTCUSDT", series_basis: "trade",
    open_time: range.from, close_time: range.to, open: "250", high: "255", low: "245", close: "253",
    volume: "100", source: "public_api", source_timestamp: range.to, fetched_at: range.to,
    status: "final", gap_before: false, gap_after: false,
  }],
  markers: [],
  chart_state: null,
  coverage: { status: "complete", source: "public_api", fetched_at: range.to, gaps: [], unavailable_reason: null },
  warnings: [],
};

const line: DrawingSpecV1 = {
  id: "line", tool: "trend-line", paneIndex: 0, zIndex: 0,
  points: [{ time: 1793491200, price: 252 }, { time: 1793491260, price: 255 }],
  style: {},
};

function fakeEngine() {
  let onChange: ((change: WaveKbChartDrawingChange) => void) | undefined;
  let drawings: readonly DrawingSpecV1[] = [];
  const emit = (kind: WaveKbChartDrawingChange["kind"], next: readonly DrawingSpecV1[]) => {
    drawings = next;
    onChange?.({ kind, drawingIds: next.map(({ id }) => id), document: { schemaVersion: "wavekb-chart-drawings-v1", drawings: next } });
  };
  const engine = {
    setCandles: vi.fn(), setCandleGaps: vi.fn(), setFillClusters: vi.fn(), setMarkers: vi.fn(),
    setIndicators: vi.fn<WaveKbChartEngine["setIndicators"]>().mockResolvedValue([]),
    setDrawings: vi.fn(async (document) => emit("restore", document.drawings)),
    armDrawingTool: vi.fn<WaveKbChartEngine["armDrawingTool"]>().mockResolvedValue(undefined), cancelDrawingTool: vi.fn(() => true),
    undoDrawings: vi.fn(() => true), redoDrawings: vi.fn(() => true),
    getDrawings: () => ({ schemaVersion: "wavekb-chart-drawings-v1", drawings }),
    setDrawingVisibility: vi.fn((id: string, visible: boolean) => {
      emit("update", drawings.map((drawing) => drawing.id === id ? { ...drawing, visible } : drawing));
      return true;
    }),
    setDrawingText: vi.fn(() => true),
    removeDrawing: vi.fn((id: string) => { emit("remove", drawings.filter((drawing) => drawing.id !== id)); return true; }),
    subscribeDrawings: (listener) => { onChange = listener; return () => { onChange = undefined; }; },
    subscribeDrawingTool: vi.fn(() => () => undefined),
    subscribeMarkerClicks: vi.fn(() => () => undefined),
    subscribeViewport: vi.fn(() => () => undefined),
    setTheme: vi.fn(), resize: vi.fn(), setViewport: vi.fn(),
    getViewport: () => ({ from: -1, to: 55 }),
    destroy: vi.fn(),
  } satisfies WaveKbChartEngine;
  return { engine, emit };
}

async function mount(source = projection) {
  const fake = fakeEngine();
  await act(async () => { render(<ChartToolPanel projection={source} engine={fake.engine} />); });
  return fake;
}

function open(label: string) {
  fireEvent.click(screen.getByText(label, { selector: "summary" }));
}

afterEach(() => {
  cleanup();
  saveState.mockReset();
  readChart.mockReset();
  vi.useRealTimers();
});

describe("ChartToolPanel", () => {
  it("searches eligible indicators and keeps duplicate instances independently identifiable", async () => {
    saveState.mockResolvedValue({ version: 1, updated_at: range.to });
    const fake = await mount();
    open("指标");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索指标" }), { target: { value: "ema" } });
    expect(screen.queryByRole("button", { name: "添加 SMA" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加 EMA" }));
      fireEvent.click(screen.getByRole("button", { name: "添加 EMA" }));
    });
    expect(screen.getByRole("button", { name: "移除 EMA 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "移除 EMA 2" })).toBeTruthy();
    const studies = fake.engine.setIndicators.mock.lastCall?.[0];
    expect(new Set(studies?.map((study) => study.instanceId)).size).toBe(2);
  });

  it.each(["mark", "exness", "partial-volume"])("blocks volume studies for %s data", async (basis) => {
    const candle = projection.candles[0]!;
    const source: TradeChartProjection = basis === "mark"
      ? { ...projection, price_type: "mark", candles: [{ ...candle, series_basis: "mark" }] }
      : basis === "exness"
        ? { ...projection, provider: "exness", product: "cfd", price_type: "bid",
          candles: [{ ...candle, provider: "exness", product: "cfd", series_basis: "bid", source: "signed_account" }] }
        : { ...projection, candles: [candle, { ...candle, volume: null }] };
    await mount(source);
    open("指标");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索指标" }), { target: { value: "vwap" } });
    expect((screen.getByRole("button", { name: "添加 VWAP" }) as HTMLButtonElement).disabled).toBe(true);
    if (basis === "exness") expect(screen.getByText(/报价跳动量/)).toBeTruthy();
  });

  it("exposes Fibonacci, all Elliott patterns and basic drawing tools by their audited IDs", async () => {
    const fake = await mount();
    open("画线");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索画线工具" }), { target: { value: "艾略特" } });
    expect(screen.getAllByRole("button", { name: /^艾略特/ })).toHaveLength(5);
    for (const name of ["艾略特推动浪", "斐波那契回撤", "趋势线", "水平线", "矩形", "文字", "做多风险收益"]) {
      fireEvent.change(screen.getByRole("searchbox", { name: "搜索画线工具" }), { target: { value: name } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
    }
    expect(fake.engine.armDrawingTool.mock.calls.map(([tool]) => tool)).toEqual([
      "elliott-impulse", "fib-retracement", "trend-line", "horizontal-line", "rectangle", "text", "long-position",
    ]);
  });

  it("restores prior drawings, debounces edits and serializes versioned saves", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const updatedAt = "2026-11-01T01:01:00.000Z";
    saveState
      .mockImplementationOnce(() => new Promise((resolve) => { complete = () => resolve({ version: 5, updated_at: updatedAt }); }))
      .mockResolvedValueOnce({ version: 6, updated_at: "2026-11-01T01:02:00.000Z" });
    const fake = await mount({
      ...projection,
      chart_state: {
        schema_version: "wavekb-trade-chart-v1", cycle_id: projection.cycle_id,
        cycle_revision: 6, timeframe: "5m", price_type: "trade",
        viewport: { from: 100, to: 500 }, indicators: [{ instanceId: "fast", indicatorId: "ema" }], drawings: [line],
        version: 4, updated_at: "2026-11-01T01:00:00.000Z",
      },
    });
    expect(fake.engine.setDrawings).toHaveBeenCalledWith({ schemaVersion: "wavekb-chart-drawings-v1", drawings: [line] });
    expect(fake.engine.setViewport).not.toHaveBeenCalled();
    open("图表对象");
    fireEvent.click(screen.getByRole("button", { name: "隐藏 趋势线 1" }));
    await act(async () => vi.advanceTimersByTimeAsync(599));
    expect(saveState).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(saveState).toHaveBeenCalledWith(projection.cycle_id, {
      schema_version: "wavekb-trade-chart-v1", cycle_revision: 7, timeframe: "1m", price_type: "trade",
      viewport: { from: -1, to: 55 }, indicators: [{ instanceId: "fast", indicatorId: "ema" }],
      drawings: [{ ...line, visible: false }], expected_version: 4, expected_updated_at: "2026-11-01T01:00:00.000Z",
    });
    fireEvent.click(screen.getByRole("button", { name: "删除 趋势线 1" }));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(saveState).toHaveBeenCalledTimes(1);
    await act(async () => complete());
    expect(saveState).toHaveBeenLastCalledWith(projection.cycle_id, expect.objectContaining({
      drawings: [], expected_version: 5, expected_updated_at: updatedAt,
    }));
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });

  it("keeps local objects visible after an optimistic version conflict", async () => {
    vi.useFakeTimers();
    saveState.mockRejectedValue(new TradingRepositoryError("stale_trade_chart_state", 409));
    const fake = await mount();
    open("图表对象");
    act(() => fake.emit("add", [line]));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByRole("alert").textContent).toContain("另一处更新");
    expect(screen.getByRole("button", { name: "隐藏 趋势线 1" })).toBeTruthy();
    act(() => fake.emit("update", [{ ...line, visible: false }]));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("matches a saved layout after a lost response before writing queued changes", async () => {
    vi.useFakeTimers();
    saveState
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce({ version: 2, updated_at: range.to });
    readChart.mockResolvedValue({
      ...projection,
      chart_state: {
        schema_version: "wavekb-trade-chart-v1", cycle_id: projection.cycle_id,
        cycle_revision: 7, timeframe: "1m", price_type: "trade",
        viewport: { to: 55, from: -1 },
        indicators: [],
        drawings: [{ ...line, points: line.points.map(({ time, price }) => ({ price, time })) }],
        version: 1, updated_at: range.to,
      },
    });
    const fake = await mount();
    act(() => fake.emit("add", [line]));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    act(() => fake.emit("update", [{ ...line, visible: false }]));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(saveState).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "重试保存" })));
    expect(readChart).toHaveBeenCalledWith(projection.cycle_id, { timeframe: "1m", ...range });
    expect(saveState).toHaveBeenLastCalledWith(projection.cycle_id, expect.objectContaining({
      drawings: [{ ...line, visible: false }], expected_version: 1, expected_updated_at: range.to,
    }));
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });
});
