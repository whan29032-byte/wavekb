import {
  TRADE_CHART_CANDLE_SOURCES,
  TRADE_CHART_COVERAGE_STATUSES,
  TRADE_CHART_DRAWING_TOOL_IDS,
  TRADE_CHART_DRAWING_TOOL_SCHEMAS,
  TRADE_CHART_INDICATOR_IDS,
  TRADE_CHART_MAX_CANDLES,
  TRADE_CHART_MAX_DRAWING_POINTS,
  TRADE_CHART_MAX_DRAWINGS,
  TRADE_CHART_MAX_INDICATORS,
  TRADE_CHART_MAX_MARKERS,
  TRADE_CHART_PRICE_TYPES,
  TRADE_CHART_PROJECTION_SCHEMA_VERSION,
  TRADE_CHART_STATE_SCHEMA_VERSION,
  TRADE_CHART_TIMEFRAMES,
  TRADE_CHART_WARNING_CODES,
  TRADING_PRODUCTS,
  isTradingProvider,
  type ChartStateV1,
  type DrawingSpecV1,
  type IndicatorSpecV1,
  type TradeChartProjection,
  type TradeChartDrawingToolId,
  type TradeChartTimeframe,
} from "@wavekb/domain/trading-review";
import {
  CANDLE_UNAVAILABLE_REASONS,
  assertCanonicalCandleBatch,
  type CandleRequest,
} from "./providers/contracts.ts";

const stateKeys = [
  "schema_version", "cycle_id", "cycle_revision", "timeframe", "price_type", "viewport", "indicators", "drawings",
  "version", "updated_at",
] as const;
const projectionKeys = [
  "schema_version", "cycle_id", "cycle_revision", "provider", "product", "symbol", "native_symbol", "direction",
  "opened_at", "closed_at", "timeframe", "price_type", "range", "candles", "markers", "chart_state", "coverage", "warnings",
] as const;
const indicatorKeys = ["instanceId", "indicatorId", "settings", "paneIndex"] as const;
const drawingKeys = ["id", "tool", "points", "style", "text", "properties", "paneIndex", "locked", "visible", "zIndex"] as const;
const markerKeys = [
  "marker_key", "fill_id", "occurred_at", "price", "allocated_quantity", "allocation_role", "sort_order", "side",
  "position_side", "liquidity", "provider_fill_id_mask", "annotation",
] as const;
const annotationKeys = ["id", "body", "tags", "image_count", "version", "remap_status"] as const;
const coverageKeys = ["status", "source", "fetched_at", "gaps", "unavailable_reason"] as const;

const timeframes = new Set<string>(TRADE_CHART_TIMEFRAMES);
const priceTypes = new Set<string>(TRADE_CHART_PRICE_TYPES);
const indicatorIds = new Set<string>(TRADE_CHART_INDICATOR_IDS);
const drawingTools = new Set<string>(TRADE_CHART_DRAWING_TOOL_IDS);
const warningCodes = new Set<string>(TRADE_CHART_WARNING_CODES);
const candleSources = new Set<string>(TRADE_CHART_CANDLE_SOURCES);
const coverageStatuses = new Set<string>(TRADE_CHART_COVERAGE_STATUSES);
const unavailableReasons = new Set<string>(CANDLE_UNAVAILABLE_REASONS);
const products = new Set<string>(TRADING_PRODUCTS);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveIntegerStringPattern = /^[1-9]\d*$/;
const canonicalUnsignedDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const safeSymbolPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const colorPattern = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

