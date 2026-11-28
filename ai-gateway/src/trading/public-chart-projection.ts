import { createHash, createHmac } from "node:crypto";
import {
  PUBLIC_STRATEGY_CALCULATION_ENGINE_VERSION,
  PUBLIC_STRATEGY_MAX_BYTES,
  PUBLIC_STRATEGY_RENDERER_VERSION,
  PUBLIC_STRATEGY_SCHEMA_VERSION,
  TRADE_CHART_DRAWING_TOOL_SCHEMAS,
  TRADE_CHART_MAX_CANDLES,
  TRADE_CHART_MAX_DRAWINGS,
  TRADE_CHART_MAX_INDICATORS,
  TRADE_CHART_MAX_MARKERS,
  isPublicStrategyText,
  type DrawingSpecV1,
  type DrawingStyleV1,
  type IndicatorPoint,
  type IndicatorSeries,
  type IndicatorSpecV1,
  type PublicAmount,
  type PublicAnnotation,
  type PublicCandle,
  type PublicIndicator,
  type PublicMarker,
  type PublicStrategyChoices,
  type PublicStrategyProjection,
  type TradeChartCandleV1,
  type TradeChartProjection,
  type TradeCycleView,
} from "@wavekb/domain/trading-review";
import { assertTradeChartProjection } from "./chart-contracts.ts";

export {
  PUBLIC_STRATEGY_CALCULATION_ENGINE_VERSION,
  PUBLIC_STRATEGY_MAX_BYTES,
  PUBLIC_STRATEGY_RENDERER_VERSION,
  PUBLIC_STRATEGY_SCHEMA_VERSION,
  type PublicStrategyChoices,
  type PublicStrategyProjection,
} from "@wavekb/domain/trading-review";

/** Frozen series in the indicator registry's declared output order. */
export type ComputedStrategyIndicator = {
  instanceId: string;
  series: readonly { points: readonly IndicatorPoint[] }[];
};

export type PublicStrategyProjectionInput = {
  projection: TradeChartProjection;
  trade: Pick<TradeCycleView, "id" | "revision" | "provider" | "product" | "symbol" | "direction" | "entry_price" | "exit_price"
    | "completeness" | "account_currency" | "quantity" | "net_pnl">;
  /** Fresh cryptographically random bytes for one preview or its exact retry. */
  snapshotSeed: Buffer;
  choices: PublicStrategyChoices;
  computedIndicators?: readonly ComputedStrategyIndicator[];
  /** Optional exact realized values from owner-bound fill facts. */
  fillPnl?: ReadonlyMap<string, string>;
};

const decimalPattern = /^-?(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/;
const quantityPattern = /^(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/;
const currencyPattern = /^[A-Z][A-Z0-9]{1,11}$/;
const volumeStudies = new Set<IndicatorSpecV1["indicatorId"]>(["vwap", "obv", "mfi", "chaikin-money-flow"]);
const choiceKeys = new Set<string>(["show_quantity", "show_absolute_pnl", "annotation_fill_ids", "drawing_ids", "indicator_instance_ids"]);

function invalid(code: string): never {
  throw Object.assign(new Error(`public_strategy_${code}`), { statusCode: code === "payload_too_large" ? 413 : 400 });
}

function opaqueKey(seed: Buffer, scope: "fill" | "drawing" | "indicator", privateId: string) {
  return createHmac("sha256", seed).update(scope).update("\0").update(privateId).digest("hex").slice(0, 32);
}

function selectedIds(value: unknown, maximum: number) {
  if (value === undefined) return new Set<string>();
  if (!Array.isArray(value) || value.length > maximum
    || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 128)) invalid("selection_invalid");
  const ids = new Set(value as string[]);
  if (ids.size !== value.length) invalid("selection_invalid");
  return ids;
}

function publicText(value: string): string {
  if (!isPublicStrategyText(value)) invalid("text_unsafe");
  return value;
}

function positivePrice(value: unknown) {
  return typeof value === "string" && quantityPattern.test(value) && /[1-9]/.test(value);
}

function priceReturn(input: PublicStrategyProjectionInput, candles: PublicCandle[]) {
  const { projection, trade } = input;
  let exit = trade.exit_price;
  let realized = true;
  let valuedAt: string | null = null;
  if (projection.closed_at === null) {
    if (trade.completeness !== "open" || projection.coverage.status === "stale") exit = null;
    else {
      const basis = projection.price_type === "both" ? (projection.direction === "long" ? "bid" : "ask") : projection.price_type;
      exit = null;
      for (let index = candles.length - 1; index >= 0; index -= 1) {
        const candle = candles[index]!;
        if (candle.series_basis !== basis || candle.status !== "final"
          || candle.close_time > projection.range.to || candle.close_time < projection.opened_at) continue;
        exit = candle.close;
        valuedAt = candle.close_time;
        break;
      }
    }
    realized = false;
  } else if (trade.completeness !== "complete") exit = null;
  if (!positivePrice(trade.entry_price) || !positivePrice(exit) || exit === null) {
    return { rate: null, label: "价格收益率（无法可靠计算）" };
  }

  // Multiplying both prices by 10^18 keeps the signed price change exact.
  // The final percent is truncated towards zero at 18 decimal places.
  const scaledDecimal = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(18, "0"));
  };
  const entry = scaledDecimal(trade.entry_price);
  const delta = (scaledDecimal(exit) - entry) * (projection.direction === "short" ? -1n : 1n);
  const rate = delta * 100n * 10n ** 18n / entry;
  const negative = rate < 0n;
  const digits = (negative ? -rate : rate).toString().padStart(19, "0");
  const fraction = digits.slice(-18).replace(/0+$/, "");
  return {
    rate: `${negative ? "-" : ""}${digits.slice(0, -18)}${fraction ? `.${fraction}` : ""}`,
    label: realized
      ? "价格收益率（不含手续费、资金费、掉期和杠杆）"
      : `价格收益率（未实现，截至 ${valuedAt}）`,
  };
}

