import type { TradingMetricSummary, TradingValuationStatus } from "@wavekb/domain/trading-review";
import type { CanonicalAccountSnapshot, CanonicalCashEvent } from "./providers/contracts.ts";

type Decimal = Readonly<{ coefficient: bigint; scale: number }>;
const ZERO: Decimal = { coefficient: 0n, scale: 0 };
const ONE: Decimal = { coefficient: 1n, scale: 0 };
const QUOTE_MAX_AGE_MS = 35 * 60 * 1_000;
const TRANSFER_MATCH_WINDOW_MS = 5 * 60 * 1_000;
const BUCKET_MS = 15 * 60 * 1_000;

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function normalize(value: Decimal): Decimal {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function decimal(value: string): Decimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`invalid_decimal:${value}`);
  const fraction = match[3] ?? "";
  return normalize({
    coefficient: (match[1] === "-" ? -1n : 1n) * BigInt(`${match[2]}${fraction}`),
    scale: fraction.length,
  });
}

function align(left: Decimal, right: Decimal): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [left.coefficient * powerOfTen(scale - left.scale), right.coefficient * powerOfTen(scale - right.scale), scale];
}

function add(left: Decimal, right: Decimal): Decimal {
  const [a, b, scale] = align(left, right);
  return normalize({ coefficient: a + b, scale });
}

function subtract(left: Decimal, right: Decimal): Decimal {
  return add(left, { coefficient: -right.coefficient, scale: right.scale });
}

function multiply(left: Decimal, right: Decimal): Decimal {
  return normalize({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale });
}

function divide(left: Decimal, right: Decimal, precision = 36): Decimal {
  if (right.coefficient === 0n) throw new Error("division_by_zero");
  return normalize({
    coefficient: (left.coefficient * powerOfTen(right.scale + precision)) / (right.coefficient * powerOfTen(left.scale)),
    scale: precision,
  });
}

function truncate(value: Decimal, scale = 18): Decimal {
  if (value.scale <= scale) return value;
  return normalize({ coefficient: value.coefficient / powerOfTen(value.scale - scale), scale });
}

function absolute(value: Decimal): Decimal {
  return value.coefficient < 0n ? { coefficient: -value.coefficient, scale: value.scale } : value;
}

function compare(left: Decimal, right: Decimal): number {
  const [a, b] = align(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function format(value: Decimal): string {
  const normalized = normalize(value);
  const negative = normalized.coefficient < 0n;
  const digits = absolute(normalized).coefficient.toString().padStart(normalized.scale + 1, "0");
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  return `${negative ? "-" : ""}${digits.slice(0, -normalized.scale)}.${digits.slice(-normalized.scale)}`;
}

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => add(total, value), ZERO);
}

export type ValuationQuote = {
  base_asset: string;
  quote_asset: string;
  rate: string;
  source: string;
  quoted_at: string;
};

export type ValuedAmount = {
  amount: string;
  asset: string;
  usd_value: string | null;
  rate: string | null;
  status: TradingValuationStatus;
  source: string | null;
  path: string[];
  quoted_at: string | null;
  reason: "missing_quote" | "stale_quote" | "ambiguous_path" | null;
};

type QuoteEdge = {
  from: string;
  to: string;
  numerator: Decimal;
  denominator: Decimal;
  source: string;
  quotedAt: string;
};

function unavailable(amount: string, asset: string, reason: NonNullable<ValuedAmount["reason"]>): ValuedAmount {
  return { amount, asset, usd_value: null, rate: null, status: "unavailable", source: null, path: [asset], quoted_at: null, reason };
}

