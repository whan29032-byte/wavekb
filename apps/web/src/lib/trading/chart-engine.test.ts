import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPrimitive, PrimitiveRenderContext } from "openalgo-charts";

import {
  ELLIOTT_DRAWING_TOOL_IDS,
  WAVEKB_DRAWING_DOCUMENT_SCHEMA,
  createWaveKbChartEngine,
} from "./chart-engine";

const library = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  const state = {
    candles: [] as unknown[],
    markers: [] as unknown[],
    primitives: new Set<IPrimitive>(),
    chartOptions: null as Record<string, unknown> | null,
    indicators: [] as Array<{ id: string; indicatorId: string }>,
    failingIndicator: null as string | null,
    drawings: { version: 2, drawings: [] } as {
      version: number;
      drawings: Array<Record<string, unknown>>;
    },
    viewport: { from: 0, to: 10 },
    activeTool: null as string | null,
    undoCount: 0,
    redoCount: 0,
    chartDestroyCount: 0,
    drawingCreateCount: 0,
    drawingDestroyCount: 0,
    theme: null as Record<string, unknown> | null,
    size: null as { width: number; height: number } | null,
    handlers: new Map<string, Set<(payload: unknown) => void>>(),
  };

  const emit = (event: string, payload: unknown) => {
    for (const handler of state.handlers.get(event) ?? []) {
      handler(payload);
    }
  };

  return {
    state,
    emit,
    gates: {
      indicators: deferred(),
      draw: deferred(),
    },
  };
});

vi.mock("openalgo-charts", () => ({
  lightTheme: {},
  createChart: (_container: HTMLElement, options: Record<string, unknown>) => {
    library.state.chartOptions = options;
    return {
      addSeries: () => ({
        setData: (candles: unknown[]) => {
          library.state.candles = candles;
        },
        createMarkers: () => ({
          setMarkers: (markers: unknown[]) => {
            library.state.markers = markers;
          },
        }),
      }),
      addIndicator: (indicatorId: string, _settings: unknown, options: { instanceId: string }) => {
        const indicator = { id: options.instanceId, indicatorId };
        library.state.indicators.push(indicator);
        return indicator;
      },
      indicators: () => {
        if (library.state.indicators.some(({ indicatorId }) => indicatorId === library.state.failingIndicator)) {
          throw new Error("indicator computation failed");
        }
        return library.state.indicators;
      },
      removeIndicator: (instanceId: string) => {
        library.state.indicators = library.state.indicators.filter(({ id }) => id !== instanceId);
        return true;
      },
      addPrimitive: (primitive: IPrimitive) => library.state.primitives.add(primitive),
      removePrimitive: (primitive: IPrimitive) => library.state.primitives.delete(primitive),
      getVisibleLogicalRange: () => library.state.viewport,
      setVisibleLogicalRange: (viewport: { from: number; to: number }) => {
        library.state.viewport = viewport;
      },
      fitContent: () => {
        library.state.viewport = { from: 0, to: 0 };
      },
      on: (event: string, handler: (payload: unknown) => void) => {
        const handlers = library.state.handlers.get(event) ?? new Set();
        handlers.add(handler);
        library.state.handlers.set(event, handlers);
        return () => handlers.delete(handler);
      },
      setTheme: (theme: Record<string, unknown>) => {
        library.state.theme = theme;
      },
      applySize: (width: number, height: number) => {
        library.state.size = { width, height };
      },
      emit: library.emit,
      destroy: () => {
        library.state.chartDestroyCount += 1;
      },
    };
  },
}));

vi.mock("openalgo-charts/indicators", async () => {
  await library.gates.indicators.promise;
  return { INDICATORS_TIER: "indicators" };
});

