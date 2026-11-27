import type {
  ChartStateV1,
  ExchangeConnectionView,
  FillMarker,
  TradeChartPriceType,
  TradeChartProjection,
  TradeChartTimeframe,
  TradeCycleView,
  TradePlanCompliance,
  TradingMetricSummary,
  TradingProduct,
  TradingProvider,
  TradingRange,
  TradingValuationStatus,
} from "@wavekb/domain/trading-review";
import {
  TRADE_CHART_MAX_CANDLES,
  TRADE_CHART_PROJECTION_SCHEMA_VERSION,
  TRADE_CHART_TIMEFRAMES,
} from "@wavekb/domain/trading-review";
import type { GatewayConfig } from "../config.ts";
import { decryptSecret, type EncryptedSecret } from "../secrets/crypto.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { buildPortfolioSeries, calculateTradingMetrics, type PortfolioPoint } from "./accounting.ts";
import { assertChartStateV1, assertTradeChartProjection } from "./chart-contracts.ts";
import { configuredTradingProviders } from "./provider-flags.ts";
import { BinanceTradingProviderAdapter } from "./providers/binance.ts";
import { BitgetTradingProviderAdapter } from "./providers/bitget.ts";
import { BybitTradingProviderAdapter } from "./providers/bybit.ts";
import {
  assertCanonicalCandleBatch,
  unavailableCandleBatch,
  type CandleRequest,
  type CanonicalAccountSnapshot,
  type CanonicalCashEvent,
  type CanonicalCandleBatch,
  type TradingProviderAdapter,
} from "./providers/contracts.ts";
import { ExnessTradingProviderAdapter } from "./providers/exness.ts";
import { OkxTradingProviderAdapter } from "./providers/okx.ts";
import { createTradingProviderRegistry } from "./providers/registry.ts";
import {
  hashExternalTradingAccount,
  SupabaseTradingSyncStore,
  type SyncConnectionRecord,
  type TradingSyncStore,
} from "./sync-service.ts";

const DAY_MS = 86_400_000;
const FALLBACK_TIMEZONE = "Asia/Shanghai";
const RANGES: TradingRange[] = ["7d", "30d", "90d", "all"];
const PROVIDERS: TradingProvider[] = ["binance", "okx", "bybit", "bitget", "exness"];

export type WorkbenchConnectionRecord = ExchangeConnectionView & {
  owner_id: string;
  sync_generation: number;
};

export type WorkbenchSnapshotRecord = CanonicalAccountSnapshot & { generation: number };
export type WorkbenchCashEventRecord = CanonicalCashEvent & { generation: number };
export type WorkbenchCycleRecord = Omit<TradeCycleView, "account_label" | "review_status" | "ai_status"> & {
  generation: number;
  is_current: boolean;
};