export function valueAmount(
  input: { amount: string; asset: string; at: string; max_age_ms?: number },
  quotes: ValuationQuote[],
): ValuedAmount {
  const asset = input.asset.toUpperCase();
  if (asset === "USD") {
    return { amount: input.amount, asset, usd_value: input.amount, rate: "1", status: "direct", source: "USD", path: ["USD"], quoted_at: input.at, reason: null };
  }
  if (asset === "USDT") {
    return { amount: input.amount, asset, usd_value: input.amount, rate: "1", status: "approximate", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: input.at, reason: null };
  }

  const atMs = Date.parse(input.at);
  const maxAge = input.max_age_ms ?? QUOTE_MAX_AGE_MS;
  const fresh = quotes.filter((item) => {
    const quoteMs = Date.parse(item.quoted_at);
    return quoteMs <= atMs && atMs - quoteMs <= maxAge;
  });
  const edges: QuoteEdge[] = [];
  for (const item of fresh) {
    const rate = decimal(item.rate);
    if (compare(rate, ZERO) <= 0) continue;
    const base = item.base_asset.toUpperCase();
    const quoteAsset = item.quote_asset.toUpperCase();
    edges.push({ from: base, to: quoteAsset, numerator: rate, denominator: ONE, source: item.source, quotedAt: item.quoted_at });
    edges.push({ from: quoteAsset, to: base, numerator: ONE, denominator: rate, source: item.source, quotedAt: item.quoted_at });
  }
  edges.push({ from: "USDT", to: "USD", numerator: ONE, denominator: ONE, source: "USDT approximate", quotedAt: input.at });

  const direct = edges.filter((edge) => edge.from === asset && edge.to === "USD");
  if (direct.length === 1) {
    const edge = direct[0];
    if (!edge) throw new Error("valuation_edge_missing");
    return {
      amount: input.amount, asset,
      usd_value: format(divide(multiply(decimal(input.amount), edge.numerator), edge.denominator)),
      rate: format(divide(edge.numerator, edge.denominator)),
      status: "direct", source: edge.source, path: [asset, "USD"], quoted_at: edge.quotedAt, reason: null,
    };
  }
  if (direct.length > 1) return unavailable(input.amount, asset, "ambiguous_path");

  const oneHop: Array<{ first: QuoteEdge; second: QuoteEdge }> = [];
  for (const first of edges.filter((edge) => edge.from === asset && edge.to !== "USD")) {
    for (const second of edges.filter((edge) => edge.from === first.to && edge.to === "USD")) {
      oneHop.push({ first, second });
    }
  }
  if (oneHop.length === 1) {
    const route = oneHop[0];
    if (!route) throw new Error("valuation_route_missing");
    const numerator = multiply(route.first.numerator, route.second.numerator);
    const denominator = multiply(route.first.denominator, route.second.denominator);
    const rate = divide(numerator, denominator);
    return {
      amount: input.amount, asset, usd_value: format(divide(multiply(decimal(input.amount), numerator), denominator)), rate: format(rate), status: "triangulated",
      source: `${route.first.source} + ${route.second.source}`, path: [asset, route.first.to, "USD"],
      quoted_at: Date.parse(route.first.quotedAt) <= Date.parse(route.second.quotedAt) ? route.first.quotedAt : route.second.quotedAt, reason: null,
    };
  }
  if (oneHop.length > 1) return unavailable(input.amount, asset, "ambiguous_path");

  const relevantStaleQuote = quotes.some((item) => item.base_asset.toUpperCase() === asset || item.quote_asset.toUpperCase() === asset);
  return unavailable(input.amount, asset, relevantStaleQuote ? "stale_quote" : "missing_quote");
}

export type TransferMatchResult = {
  matches: Array<{ outgoing_event_id: string; incoming_event_id: string; asset: string; amount: string }>;
  unpaired_event_ids: string[];
};