vi.mock("openalgo-charts/draw", async () => {
  await library.gates.draw.promise;
  return {
    hasDrawingTool: () => true,
    DrawingController: class {
      constructor() {
        library.state.drawingCreateCount += 1;
      }

      setTool(toolId: string | null) {
        library.state.activeTool = toolId;
      }

      cancel() {
        const changed = library.state.activeTool !== null;
        library.state.activeTool = null;
        return changed;
      }

      undo() {
        library.state.undoCount += 1;
        return true;
      }

      redo() {
        library.state.redoCount += 1;
        return true;
      }

      fromJSON(drawings: typeof library.state.drawings) {
        library.state.drawings = drawings;
        library.emit("draw:restore", {});
      }

      get(id: string) {
        return library.state.drawings.drawings.find((drawing) => drawing.id === id);
      }

      update(id: string, patch: Record<string, unknown>) {
        const drawing = this.get(id);
        if (!drawing) return false;
        Object.assign(drawing, patch);
        library.emit("drawing:change", { kind: "update", ids: [id] });
        return true;
      }

      remove(id: string) {
        if (!this.get(id)) return false;
        library.state.drawings.drawings = library.state.drawings.drawings.filter((drawing) => drawing.id !== id);
        library.emit("drawing:change", { kind: "remove", ids: [id] });
        return true;
      }

      toJSON() {
        return library.state.drawings;
      }

      destroy() {
        library.state.drawingDestroyCount += 1;
      }
    },
  };
});

