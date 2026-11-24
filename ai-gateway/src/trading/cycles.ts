import { createHash, randomUUID } from "node:crypto";
import type { TradingProduct, TradingProvider } from "./providers/contracts.ts";
import type { CanonicalCashEvent, CanonicalFill } from "./providers/contracts.ts";

type Decimal = Readonly<{ coefficient: bigint; scale: number }>;

const ZERO: Decimal = { coefficient: 0n, scale: 0 };

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
  const sign = match[1] === "-" ? -1n : 1n;
  return normalize({ coefficient: sign * BigInt(`${match[2]}${fraction}`), scale: fraction.length });
}

function align(left: Decimal, right: Decimal): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * powerOfTen(scale - left.scale),
    right.coefficient * powerOfTen(scale - right.scale),
    scale,
  ];
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

function divide(left: Decimal, right: Decimal, precision = 18): Decimal {
  if (right.coefficient === 0n) throw new Error("division_by_zero");
  const numerator = left.coefficient * powerOfTen(right.scale + precision);
  const denominator = right.coefficient * powerOfTen(left.scale);
  return normalize({ coefficient: numerator / denominator, scale: precision });
}

function minimum(left: Decimal, right: Decimal): Decimal {
  return compare(left, right) <= 0 ? left : right;
}

function compare(left: Decimal, right: Decimal): number {
  const [a, b] = align(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function absolute(value: Decimal): Decimal {
  return value.coefficient < 0n ? { coefficient: -value.coefficient, scale: value.scale } : value;
}

function negate(value: Decimal): Decimal {
  return { coefficient: -value.coefficient, scale: value.scale };
}

function format(value: Decimal): string {
  const normalized = normalize(value);
  const negative = normalized.coefficient < 0n;
  const digits = absolute(normalized).coefficient.toString().padStart(normalized.scale + 1, "0");
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const integer = digits.slice(0, -normalized.scale);
  const fraction = digits.slice(-normalized.scale);
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

function isZero(value: Decimal): boolean {
  return value.coefficient === 0n;
}

function sign(value: Decimal): -1 | 0 | 1 {
  return value.coefficient < 0n ? -1 : value.coefficient > 0n ? 1 : 0;
}

export type ReconstructionInput = {
  provider: TradingProvider;
  connection_id: string;
  account_currency: string;
  fills: CanonicalFill[];
  cash_events: CanonicalCashEvent[];
};

export type ReconstructedCycle = {
  provider: TradingProvider;
  connection_id: string;
  account_currency: string;
  product: TradingProduct;
  symbol: string;
  native_position_id: string | null;
  direction: "long" | "short";
  stable_key: string;
  anchor_fill_id: string;
  fill_ids: string[];
  fill_digest: string;
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
  completeness: "complete" | "open" | "incomplete_opening_history";
};

type MutableCycle = {
  provider: TradingProvider;
  connectionId: string;
  accountCurrency: string;
  product: TradingProduct;
  symbol: string;
  nativePositionId: string | null;
  direction: "long" | "short";
  fillIds: string[];
  openedAt: string;
  closedAt: string | null;
  openingQuantity: Decimal;
  closingQuantity: Decimal;
  entryNotional: Decimal;
  exitNotional: Decimal;
  realizedPnl: Decimal;
  fees: Decimal;
  fundingOrSwap: Decimal;
  dividends: Decimal;
  completeness: ReconstructedCycle["completeness"];
};

function moneyAmount(value: { amount: string }): Decimal {
  return decimal(value.amount);
}

function uniqueSortedFills(fills: CanonicalFill[]): CanonicalFill[] {
  const byId = new Map<string, CanonicalFill>();
  for (const fill of fills) {
    if (!byId.has(fill.native_fill_id)) byId.set(fill.native_fill_id, fill);
  }
  return [...byId.values()].sort((left, right) => {
    const time = Date.parse(left.occurred_at) - Date.parse(right.occurred_at);
    return time || left.native_fill_id.localeCompare(right.native_fill_id);
  });
}

function fillDelta(fill: CanonicalFill): Decimal {
  const quantity = decimal(fill.quantity);
  if (fill.position_side === "long") return fill.action === "open" ? quantity : negate(quantity);
  if (fill.position_side === "short") return fill.action === "open" ? negate(quantity) : quantity;
  return fill.side === "buy" ? quantity : negate(quantity);
}

function startCycle(input: ReconstructionInput, fill: CanonicalFill, direction: "long" | "short", completeness: MutableCycle["completeness"]): MutableCycle {
  return {
    provider: input.provider,
    connectionId: input.connection_id,
    accountCurrency: input.account_currency,
    product: fill.product,
    symbol: fill.symbol,
    nativePositionId: fill.native_position_id,
    direction,
    fillIds: [],
    openedAt: new Date(fill.occurred_at).toISOString(),
    closedAt: null,
    openingQuantity: ZERO,
    closingQuantity: ZERO,
    entryNotional: ZERO,
    exitNotional: ZERO,
    realizedPnl: ZERO,
    fees: ZERO,
    fundingOrSwap: ZERO,
    dividends: ZERO,
    completeness,
  };
}

function addFillId(cycle: MutableCycle, fill: CanonicalFill): void {
  if (!cycle.fillIds.includes(fill.native_fill_id)) cycle.fillIds.push(fill.native_fill_id);
}

function allocated(value: Decimal, portion: Decimal, total: Decimal): Decimal {
  return compare(portion, total) === 0 ? value : multiply(value, divide(portion, total));
}

function addOpening(cycle: MutableCycle, fill: CanonicalFill, quantity: Decimal, total: Decimal): void {
  addFillId(cycle, fill);
  cycle.openingQuantity = add(cycle.openingQuantity, quantity);
  cycle.entryNotional = add(cycle.entryNotional, multiply(decimal(fill.price), quantity));
  cycle.fees = add(cycle.fees, allocated(moneyAmount(fill.fee), quantity, total));
}

function addClosing(cycle: MutableCycle, fill: CanonicalFill, quantity: Decimal, total: Decimal): void {
  addFillId(cycle, fill);
  cycle.closingQuantity = add(cycle.closingQuantity, quantity);
  cycle.exitNotional = add(cycle.exitNotional, multiply(decimal(fill.price), quantity));
  cycle.realizedPnl = add(cycle.realizedPnl, allocated(moneyAmount(fill.realized_pnl), quantity, minimum(quantity, total)));
  cycle.fees = add(cycle.fees, allocated(moneyAmount(fill.fee), quantity, total));
}

function digestFillIds(fillIds: readonly string[]): string {
  return createHash("sha256").update([...fillIds].sort().join("\n")).digest("hex");
}

function finalize(cycle: MutableCycle): ReconstructedCycle {
  const anchorFillId = cycle.fillIds[0] ?? "missing-anchor";
  const entryQuantity = isZero(cycle.openingQuantity) ? cycle.closingQuantity : cycle.openingQuantity;
  const entryPrice = isZero(cycle.openingQuantity) ? ZERO : divide(cycle.entryNotional, cycle.openingQuantity);
  const exitPrice = isZero(cycle.closingQuantity) ? null : format(divide(cycle.exitNotional, cycle.closingQuantity));
  const netPnl = add(add(add(cycle.realizedPnl, cycle.fees), cycle.fundingOrSwap), cycle.dividends);
  return {
    provider: cycle.provider,
    connection_id: cycle.connectionId,
    account_currency: cycle.accountCurrency,
    product: cycle.product,
    symbol: cycle.symbol,
    native_position_id: cycle.nativePositionId,
    direction: cycle.direction,
    stable_key: `${cycle.provider}:${cycle.connectionId}:${cycle.symbol}:${cycle.direction}:${anchorFillId}`,
    anchor_fill_id: anchorFillId,
    fill_ids: [...cycle.fillIds],
    fill_digest: digestFillIds(cycle.fillIds),
    opened_at: cycle.openedAt,
    closed_at: cycle.closedAt,
    entry_price: format(entryPrice),
    exit_price: exitPrice,
    quantity: format(entryQuantity),
    realized_pnl: format(cycle.realizedPnl),
    fees: format(cycle.fees),
    funding_or_swap: format(cycle.fundingOrSwap),
    dividends: format(cycle.dividends),
    net_pnl: format(netPnl),
    completeness: cycle.completeness,
  };
}

function reconstructGroup(input: ReconstructionInput, fills: CanonicalFill[]): MutableCycle[] {
  const completed: MutableCycle[] = [];
  let position = ZERO;
  let current: MutableCycle | null = null;

  for (const fill of uniqueSortedFills(fills)) {
    const delta = fillDelta(fill);
    const total = absolute(delta);
    if (isZero(total)) continue;

    if (isZero(position)) {
      if (fill.action === "close") {
        const incomplete = startCycle(input, fill, sign(delta) < 0 ? "long" : "short", "incomplete_opening_history");
        addClosing(incomplete, fill, total, total);
        incomplete.closedAt = new Date(fill.occurred_at).toISOString();
        completed.push(incomplete);
        continue;
      }
      current = startCycle(input, fill, sign(delta) > 0 ? "long" : "short", "open");
      addOpening(current, fill, total, total);
      position = delta;
      continue;
    }

    if (!current) throw new Error("cycle_state_missing");
    if (sign(position) === sign(delta)) {
      addOpening(current, fill, total, total);
      position = add(position, delta);
      continue;
    }

    const closingQuantity = minimum(absolute(position), total);
    addClosing(current, fill, closingQuantity, total);
    const nextPosition = add(position, delta);
    if (isZero(nextPosition) || sign(nextPosition) !== sign(position)) {
      current.closedAt = new Date(fill.occurred_at).toISOString();
      current.completeness = "complete";
      completed.push(current);
      current = null;
    }

    if (!isZero(nextPosition) && sign(nextPosition) !== sign(position)) {
      const openingQuantity = subtract(total, closingQuantity);
      current = startCycle(input, fill, sign(nextPosition) > 0 ? "long" : "short", "open");
      addOpening(current, fill, openingQuantity, total);
    }
    position = nextPosition;
  }

  if (current) completed.push(current);
  return completed;
}

function assignCashEvents(cycles: MutableCycle[], cashEvents: CanonicalCashEvent[]): void {
  const seen = new Set<string>();
  const events = [...cashEvents].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
  for (const event of events) {
    if (seen.has(event.native_event_id)) continue;
    seen.add(event.native_event_id);
    if (event.type !== "funding" && event.type !== "swap_fee" && event.type !== "dividend") continue;
    const occurred = Date.parse(event.occurred_at);
    const candidates = cycles.filter((cycle) => {
      if (cycle.connectionId !== event.connection_id) return false;
      if (event.symbol !== null && cycle.symbol !== event.symbol) return false;
      if (event.native_position_id !== null && cycle.nativePositionId !== event.native_position_id) return false;
      if (occurred < Date.parse(cycle.openedAt)) return false;
      return cycle.closedAt === null || occurred <= Date.parse(cycle.closedAt);
    });
    if (candidates.length !== 1) continue;
    const cycle = candidates[0];
    if (!cycle) continue;
    if (event.type === "dividend") cycle.dividends = add(cycle.dividends, decimal(event.amount));
    else cycle.fundingOrSwap = add(cycle.fundingOrSwap, decimal(event.amount));
  }
}

function reconstruct(input: ReconstructionInput, keyForFill: (fill: CanonicalFill) => string): ReconstructedCycle[] {
  const groups = new Map<string, CanonicalFill[]>();
  for (const fill of input.fills) {
    const key = keyForFill(fill);
    const group = groups.get(key) ?? [];
    group.push(fill);
    groups.set(key, group);
  }
  const mutable = [...groups.values()].flatMap((fills) => reconstructGroup(input, fills));
  assignCashEvents(mutable, input.cash_events);
  return mutable.map(finalize).sort((left, right) => Date.parse(left.opened_at) - Date.parse(right.opened_at));
}

export function reconstructNetZeroCycles(input: ReconstructionInput): ReconstructedCycle[] {
  return reconstruct(input, (fill) => `${fill.connection_id}:${fill.product}:${fill.symbol}:${fill.position_side}`);
}

export function reconstructPositionIdCycles(input: ReconstructionInput): ReconstructedCycle[] {
  return reconstruct(input, (fill) => `${fill.connection_id}:${fill.native_position_id ?? `missing:${fill.product}:${fill.symbol}:${fill.position_side}`}`);
}

export type PreviousCycleIdentity = {
  id: string;
  created_at: string;
  anchor_fill_id: string;
  fill_ids: string[];
  revision: number;
  fill_digest: string;
  has_review: boolean;
};

export type NextCycleCandidate = {
  stable_key: string;
  anchor_fill_id: string;
  fill_ids: string[];
  fill_digest: string;
};

export type CycleReconciliation = {
  assignments: Array<{ candidate_index: number; id: string; revision: number; previous_ids: string[] }>;
  aliases: Array<{ alias_cycle_id: string; canonical_cycle_id: string; relation: "merged"; source_revision: number }>;
  needs_reconciliation: Array<{ canonical_cycle_id: string; review_cycle_ids: string[] }>;
};

function overlapCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.reduce((count, fillId) => count + (rightSet.has(fillId) ? 1 : 0), 0);
}

export function reconcileCycleLineage(
  previous: PreviousCycleIdentity[],
  next: NextCycleCandidate[],
  generateId: () => string = randomUUID,
): CycleReconciliation {
  const protectedCandidate = new Map<string, number>();
  for (const oldCycle of previous) {
    const overlaps = next
      .map((candidate, index) => ({ index, overlap: overlapCount(oldCycle.fill_ids, candidate.fill_ids), anchor: candidate.fill_ids.includes(oldCycle.anchor_fill_id) }))
      .filter(({ overlap }) => overlap > 0)
      .sort((left, right) => Number(right.anchor) - Number(left.anchor) || right.overlap - left.overlap || left.index - right.index);
    const protectedMatch = overlaps[0];
    if (protectedMatch) protectedCandidate.set(oldCycle.id, protectedMatch.index);
  }

  const aliases: CycleReconciliation["aliases"] = [];
  const needsReconciliation: CycleReconciliation["needs_reconciliation"] = [];
  const assignments = next.map((candidate, candidateIndex) => {
    const matches = previous
      .filter((oldCycle) => overlapCount(oldCycle.fill_ids, candidate.fill_ids) > 0 && protectedCandidate.get(oldCycle.id) === candidateIndex)
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || left.id.localeCompare(right.id));
    const canonical = matches[0];
    if (!canonical) return { candidate_index: candidateIndex, id: generateId(), revision: 1, previous_ids: [] };

    for (const alias of matches.slice(1)) {
      aliases.push({ alias_cycle_id: alias.id, canonical_cycle_id: canonical.id, relation: "merged", source_revision: alias.revision });
    }
    const reviewed = matches.filter((cycle) => cycle.has_review).map((cycle) => cycle.id);
    if (reviewed.length > 1) needsReconciliation.push({ canonical_cycle_id: canonical.id, review_cycle_ids: reviewed });
    return {
      candidate_index: candidateIndex,
      id: canonical.id,
      revision: canonical.fill_digest === candidate.fill_digest ? canonical.revision : canonical.revision + 1,
      previous_ids: matches.map((cycle) => cycle.id),
    };
  });

  return { assignments, aliases, needs_reconciliation: needsReconciliation };
}