export function matchInternalTransfers(events: CanonicalCashEvent[]): TransferMatchResult {
  const transfers = events
    .filter((event) => event.type === "internal_transfer")
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at) || left.native_event_id.localeCompare(right.native_event_id));
  const used = new Set<string>();
  const matches: TransferMatchResult["matches"] = [];
  for (const outgoing of transfers.filter((event) => compare(decimal(event.amount), ZERO) < 0)) {
    if (used.has(outgoing.native_event_id)) continue;
    const incoming = transfers.find((candidate) =>
      !used.has(candidate.native_event_id)
      && candidate.connection_id !== outgoing.connection_id
      && candidate.asset === outgoing.asset
      && compare(decimal(candidate.amount), absolute(decimal(outgoing.amount))) === 0
      && Math.abs(Date.parse(candidate.occurred_at) - Date.parse(outgoing.occurred_at)) <= TRANSFER_MATCH_WINDOW_MS,
    );
    if (!incoming) continue;
    used.add(outgoing.native_event_id);
    used.add(incoming.native_event_id);
    matches.push({ outgoing_event_id: outgoing.native_event_id, incoming_event_id: incoming.native_event_id, asset: outgoing.asset, amount: format(absolute(decimal(outgoing.amount))) });
  }
  return { matches, unpaired_event_ids: transfers.filter((event) => !used.has(event.native_event_id)).map((event) => event.native_event_id) };
}

export type PortfolioFilter = {
  connection_ids: string[];
  from: string;
  to: string;
  timezone: string;
};

export type PortfolioPoint = {
  at: string;
  equity_usd: string | null;
  external_cash_flow_usd: string | null;
  period_return: string | null;
  cumulative_profit_usd: string | null;
  included_connection_ids: string[];
  excluded_connection_ids: string[];
  is_complete: boolean;
  incomplete_reasons: string[];
};

export type PortfolioSeries = {
  points: PortfolioPoint[];
  current_equity_usd: string | null;
  cumulative_profit_usd: string | null;
  time_weighted_return: string | null;
  included_connection_count: number;
  excluded_connection_count: number;
  coverage_started_at: string | null;
  coverage_ended_at: string | null;
  is_complete: boolean;
  incomplete_reasons: string[];
};

function bucketFloor(timestamp: string): number {
  return Math.floor(Date.parse(timestamp) / BUCKET_MS) * BUCKET_MS;
}

function externalEventTypes(event: CanonicalCashEvent): boolean {
  return ["deposit", "withdrawal", "internal_transfer", "admin_adjustment", "bonus"].includes(event.type);
}

