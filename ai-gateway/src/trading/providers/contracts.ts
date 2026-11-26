import type {
  TradeChartCandleSeriesBasis,
  TradeChartCandleSource,
  TradeChartCoverageStatus,
  TradeChartPriceType,
  TradeChartTimeframe,
  TradeChartWarningCode,
  TradingProduct,
  TradingProvider,
  TradingValuationStatus,
} from "@wavekb/domain/trading-review";

export type { TradingProduct, TradingProvider } from "@wavekb/domain/trading-review";

const TRADING_PROVIDERS: readonly TradingProvider[] = ["binance", "okx", "bybit", "bitget", "exness"];
const TRADING_PRODUCTS: readonly TradingProduct[] = ["usdt_perpetual", "usdt_delivery", "cfd"];

export function isTradingProvider(value: unknown): value is TradingProvider {
  return typeof value === "string" && (TRADING_PROVIDERS as readonly string[]).includes(value);
}

export type ProviderCredentialInput = {
  provider: TradingProvider;
  credentials: Readonly<Record<string, string>>;
  read_only_ack: boolean;
};

export type ValidatedAccount = {
  external_account_id: string;
  account_label: string;
  account_identifier_mask: string;
  account_currency: string;
  products: TradingProduct[];
  read_only_status: "verified" | "user_attested";
};

export type ProviderCapabilities = {
  products: TradingProduct[];
  history_age_days: number;
  history_range_days: number;
  page_size: number;
  pagination: "time" | "page" | "opaque";
  position_grouping: "net_zero_cycle" | "hedge_zero_cycle" | "position_id_cycle";
  has_position_id: boolean;
  has_realized_pnl: boolean;
  has_fee_asset: boolean;
  has_funding_or_swap: boolean;
  has_external_cash_flow: boolean;
  has_usd_valuation: boolean;
  account_currency: string;
  settlement_assets: string[];
  valuation_pairs: string[];
  candles: ProviderCandleCapabilities;
  read_only_status?: "verified" | "user_attested";
};

export const CANDLE_UNAVAILABLE_REASONS = [
  "implementation_pending",
  "provider_unsupported",
  "account_scope_unavailable",
  "upstream_unavailable",
  "rate_limited",
  "legacy_capability_missing",
] as const;

export type CandleUnavailableReason = (typeof CANDLE_UNAVAILABLE_REASONS)[number];

export type ProviderCandleCapabilities =
  | {
    availability: "available";
    timeframes: TradeChartTimeframe[];
    maximum_page_size: number;
    maximum_range_seconds: number;
    price_modes: TradeChartPriceType[];
    unavailable_reason: null;
  }
  | {
    availability: "unavailable";
    timeframes: [];
    maximum_page_size: null;
    maximum_range_seconds: null;
    price_modes: [];
    unavailable_reason: CandleUnavailableReason;
  };

export function unavailableCandleCapabilities(
  reason: CandleUnavailableReason = "implementation_pending",
): ProviderCandleCapabilities {
  return {
    availability: "unavailable",
    timeframes: [],
    maximum_page_size: null,
    maximum_range_seconds: null,
    price_modes: [],
    unavailable_reason: reason,
  };
}

export type ProviderAccount = {
  connection_id: string;
  external_account_id: string;
  account_currency: string;
  credentials: Readonly<Record<string, string>>;
  capabilities: ProviderCapabilities;
};

export type ProviderCursor = {
  kind: "time" | "page" | "opaque";
  value: string | null;
};

export type ProviderHistoryPage = {
  payload: unknown;
  cursor: ProviderCursor;
  fetched_at: string;
};

export type ValuationEvidence = {
  status: TradingValuationStatus;
  rate: string | null;
  source: string | null;
  path: string[];
  quoted_at: string | null;
};

export type CanonicalMoney = {
  amount: string;
  asset: string;
  usd_value: string | null;
};

export type CanonicalAccountSnapshot = {
  provider: TradingProvider;
  connection_id: string;
  captured_at: string;
  account_currency: string;
  equity: string;
  wallet_balance: string;
  unrealized_pnl: string;
  usd_equity: string | null;
  usd_wallet_balance: string | null;
  usd_unrealized_pnl: string | null;
  valuation: ValuationEvidence;
};