function publicAmount(amount: string, currency: string): PublicAmount {
  if (typeof amount !== "string" || !decimalPattern.test(amount)
    || typeof currency !== "string" || !currencyPattern.test(currency)) invalid("amount_invalid");
  return { amount, currency };
}

function projectCandle(candle: TradeChartCandleV1): PublicCandle {
  return {
    series_basis: candle.series_basis, open_time: candle.open_time, close_time: candle.close_time,
    open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume,
    status: candle.status, gap_before: candle.gap_before, gap_after: candle.gap_after,
  };
}

function projectDrawing(drawing: DrawingSpecV1, seed: Buffer, range: TradeChartProjection["range"]): DrawingSpecV1 {
  const { id, tool, points, paneIndex, zIndex } = drawing;
  const schema = TRADE_CHART_DRAWING_TOOL_SCHEMAS[tool];
  const rangeFrom = Date.parse(range.from) / 1_000;
  const rangeTo = Date.parse(range.to) / 1_000;
  if (points.some(({ time }) => time < rangeFrom || time > rangeTo)
    || (drawing.properties?.stopTime !== undefined
      && (drawing.properties.stopTime < rangeFrom || drawing.properties.stopTime > rangeTo))) invalid("drawing_outside_range");

  const style: DrawingStyleV1 = Object.fromEntries(schema.styleKeys.flatMap((key) => {
    const value = drawing.style[key];
    if (value === undefined || key === "levels" || key === "risk" || key === "accountSize") return [];
    return [[key, value]];
  }));
  if (drawing.style.levels) {
    style.levels = drawing.style.levels.map(({ ratio, color, enabled, label }) => ({
      ratio,
      ...(color === undefined ? {} : { color }),
      ...(enabled === undefined ? {} : { enabled }),
      ...(label === undefined ? {} : { label: publicText(label) }),
    }));
  }
  const text = drawing.text;
  const properties = drawing.properties;
  const publicDrawing: DrawingSpecV1 = {
    id: opaqueKey(seed, "drawing", id), tool, points: points.map(({ time, price }) => ({ time, price })),
    style, paneIndex, zIndex, locked: true, visible: true,
    ...(text === undefined ? {} : { text: Object.fromEntries(schema.textKeys.flatMap((key) => {
      const value = text[key];
      return value === undefined ? [] : [[key, key === "value" ? publicText(value as string) : value]];
    })) }),
    ...(properties === undefined ? {} : { properties: Object.fromEntries(schema.propertyKeys.flatMap((key) =>
      properties[key] === undefined ? [] : [[key, properties[key]]],
    )) }),
  };
  if (tool === "long-position" || tool === "short-position") {
    // The renderer must not synthesize private account-size labels from its defaults.
    style.showLabels = false;
    publicDrawing.properties = {
      ...publicDrawing.properties,
      showHeader: false, showLossSize: false, showTargetLabel: false, showStopLabel: false,
    };
  }
  return publicDrawing;
}