export function buildPortfolioSeries(
  snapshots: CanonicalAccountSnapshot[],
  events: CanonicalCashEvent[],
  filter: PortfolioFilter,
): PortfolioSeries {
  const selected = new Set(filter.connection_ids);
  const snapshotsByConnection = new Map<string, CanonicalAccountSnapshot[]>();
  for (const snapshot of snapshots.filter((item) => selected.has(item.connection_id))) {
    const group = snapshotsByConnection.get(snapshot.connection_id) ?? [];
    group.push(snapshot);
    snapshotsByConnection.set(snapshot.connection_id, group);
  }
  for (const group of snapshotsByConnection.values()) group.sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));

  const transferResult = matchInternalTransfers(events);
  const paired = new Map<string, string>();
  for (const match of transferResult.matches) {
    paired.set(match.outgoing_event_id, match.incoming_event_id);
    paired.set(match.incoming_event_id, match.outgoing_event_id);
  }
  const eventsById = new Map(events.map((event) => [event.native_event_id, event]));
  const unpaired = new Set(transferResult.unpaired_event_ids);
  const reasons = new Set<string>();

  const portfolioEvents = events.filter((event) => {
    if (!selected.has(event.connection_id) || !externalEventTypes(event)) return false;
    if (event.type !== "internal_transfer") return true;
    const counterpartId = paired.get(event.native_event_id);
    if (!counterpartId) {
      reasons.add("unpaired_internal_transfer");
      return true;
    }
    const counterpart = eventsById.get(counterpartId);
    return !counterpart || !selected.has(counterpart.connection_id);
  });
  if (portfolioEvents.some((event) => event.usd_value === null)) reasons.add("unvalued_external_cash_flow");
  if (events.some((event) => selected.has(event.connection_id) && event.type === "unknown")) reasons.add("unknown_cash_event");
  if (unpaired.size > 0 && events.some((event) => selected.has(event.connection_id) && unpaired.has(event.native_event_id))) reasons.add("unpaired_internal_transfer");

  const start = bucketFloor(filter.from);
  const end = bucketFloor(filter.to);
  const points: PortfolioPoint[] = [];
  let firstEquity: Decimal | null = null;
  let cumulativeFlow = ZERO;
  let previousEquity: Decimal | null = null;
  let previousPointValid = false;
  let twr = ONE;
  let hasReturn = false;

  for (let bucket = start; bucket <= end; bucket += BUCKET_MS) {
    const included: string[] = [];
    const excluded: string[] = [];
    const equities: Decimal[] = [];
    const pointReasons = new Set<string>();
    for (const connectionId of filter.connection_ids) {
      const candidates = (snapshotsByConnection.get(connectionId) ?? []).filter((snapshot) => Date.parse(snapshot.captured_at) <= bucket);
      const latest = candidates[candidates.length - 1];
      if (!latest) {
        excluded.push(connectionId);
        pointReasons.add("missing_snapshot_coverage");
        continue;
      }
      if (bucket - Date.parse(latest.captured_at) > QUOTE_MAX_AGE_MS) {
        excluded.push(connectionId);
        pointReasons.add("stale_snapshot_gap");
        continue;
      }
      if (latest.usd_equity === null) {
        excluded.push(connectionId);
        pointReasons.add("unavailable_snapshot_valuation");
        continue;
      }
      included.push(connectionId);
      equities.push(decimal(latest.usd_equity));
    }
    for (const reason of pointReasons) reasons.add(reason);
    const equity = equities.length > 0 ? sum(equities) : null;
    if (firstEquity === null && equity !== null) firstEquity = equity;

    const previousBucket = bucket - BUCKET_MS;
    const intervalEvents = portfolioEvents.filter((event) => {
      const occurred = Date.parse(event.occurred_at);
      return occurred > Math.max(previousBucket, start) && occurred <= bucket;
    });
    const valuedFlows = intervalEvents.filter((event) => event.usd_value !== null).map((event) => decimal(event.usd_value as string));
    const intervalFlow = valuedFlows.length === intervalEvents.length ? sum(valuedFlows) : null;
    if (intervalFlow !== null) cumulativeFlow = add(cumulativeFlow, intervalFlow);

    let periodReturn: Decimal | null = null;
    if (previousPointValid && previousEquity !== null && equity !== null && intervalFlow !== null && compare(previousEquity, ZERO) !== 0) {
      periodReturn = divide(subtract(subtract(equity, previousEquity), intervalFlow), previousEquity);
      twr = truncate(multiply(twr, add(ONE, periodReturn)), 36);
      hasReturn = true;
    }
    const cumulativeProfit = firstEquity !== null && equity !== null ? subtract(subtract(equity, firstEquity), cumulativeFlow) : null;
    points.push({
      at: new Date(bucket).toISOString(), equity_usd: equity === null ? null : format(equity),
      external_cash_flow_usd: intervalFlow === null ? null : format(intervalFlow), period_return: periodReturn === null ? null : format(truncate(periodReturn)),
      cumulative_profit_usd: cumulativeProfit === null ? null : format(cumulativeProfit), included_connection_ids: included,
      excluded_connection_ids: excluded, is_complete: pointReasons.size === 0 && intervalFlow !== null,
      incomplete_reasons: [...pointReasons],
    });
    previousPointValid = equity !== null;
    previousEquity = equity;
  }

  const latestPoint = points[points.length - 1];
  const includedConnectionIds = new Set(points.flatMap((point) => point.included_connection_ids));
  const excludedCount = filter.connection_ids.filter((id) => !includedConnectionIds.has(id)).length;
  const seriesComplete = reasons.size === 0 && points.every((point) => point.is_complete);
  return {
    points,
    current_equity_usd: latestPoint?.equity_usd ?? null,
    cumulative_profit_usd: latestPoint?.cumulative_profit_usd ?? null,
    time_weighted_return: hasReturn ? format(truncate(subtract(twr, ONE))) : null,
    included_connection_count: includedConnectionIds.size,
    excluded_connection_count: excludedCount,
    coverage_started_at: points.find((point) => point.equity_usd !== null)?.at ?? null,
    coverage_ended_at: [...points].reverse().find((point) => point.equity_usd !== null)?.at ?? null,
    is_complete: seriesComplete,
    incomplete_reasons: [...reasons],
  };
}