export type WorkbenchReviewRecord = {
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

export type WorkbenchFacts = {
  snapshots: WorkbenchSnapshotRecord[];
  cash_events: WorkbenchCashEventRecord[];
  cycles: WorkbenchCycleRecord[];
  reviews: WorkbenchReviewRecord[];
};

export type WorkbenchTradeBundle = {
  cycle: WorkbenchCycleRecord;
  connection: WorkbenchConnectionRecord;
  review: WorkbenchReviewRecord | null;
  conflicting_reviews: WorkbenchReviewRecord[];
};

export type WorkbenchChartAllocationRecord = {
  cycle_revision: number;
  fill_id: string;
  native_fill_id: string;
  allocation_quantity: string;
  allocation_role: FillMarker["allocation_role"];
  sort_order: number;
};

export type WorkbenchChartFillRecord = {
  id: string;
  native_fill_id: string;
  native_symbol: string;
  occurred_at: string;
  price: string;
  side: FillMarker["side"];
  position_side: FillMarker["position_side"];
  liquidity: FillMarker["liquidity"];
};

export type WorkbenchChartAnnotationRecord = {
  id: string;
  fill_id: string;
  native_fill_id: string;
  cycle_revision: number;
  body: string;
  tags: string[];
  remap_status: NonNullable<FillMarker["annotation"]>["remap_status"];
  remapped_from_revision: number | null;
  version: number;
  deleted_at: string | null;
};

export type WorkbenchChartImageRecord = {
  id: string;
  annotation_id: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
  sort_order: number;
  deleted_at: string | null;
};

export type WorkbenchChartCycleRecord = Pick<
  WorkbenchCycleRecord,
  "id" | "connection_id" | "provider" | "revision" | "product" | "symbol"
  | "direction" | "opened_at" | "closed_at" | "generation" | "is_current"
>;

export type WorkbenchChartConnectionRecord = Pick<
  WorkbenchConnectionRecord,
  "id" | "owner_id" | "provider" | "sync_generation"
>;

export type WorkbenchChartFacts = {
  cycle: WorkbenchChartCycleRecord;
  connection: WorkbenchChartConnectionRecord;
  allocations: WorkbenchChartAllocationRecord[];
  fills: WorkbenchChartFillRecord[];
  annotations: WorkbenchChartAnnotationRecord[];
  images: WorkbenchChartImageRecord[];
  chart_state: ChartStateV1 | null;
};

export type WorkbenchChartStateSave = {
  cycle_id: string;
  cycle_revision: number;
  schema_version: ChartStateV1["schema_version"];
  timeframe: ChartStateV1["timeframe"];
  price_type: ChartStateV1["price_type"];
  viewport: ChartStateV1["viewport"];
  indicators: ChartStateV1["indicators"];
  drawings: ChartStateV1["drawings"];
  expected_version: number;
  expected_updated_at: string | null;
};

export type WorkbenchFillAnnotationSave = {
  annotation_id: string;
  cycle_id: string;
  fill_id: string;
  cycle_revision: number;
  body: string;
  tags: string[];
  images: Array<{ id: string; storage_path: string; mime_type: "image/jpeg" | "image/png" | "image/webp"; byte_size: number }>;
  expected_version: number;
  deleted: boolean;
};

export interface TradingWorkbenchCandleLoader {
  fetch(input: {
    owner_id: string;
    connection_id: string;
    provider: TradingProvider;
    request: CandleRequest;
  }): Promise<CanonicalCandleBatch>;
}

export class SupabaseTradingWorkbenchCandleLoader implements TradingWorkbenchCandleLoader {
  private readonly store: Pick<TradingSyncStore, "getConnection" | "loadCredentialEnvelope">;
  private readonly adapters: ReadonlyMap<TradingProvider, TradingProviderAdapter>;
  private readonly masterKey: Buffer;
  private readonly identityKey: Buffer;
  private readonly decrypt: (encrypted: EncryptedSecret, key: Buffer) => string;

  constructor(input: {
    store: Pick<TradingSyncStore, "getConnection" | "loadCredentialEnvelope">;
    adapters: ReadonlyMap<TradingProvider, TradingProviderAdapter>;
    masterKey: Buffer;
    identityKey: Buffer;
    decrypt?: (encrypted: EncryptedSecret, key: Buffer) => string;
  }) {
    this.store = input.store;
    this.adapters = input.adapters;
    this.masterKey = input.masterKey;
    this.identityKey = input.identityKey;
    this.decrypt = input.decrypt ?? decryptSecret;
  }

  async fetch(input: {
    owner_id: string;
    connection_id: string;
    provider: TradingProvider;
    request: CandleRequest;
  }): Promise<CanonicalCandleBatch> {
    const connection: SyncConnectionRecord | null = await this.store.getConnection(input.connection_id);
    if (!connection || connection.owner_id !== input.owner_id || connection.provider !== input.provider) {
      throw chartError("trade_cycle_not_found", 404);
    }
    const adapter = this.adapters.get(connection.provider);
    if (!adapter) throw chartError("trading_candles_unavailable", 503);
    let parsed: unknown;
    try {
      const envelope = await this.store.loadCredentialEnvelope(connection.owner_id, connection.credential_set_id);
      parsed = JSON.parse(this.decrypt(envelope, this.masterKey));
    } catch {
      throw chartError("exchange_secret_invalid", 500);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.values(parsed).some((value) => typeof value !== "string")) {
      throw chartError("exchange_secret_invalid", 500);
    }
    const credentials = parsed as Record<string, string>;
    const accounts = await adapter.validateCredentials({ provider: connection.provider, credentials, read_only_ack: true });
    const matches = accounts.filter((account) => connection.external_account_id_hash === null
      ? accounts.length === 1
      : hashExternalTradingAccount(this.identityKey, connection.provider, account.external_account_id) === connection.external_account_id_hash);
    if (matches.length !== 1) throw chartError("exchange_account_unavailable", 409);
    const account = matches[0]!;
    return adapter.fetchCandles({
      connection_id: connection.id,
      external_account_id: account.external_account_id,
      account_currency: connection.account_currency,
      credentials,
      capabilities: connection.capabilities,
    }, input.request);
  }
}

export interface TradingWorkbenchStore {
  listConnections(ownerId: string): Promise<WorkbenchConnectionRecord[]>;
  loadFacts(ownerId: string, connectionIds: string[], from: string, to: string): Promise<WorkbenchFacts>;
  getTrade(ownerId: string, cycleId: string): Promise<WorkbenchTradeBundle | null>;
  loadChartFacts(ownerId: string, cycleId: string): Promise<WorkbenchChartFacts | null>;
  saveChartState(accessToken: string, input: WorkbenchChartStateSave): Promise<ChartStateV1>;
  saveFillAnnotation(accessToken: string, input: WorkbenchFillAnnotationSave): Promise<WorkbenchChartAnnotationRecord>;
  saveReview(input: WorkbenchReviewRecord & { owner_id: string }): Promise<WorkbenchReviewRecord>;
}

export type TradingWorkbenchDashboard = {
  timezone: string;
  range: TradingRange;
  status: { kind: "no_connections" | "empty" | "ready" | "partial" | "error"; messages: string[] };
  connections: ExchangeConnectionView[];
  metrics: TradingMetricSummary;
  headline_metrics: Array<{ key: string; label: string; value: string }>;
  series: Array<Pick<PortfolioPoint, "at" | "equity_usd" | "cumulative_profit_usd">>;
  calendar: Array<{ local_date: string; trade_count: number; net_pnl_usd: string | null }>;
  attributions: Record<"provider" | "account" | "symbol" | "direction" | "session", Array<{ key: string; label: string; trade_count: number; net_pnl_usd: string | null }>>;
  trades: TradeCycleView[];
};

type DashboardInput = { range?: unknown; providers?: unknown; connection_ids?: unknown; timezone?: unknown };

function safeTimezone(value: unknown): string {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : FALLBACK_TIMEZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0); return candidate; }
  catch { return FALLBACK_TIMEZONE; }
}

function commaList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function asRange(value: unknown): TradingRange {
  return typeof value === "string" && RANGES.includes(value as TradingRange) ? value as TradingRange : "30d";
}

function localParts(timestamp: string, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((item) => [item.type, item.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour ?? 0) };
}

function addDecimal(left: string, right: string): string {
  const scale = Math.max((left.split(".")[1] ?? "").length, (right.split(".")[1] ?? "").length);
  const factor = 10n ** BigInt(scale);
  const parse = (value: string) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const result = BigInt(whole || "0") * factor + BigInt(fraction.padEnd(scale, "0") || "0");
    return negative ? -result : result;
  };
  const total = parse(left) + parse(right);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

function money(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number) : "—";
}

function percent(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 }).format(number) : "—";
}

function headline(metrics: TradingMetricSummary) {
  return [
    { key: "equity", label: "当前权益", value: money(metrics.current_equity_usd) },
    { key: "profit", label: "累计净盈利", value: money(metrics.cumulative_profit_usd) },
    { key: "return", label: "收益率", value: percent(metrics.time_weighted_return) },
    { key: "drawdown", label: "最大回撤", value: percent(metrics.maximum_drawdown) },
    { key: "realized", label: "已实现净盈利", value: money(metrics.realized_net_pnl_usd) },
    { key: "win_rate", label: "胜率", value: percent(metrics.win_rate) },
  ];
}

function publicConnection(connection: WorkbenchConnectionRecord): ExchangeConnectionView {
  const { owner_id: _owner, sync_generation: _generation, ...view } = connection;
  return view;
}

function tradeView(cycle: WorkbenchCycleRecord, connection: WorkbenchConnectionRecord, review: WorkbenchReviewRecord | undefined): TradeCycleView {
  const { generation: _generation, is_current: _current, ...facts } = cycle;
  return {
    ...facts,
    account_label: connection.account_label,
    review_status: review?.needs_reconciliation ? "needs_reconciliation" : review ? "saved" : "none",
    ai_status: "none",
  };
}

function attribution(cycles: WorkbenchCycleRecord[], keyOf: (cycle: WorkbenchCycleRecord) => [string, string]) {
  const groups = new Map<string, { label: string; trade_count: number; net_pnl_usd: string | null }>();
  for (const cycle of cycles) {
    const [key, label] = keyOf(cycle);
    const current = groups.get(key) ?? { label, trade_count: 0, net_pnl_usd: "0" };
    current.trade_count += 1;
    current.net_pnl_usd = current.net_pnl_usd === null || cycle.usd_net_pnl === null ? null : addDecimal(current.net_pnl_usd, cycle.usd_net_pnl);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.trade_count - a.trade_count || a.key.localeCompare(b.key));
}