describe.sequential("WaveKB chart engine boundary", () => {
  afterEach(() => {
    library.state.candles = [];
    library.state.markers = [];
    library.state.primitives.clear();
    library.state.chartOptions = null;
    library.state.indicators = [];
    library.state.failingIndicator = null;
    library.state.drawings = { version: 2, drawings: [] };
    library.state.viewport = { from: 0, to: 10 };
    library.state.activeTool = null;
    library.state.undoCount = 0;
    library.state.redoCount = 0;
    library.state.chartDestroyCount = 0;
    library.state.drawingCreateCount = 0;
    library.state.drawingDestroyCount = 0;
    library.state.theme = null;
    library.state.size = null;
    library.state.handlers.clear();
    vi.unstubAllGlobals();
  });

  it("shades the reported discontinuity without adding bars to the price series", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const candles = [
      { time: 0, open: 10, high: 13, low: 9, close: 11 },
      { time: 180, open: 11, high: 14, low: 10, close: 12 },
    ];
    engine.setCandles(candles);
    engine.setCandleGaps([{ from: 60, to: 180 }]);

    const region = [...library.state.primitives][0]!;
    expect(region.zOrder()).toBe("bottom");
    const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn() };
    const rc = {
      dataLayer: { timeToIndexFloat: (time: number) => time / 180 },
      timeScale: { indexToX: (index: number) => 10 + 12 * index, barSpacing: 12 },
      plotWidth: 40, plotHeight: 100, dpr: 2, theme: { axisLine: "#000" },
    } as unknown as PrimitiveRenderContext;
    region.draw(ctx as unknown as CanvasRenderingContext2D, rc);
    expect(ctx.fillRect).toHaveBeenCalledWith(16, 0, 16, 200);
    expect(library.state.candles).toEqual(candles);

    engine.setCandleGaps([]);
    expect(library.state.primitives.size).toBe(0);
    engine.destroy();
  });

  it("hits the visible cluster count label anywhere in the chip body", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"), { ariaLabel: "成交 K 线图" });
    expect(library.state.chartOptions?.ariaLabel).toBe("成交 K 线图");
    engine.setFillClusters([{ id: "cluster:180", time: 180, count: 8 }]);
    const badges = [...library.state.primitives][0]!;
    const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), fillText: vi.fn() };
    const rc = {
      dataLayer: { timeToIndex: () => 3 },
      timeScale: { indexToX: () => 60 },
      plotWidth: 120, plotHeight: 160, dpr: 2,
      theme: { axisText: "#000", background: "#fff" },
    } as unknown as PrimitiveRenderContext;
    badges.draw(ctx as unknown as CanvasRenderingContext2D, rc);
    expect(ctx.fillText).toHaveBeenCalledWith("+8", 120, 34);
    expect(badges.hitTest?.(70, 22, rc)).toMatchObject({ externalId: "cluster:180", distance: 0 });
    expect(badges.hitTest?.(70, 30, rc)).toBeNull();
    engine.destroy();
  });

  it("does not add indicators when their tier finishes loading after destroy", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const update = engine.setIndicators([
      { instanceId: "study-1", indicatorId: "sma", settings: { length: 20 } },
    ]);

    engine.destroy();
    library.gates.indicators.resolve();

    await expect(update).rejects.toThrow("destroyed");
    expect(library.state.indicators).toEqual([]);
  });

  it("keeps the indicator selection empty if it was cleared while the study tier was loading", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const pending = engine.setIndicators([{ instanceId: "removed-sma", indicatorId: "sma" }]);
    await engine.setIndicators([]);
    library.gates.indicators.resolve();
    await pending;
    expect(library.state.indicators).toEqual([]);
    engine.destroy();
  });

  it("does not retain a drawing controller when its tier finishes loading after destroy", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const arm = Promise.resolve().then(() => engine.armDrawingTool("elliott-impulse"));

    engine.destroy();
    library.gates.draw.resolve();

    await expect(arm).rejects.toThrow("destroyed");
    expect(library.state.drawingCreateCount).toBe(0);
    expect(library.state.drawingDestroyCount).toBe(0);
  });

  it("exposes bounded manual drawing interaction without leaking controller state", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const changes: unknown[] = [];
    const unsubscribe = engine.subscribeDrawings((change) => changes.push(change));

    expect(engine).toEqual(expect.objectContaining({
      armDrawingTool: expect.any(Function),
      cancelDrawingTool: expect.any(Function),
      undoDrawings: expect.any(Function),
      redoDrawings: expect.any(Function),
      getDrawings: expect.any(Function),
      subscribeDrawings: expect.any(Function),
      setDrawings: expect.any(Function),
    }));

    await engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        id: "drawing-1",
        tool: "elliott-impulse",
        points: Array.from({ length: 6 }, (_, index) => ({
          time: 1_700_000_000 + index * 60,
          price: 100 + index,
        })),
        paneIndex: 0,
        style: {},
        properties: { degree: "minor", labelStyle: "plain" },
        zIndex: 0,
      }],
    });
    await engine.armDrawingTool("fib-retracement");

    expect(library.state.activeTool).toBe("fib-retracement");
    expect(engine.cancelDrawingTool()).toBe(true);
    expect(engine.undoDrawings()).toBe(true);
    expect(engine.redoDrawings()).toBe(true);
    expect(library.state.drawings).toEqual({
      version: 2,
      drawings: [expect.objectContaining({
        id: "drawing-1",
        tool: "elliott-impulse",
        props: { degree: "minor", labelStyle: "plain" },
      })],
    });

    library.state.drawings.drawings[0] = {
      ...library.state.drawings.drawings[0],
      createdAt: 123,
      intervals: { from: "1m" },
    };
    library.emit("drawing:change", { ids: ["drawing-1"], kind: "update" });

    expect(changes.at(-1)).toEqual({
      kind: "update",
      drawingIds: ["drawing-1"],
      document: {
        schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
        drawings: [expect.objectContaining({
          id: "drawing-1",
          tool: "elliott-impulse",
          properties: { degree: "minor", labelStyle: "plain" },
        })],
      },
    });
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.props");
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.createdAt");
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.intervals");

    library.state.drawings.drawings[0] = {
      ...library.state.drawings.drawings[0],
      props: { degree: "minor", labelStyle: "plain", executable: "drop-me" },
    };
    library.emit("drawing:change", { ids: ["drawing-1"], kind: "update" });
    expect(changes.at(-1)).toEqual({
      kind: "update",
      drawingIds: ["drawing-1"],
      document: {
        schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
        drawings: [expect.objectContaining({
          id: "drawing-1",
          properties: { degree: "minor", labelStyle: "plain" },
        })],
      },
    });
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.properties.executable");

    unsubscribe();
    engine.destroy();
  });

  it("keeps chart and drawing teardown idempotent", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    await engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [],
    });

    engine.destroy();
    engine.destroy();

    expect(library.state.drawingDestroyCount).toBe(1);
    expect(library.state.chartDestroyCount).toBe(1);
  });

  it("rejects application drawings that contradict the audited tool schema", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const base = {
      id: "invalid-tool-shape",
      tool: "trend-line" as const,
      points: [{ time: 1_700_000_000, price: 100 }],
      paneIndex: 0,
      style: {},
      zIndex: 0,
    };

    await expect(engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [base],
    })).rejects.toThrow(/points/i);
    await expect(engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        ...base,
        points: [...base.points, { time: 1_700_000_060, price: 101 }],
        style: { levels: [{ ratio: 0.618 }] },
      }],
    })).rejects.toThrow(/style/i);
    await expect(engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        ...base,
        tool: "text",
        style: {},
        text: { color: "#fff" },
      }],
    })).rejects.toThrow(/text/i);

    engine.destroy();
  });

  it("round-trips public two-anchor position tools and bounded audited settings", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const positionPoints = [
      { time: 1_700_000_000, price: 100 },
      { time: 1_700_000_060, price: 110 },
    ];

    await engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        id: "position-1",
        tool: "long-position",
        points: positionPoints,
        paneIndex: 0,
        style: { accountSize: 100_000, risk: 1, showLabels: true },
        zIndex: 0,
      }, {
        id: "ray-1",
        tool: "ray",
        points: positionPoints,
        paneIndex: 0,
        style: { showStats: true },
        zIndex: 1,
      }],
    });

    expect(library.state.drawings).toEqual({
      version: 2,
      drawings: [
        expect.objectContaining({
          id: "position-1",
          points: [...positionPoints, { time: 1_700_000_060, price: 95 }],
          style: { accountSize: 100_000, risk: 1, showLabels: true },
        }),
        expect.objectContaining({ id: "ray-1", style: { showStats: true } }),
      ],
    });
    expect(engine.getDrawings().drawings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "position-1", points: positionPoints, style: { accountSize: 100_000, risk: 1, showLabels: true } }),
      expect.objectContaining({ id: "ray-1", style: { showStats: true } }),
    ]));

    expect(engine.getDrawings().drawings[0]).not.toHaveProperty("properties.stopTime");
    expect(engine.getDrawings().drawings[0]).not.toHaveProperty("properties.stopPrice");

    engine.destroy();
  });

  it("round-trips a non-default independently dragged position stop without persisting controller state", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const points = [
      { time: 1_700_000_000, price: 100 },
      { time: 1_700_000_060, price: 110 },
    ];
    const customStop = { time: 1_700_000_090, price: 82 };

    await engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        id: "custom-stop",
        tool: "long-position",
        points,
        paneIndex: 0,
        style: {},
        properties: { showHeader: true, stopTime: customStop.time, stopPrice: customStop.price },
        zIndex: 0,
      }],
    });

    expect(library.state.drawings.drawings[0]).toEqual(expect.objectContaining({
      points: [...points, customStop],
      props: { showHeader: true },
    }));
    expect(library.state.drawings.drawings[0]?.props).not.toHaveProperty("stopTime");
    expect(library.state.drawings.drawings[0]?.props).not.toHaveProperty("stopPrice");

    const persisted = engine.getDrawings();
    expect(persisted.drawings[0]).toEqual(expect.objectContaining({
      points,
      properties: { showHeader: true, stopTime: customStop.time, stopPrice: customStop.price },
    }));

    await engine.setDrawings(persisted);
    expect(library.state.drawings.drawings[0]).toEqual(expect.objectContaining({
      points: [...points, customStop],
      props: { showHeader: true },
    }));
    engine.destroy();
  });

  it("strictly rejects illegal WaveKB drawing values while tolerating non-persisted library fields", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const base = {
      id: "strict-input",
      tool: "trend-line" as const,
      points: [
        { time: 1_700_000_000, price: 100 },
        { time: 1_700_000_060, price: 110 },
      ],
      paneIndex: 0,
      style: {},
      zIndex: 0,
    };

    for (const drawing of [
      { ...base, style: { showStats: "yes" } },
      { ...base, style: { lineStyle: ["solid"] } },
      { ...base, style: { lineWidth: 0 } },
      { ...base, unknownState: true },
      { ...base, tool: "rectangle" as const, text: { value: "note", align: "diagonal" } },
      { ...base, tool: "rectangle" as const, text: { value: "note", align: ["left"] } },
      {
        ...base,
        tool: "long-position" as const,
        style: { accountSize: "100000", risk: 1 },
      },
      {
        ...base,
        tool: "short-position" as const,
        style: { accountSize: 100_000, risk: "1" },
      },
      {
        ...base,
        tool: "long-position" as const,
        style: {},
        properties: { stopTime: 1_700_000_090 },
      },
      {
        ...base,
        tool: "short-position" as const,
        style: {},
        properties: { controllerPoint: { time: 1, price: 1 } },
      },
    ]) {
      await expect(engine.setDrawings({
        schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
        drawings: [drawing as never],
      })).rejects.toThrow(/drawing/i);
    }

    await engine.setDrawings({ schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA, drawings: [] });
    library.state.drawings.drawings = [{
      ...base,
      tool: "long-position",
      points: [...base.points, { time: 1_700_000_060, price: 95 }],
      style: { accountSize: 100_000, risk: 1, libraryOnly: "discard" },
      text: { color: "#ffffff", libraryOnly: "discard" },
      props: { showHeader: true, libraryOnly: "discard" },
      createdAt: 123,
    }];
    expect(engine.getDrawings().drawings).toEqual([
      expect.objectContaining({
        id: "strict-input",
        style: { accountSize: 100_000, risk: 1 },
        text: { color: "#ffffff" },
        properties: { showHeader: true },
      }),
    ]);
    engine.destroy();
  });

  it("rejects unsafe public position setting bounds", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const base = {
      id: "position-invalid",
      tool: "short-position" as const,
      points: [
        { time: 1_700_000_000, price: 100 },
        { time: 1_700_000_060, price: 90 },
      ],
      paneIndex: 0,
      zIndex: 0,
    };

    for (const style of [
      { accountSize: -1 },
      { accountSize: 1_000_000_000_000_001 },
      { risk: -0.1 },
      { risk: 100.1 },
    ]) {
      await expect(engine.setDrawings({
        schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
        drawings: [{ ...base, style }],
      })).rejects.toThrow(/style/i);
    }

    engine.destroy();
  });

  it("does not restore drawings when destroy wins the setDrawings continuation", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    await engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [],
    });
    const update = engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        id: "late-drawing",
        tool: "trend-line",
        points: [
          { time: 1_700_000_000, price: 100 },
          { time: 1_700_000_060, price: 105 },
        ],
        paneIndex: 0,
        style: {},
        zIndex: 0,
      }],
    });

    engine.destroy();

    await expect(update).rejects.toThrow("destroyed");
    expect(library.state.drawings.drawings).toEqual([]);
  });

  it("rejects chart creation outside a browser before loading the engine", async () => {
    vi.stubGlobal("window", undefined);

    await expect(
      createWaveKbChartEngine(document.createElement("div")),
    ).rejects.toThrow("only be created in a browser");
  });

  it("still supports candles, markers, indicators, and viewport updates", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));

    engine.setCandles([
      { time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105 },
    ]);
    engine.setMarkers([{
      id: "fill-1",
      time: 1_700_000_000,
      price: 100,
      position: "atPrice",
      shape: "arrowUp",
      size: "small",
      color: "#15803d",
    }]);
    await engine.setIndicators([
      { instanceId: "study-1", indicatorId: "sma", settings: { length: 20 } },
    ]);
    engine.setViewport({ from: 2, to: 8 });

    expect(library.state.candles).toHaveLength(1);
    expect(library.state.markers).toHaveLength(1);
    expect(library.state.indicators).toEqual([{ id: "study-1", indicatorId: "sma" }]);
    expect(engine.getViewport()).toEqual({ from: 2, to: 8 });

    engine.destroy();
  });

  it("removes only the study whose deferred computation fails", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    library.state.failingIndicator = "ema";
    const errors = await engine.setIndicators([
      { instanceId: "fast", indicatorId: "sma" },
      { instanceId: "broken", indicatorId: "ema" },
      { instanceId: "slow", indicatorId: "sma" },
    ]);
    expect(errors).toEqual(["broken"]);
    expect(library.state.indicators.map(({ id }) => id)).toEqual(["fast", "slow"]);
    engine.destroy();
  });

  it("edits drawing visibility and text through the change stream and rejects HTML", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    await engine.setDrawings({
      schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA,
      drawings: [{
        id: "note", tool: "text", paneIndex: 0, zIndex: 0,
        points: [{ time: 1700000000, price: 20 }],
        style: {},
        text: { value: "旧文字", color: "#223344" },
      }],
    });
    const changed = vi.fn();
    const stop = engine.subscribeDrawings(changed);
    expect(() => engine.setDrawingText("note", "<img src=x>")).toThrow();
    expect(changed).not.toHaveBeenCalled();
    expect(engine.setDrawingText("note", "复盘要点")).toBe(true);
    expect(engine.setDrawingVisibility("note", false)).toBe(true);
    expect(changed.mock.calls.at(-1)?.[0].document.drawings[0]).toMatchObject({
      visible: false, text: { value: "复盘要点", color: "#223344" },
    });
    expect(engine.removeDrawing("note")).toBe(true);
    expect(changed.mock.calls.at(-1)?.[0].document.drawings).toEqual([]);
    stop();
    engine.destroy();
  });

  it("forwards marker click identity and removes the listener when unsubscribed", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));
    const selected: Array<string | null> = [];
    const unsubscribe = engine.subscribeMarkerClicks((markerId) => selected.push(markerId));

    library.emit("click", { id: "fill:7:42" });
    library.emit("click", { id: null });
    unsubscribe();
    library.emit("click", { id: "fill:7:99" });

    expect(selected).toEqual(["fill:7:42", null]);
    expect(library.state.handlers.get("click")?.size ?? 0).toBe(0);
    engine.destroy();
  });

  it("maps resolved WaveKB colors to the chart theme and applies explicit size", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));

    engine.setTheme({
      background: "rgb(25, 35, 47)",
      grid: "rgb(43, 56, 71)",
      axisText: "rgb(174, 185, 199)",
      axisLine: "rgb(53, 67, 84)",
      primary: "rgb(139, 188, 245)",
      positive: "rgb(109, 211, 168)",
      negative: "rgb(255, 123, 133)",
    });
    engine.resize(640, 360, 2);

    expect(library.state.theme).toMatchObject({
      background: "rgb(25, 35, 47)",
      grid: "rgb(43, 56, 71)",
      axisText: "rgb(174, 185, 199)",
      axisLine: "rgb(53, 67, 84)",
      paneSeparator: "rgb(53, 67, 84)",
      crosshair: "rgb(139, 188, 245)",
      upColor: "rgb(109, 211, 168)",
      downColor: "rgb(255, 123, 133)",
      wickUpColor: "rgb(109, 211, 168)",
      wickDownColor: "rgb(255, 123, 133)",
    });
    expect(JSON.stringify(library.state.theme)).not.toContain("var(");
    expect(library.state.size).toEqual({ width: 640, height: 360 });
    engine.destroy();
  });

  it("keeps the five audited Elliott identifiers in the WaveKB allowlist", () => {
    expect(ELLIOTT_DRAWING_TOOL_IDS).toEqual([
      "elliott-impulse",
      "elliott-correction",
      "elliott-triangle",
      "elliott-double-combo",
      "elliott-triple-combo",
    ]);
  });
});