export type AccountingCycle = {
  closed_at: string | null;
  completeness: "complete" | "open" | "incomplete_opening_history" | "incomplete_valuation";
  net_pnl: string;
  usd_net_pnl: string | null;
};

export function calculateTradingMetrics(cycles: AccountingCycle[], series: PortfolioSeries): TradingMetricSummary {
  const closed = cycles.filter((cycle) => cycle.closed_at !== null && cycle.completeness !== "open" && cycle.completeness !== "incomplete_opening_history");
  const valued = closed.filter((cycle): cycle is AccountingCycle & { usd_net_pnl: string } => cycle.usd_net_pnl !== null);
  const values = valued.map((cycle) => decimal(cycle.usd_net_pnl));
  const nativeValues = closed.map((cycle) => decimal(cycle.net_pnl));
  const winningCycleCount = nativeValues.filter((value) => compare(value, ZERO) > 0).length;
  const wins = values.filter((value) => compare(value, ZERO) > 0);
  const losses = values.filter((value) => compare(value, ZERO) < 0).map(absolute);
  const reasons = new Set(series.incomplete_reasons);
  if (valued.length !== closed.length) reasons.add("unvalued_closed_cycle");

  let peak: Decimal | null = null;
  let maximumDrawdown = ZERO;
  for (const point of series.points) {
    if (point.equity_usd === null) continue;
    const equity = decimal(point.equity_usd);
    if (peak === null || compare(equity, peak) > 0) peak = equity;
    if (peak !== null && compare(peak, ZERO) > 0) {
      const drawdown = divide(subtract(peak, equity), peak);
      if (compare(drawdown, maximumDrawdown) > 0) maximumDrawdown = drawdown;
    }
  }

  const totalWins = sum(wins);
  const totalLosses = sum(losses);
  const averageWin = wins.length > 0 ? divide(totalWins, decimal(String(wins.length))) : null;
  const averageLoss = losses.length > 0 ? divide(totalLosses, decimal(String(losses.length))) : null;
  return {
    current_equity_usd: series.current_equity_usd,
    cumulative_profit_usd: series.cumulative_profit_usd,
    time_weighted_return: series.time_weighted_return,
    maximum_drawdown: series.points.some((point) => point.equity_usd !== null) ? format(truncate(maximumDrawdown)) : null,
    realized_net_pnl_usd: closed.length > 0 && valued.length === 0 ? null : format(sum(values)),
    win_rate: closed.length > 0 ? format(truncate(divide(decimal(String(winningCycleCount)), decimal(String(closed.length))))) : null,
    average_win_loss_ratio: averageWin !== null && averageLoss !== null && compare(averageLoss, ZERO) > 0 ? format(truncate(divide(averageWin, averageLoss))) : null,
    profit_factor: losses.length > 0 ? format(truncate(divide(totalWins, totalLosses))) : null,
    closed_trade_count: closed.length,
    included_connection_count: series.included_connection_count,
    excluded_connection_count: series.excluded_connection_count,
    is_complete: series.is_complete && valued.length === closed.length,
    incomplete_reasons: [...reasons],
  };
}
