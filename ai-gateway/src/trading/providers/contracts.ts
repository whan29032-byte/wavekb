import type {
  TradeChartCandlePriceBasis,
  TradeChartCandleSource,
  TradeChartCoverageStatus,
  TradeChartTimeframe,
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
};

export const CANDLE_UNAVAILABLE_REASONS = [
  "implementation_pending",
  "provider_unsupported",
  "account_scope_unavailable",
  "upstream_unavailable",
  "rate_limited",
] as const;

export type CandleUnavailableReason = (typeof CANDLE_UNAVAILABLE_REASONS)[number];

export type ProviderCandleCapabilities = {
  availability: "available" | "unavailable";
  timeframes: TradeChartTimeframe[];
  maximum_page_size: number | null;
  maximum_range_seconds: number | null;
  price_bases: TradeChartCandlePriceBasis[];
  unavailable_reason: CandleUnavailableReason | null;
};

export function unavailableCandleCapabilities(
  reason: CandleUnavailableReason = "implementation_pending",
): ProviderCandleCapabilities {
  return {
    availability: "unavailable",
    timeframes: [],
    maximum_page_size: null,
    maximum_range_seconds: null,
    price_bases: [],
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
  price_basis: TradeChartCandlePriceBasis;
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
  price_basis: TradeChartCandlePriceBasis;
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
  request: CandleRequest;
  candles: CanonicalCandle[];
  coverage: {
    status: TradeChartCoverageStatus;
    range_start: string;
    range_end: string;
    gaps: Array<{ from: string; to: string }>;
    unavailable_reason: CandleUnavailableReason | null;
  };
  warnings: string[];
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
const candlePriceBases = new Set<string>(["trade", "bid", "ask", "both"]);
const candleSources = new Set<string>(["public_api", "account_access_point"]);
const candleStatuses = new Set<string>(["final", "partial"]);
const candleCoverageStatuses = new Set<string>(["complete", "partial", "gapped", "stale", "unavailable"]);
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
  if (whole.length + fraction.length > 38 || fraction.length > 18 || (positive && result === "0")) invalidCandles(field);
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
  exactKeys(request, ["product", "native_symbol", "normalized_symbol", "timeframe", "price_basis", "from", "to", "limit"], "request_keys");
  if (!tradingProducts.has(String(request.product))) invalidCandles("request_product");
  const nativeSymbol = candleString(request.native_symbol, "request_native_symbol", 100);
  if (!safeSymbolPattern.test(nativeSymbol)) invalidCandles("request_native_symbol");
  candleString(request.normalized_symbol, "request_normalized_symbol", 100);
  if (!candleTimeframes.has(String(request.timeframe))) invalidCandles("request_timeframe");
  if (!candlePriceBases.has(String(request.price_basis))) invalidCandles("request_price_basis");
  const from = candleTimestamp(request.from, "request_from");
  const to = candleTimestamp(request.to, "request_to");
  if (Date.parse(from) >= Date.parse(to)) invalidCandles("request_range");
  if (!Number.isInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 3_000) invalidCandles("request_limit");
  return value as CandleRequest;
}

function validateCanonicalCandle(value: unknown, request: CandleRequest): CanonicalCandle {
  const item = candleRecord(value, "candle");
  exactKeys(item, [
    "provider", "product", "native_symbol", "normalized_symbol", "timeframe", "price_basis", "open_time", "close_time",
    "open", "high", "low", "close", "volume", "source", "source_timestamp", "fetched_at", "status", "gap_before", "gap_after",
  ], "candle_keys");
  if (!isTradingProvider(item.provider)) invalidCandles("provider");
  if (item.product !== request.product) invalidCandles("product");
  if (item.native_symbol !== request.native_symbol) invalidCandles("native_symbol");
  if (item.normalized_symbol !== request.normalized_symbol) invalidCandles("normalized_symbol");
  if (item.timeframe !== request.timeframe) invalidCandles("timeframe");
  if (item.price_basis !== request.price_basis) invalidCandles("price_basis");
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
  if (!candleSources.has(String(item.source))) invalidCandles("source");
  if ((item.provider === "exness"
    && (item.product !== "cfd" || item.source !== "account_access_point"
      || !new Set(["bid", "ask", "both"]).has(String(item.price_basis))))
    || (item.provider !== "exness"
      && (item.product === "cfd" || item.source !== "public_api" || item.price_basis !== "trade"))) {
    invalidCandles("source");
  }
  const sourceTimestamp = candleTimestamp(item.source_timestamp, "source_timestamp");
  const fetchedAt = candleTimestamp(item.fetched_at, "fetched_at");
  if (Date.parse(sourceTimestamp) > Date.parse(fetchedAt)) invalidCandles("source_time");
  if (!candleStatuses.has(String(item.status))) invalidCandles("status");
  if (typeof item.gap_before !== "boolean" || typeof item.gap_after !== "boolean") invalidCandles("gap_flags");
  return value as CanonicalCandle;
}

export function unavailableCandleBatch(
  request: CandleRequest,
  reason: CandleUnavailableReason = "implementation_pending",
): CanonicalCandleBatch {
  validateCandleRequest(request);
  return {
    request,
    candles: [],
    coverage: {
      status: "unavailable",
      range_start: request.from,
      range_end: request.to,
      gaps: [],
      unavailable_reason: reason,
    },
    warnings: ["candles_unavailable"],
  };
}

export function assertCanonicalCandleBatch(value: unknown): CanonicalCandleBatch {
  const batch = candleRecord(value, "batch");
  exactKeys(batch, ["request", "candles", "coverage", "warnings"], "batch_keys");
  const request = validateCandleRequest(batch.request);
  if (!Array.isArray(batch.candles) || batch.candles.length > request.limit || batch.candles.length > 3_000) invalidCandles("candles");
  const candles = batch.candles.map((item) => validateCanonicalCandle(item, request));
  const batchProvider = candles[0]?.provider;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    if (candle.provider !== batchProvider) invalidCandles("provider_consistency");
    if (Date.parse(candle.open_time) < Date.parse(request.from) || Date.parse(candle.close_time) > Date.parse(request.to)) {
      invalidCandles("range");
    }
    if (index > 0 && Date.parse(candles[index - 1]!.open_time) >= Date.parse(candle.open_time)) invalidCandles("order");
  }

  const coverage = candleRecord(batch.coverage, "coverage");
  exactKeys(coverage, ["status", "range_start", "range_end", "gaps", "unavailable_reason"], "coverage_keys");
  if (!candleCoverageStatuses.has(String(coverage.status))) invalidCandles("coverage_status");
  const rangeStart = candleTimestamp(coverage.range_start, "coverage_range_start");
  const rangeEnd = candleTimestamp(coverage.range_end, "coverage_range_end");
  if (rangeStart !== request.from || rangeEnd !== request.to) invalidCandles("coverage_range");
  if (!Array.isArray(coverage.gaps) || coverage.gaps.length > 1_000) invalidCandles("gaps");
  let previousGapEnd = 0;
  for (const value of coverage.gaps) {
    const gap = candleRecord(value, "gap");
    exactKeys(gap, ["from", "to"], "gap_keys");
    const from = candleTimestamp(gap.from, "gap_from");
    const to = candleTimestamp(gap.to, "gap_to");
    if (Date.parse(from) >= Date.parse(to) || Date.parse(from) < Date.parse(request.from)
      || Date.parse(to) > Date.parse(request.to) || Date.parse(from) < previousGapEnd) invalidCandles("gaps");
    previousGapEnd = Date.parse(to);
  }
  const hasGapFlags = candles.some((item) => item.gap_before || item.gap_after);
  if (coverage.status === "gapped") {
    if (coverage.gaps.length === 0 || !hasGapFlags || coverage.unavailable_reason !== null) invalidCandles("gaps");
  } else if (coverage.status === "unavailable") {
    if (candles.length > 0 || coverage.gaps.length > 0 || typeof coverage.unavailable_reason !== "string"
      || !candleUnavailableReasons.has(coverage.unavailable_reason)) invalidCandles("unavailable");
  } else if (coverage.gaps.length > 0 || hasGapFlags || coverage.unavailable_reason !== null) {
    invalidCandles("gaps");
  }
  if (!Array.isArray(batch.warnings) || batch.warnings.length > 50
    || batch.warnings.some((item) => typeof item !== "string" || item.length > 200)) invalidCandles("warnings");
  return value as CanonicalCandleBatch;
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
  if (!tradingProducts.has(String(item.product))) invalid("product");
  if (!fillSides.has(String(item.side))) invalid("side");
  if (!positionSides.has(String(item.position_side))) invalid("position_side");
  if (!fillActions.has(String(item.action))) invalid("action");
  decimal(item.price, "price");
  decimal(item.quantity, "quantity");
  decimal(item.contract_multiplier, "contract_multiplier");
  timestamp(item.occurred_at, "occurred_at");
  money(item.realized_pnl, "realized_pnl");
  money(item.fee, "fee");
  if (!liquidityValues.has(String(item.liquidity))) invalid("liquidity");
}

function cashEvent(value: unknown): void {
  const item = record(value, "cash_event");
  if (!isTradingProvider(item.provider)) invalid("provider");
  string(item.connection_id, "connection_id");
  string(item.native_event_id, "native_event_id");
  string(item.native_type, "native_type", true);
  if (!cashEventTypes.has(String(item.type))) invalid("cash_event_type");
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
    if (!new Set(["time", "page", "opaque"]).has(String(cursor.kind))) invalid("cursor_kind");
    if (cursor.value !== null) string(cursor.value, "cursor_value");
  }
  if (typeof batch.exhausted !== "boolean") invalid("exhausted");
  timestamp(batch.coverage_started_at, "coverage_started_at");
  timestamp(batch.coverage_ended_at, "coverage_ended_at");
  if (!Array.isArray(batch.warnings) || batch.warnings.some((item) => typeof item !== "string")) invalid("warnings");
  return value as CanonicalHistoryBatch;
}