const indicatorSettingKeys: Readonly<Record<string, readonly string[]>> = {
  sma: ["length", "source", "color", "timeframe"],
  ema: ["length", "source", "color", "timeframe"],
  wma: ["length", "source", "color", "timeframe"],
  hma: ["length", "source", "color", "timeframe"],
  vwap: ["anchor", "source", "offset", "calcMode", "showBand1", "bandMult1", "showBand2", "bandMult2", "showBand3", "bandMult3", "color", "band1Color", "band2Color", "band3Color"],
  bollinger: ["length", "stdDev", "source", "basisColor", "bandColor", "timeframe"],
  rsi: ["length", "source", "color", "overbought", "oversold", "bandColor", "timeframe"],
  macd: ["fastPeriod", "slowPeriod", "signalPeriod", "source", "macdColor", "histUpColor", "histUpFadeColor", "histDownColor", "histDownFadeColor", "signalColor", "timeframe"],
  stochastic: ["kPeriod", "kSmoothing", "dPeriod", "kColor", "dColor", "bandColor", "timeframe"],
  adx: ["period", "adxPeriod", "adxColor", "plusColor", "minusColor", "timeframe"],
  atr: ["period", "color", "timeframe"],
  supertrend: ["period", "multiplier", "upColor", "downColor", "timeframe"],
  ichimoku: ["conversionPeriod", "basePeriod", "laggingSpanPeriod", "displacement", "conversionColor", "baseColor", "spanAColor", "spanBColor", "laggingColor", "cloudUpColor", "cloudDownColor"],
  donchian: ["length", "offset", "basisColor", "bandColor", "fillColor", "timeframe"],
  "keltner-channel": ["length", "mult", "source", "exp", "bandsStyle", "atrlength", "basisColor", "bandColor", "fillColor", "timeframe"],
  "chandelier-exit": ["length", "atrLength", "atrMultiplier", "longColor", "shortColor"],
  zigzag: ["deviation", "color"],
  "williams-fractals": ["periods", "showUp", "showDown", "upColor", "downColor"],
  "pivot-points": ["kind", "frame", "showP", "show1", "show2", "show3", "show4", "show5", "pivotColor", "supportColor", "resistanceColor"],
  cpr: ["pivotMode", "showDaily", "showWeekly", "showMonthly", "displaypivots", "displaysupport", "displayresistance", "displaycpr", "displayS1R1", "dPivotColor", "dSupportColor", "dResistanceColor", "dCprColor", "dFillColor", "wPivotColor", "wSupportColor", "wResistanceColor", "wCprColor", "wFillColor", "mPivotColor", "mSupportColor", "mResistanceColor", "mCprColor", "mFillColor"],
  obv: ["color", "maType", "maLength", "bbMult", "maColor", "bbUpperColor", "bbLowerColor"],
  mfi: ["period", "color", "bandColor"],
  "chaikin-money-flow": ["length", "color"],
};

const booleanIndicatorSettings = new Set([
  "showBand1", "showBand2", "showBand3", "exp", "showUp", "showDown", "showP", "show1", "show2", "show3", "show4", "show5",
  "showDaily", "showWeekly", "showMonthly", "displaypivots", "displaysupport", "displayresistance", "displaycpr", "displayS1R1",
]);
const colorIndicatorSettings = new Set([
  "color", "band1Color", "band2Color", "band3Color", "basisColor", "bandColor", "macdColor", "histUpColor", "histUpFadeColor",
  "histDownColor", "histDownFadeColor", "signalColor", "kColor", "dColor", "adxColor", "plusColor", "minusColor", "upColor", "downColor",
  "conversionColor", "baseColor", "spanAColor", "spanBColor", "laggingColor", "cloudUpColor", "cloudDownColor", "fillColor", "longColor",
  "shortColor", "pivotColor", "supportColor", "resistanceColor", "dPivotColor", "dSupportColor", "dResistanceColor", "dCprColor", "dFillColor",
  "wPivotColor", "wSupportColor", "wResistanceColor", "wCprColor", "wFillColor", "mPivotColor", "mSupportColor", "mResistanceColor",
  "mCprColor", "mFillColor", "maColor", "bbUpperColor", "bbLowerColor",
]);

function invalid(field: string): never {
  throw Object.assign(new Error(`trade_chart_invalid_${field}`), { statusCode: 400 });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key))) invalid(field);
}

function boundedString(value: unknown, field: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && value.length === 0)) invalid(field);
  return value;
}

function utcTimestamp(value: unknown, field: string): string {
  const result = boundedString(value, field, 30);
  if (!utcTimestampPattern.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) invalid(field);
  return result;
}

