import type {
  ExchangeConnectionView,
  TradeCycleView,
  TradePlanCompliance,
  TradingMetricSummary,
  TradingProduct,
  TradingProvider,
  TradingRange,
  TradingValuationStatus,
} from "@wavekb/domain/trading-review";
import type { GatewayConfig } from "../config.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { buildPortfolioSeries, calculateTradingMetrics, type PortfolioPoint } from "./accounting.ts";
import type { CanonicalAccountSnapshot, CanonicalCashEvent } from "./providers/contracts.ts";

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

export interface TradingWorkbenchStore {
  listConnections(ownerId: string): Promise<WorkbenchConnectionRecord[]>;
  loadFacts(ownerId: string, connectionIds: string[], from: string, to: string): Promise<WorkbenchFacts>;
  getTrade(ownerId: string, cycleId: string): Promise<WorkbenchTradeBundle | null>;
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

export class TradingWorkbenchService {
  private readonly store: TradingWorkbenchStore;
  private readonly now: () => number;
  constructor(input: { store: TradingWorkbenchStore; now?: () => number }) { this.store = input.store; this.now = input.now ?? Date.now; }

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
  return new TradingWorkbenchService({ store: new SupabaseTradingWorkbenchStore(new SupabaseRest(config)) });
}
