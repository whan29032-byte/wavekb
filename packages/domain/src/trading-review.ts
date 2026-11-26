export const TRADING_PROVIDERS = ["binance", "okx", "bybit", "bitget", "exness"] as const;

export type TradingProvider = (typeof TRADING_PROVIDERS)[number];

export const TRADING_PRODUCTS = ["usdt_perpetual", "usdt_delivery", "cfd"] as const;

export type TradingProduct = (typeof TRADING_PRODUCTS)[number];
export type TradingConnectionStatus = "pending_verification" | "active" | "error" | "disabled" | "deleting";
export type TradingReadOnlyStatus = "verified" | "user_attested" | "unsafe" | "pending";
export type TradingRange = "7d" | "30d" | "90d" | "all";
export type TradePlanCompliance = "unset" | "yes" | "partial" | "no";
export type TradingValuationStatus = "direct" | "approximate" | "triangulated" | "unavailable";

export const TRADE_CHART_STATE_SCHEMA_VERSION = "wavekb-trade-chart-v1" as const;
export const TRADE_CHART_PROJECTION_SCHEMA_VERSION = "wavekb-trade-chart-projection-v1" as const;

export const TRADE_CHART_TIMEFRAMES = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M",
] as const;
export type TradeChartTimeframe = (typeof TRADE_CHART_TIMEFRAMES)[number];

export const TRADE_CHART_PRICE_TYPES = ["trade", "mark", "bid", "ask", "both"] as const;
export type TradeChartPriceType = (typeof TRADE_CHART_PRICE_TYPES)[number];

export const TRADE_CHART_CANDLE_PRICE_BASES = ["trade", "bid", "ask", "both"] as const;
export type TradeChartCandlePriceBasis = (typeof TRADE_CHART_CANDLE_PRICE_BASES)[number];

export const TRADE_CHART_CANDLE_SOURCES = ["public_api", "account_access_point"] as const;
export type TradeChartCandleSource = (typeof TRADE_CHART_CANDLE_SOURCES)[number];

export const TRADE_CHART_COVERAGE_STATUSES = ["complete", "partial", "gapped", "stale", "unavailable"] as const;
export type TradeChartCoverageStatus = (typeof TRADE_CHART_COVERAGE_STATUSES)[number];

export const TRADE_CHART_INDICATOR_IDS = [
  "sma", "ema", "wma", "hma", "vwap", "bollinger", "rsi", "macd", "stochastic", "adx", "atr",
  "supertrend", "ichimoku", "donchian", "keltner-channel", "chandelier-exit", "zigzag",
  "williams-fractals", "pivot-points", "cpr", "obv", "mfi", "chaikin-money-flow",
] as const;
export type TradeChartIndicatorId = (typeof TRADE_CHART_INDICATOR_IDS)[number];

export const TRADE_CHART_BASIC_DRAWING_TOOL_IDS = [
  "trend-line", "ray", "horizontal-line", "vertical-line", "rectangle", "text", "long-position", "short-position",
] as const;
export const TRADE_CHART_FIBONACCI_DRAWING_TOOL_IDS = [
  "fib-retracement", "fib-extension", "fib-time-zone", "fib-fan", "fib-channel",
] as const;
export const TRADE_CHART_ELLIOTT_DRAWING_TOOL_IDS = [
  "elliott-impulse", "elliott-correction", "elliott-triangle", "elliott-double-combo", "elliott-triple-combo",
] as const;
export const TRADE_CHART_DRAWING_TOOL_IDS = [
  ...TRADE_CHART_BASIC_DRAWING_TOOL_IDS,
  ...TRADE_CHART_FIBONACCI_DRAWING_TOOL_IDS,
  ...TRADE_CHART_ELLIOTT_DRAWING_TOOL_IDS,
] as const;
export type TradeChartDrawingToolId = (typeof TRADE_CHART_DRAWING_TOOL_IDS)[number];

export const TRADE_CHART_MAX_CANDLES = 3_000;
export const TRADE_CHART_MAX_MARKERS = 10_000;
export const TRADE_CHART_MAX_INDICATORS = 32;
export const TRADE_CHART_MAX_DRAWINGS = 200;
export const TRADE_CHART_MAX_DRAWING_POINTS = 32;

export type IndicatorSettingV1 = string | number | boolean;

export type IndicatorSpecV1 = {
  instanceId: string;
  indicatorId: TradeChartIndicatorId;
  settings?: Record<string, IndicatorSettingV1>;
  paneIndex?: number;
};

export type DrawingPointV1 = {
  time: number;
  price: number;
};

