import {
  TRADE_CHART_BASIC_DRAWING_TOOL_IDS,
  TRADE_CHART_DRAWING_TOOL_IDS,
  TRADE_CHART_DRAWING_TOOL_SCHEMAS,
  TRADE_CHART_ELLIOTT_DRAWING_TOOL_IDS,
  TRADE_CHART_FIBONACCI_DRAWING_TOOL_IDS,
  type TradeChartDrawingToolId,
} from "@wavekb/domain/trading-review";
import type { IPrimitive, PrimitiveRenderContext } from "openalgo-charts";

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
const MAX_POSITION_ACCOUNT_SIZE = 1_000_000_000_000_000;
const MAX_DRAWING_TIME = 10_000_000_000_000;
const MAX_DRAWING_PRICE = 1_000_000_000_000_000_000;
const WAVEKB_DRAWING_TOOLS = new Set<string>(WAVEKB_DRAWING_TOOL_IDS);
const DRAWING_KEYS = [
  "id", "tool", "points", "style", "text", "properties", "paneIndex", "locked", "visible", "zIndex",
] as const;

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
  bold?: boolean;
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
  showStats?: boolean;
  accountSize?: number;
  risk?: number;
  levels?: Array<{
    ratio: number;
    color?: string;
    enabled?: boolean;
    label?: string;
  }>;
}

export interface WaveKbChartDrawingText {
  value?: string;
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
  stopTime?: number;
  stopPrice?: number;
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

interface WaveKbFillCluster {
  id: string;
  time: number;
  count: number;
}

export interface WaveKbChartTheme {
  background: string;
  grid: string;
  axisText: string;
  axisLine: string;
  primary: string;
  positive: string;
  negative: string;
}

export interface WaveKbChartEngine {
  setCandles(candles: readonly WaveKbChartCandle[]): void;
  setCandleGaps(gaps: readonly { from: number; to: number }[]): void;
  setFillClusters(clusters: readonly WaveKbFillCluster[]): void;
  setMarkers(markers: readonly WaveKbChartMarker[]): void;
  setIndicators(indicators: readonly WaveKbChartIndicator[]): Promise<void>;
  setDrawings(document: WaveKbChartDrawingDocument): Promise<void>;
  armDrawingTool(toolId: WaveKbChartDrawingToolId): Promise<void>;
  cancelDrawingTool(): boolean;
  undoDrawings(): boolean;
  redoDrawings(): boolean;
  getDrawings(): WaveKbChartDrawingDocument;
  subscribeDrawings(listener: (change: WaveKbChartDrawingChange) => void): () => void;
  subscribeMarkerClicks(listener: (markerId: string | null) => void): () => void;
  setTheme(theme: WaveKbChartTheme): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  setViewport(viewport: WaveKbChartViewport | null): void;
  getViewport(): WaveKbChartViewport;
  destroy(): void;
}

export interface WaveKbChartEngineOptions {
  timezone?: string;
  ariaLabel?: string;
}

function fillClusterLayer(clusters: readonly WaveKbFillCluster[]): IPrimitive {
  const top = 6;
  const height = 22;
  const chips = clusters.map(({ id, time, count }) => {
    const text = `+${count}`;
    return { id, time, text, width: 12 + 7 * text.length };
  });

  function chipLeft(chip: (typeof chips)[number], { dataLayer, timeScale, plotWidth }: PrimitiveRenderContext): number | null {
    const index = dataLayer.timeToIndex(chip.time);
    if (index === undefined || plotWidth < chip.width) return null;
    const x = timeScale.indexToX(index);
    return x < 0 || x > plotWidth ? null : Math.max(0, Math.min(x - chip.width / 2, plotWidth - chip.width));
  }

  return {
    zOrder: () => "top",
    draw(ctx, rc) {
      const { dpr, theme } = rc;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
      for (const chip of chips) {
        const left = chipLeft(chip, rc);
        if (left === null) continue;
        ctx.fillStyle = theme.axisText;
        ctx.beginPath();
        ctx.roundRect(left * dpr, top * dpr, chip.width * dpr, height * dpr, 4 * dpr);
        ctx.fill();
        ctx.fillStyle = theme.background;
        ctx.fillText(chip.text, (left + chip.width / 2) * dpr, (top + height / 2) * dpr);
      }
      ctx.restore();
    },
    hitTest(x, y, rc) {
      if (y < top || y > top + height) return null;
      // Match paint order when adjacent badges overlap at a wide zoom.
      for (let index = chips.length - 1; index >= 0; index -= 1) {
        const chip = chips[index];
        if (chip === undefined) continue;
        const left = chipLeft(chip, rc);
        if (left !== null && x >= left && x <= left + chip.width) {
          return { externalId: chip.id, zOrder: "top", distance: 0, cursor: "pointer" };
        }
      }
      return null;
    },
  };
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
  const color = boundedString(value, field, MAX_COLOR_LENGTH);
  if (!/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color)) {
    throw new Error(`${field} must be a bounded hexadecimal color`);
  }
  return color;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key))) {
    throw new Error(`${field} contains unsupported fields`);
  }
}

