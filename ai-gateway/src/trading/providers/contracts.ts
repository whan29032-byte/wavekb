import type {
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
};

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

export interface TradingProviderAdapter {
  readonly provider: TradingProvider;
  validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]>;
  discoverCapabilities(account: ProviderAccount): Promise<ProviderCapabilities>;
  fetchAccountSnapshot(account: ProviderAccount): Promise<CanonicalAccountSnapshot>;
  fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage>;
  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch;
}

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const fillSides = new Set(["buy", "sell"]);
const positionSides = new Set(["both", "long", "short"]);
const fillActions = new Set(["open", "close"]);
const liquidityValues = new Set(["maker", "taker", "unknown"]);
const cashEventTypes = new Set<string>(CANONICAL_CASH_EVENT_TYPES);
const tradingProducts = new Set<string>(TRADING_PRODUCTS);

function invalid(field: string): never {
  throw Object.assign(new Error(`canonical_history_invalid_${field}`), { statusCode: 502 });
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
