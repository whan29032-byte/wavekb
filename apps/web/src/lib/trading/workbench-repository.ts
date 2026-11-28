import type { BoardSlug } from "@wavekb/domain/community";
import type {
  ChartStateV1,
  ExchangeConnectionView,
  FillMarkerAnnotationV1,
  PublicStrategyChoices,
  PublicStrategyProjection,
  PublicStrategySnapshot,
  TradeChartProjection,
  TradeChartTimeframe,
  TradeCycleView,
  TradePlanCompliance,
  TradingMetricSummary,
  TradingRange,
} from "@wavekb/domain/trading-review";
import { isPublicStrategyProjection, isPublicStrategySnapshot } from "./public-strategy-contract";

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

export type GetTradeChartInput = {
  timeframe: TradeChartTimeframe;
  from: string;
  to: string;
};

export type PreviewPublicStrategyInput = GetTradeChartInput & PublicStrategyChoices & {
  cycle_revision: number;
  chart_state_version: number;
};

export type PublicStrategyPreview = {
  preview_token: string;
  idempotency_key: string;
  expires_at: string;
  projection_digest: string;
  projection: PublicStrategyProjection;
};

export type PublishPublicStrategyInput = Pick<PublicStrategyPreview, "preview_token" | "idempotency_key" | "projection_digest"> & {
  board: BoardSlug;
  title: string;
  body: string;
  supersedes_post_id?: string;
};

export type PublicStrategyPublication = { post_id: string; snapshot_id: string; replayed: boolean };

export type SaveTradeChartStateInput = Pick<ChartStateV1,
  "cycle_revision" | "schema_version" | "timeframe" | "price_type" | "viewport" | "indicators" | "drawings"
> & {
  expected_version: number;
  expected_updated_at: string | null;
};

export type SaveTradeFillAnnotationImageInput = {
  id: string;
  storage_path: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
};

export type SaveTradeFillAnnotationInput = {
  annotation_id: string;
  cycle_revision: number;
  body: string;
  tags: string[];
  images: SaveTradeFillAnnotationImageInput[];
  expected_version: number;
  deleted: boolean;
};

export type TradeReviewAiCitation = {
  knowledge_id: string;
  book_title: string;
  title: string;
  href: string;
  pages: number[];
  snippet: string;
};

export type TradeReviewAiOutput = {
  fact_summary: string[];
  discipline_observations: Array<{ observation: string; basis: "user_statement" | "model_inference" }>;
  wave_structure_hypothesis: { status: "unknown"; summary: string; evidence_limit: string };
  citations: TradeReviewAiCitation[];
  next_checklist: string[];
};

export type TradeReviewAiJob = {
  id: string;
  status: "queued" | "waiting_retry" | "running" | "succeeded" | "failed" | "cancelled";
  stale?: boolean;
  output_payload?: TradeReviewAiOutput | null;
  error_code?: string | null;
};

export class TradingRepositoryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

export type StrategyShareErrorReason = "stale_preview" | "expired_preview" | "consumed_preview" | "privacy_validation"
  | "gateway_unavailable" | "rate_limited" | "request_failed";

const previewErrorReasons: Readonly<Record<string, StrategyShareErrorReason | undefined>> = {
  public_strategy_preview_stale: "stale_preview",
  public_strategy_preview_expired: "expired_preview",
  public_strategy_preview_consumed: "consumed_preview",
  rate_limited: "rate_limited",
};

export class StrategyShareRepositoryError extends TradingRepositoryError {
  readonly reason: StrategyShareErrorReason;