type DrawingNormalizationMode = "application" | "library";

function rejectOrOmit(mode: DrawingNormalizationMode, message: string): undefined {
  if (mode === "application") throw new Error(message);
  return undefined;
}

function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  mode: DrawingNormalizationMode,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return rejectOrOmit(mode, `${field} is out of range`);
  }
  return value;
}

function booleanValue(value: unknown, field: string, mode: DrawingNormalizationMode): boolean | undefined {
  return typeof value === "boolean" ? value : rejectOrOmit(mode, `${field} must be boolean`);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  mode: DrawingNormalizationMode,
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : rejectOrOmit(mode, `${field} is unsupported`);
}

function normalizedColor(value: unknown, field: string, mode: DrawingNormalizationMode): string | undefined {
  try {
    return optionalColor(value, field);
  } catch (error) {
    if (mode === "application") throw error;
    return undefined;
  }
}

function safeText(value: string, field: string, maximum: number, mode: DrawingNormalizationMode): string {
  if (mode === "application" && value.length > maximum) {
    throw new Error(`${field} cannot exceed ${maximum} characters`);
  }
  const result = value.slice(0, maximum);
  const compact = result.toLowerCase().replaceAll(" ", "");
  if (result.includes("<") || result.includes(">") || compact.includes("javascript:")
    || compact.includes("data:text/html") || compact.includes("expression(") || compact.includes("url(")) {
    throw new Error(`${field} contains unsafe text`);
  }
  return result;
}

function allowedSubset(source: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.includes(key)));
}

function normalizeStyle(source: Record<string, unknown>, mode: DrawingNormalizationMode): WaveKbChartDrawingStyle {
  const style: WaveKbChartDrawingStyle = {};
  const color = normalizedColor(source.color, "drawing.style.color", mode);
  const fillColor = normalizedColor(source.fillColor, "drawing.style.fillColor", mode);

  if (color !== undefined) style.color = color;
  if (fillColor !== undefined) style.fillColor = fillColor;
  if (source.lineWidth !== undefined) {
    const lineWidth = boundedNumber(source.lineWidth, "drawing.style.lineWidth", 0.5, 20, mode);
    if (lineWidth !== undefined) style.lineWidth = lineWidth;
  }
  if (source.lineStyle !== undefined) {
    const lineStyle = enumValue(source.lineStyle, ["solid", "dashed", "dotted"] as const, "drawing.style.lineStyle", mode);
    if (lineStyle !== undefined) style.lineStyle = lineStyle;
  }
  for (const key of ["fill", "extendLeft", "extendRight", "showLabels", "showStats"] as const) {
    if (source[key] !== undefined) {
      const normalized = booleanValue(source[key], `drawing.style.${key}`, mode);
      if (normalized !== undefined) style[key] = normalized;
    }
  }
  if (source.accountSize !== undefined) {
    const accountSize = boundedNumber(source.accountSize, "drawing.style.accountSize", 0, MAX_POSITION_ACCOUNT_SIZE, mode);
    if (accountSize !== undefined) style.accountSize = accountSize;
  }
  if (source.risk !== undefined) {
    const risk = boundedNumber(source.risk, "drawing.style.risk", 0, 100, mode);
    if (risk !== undefined) style.risk = risk;
  }
  if (source.fillOpacity !== undefined) {
    const fillOpacity = boundedNumber(source.fillOpacity, "drawing.style.fillOpacity", 0, 1, mode);
    if (fillOpacity !== undefined) style.fillOpacity = fillOpacity;
  }
  if (source.levels !== undefined && !Array.isArray(source.levels)) {
    rejectOrOmit(mode, "drawing.style.levels must be an array");
  } else if (Array.isArray(source.levels)) {
    if (mode === "application" && source.levels.length > MAX_FIBONACCI_LEVELS) {
      throw new Error(`drawing.style.levels cannot exceed ${MAX_FIBONACCI_LEVELS} entries`);
    }
    style.levels = source.levels.slice(0, MAX_FIBONACCI_LEVELS).flatMap((level, index) => {
      if (!isRecord(level)) {
        rejectOrOmit(mode, `drawing.style.levels[${index}] must be an object`);
        return [];
      }
      if (mode === "application") {
        assertAllowedKeys(level, ["ratio", "color", "enabled", "label"], `drawing.style.levels[${index}]`);
      }
      const levelSource = mode === "library"
        ? allowedSubset(level, ["ratio", "color", "enabled", "label"])
        : level;
      const ratio = boundedNumber(levelSource.ratio, `drawing.style.levels[${index}].ratio`, -1_000_000, 1_000_000, mode);
      if (ratio === undefined) return [];
      const normalized: NonNullable<WaveKbChartDrawingStyle["levels"]>[number] = {
        ratio,
      };
      const levelColor = normalizedColor(levelSource.color, `drawing.style.levels[${index}].color`, mode);
      if (levelColor !== undefined) normalized.color = levelColor;
      if (levelSource.enabled !== undefined) {
        const enabled = booleanValue(levelSource.enabled, `drawing.style.levels[${index}].enabled`, mode);
        if (enabled !== undefined) normalized.enabled = enabled;
      }
      if (levelSource.label !== undefined) {
        if (typeof levelSource.label !== "string") {
          rejectOrOmit(mode, `drawing.style.levels[${index}].label must be text`);
        } else {
          normalized.label = safeText(levelSource.label, `drawing.style.levels[${index}].label`, MAX_LABEL_LENGTH, mode);
        }
      }
      return [normalized];
    });
  }

  return style;
}