function positiveInteger(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) invalid(field);
  return value as number;
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid(field);
  return value;
}

function canonicalUnsignedDecimal(value: unknown, field: string, positive: boolean): string {
  const result = boundedString(value, field, 60);
  if (!canonicalUnsignedDecimalPattern.test(result)) invalid(field);
  const [whole = "", fraction = ""] = result.split(".");
  if (whole.length > 20 || fraction.length > 18 || (positive && result === "0")) invalid(field);
  return result;
}

function serializedBytes(value: unknown, field: string): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    invalid(field);
  }
}

function plainText(value: unknown, field: string, maximum: number, allowEmpty = true): string {
  const result = boundedString(value, field, maximum, allowEmpty);
  const compact = result.toLowerCase().replaceAll(" ", "");
  if (result.includes("<") || result.includes(">") || compact.includes("javascript:") || compact.includes("data:text/html")
    || compact.includes("expression(") || compact.includes("url(")) invalid(field);
  return result;
}

function color(value: unknown, field: string): void {
  if (typeof value !== "string" || !colorPattern.test(value)) invalid(field);
}

function indicatorSettings(value: unknown, indicatorId: string, timeframe: TradeChartTimeframe): void {
  const settings = value === undefined ? {} : record(value, "indicator_settings");
  if (serializedBytes(settings, "indicator_settings") > 16_384) invalid("indicator_settings");
  const allowed = indicatorSettingKeys[indicatorId];
  if (!allowed) invalid("indicator_id");
  exactKeys(settings, allowed, "indicator_settings");
  for (const [key, setting] of Object.entries(settings)) {
    if (key === "source") {
      if (typeof setting !== "string" || !new Set(["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"]).has(setting)) invalid("indicator_settings");
    } else if (key === "timeframe") {
      if (setting !== "" && setting !== timeframe) invalid("indicator_settings");
    } else if (booleanIndicatorSettings.has(key)) {
      if (typeof setting !== "boolean") invalid("indicator_settings");
    } else if (colorIndicatorSettings.has(key)) {
      color(setting, "indicator_settings");
    } else if (key === "anchor") {
      if (typeof setting !== "string" || !new Set(["session", "week", "month", "quarter", "year", "continuous"]).has(setting)) invalid("indicator_settings");
    } else if (key === "calcMode") {
      if (setting !== "stdev" && setting !== "percent") invalid("indicator_settings");
    } else if (key === "bandsStyle") {
      if (!new Set(["Average True Range", "True Range", "Range"]).has(String(setting))) invalid("indicator_settings");
    } else if (key === "kind") {
      if (!new Set(["traditional", "fibonacci", "woodie", "classic", "demark", "camarilla"]).has(String(setting))) invalid("indicator_settings");
    } else if (key === "frame") {
      if (!new Set(["auto", "daily", "weekly", "monthly", "quarterly", "yearly"]).has(String(setting))) invalid("indicator_settings");
    } else if (key === "pivotMode") {
      if (setting !== "auto" && setting !== "manual") invalid("indicator_settings");
    } else if (key === "maType") {
      if (!new Set(["None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA"]).has(String(setting))) invalid("indicator_settings");
    } else {
      finiteNumber(setting, "indicator_settings", -500, 1_000);
      const number = setting as number;
      if (key === "offset") {
        if (!Number.isInteger(number)) invalid("indicator_settings");
      } else if (["stdDev", "multiplier", "mult", "deviation", "bbMult"].includes(key)) {
        if (number <= 0 || number > 100) invalid("indicator_settings");
      } else if (["bandMult1", "bandMult2", "bandMult3", "atrMultiplier"].includes(key)) {
        if (number < 0 || number > 100) invalid("indicator_settings");
      } else if (key === "overbought" || key === "oversold") {
        if (number < 0 || number > 100) invalid("indicator_settings");
      } else if (key === "displacement") {
        if (!Number.isInteger(number) || number < 0 || number > 200) invalid("indicator_settings");
      } else if (!Number.isInteger(number) || number < 1 || number > 1_000) {
        invalid("indicator_settings");
      }
    }
  }
}

