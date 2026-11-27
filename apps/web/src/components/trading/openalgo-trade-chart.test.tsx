import type { FillMarker, TradeChartProjection } from "@wavekb/domain/trading-review";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WaveKbChartEngine } from "@/lib/trading/chart-engine";
import { OpenAlgoTradeChart } from "./openalgo-trade-chart";

const createEngine = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trading/chart-engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/trading/chart-engine")>();
  return { ...original, createWaveKbChartEngine: createEngine };
});

const cycleId = "22222222-2222-4222-8222-222222222222";

function fill(
  markerKey: string,
  occurredAt: string,
  role: FillMarker["allocation_role"],
  price: string,
  side: FillMarker["side"] = "buy",
  positionSide: FillMarker["position_side"] = "long",
): FillMarker {
  return {
    marker_key: markerKey,
    fill_id: markerKey.split(":").at(-1) ?? markerKey,
    occurred_at: occurredAt,
    price,
    allocated_quantity: `0.00${markerKey.split(":").at(-1)}`,
    allocation_role: role,
    sort_order: Number(markerKey.split(":").at(-1)),
    side,
    position_side: positionSide,
    liquidity: "maker",
    provider_fill_id_mask: `••••${markerKey.split(":").at(-1)}`,
    annotation: null,
  };
}

const projection = {
  schema_version: "wavekb-trade-chart-projection-v1",
  cycle_id: cycleId,
  cycle_revision: 7,
  provider: "exness",
  product: "cfd",
  symbol: "XAUUSD",
  native_symbol: "XAUUSDm",
  direction: "long",
  opened_at: "2026-11-01T00:00:00.000Z",
  closed_at: "2026-11-01T00:05:00.000Z",
  timeframe: "1m",
  price_type: "both",
  range: { from: "2026-10-31T23:59:00.000Z", to: "2026-11-01T00:06:00.000Z" },
  candles: [
    {
      provider: "exness", product: "cfd", native_symbol: "XAUUSDm", normalized_symbol: "XAUUSD", timeframe: "1m", series_basis: "ask",
      open_time: "2026-11-01T00:00:00.000Z", close_time: "2026-11-01T00:01:00.000Z", open: "2701", high: "2702", low: "2700", close: "2701.5", volume: "12", source: "signed_account", source_timestamp: "2026-11-01T00:01:00.000Z", fetched_at: "2026-11-01T00:06:00.000Z", status: "final", gap_before: false, gap_after: false,
    },
    {
      provider: "exness", product: "cfd", native_symbol: "XAUUSDm", normalized_symbol: "XAUUSD", timeframe: "1m", series_basis: "bid",
      open_time: "2026-11-01T00:00:00.000Z", close_time: "2026-11-01T00:01:00.000Z", open: "2700", high: "2701", low: "2699", close: "2700.5", volume: "10", source: "signed_account", source_timestamp: "2026-11-01T00:01:00.000Z", fetched_at: "2026-11-01T00:06:00.000Z", status: "final", gap_before: false, gap_after: true,
    },
    {
      provider: "exness", product: "cfd", native_symbol: "XAUUSDm", normalized_symbol: "XAUUSD", timeframe: "1m", series_basis: "bid",
      open_time: "2026-11-01T00:03:00.000Z", close_time: "2026-11-01T00:04:00.000Z", open: "2695", high: "2697", low: "2694", close: "2696", volume: "9", source: "signed_account", source_timestamp: "2026-11-01T00:04:00.000Z", fetched_at: "2026-11-01T00:06:00.000Z", status: "final", gap_before: true, gap_after: false,
    },
    {
      provider: "exness", product: "cfd", native_symbol: "XAUUSDm", normalized_symbol: "XAUUSD", timeframe: "1m", series_basis: "ask",
      open_time: "2026-11-01T00:03:00.000Z", close_time: "2026-11-01T00:04:00.000Z", open: "2696", high: "2698", low: "2695", close: "2697", volume: "11", source: "signed_account", source_timestamp: "2026-11-01T00:04:00.000Z", fetched_at: "2026-11-01T00:06:00.000Z", status: "final", gap_before: true, gap_after: false,
    },
  ],
  markers: [
    fill("7:42", "2026-11-01T00:00:10.000Z", "open", "2700.1"),
    fill("7:43", "2026-11-01T00:00:20.000Z", "add", "2700.2"),
    fill("7:44", "2026-11-01T00:02:30.000Z", "reduce", "2698", "sell", "long"),
    fill("7:45", "2026-11-01T00:03:10.000Z", "close", "2695.5", "sell", "long"),
    fill("7:46", "2026-11-01T00:03:20.000Z", "reverse_open", "2695.4", "sell", "short"),
  ],
  chart_state: null,
  coverage: {
    status: "gapped",
    source: "signed_account",
    fetched_at: "2026-11-01T00:06:00.000Z",
    gaps: [{ series_basis: "bid", from: "2026-11-01T00:01:00.000Z", to: "2026-11-01T00:03:00.000Z" }],
    unavailable_reason: null,
  },
  warnings: ["historical_gap"],
} satisfies TradeChartProjection;