export type CanonicalFill = {
  provider: TradingProvider;
  connection_id: string;
  native_fill_id: string;
  native_order_id: string;
  native_position_id: string | null;
  symbol: string;
  native_symbol: string;
  product: TradingProduct;
  side: "buy" | "sell";
  position_side: "both" | "long" | "short";
  action: "open" | "close";
  price: string;
  quantity: string;
  contract_multiplier: string;
  occurred_at: string;
  realized_pnl: CanonicalMoney;
  fee: CanonicalMoney;
  liquidity: "maker" | "taker" | "unknown";
};

export const CANONICAL_CASH_EVENT_TYPES = [
  "deposit",
  "withdrawal",
  "internal_transfer",
  "funding",
  "swap_fee",
  "commission_adjustment",
  "dividend",
  "admin_adjustment",
  "bonus",
  "unknown",
] as const;

export type CanonicalCashEventType = (typeof CANONICAL_CASH_EVENT_TYPES)[number];

export type CanonicalCashEvent = {
  provider: TradingProvider;
  connection_id: string;
  native_event_id: string;
  native_type: string;
  type: CanonicalCashEventType;
  amount: string;
  asset: string;
  usd_value: string | null;
  occurred_at: string;
  symbol: string | null;
  native_position_id: string | null;
};

export type CanonicalHistoryBatch = {
  fills: CanonicalFill[];
  cash_events: CanonicalCashEvent[];
  next_cursor: ProviderCursor | null;
  exhausted: boolean;
  coverage_started_at: string;
  coverage_ended_at: string;
  warnings: string[];
};

export type CandleRequest = {
  product: TradingProduct;
  native_symbol: string;
  normalized_symbol: string;
  timeframe: TradeChartTimeframe;
  price_mode: TradeChartPriceType;
  from: string;
  to: string;
  limit: number;
};

export type CanonicalCandle = {
  provider: TradingProvider;
  product: TradingProduct;
  native_symbol: string;
  normalized_symbol: string;
  timeframe: TradeChartTimeframe;
  series_basis: TradeChartCandleSeriesBasis;
  open_time: string;
  close_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  source: TradeChartCandleSource;
  source_timestamp: string;
  fetched_at: string;
  status: "final" | "partial";
  gap_before: boolean;
  gap_after: boolean;
};

export type CanonicalCandleBatch = {
  provider: TradingProvider;
  request: CandleRequest;
  candles: CanonicalCandle[];
  coverage: {
    status: TradeChartCoverageStatus;
    range_start: string;
    range_end: string;
    source: TradeChartCandleSource | null;
    fetched_at: string | null;
    gaps: Array<{ series_basis: TradeChartCandleSeriesBasis; from: string; to: string }>;
    unavailable_reason: CandleUnavailableReason | null;
  };
  warnings: TradeChartWarningCode[];
};

export interface TradingProviderAdapter {
  readonly provider: TradingProvider;
  validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]>;
  discoverCapabilities(account: ProviderAccount): Promise<ProviderCapabilities>;
  fetchAccountSnapshot(account: ProviderAccount): Promise<CanonicalAccountSnapshot>;
  fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage>;
  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch;
  fetchCandles(account: ProviderAccount, request: CandleRequest): Promise<CanonicalCandleBatch>;
}

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const fillSides = new Set(["buy", "sell"]);
const positionSides = new Set(["both", "long", "short"]);
const fillActions = new Set(["open", "close"]);
const liquidityValues = new Set(["maker", "taker", "unknown"]);
const cashEventTypes = new Set<string>(CANONICAL_CASH_EVENT_TYPES);
const tradingProducts = new Set<string>(TRADING_PRODUCTS);
const candleTimeframes = new Set<string>([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M",
]);
const candlePriceModes = new Set<string>(["trade", "mark", "bid", "ask", "both"]);
const candleSeriesBases = new Set<string>(["trade", "mark", "bid", "ask"]);
const candleSources = new Set<string>(["public_api", "signed_account"]);
const candleStatuses = new Set<string>(["final", "partial"]);
const candleCoverageStatuses = new Set<string>(["complete", "partial", "gapped", "stale", "empty", "unavailable"]);
const candleWarningCodes = new Set<string>([
  "historical_gap", "candles_unavailable", "empty_range", "partial_coverage", "stale_cache", "rate_limited", "provider_limit_reached", "time_limit_reached",
]);
const candleUnavailableReasons = new Set<string>(CANDLE_UNAVAILABLE_REASONS);
const canonicalUnsignedDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const safeSymbolPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

function invalid(field: string): never {
  throw Object.assign(new Error(`canonical_history_invalid_${field}`), { statusCode: 502 });
}

function invalidCandles(field: string): never {
  throw Object.assign(new Error(`canonical_candles_invalid_${field}`), { statusCode: 502 });
}