function validateIndicators(value: unknown, timeframe: TradeChartTimeframe): IndicatorSpecV1[] {
  if (!Array.isArray(value) || value.length > TRADE_CHART_MAX_INDICATORS || serializedBytes(value, "indicators") > 65_536) invalid("indicators");
  const seen = new Set<string>();
  for (const candidate of value) {
    const indicator = record(candidate, "indicator");
    exactKeys(indicator, indicatorKeys, "indicator_keys");
    const instanceId = boundedString(indicator.instanceId, "indicator_instance_id", 128);
    if (!idPattern.test(instanceId) || seen.has(instanceId)) invalid("indicator_ids");
    seen.add(instanceId);
    if (typeof indicator.indicatorId !== "string" || !indicatorIds.has(indicator.indicatorId)) invalid("indicator_id");
    indicatorSettings(indicator.settings, indicator.indicatorId, timeframe);
    if (indicator.paneIndex !== undefined) {
      if (!Number.isInteger(indicator.paneIndex) || (indicator.paneIndex as number) < 0 || (indicator.paneIndex as number) > 15) invalid("indicator_pane");
    }
  }
  return value as IndicatorSpecV1[];
}

function validateDrawingStyle(value: unknown, tool: TradeChartDrawingToolId): void {
  const style = record(value, "drawing_style");
  exactKeys(style, TRADE_CHART_DRAWING_TOOL_SCHEMAS[tool].styleKeys, "drawing_style");
  if (style.color !== undefined) color(style.color, "drawing_style");
  if (style.fillColor !== undefined) color(style.fillColor, "drawing_style");
  if (style.lineWidth !== undefined) finiteNumber(style.lineWidth, "drawing_style", 0.5, 20);
  if (style.fillOpacity !== undefined) finiteNumber(style.fillOpacity, "drawing_style", 0, 1);
  if (style.lineStyle !== undefined && !new Set(["solid", "dashed", "dotted"]).has(String(style.lineStyle))) invalid("drawing_style");
  for (const key of ["fill", "extendLeft", "extendRight", "showLabels"] as const) {
    if (style[key] !== undefined && typeof style[key] !== "boolean") invalid("drawing_style");
  }
  if (style.levels !== undefined) {
    if (!Array.isArray(style.levels) || style.levels.length > 32) invalid("drawing_style");
    for (const candidate of style.levels) {
      const level = record(candidate, "drawing_style");
      exactKeys(level, ["ratio", "color", "enabled", "label"], "drawing_style");
      finiteNumber(level.ratio, "drawing_style", -1_000_000, 1_000_000);
      if (level.color !== undefined) color(level.color, "drawing_style");
      if (level.enabled !== undefined && typeof level.enabled !== "boolean") invalid("drawing_style");
      if (level.label !== undefined) plainText(level.label, "drawing_style", 128);
    }
  }
}

function validateDrawingText(value: unknown, tool: TradeChartDrawingToolId): void {
  const text = record(value, "drawing_text");
  const schema = TRADE_CHART_DRAWING_TOOL_SCHEMAS[tool];
  exactKeys(text, schema.textKeys, "drawing_text");
  if (schema.textRequired && text.value === undefined) invalid("drawing_text");
  if (text.value !== undefined) plainText(text.value, "drawing_text", 2_000);
  if (text.color !== undefined) color(text.color, "drawing_text");
  if (text.fontSize !== undefined) finiteNumber(text.fontSize, "drawing_text", 6, 96);
  if (text.fontFamily !== undefined && (typeof text.fontFamily !== "string" || !/^[A-Za-z0-9 _,-]{0,128}$/.test(text.fontFamily))) invalid("drawing_text");
  for (const key of ["bold", "italic"] as const) if (text[key] !== undefined && typeof text[key] !== "boolean") invalid("drawing_text");
  if (text.align !== undefined && !new Set(["left", "center", "right"]).has(String(text.align))) invalid("drawing_text");
  if (text.valign !== undefined && !new Set(["top", "middle", "bottom"]).has(String(text.valign))) invalid("drawing_text");
}