type EngineSpies = WaveKbChartEngine & {
  setCandles: ReturnType<typeof vi.fn>;
  setCandleGaps: ReturnType<typeof vi.fn>;
  setFillClusters: ReturnType<typeof vi.fn>;
  setMarkers: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  markerClick(markerId: string | null): void;
  markerUnsubscribe: ReturnType<typeof vi.fn>;
};

function engineSpies(): EngineSpies {
  let markerListener: ((markerId: string | null) => void) | null = null;
  const markerUnsubscribe = vi.fn(() => { markerListener = null; });
  const engine = {
    setCandles: vi.fn(),
    setCandleGaps: vi.fn(),
    setFillClusters: vi.fn(),
    setMarkers: vi.fn(),
    setIndicators: vi.fn(async () => undefined),
    setDrawings: vi.fn(async () => undefined),
    armDrawingTool: vi.fn(async () => undefined),
    cancelDrawingTool: vi.fn(() => false),
    undoDrawings: vi.fn(() => false),
    redoDrawings: vi.fn(() => false),
    getDrawings: vi.fn(() => ({ schemaVersion: "wavekb-chart-drawings-v1" as const, drawings: [] })),
    subscribeDrawings: vi.fn(() => vi.fn()),
    subscribeMarkerClicks: vi.fn((listener) => { markerListener = listener; return markerUnsubscribe; }),
    setTheme: vi.fn(),
    resize: vi.fn(),
    setViewport: vi.fn(),
    getViewport: vi.fn(() => ({ from: 0, to: 10 })),
    destroy: vi.fn(),
    markerClick(markerId: string | null) { markerListener?.(markerId); },
    markerUnsubscribe,
  };
  return engine as unknown as EngineSpies;
}

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  constructor(readonly callback: ResizeObserverCallback) { ResizeObserverStub.instances.push(this); }
}

