import {
  PUBLIC_STRATEGY_CALCULATION_ENGINE_VERSION,
  PUBLIC_STRATEGY_RENDERER_VERSION,
  PUBLIC_STRATEGY_SCHEMA_VERSION,
  TRADE_CHART_CANDLE_SERIES_BASES,
  TRADE_CHART_CANDLE_SOURCES,
  TRADE_CHART_COVERAGE_STATUSES,
  TRADE_CHART_DRAWING_TOOL_SCHEMAS,
  TRADE_CHART_INDICATOR_SETTING_KEYS,
  TRADE_CHART_MAX_CANDLES,
  TRADE_CHART_MAX_DRAWINGS,
  TRADE_CHART_MAX_INDICATORS,
  TRADE_CHART_MAX_MARKERS,
  TRADE_CHART_PRICE_TYPES,
  TRADE_CHART_TIMEFRAMES,
  TRADE_CHART_WARNING_CODES,
  TRADING_PRODUCTS,
  TRADING_PROVIDERS,
  isPublicStrategyText,
  type PublicStrategyProjection,
  type PublicStrategySnapshot,
  type TradeChartDrawingToolId,
} from "@wavekb/domain/trading-review";

type Check = (value: unknown) => boolean;
type Fields = Readonly<Record<string, Check>>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shape(fields: Fields): Check {
  return (value) => record(value) && Object.keys(value).every((key) => Object.hasOwn(fields, key))
    && Object.entries(fields).every(([key, check]) => check(value[key]));
}