function validateDrawingProperties(value: unknown, tool: TradeChartDrawingToolId): void {
  const properties = record(value, "drawing_properties");
  exactKeys(properties, TRADE_CHART_DRAWING_TOOL_SCHEMAS[tool].propertyKeys, "drawing_properties");
  if (properties.degree !== undefined && !new Set(["grand-supercycle", "supercycle", "cycle", "primary", "intermediate", "minor", "minute", "minuette", "subminuette"]).has(String(properties.degree))) invalid("drawing_properties");
  if (properties.labelStyle !== undefined && !new Set(["degree", "plain", "parentheses", "circled"]).has(String(properties.labelStyle))) invalid("drawing_properties");
  for (const key of ["showHeader", "showLossSize", "showTargetLabel", "showStopLabel", "showPrices"] as const) {
    if (properties[key] !== undefined && typeof properties[key] !== "boolean") invalid("drawing_properties");
  }
  if (properties.profitColor !== undefined) color(properties.profitColor, "drawing_properties");
  if (properties.lossColor !== undefined) color(properties.lossColor, "drawing_properties");
}

function validateDrawings(value: unknown): DrawingSpecV1[] {
  if (!Array.isArray(value) || value.length > TRADE_CHART_MAX_DRAWINGS || serializedBytes(value, "drawings") > 262_144) invalid("drawings");
  const seen = new Set<string>();
  for (const candidate of value) {
    const drawing = record(candidate, "drawing");
    exactKeys(drawing, drawingKeys, "drawing_keys");
    const id = boundedString(drawing.id, "drawing_id", 128);
    if (!idPattern.test(id) || seen.has(id)) invalid("drawing_ids");
    seen.add(id);
    if (typeof drawing.tool !== "string" || !drawingTools.has(drawing.tool)) invalid("drawing_tool");
    const tool = drawing.tool as TradeChartDrawingToolId;
    const toolSchema = TRADE_CHART_DRAWING_TOOL_SCHEMAS[tool];
    if (!Array.isArray(drawing.points) || drawing.points.length !== toolSchema.pointCount
      || drawing.points.length > TRADE_CHART_MAX_DRAWING_POINTS) invalid("drawing_points");
    for (const candidatePoint of drawing.points) {
      const point = record(candidatePoint, "drawing_point");
      exactKeys(point, ["time", "price"], "drawing_point");
      finiteNumber(point.time, "drawing_point", -10_000_000_000_000, 10_000_000_000_000);
      finiteNumber(point.price, "drawing_point", -1_000_000_000_000_000_000, 1_000_000_000_000_000_000);
    }
    validateDrawingStyle(drawing.style, tool);
    if (toolSchema.textRequired && drawing.text === undefined) invalid("drawing_text");
    if (drawing.text !== undefined) {
      if (toolSchema.textKeys.length === 0) invalid("drawing_text");
      validateDrawingText(drawing.text, tool);
    }
    if (drawing.properties !== undefined) {
      if (toolSchema.propertyKeys.length === 0) invalid("drawing_properties");
      validateDrawingProperties(drawing.properties, tool);
    }
    if (!Number.isInteger(drawing.paneIndex) || (drawing.paneIndex as number) < 0 || (drawing.paneIndex as number) > 15) invalid("drawing_pane");
    finiteNumber(drawing.zIndex, "drawing_z_index", -10_000, 10_000);
    if (drawing.locked !== undefined && typeof drawing.locked !== "boolean") invalid("drawing_locked");
    if (drawing.visible !== undefined && typeof drawing.visible !== "boolean") invalid("drawing_visible");
  }
  return value as DrawingSpecV1[];
}

