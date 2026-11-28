import { createHash, randomBytes, randomUUID } from "node:crypto";
import { validatePost, type BoardSlug } from "@wavekb/domain/community";
import {
  TRADE_CHART_MAX_CANDLES,
  TRADE_CHART_MAX_DRAWINGS,
  TRADE_CHART_MAX_INDICATORS,
  TRADE_CHART_MAX_MARKERS,
  TRADE_CHART_TIMEFRAMES,
} from "@wavekb/domain/trading-review";
import type { DrawingSpecV1, PublicStrategySnapshot, TradeChartPriceType, TradeChartProjection, TradeChartTimeframe } from "@wavekb/domain/trading-review";
import type { GatewayConfig } from "../config.ts";
import type { SupabaseRest } from "../storage/supabase-rest.ts";
import {
  digestPublicStrategyProjection,
  projectPublicStrategy,
  type PublicStrategyChoices,
  type PublicStrategyProjection,
  type PublicStrategyProjectionInput,
} from "./public-chart-projection.ts";
import { calculatePublicStrategyStudies } from "./public-strategy-study-compute.ts";
import { finalizeCanonicalCandleBatch } from "./providers/contracts.ts";
import type { TradingWorkbenchService } from "./workbench-service.ts";

export type ChartShareSource = {
  revision: number;
  fill_digest: string;
  chart_state_version: number;
  source_fingerprint: string;
  opened_at: string;
  closed_at: string | null;
  drawings: DrawingSpecV1[];
  price_type: TradeChartPriceType;
  trade: PublicStrategyProjectionInput["trade"];
};

type PreviewKey = { owner_id: string; cycle_id: string; token_hash: string; idempotency_key: string };
type StoredPreview = { projection_digest: string; projection: PublicStrategyProjection };
type PreviewInsert = PreviewKey & StoredPreview & {
  cycle_revision: number;
  source_fill_digest: string;
  source_fingerprint: string;
  chart_state_version: number;
};
type PublishRow = PreviewKey & {
  projection_digest: string;
  board: BoardSlug;
  title: string;
  body: string;
  supersedes_post_id: string | null;
};
type PublishedStrategy = { post_id: string; snapshot_id: string; replayed: boolean };

export interface ChartSharingStore {
  loadSource(ownerId: string, cycleId: string): Promise<ChartShareSource | null>;
  savePreview(input: PreviewInsert): Promise<string>;
  loadPreview(key: PreviewKey): Promise<StoredPreview | null>;
  publishPreview(input: PublishRow): Promise<PublishedStrategy>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const canonicalUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const minute = 60_000;
const frames: Record<TradeChartTimeframe, number> = {
  "1m": minute, "3m": 3 * minute, "5m": 5 * minute, "15m": 15 * minute, "30m": 30 * minute,
  "1h": 60 * minute, "2h": 120 * minute, "4h": 240 * minute, "6h": 360 * minute, "8h": 480 * minute,
  "12h": 720 * minute, "1d": 1440 * minute, "1w": 10080 * minute, "1M": 40320 * minute,
};
const commonFrames: readonly TradeChartTimeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];
const databaseErrors: Record<string, number> = {
  public_strategy_preview_not_found: 404,
  public_strategy_preview_expired: 410,
  public_strategy_preview_stale: 409,
  public_strategy_preview_consumed: 409,
  public_strategy_publish_forbidden: 403,
  public_strategy_publish_invalid: 400,
};
const previewKeys = ["cycle_revision", "chart_state_version", "timeframe", "from", "to", "show_quantity",
  "show_absolute_pnl", "annotation_fill_ids", "drawing_ids", "indicator_instance_ids"];
const publishKeys = ["preview_token", "idempotency_key", "projection_digest", "board", "title", "body", "supersedes_post_id"];

function failure(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { statusCode });
}

function requestRecord(input: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !keys.includes(key))) failure(code, 400);
  return input as Record<string, unknown>;
}

function date(value: unknown): number {
  if (typeof value !== "string" || !canonicalUtc.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) failure("public_strategy_range_invalid", 400);
  return Date.parse(value);
}