function emptyMetrics(): TradingMetricSummary {
  return { current_equity_usd: null, cumulative_profit_usd: null, time_weighted_return: null, maximum_drawdown: null, realized_net_pnl_usd: null, win_rate: null, average_win_loss_ratio: null, profit_factor: null, closed_trade_count: 0, included_connection_count: 0, excluded_connection_count: 0, is_complete: true, incomplete_reasons: [] };
}

const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const positiveDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function chartError(code: string, statusCode: number) {
  return Object.assign(new Error(code), { statusCode });
}

function chartTimestamp(value: unknown): string {
  if (typeof value !== "string" || !utcTimestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    throw chartError("invalid_trade_chart_query", 400);
  }
  return value;
}

function exactChartKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key))) {
    throw chartError("invalid_trade_chart_request", 400);
  }
}

function chartRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw chartError("invalid_trade_chart_request", 400);
  return value as Record<string, unknown>;
}

function chartPlainText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw chartError("invalid_trade_chart_request", 400);
  const compact = value.toLowerCase().replaceAll(" ", "");
  if (value.includes("<") || value.includes(">") || compact.includes("javascript:")
    || compact.includes("data:text/html") || compact.includes("expression(") || compact.includes("url(")) {
    throw chartError("invalid_trade_chart_request", 400);
  }
  return value;
}

function chartQuery(input: Record<string, unknown>): { timeframe: TradeChartTimeframe; from: string; to: string } {
  const keys = Object.keys(input);
  if (keys.some((key) => !["timeframe", "from", "to"].includes(key))
    || typeof input.timeframe !== "string"
    || !(TRADE_CHART_TIMEFRAMES as readonly string[]).includes(input.timeframe)) {
    throw chartError("invalid_trade_chart_query", 400);
  }
  const from = chartTimestamp(input.from);
  const to = chartTimestamp(input.to);
  if (Date.parse(from) >= Date.parse(to)) throw chartError("invalid_trade_chart_query", 400);
  return { timeframe: input.timeframe as TradeChartTimeframe, from, to };
}

function providerFillMask(nativeFillId: string): string {
  const suffix = nativeFillId.slice(-4);
  if (!/^[A-Za-z0-9]{4}$/.test(suffix)) throw chartError("trade_chart_facts_invalid", 500);
  return `••••${suffix}`;
}

function sameCandleRequest(left: CandleRequest, right: CandleRequest): boolean {
  return left.product === right.product
    && left.native_symbol === right.native_symbol
    && left.normalized_symbol === right.normalized_symbol
    && left.timeframe === right.timeframe
    && left.price_mode === right.price_mode
    && left.from === right.from
    && left.to === right.to
    && left.limit === right.limit;
}

export class TradingWorkbenchService {
  private readonly store: TradingWorkbenchStore;
  private readonly now: () => number;
  private readonly candleLoader: TradingWorkbenchCandleLoader | null;
  constructor(input: { store: TradingWorkbenchStore; candleLoader?: TradingWorkbenchCandleLoader; now?: () => number }) {
    this.store = input.store;
    this.candleLoader = input.candleLoader ?? null;
    this.now = input.now ?? Date.now;
  }

  async getDashboard(ownerId: string, input: DashboardInput): Promise<TradingWorkbenchDashboard> {
    const timezone = safeTimezone(input.timezone);
    const range = asRange(input.range);
    const providerFilter = commaList(input.providers).filter((item): item is TradingProvider => PROVIDERS.includes(item as TradingProvider));
    const accountFilter = new Set(commaList(input.connection_ids));
    const allConnections = await this.store.listConnections(ownerId);
    const connections = allConnections.filter((connection) =>
      connection.status !== "deleting"
      && (providerFilter.length === 0 || providerFilter.includes(connection.provider))
      && (accountFilter.size === 0 || accountFilter.has(connection.id)),
    );
    const now = this.now();
    const earliest = connections.map((item) => item.history_coverage_started_at ?? item.equity_tracking_started_at).filter((item): item is string => Boolean(item)).map(Date.parse).filter(Number.isFinite);
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const fromMs = range === "all" && earliest.length ? Math.min(...earliest) : now - days * DAY_MS;
    if (connections.length === 0) {
      const metrics = emptyMetrics();
      return { timezone, range, status: { kind: allConnections.length ? "empty" : "no_connections", messages: [] }, connections: [], metrics, headline_metrics: headline(metrics), series: [], calendar: [], attributions: { provider: [], account: [], symbol: [], direction: [], session: [] }, trades: [] };
    }

    const facts = await this.store.loadFacts(ownerId, connections.map((item) => item.id), new Date(fromMs).toISOString(), new Date(now).toISOString());
    const generations = new Map(connections.map((item) => [item.id, item.sync_generation]));
    const published = <T extends { connection_id: string; generation: number }>(rows: T[]) => rows.filter((row) => generations.get(row.connection_id) === row.generation);
    const snapshots = published(facts.snapshots).filter((item) => Date.parse(item.captured_at) <= now);
    const events = published(facts.cash_events).filter((item) => Date.parse(item.occurred_at) >= fromMs && Date.parse(item.occurred_at) <= now);
    const cycles = published(facts.cycles).filter((item) => item.is_current && Date.parse(item.closed_at ?? item.opened_at) >= fromMs && Date.parse(item.opened_at) <= now);
    const series = buildPortfolioSeries(snapshots, events, { connection_ids: connections.map((item) => item.id), from: new Date(fromMs).toISOString(), to: new Date(now).toISOString(), timezone });
    const metrics = calculateTradingMetrics(cycles, series);
    const reviews = new Map(facts.reviews.map((item) => [item.cycle_id, item]));
    const byId = new Map(connections.map((item) => [item.id, item]));
    const trades = [...cycles].sort((a, b) => Date.parse(b.closed_at ?? b.opened_at) - Date.parse(a.closed_at ?? a.opened_at)).map((cycle) => tradeView(cycle, byId.get(cycle.connection_id)!, reviews.get(cycle.id)));

    const calendarMap = new Map<string, { trade_count: number; net_pnl_usd: string | null }>();
    for (const cycle of cycles) {
      const date = localParts(cycle.closed_at ?? cycle.opened_at, timezone).date;
      const current = calendarMap.get(date) ?? { trade_count: 0, net_pnl_usd: "0" };
      current.trade_count += 1;
      current.net_pnl_usd = current.net_pnl_usd === null || cycle.usd_net_pnl === null ? null : addDecimal(current.net_pnl_usd, cycle.usd_net_pnl);
      calendarMap.set(date, current);
    }
    const calendar = [...calendarMap.entries()].map(([local_date, value]) => ({ local_date, ...value })).sort((a, b) => a.local_date.localeCompare(b.local_date));
    const messages: string[] = [];
    if (connections.some((item) => item.history_coverage_started_at && Date.parse(item.history_coverage_started_at) > fromMs)) messages.push("部分账户的交易历史晚于所选范围起点");
    if (!metrics.is_complete) messages.push("部分账户缺少完整的美元估值或权益快照");
    if (connections.some((item) => item.status === "error" || item.last_error_code)) messages.push("部分账户最近同步失败，当前显示上一次完整数据");
    const providerLabels: Record<TradingProvider, string> = { binance: "Binance", okx: "OKX", bybit: "Bybit", bitget: "Bitget", exness: "Exness" };
    const stride = Math.max(1, Math.ceil(series.points.length / 360));
    const chartPoints = series.points.filter((_point, index) => index % stride === 0 || index === series.points.length - 1);
    return {
      timezone, range,
      status: { kind: messages.length ? "partial" : cycles.length || snapshots.length ? "ready" : "empty", messages },
      connections: connections.map(publicConnection), metrics, headline_metrics: headline(metrics),
      series: chartPoints.map(({ at, equity_usd, cumulative_profit_usd }) => ({ at, equity_usd, cumulative_profit_usd })), calendar,
      attributions: {
        provider: attribution(cycles, (cycle) => [cycle.provider, providerLabels[cycle.provider]]),
        account: attribution(cycles, (cycle) => [cycle.connection_id, byId.get(cycle.connection_id)?.account_label ?? cycle.connection_id]),
        symbol: attribution(cycles, (cycle) => [cycle.symbol, cycle.symbol]),
        direction: attribution(cycles, (cycle) => [cycle.direction, cycle.direction === "long" ? "多头" : "空头"]),
        session: attribution(cycles, (cycle) => { const hour = localParts(cycle.opened_at, timezone).hour; const key = hour < 8 ? "00-08" : hour < 16 ? "08-16" : "16-24"; return [key, `${key} 时`]; }),
      },
      trades,
    };
  }