export function assertChartStateV1(value: unknown): ChartStateV1 {
  const state = record(value, "state");
  exactKeys(state, stateKeys, "state_keys");
  if (state.schema_version !== TRADE_CHART_STATE_SCHEMA_VERSION) invalid("state_schema");
  if (typeof state.cycle_id !== "string" || !uuidPattern.test(state.cycle_id)) invalid("state_cycle_id");
  positiveInteger(state.cycle_revision, "state_cycle_revision");
  if (typeof state.timeframe !== "string" || !timeframes.has(state.timeframe)) invalid("state_timeframe");
  if (typeof state.price_type !== "string" || !priceTypes.has(state.price_type)) invalid("state_price_type");
  const viewport = record(state.viewport, "viewport");
  exactKeys(viewport, ["from", "to"], "viewport");
  const from = finiteNumber(viewport.from, "viewport", -10_000_000_000_000, 10_000_000_000_000);
  const to = finiteNumber(viewport.to, "viewport", -10_000_000_000_000, 10_000_000_000_000);
  if (from >= to || serializedBytes(viewport, "viewport") > 512) invalid("viewport");
  validateIndicators(state.indicators, state.timeframe as TradeChartTimeframe);
  validateDrawings(state.drawings);
  positiveInteger(state.version, "state_version");
  utcTimestamp(state.updated_at, "state_updated_at");
  return value as ChartStateV1;
}

function validateMarker(value: unknown): void {
  const marker = record(value, "marker");
  exactKeys(marker, markerKeys, "marker_keys");
  const markerKey = boundedString(marker.marker_key, "marker_key", 128);
  if (!idPattern.test(markerKey)) invalid("marker_key");
  if (typeof marker.fill_id !== "string" || !positiveIntegerStringPattern.test(marker.fill_id) || marker.fill_id.length > 30) invalid("marker_fill_id");
  utcTimestamp(marker.occurred_at, "marker_time");
  canonicalUnsignedDecimal(marker.price, "marker_price", true);
  canonicalUnsignedDecimal(marker.allocated_quantity, "marker_quantity", true);
  if (!new Set(["open", "add", "reduce", "close", "reverse_open"]).has(String(marker.allocation_role))) invalid("marker_role");
  if (!Number.isInteger(marker.sort_order) || (marker.sort_order as number) < 0) invalid("marker_sort_order");
  if (!new Set(["buy", "sell"]).has(String(marker.side))) invalid("marker_side");
  if (!new Set(["both", "long", "short"]).has(String(marker.position_side))) invalid("marker_position_side");
  if (!new Set(["maker", "taker", "unknown"]).has(String(marker.liquidity))) invalid("marker_liquidity");
  const providerMask = boundedString(marker.provider_fill_id_mask, "marker_mask", 80);
  if (!/^(?:\u2022{4}|\*{4})[A-Za-z0-9]{4}$/u.test(providerMask)) invalid("marker_mask");
  if (marker.annotation !== null) {
    const annotation = record(marker.annotation, "annotation");
    exactKeys(annotation, annotationKeys, "annotation_keys");
    if (typeof annotation.id !== "string" || !uuidPattern.test(annotation.id)) invalid("annotation_id");
    plainText(annotation.body, "annotation_body", 5_000);
    if (!Array.isArray(annotation.tags) || annotation.tags.length > 10) invalid("annotation_tags");
    const tags = new Set<string>();
    for (const tag of annotation.tags) {
      if (typeof tag !== "string" || tag.length < 1 || tag.length > 40 || tag !== tag.trim().toLowerCase() || tags.has(tag)) invalid("annotation_tags");
      tags.add(tag);
    }
    if (!Number.isInteger(annotation.image_count) || (annotation.image_count as number) < 0 || (annotation.image_count as number) > 5) invalid("annotation_images");
    positiveInteger(annotation.version, "annotation_version");
    if (!new Set(["current", "remapped", "needs_confirmation"]).has(String(annotation.remap_status))) invalid("annotation_remap");
  }
}

