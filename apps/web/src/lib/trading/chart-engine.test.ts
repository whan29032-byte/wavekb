import { afterEach, describe, expect, it, vi } from "vitest";

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
    indicators: [] as Array<{ id: string; indicatorId: string }>,
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
  createChart: () => ({
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
    removeIndicator: (instanceId: string) => {
      library.state.indicators = library.state.indicators.filter(({ id }) => id !== instanceId);
      return true;
    },
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
    emit: library.emit,
    destroy: () => {
      library.state.chartDestroyCount += 1;
    },
  }),
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
    library.state.indicators = [];
    library.state.drawings = { version: 2, drawings: [] };
    library.state.viewport = { from: 0, to: 10 };
    library.state.activeTool = null;
    library.state.undoCount = 0;
    library.state.redoCount = 0;
    library.state.chartDestroyCount = 0;
    library.state.drawingCreateCount = 0;
    library.state.drawingDestroyCount = 0;
    library.state.handlers.clear();
    vi.unstubAllGlobals();
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
        points: [{ time: 1_700_000_000, price: 100 }],
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
          tool: "elliott-impulse",
          properties: { degree: "minor", labelStyle: "plain" },
        })],
      },
    });
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.props");
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.createdAt");
    expect(changes.at(-1)).not.toHaveProperty("document.drawings.0.intervals");

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
