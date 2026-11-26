import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ELLIOTT_DRAWING_TOOL_IDS,
  createWaveKbChartEngine,
} from "./chart-engine";

const library = vi.hoisted(() => {
  const state = {
    candles: [] as unknown[],
    markers: [] as unknown[],
    indicators: [] as Array<{ id: string; indicatorId: string }>,
    drawings: undefined as unknown,
    viewport: { from: 0, to: 10 },
    destroyed: false,
    drawingDestroyed: false,
  };

  return { state };
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
    destroy: () => {
      library.state.destroyed = true;
    },
  }),
}));

vi.mock("openalgo-charts/indicators", () => ({
  INDICATORS_TIER: "indicators",
}));

vi.mock("openalgo-charts/draw", () => ({
  DrawingController: class {
    fromJSON(drawings: unknown) {
      library.state.drawings = drawings;
    }

    destroy() {
      library.state.drawingDestroyed = true;
    }
  },
}));

describe("WaveKB chart engine boundary", () => {
  afterEach(() => {
    library.state.candles = [];
    library.state.markers = [];
    library.state.indicators = [];
    library.state.drawings = undefined;
    library.state.viewport = { from: 0, to: 10 };
    library.state.destroyed = false;
    library.state.drawingDestroyed = false;
  });

  it("creates a browser chart with the complete WaveKB lifecycle and update contract", async () => {
    const engine = await createWaveKbChartEngine(document.createElement("div"));

    expect(engine).toEqual(expect.objectContaining({
      destroy: expect.any(Function),
      setCandles: expect.any(Function),
      setMarkers: expect.any(Function),
      setIndicators: expect.any(Function),
      setDrawings: expect.any(Function),
      setViewport: expect.any(Function),
      getViewport: expect.any(Function),
    }));

    engine.setCandles([
      { time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105 },
    ]);
    engine.setMarkers([
      {
        id: "fill-1",
        time: 1_700_000_000,
        price: 100,
        position: "atPrice",
        shape: "arrowUp",
        size: "small",
        color: "#15803d",
      },
    ]);
    await engine.setIndicators([
      { instanceId: "study-1", indicatorId: "sma", settings: { length: 20 } },
    ]);
    await engine.setDrawings([
      {
        id: "drawing-1",
        tool: "elliott-impulse",
        points: [{ time: 1_700_000_000, price: 100 }],
        paneIndex: 0,
        style: {},
        zIndex: 0,
      },
    ]);
    engine.setViewport({ from: 2, to: 8 });

    expect(library.state.candles).toHaveLength(1);
    expect(library.state.markers).toHaveLength(1);
    expect(library.state.indicators).toEqual([{ id: "study-1", indicatorId: "sma" }]);
    expect(library.state.drawings).toEqual({
      version: 2,
      drawings: [expect.objectContaining({ id: "drawing-1", tool: "elliott-impulse" })],
    });
    expect(engine.getViewport()).toEqual({ from: 2, to: 8 });

    engine.destroy();
    expect(library.state.drawingDestroyed).toBe(true);
    expect(library.state.destroyed).toBe(true);
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