function normalizeText(value: Record<string, unknown>, mode: DrawingNormalizationMode): WaveKbChartDrawingText | undefined {
  const text: WaveKbChartDrawingText = {};
  if (value.value !== undefined) {
    if (typeof value.value !== "string") rejectOrOmit(mode, "drawing.text.value must be text");
    else text.value = safeText(value.value, "drawing.text.value", MAX_DRAWING_TEXT_LENGTH, mode);
  }
  const color = normalizedColor(value.color, "drawing.text.color", mode);
  if (color !== undefined) text.color = color;
  if (value.fontSize !== undefined) {
    const fontSize = boundedNumber(value.fontSize, "drawing.text.fontSize", 6, 96, mode);
    if (fontSize !== undefined) text.fontSize = fontSize;
  }
  if (value.fontFamily !== undefined) {
    if (typeof value.fontFamily !== "string" || !/^[A-Za-z0-9 _,-]{0,128}$/.test(value.fontFamily)) {
      rejectOrOmit(mode, "drawing.text.fontFamily is unsupported");
    } else {
      text.fontFamily = value.fontFamily;
    }
  }
  for (const key of ["bold", "italic"] as const) {
    if (value[key] !== undefined) {
      const normalized = booleanValue(value[key], `drawing.text.${key}`, mode);
      if (normalized !== undefined) text[key] = normalized;
    }
  }
  if (value.align !== undefined) {
    const align = enumValue(value.align, ["left", "center", "right"] as const, "drawing.text.align", mode);
    if (align !== undefined) text.align = align;
  }
  if (value.valign !== undefined) {
    const valign = enumValue(value.valign, ["top", "middle", "bottom"] as const, "drawing.text.valign", mode);
    if (valign !== undefined) text.valign = valign;
  }
  return text;
}