function validateProjectionCoverage(value: unknown, projection: Record<string, unknown>): void {
  const coverage = record(value, "coverage");
  exactKeys(coverage, coverageKeys, "coverage_keys");
  if (typeof coverage.status !== "string" || !coverageStatuses.has(coverage.status)) invalid("coverage_status");
  if (coverage.source !== null && (typeof coverage.source !== "string" || !candleSources.has(coverage.source))) invalid("coverage_source");
  if (coverage.fetched_at !== null) utcTimestamp(coverage.fetched_at, "coverage_fetched_at");
  if (!Array.isArray(coverage.gaps) || coverage.gaps.length > 1_000) invalid("coverage_gaps");
  const range = record(projection.range, "range");
  const previousEnd = new Map<string, number>();
  for (const candidate of coverage.gaps) {
    const gap = record(candidate, "coverage_gap");
    exactKeys(gap, ["series_basis", "from", "to"], "coverage_gap");
    const seriesBasis = String(gap.series_basis);
    if (!new Set(["trade", "mark", "bid", "ask"]).has(seriesBasis)
      || (projection.price_type === "both" ? seriesBasis !== "bid" && seriesBasis !== "ask" : seriesBasis !== projection.price_type)) {
      invalid("coverage_gap");
    }
    const from = utcTimestamp(gap.from, "coverage_gap");
    const to = utcTimestamp(gap.to, "coverage_gap");
    if (Date.parse(from) >= Date.parse(to) || Date.parse(from) < Date.parse(String(range.from))
      || Date.parse(to) > Date.parse(String(range.to))
      || Date.parse(from) < (previousEnd.get(seriesBasis) ?? 0)) invalid("coverage_gaps");
    previousEnd.set(seriesBasis, Date.parse(to));
  }
  if (coverage.status === "unavailable") {
    if (projection.candles instanceof Array && projection.candles.length > 0) invalid("coverage_unavailable");
    if (coverage.source !== null || coverage.fetched_at !== null || coverage.gaps.length > 0
      || typeof coverage.unavailable_reason !== "string" || !unavailableReasons.has(coverage.unavailable_reason)) invalid("coverage_unavailable");
  } else if (coverage.status === "empty") {
    if (!(projection.candles instanceof Array) || projection.candles.length !== 0
      || coverage.source === null || coverage.fetched_at === null || coverage.gaps.length > 0
      || coverage.unavailable_reason !== null) invalid("coverage_empty");
  } else {
    if (coverage.source === null || coverage.fetched_at === null || coverage.unavailable_reason !== null) invalid("coverage_available");
    if (coverage.status === "gapped" ? coverage.gaps.length === 0 : coverage.gaps.length > 0) invalid("coverage_gaps");
  }
}