const optional = (check: Check): Check => (value) => value === undefined || check(value);
const nullable = (check: Check): Check => (value) => value === null || check(value);
const oneOf = (...values: readonly string[]): Check => (value) => typeof value === "string" && values.includes(value);
const arrayOf = (check: Check, maximum: number, minimum = 0): Check => (value) => (
  Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(check)
);
const pattern = (regex: RegExp): Check => (value) => typeof value === "string" && regex.test(value);
const text = (max: number): Check => (value) => (
  typeof value === "string" && value.length <= max && isPublicStrategyText(value)
);
const scalarNumber: Check = (value) => typeof value === "number" && Number.isFinite(value);
const boolean: Check = (value) => typeof value === "boolean";
const disabled: Check = (value) => value === false;
const timestamp = pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const unsignedDecimal = pattern(/^(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/);
const decimal = pattern(/^-?(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/);
const opaqueKey = pattern(/^[0-9a-f]{32}$/);
const color = pattern(/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
export const strategySnapshotIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const amount = shape({ amount: decimal, currency: pattern(/^[A-Z][A-Z0-9]{1,11}$/) });
const seriesBasis = oneOf(...TRADE_CHART_CANDLE_SERIES_BASES);
const candle = shape({
  series_basis: seriesBasis, open_time: timestamp, close_time: timestamp,
  open: unsignedDecimal, high: unsignedDecimal, low: unsignedDecimal, close: unsignedDecimal, volume: nullable(unsignedDecimal),
  status: oneOf("final", "partial"), gap_before: boolean, gap_after: boolean,
});
const annotation = shape({ marker_key: opaqueKey, body: text(5_000), tags: arrayOf(text(40), 10) });
const coverage = shape({
  status: oneOf(...TRADE_CHART_COVERAGE_STATUSES), source: nullable(oneOf(...TRADE_CHART_CANDLE_SOURCES)),
  fetched_at: nullable(timestamp), gaps: arrayOf(shape({ series_basis: seriesBasis, from: timestamp, to: timestamp }), TRADE_CHART_MAX_CANDLES),
});
const plot = shape({ points: arrayOf(shape({ time: timestamp, value: nullable(decimal) }), TRADE_CHART_MAX_CANDLES, 1) });
const indicatorSettingText = oneOf(
  "", ...TRADE_CHART_TIMEFRAMES, "open", "high", "low", "close", "hl2", "hlc3", "ohlc4",
  "session", "week", "month", "quarter", "year", "continuous", "stdev", "percent", "Average True Range", "True Range", "Range",
  "traditional", "fibonacci", "woodie", "classic", "demark", "camarilla", "auto", "manual", "daily", "weekly", "monthly", "quarterly", "yearly",
  "None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA",
);
const indicator: Check = (value) => {
  if (!record(value) || typeof value.indicator_id !== "string"
    || !Object.hasOwn(TRADE_CHART_INDICATOR_SETTING_KEYS, value.indicator_id)) return false;
  const settings = TRADE_CHART_INDICATOR_SETTING_KEYS[value.indicator_id]!;
  return shape({
    id: opaqueKey, indicator_id: oneOf(value.indicator_id), pane_index: optional(scalarNumber), series: arrayOf(plot, 16, 1),
    settings: optional(shape(Object.fromEntries(settings.map((key) => [key, optional(
      key.toLowerCase().endsWith("color") ? color : (setting) => boolean(setting) || scalarNumber(setting) || indicatorSettingText(setting),
    )])))),
  })(value);
};

const drawingStyle: Fields = {
  color, lineWidth: scalarNumber, lineStyle: oneOf("solid", "dashed", "dotted"), fill: boolean, fillColor: color, fillOpacity: scalarNumber,
  extendLeft: boolean, extendRight: boolean, showLabels: boolean, showStats: boolean,
  levels: arrayOf(shape({ ratio: scalarNumber, color: optional(color), enabled: optional(boolean), label: optional(text(128)) }), 32),
};
const drawingLabel: Fields = {
  value: text(2_000), color, fontSize: scalarNumber, fontFamily: pattern(/^[A-Za-z0-9 _,-]{0,128}$/),
  bold: boolean, italic: boolean, align: oneOf("left", "center", "right"), valign: oneOf("top", "middle", "bottom"),
};
const drawingProperties: Fields = {
  degree: oneOf("grand-supercycle", "supercycle", "cycle", "primary", "intermediate", "minor", "minute", "minuette", "subminuette"),
  labelStyle: oneOf("degree", "plain", "parentheses", "circled"),
  showHeader: disabled, showLossSize: disabled, showTargetLabel: disabled, showStopLabel: disabled, showPrices: boolean,
  profitColor: color, lossColor: color, stopTime: scalarNumber, stopPrice: scalarNumber,
};

function drawingFields(fields: Fields, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(fields, key)).map((key) => [key, optional(fields[key]!)]));
}

const point = shape({ time: scalarNumber, price: scalarNumber });
const drawing: Check = (value) => {
  if (!record(value) || typeof value.tool !== "string" || !Object.hasOwn(TRADE_CHART_DRAWING_TOOL_SCHEMAS, value.tool)) return false;
  const { styleKeys, textKeys, propertyKeys, pointCount } = TRADE_CHART_DRAWING_TOOL_SCHEMAS[value.tool as TradeChartDrawingToolId];
  const style = drawingFields(drawingStyle, styleKeys);
  const properties = drawingFields(drawingProperties, propertyKeys);
  const isPosition = value.tool === "long-position" || value.tool === "short-position";
  if (isPosition) {
    style.showLabels = disabled;
    Object.assign(properties, { showHeader: disabled, showLossSize: disabled, showTargetLabel: disabled, showStopLabel: disabled });
  }
  return shape({
    id: opaqueKey, tool: oneOf(value.tool), points: arrayOf(point, pointCount, pointCount), style: shape(style),
    text: optional(shape(drawingFields(drawingLabel, textKeys))),
    properties: isPosition ? shape(properties) : optional(shape(properties)),
    paneIndex: scalarNumber, locked: (value) => value === true, visible: (value) => value === true, zIndex: scalarNumber,
  })(value);
};

/** The anonymous read boundary accepts only the versioned DTO, including at nested records. */
export function isPublicStrategyProjection(value: unknown): value is PublicStrategyProjection {
  if (!record(value)) return false;
  const quantity = value.show_quantity === true ? optional(unsignedDecimal) : (item: unknown) => item === undefined;
  const absolutePnl = value.show_absolute_pnl === true ? optional(amount) : (item: unknown) => item === undefined;
  const marker = shape({
    marker_key: opaqueKey, occurred_at: timestamp, price: unsignedDecimal, allocation_role: oneOf("open", "add", "reduce", "close", "reverse_open"),
    side: oneOf("buy", "sell"), position_side: oneOf("both", "long", "short"), liquidity: oneOf("maker", "taker", "unknown"),
    quantity, absolute_pnl: absolutePnl,
  });
  return shape({
    schema_version: oneOf(PUBLIC_STRATEGY_SCHEMA_VERSION), renderer_schema_version: oneOf(PUBLIC_STRATEGY_RENDERER_VERSION),
    calculation_engine_version: oneOf(PUBLIC_STRATEGY_CALCULATION_ENGINE_VERSION),
    provider: oneOf(...TRADING_PROVIDERS), product: oneOf(...TRADING_PRODUCTS), symbol: pattern(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/),
    direction: oneOf("long", "short"), timeframe: oneOf(...TRADE_CHART_TIMEFRAMES), price_type: oneOf(...TRADE_CHART_PRICE_TYPES),
    range: shape({ from: timestamp, to: timestamp }), snapshot_status: oneOf("closed", "open_at_snapshot"),
    candles: arrayOf(candle, TRADE_CHART_MAX_CANDLES, 1), markers: arrayOf(marker, TRADE_CHART_MAX_MARKERS, 1),
    public_annotations: arrayOf(annotation, TRADE_CHART_MAX_MARKERS), indicators: arrayOf(indicator, TRADE_CHART_MAX_INDICATORS),
    drawings: arrayOf(drawing, TRADE_CHART_MAX_DRAWINGS), coverage,
    show_quantity: boolean, show_absolute_pnl: boolean, price_return_rate: nullable(decimal), price_return_label: text(120),
    warnings: arrayOf(oneOf(...TRADE_CHART_WARNING_CODES, "hidden_value_may_be_inferred"), TRADE_CHART_WARNING_CODES.length + 1),
    quantity, absolute_pnl: absolutePnl,
  })(value);
}

const snapshot = shape({
  id: pattern(strategySnapshotIdPattern), post_id: pattern(strategySnapshotIdPattern),
  projection_digest: pattern(/^[0-9a-f]{64}$/), projection: isPublicStrategyProjection,
});

export function isPublicStrategySnapshot(value: unknown): value is PublicStrategySnapshot {
  return snapshot(value);
}