function normalizeProperties(
  value: Record<string, unknown>,
  mode: DrawingNormalizationMode,
): WaveKbChartDrawingProperties | undefined {
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

  if (value.degree !== undefined) {
    const degree = enumValue(value.degree, [...degrees], "drawing.properties.degree", mode);
    if (degree !== undefined) properties.degree = degree;
  }
  if (value.labelStyle !== undefined) {
    const labelStyle = enumValue(value.labelStyle, [...labelStyles], "drawing.properties.labelStyle", mode);
    if (labelStyle !== undefined) properties.labelStyle = labelStyle;
  }
  for (const key of [
    "showHeader",
    "showLossSize",
    "showTargetLabel",
    "showStopLabel",
    "showPrices",
  ] as const) {
    if (value[key] !== undefined) {
      const normalized = booleanValue(value[key], `drawing.properties.${key}`, mode);
      if (normalized !== undefined) properties[key] = normalized;
    }
  }
  for (const key of ["profitColor", "lossColor"] as const) {
    const color = normalizedColor(value[key], `drawing.properties.${key}`, mode);
    if (color !== undefined) properties[key] = color;
  }
  if (mode === "application") {
    const hasStopTime = Object.prototype.hasOwnProperty.call(value, "stopTime");
    const hasStopPrice = Object.prototype.hasOwnProperty.call(value, "stopPrice");
    if (hasStopTime !== hasStopPrice) throw new Error("drawing.properties stopTime and stopPrice must be provided together");
    if (hasStopTime) {
      const stopTime = boundedNumber(value.stopTime, "drawing.properties.stopTime", -MAX_DRAWING_TIME, MAX_DRAWING_TIME, mode);
      const stopPrice = boundedNumber(value.stopPrice, "drawing.properties.stopPrice", -MAX_DRAWING_PRICE, MAX_DRAWING_PRICE, mode);
      if (stopTime !== undefined && stopPrice !== undefined) {
        properties.stopTime = stopTime;
        properties.stopPrice = stopPrice;
      }
    }
  }

  return Object.keys(properties).length === 0 ? undefined : properties;
}

function normalizeDrawingPoint(
  value: unknown,
  field: string,
  mode: DrawingNormalizationMode,
): WaveKbChartDrawingPoint {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  if (mode === "application") assertAllowedKeys(value, ["time", "price"], field);
  const time = boundedNumber(value.time, `${field}.time`, -MAX_DRAWING_TIME, MAX_DRAWING_TIME, mode);
  const price = boundedNumber(value.price, `${field}.price`, -MAX_DRAWING_PRICE, MAX_DRAWING_PRICE, mode);
  if (time === undefined || price === undefined) throw new Error(`${field} is invalid`);
  return { time, price };
}

function defaultPositionStop(points: readonly WaveKbChartDrawingPoint[]): WaveKbChartDrawingPoint {
  const [entry, target] = points;
  if (entry === undefined || target === undefined) throw new Error("position drawing requires entry and target anchors");
  return {
    time: target.time,
    price: entry.price - (target.price - entry.price) / 2,
  };
}