export type DrawingStyleV1 = {
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

export type DrawingTextV1 = {
  value: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
};

export type DrawingPropertiesV1 = {
  degree?: "grand-supercycle" | "supercycle" | "cycle" | "primary" | "intermediate" | "minor" | "minute" | "minuette" | "subminuette";
  labelStyle?: "degree" | "plain" | "parentheses" | "circled";
  showHeader?: boolean;
  showLossSize?: boolean;
  showTargetLabel?: boolean;
  showStopLabel?: boolean;
  showPrices?: boolean;
  profitColor?: string;
  lossColor?: string;
};

export type DrawingSpecV1 = {
  id: string;
  tool: TradeChartDrawingToolId;
  points: DrawingPointV1[];
  style: DrawingStyleV1;
  text?: DrawingTextV1;
  properties?: DrawingPropertiesV1;
  paneIndex: number;
  locked?: boolean;
  visible?: boolean;
  zIndex: number;
};

export type ChartStateV1 = {
  schema_version: typeof TRADE_CHART_STATE_SCHEMA_VERSION;
  cycle_id: string;
  cycle_revision: number;
  timeframe: TradeChartTimeframe;
  price_type: TradeChartPriceType;
  viewport: { from: number; to: number };
  indicators: IndicatorSpecV1[];
  drawings: DrawingSpecV1[];
  version: number;
  updated_at: string;
};

export type TradeChartCandleV1 = {
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

export type FillMarkerAnnotationV1 = {
  id: string;
  body: string;
  tags: string[];
  image_count: number;
  version: number;
  remap_status: "current" | "remapped" | "needs_confirmation";
};

export type FillMarker = {
  marker_key: string;
  fill_id: string;
  occurred_at: string;
  price: string;
  allocated_quantity: string;
  allocation_role: "open" | "add" | "reduce" | "close" | "reverse_open";
  sort_order: number;
  side: "buy" | "sell";
  position_side: "both" | "long" | "short";
  liquidity: "maker" | "taker" | "unknown";
  provider_fill_id_mask: string;
  annotation: FillMarkerAnnotationV1 | null;
};

export type TradeChartGapV1 = { from: string; to: string };

export type TradeChartProjection = {
  schema_version: typeof TRADE_CHART_PROJECTION_SCHEMA_VERSION;
  cycle_id: string;
  cycle_revision: number;
  provider: TradingProvider;
  product: TradingProduct;
  symbol: string;
  native_symbol: string;
  direction: "long" | "short";
  opened_at: string;
  closed_at: string | null;
  timeframe: TradeChartTimeframe;
  price_type: TradeChartPriceType;
  range: { from: string; to: string };
  candles: TradeChartCandleV1[];
  markers: FillMarker[];
  chart_state: ChartStateV1 | null;
  coverage: {
    status: TradeChartCoverageStatus;
    source: TradeChartCandleSource | null;
    fetched_at: string | null;
    gaps: TradeChartGapV1[];
    unavailable_reason: string | null;
  };
  warnings: string[];
};

export function isTradingProvider(value: unknown): value is TradingProvider {
  return typeof value === "string" && (TRADING_PROVIDERS as readonly string[]).includes(value);
}

export type ExchangeConnectionView = {
  id: string;
  provider: TradingProvider;
  account_label: string;
  account_identifier_mask: string;
  account_currency: string;
  products: TradingProduct[];
  read_only_status: TradingReadOnlyStatus;
  status: TradingConnectionStatus;
  public_enabled: boolean;
  history_coverage_started_at: string | null;
  equity_tracking_started_at: string | null;
  last_synced_at: string | null;
  last_error_code: string;
  consecutive_failures: number;
};

export type TradingWorkbenchFilter = {
  range: TradingRange;
  providers: TradingProvider[];
  connection_ids: string[];
  timezone: string;
};

export type TradingMetricSummary = {
  current_equity_usd: string | null;
  cumulative_profit_usd: string | null;
  time_weighted_return: string | null;
  maximum_drawdown: string | null;
  realized_net_pnl_usd: string | null;
  win_rate: string | null;
  average_win_loss_ratio: string | null;
  profit_factor: string | null;
  closed_trade_count: number;
  included_connection_count: number;
  excluded_connection_count: number;
  is_complete: boolean;
  incomplete_reasons: string[];
};

export type TradeCycleView = {
  id: string;
  revision: number;
  provider: TradingProvider;
  connection_id: string;
  account_label: string;
  account_currency: string;
  product: TradingProduct;
  symbol: string;
  native_position_id: string | null;
  direction: "long" | "short";
  opened_at: string;
  closed_at: string | null;
  entry_price: string;
  exit_price: string | null;
  quantity: string;
  realized_pnl: string;
  fees: string;
  funding_or_swap: string;
  dividends: string;
  net_pnl: string;
  usd_net_pnl: string | null;
  valuation_status: TradingValuationStatus;
  completeness: "complete" | "open" | "incomplete_opening_history" | "incomplete_valuation";
  review_status: "none" | "saved" | "needs_reconciliation";
  ai_status: "none" | "current" | "stale";
};

export type TradeReviewInput = {
  reason: string;
  plan_compliance: TradePlanCompliance;
  next_improvement: string;
  tags: string[];
  planned_stop_price: string | null;
  planned_risk_amount: string | null;
  expected_cycle_revision: number;
};