function invalidCapabilities(field: string): never {
  throw Object.assign(new Error(`provider_capabilities_invalid_${field}`), { statusCode: 502 });
}

function isAllowedString(value: unknown, allowed: ReadonlySet<string>): value is string {
  return typeof value === "string" && allowed.has(value);
}

function capabilityRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCapabilities(field);
  return value as Record<string, unknown>;
}

function exactCapabilityKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key))) invalidCapabilities(field);
}

function capabilityStringArray(value: unknown, field: string, allowed?: ReadonlySet<string>, requireNonEmpty = false): string[] {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0) || value.length > 100) invalidCapabilities(field);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length < 1 || item.length > 100 || (allowed && !allowed.has(item)) || result.includes(item)) {
      invalidCapabilities(field);
    }
    result.push(item);
  }
  return result;
}

export function assertProviderCapabilities(value: unknown): ProviderCapabilities {
  const capabilities = capabilityRecord(value, "record");
  exactCapabilityKeys(capabilities, [
    "products", "history_age_days", "history_range_days", "page_size", "pagination", "position_grouping",
    "has_position_id", "has_realized_pnl", "has_fee_asset", "has_funding_or_swap", "has_external_cash_flow",
    "has_usd_valuation", "account_currency", "settlement_assets", "valuation_pairs", "candles", "read_only_status",
  ], "keys");
  capabilityStringArray(capabilities.products, "products", tradingProducts, true);
  for (const key of ["history_age_days", "history_range_days", "page_size"] as const) {
    const minimum = key === "history_age_days" ? 0 : 1;
    if (!Number.isInteger(capabilities[key]) || (capabilities[key] as number) < minimum) invalidCapabilities(key);
  }
  if (!isAllowedString(capabilities.pagination, new Set(["time", "page", "opaque"]))) invalidCapabilities("pagination");
  if (!isAllowedString(capabilities.position_grouping, new Set(["net_zero_cycle", "hedge_zero_cycle", "position_id_cycle"]))) {
    invalidCapabilities("position_grouping");
  }
  for (const key of [
    "has_position_id", "has_realized_pnl", "has_fee_asset", "has_funding_or_swap", "has_external_cash_flow", "has_usd_valuation",
  ] as const) if (typeof capabilities[key] !== "boolean") invalidCapabilities(key);
  if (typeof capabilities.account_currency !== "string" || !/^[A-Z0-9]{2,12}$/.test(capabilities.account_currency)) {
    invalidCapabilities("account_currency");
  }
  capabilityStringArray(capabilities.settlement_assets, "settlement_assets");
  capabilityStringArray(capabilities.valuation_pairs, "valuation_pairs");
  if (capabilities.read_only_status !== undefined
    && capabilities.read_only_status !== "verified" && capabilities.read_only_status !== "user_attested") {
    invalidCapabilities("read_only_status");
  }

  const candles = capabilityRecord(capabilities.candles, "candles");
  exactCapabilityKeys(candles, [
    "availability", "timeframes", "maximum_page_size", "maximum_range_seconds", "price_modes", "unavailable_reason",
  ], "candles");
  if (candles.availability === "available") {
    capabilityStringArray(candles.timeframes, "candles", candleTimeframes, true);
    capabilityStringArray(candles.price_modes, "candles", candlePriceModes, true);
    if (!Number.isInteger(candles.maximum_page_size) || (candles.maximum_page_size as number) < 1
      || !Number.isInteger(candles.maximum_range_seconds) || (candles.maximum_range_seconds as number) < 1
      || candles.unavailable_reason !== null) invalidCapabilities("candles");
  } else if (candles.availability === "unavailable") {
    if (!Array.isArray(candles.timeframes) || candles.timeframes.length > 0
      || !Array.isArray(candles.price_modes) || candles.price_modes.length > 0
      || candles.maximum_page_size !== null || candles.maximum_range_seconds !== null
      || typeof candles.unavailable_reason !== "string" || !candleUnavailableReasons.has(candles.unavailable_reason)) {
      invalidCapabilities("candles");
    }
  } else {
    invalidCapabilities("candles");
  }
  return value as ProviderCapabilities;
}

export function normalizeProviderCapabilities(
  value: unknown,
  options: { allowLegacyMissingCandles?: boolean } = {},
): ProviderCapabilities {
  const source = capabilityRecord(value, "record");
  const normalized: Record<string, unknown> = { ...source };
  if (!("candles" in normalized) && options.allowLegacyMissingCandles) {
    normalized.candles = unavailableCandleCapabilities("legacy_capability_missing");
  }
  return assertProviderCapabilities(normalized);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key))) invalidCandles(field);
}

function candleRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCandles(field);
  return value as Record<string, unknown>;
}

function candleString(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) invalidCandles(field);
  return value;
}

function candleTimestamp(value: unknown, field: string): string {
  const result = candleString(value, field, 30);
  if (!utcTimestampPattern.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    invalidCandles(field);
  }
  return result;
}

function canonicalUnsignedDecimal(value: unknown, field: string, positive: boolean): string {
  const result = candleString(value, field, 60);
  if (!canonicalUnsignedDecimalPattern.test(result)) invalidCandles(field);
  const [whole = "", fraction = ""] = result.split(".");
  if (whole.length > 20 || fraction.length > 18 || (positive && result === "0")) invalidCandles(field);
  return result;
}

function compareCanonicalUnsignedDecimals(left: string, right: string): number {
  const [leftWhole = "", leftFraction = ""] = left.split(".");
  const [rightWhole = "", rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightValue = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function validateCandleRequest(value: unknown): CandleRequest {
  const request = candleRecord(value, "request");
  exactKeys(request, ["product", "native_symbol", "normalized_symbol", "timeframe", "price_mode", "from", "to", "limit"], "request_keys");
  if (!isAllowedString(request.product, tradingProducts)) invalidCandles("request_product");
  const nativeSymbol = candleString(request.native_symbol, "request_native_symbol", 100);
  if (!safeSymbolPattern.test(nativeSymbol)) invalidCandles("request_native_symbol");
  const normalizedSymbol = candleString(request.normalized_symbol, "request_normalized_symbol", 100);
  if (!safeSymbolPattern.test(normalizedSymbol)) invalidCandles("request_normalized_symbol");
  if (!isAllowedString(request.timeframe, candleTimeframes)) invalidCandles("request_timeframe");
  if (!isAllowedString(request.price_mode, candlePriceModes)) invalidCandles("request_price_mode");
  const from = candleTimestamp(request.from, "request_from");
  const to = candleTimestamp(request.to, "request_to");
  if (Date.parse(from) >= Date.parse(to)) invalidCandles("request_range");
  if (!Number.isInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 3_000) invalidCandles("request_limit");
  return value as CandleRequest;
}

function validateCanonicalCandle(value: unknown, request: CandleRequest, provider: TradingProvider): CanonicalCandle {
  const item = candleRecord(value, "candle");
  exactKeys(item, [
    "provider", "product", "native_symbol", "normalized_symbol", "timeframe", "series_basis", "open_time", "close_time",
    "open", "high", "low", "close", "volume", "source", "source_timestamp", "fetched_at", "status", "gap_before", "gap_after",
  ], "candle_keys");
  if (item.provider !== provider) invalidCandles("provider_consistency");
  if (item.product !== request.product) invalidCandles("product");
  if (item.native_symbol !== request.native_symbol) invalidCandles("native_symbol");
  if (item.normalized_symbol !== request.normalized_symbol) invalidCandles("normalized_symbol");
  if (item.timeframe !== request.timeframe) invalidCandles("timeframe");
  if (!isAllowedString(item.series_basis, candleSeriesBases)) invalidCandles("series_basis");
  if (request.price_mode === "both") {
    if (item.series_basis !== "bid" && item.series_basis !== "ask") invalidCandles("series_basis");
  } else if (item.series_basis !== request.price_mode) invalidCandles("series_basis");
  const openTime = candleTimestamp(item.open_time, "open_time");
  const closeTime = candleTimestamp(item.close_time, "close_time");
  if (Date.parse(openTime) >= Date.parse(closeTime)) invalidCandles("time");
  const open = canonicalUnsignedDecimal(item.open, "open", true);
  const high = canonicalUnsignedDecimal(item.high, "high", true);
  const low = canonicalUnsignedDecimal(item.low, "low", true);
  const close = canonicalUnsignedDecimal(item.close, "close", true);
  if (compareCanonicalUnsignedDecimals(high, open) < 0
    || compareCanonicalUnsignedDecimals(high, close) < 0
    || compareCanonicalUnsignedDecimals(high, low) < 0
    || compareCanonicalUnsignedDecimals(low, open) > 0
    || compareCanonicalUnsignedDecimals(low, close) > 0) invalidCandles("ohlc");
  if (item.volume !== null) canonicalUnsignedDecimal(item.volume, "volume", false);
  if (!isAllowedString(item.source, candleSources)) invalidCandles("source");
  if ((provider === "exness"
    && (item.product !== "cfd" || item.source !== "signed_account"
      || !isAllowedString(item.series_basis, new Set(["bid", "ask"]))
      || !new Set(["bid", "ask", "both"]).has(request.price_mode)))
    || (provider !== "exness"
      && (item.product === "cfd" || item.source !== "public_api"
        || !isAllowedString(item.series_basis, new Set(["trade", "mark"]))
        || !new Set(["trade", "mark"]).has(request.price_mode)))) {
    invalidCandles("source");
  }
  const sourceTimestamp = candleTimestamp(item.source_timestamp, "source_timestamp");
  const fetchedAt = candleTimestamp(item.fetched_at, "fetched_at");
  if (Date.parse(sourceTimestamp) > Date.parse(fetchedAt)) invalidCandles("source_time");
  if (!isAllowedString(item.status, candleStatuses)) invalidCandles("status");
  if (typeof item.gap_before !== "boolean" || typeof item.gap_after !== "boolean") invalidCandles("gap_flags");
  return value as CanonicalCandle;
}

export function unavailableCandleBatch(
  provider: TradingProvider,
  request: CandleRequest,
  reason: CandleUnavailableReason = "implementation_pending",
): CanonicalCandleBatch {
  validateCandleRequest(request);
  return assertCanonicalCandleBatch({
    provider,
    request,
    candles: [],
    coverage: {
      status: "unavailable",
      range_start: request.from,
      range_end: request.to,
      source: null,
      fetched_at: null,
      gaps: [],
      unavailable_reason: reason,
    },
    warnings: ["candles_unavailable"],
  });
}

export function assertCanonicalCandleBatch(value: unknown): CanonicalCandleBatch {
  const batch = candleRecord(value, "batch");
  exactKeys(batch, ["provider", "request", "candles", "coverage", "warnings"], "batch_keys");
  if (!isTradingProvider(batch.provider)) invalidCandles("provider");
  const provider = batch.provider;
  const request = validateCandleRequest(batch.request);
  if ((provider === "exness" && (request.product !== "cfd" || !new Set(["bid", "ask", "both"]).has(request.price_mode)))
    || (provider !== "exness" && (request.product === "cfd" || !new Set(["trade", "mark"]).has(request.price_mode)))) {
    invalidCandles("request_price_mode");
  }
  if (!Array.isArray(batch.candles) || batch.candles.length > request.limit || batch.candles.length > 3_000) invalidCandles("candles");
  const candles = batch.candles.map((item) => validateCanonicalCandle(item, request, provider));
  const basisOrder = new Map<string, number>([["trade", 0], ["mark", 1], ["bid", 2], ["ask", 3]]);
  const leftBoundaryIntersections = new Map<string, number>();
  const rightBoundaryIntersections = new Map<string, number>();
  const requestStart = Date.parse(request.from);
  const requestEnd = Date.parse(request.to);
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const openTime = Date.parse(candle.open_time);
    const closeTime = Date.parse(candle.close_time);
    if (closeTime <= requestStart || openTime >= requestEnd) invalidCandles("range");
    if (openTime < requestStart) {
      const count = (leftBoundaryIntersections.get(candle.series_basis) ?? 0) + 1;
      leftBoundaryIntersections.set(candle.series_basis, count);
      if (count > 1) invalidCandles("range");
    }
    if (closeTime > requestEnd) {
      const count = (rightBoundaryIntersections.get(candle.series_basis) ?? 0) + 1;
      rightBoundaryIntersections.set(candle.series_basis, count);
      if (count > 1) invalidCandles("range");
    }
    if (index > 0) {
      const previous = candles[index - 1]!;
      const timeDifference = Date.parse(candle.open_time) - Date.parse(previous.open_time);
      if (timeDifference < 0 || (timeDifference === 0
        && (basisOrder.get(candle.series_basis) ?? 99) <= (basisOrder.get(previous.series_basis) ?? 99))) invalidCandles("order");
    }
  }

  const coverage = candleRecord(batch.coverage, "coverage");
  exactKeys(coverage, ["status", "range_start", "range_end", "source", "fetched_at", "gaps", "unavailable_reason"], "coverage_keys");
  if (!isAllowedString(coverage.status, candleCoverageStatuses)) invalidCandles("coverage_status");
  const rangeStart = candleTimestamp(coverage.range_start, "coverage_range_start");
  const rangeEnd = candleTimestamp(coverage.range_end, "coverage_range_end");
  if (rangeStart !== request.from || rangeEnd !== request.to) invalidCandles("coverage_range");
  if (coverage.source !== null && !isAllowedString(coverage.source, candleSources)) invalidCandles("coverage_source");
  const coverageFetchedAt = coverage.fetched_at === null ? null : candleTimestamp(coverage.fetched_at, "coverage_fetched_at");
  if (!Array.isArray(coverage.gaps) || coverage.gaps.length > 1_000) invalidCandles("gaps");
  const declaredGaps: Array<{ series_basis: TradeChartCandleSeriesBasis; from: string; to: string }> = [];
  const previousGapEnd = new Map<string, number>();
  for (const value of coverage.gaps) {
    const gap = candleRecord(value, "gap");
    exactKeys(gap, ["series_basis", "from", "to"], "gap_keys");
    if (!isAllowedString(gap.series_basis, candleSeriesBases)) invalidCandles("gaps");
    const gapSeriesBasis = gap.series_basis;
    if (request.price_mode === "both" ? gapSeriesBasis !== "bid" && gapSeriesBasis !== "ask" : gapSeriesBasis !== request.price_mode) {
      invalidCandles("gaps");
    }
    const from = candleTimestamp(gap.from, "gap_from");
    const to = candleTimestamp(gap.to, "gap_to");
    if (Date.parse(from) >= Date.parse(to) || Date.parse(from) < Date.parse(request.from)
      || Date.parse(to) > Date.parse(request.to)
      || Date.parse(from) < (previousGapEnd.get(gapSeriesBasis) ?? 0)) invalidCandles("gaps");
    previousGapEnd.set(gapSeriesBasis, Date.parse(to));
    declaredGaps.push({ series_basis: gapSeriesBasis as TradeChartCandleSeriesBasis, from, to });
  }

  const expectedBases: TradeChartCandleSeriesBasis[] = request.price_mode === "both"
    ? ["bid", "ask"] : [request.price_mode as TradeChartCandleSeriesBasis];
  const actualGaps: Array<{ series_basis: TradeChartCandleSeriesBasis; from: string; to: string }> = [];
  for (const seriesBasis of expectedBases) {
    const series = candles.filter((candle) => candle.series_basis === seriesBasis);
    for (let index = 1; index < series.length; index += 1) {
      if (Date.parse(series[index]!.open_time) < Date.parse(series[index - 1]!.close_time)) invalidCandles("overlap");
    }
    let cursor = requestStart;
    for (let index = 0; index < series.length; index += 1) {
      const candle = series[index]!;
      const intervalStart = Math.max(Date.parse(candle.open_time), requestStart);
      const intervalEnd = Math.min(Date.parse(candle.close_time), requestEnd);
      if (intervalStart < cursor) invalidCandles("overlap");
      const hasGapBefore = intervalStart > cursor && (index > 0 || coverage.status !== "partial");
      if (hasGapBefore) actualGaps.push({ series_basis: seriesBasis, from: new Date(cursor).toISOString(), to: new Date(intervalStart).toISOString() });
      const next = series[index + 1];
      const hasGapAfter = next ? Math.max(Date.parse(next.open_time), requestStart) > intervalEnd
        : coverage.status !== "partial" && requestEnd > intervalEnd;
      if (candle.gap_before !== hasGapBefore || candle.gap_after !== hasGapAfter) invalidCandles("gap_flags");
      cursor = intervalEnd;
    }
    if (series.length === 0) {
      if (candles.length > 0 && coverage.status !== "partial") actualGaps.push({ series_basis: seriesBasis, from: request.from, to: request.to });
    } else if (cursor < requestEnd && coverage.status !== "partial") {
      actualGaps.push({ series_basis: seriesBasis, from: new Date(cursor).toISOString(), to: request.to });
    }
  }

  if (JSON.stringify(declaredGaps) !== JSON.stringify(actualGaps)) invalidCandles("gaps");
  if (candles.length === 0) {
    if (coverage.status === "unavailable") {
      if (coverage.source !== null || coverageFetchedAt !== null || declaredGaps.length > 0
        || typeof coverage.unavailable_reason !== "string" || !candleUnavailableReasons.has(coverage.unavailable_reason)) invalidCandles("unavailable");
    } else if (coverage.status === "empty") {
      const expectedSource = provider === "exness" ? "signed_account" : "public_api";
      if (coverage.source !== expectedSource || coverageFetchedAt === null || declaredGaps.length > 0
        || coverage.unavailable_reason !== null) invalidCandles("empty");
    } else if (coverage.status === "partial") {
      const expectedSource = provider === "exness" ? "signed_account" : "public_api";
      if (coverage.source !== expectedSource || coverageFetchedAt === null || declaredGaps.length > 0
        || coverage.unavailable_reason !== null) invalidCandles("partial");
    } else invalidCandles("empty");
  } else {
    const expectedSource = provider === "exness" ? "signed_account" : "public_api";
    if (coverage.source !== expectedSource) invalidCandles("coverage_source");
    if (coverageFetchedAt === null) invalidCandles("coverage_fetched_at");
    if (candles.some((candle) => candle.source !== coverage.source)) invalidCandles("coverage_source");
    if (candles.some((candle) => candle.fetched_at !== coverageFetchedAt)) invalidCandles("coverage_fetched_at");
    if (coverage.unavailable_reason !== null) invalidCandles("coverage_available");
    if (coverage.status !== "partial" && (actualGaps.length > 0 ? coverage.status !== "gapped"
      : coverage.status === "gapped" || coverage.status === "empty" || coverage.status === "unavailable")) {
      invalidCandles("gaps");
    }
  }
  if (!Array.isArray(batch.warnings) || batch.warnings.length > 50
    || batch.warnings.some((item) => typeof item !== "string" || !candleWarningCodes.has(item))) invalidCandles("warnings");
  const requiredWarning = coverage.status === "gapped" ? "historical_gap"
    : coverage.status === "empty" ? "empty_range"
      : coverage.status === "unavailable" ? "candles_unavailable"
        : coverage.status === "partial" ? "partial_coverage"
          : coverage.status === "stale" ? "stale_cache" : null;
  if (requiredWarning !== null && !batch.warnings.includes(requiredWarning)) invalidCandles("warnings");
  if (declaredGaps.length > 0 && !batch.warnings.includes("historical_gap")) invalidCandles("warnings");
  if ((batch.warnings.includes("provider_limit_reached") || batch.warnings.includes("time_limit_reached"))
    && coverage.status !== "partial") invalidCandles("warnings");
  return value as CanonicalCandleBatch;
}

export type CandleFetchStopReason = "complete" | "provider_limit" | "time_limit";

export function createCandleFetchGuard(limit: number, maximumPageSize: number, startedAt: number, now: () => number) {
  const signal = AbortSignal.timeout(12_000);
  const pageBudget = Math.max(1, Math.ceil(limit / maximumPageSize)) + 1;
  let pages = 0;
  return {
    signal,
    nextPage(): "request" | Exclude<CandleFetchStopReason, "complete"> {
      if (signal.aborted || now() >= startedAt + 12_000) return "time_limit";
      if (pages >= pageBudget) return "provider_limit";
      pages += 1;
      return "request";
    },
  };
}

export function finalizeCanonicalCandleBatch(
  provider: TradingProvider,
  request: CandleRequest,
  candles: CanonicalCandle[],
  fetchedAt: string,
  stopReason: CandleFetchStopReason,
): CanonicalCandleBatch {
  const requestStart = Date.parse(request.from);
  const requestEnd = Date.parse(request.to);
  const partial = stopReason !== "complete";
  const gaps: CanonicalCandleBatch["coverage"]["gaps"] = [];
  const bases = request.price_mode === "both" ? ["bid", "ask"] as const : [request.price_mode as TradeChartCandleSeriesBasis];
  for (const seriesBasis of bases) {
    const series = candles.filter((candle) => candle.series_basis === seriesBasis);
    let cursor = requestStart;
    for (let index = 0; index < series.length; index += 1) {
      const candle = series[index]!;
      const intervalStart = Math.max(Date.parse(candle.open_time), requestStart);
      const intervalEnd = Math.min(Date.parse(candle.close_time), requestEnd);
      const hasGapBefore = intervalStart > cursor && (index > 0 || !partial);
      if (hasGapBefore) gaps.push({ series_basis: seriesBasis, from: new Date(cursor).toISOString(), to: new Date(intervalStart).toISOString() });
      const next = series[index + 1];
      const hasGapAfter = next ? Math.max(Date.parse(next.open_time), requestStart) > intervalEnd : !partial && requestEnd > intervalEnd;
      candle.gap_before = hasGapBefore;
      candle.gap_after = hasGapAfter;
      cursor = intervalEnd;
    }
    if (series.length === 0 && candles.length > 0 && !partial) {
      gaps.push({ series_basis: seriesBasis, from: request.from, to: request.to });
    } else if (series.length > 0 && cursor < requestEnd && !partial) {
      gaps.push({ series_basis: seriesBasis, from: new Date(cursor).toISOString(), to: request.to });
    }
  }
  const warnings: TradeChartWarningCode[] = [];
  if (gaps.length > 0) warnings.push("historical_gap");
  if (partial) {
    warnings.push("partial_coverage");
    warnings.push(stopReason === "time_limit" ? "time_limit_reached" : "provider_limit_reached");
  } else if (candles.length === 0) warnings.push("empty_range");
  return assertCanonicalCandleBatch({
    provider,
    request,
    candles,
    coverage: {
      status: partial ? "partial" : candles.length === 0 ? "empty" : gaps.length > 0 ? "gapped" : "complete",
      range_start: request.from,
      range_end: request.to,
      source: provider === "exness" ? "signed_account" : "public_api",
      fetched_at: fetchedAt,
      gaps,
      unavailable_reason: null,
    },
    warnings,
  });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) invalid(field);
  return value;
}