beforeEach(() => {
  createEngine.mockReset();
  ResizeObserverStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const className = (element as HTMLElement).className;
    const backgroundColor = String(className).includes("bg-primary") ? "rgb(63, 111, 159)"
      : String(className).includes("bg-success") ? "rgb(29, 110, 78)"
        : String(className).includes("bg-destructive") ? "rgb(180, 35, 46)"
          : "rgb(255, 255, 255)";
    return {
      backgroundColor,
      color: "rgb(24, 33, 44)",
      borderTopColor: String(className).includes("border-border-subtle") ? "rgb(230, 235, 241)" : "rgb(216, 222, 231)",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAlgoTradeChart", () => {
  it("keeps initial loading and transport errors distinct from an engine failure or an empty list", () => {
    const { rerender } = render(<OpenAlgoTradeChart projection={null} loading />);
    expect(screen.getByText("行情加载中…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<OpenAlgoTradeChart projection={null} loadError="unavailable" />);
    expect(screen.getByText("暂时无法读取逐笔成交。")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("暂无逐笔成交。")).toBeNull();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("creates only after mount, uses deterministic bid candles and installs one semantic marker per chartable fill", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);

    renderToString(<OpenAlgoTradeChart projection={projection} />);
    expect(createEngine).not.toHaveBeenCalled();

    render(<OpenAlgoTradeChart projection={projection} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledOnce());
    expect(screen.getByText("双报价 · 当前显示 Bid（买价）")).toBeTruthy();
    expect(engine.setCandles).toHaveBeenCalledWith([
      expect.objectContaining({ time: 1_793_491_200, open: 2700, close: 2700.5 }),
      expect.objectContaining({ time: 1_793_491_380, open: 2695, close: 2696 }),
    ]);

    const markers = engine.setMarkers.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(markers.filter(({ id }) => String(id).startsWith("fill:")).map(({ id }) => id))
      .toEqual(["fill:7:42", "fill:7:43", "fill:7:45", "fill:7:46"]);
    expect(markers.find(({ id }) => id === "fill:7:42")).toMatchObject({ shape: "arrowUp", text: "开", textColor: "rgb(24, 33, 44)" });
    expect(markers.find(({ id }) => id === "fill:7:43")).toMatchObject({ shape: "circle", text: "加", textColor: "rgb(24, 33, 44)" });
    expect(markers.find(({ id }) => id === "fill:7:45")).toMatchObject({ text: "平" });
    expect(markers.find(({ id }) => id === "fill:7:46")).toMatchObject({ text: "反" });
    expect(screen.getByText("该成交位于行情缺口，未附着到 K 线。" )).toBeTruthy();
  });

  it("marks only the visible price basis's exact gap range and leaves real candles unchanged", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    render(<OpenAlgoTradeChart projection={projection} />);

    await waitFor(() => expect(engine.setCandleGaps).toHaveBeenCalledWith([
      { from: 1_793_491_260, to: 1_793_491_380 },
    ]));
    expect(engine.setCandles.mock.calls[0]?.[0]).toHaveLength(2);
    expect(screen.getByText("2026-11-01T00:01:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-11-01T00:03:00.000Z")).toBeTruthy();
  });

  it("keeps all five fill roles visually distinct when each fill has a real candle", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    const withChartedReduce = {
      ...projection,
      markers: projection.markers.map((item) => item.allocation_role === "reduce"
        ? { ...item, occurred_at: "2026-11-01T00:03:30.000Z" }
        : item),
    } satisfies TradeChartProjection;

    render(<OpenAlgoTradeChart projection={withChartedReduce} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledOnce());

    const markers = (engine.setMarkers.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>)
      .filter(({ id }) => String(id).startsWith("fill:"));
    expect(markers).toHaveLength(5);
    expect(new Set(markers.map(({ shape }) => shape)).size).toBe(5);
    expect(markers.find(({ id }) => id === "fill:7:44")).toMatchObject({ shape: "diamond", text: "减" });
  });

  it("expands a same-candle cluster and synchronizes chart and list selection", async () => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    render(<OpenAlgoTradeChart projection={projection} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledOnce());

    expect(engine.setFillClusters).toHaveBeenCalledWith([
      { id: "cluster:1793491200", time: 1793491200, count: 2 },
      { id: "cluster:1793491380", time: 1793491380, count: 2 },
    ]);
    act(() => engine.markerClick("cluster:1793491200"));
    expect(screen.getByRole("heading", { name: "同 K 线成交（2 笔）" })).toBeTruthy();

    act(() => engine.markerClick("fill:7:42"));
    expect(screen.getByRole("heading", { name: "同 K 线成交（2 笔）" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "逐笔成交" })).getByRole("button", { name: /开仓.*2700\.1/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /选择加仓.*2700\.2/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /选择加仓.*2700\.2/ }));
    expect(within(screen.getByRole("list", { name: "逐笔成交" })).getByRole("button", { name: /加仓.*2700\.2/ }).getAttribute("aria-pressed")).toBe("true");
    const selectedMarkers = engine.setMarkers.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(selectedMarkers.find(({ id }) => id === "fill:7:43")).toMatchObject({ size: "big", text: "加 ✓", bold: true });

    act(() => engine.markerClick(null));
    expect(screen.queryByRole("heading", { name: /同 K 线成交/ })).toBeNull();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("pans a zoomed chart to an offscreen candle from the fill list and preserves zoom", async () => {
    const engine = engineSpies();
    engine.getViewport.mockReturnValue({ from: -0.5, to: 0.5 });
    createEngine.mockResolvedValue(engine);
    render(<OpenAlgoTradeChart projection={projection} />);
    await waitFor(() => expect(engine.setViewport).toHaveBeenCalledWith(null));

    const list = within(screen.getByRole("list", { name: "逐笔成交" }));
    fireEvent.click(list.getByRole("button", { name: /开仓.*2700\.1/ }));
    expect(engine.setViewport).toHaveBeenCalledOnce();
    fireEvent.click(list.getByRole("button", { name: /平仓.*2695\.5/ }));
    expect(engine.setViewport).toHaveBeenLastCalledWith({ from: 0.5, to: 1.5 });
  });

  it("updates chart colors when WaveKB mode, palette or the system color preference change", async () => {
    const engine = engineSpies();
    const media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", () => media);
    createEngine.mockResolvedValue(engine);
    const element = document.documentElement;
    const oldMode = element.getAttribute("data-wavekb-mode");
    const oldTheme = element.getAttribute("data-wavekb-theme");
    try {
      render(<OpenAlgoTradeChart projection={projection} />);
      await waitFor(() => expect(engine.setTheme).toHaveBeenCalledTimes(1));

      element.setAttribute("data-wavekb-mode", "dark");
      await waitFor(() => expect(engine.setTheme).toHaveBeenCalledTimes(2));
      element.setAttribute("data-wavekb-theme", "ink");
      await waitFor(() => expect(engine.setTheme).toHaveBeenCalledTimes(3));
      act(() => media.dispatchEvent(new Event("change")));
      expect(engine.setTheme).toHaveBeenCalledTimes(4);
    } finally {
      if (oldMode === null) element.removeAttribute("data-wavekb-mode");
      else element.setAttribute("data-wavekb-mode", oldMode);
      if (oldTheme === null) element.removeAttribute("data-wavekb-theme");
      else element.setAttribute("data-wavekb-theme", oldTheme);
    }
  });

  it("resizes, unsubscribes and destroys on projection reload and unmount", async () => {
    const first = engineSpies();
    const second = engineSpies();
    createEngine.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { rerender, unmount } = render(<OpenAlgoTradeChart projection={projection} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledOnce());

    act(() => ResizeObserverStub.instances[0]?.callback([
      { contentRect: { width: 720, height: 420 } } as ResizeObserverEntry,
    ], ResizeObserverStub.instances[0] as unknown as ResizeObserver));
    expect(first.resize).toHaveBeenCalledWith(720, 420, 2);

    rerender(<OpenAlgoTradeChart projection={{ ...projection, timeframe: "5m" }} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledTimes(2));
    expect(first.markerUnsubscribe).toHaveBeenCalledOnce();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(ResizeObserverStub.instances[0]?.disconnect).toHaveBeenCalledOnce();

    unmount();
    expect(second.markerUnsubscribe).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(ResizeObserverStub.instances[1]?.disconnect).toHaveBeenCalledOnce();
  });

  it("destroys an engine that resolves after the component was unmounted", async () => {
    const late = engineSpies();
    let resolveEngine!: (engine: WaveKbChartEngine) => void;
    createEngine.mockReturnValue(new Promise<WaveKbChartEngine>((resolve) => { resolveEngine = resolve; }));
    const { unmount } = render(<OpenAlgoTradeChart projection={projection} />);
    await waitFor(() => expect(createEngine).toHaveBeenCalledOnce());
    unmount();
    await act(async () => resolveEngine(late));
    expect(late.destroy).toHaveBeenCalledOnce();
    expect(late.setCandles).not.toHaveBeenCalled();
  });

  it.each([
    ["partial", [], "行情仅覆盖部分时间范围"],
    ["gapped", ["historical_gap"], "行情存在缺口"],
    ["stale", ["stale_cache"], "当前显示缓存行情，可能不是最新"],
    ["complete", ["rate_limited"], "行情接口已限流，当前结果可能不完整"],
    ["unavailable", ["candles_unavailable"], "行情暂不可用"],
  ] as const)("shows the %s degraded state without removing the fill list", async (status, warnings, message) => {
    const engine = engineSpies();
    createEngine.mockResolvedValue(engine);
    const value = {
      ...projection,
      candles: status === "unavailable" ? [] : projection.candles,
      coverage: { ...projection.coverage, status, gaps: status === "gapped" ? projection.coverage.gaps : [] },
      warnings: [...warnings],
    } satisfies TradeChartProjection;
    render(<OpenAlgoTradeChart projection={value} />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole("list", { name: "逐笔成交" })).toBeTruthy();
    if (status === "unavailable") {
      expect(screen.getAllByText("未在图表显示。")).toHaveLength(projection.markers.length);
      expect(screen.queryByText(/该成交位于行情缺口/)).toBeNull();
    }
  });

  it("keeps the fill list usable when the engine fails or a candle decimal is unsafe", async () => {
    createEngine.mockRejectedValueOnce(new Error("PRIVATE_ENGINE_FAILURE"));
    const { rerender } = render(<OpenAlgoTradeChart projection={projection} />);
    expect(await screen.findByText("图表未能加载，逐笔成交仍可查看。" )).toBeTruthy();
    expect(document.body.textContent).not.toContain("PRIVATE_ENGINE_FAILURE");
    expect(screen.getByRole("list", { name: "逐笔成交" })).toBeTruthy();

    const unsafe = {
      ...projection,
      candles: projection.candles.map((candle, index) => index === 1 ? { ...candle, open: "Infinity" } : candle),
    } satisfies TradeChartProjection;
    rerender(<OpenAlgoTradeChart projection={unsafe} />);
    expect(await screen.findByText("图表数据格式异常，逐笔成交仍可查看。" )).toBeTruthy();
    expect(createEngine).toHaveBeenCalledOnce();
  });

  it("destroys a partially initialized engine when setup throws", async () => {
    const engine = engineSpies();
    engine.setCandles.mockImplementation(() => { throw new Error("setup failed"); });
    createEngine.mockResolvedValue(engine);

    render(<OpenAlgoTradeChart projection={projection} />);

    expect(await screen.findByText("图表未能加载，逐笔成交仍可查看。" )).toBeTruthy();
    expect(engine.destroy).toHaveBeenCalledOnce();
    expect(screen.getByRole("list", { name: "逐笔成交" })).toBeTruthy();
  });
});