function projectIndicators(input: PublicStrategyProjectionInput) {
  const { projection, choices, computedIndicators = [], snapshotSeed } = input;
  const definitions = projection.chart_state?.indicators ?? [];
  const requested = choices.indicator_instance_ids === undefined
    ? new Set(definitions.map(({ instanceId }) => instanceId))
    : selectedIds(choices.indicator_instance_ids, TRADE_CHART_MAX_INDICATORS);
  const outputById = new Map(computedIndicators.map((output) => [output.instanceId, output]));
  if (outputById.size !== computedIndicators.length || computedIndicators.length > TRADE_CHART_MAX_INDICATORS) {
    invalid("indicator_output_invalid");
  }
  const candleTimes = new Set(projection.candles.map(({ open_time }) => open_time));
  const hasVolume = projection.price_type === "trade" && projection.candles.every(({ volume }) => volume !== null)
    && projection.candles.some(({ volume }) => volume !== null && /[1-9]/.test(volume));
  const indicators: PublicIndicator[] = [];
  for (const indicator of definitions) {
    const { indicatorId, instanceId, settings, paneIndex } = indicator;
    if (!requested.delete(instanceId)) continue;
    if ((volumeStudies.has(indicatorId) || settings?.maType === "VWMA") && !hasVolume) invalid("indicator_data_unavailable");
    if (typeof settings?.timeframe === "string" && settings.timeframe !== "" && settings.timeframe !== projection.timeframe) {
      invalid("indicator_data_unavailable");
    }
    const frozen = outputById.get(instanceId);
    if (!frozen) invalid("indicator_output_missing");
    if (!Array.isArray(frozen.series) || frozen.series.length === 0 || frozen.series.length > 16) invalid("indicator_output_invalid");
    let hasValue = false;
    const series = frozen.series.map(({ points }: { points: readonly IndicatorPoint[] }): IndicatorSeries => {
      if (!Array.isArray(points) || points.length === 0 || points.length > TRADE_CHART_MAX_CANDLES) invalid("indicator_output_invalid");
      let previous: string | null = null;
      return { points: points.map(({ time, value }: IndicatorPoint) => {
        if (typeof time !== "string" || !candleTimes.has(time) || (previous !== null && time <= previous)
          || (value !== null && (typeof value !== "string" || !decimalPattern.test(value)))) invalid("indicator_output_invalid");
        previous = time;
        if (value !== null) hasValue = true;
        return { time, value };
      }) };
    });
    if (!hasValue) invalid("indicator_data_unavailable");
    indicators.push({
      id: opaqueKey(snapshotSeed, "indicator", instanceId), indicator_id: indicatorId,
      ...(settings === undefined ? {} : { settings: Object.fromEntries(Object.entries(settings)) }),
      ...(paneIndex === undefined ? {} : { pane_index: paneIndex }),
      series,
    });
  }
  if (requested.size > 0) invalid("selection_invalid");
  return indicators;
}

function canonicalize(value: unknown) {
  let databaseBytes = 0;
  function reserve(bytes: number) {
    databaseBytes += bytes;
    if (databaseBytes > PUBLIC_STRATEGY_MAX_BYTES) invalid("payload_too_large");
  }
  function encode(item: unknown, depth: number): string {
    if (depth > 32) invalid("payload_invalid");
    if (item === null || typeof item === "boolean" || typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) {
      const scalar = JSON.stringify(item);
      reserve(Buffer.byteLength(scalar, "utf8"));
      // JSONB numeric text can expand the exponent written by JSON.stringify.
      if (typeof item === "number") reserve(Math.abs(Number(scalar.split("e")[1] ?? 0)));
      return scalar;
    }
    if (Array.isArray(item)) {
      reserve(2 + 2 * Math.max(0, item.length - 1));
      const parts = Array.from(item, (child) => encode(child, depth + 1));
      return `[${parts.join(",")}]`;
    }
    if (typeof item !== "object" || item === null || (Object.getPrototypeOf(item) !== Object.prototype
      && Object.getPrototypeOf(item) !== null)) invalid("payload_invalid");
    const keys = Object.keys(item).sort();
    reserve(2 + 2 * Math.max(0, keys.length - 1));
    const parts = keys.map((key) => {
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property || !Object.hasOwn(property, "value")) invalid("payload_invalid");
      const encodedKey = JSON.stringify(key);
      reserve(Buffer.byteLength(encodedKey, "utf8") + 2);
      return `${encodedKey}:${encode(property.value, depth + 1)}`;
    });
    return `{${parts.join(",")}}`;
  }
  return encode(value, 0);
}

export function digestPublicStrategyProjection(projection: unknown): string {
  if (!projection || typeof projection !== "object" || !("schema_version" in projection)
    || projection.schema_version !== PUBLIC_STRATEGY_SCHEMA_VERSION) invalid("payload_invalid");
  return createHash("sha256").update(canonicalize(projection)).digest("hex");
}