  constructor(code: string, status: number) {
    super(code, status);
    const knownReason = Object.hasOwn(previewErrorReasons, code) ? previewErrorReasons[code] : undefined;
    if (knownReason) this.reason = knownReason;
    else if (status >= 500) this.reason = "gateway_unavailable";
    else if (code.startsWith("public_strategy_") && (status === 400 || status === 413 || status === 422)) this.reason = "privacy_validation";
    else this.reason = "request_failed";
  }
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

export async function getTradeChart(id: string, input: GetTradeChartInput) {
  const query = new URLSearchParams({
    timeframe: input.timeframe,
    from: input.from,
    to: input.to,
  });
  return json<TradeChartProjection>(await fetch(
    `/api/trading/trades/${encodeURIComponent(id)}/chart?${query}`,
    { cache: "no-store" },
  ), "chart");
}

async function submitStrategyShare<T extends object>(
  id: string,
  action: "share-preview" | "share-publish",
  input: PreviewPublicStrategyInput | PublishPublicStrategyInput,
  validate: (body: Record<string, unknown>) => boolean,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/trading/trades/${encodeURIComponent(id)}/${action}`, {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
  } catch {
    throw new StrategyShareRepositoryError("trading_gateway_unavailable", 503);
  }
  const body: unknown = await response.json().catch(() => null);
  const failure = "trading_request_failed";
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new StrategyShareRepositoryError(failure, response.ok ? 502 : response.status);
  }
  const payload = body as Record<string, unknown>;
  if (!response.ok) throw new StrategyShareRepositoryError(typeof payload.error === "string" ? payload.error : failure, response.status);
  if (!validate(payload)) throw new StrategyShareRepositoryError(failure, 502);
  return payload as T;
}

export async function previewPublicStrategy(id: string, input: PreviewPublicStrategyInput) {
  return submitStrategyShare<PublicStrategyPreview>(id, "share-preview", input, (payload) => (
    typeof payload.preview_token === "string" && typeof payload.idempotency_key === "string"
    && typeof payload.expires_at === "string" && typeof payload.projection_digest === "string"
    && isPublicStrategyProjection(payload.projection)
  ));
}

export async function getPublicStrategySnapshot(id: string): Promise<PublicStrategySnapshot | null> {
  const response = await fetch(`/api/public-strategies/${encodeURIComponent(id)}`, { credentials: "omit", cache: "no-cache" });
  if (response.status === 404) return null;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isPublicStrategySnapshot(payload) || id.toLowerCase() !== payload.id.toLowerCase()) {
    throw new TradingRepositoryError("strategy_snapshot_unavailable", response.ok ? 502 : response.status);
  }
  return payload;
}

export async function publishPublicStrategy(id: string, input: PublishPublicStrategyInput) {
  return submitStrategyShare<PublicStrategyPublication>(id, "share-publish", input, (payload) => (
    typeof payload.post_id === "string" && typeof payload.snapshot_id === "string" && typeof payload.replayed === "boolean"
  ));
}

export async function saveTradeChartState(id: string, input: SaveTradeChartStateInput) {
  return json<ChartStateV1>(await fetch(`/api/trading/trades/${encodeURIComponent(id)}/chart-state`, {
    method: "PUT",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }), "chart_state");
}

export async function saveTradeFillAnnotation(id: string, fillId: string, input: SaveTradeFillAnnotationInput) {
  return json<FillMarkerAnnotationV1>(await fetch(
    `/api/trading/trades/${encodeURIComponent(id)}/fills/${encodeURIComponent(fillId)}/annotation`,
    {
      method: "PUT",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  ), "annotation");
}

export async function saveTradingReview(id: string, input: SaveTradingReviewInput) {
  return json<TradingReviewView>(await fetch(`/api/trading/trades/${encodeURIComponent(id)}/review`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }), "review");
}

export async function submitTradeReviewAi(
  id: string,
  cycleRevision: number,
  knowledgeScope: "all" | { book_ids: string[] },
) {
  const clientRequestId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(16).padStart(8, "0").slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`;
  return json<TradeReviewAiJob>(await fetch(`/api/trading/trades/${encodeURIComponent(id)}/ai-review`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      request_version: 1,
      client_request_id: clientRequestId,
      task_type: "trade_review",
      cycle_revision: cycleRevision,
      knowledge_scope: knowledgeScope,
    }),
  }), "job");
}

export async function getTradeReviewAiJob(jobId: string) {
  return json<TradeReviewAiJob>(await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" }), "job");
}