  async getTrade(ownerId: string, cycleId: string, timezoneInput: unknown) {
    const timezone = safeTimezone(timezoneInput);
    const bundle = await this.store.getTrade(ownerId, cycleId);
    if (!bundle || !bundle.cycle.is_current || bundle.cycle.generation !== bundle.connection.sync_generation) throw Object.assign(new Error("trade_cycle_not_found"), { statusCode: 404 });
    const trade = tradeView(bundle.cycle, bundle.connection, bundle.review ?? undefined);
    const provider_facts = bundle.cycle.provider === "exness"
      ? { lot_quantity: bundle.cycle.quantity, position_id: bundle.cycle.native_position_id, swap: bundle.cycle.funding_or_swap, account_currency: bundle.cycle.account_currency }
      : { contract_quantity: bundle.cycle.quantity, funding: bundle.cycle.funding_or_swap, settlement_currency: bundle.cycle.account_currency };
    return { timezone, trade, review: bundle.review, provider_facts, reconciliation: bundle.conflicting_reviews };
  }

  async getChart(ownerId: string, cycleId: string, raw: Record<string, unknown>): Promise<TradeChartProjection> {
    const query = chartQuery(raw);
    const facts = await this.store.loadChartFacts(ownerId, cycleId);
    if (!facts
      || facts.connection.owner_id !== ownerId
      || facts.cycle.id !== cycleId
      || facts.cycle.connection_id !== facts.connection.id
      || !facts.cycle.is_current
      || facts.cycle.generation !== facts.connection.sync_generation) {
      throw chartError("trade_cycle_not_found", 404);
    }
    if (Date.parse(query.from) > Date.parse(facts.cycle.opened_at)
      || (facts.cycle.closed_at !== null && Date.parse(query.to) < Date.parse(facts.cycle.closed_at))) {
      throw chartError("invalid_trade_chart_query", 400);
    }

    const allocations = [...facts.allocations].sort((left, right) => left.sort_order - right.sort_order);
    const fills = new Map(facts.fills.map((fill) => [fill.id, fill]));
    if (facts.annotations.some((annotation) => annotation.cycle_revision > facts.cycle.revision)) {
      throw chartError("trade_chart_facts_invalid", 500);
    }
    const annotations = new Map(facts.annotations
      .filter((annotation) => annotation.deleted_at === null)
      .map((annotation) => [`${annotation.fill_id}\u0000${annotation.native_fill_id}`, annotation]));
    const imageCounts = new Map<string, number>();
    for (const image of facts.images) {
      if (image.deleted_at !== null) continue;
      imageCounts.set(image.annotation_id, (imageCounts.get(image.annotation_id) ?? 0) + 1);
    }
    const markers: FillMarker[] = allocations.map((allocation, index) => {
      const fill = fills.get(allocation.fill_id);
      if (!fill
        || allocation.cycle_revision !== facts.cycle.revision
        || allocation.sort_order !== index
        || allocation.native_fill_id !== fill.native_fill_id
        || !positiveDecimalPattern.test(allocation.allocation_quantity)) {
        throw chartError("trade_chart_facts_invalid", 500);
      }
      const annotation = annotations.get(`${fill.id}\u0000${fill.native_fill_id}`);
      return {
        marker_key: `${cycleId}:${fill.id}`,
        fill_id: fill.id,
        occurred_at: fill.occurred_at,
        price: fill.price,
        allocated_quantity: allocation.allocation_quantity,
        allocation_role: allocation.allocation_role,
        sort_order: allocation.sort_order,
        side: fill.side,
        position_side: fill.position_side,
        liquidity: fill.liquidity,
        provider_fill_id_mask: providerFillMask(fill.native_fill_id),
        annotation: annotation ? {
          id: annotation.id,
          body: annotation.body,
          tags: annotation.tags,
          image_count: imageCounts.get(annotation.id) ?? 0,
          version: annotation.version,
          remap_status: annotation.cycle_revision < facts.cycle.revision
            ? "remapped"
            : annotation.remap_status,
        } : null,
      };
    });
    if (markers.length !== facts.fills.length || markers.length === 0) throw chartError("trade_chart_facts_invalid", 500);

    const firstFill = facts.fills[0]!;
    if (facts.fills.some((fill) => fill.native_symbol !== firstFill.native_symbol)) throw chartError("trade_chart_facts_invalid", 500);
    const requestedState = facts.chart_state;
    const defaultPriceType: TradeChartPriceType = facts.cycle.provider === "exness" ? "both" : "trade";
    const priceType = requestedState?.cycle_revision === facts.cycle.revision && requestedState.timeframe === query.timeframe
      ? requestedState.price_type
      : defaultPriceType;
    const request: CandleRequest = {
      product: facts.cycle.product,
      native_symbol: firstFill.native_symbol,
      normalized_symbol: facts.cycle.symbol,
      timeframe: query.timeframe,
      price_mode: priceType,
      from: query.from,
      to: query.to,
      limit: TRADE_CHART_MAX_CANDLES,
    };
    let batch = unavailableCandleBatch(facts.cycle.provider, request, "upstream_unavailable");
    if (this.candleLoader) {
      try {
        batch = assertCanonicalCandleBatch(await this.candleLoader.fetch({
          owner_id: ownerId,
          connection_id: facts.connection.id,
          provider: facts.cycle.provider,
          request,
        }));
        if (batch.provider !== facts.cycle.provider || !sameCandleRequest(batch.request, request)) {
          throw chartError("trade_chart_candles_invalid", 502);
        }
      } catch {
        batch = unavailableCandleBatch(facts.cycle.provider, request, "upstream_unavailable");
      }
    }
    const projection: TradeChartProjection = {
      schema_version: TRADE_CHART_PROJECTION_SCHEMA_VERSION,
      cycle_id: facts.cycle.id,
      cycle_revision: facts.cycle.revision,
      provider: facts.cycle.provider,
      product: facts.cycle.product,
      symbol: facts.cycle.symbol,
      native_symbol: firstFill.native_symbol,
      direction: facts.cycle.direction,
      opened_at: facts.cycle.opened_at,
      closed_at: facts.cycle.closed_at,
      timeframe: query.timeframe,
      price_type: priceType,
      range: { from: query.from, to: query.to },
      candles: batch.candles,
      markers,
      chart_state: requestedState?.cycle_revision === facts.cycle.revision
        && requestedState.timeframe === query.timeframe && requestedState.price_type === priceType ? requestedState : null,
      coverage: {
        status: batch.coverage.status,
        source: batch.coverage.source,
        fetched_at: batch.coverage.fetched_at,
        gaps: batch.coverage.gaps,
        unavailable_reason: batch.coverage.unavailable_reason,
      },
      warnings: batch.warnings,
    };
    return assertTradeChartProjection(projection);
  }