function decimal(value: unknown, field: string): string {
  const result = string(value, field);
  if (!decimalPattern.test(result)) invalid(field);
  return result;
}

function nullableDecimal(value: unknown, field: string): string | null {
  return value === null ? null : decimal(value, field);
}

function timestamp(value: unknown, field: string): string {
  const result = string(value, field);
  if (!Number.isFinite(Date.parse(result))) invalid(field);
  return result;
}

function money(value: unknown, field: string): void {
  const item = record(value, field);
  decimal(item.amount, `${field}_amount`);
  string(item.asset, `${field}_asset`);
  nullableDecimal(item.usd_value, `${field}_usd_value`);
}

function fill(value: unknown): void {
  const item = record(value, "fill");
  if (!isTradingProvider(item.provider)) invalid("provider");
  string(item.connection_id, "connection_id");
  string(item.native_fill_id, "native_fill_id");
  string(item.native_order_id, "native_order_id");
  if (item.native_position_id !== null) string(item.native_position_id, "native_position_id");
  string(item.symbol, "symbol");
  string(item.native_symbol, "native_symbol");
  if (!isAllowedString(item.product, tradingProducts)) invalid("product");
  if (!isAllowedString(item.side, fillSides)) invalid("side");
  if (!isAllowedString(item.position_side, positionSides)) invalid("position_side");
  if (!isAllowedString(item.action, fillActions)) invalid("action");
  decimal(item.price, "price");
  decimal(item.quantity, "quantity");
  decimal(item.contract_multiplier, "contract_multiplier");
  timestamp(item.occurred_at, "occurred_at");
  money(item.realized_pnl, "realized_pnl");
  money(item.fee, "fee");
  if (!isAllowedString(item.liquidity, liquidityValues)) invalid("liquidity");
}