export function assertTradeChartProjection(value: unknown): TradeChartProjection {
  const projection = record(value, "projection");
  exactKeys(projection, projectionKeys, "projection_keys");
  if (projection.schema_version !== TRADE_CHART_PROJECTION_SCHEMA_VERSION) invalid("projection_schema");
  if (typeof projection.cycle_id !== "string" || !uuidPattern.test(projection.cycle_id)) invalid("projection_cycle_id");
  positiveInteger(projection.cycle_revision, "projection_cycle_revision");
  if (!isTradingProvider(projection.provider)) invalid("projection_provider");
  if (typeof projection.product !== "string" || !products.has(projection.product)) invalid("projection_product");
  if ((projection.provider === "exness" && projection.product !== "cfd")
    || (projection.provider !== "exness" && projection.product === "cfd")) invalid("projection_product");
  const symbol = boundedString(projection.symbol, "projection_symbol", 100);
  if (!safeSymbolPattern.test(symbol)) invalid("projection_symbol");
  const nativeSymbol = boundedString(projection.native_symbol, "projection_native_symbol", 100);
  if (!safeSymbolPattern.test(nativeSymbol)) invalid("projection_native_symbol");
  if (projection.direction !== "long" && projection.direction !== "short") invalid("projection_direction");
  const openedAt = utcTimestamp(projection.opened_at, "projection_opened_at");
  const closedAt = projection.closed_at === null ? null : utcTimestamp(projection.closed_at, "projection_closed_at");
  if (closedAt !== null && Date.parse(openedAt) > Date.parse(closedAt)) invalid("projection_cycle_time");
  if (typeof projection.timeframe !== "string" || !timeframes.has(projection.timeframe)) invalid("projection_timeframe");
  if (typeof projection.price_type !== "string" || !priceTypes.has(projection.price_type)) invalid("projection_price_type");
  if ((projection.provider === "exness" && !new Set(["bid", "ask", "both"]).has(projection.price_type))
    || (projection.provider !== "exness" && !new Set(["trade", "mark"]).has(projection.price_type))) invalid("projection_price_type");
  const range = record(projection.range, "range");
  exactKeys(range, ["from", "to"], "range");
  const rangeFrom = utcTimestamp(range.from, "range_from");
  const rangeTo = utcTimestamp(range.to, "range_to");
  if (Date.parse(rangeFrom) >= Date.parse(rangeTo) || Date.parse(openedAt) < Date.parse(rangeFrom)
    || (closedAt !== null && Date.parse(closedAt) > Date.parse(rangeTo))) invalid("range");
  if (!Array.isArray(projection.candles) || projection.candles.length > TRADE_CHART_MAX_CANDLES) invalid("candles");
  const candleRequest: CandleRequest = {
    product: projection.product as CandleRequest["product"],
    native_symbol: nativeSymbol,
    normalized_symbol: symbol,
    timeframe: projection.timeframe as CandleRequest["timeframe"],
    price_mode: projection.price_type as CandleRequest["price_mode"],
    from: rangeFrom,
    to: rangeTo,
    limit: Math.max(1, projection.candles.length),
  };
  const coverage = record(projection.coverage, "coverage");
  assertCanonicalCandleBatch({
    provider: projection.provider,
    request: candleRequest,
    candles: projection.candles,
    coverage: {
      status: coverage.status,
      range_start: rangeFrom,
      range_end: rangeTo,
      source: coverage.source,
      fetched_at: coverage.fetched_at,
      gaps: coverage.gaps,
      unavailable_reason: coverage.unavailable_reason,
    },
    warnings: projection.warnings,
  });
  if (!Array.isArray(projection.markers) || projection.markers.length > TRADE_CHART_MAX_MARKERS) invalid("markers");
  const markerKeysSeen = new Set<string>();
  const fillIds = new Set<string>();
  let previousMarker: Record<string, unknown> | null = null;
  for (let markerIndex = 0; markerIndex < projection.markers.length; markerIndex += 1) {
    const candidate = projection.markers[markerIndex];
    validateMarker(candidate);
    const marker = candidate as Record<string, unknown>;
    if (markerKeysSeen.has(marker.marker_key as string) || fillIds.has(marker.fill_id as string)) invalid("marker_ids");
    markerKeysSeen.add(marker.marker_key as string);
    fillIds.add(marker.fill_id as string);
    if (marker.sort_order !== markerIndex) invalid("marker_sort_order");
    const markerTime = Date.parse(marker.occurred_at as string);
    if (markerTime < Date.parse(rangeFrom) || markerTime > Date.parse(rangeTo)) invalid("marker_range");
    if (markerTime < Date.parse(openedAt) || markerTime > Date.parse(closedAt ?? rangeTo)) invalid("marker_lifetime");
    if (previousMarker !== null) {
      const timeDifference = Date.parse(marker.occurred_at as string) - Date.parse(previousMarker.occurred_at as string);
      if (timeDifference < 0
        || (timeDifference === 0 && ((marker.sort_order as number) < (previousMarker.sort_order as number)
          || ((marker.sort_order as number) === (previousMarker.sort_order as number)
            && (marker.fill_id as string) < (previousMarker.fill_id as string))))) invalid("marker_order");
    }
    previousMarker = marker;
  }
  if (projection.chart_state !== null) {
    const state = assertChartStateV1(projection.chart_state);
    if (state.cycle_id !== projection.cycle_id || state.cycle_revision !== projection.cycle_revision
      || state.timeframe !== projection.timeframe || state.price_type !== projection.price_type) invalid("projection_state");
  }
  validateProjectionCoverage(projection.coverage, projection);
  if (!Array.isArray(projection.warnings) || projection.warnings.length > 50
    || projection.warnings.some((warning) => typeof warning !== "string" || !warningCodes.has(warning))) invalid("warnings");
  return value as TradeChartProjection;
}