  async saveChartState(ownerId: string, cycleId: string, rawInput: unknown, accessToken: string): Promise<ChartStateV1> {
    const raw = chartRecord(rawInput);
    exactChartKeys(raw, ["cycle_revision", "schema_version", "timeframe", "price_type", "viewport", "indicators", "drawings", "expected_version", "expected_updated_at"]);
    const expectedVersion = raw.expected_version;
    const expectedUpdatedAt = raw.expected_updated_at;
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0
      || ((expectedVersion as number) === 0 ? expectedUpdatedAt !== null : typeof expectedUpdatedAt !== "string")
      || (typeof expectedUpdatedAt === "string" && chartTimestamp(expectedUpdatedAt) !== expectedUpdatedAt)
      || typeof accessToken !== "string" || accessToken.length === 0) {
      throw chartError("invalid_trade_chart_request", 400);
    }
    const candidate = assertChartStateV1({
      schema_version: raw.schema_version,
      cycle_id: cycleId,
      cycle_revision: raw.cycle_revision,
      timeframe: raw.timeframe,
      price_type: raw.price_type,
      viewport: raw.viewport,
      indicators: raw.indicators,
      drawings: raw.drawings,
      version: Math.max(1, expectedVersion as number),
      updated_at: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : "1970-01-01T00:00:00.000Z",
    });
    const facts = await this.store.loadChartFacts(ownerId, cycleId);
    if (!facts || facts.connection.owner_id !== ownerId || !facts.cycle.is_current
      || facts.cycle.generation !== facts.connection.sync_generation || candidate.cycle_revision !== facts.cycle.revision) {
      throw chartError("trade_cycle_not_found", 404);
    }
    if ((facts.cycle.provider === "exness" && !["bid", "ask", "both"].includes(candidate.price_type))
      || (facts.cycle.provider !== "exness" && !["trade", "mark"].includes(candidate.price_type))) {
      throw chartError("trade_chart_invalid_state_price_type", 400);
    }
    return assertChartStateV1(await this.store.saveChartState(accessToken, {
      cycle_id: cycleId,
      cycle_revision: candidate.cycle_revision,
      schema_version: candidate.schema_version,
      timeframe: candidate.timeframe,
      price_type: candidate.price_type,
      viewport: candidate.viewport,
      indicators: candidate.indicators,
      drawings: candidate.drawings,
      expected_version: expectedVersion as number,
      expected_updated_at: expectedUpdatedAt as string | null,
    }));
  }

  async saveFillAnnotation(ownerId: string, cycleId: string, fillId: string, rawInput: unknown, accessToken: string) {
    const raw = chartRecord(rawInput);
    exactChartKeys(raw, ["annotation_id", "cycle_revision", "body", "tags", "images", "expected_version", "deleted"]);
    if (typeof raw.annotation_id !== "string" || !uuidPattern.test(raw.annotation_id)
      || typeof fillId !== "string" || !/^[1-9]\d{0,29}$/.test(fillId)
      || !Number.isInteger(raw.cycle_revision) || (raw.cycle_revision as number) < 1
      || !Number.isInteger(raw.expected_version) || (raw.expected_version as number) < 0
      || typeof raw.deleted !== "boolean" || typeof accessToken !== "string" || accessToken.length === 0
      || !Array.isArray(raw.tags) || raw.tags.length > 10 || !Array.isArray(raw.images) || raw.images.length > 5) {
      throw chartError("invalid_trade_chart_request", 400);
    }
    const body = chartPlainText(raw.body, 5_000);
    const tags: string[] = [];
    for (const value of raw.tags) {
      if (typeof value !== "string" || value.length < 1 || value.length > 40 || value !== value.trim().toLowerCase() || tags.includes(value)) {
        throw chartError("invalid_trade_chart_request", 400);
      }
      tags.push(value);
    }
    const images = raw.images.map((value) => {
      const image = chartRecord(value);
      exactChartKeys(image, ["id", "storage_path", "mime_type", "byte_size"]);
      if (typeof image.id !== "string" || !uuidPattern.test(image.id)
        || typeof image.storage_path !== "string"
        || typeof image.mime_type !== "string"
        || !["image/jpeg", "image/png", "image/webp"].includes(image.mime_type)
        || !Number.isInteger(image.byte_size) || (image.byte_size as number) < 1 || (image.byte_size as number) > 2_097_152) {
        throw chartError("invalid_trade_chart_request", 400);
      }
      const extension = image.mime_type === "image/jpeg" ? ".jpg" : image.mime_type === "image/png" ? ".png" : ".webp";
      if (image.storage_path !== `${ownerId}/${raw.annotation_id}/${image.id}${extension}`) throw chartError("invalid_trade_chart_request", 400);
      return { id: image.id, storage_path: image.storage_path, mime_type: image.mime_type, byte_size: image.byte_size } as WorkbenchFillAnnotationSave["images"][number];
    });
    if (new Set(images.map((image) => image.id)).size !== images.length
      || new Set(images.map((image) => image.storage_path)).size !== images.length) throw chartError("invalid_trade_chart_request", 400);

    const facts = await this.store.loadChartFacts(ownerId, cycleId);
    if (!facts || facts.connection.owner_id !== ownerId || !facts.cycle.is_current
      || facts.cycle.generation !== facts.connection.sync_generation || raw.cycle_revision !== facts.cycle.revision) {
      throw chartError("trade_cycle_not_found", 404);
    }
    const allocation = facts.allocations.find((item) => item.fill_id === fillId && item.cycle_revision === facts.cycle.revision);
    const fill = facts.fills.find((item) => item.id === fillId);
    if (!allocation || !fill || allocation.native_fill_id !== fill.native_fill_id) throw chartError("trade_chart_fill_not_owned", 404);
    const saved = await this.store.saveFillAnnotation(accessToken, {
      annotation_id: raw.annotation_id,
      cycle_id: cycleId,
      fill_id: fillId,
      cycle_revision: raw.cycle_revision as number,
      body,
      tags,
      images,
      expected_version: raw.expected_version as number,
      deleted: raw.deleted,
    });
    return {
      id: saved.id,
      body: saved.body,
      tags: saved.tags,
      image_count: raw.deleted ? 0 : images.length,
      version: saved.version,
      remap_status: saved.remap_status,
    } satisfies NonNullable<FillMarker["annotation"]>;
  }

  async saveReview(ownerId: string, cycleId: string, raw: Record<string, unknown>) {
    const detail = await this.getTrade(ownerId, cycleId, FALLBACK_TIMEZONE);
    const expected = Number(raw.expected_cycle_revision);
    const compliance = String(raw.plan_compliance ?? "unset") as TradePlanCompliance;
    const reason = String(raw.reason ?? "").trim();
    const next = String(raw.next_improvement ?? "").trim();
    const tags = Array.isArray(raw.tags) ? raw.tags.map(String).map((item) => item.trim()).filter(Boolean) : [];
    const decimalOrNull = (value: unknown) => value === null || value === undefined || String(value).trim() === "" ? null : /^-?\d+(?:\.\d+)?$/.test(String(value)) ? String(value) : "invalid";
    const stop = decimalOrNull(raw.planned_stop_price);
    const risk = decimalOrNull(raw.planned_risk_amount);
    if (expected !== detail.trade.revision) throw Object.assign(new Error("stale_trade_cycle_revision"), { statusCode: 409 });
    if (!["unset", "yes", "partial", "no"].includes(compliance) || reason.length > 5000 || next.length > 5000 || tags.length > 20 || stop === "invalid" || risk === "invalid") throw Object.assign(new Error("invalid_trade_review"), { statusCode: 400 });
    return this.store.saveReview({ owner_id: ownerId, cycle_id: cycleId, cycle_revision: expected, reason, plan_compliance: compliance, next_improvement: next, tags, planned_stop_price: stop, planned_risk_amount: risk, needs_reconciliation: false });
  }
}