function normalizeDrawing(value: unknown, mode: DrawingNormalizationMode): WaveKbChartDrawing {
  if (!isRecord(value)) {
    throw new Error("drawing must be an object");
  }
  if (mode === "application") assertAllowedKeys(value, DRAWING_KEYS, "drawing");
  const id = boundedString(value.id, "drawing.id", MAX_DRAWING_ID_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error(`drawing ${id} has an invalid id`);
  if (typeof value.tool !== "string" || !WAVEKB_DRAWING_TOOLS.has(value.tool)) {
    throw new Error(`drawing ${id} uses an unsupported tool`);
  }
  const tool = value.tool as WaveKbChartDrawingToolId;
  const schema = TRADE_CHART_DRAWING_TOOL_SCHEMAS[tool];
  const isPositionTool = tool === "long-position" || tool === "short-position";
  const hasInternalExpandedPosition = mode === "library" && isPositionTool
    && Array.isArray(value.points) && value.points.length === schema.pointCount + 1;
  if (!Array.isArray(value.points) || (value.points.length !== schema.pointCount && !hasInternalExpandedPosition)
    || value.points.length > MAX_DRAWING_POINTS) {
    throw new Error(`drawing ${id} points must contain exactly ${schema.pointCount} anchors`);
  }
  const points = value.points.slice(0, schema.pointCount).map((point, index) =>
    normalizeDrawingPoint(point, `drawing ${id} point ${index}`, mode));
  const internalStop = hasInternalExpandedPosition
    ? normalizeDrawingPoint(value.points[schema.pointCount], `drawing ${id} internal stop`, mode)
    : undefined;
  const paneIndex = finiteNumber(value.paneIndex, `drawing ${id}.paneIndex`);
  const zIndex = finiteNumber(value.zIndex, `drawing ${id}.zIndex`);
  if (!Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex > 15) {
    throw new Error(`drawing ${id}.paneIndex is out of range`);
  }
  if (mode === "application" && (zIndex < -10_000 || zIndex > 10_000)) {
    throw new Error(`drawing ${id}.zIndex is out of range`);
  }

  if (!isRecord(value.style)) throw new Error(`drawing ${id}.style must be an object`);
  const styleSource = mode === "application" ? value.style : allowedSubset(value.style, schema.styleKeys);
  if (mode === "application") assertAllowedKeys(styleSource, schema.styleKeys, `drawing ${id}.style`);
  const rawText = value.text;
  if (schema.textRequired && (!isRecord(rawText) || typeof rawText.value !== "string")) {
    throw new Error(`drawing ${id}.text is required`);
  }
  let textSource: Record<string, unknown> | undefined;
  if (rawText !== undefined) {
    if (!isRecord(rawText)) throw new Error(`drawing ${id}.text must be an object`);
    if (schema.textKeys.length === 0) {
      if (mode === "application") throw new Error(`drawing ${id}.text is unsupported`);
    } else {
      textSource = mode === "application" ? rawText : allowedSubset(rawText, schema.textKeys);
      if (mode === "application") assertAllowedKeys(textSource, schema.textKeys, `drawing ${id}.text`);
    }
  }
  const rawProperties = value[mode === "application" ? "properties" : "props"];
  let propertySource: Record<string, unknown> | undefined;
  if (rawProperties !== undefined) {
    if (!isRecord(rawProperties)) throw new Error(`drawing ${id}.properties must be an object`);
    if (schema.propertyKeys.length === 0) {
      if (mode === "application") throw new Error(`drawing ${id}.properties are unsupported`);
    } else {
      propertySource = mode === "application"
        ? rawProperties
        : allowedSubset(rawProperties, schema.propertyKeys);
      if (mode === "application") {
        assertAllowedKeys(propertySource, schema.propertyKeys, `drawing ${id}.properties`);
      }
    }
  }

  const drawing: WaveKbChartDrawing = {
    id,
    tool,
    points,
    style: normalizeStyle(styleSource, mode),
    paneIndex,
    zIndex: Math.min(10_000, Math.max(-10_000, zIndex)),
  };
  const text = textSource === undefined ? undefined : normalizeText(textSource, mode);
  let properties = propertySource === undefined ? undefined : normalizeProperties(propertySource, mode);
  if (internalStop !== undefined) {
    const defaultStop = defaultPositionStop(points);
    if (internalStop.time !== defaultStop.time || internalStop.price !== defaultStop.price) {
      properties = {
        ...properties,
        stopTime: internalStop.time,
        stopPrice: internalStop.price,
      };
    }
  }
  if (text !== undefined) drawing.text = text;
  if (properties !== undefined) drawing.properties = properties;
  for (const key of ["locked", "visible"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") {
      if (mode === "application") throw new Error(`drawing ${id}.${key} must be boolean`);
    } else {
      drawing[key] = value[key];
    }
  }
  return drawing;
}

function normalizeWaveKbDocument(value: unknown): WaveKbChartDrawingDocument {
  if (!isRecord(value) || value.schemaVersion !== WAVEKB_DRAWING_DOCUMENT_SCHEMA) {
    throw new Error(`drawing document must use ${WAVEKB_DRAWING_DOCUMENT_SCHEMA}`);
  }
  assertAllowedKeys(value, ["schemaVersion", "drawings"], "drawing document");
  if (!Array.isArray(value.drawings) || value.drawings.length > MAX_DRAWINGS) {
    throw new Error(`drawing document cannot contain more than ${MAX_DRAWINGS} drawings`);
  }
  const drawings = value.drawings.map((drawing) => normalizeDrawing(drawing, "application"));
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
      drawings.push(normalizeDrawing(drawing, "library"));
    } catch {
      // Never expose unbounded or unsupported engine state through the WaveKB boundary.
    }
  }
  return { schemaVersion: WAVEKB_DRAWING_DOCUMENT_SCHEMA, drawings };
}

