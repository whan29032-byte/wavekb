export const TRADING_PROVIDERS = ["binance", "okx", "bybit", "bitget", "exness"] as const;

export type TradingProvider = (typeof TRADING_PROVIDERS)[number];

export const TRADING_PRODUCTS = ["usdt_perpetual", "usdt_delivery", "cfd"] as const;

export type TradingProduct = (typeof TRADING_PRODUCTS)[number];
export type TradingConnectionStatus = "pending_verification" | "active" | "error" | "disabled" | "deleting";
export type TradingReadOnlyStatus = "verified" | "user_attested" | "unsafe" | "pending";
export type TradingRange = "7d" | "30d" | "90d" | "all";
export type TradePlanCompliance = "unset" | "yes" | "partial" | "no";
export type TradingValuationStatus = "direct" | "approximate" | "triangulated" | "unavailable";

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