function inList(values: string[]) { return `in.(${values.map((value) => `"${value.replace(/["\\]/g, "")}"`).join(",")})`; }

function mapConnection(row: any): WorkbenchConnectionRecord {
  const capabilities = row.capabilities && typeof row.capabilities === "object" ? row.capabilities : {};
  return {
    id: String(row.id), owner_id: String(row.owner_id), provider: row.provider as TradingProvider,
    account_label: String(row.account_label), account_identifier_mask: String(row.account_identifier_mask), account_currency: String(row.account_currency),
    products: Array.isArray(capabilities.products) ? capabilities.products as TradingProduct[] : [],
    read_only_status: capabilities.read_only_status === "verified" ? "verified" : "user_attested",
    status: row.status, public_enabled: row.public_enabled === true,
    history_coverage_started_at: row.history_coverage_started_at ?? null, equity_tracking_started_at: row.equity_tracking_started_at ?? null,
    last_synced_at: row.last_synced_at ?? null, last_error_code: String(row.last_error_code ?? ""), consecutive_failures: Number(row.consecutive_failures ?? 0), sync_generation: Number(row.sync_generation ?? 0),
  };
}

function mapCycle(row: any): WorkbenchCycleRecord {
  return {
    ...row,
    revision: Number(row.revision), generation: Number(row.generation), is_current: row.is_current === true,
    entry_price: String(row.entry_price), exit_price: row.exit_price === null ? null : String(row.exit_price), quantity: String(row.quantity),
    realized_pnl: String(row.realized_pnl), fees: String(row.fees), funding_or_swap: String(row.funding_or_swap), dividends: String(row.dividends), net_pnl: String(row.net_pnl),
    usd_net_pnl: row.usd_net_pnl === null ? null : String(row.usd_net_pnl),
  } as WorkbenchCycleRecord;
}

function mapChartCycle(row: any): WorkbenchChartCycleRecord {
  return {
    id: String(row.id),
    connection_id: String(row.connection_id),
    provider: row.provider,
    revision: Number(row.revision),
    product: row.product,
    symbol: String(row.symbol),
    direction: row.direction,
    opened_at: String(row.opened_at),
    closed_at: row.closed_at === null ? null : String(row.closed_at),
    generation: Number(row.generation),
    is_current: row.is_current === true,
  };
}

function mapChartConnection(row: any): WorkbenchChartConnectionRecord {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    provider: row.provider,
    sync_generation: Number(row.sync_generation),
  };
}

function mapReview(row: any): WorkbenchReviewRecord {
  return {
    cycle_id: String(row.cycle_id), cycle_revision: Number(row.cycle_revision), reason: String(row.reason ?? ""),
    plan_compliance: row.plan_compliance, next_improvement: String(row.next_improvement ?? ""),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    planned_stop_price: row.planned_stop_price == null ? null : String(row.planned_stop_price),
    planned_risk_amount: row.planned_risk_amount == null ? null : String(row.planned_risk_amount),
    needs_reconciliation: row.needs_reconciliation === true,
  };
}