function toOpenAlgoDocument(document: WaveKbChartDrawingDocument) {
  return {
    version: 2 as const,
    drawings: document.drawings.map(({ properties, ...drawing }) => {
      const isPositionTool = drawing.tool === "long-position" || drawing.tool === "short-position";
      const stop = isPositionTool
        ? properties?.stopTime !== undefined && properties.stopPrice !== undefined
          ? { time: properties.stopTime, price: properties.stopPrice }
          : defaultPositionStop(drawing.points)
        : undefined;
      const engineProperties = properties === undefined
        ? undefined
        : Object.fromEntries(Object.entries(properties).filter(([key]) => key !== "stopTime" && key !== "stopPrice"));
      return {
        ...drawing,
        points: [...drawing.points.map((point) => ({ ...point })), ...(stop === undefined ? [] : [stop])],
        style: {
          ...drawing.style,
          ...(drawing.style.levels === undefined
            ? {}
            : { levels: drawing.style.levels.map((level) => ({ ...level })) }),
        },
        ...(drawing.text === undefined ? {} : { text: { ...drawing.text } }),
        ...(engineProperties === undefined || Object.keys(engineProperties).length === 0
          ? {}
          : { props: engineProperties }),
      };
    }),
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

  const { createChart, lightTheme } = await import("openalgo-charts");
  const chart = createChart(container, {
    branding: false,
    timezone: options.timezone ?? "UTC",
    ariaLabel: options.ariaLabel,
  });
  const candleSeries = chart.addSeries("candlestick");
  const markerLayer = candleSeries.createMarkers();
  let candleGapLayer: IPrimitive | null = null;
  let clusterLayer: IPrimitive | null = null;

  let drawingModule: OpenAlgoDrawingModule | null = null;
  let drawingController: OpenAlgoDrawingController | null = null;
  let drawingControllerPromise: Promise<OpenAlgoDrawingController> | null = null;
  let indicatorIds: string[] = [];
  let destroyed = false;
  let lifecycleVersion = 0;
  const drawingListeners = new Set<(change: WaveKbChartDrawingChange) => void>();
  const drawingEventOff: Array<() => void> = [];
  const markerClickEventOff = new Set<() => void>();

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
    setCandleGaps(gaps) {
      assertAlive();
      if (candleGapLayer) chart.removePrimitive(candleGapLayer);
      candleGapLayer = null;
      if (gaps.length === 0) return;

      // Shade the gap on the compressed time scale without feeding fake OHLC
      // values or missing-price points into the candle series and indicators.
      candleGapLayer = {
        zOrder: () => "bottom",
        draw(ctx, { dataLayer, timeScale, plotWidth, plotHeight, dpr, theme }) {
          const halfBar = timeScale.barSpacing / 2;
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = theme.axisLine;
          for (const { from, to } of gaps) {
            const left = Math.max(0, timeScale.indexToX(dataLayer.timeToIndexFloat(from)) - halfBar);
            const right = Math.min(plotWidth, timeScale.indexToX(dataLayer.timeToIndexFloat(to)) - halfBar);
            if (right > left) ctx.fillRect(left * dpr, 0, (right - left) * dpr, plotHeight * dpr);
          }
          ctx.restore();
        },
      };
      chart.addPrimitive(candleGapLayer, { anchor: "primary-pane" });
    },
    setFillClusters(clusters) {
      assertAlive();
      if (clusterLayer) chart.removePrimitive(clusterLayer);
      clusterLayer = clusters.length > 0 ? fillClusterLayer(clusters) : null;
      if (clusterLayer) chart.addPrimitive(clusterLayer, { anchor: "primary-pane" });
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
    subscribeMarkerClicks(listener) {
      assertAlive();
      const off = chart.on("click", ({ id }) => listener(typeof id === "string" ? id : null));
      markerClickEventOff.add(off);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        markerClickEventOff.delete(off);
        off();
      };
    },
    setTheme(theme) {
      assertAlive();
      chart.setTheme({
        ...lightTheme,
        background: theme.background,
        grid: theme.grid,
        axisText: theme.axisText,
        axisLine: theme.axisLine,
        paneSeparator: theme.axisLine,
        crosshair: theme.primary,
        crosshairLabelBackground: theme.primary,
        upColor: theme.positive,
        downColor: theme.negative,
        wickUpColor: theme.positive,
        wickDownColor: theme.negative,
        lineColor: theme.primary,
        areaTopColor: theme.primary,
        areaBottomColor: theme.background,
        baselineTopLine: theme.positive,
        baselineTopFill: theme.positive,
        baselineBottomLine: theme.negative,
        baselineBottomFill: theme.negative,
        lastPriceUp: theme.positive,
        lastPriceDown: theme.negative,
        lastPriceText: theme.background,
        buy: theme.positive,
        sell: theme.negative,
        profit: theme.positive,
        loss: theme.negative,
      });
    },
    resize(width, height, _devicePixelRatio) {
      assertAlive();
      void _devicePixelRatio;
      chart.applySize(width, height);
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
      for (const off of markerClickEventOff) off();
      markerClickEventOff.clear();
      drawingListeners.clear();
      drawingController?.destroy();
      drawingController = null;
      drawingModule = null;
      candleGapLayer = null;
      clusterLayer = null;
      chart.destroy();
    },
  };
}