function selection(value: unknown, max: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length
    || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 128)) {
    failure("public_strategy_selection_invalid", 400);
  }
  return value as string[];
}

function chartRange(source: ChartShareSource, input: Record<string, unknown>, drawingIds: readonly string[]) {
  const requested = input.timeframe;
  if (!TRADE_CHART_TIMEFRAMES.includes(requested as TradeChartTimeframe)) failure("public_strategy_range_invalid", 400);
  const fromInput = date(input.from);
  const toInput = date(input.to);
  if (fromInput >= toInput) failure("public_strategy_range_invalid", 400);
  let from = Math.min(fromInput, Date.parse(source.opened_at));
  let to = Math.max(toInput, source.closed_at === null ? toInput : Date.parse(source.closed_at));
  const pendingDrawings = new Set(drawingIds);
  for (const drawing of source.drawings) {
    if (!pendingDrawings.delete(drawing.id)) continue;
    const anchors = drawing.points.map((point) => point.time);
    if (drawing.properties?.stopTime !== undefined) anchors.push(drawing.properties.stopTime);
    for (const time of anchors) {
      from = Math.min(from, Math.floor(time * 1000));
      to = Math.max(to, Math.ceil(time * 1000));
    }
  }
  if (pendingDrawings.size !== 0) failure("public_strategy_selection_invalid", 400);
  if (!Number.isFinite(from) || !Number.isFinite(to)) failure("public_strategy_range_invalid", 400);
  const timeframe = requested as TradeChartTimeframe;
  const seriesCount = source.price_type === "both" ? 2 : 1;
  function fits(candidate: TradeChartTimeframe) {
    return (Math.ceil((to - from) / frames[candidate]) + 2) * seriesCount <= TRADE_CHART_MAX_CANDLES;
  }
  const chosen = fits(timeframe) ? timeframe : commonFrames.find((frame) => frames[frame] > frames[timeframe] && fits(frame));
  if (!chosen) failure("public_strategy_range_too_large", 422);
  return { timeframe: chosen, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

// Private views may show a candle intersecting a range boundary. Share the full
// provider candle and describe any resulting uncovered interval explicitly.
function freezeCandleRange(chart: TradeChartProjection): TradeChartProjection {
  const from = chart.candles.reduce((value, candle) => candle.open_time < value ? candle.open_time : value, chart.range.from);
  const to = chart.candles.reduce((value, candle) => candle.close_time > value ? candle.close_time : value, chart.range.to);
  if (from === chart.range.from && to === chart.range.to) return chart;
  if (!chart.coverage.fetched_at || chart.candles.length === 0) failure("public_strategy_coverage_unavailable", 422);
  const batch = finalizeCanonicalCandleBatch(chart.provider, {
    product: chart.product, native_symbol: chart.native_symbol, normalized_symbol: chart.symbol,
    timeframe: chart.timeframe, price_mode: chart.price_type, from, to, limit: TRADE_CHART_MAX_CANDLES,
  }, chart.candles.map((candle) => ({ ...candle })), chart.coverage.fetched_at,
  chart.coverage.status !== "partial" ? "complete" : chart.warnings.includes("time_limit_reached") ? "time_limit" : "provider_limit");
  const status = chart.coverage.status === "stale" && batch.coverage.status === "complete" ? "stale" : batch.coverage.status;
  return {
    ...chart, range: { from, to }, candles: batch.candles,
    coverage: { ...chart.coverage, status, gaps: batch.coverage.gaps },
    warnings: [...new Set([...chart.warnings, ...batch.warnings])],
  };
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class ChartSharingService {
  private readonly store: ChartSharingStore;
  private readonly workbench: Pick<TradingWorkbenchService, "getChart">;

  constructor(store: ChartSharingStore, workbench: Pick<TradingWorkbenchService, "getChart">) {
    this.store = store;
    this.workbench = workbench;
  }

  async createPreview(ownerId: string, cycleId: string, raw: unknown) {
    if (!uuid.test(cycleId)) failure("public_strategy_source_not_found", 404);
    const input = requestRecord(raw, previewKeys, "public_strategy_selection_invalid");
    const { cycle_revision: revision, chart_state_version: version, show_quantity, show_absolute_pnl } = input;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0
      || typeof version !== "number" || !Number.isSafeInteger(version) || version < 0
      || (show_quantity !== undefined && typeof show_quantity !== "boolean")
      || (show_absolute_pnl !== undefined && typeof show_absolute_pnl !== "boolean")) failure("public_strategy_selection_invalid", 400);
    const annotationIds = selection(input.annotation_fill_ids, TRADE_CHART_MAX_MARKERS);
    const drawingIds = selection(input.drawing_ids, TRADE_CHART_MAX_DRAWINGS);
    const indicatorIds = selection(input.indicator_instance_ids, TRADE_CHART_MAX_INDICATORS);
    const choices: PublicStrategyChoices = {
      show_quantity: show_quantity === true, show_absolute_pnl: show_absolute_pnl === true,
      annotation_fill_ids: annotationIds ?? [], drawing_ids: drawingIds ?? [],
      ...(indicatorIds === undefined ? {} : { indicator_instance_ids: indicatorIds }),
    };
    const source = await this.store.loadSource(ownerId, cycleId);
    if (!source) failure("public_strategy_source_not_found", 404);
    if (revision !== source.revision || version !== source.chart_state_version) failure("public_strategy_preview_stale", 409);
    const fingerprint = source.source_fingerprint;
    const query = chartRange(source, input, drawingIds ?? []);
    const chart = await this.workbench.getChart(ownerId, cycleId, query);
    if (chart.cycle_revision !== revision || (chart.chart_state?.version ?? 0) !== version
      || chart.timeframe !== query.timeframe || chart.price_type !== source.price_type) failure("public_strategy_preview_stale", 409);
    const confirmed = await this.store.loadSource(ownerId, cycleId);
    if (confirmed?.source_fingerprint !== fingerprint) failure("public_strategy_preview_stale", 409);
    const projection = freezeCandleRange(chart);
    if (projection.candles.length === 0 || projection.coverage.source === null) failure("public_strategy_coverage_unavailable", 422);
    const visibleStudies = projection.chart_state?.indicators ?? [];
    const selected = indicatorIds === undefined ? visibleStudies : visibleStudies.filter(({ instanceId }) => indicatorIds.includes(instanceId));
    if (indicatorIds && selected.length !== indicatorIds.length) failure("public_strategy_selection_invalid", 400);
    const computedIndicators = await calculatePublicStrategyStudies(projection, selected);
    const publicChart = projectPublicStrategy({ projection, trade: source.trade, choices, snapshotSeed: randomBytes(32), computedIndicators });
    const previewToken = randomBytes(32).toString("base64url");
    const idempotencyKey = randomUUID();
    const expiresAt = await this.store.savePreview({
      owner_id: ownerId, cycle_id: cycleId, token_hash: tokenHash(previewToken), idempotency_key: idempotencyKey,
      cycle_revision: revision, chart_state_version: version, source_fill_digest: source.fill_digest,
      source_fingerprint: fingerprint, projection_digest: publicChart.digest, projection: publicChart.projection,
    });
    return { preview_token: previewToken, idempotency_key: idempotencyKey, expires_at: expiresAt,
      projection_digest: publicChart.digest, projection: publicChart.projection };
  }

  async publish(ownerId: string, cycleId: string, raw: unknown): Promise<PublishedStrategy> {
    if (!uuid.test(cycleId)) failure("public_strategy_preview_not_found", 404);
    const input = requestRecord(raw, publishKeys, "public_strategy_publish_invalid");
    const { preview_token: token, idempotency_key: idempotencyKey, projection_digest: projectionDigest,
      title, body, board, supersedes_post_id: supersedes } = input;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || typeof idempotencyKey !== "string" || !uuid.test(idempotencyKey)
      || typeof projectionDigest !== "string" || !digest.test(projectionDigest)
      || typeof board !== "string" || typeof title !== "string" || title.length > 240
      || typeof body !== "string" || body.length > 40_000
      || (supersedes !== undefined && (typeof supersedes !== "string" || !uuid.test(supersedes)))) {
      failure("public_strategy_publish_invalid", 400);
    }
    const { ok, value } = validatePost({ board, title, body });
    if (!ok || value.board === null) failure("public_strategy_publish_invalid", 400);
    const key = { owner_id: ownerId, cycle_id: cycleId, token_hash: tokenHash(token), idempotency_key: idempotencyKey };
    const saved = await this.store.loadPreview(key);
    if (!saved) failure("public_strategy_preview_not_found", 404);
    if (saved.projection_digest !== projectionDigest
      || digestPublicStrategyProjection(saved.projection) !== projectionDigest) failure("public_strategy_preview_stale", 409);
    return this.store.publishPreview({
      ...key, projection_digest: projectionDigest, board: value.board, title: value.title, body: value.body, supersedes_post_id: supersedes ?? null,
    });
  }
}

export class SupabaseChartSharingStore implements ChartSharingStore {
  private readonly rest: SupabaseRest;

  constructor(rest: SupabaseRest) {
    this.rest = rest;
  }

  async loadSource(ownerId: string, cycleId: string): Promise<ChartShareSource | null> {
    return this.rest.request("/rest/v1/rpc/load_public_strategy_share_source", {
      method: "POST", body: { p_owner_id: ownerId, p_cycle_id: cycleId },
    });
  }

  async savePreview(input: PreviewInsert): Promise<string> {
    const rows = await this.rest.request("/rest/v1/strategy_share_previews?select=expires_at", {
      method: "POST", headers: { Prefer: "return=representation" }, body: input,
    });
    if (typeof rows?.[0]?.expires_at !== "string" || !Number.isFinite(Date.parse(rows[0].expires_at))) {
      failure("public_strategy_unavailable", 503);
    }
    return rows[0].expires_at;
  }

  async loadPreview(key: PreviewKey): Promise<StoredPreview | null> {
    const query = new URLSearchParams({ select: "projection,projection_digest", limit: "1" });
    for (const [field, value] of Object.entries(key)) query.set(field, `eq.${value}`);
    const rows = await this.rest.request(`/rest/v1/strategy_share_previews?${query}`);
    return Array.isArray(rows) ? rows[0] ?? null : null;
  }

  async publishPreview(input: PublishRow): Promise<PublishedStrategy> {
    try {
      return await this.rest.request("/rest/v1/rpc/publish_public_strategy_preview", {
        method: "POST",
        body: {
          p_owner_id: input.owner_id, p_cycle_id: input.cycle_id, p_token_hash: input.token_hash,
          p_idempotency_key: input.idempotency_key, p_projection_digest: input.projection_digest,
          p_board: input.board, p_title: input.title, p_body: input.body, p_supersedes_post_id: input.supersedes_post_id,
        },
      });
    } catch (error) {
      if (error instanceof Error && Object.hasOwn(databaseErrors, error.message)) {
        failure(error.message, databaseErrors[error.message]!);
      }
      failure("public_strategy_unavailable", 503);
    }
  }
}

export async function readPublicStrategySnapshot(
  config: Pick<GatewayConfig, "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY">,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicStrategySnapshot | null> {
  if (!uuid.test(id)) return null;
  const url = new URL("/rest/v1/public_strategy_snapshots", config.SUPABASE_URL);
  url.search = new URLSearchParams({ id: `eq.${id}`, select: "id,post_id,projection_digest,projection", limit: "1" }).toString();
  try {
    // Anonymous database RLS is the authority for current post visibility.
    const response = await fetcher(url, {
      headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY, accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) failure("public_strategy_unavailable", 503);
    const rows = await response.json();
    if (!Array.isArray(rows)) failure("public_strategy_unavailable", 503);
    if (rows.length === 0) return null;
    const row = rows[0] as PublicStrategySnapshot;
    if (row.id !== id.toLowerCase() || !uuid.test(row.post_id) || !digest.test(row.projection_digest)
      || digestPublicStrategyProjection(row.projection) !== row.projection_digest) failure("public_strategy_unavailable", 503);
    return { id: row.id, post_id: row.post_id, projection_digest: row.projection_digest, projection: row.projection };
  } catch {
    failure("public_strategy_unavailable", 503);
  }
}
