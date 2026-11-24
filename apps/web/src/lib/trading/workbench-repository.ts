import type { ExchangeConnectionView, TradeCycleView, TradePlanCompliance, TradingMetricSummary, TradingRange } from "@wavekb/domain/trading-review";

export type WorkbenchHeadline = { key: string; label: string; value: string };
export type WorkbenchAttribution = { key: string; label: string; trade_count: number; net_pnl_usd: string | null };
export type TradingWorkbenchView = {
  timezone: string;
  range: TradingRange;
  status: { kind: "no_connections" | "empty" | "ready" | "partial" | "error"; messages: string[] };
  connections: ExchangeConnectionView[];
  metrics: TradingMetricSummary;
  headline_metrics: WorkbenchHeadline[];
  series: Array<{ at: string; equity_usd: string | null; cumulative_profit_usd: string | null }>;
  calendar: Array<{ local_date: string; trade_count: number; net_pnl_usd: string | null }>;
  attributions: Record<"provider" | "account" | "symbol" | "direction" | "session", WorkbenchAttribution[]>;
  trades: TradeCycleView[];
};

export type TradingReviewView = {
  cycle_id: string;
  cycle_revision: number;
  reason: string;
  plan_compliance: TradePlanCompliance;
  next_improvement: string;
  tags: string[];
  planned_stop_price: string | null;
  planned_risk_amount: string | null;
  needs_reconciliation: boolean;
};

export type TradingTradeDetail = {
  timezone: string;
  trade: TradeCycleView;
  review: TradingReviewView | null;
  provider_facts: Record<string, string | null>;
  reconciliation: TradingReviewView[];
};

export type SaveTradingReviewInput = {
  expected_cycle_revision: number;
  reason: string;
  plan_compliance: TradePlanCompliance;
  next_improvement: string;
  tags: string[];
  planned_stop_price: string | null;
  planned_risk_amount: string | null;
};

export class TradingRepositoryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

async function json<T>(response: Response, key: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !(key in payload)) throw new TradingRepositoryError(String(payload.error || "trading_request_failed"), response.status);
  return payload[key] as T;
}

export function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"; }
  catch { return "Asia/Shanghai"; }
}

export async function getTradingWorkbench(input: { range: TradingRange; provider?: string; connectionId?: string; timezone: string }) {
  const query = new URLSearchParams({ range: input.range, timezone: input.timezone });
  if (input.provider) query.set("providers", input.provider);
  if (input.connectionId) query.set("connection_ids", input.connectionId);
  return json<TradingWorkbenchView>(await fetch(`/api/trading/workbench?${query}`, { cache: "no-store" }), "workbench");
}

export async function getTradingTrade(id: string, timezone: string) {
  const query = new URLSearchParams({ timezone });
  return json<TradingTradeDetail>(await fetch(`/api/trading/trades/${encodeURIComponent(id)}?${query}`, { cache: "no-store" }), "detail");
}

export async function saveTradingReview(id: string, input: SaveTradingReviewInput) {
  return json<TradingReviewView>(await fetch(`/api/trading/trades/${encodeURIComponent(id)}/review`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }), "review");
}