function cashEvent(value: unknown): void {
  const item = record(value, "cash_event");
  if (!isTradingProvider(item.provider)) invalid("provider");
  string(item.connection_id, "connection_id");
  string(item.native_event_id, "native_event_id");
  string(item.native_type, "native_type", true);
  if (!isAllowedString(item.type, cashEventTypes)) invalid("cash_event_type");
  decimal(item.amount, "cash_event_amount");
  string(item.asset, "cash_event_asset");
  nullableDecimal(item.usd_value, "cash_event_usd_value");
  timestamp(item.occurred_at, "cash_event_occurred_at");
  if (item.symbol !== null) string(item.symbol, "cash_event_symbol");
  if (item.native_position_id !== null) string(item.native_position_id, "cash_event_position_id");
}

export function assertCanonicalHistoryBatch(value: unknown): CanonicalHistoryBatch {
  const batch = record(value, "batch");
  if (!Array.isArray(batch.fills)) invalid("fills");
  if (!Array.isArray(batch.cash_events)) invalid("cash_events");
  for (const item of batch.fills) fill(item);
  for (const item of batch.cash_events) cashEvent(item);
  if (batch.next_cursor !== null) {
    const cursor = record(batch.next_cursor, "cursor");
    if (!isAllowedString(cursor.kind, new Set(["time", "page", "opaque"]))) invalid("cursor_kind");
    if (cursor.value !== null) string(cursor.value, "cursor_value");
  }
  if (typeof batch.exhausted !== "boolean") invalid("exhausted");
  timestamp(batch.coverage_started_at, "coverage_started_at");
  timestamp(batch.coverage_ended_at, "coverage_ended_at");
  if (!Array.isArray(batch.warnings) || batch.warnings.some((item) => typeof item !== "string")) invalid("warnings");
  return value as CanonicalHistoryBatch;
}
