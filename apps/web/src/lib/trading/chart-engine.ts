import {
  TRADE_CHART_BASIC_DRAWING_TOOL_IDS,
  TRADE_CHART_DRAWING_TOOL_IDS,
  TRADE_CHART_ELLIOTT_DRAWING_TOOL_IDS,
  TRADE_CHART_FIBONACCI_DRAWING_TOOL_IDS,
  type TradeChartDrawingToolId,
} from "@wavekb/domain/trading-review";

export const BASIC_DRAWING_TOOL_IDS = TRADE_CHART_BASIC_DRAWING_TOOL_IDS;
export const FIBONACCI_DRAWING_TOOL_IDS = TRADE_CHART_FIBONACCI_DRAWING_TOOL_IDS;
export const ELLIOTT_DRAWING_TOOL_IDS = TRADE_CHART_ELLIOTT_DRAWING_TOOL_IDS;
export const WAVEKB_DRAWING_TOOL_IDS = TRADE_CHART_DRAWING_TOOL_IDS;

export const WAVEKB_DRAWING_DOCUMENT_SCHEMA = "wavekb-chart-drawings-v1" as const;

const MAX_DRAWINGS = 200;
const MAX_DRAWING_POINTS = 32;
const MAX_FIBONACCI_LEVELS = 32;
const MAX_DRAWING_ID_LENGTH = 128;
const MAX_DRAWING_TEXT_LENGTH = 2_000;
const MAX_LABEL_LENGTH = 128;
const MAX_COLOR_LENGTH = 64;
const WAVEKB_DRAWING_TOOLS = new Set<string>(WAVEKB_DRAWING_TOOL_IDS);

type OpenAlgoDrawingController = InstanceType<
  typeof import("openalgo-charts/draw")["DrawingController"]
>;
type OpenAlgoDrawingModule = typeof import("openalgo-charts/draw");

export type WaveKbChartDrawingToolId = TradeChartDrawingToolId;

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

export interface WaveKbChartDrawingStyle {
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
}

export interface WaveKbChartDrawingText {
  value: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
}

export interface WaveKbChartDrawingProperties {
  degree?:
    | "grand-supercycle"
    | "supercycle"
    | "cycle"
    | "primary"
    | "intermediate"
    | "minor"
    | "minute"
    | "minuette"
    | "subminuette";
  labelStyle?: "degree" | "plain" | "parentheses" | "circled";
  showHeader?: boolean;
  showLossSize?: boolean;
  showTargetLabel?: boolean;
  showStopLabel?: boolean;
  showPrices?: boolean;
  profitColor?: string;
  lossColor?: string;
}

export interface WaveKbChartDrawing {
  id: string;
  tool: WaveKbChartDrawingToolId;
  points: WaveKbChartDrawingPoint[];
  style: WaveKbChartDrawingStyle;
  text?: WaveKbChartDrawingText;
  properties?: WaveKbChartDrawingProperties;
  paneIndex: number;
  locked?: boolean;
  visible?: boolean;
  zIndex: number;
}

export interface WaveKbChartDrawingDocument {
  schemaVersion: typeof WAVEKB_DRAWING_DOCUMENT_SCHEMA;
  drawings: readonly WaveKbChartDrawing[];
}

export type WaveKbChartDrawingChangeKind =
  | "add"
  | "update"
  | "remove"
  | "reorder"
  | "undo"
  | "redo"
  | "restore";

export interface WaveKbChartDrawingChange {
  kind: WaveKbChartDrawingChangeKind;
  drawingIds: readonly string[];
  document: WaveKbChartDrawingDocument;
}

export interface WaveKbChartViewport {
  from: number;
  to: number;
}

export interface WaveKbChartEngine {
  setCandles(candles: readonly WaveKbChartCandle[]): void;
  setMarkers(markers: readonly WaveKbChartMarker[]): void;
  setIndicators(indicators: readonly WaveKbChartIndicator[]): Promise<void>;
  setDrawings(document: WaveKbChartDrawingDocument): Promise<void>;
  armDrawingTool(toolId: WaveKbChartDrawingToolId): Promise<void>;
  cancelDrawingTool(): boolean;
  undoDrawings(): boolean;
  redoDrawings(): boolean;
  getDrawings(): WaveKbChartDrawingDocument;
  subscribeDrawings(listener: (change: WaveKbChartDrawingChange) => void): () => void;
  setViewport(viewport: WaveKbChartViewport | null): void;
  getViewport(): WaveKbChartViewport;
  destroy(): void;
}