export class SupabaseTradingWorkbenchStore implements TradingWorkbenchStore {
  private readonly rest: SupabaseRest;
  constructor(rest: SupabaseRest) { this.rest = rest; }
  private async all(path: string) {
    const rows: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 100_000; offset += pageSize) {
      const page = await this.rest.request(`${path}${path.includes("?") ? "&" : "?"}limit=${pageSize}&offset=${offset}`);
      if (!Array.isArray(page)) return rows;
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
    throw Object.assign(new Error("trading_workbench_result_limit"), { statusCode: 413 });
  }
  async listConnections(ownerId: string) {
    const rows = await this.rest.request(`/rest/v1/exchange_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=created_at.asc`);
    return (Array.isArray(rows) ? rows : []).map(mapConnection);
  }
  async loadFacts(ownerId: string, connectionIds: string[], from: string, to: string): Promise<WorkbenchFacts> {
    if (!connectionIds.length) return { snapshots: [], cash_events: [], cycles: [], reviews: [] };
    const owner = encodeURIComponent(ownerId); const ids = encodeURIComponent(inList(connectionIds));
    const snapshotFrom = new Date(Date.parse(from) - DAY_MS).toISOString();
    const [snapshots, events, cycles, reviews] = await Promise.all([
      this.all(`/rest/v1/trading_account_snapshots?owner_id=eq.${owner}&connection_id=${ids}&captured_at=gte.${encodeURIComponent(snapshotFrom)}&captured_at=lte.${encodeURIComponent(to)}&select=*`),
      this.all(`/rest/v1/trading_cash_events?owner_id=eq.${owner}&connection_id=${ids}&occurred_at=gte.${encodeURIComponent(from)}&occurred_at=lte.${encodeURIComponent(to)}&select=*`),
      this.all(`/rest/v1/trading_trade_cycles?owner_id=eq.${owner}&connection_id=${ids}&is_current=eq.true&select=*&order=opened_at.desc`),
      this.all(`/rest/v1/trading_trade_reviews?owner_id=eq.${owner}&select=*`),
    ]);
    return {
      snapshots: (Array.isArray(snapshots) ? snapshots : []).map((row: any) => ({
        provider: row.provider, connection_id: row.connection_id, captured_at: row.captured_at, account_currency: row.account_currency,
        equity: String(row.equity), wallet_balance: String(row.wallet_balance), unrealized_pnl: String(row.unrealized_pnl),
        usd_equity: row.usd_equity === null ? null : String(row.usd_equity),
        usd_wallet_balance: row.usd_wallet_balance === null ? null : String(row.usd_wallet_balance),
        usd_unrealized_pnl: row.usd_unrealized_pnl === null ? null : String(row.usd_unrealized_pnl),
        valuation: { status: row.valuation_status, rate: row.valuation_rate === null ? null : String(row.valuation_rate), source: row.valuation_source ?? null, path: Array.isArray(row.valuation_path) ? row.valuation_path : [], quoted_at: row.valuation_quoted_at ?? null },
        generation: Number(row.generation),
      })) as WorkbenchSnapshotRecord[],
      cash_events: (Array.isArray(events) ? events : []).map((row: any) => ({ ...row, type: row.event_type, amount: String(row.amount), usd_value: row.usd_value === null ? null : String(row.usd_value), generation: Number(row.generation) })) as WorkbenchCashEventRecord[],
      cycles: (Array.isArray(cycles) ? cycles : []).map(mapCycle), reviews: (Array.isArray(reviews) ? reviews : []).map(mapReview),
    };
  }
  async getTrade(ownerId: string, cycleId: string): Promise<WorkbenchTradeBundle | null> {
    const owner = encodeURIComponent(ownerId); const id = encodeURIComponent(cycleId);
    const cycles = await this.rest.request(`/rest/v1/trading_trade_cycles?owner_id=eq.${owner}&id=eq.${id}&select=*&limit=1`);
    const cycleRow = Array.isArray(cycles) ? cycles[0] : null; if (!cycleRow) return null;
    const [connections, reviews, lineage] = await Promise.all([
      this.rest.request(`/rest/v1/exchange_connections?owner_id=eq.${owner}&id=eq.${encodeURIComponent(String(cycleRow.connection_id))}&select=*&limit=1`),
      this.rest.request(`/rest/v1/trading_trade_reviews?owner_id=eq.${owner}&cycle_id=eq.${id}&select=*&limit=1`),
      this.rest.request(`/rest/v1/trading_trade_cycle_lineage?owner_id=eq.${owner}&canonical_cycle_id=eq.${id}&select=alias_cycle_id`),
    ]);
    const connection = Array.isArray(connections) ? connections[0] : null; if (!connection) return null;
    const aliasIds = (Array.isArray(lineage) ? lineage : []).map((item: any) => String(item.alias_cycle_id));
    const conflicts = aliasIds.length ? await this.rest.request(`/rest/v1/trading_trade_reviews?owner_id=eq.${owner}&cycle_id=${encodeURIComponent(inList(aliasIds))}&select=*`) : [];
    return { cycle: mapCycle(cycleRow), connection: mapConnection(connection), review: Array.isArray(reviews) && reviews[0] ? mapReview(reviews[0]) : null, conflicting_reviews: (Array.isArray(conflicts) ? conflicts : []).map(mapReview) };
  }
  async loadChartFacts(ownerId: string, cycleId: string): Promise<WorkbenchChartFacts | null> {
    const result = await this.rest.request("/rest/v1/rpc/load_private_trade_chart_facts", {
      method: "POST",
      body: { p_owner_id: ownerId, p_cycle_id: cycleId },
    });
    const payload = Array.isArray(result) ? result[0] : result;
    if (payload === null || payload === undefined) return null;
    if (typeof payload !== "object" || Array.isArray(payload)) throw chartError("trade_chart_snapshot_inconsistent", 500);
    const raw = payload as Record<string, any>;
    if (!raw.cycle || !raw.connection || !raw.snapshot_token
      || !Array.isArray(raw.allocations) || !Array.isArray(raw.fills)
      || !Array.isArray(raw.annotations) || !Array.isArray(raw.images)) {
      throw chartError("trade_chart_snapshot_inconsistent", 500);
    }
    const cycle = mapChartCycle(raw.cycle);
    const connection = mapChartConnection(raw.connection);
    const snapshotToken = raw.snapshot_token as Record<string, unknown>;
    if (String(raw.cycle.owner_id) !== ownerId
      || String(raw.connection.owner_id) !== ownerId
      || cycle.id !== cycleId
      || cycle.connection_id !== connection.id
      || !cycle.is_current
      || cycle.generation !== connection.sync_generation
      || Number(snapshotToken.cycle_revision) !== cycle.revision
      || Number(snapshotToken.cycle_generation) !== cycle.generation
      || Number(snapshotToken.sync_generation) !== connection.sync_generation) {
      throw chartError("trade_chart_snapshot_inconsistent", 500);
    }
    const allocations = raw.allocations as any[];
    const fillRows = raw.fills as any[];
    const annotationRows = raw.annotations as any[];
    const imageRows = raw.images as any[];
    const fillIds = allocations.map((row) => String(row.fill_id));
    const fillById = new Map(fillRows.map((row) => [String(row.id), row]));
    if (fillIds.length === 0
      || fillIds.some((fillId) => !/^[1-9]\d{0,29}$/.test(fillId))
      || new Set(fillIds).size !== fillIds.length
      || fillRows.length !== fillIds.length
      || allocations.some((allocation) => {
        const fill = fillById.get(String(allocation.fill_id));
        return Number(allocation.cycle_revision) !== cycle.revision
          || !fill
          || String(allocation.native_fill_id) !== String(fill.native_fill_id);
      })) {
      throw chartError("trade_chart_snapshot_inconsistent", 500);
    }
    const stateRow = raw.chart_state && typeof raw.chart_state === "object" && !Array.isArray(raw.chart_state)
      ? raw.chart_state
      : null;
    return {
      cycle,
      connection,
      allocations: allocations.map((row: any) => ({
        cycle_revision: Number(row.cycle_revision),
        fill_id: String(row.fill_id),
        native_fill_id: String(row.native_fill_id),
        allocation_quantity: typeof row.allocation_quantity === "string" ? row.allocation_quantity : "",
        allocation_role: row.allocation_role,
        sort_order: Number(row.sort_order),
      })) as WorkbenchChartAllocationRecord[],
      fills: fillRows.map((row: any) => ({
        id: String(row.id),
        native_fill_id: String(row.native_fill_id),
        native_symbol: String(row.native_symbol),
        occurred_at: String(row.occurred_at),
        price: typeof row.price === "string" ? row.price : "",
        side: row.side,
        position_side: row.position_side,
        liquidity: row.liquidity,
      })) as WorkbenchChartFillRecord[],
      annotations: annotationRows.map((row: any) => ({
        id: String(row.id),
        fill_id: String(row.fill_id),
        native_fill_id: String(row.native_fill_id),
        cycle_revision: Number(row.cycle_revision),
        body: String(row.body ?? ""),
        tags: Array.isArray(row.tags) ? row.tags : [],
        remap_status: row.remap_status,
        remapped_from_revision: row.remapped_from_revision === null
          ? null
          : Number(row.remapped_from_revision),
        version: Number(row.version),
        deleted_at: row.deleted_at === null ? null : String(row.deleted_at),
      })) as WorkbenchChartAnnotationRecord[],
      images: imageRows.map((row: any) => ({
        id: String(row.id),
        annotation_id: String(row.annotation_id),
        mime_type: row.mime_type,
        byte_size: Number(row.byte_size),
        sort_order: Number(row.sort_order),
        deleted_at: row.deleted_at === null ? null : String(row.deleted_at),
      })) as WorkbenchChartImageRecord[],
      chart_state: stateRow ? assertChartStateV1({
        schema_version: stateRow.schema_version,
        cycle_id: stateRow.cycle_id,
        cycle_revision: Number(stateRow.cycle_revision),
        timeframe: stateRow.timeframe,
        price_type: stateRow.price_type,
        viewport: stateRow.viewport,
        indicators: stateRow.indicators,
        drawings: stateRow.drawings,
        version: Number(stateRow.version),
        updated_at: stateRow.updated_at,
      }) : null,
    };
  }
  async saveChartState(accessToken: string, input: WorkbenchChartStateSave): Promise<ChartStateV1> {
    const result = await this.rest.request("/rest/v1/rpc/upsert_trading_chart_state", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        p_cycle_id: input.cycle_id,
        p_cycle_revision: input.cycle_revision,
        p_schema_version: input.schema_version,
        p_timeframe: input.timeframe,
        p_price_type: input.price_type,
        p_viewport: input.viewport,
        p_indicators: input.indicators,
        p_drawings: input.drawings,
        p_expected_version: input.expected_version,
        p_expected_updated_at: input.expected_updated_at,
      },
    });
    const row = Array.isArray(result) ? result[0] : result;
    return assertChartStateV1({
      schema_version: row?.schema_version,
      cycle_id: row?.cycle_id,
      cycle_revision: Number(row?.cycle_revision),
      timeframe: row?.timeframe,
      price_type: row?.price_type,
      viewport: row?.viewport,
      indicators: row?.indicators,
      drawings: row?.drawings,
      version: Number(row?.version),
      updated_at: row?.updated_at,
    });
  }
  async saveFillAnnotation(accessToken: string, input: WorkbenchFillAnnotationSave): Promise<WorkbenchChartAnnotationRecord> {
    const result = await this.rest.request("/rest/v1/rpc/upsert_trading_fill_annotation", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        p_annotation_id: input.annotation_id,
        p_cycle_id: input.cycle_id,
        p_fill_id: input.fill_id,
        p_cycle_revision: input.cycle_revision,
        p_body: input.body,
        p_tags: input.tags,
        p_images: input.images,
        p_expected_version: input.expected_version,
        p_deleted: input.deleted,
      },
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== "object") throw chartError("trade_chart_annotation_save_failed", 500);
    return {
      id: String(row.id),
      fill_id: String(row.fill_id),
      native_fill_id: String(row.native_fill_id),
      cycle_revision: Number(row.cycle_revision),
      body: String(row.body ?? ""),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      remap_status: row.remap_status,
      remapped_from_revision: row.remapped_from_revision === null
        ? null
        : Number(row.remapped_from_revision),
      version: Number(row.version),
      deleted_at: row.deleted_at === null ? null : String(row.deleted_at),
    } as WorkbenchChartAnnotationRecord;
  }
  async saveReview(input: WorkbenchReviewRecord & { owner_id: string }) {
    const rows = await this.rest.request("/rest/v1/rpc/save_trading_trade_review", { method: "POST", body: {
      p_owner_id: input.owner_id, p_cycle_id: input.cycle_id, p_expected_revision: input.cycle_revision,
      p_reason: input.reason, p_plan_compliance: input.plan_compliance, p_next_improvement: input.next_improvement,
      p_tags: input.tags, p_planned_stop_price: input.planned_stop_price, p_planned_risk_amount: input.planned_risk_amount,
    } });
    return mapReview(Array.isArray(rows) ? rows[0] : rows);
  }
}

export function createTradingWorkbenchService(config: GatewayConfig) {
  const enabledProviders = configuredTradingProviders(config);
  const adapters = createTradingProviderRegistry([
    new BinanceTradingProviderAdapter(config.BINANCE_FUTURES_API_URL),
    new OkxTradingProviderAdapter(),
    new BybitTradingProviderAdapter(),
    new BitgetTradingProviderAdapter(),
    new ExnessTradingProviderAdapter(),
  ], enabledProviders);
  return new TradingWorkbenchService({
    store: new SupabaseTradingWorkbenchStore(new SupabaseRest(config)),
    candleLoader: new SupabaseTradingWorkbenchCandleLoader({
      store: new SupabaseTradingSyncStore(config),
      adapters,
      masterKey: config.AI_SECRET_MASTER_KEY,
      identityKey: config.TRADING_ACCOUNT_HMAC_KEY,
    }),
  });
}