/** Generate one exact public candidate from owner-verified source facts. */
export function projectPublicStrategy(input: PublicStrategyProjectionInput) {
  const { trade, snapshotSeed: seed, choices, fillPnl } = input;
  let source: TradeChartProjection;
  try { source = assertTradeChartProjection(input.projection); }
  catch { invalid("source_invalid"); }
  if (source.cycle_id !== trade.id || source.cycle_revision !== trade.revision || source.provider !== trade.provider
    || source.product !== trade.product || source.direction !== trade.direction || source.symbol !== trade.symbol
    || source.symbol.length > 80 || !Buffer.isBuffer(seed) || seed.length !== 32) invalid("source_invalid");
  if (source.candles.length === 0 || source.markers.length === 0 || source.coverage.source === null) {
    invalid("coverage_unavailable");
  }
  if (source.candles.some(({ open_time, close_time }) => open_time < source.range.from || close_time > source.range.to)) {
    invalid("coverage_invalid");
  }
  if (!choices || typeof choices !== "object" || Array.isArray(choices)
    || Reflect.ownKeys(choices).some((key) => typeof key !== "string" || !choiceKeys.has(key))
    || (choices.show_quantity !== undefined && typeof choices.show_quantity !== "boolean")
    || (choices.show_absolute_pnl !== undefined && typeof choices.show_absolute_pnl !== "boolean")) invalid("selection_invalid");
  const showQuantity = choices.show_quantity === true;
  const showPnl = choices.show_absolute_pnl === true;
  const noteIds = selectedIds(choices.annotation_fill_ids, TRADE_CHART_MAX_MARKERS);
  const drawingIds = selectedIds(choices.drawing_ids, TRADE_CHART_MAX_DRAWINGS);
  const publicAnnotations: PublicAnnotation[] = [];
  const candles = source.candles.map(projectCandle);
  const markers = source.markers.map((marker): PublicMarker => {
    const markerKey = opaqueKey(seed, "fill", marker.fill_id);
    if (noteIds.delete(marker.fill_id)) {
      if (!marker.annotation || marker.annotation.remap_status === "needs_confirmation") invalid("selection_invalid");
      publicAnnotations.push({
        marker_key: markerKey, body: publicText(marker.annotation.body), tags: marker.annotation.tags.map(publicText),
      });
    }
    const pnl = showPnl ? fillPnl?.get(marker.fill_id) : undefined;
    return {
      marker_key: markerKey, occurred_at: marker.occurred_at, price: marker.price, allocation_role: marker.allocation_role,
      side: marker.side, position_side: marker.position_side, liquidity: marker.liquidity,
      ...(showQuantity ? { quantity: marker.allocated_quantity } : {}),
      ...(pnl === undefined ? {} : { absolute_pnl: publicAmount(pnl, trade.account_currency) }),
    };
  });
  const drawings: DrawingSpecV1[] = [];
  for (const drawing of source.chart_state?.drawings ?? []) {
    if (drawingIds.delete(drawing.id)) drawings.push(projectDrawing(drawing, seed, source.range));
  }
  if (noteIds.size > 0 || drawingIds.size > 0) invalid("selection_invalid");
  if (showQuantity && !positivePrice(trade.quantity)) invalid("amount_invalid");
  const { rate, label } = priceReturn(input, candles);
  const projection: PublicStrategyProjection = {
    schema_version: PUBLIC_STRATEGY_SCHEMA_VERSION,
    renderer_schema_version: PUBLIC_STRATEGY_RENDERER_VERSION,
    calculation_engine_version: PUBLIC_STRATEGY_CALCULATION_ENGINE_VERSION,
    provider: source.provider, product: source.product, symbol: source.symbol,
    direction: source.direction, timeframe: source.timeframe, price_type: source.price_type,
    range: { from: source.range.from, to: source.range.to },
    snapshot_status: source.closed_at === null ? "open_at_snapshot" : "closed",
    candles, markers, public_annotations: publicAnnotations, indicators: projectIndicators(input), drawings,
    coverage: {
      status: source.coverage.status, source: source.coverage.source, fetched_at: source.coverage.fetched_at,
      gaps: source.coverage.gaps.map(({ from, to, series_basis }) => ({ from, to, series_basis })),
    },
    show_quantity: showQuantity, show_absolute_pnl: showPnl,
    price_return_rate: rate, price_return_label: label,
    warnings: [...new Set<PublicStrategyProjection["warnings"][number]>(source.warnings)].sort(),
    ...(showQuantity ? { quantity: trade.quantity } : {}),
    ...(showPnl ? { absolute_pnl: publicAmount(trade.net_pnl, trade.account_currency) } : {}),
  };
  if (showQuantity !== showPnl) projection.warnings.push("hidden_value_may_be_inferred");
  const canonicalJson = canonicalize(projection);
  return { projection, canonicalJson, digest: createHash("sha256").update(canonicalJson).digest("hex") };
}
