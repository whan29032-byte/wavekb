export const ELLIOTT_DRAWING_TOOL_IDS = [
  "elliott-impulse",
  "elliott-correction",
  "elliott-triangle",
  "elliott-double-combo",
  "elliott-triple-combo",
] as const;

export interface WaveKbChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface WaveKbChartMarker {
  id: string;
  time: number;
  price?: number;
  position: "aboveBar" | "belowBar" | "inBar" | "atPrice" | "paneTop" | "paneBottom";
  shape:
    | "arrowUp"
    | "arrowDown"
    | "circle"
    | "square"
    | "triangleUp"
    | "triangleDown"
    | "diamond"
    | "flag"
    | "text"
    | "labelUp"
    | "labelDown"
    | "cross"
    | "xcross";
  size: "tiny" | "small" | "medium" | "big";
  color: string;
  text?: string;
  textColor?: string;
}

export interface WaveKbChartIndicator {
  instanceId: string;
  indicatorId: string;
  settings?: Record<string, unknown>;
  paneIndex?: number;
}

export interface WaveKbChartDrawingPoint {
  time: number;
  price: number;
}

export interface WaveKbChartDrawing {
  id: string;
  tool: string;
  points: WaveKbChartDrawingPoint[];
  style: {
    color?: string;
    lineWidth?: number;
    lineStyle?: "solid" | "dashed" | "dotted";
    fill?: boolean;
    fillColor?: string;
    fillOpacity?: number;
    extendLeft?: boolean;
    extendRight?: boolean;
    showLabels?: boolean;
    levels?: Array<{
      ratio: number;
      color?: string;
      enabled?: boolean;
      label?: string;
    }>;
  };
  text?: {
    value: string;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    align?: "left" | "center" | "right";
    valign?: "top" | "middle" | "bottom";
  };
  paneIndex: number;
  locked?: boolean;
  visible?: boolean;
  zIndex: number;
}

export interface WaveKbChartViewport {
  from: number;
  to: number;
}

export interface WaveKbChartEngine {
  setCandles(candles: readonly WaveKbChartCandle[]): void;
  setMarkers(markers: readonly WaveKbChartMarker[]): void;
  setIndicators(indicators: readonly WaveKbChartIndicator[]): Promise<void>;
  setDrawings(drawings: readonly WaveKbChartDrawing[]): Promise<void>;
  setViewport(viewport: WaveKbChartViewport | null): void;
  getViewport(): WaveKbChartViewport;
  destroy(): void;
}

export interface WaveKbChartEngineOptions {
  timezone?: string;
}

export async function createWaveKbChartEngine(
  container: HTMLElement,
  options: WaveKbChartEngineOptions = {},
): Promise<WaveKbChartEngine> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("WaveKB chart engine can only be created in a browser");
  }

  const { createChart } = await import("openalgo-charts");
  const chart = createChart(container, {
    branding: false,
    timezone: options.timezone ?? "UTC",
  });
  const candleSeries = chart.addSeries("candlestick");
  const markerLayer = candleSeries.createMarkers();

  let drawingController: InstanceType<
    typeof import("openalgo-charts/draw")["DrawingController"]
  > | null = null;
  let indicatorIds: string[] = [];
  let destroyed = false;

  const assertAlive = () => {
    if (destroyed) {
      throw new Error("WaveKB chart engine has been destroyed");
    }
  };

  return {
    setCandles(candles) {
      assertAlive();
      candleSeries.setData(candles);
    },
    setMarkers(markers) {
      assertAlive();
      markerLayer.setMarkers(markers);
    },
    async setIndicators(indicators) {
      assertAlive();
      await import("openalgo-charts/indicators");

      for (const instanceId of indicatorIds) {
        chart.removeIndicator(instanceId, { force: true });
      }
      indicatorIds = [];

      for (const indicator of indicators) {
        const instance = chart.addIndicator(
          indicator.indicatorId,
          indicator.settings,
          {
            instanceId: indicator.instanceId,
            ...(indicator.paneIndex === undefined
              ? {}
              : { paneIndex: indicator.paneIndex }),
          },
        );
        indicatorIds.push(instance.id);
      }
    },
    async setDrawings(drawings) {
      assertAlive();
      if (!drawingController) {
        const { DrawingController } = await import("openalgo-charts/draw");
        drawingController = new DrawingController(chart, { magnet: "weak" });
      }
      drawingController.fromJSON({
        version: 2,
        drawings: drawings.map((drawing) => ({ ...drawing })),
      });
    },
    setViewport(viewport) {
      assertAlive();
      if (viewport) {
        chart.setVisibleLogicalRange(viewport);
      } else {
        chart.fitContent();
      }
    },
    getViewport() {
      assertAlive();
      return chart.getVisibleLogicalRange();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      drawingController?.destroy();
      chart.destroy();
    },
  };
}