export interface WaveKbChartEngineOptions {
  timezone?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function boundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${field} must be between 1 and ${maximum} characters`);
  }
  return value;
}

function optionalColor(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return boundedString(value, field, MAX_COLOR_LENGTH);
}

function normalizeStyle(value: unknown): WaveKbChartDrawingStyle {
  const source = isRecord(value) ? value : {};
  const style: WaveKbChartDrawingStyle = {};
  const color = optionalColor(source.color, "drawing.style.color");
  const fillColor = optionalColor(source.fillColor, "drawing.style.fillColor");

  if (color !== undefined) style.color = color;
  if (fillColor !== undefined) style.fillColor = fillColor;
  if (typeof source.lineWidth === "number" && Number.isFinite(source.lineWidth)) {
    style.lineWidth = Math.min(20, Math.max(0.5, source.lineWidth));
  }
  if (source.lineStyle === "solid" || source.lineStyle === "dashed" || source.lineStyle === "dotted") {
    style.lineStyle = source.lineStyle;
  }
  for (const key of ["fill", "extendLeft", "extendRight", "showLabels"] as const) {
    if (typeof source[key] === "boolean") style[key] = source[key];
  }
  if (typeof source.fillOpacity === "number" && Number.isFinite(source.fillOpacity)) {
    style.fillOpacity = Math.min(1, Math.max(0, source.fillOpacity));
  }
  if (Array.isArray(source.levels)) {
    style.levels = source.levels.slice(0, MAX_FIBONACCI_LEVELS).flatMap((level, index) => {
      if (!isRecord(level) || typeof level.ratio !== "number" || !Number.isFinite(level.ratio)) {
        return [];
      }
      const normalized: NonNullable<WaveKbChartDrawingStyle["levels"]>[number] = {
        ratio: level.ratio,
      };
      const levelColor = optionalColor(level.color, `drawing.style.levels[${index}].color`);
      if (levelColor !== undefined) normalized.color = levelColor;
      if (typeof level.enabled === "boolean") normalized.enabled = level.enabled;
      if (typeof level.label === "string") {
        normalized.label = level.label.slice(0, MAX_LABEL_LENGTH);
      }
      return [normalized];
    });
  }

  return style;
}

function normalizeText(value: unknown): WaveKbChartDrawingText | undefined {
  if (!isRecord(value) || typeof value.value !== "string") {
    return undefined;
  }
  const text: WaveKbChartDrawingText = {
    value: value.value.slice(0, MAX_DRAWING_TEXT_LENGTH),
  };
  const color = optionalColor(value.color, "drawing.text.color");
  if (color !== undefined) text.color = color;
  if (typeof value.fontSize === "number" && Number.isFinite(value.fontSize)) {
    text.fontSize = Math.min(96, Math.max(6, value.fontSize));
  }
  if (typeof value.fontFamily === "string") {
    text.fontFamily = value.fontFamily.slice(0, MAX_LABEL_LENGTH);
  }
  for (const key of ["bold", "italic"] as const) {
    if (typeof value[key] === "boolean") text[key] = value[key];
  }
  if (value.align === "left" || value.align === "center" || value.align === "right") {
    text.align = value.align;
  }
  if (value.valign === "top" || value.valign === "middle" || value.valign === "bottom") {
    text.valign = value.valign;
  }
  return text;
}

function normalizeProperties(value: unknown): WaveKbChartDrawingProperties | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const properties: WaveKbChartDrawingProperties = {};
  const degrees = new Set<NonNullable<WaveKbChartDrawingProperties["degree"]>>([
    "grand-supercycle",
    "supercycle",
    "cycle",
    "primary",
    "intermediate",
    "minor",
    "minute",
    "minuette",
    "subminuette",
  ]);
  const labelStyles = new Set<NonNullable<WaveKbChartDrawingProperties["labelStyle"]>>([
    "degree",
    "plain",
    "parentheses",
    "circled",
  ]);

  if (typeof value.degree === "string" && degrees.has(value.degree as NonNullable<WaveKbChartDrawingProperties["degree"]>)) {
    properties.degree = value.degree as NonNullable<WaveKbChartDrawingProperties["degree"]>;
  }
  if (typeof value.labelStyle === "string" && labelStyles.has(value.labelStyle as NonNullable<WaveKbChartDrawingProperties["labelStyle"]>)) {
    properties.labelStyle = value.labelStyle as NonNullable<WaveKbChartDrawingProperties["labelStyle"]>;
  }
  for (const key of [
    "showHeader",
    "showLossSize",
    "showTargetLabel",
    "showStopLabel",
    "showPrices",
  ] as const) {
    if (typeof value[key] === "boolean") properties[key] = value[key];
  }
  for (const key of ["profitColor", "lossColor"] as const) {
    const color = optionalColor(value[key], `drawing.properties.${key}`);
    if (color !== undefined) properties[key] = color;
  }

  return Object.keys(properties).length === 0 ? undefined : properties;
}

function normalizeDrawing(value: unknown, propertyField: "properties" | "props"): WaveKbChartDrawing {
  if (!isRecord(value)) {
    throw new Error("drawing must be an object");
  }
  const id = boundedString(value.id, "drawing.id", MAX_DRAWING_ID_LENGTH);
  if (typeof value.tool !== "string" || !WAVEKB_DRAWING_TOOLS.has(value.tool)) {
    throw new Error(`drawing ${id} uses an unsupported tool`);
  }
  if (!Array.isArray(value.points) || value.points.length > MAX_DRAWING_POINTS) {
    throw new Error(`drawing ${id} has too many points`);
  }
  const points = value.points.map((point, index) => {
    if (!isRecord(point)) {
      throw new Error(`drawing ${id} point ${index} must be an object`);
    }
    return {
      time: finiteNumber(point.time, `drawing ${id} point ${index}.time`),
      price: finiteNumber(point.price, `drawing ${id} point ${index}.price`),
    };
  });
  const paneIndex = finiteNumber(value.paneIndex, `drawing ${id}.paneIndex`);
  const zIndex = finiteNumber(value.zIndex, `drawing ${id}.zIndex`);
  if (!Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex > 15) {
    throw new Error(`drawing ${id}.paneIndex is out of range`);
  }

  const drawing: WaveKbChartDrawing = {
    id,
    tool: value.tool as WaveKbChartDrawingToolId,
    points,
    style: normalizeStyle(value.style),
    paneIndex,
    zIndex: Math.min(10_000, Math.max(-10_000, zIndex)),
  };
  const text = normalizeText(value.text);
  const properties = normalizeProperties(value[propertyField]);
  if (text !== undefined) drawing.text = text;
  if (properties !== undefined) drawing.properties = properties;
  if (typeof value.locked === "boolean") drawing.locked = value.locked;
  if (typeof value.visible === "boolean") drawing.visible = value.visible;
  return drawing;
}

function normalizeWaveKbDocument(value: unknown): WaveKbChartDrawingDocument {
  if (!isRecord(value) || value.schemaVersion !== WAVEKB_DRAWING_DOCUMENT_SCHEMA) {
    throw new Error(`drawing document must use ${WAVEKB_DRAWING_DOCUMENT_SCHEMA}`);
  }
  if (!Array.isArray(value.drawings) || value.drawings.length > MAX_DRAWINGS) {
    throw new Error(`drawing document cannot contain more than ${MAX_DRAWINGS} drawings`);
  }
  const drawings = value.drawings.map((drawing) => normalizeDrawing(drawing, "properties"));
  const ids = new Set(drawings.map(({ id }) => id));
  if (ids.size !== drawings.length) {
    throw new Error("drawing document contains duplicate ids");
  }
  return { schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA, drawings };
}

function normalizeOpenAlgoDocument(value: unknown): WaveKbChartDrawingDocument {
  if (!isRecord(value) || !Array.isArray(value.drawings)) {
    return { schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA, drawings: [] };
  }
  const drawings: WaveKbChartDrawing[] = [];
  for (const drawing of value.drawings.slice(0, MAX_DRAWINGS)) {
    try {
      drawings.push(normalizeDrawing(drawing, "props"));
    } catch {
      // Never expose unbounded or unsupported engine state through the WaveKB boundary.
    }
  }
  return { schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA, drawings };
}

function toOpenAlgoDocument(document: WaveKbChartDrawingDocument) {
  return {
    version: 2 as const,
    drawings: document.drawings.map(({ properties, ...drawing }) => ({
      ...drawing,
      points: drawing.points.map((point) => ({ ...point })),
      style: {
        ...drawing.style,
        ...(drawing.style.levels === undefined
          ? {}
          : { levels: drawing.style.levels.map((level) => ({ ...level })) }),
      },
      ...(drawing.text === undefined ? {} : { text: { ...drawing.text } }),
      ...(properties === undefined ? {} : { props: { ...properties } }),
    })),
  };
}

function parseDrawingChange(value: unknown): {
  kind: Exclude<WaveKbChartDrawingChangeKind, "restore">;
  ids: string[];
} {
  const source = isRecord(value) ? value : {};
  const kinds = new Set<Exclude<WaveKbChartDrawingChangeKind, "restore">>([
    "add",
    "update",
    "remove",
    "reorder",
    "undo",
    "redo",
  ]);
  const kind = typeof source.kind === "string" && kinds.has(source.kind as Exclude<WaveKbChartDrawingChangeKind, "restore">)
    ? source.kind as Exclude<WaveKbChartDrawingChangeKind, "restore">
    : "update";
  const ids = Array.isArray(source.ids)
    ? source.ids.filter((id): id is string => typeof id === "string").slice(0, MAX_DRAWINGS)
    : [];
  return { kind, ids };
}

export async function verifyWaveKbDrawingToolRegistry(): Promise<WaveKbChartDrawingToolId[]> {
  const { hasDrawingTool } = await import("openalgo-charts/draw");
  const missing = WAVEKB_DRAWING_TOOL_IDS.filter((toolId) => !hasDrawingTool(toolId));
  if (missing.length > 0) {
    throw new Error(`OpenAlgo is missing WaveKB drawing tools: ${missing.join(", ")}`);
  }
  return [...WAVEKB_DRAWING_TOOL_IDS];
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

  let drawingModule: OpenAlgoDrawingModule | null = null;
  let drawingController: OpenAlgoDrawingController | null = null;
  let drawingControllerPromise: Promise<OpenAlgoDrawingController> | null = null;
  let indicatorIds: string[] = [];
  let destroyed = false;
  let lifecycleVersion = 0;
  const drawingListeners = new Set<(change: WaveKbChartDrawingChange) => void>();
  const drawingEventOff: Array<() => void> = [];

  const destroyedError = () => new Error("WaveKB chart engine has been destroyed");
  const assertAlive = () => {
    if (destroyed) {
      throw destroyedError();
    }
  };
  const assertCurrent = (version: number) => {
    if (destroyed || version !== lifecycleVersion) {
      throw destroyedError();
    }
  };

  const getNormalizedDrawings = () => normalizeOpenAlgoDocument(drawingController?.toJSON());
  const notifyDrawingListeners = (
    kind: WaveKbChartDrawingChangeKind,
    drawingIds: readonly string[],
  ) => {
    if (destroyed || drawingController === null) return;
    const change: WaveKbChartDrawingChange = {
      kind,
      drawingIds: [...drawingIds],
      document: getNormalizedDrawings(),
    };
    for (const listener of drawingListeners) listener(change);
  };

  const attachDrawingEvents = () => {
    drawingEventOff.push(
      chart.on("drawing:change", (payload: unknown) => {
        const { kind, ids } = parseDrawingChange(payload);
        notifyDrawingListeners(kind, ids);
      }),
      chart.on("draw:restore", () => {
        notifyDrawingListeners("restore", getNormalizedDrawings().drawings.map(({ id }) => id));
      }),
    );
  };

  const ensureDrawingController = async (): Promise<OpenAlgoDrawingController> => {
    assertAlive();
    if (drawingController !== null) return drawingController;
    if (drawingControllerPromise !== null) return drawingControllerPromise;

    const version = lifecycleVersion;
    const pending = (async () => {
      const drawTier = await import("openalgo-charts/draw");
      assertCurrent(version);
      const controller = new drawTier.DrawingController(chart, { magnet: "weak" });
      if (destroyed || version !== lifecycleVersion) {
        controller.destroy();
        throw destroyedError();
      }
      drawingModule = drawTier;
      drawingController = controller;
      attachDrawingEvents();
      return controller;
    })();
    drawingControllerPromise = pending;
    try {
      return await pending;
    } finally {
      if (drawingControllerPromise === pending) drawingControllerPromise = null;
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
      const version = lifecycleVersion;
      await import("openalgo-charts/indicators");
      assertCurrent(version);

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
    async setDrawings(value) {
      assertAlive();
      const version = lifecycleVersion;
      const document = normalizeWaveKbDocument(value);
      const controller = await ensureDrawingController();
      assertCurrent(version);
      controller.fromJSON(toOpenAlgoDocument(document));
    },
    async armDrawingTool(toolId) {
      assertAlive();
      if (!WAVEKB_DRAWING_TOOLS.has(toolId)) {
        throw new Error(`Unsupported WaveKB drawing tool: ${toolId}`);
      }
      const version = lifecycleVersion;
      const controller = await ensureDrawingController();
      assertCurrent(version);
      if (drawingModule === null || !drawingModule.hasDrawingTool(toolId)) {
        throw new Error(`OpenAlgo drawing tool is not registered: ${toolId}`);
      }
      controller.setTool(toolId);
    },
    cancelDrawingTool() {
      assertAlive();
      return drawingController?.cancel() ?? false;
    },
    undoDrawings() {
      assertAlive();
      return drawingController?.undo() ?? false;
    },
    redoDrawings() {
      assertAlive();
      return drawingController?.redo() ?? false;
    },
    getDrawings() {
      assertAlive();
      return getNormalizedDrawings();
    },
    subscribeDrawings(listener) {
      assertAlive();
      drawingListeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        drawingListeners.delete(listener);
      };
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
      if (destroyed) return;
      destroyed = true;
      lifecycleVersion += 1;
      for (const off of drawingEventOff.splice(0)) off();
      drawingListeners.clear();
      drawingController?.destroy();
      drawingController = null;
      drawingModule = null;
      chart.destroy();
    },
  };
}
