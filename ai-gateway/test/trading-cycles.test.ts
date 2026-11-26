import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalCashEvent, CanonicalFill } from "../src/trading/providers/contracts.ts";
import {
  reconcileCycleLineage,
  reconstructNetZeroCycles,
  reconstructPositionIdCycles,
  type NextCycleCandidate,
  type PreviousCycleIdentity,
} from "../src/trading/cycles.ts";

const connectionId = "11111111-1111-4111-8111-111111111111";

function fill(overrides: Partial<CanonicalFill> & Pick<CanonicalFill, "native_fill_id" | "occurred_at">): CanonicalFill {
  return {
    provider: "binance",
    connection_id: connectionId,
    native_order_id: `order-${overrides.native_fill_id}`,
    native_position_id: null,
    symbol: "BTCUSDT",
    native_symbol: "BTCUSDT",
    product: "usdt_perpetual",
    side: "buy",
    position_side: "long",
    action: "open",
    price: "100",
    quantity: "1",
    contract_multiplier: "1",
    realized_pnl: { amount: "0", asset: "USDT", usd_value: "0" },
    fee: { amount: "-1", asset: "USDT", usd_value: "-1" },
    liquidity: "taker",
    ...overrides,
  };
}

function cash(overrides: Partial<CanonicalCashEvent> & Pick<CanonicalCashEvent, "native_event_id" | "occurred_at">): CanonicalCashEvent {
  return {
    provider: "exness",
    connection_id: connectionId,
    native_type: "SWAP",
    type: "swap_fee",
    amount: "-1",
    asset: "USD",
    usd_value: "-1",
    symbol: "XAUUSD",
    native_position_id: null,
    ...overrides,
  };
}

test("net-zero reconstruction deduplicates and sorts fills while preserving add and partial-close arithmetic", () => {
  const fills = [
    fill({ native_fill_id: "f4", occurred_at: "2026-11-24T04:00:00Z", side: "sell", action: "close", price: "130", realized_pnl: { amount: "20", asset: "USDT", usd_value: "20" } }),
    fill({ native_fill_id: "f2", occurred_at: "2026-11-24T02:00:00Z", price: "110" }),
    fill({ native_fill_id: "f1", occurred_at: "2026-11-24T01:00:00Z", price: "100" }),
    fill({ native_fill_id: "f3", occurred_at: "2026-11-24T03:00:00Z", side: "sell", action: "close", price: "120", realized_pnl: { amount: "10", asset: "USDT", usd_value: "10" } }),
    fill({ native_fill_id: "f2", occurred_at: "2026-11-24T02:00:00Z", price: "110" }),
  ];

  const cycles = reconstructNetZeroCycles({
    provider: "binance", connection_id: connectionId, account_currency: "USDT", fills, cash_events: [],
  });

  assert.equal(cycles.length, 1);
  const cycle = cycles[0];
  assert.ok(cycle);
  assert.deepEqual(cycle.fill_ids, ["f1", "f2", "f3", "f4"]);
  assert.deepEqual(cycle.allocations, [
    { native_fill_id: "f1", quantity: "1", role: "open", sort_order: 0 },
    { native_fill_id: "f2", quantity: "1", role: "add", sort_order: 1 },
    { native_fill_id: "f3", quantity: "1", role: "reduce", sort_order: 2 },
    { native_fill_id: "f4", quantity: "1", role: "close", sort_order: 3 },
  ]);
  assert.equal(cycle.entry_price, "105");
  assert.equal(cycle.exit_price, "125");
  assert.equal(cycle.quantity, "2");
  assert.equal(cycle.realized_pnl, "30");
  assert.equal(cycle.fees, "-4");
  assert.equal(cycle.net_pnl, "26");
  assert.equal(cycle.completeness, "complete");
  assert.equal(cycle.closed_at, "2026-11-24T04:00:00.000Z");
});

test("hedge positions stay separate and an over-close reverses through zero into two cycles", () => {
  const hedgeCycles = reconstructNetZeroCycles({
    provider: "okx", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [
      fill({ native_fill_id: "l1", occurred_at: "2026-11-24T01:00:00Z", position_side: "long", side: "buy", action: "open" }),
      fill({ native_fill_id: "s1", occurred_at: "2026-11-24T01:30:00Z", position_side: "short", side: "sell", action: "open", quantity: "2" }),
      fill({ native_fill_id: "s2", occurred_at: "2026-11-24T02:00:00Z", position_side: "short", side: "buy", action: "close" }),
      fill({ native_fill_id: "l2", occurred_at: "2026-11-24T02:30:00Z", position_side: "long", side: "sell", action: "close" }),
      fill({ native_fill_id: "s3", occurred_at: "2026-11-24T03:00:00Z", position_side: "short", side: "buy", action: "close" }),
    ],
  });
  assert.equal(hedgeCycles.length, 2);
  assert.deepEqual(hedgeCycles.map((cycle) => [cycle.direction, cycle.quantity, cycle.fill_ids]), [
    ["long", "1", ["l1", "l2"]],
    ["short", "2", ["s1", "s2", "s3"]],
  ]);

  const reversal = reconstructNetZeroCycles({
    provider: "binance", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [
      fill({ native_fill_id: "r1", occurred_at: "2026-11-24T01:00:00Z", position_side: "both", side: "buy", action: "open", price: "100" }),
      fill({ native_fill_id: "r2", occurred_at: "2026-11-24T02:00:00Z", position_side: "both", side: "sell", action: "close", quantity: "2", price: "110", realized_pnl: { amount: "10", asset: "USDT", usd_value: "10" }, fee: { amount: "-2", asset: "USDT", usd_value: "-2" } }),
      fill({ native_fill_id: "r3", occurred_at: "2026-11-24T03:00:00Z", position_side: "both", side: "buy", action: "close", price: "105", realized_pnl: { amount: "5", asset: "USDT", usd_value: "5" } }),
    ],
  });
  assert.equal(reversal.length, 2);
  assert.deepEqual(reversal.map((cycle) => [cycle.direction, cycle.realized_pnl, cycle.fees, cycle.net_pnl]), [
    ["long", "10", "-2", "8"],
    ["short", "5", "-2", "3"],
  ]);
  assert.deepEqual(reversal[0]?.allocations, [
    { native_fill_id: "r1", quantity: "1", role: "open", sort_order: 0 },
    { native_fill_id: "r2", quantity: "1", role: "close", sort_order: 1 },
  ]);
  assert.deepEqual(reversal[1]?.allocations, [
    { native_fill_id: "r2", quantity: "1", role: "reverse_open", sort_order: 0 },
    { native_fill_id: "r3", quantity: "1", role: "close", sort_order: 1 },
  ]);
});

test("allocation quantities preserve exact decimals across add, reduce, full close, and reversal", () => {
  const cycles = reconstructNetZeroCycles({
    provider: "binance", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [
      fill({ native_fill_id: "d1", occurred_at: "2026-11-24T01:00:00Z", position_side: "both", quantity: "0.100000000000000001" }),
      fill({ native_fill_id: "d2", occurred_at: "2026-11-24T02:00:00Z", position_side: "both", quantity: "0.200000000000000002" }),
      fill({ native_fill_id: "d3", occurred_at: "2026-11-24T03:00:00Z", position_side: "both", side: "sell", action: "close", quantity: "0.100000000000000001" }),
      fill({ native_fill_id: "d4", occurred_at: "2026-11-24T04:00:00Z", position_side: "both", side: "sell", action: "close", quantity: "0.300000000000000003" }),
    ],
  });

  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles[0]?.allocations, [
    { native_fill_id: "d1", quantity: "0.100000000000000001", role: "open", sort_order: 0 },
    { native_fill_id: "d2", quantity: "0.200000000000000002", role: "add", sort_order: 1 },
    { native_fill_id: "d3", quantity: "0.100000000000000001", role: "reduce", sort_order: 2 },
    { native_fill_id: "d4", quantity: "0.200000000000000002", role: "close", sort_order: 3 },
  ]);
  assert.deepEqual(cycles[1]?.allocations, [
    { native_fill_id: "d4", quantity: "0.100000000000000001", role: "reverse_open", sort_order: 0 },
  ]);
  assert.deepEqual(cycles[0]?.fill_ids, ["d1", "d2", "d3", "d4"]);
  assert.deepEqual(cycles[1]?.fill_ids, ["d4"]);
});

test("same-timestamp native fill IDs use explicit code-point ordering", () => {
  const cycles = reconstructNetZeroCycles({
    provider: "binance", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [
      fill({ native_fill_id: "a", occurred_at: "2026-11-24T01:00:00Z", quantity: "1" }),
      fill({ native_fill_id: "Z", occurred_at: "2026-11-24T01:00:00Z", quantity: "1" }),
      fill({ native_fill_id: "close", occurred_at: "2026-11-24T02:00:00Z", side: "sell", action: "close", quantity: "2" }),
    ],
  });

  assert.deepEqual(cycles[0]?.fill_ids, ["Z", "a", "close"]);
  assert.deepEqual(cycles[0]?.allocations.map(({ native_fill_id, sort_order }) => ({ native_fill_id, sort_order })), [
    { native_fill_id: "Z", sort_order: 0 },
    { native_fill_id: "a", sort_order: 1 },
    { native_fill_id: "close", sort_order: 2 },
  ]);
});

test("allocation fact changes advance a known allocation-aware revision but legacy revisions backfill once", () => {
  const initial = reconstructNetZeroCycles({
    provider: "binance", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [fill({ native_fill_id: "same-fill", occurred_at: "2026-11-24T01:00:00Z", quantity: "1" })],
  })[0];
  const corrected = reconstructNetZeroCycles({
    provider: "binance", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [fill({ native_fill_id: "same-fill", occurred_at: "2026-11-24T01:00:00Z", quantity: "2" })],
  })[0];
  assert.ok(initial && corrected);
  assert.equal(initial.fill_digest, corrected.fill_digest);
  assert.match(initial.allocation_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(initial.allocation_digest, corrected.allocation_digest);

  const allocationAware = reconcileCycleLineage(
    [{
      ...previous({ id: "cycle-id", created_at: "2026-11-24T01:00:00Z", anchor_fill_id: "same-fill", fill_ids: ["same-fill"] }),
      fill_digest: initial.fill_digest,
      allocation_digest: initial.allocation_digest,
    }],
    [corrected],
    () => "unused",
  );
  assert.equal(allocationAware.assignments[0]?.revision, 2);

  const legacy = reconcileCycleLineage(
    [{
      ...previous({ id: "cycle-id", created_at: "2026-11-24T01:00:00Z", anchor_fill_id: "same-fill", fill_ids: ["same-fill"] }),
      fill_digest: initial.fill_digest,
    }],
    [initial],
    () => "unused",
  );
  assert.equal(legacy.assignments[0]?.revision, 1);
});

test("a closing fill before any opening evidence is excluded as incomplete opening history", () => {
  const cycles = reconstructNetZeroCycles({
    provider: "bitget", connection_id: connectionId, account_currency: "USDT", cash_events: [],
    fills: [
      fill({ native_fill_id: "cut-1", occurred_at: "2026-11-24T01:00:00Z", side: "sell", action: "close", realized_pnl: { amount: "8", asset: "USDT", usd_value: "8" } }),
      fill({ native_fill_id: "new-1", occurred_at: "2026-11-24T02:00:00Z", side: "buy", action: "open" }),
      fill({ native_fill_id: "new-2", occurred_at: "2026-11-24T03:00:00Z", side: "sell", action: "close" }),
    ],
  });
  assert.equal(cycles.length, 2);
  const incomplete = cycles[0];
  const complete = cycles[1];
  assert.ok(incomplete && complete);
  assert.equal(incomplete.completeness, "incomplete_opening_history");
  assert.deepEqual(incomplete.fill_ids, ["cut-1"]);
  assert.deepEqual(incomplete.allocations, [
    { native_fill_id: "cut-1", quantity: "1", role: "close", sort_order: 0 },
  ]);
  assert.equal(complete.completeness, "complete");
});

test("Exness position IDs remain independent through partial closes and receive only attributable swap and dividends", () => {
  const fills = [
    fill({ provider: "exness", native_fill_id: "a-open", native_position_id: "position-a", occurred_at: "2026-11-24T01:00:00Z", symbol: "XAUUSD", native_symbol: "XAUUSD", product: "cfd", quantity: "2" }),
    fill({ provider: "exness", native_fill_id: "b-open", native_position_id: "position-b", occurred_at: "2026-11-24T01:30:00Z", symbol: "XAUUSD", native_symbol: "XAUUSD", product: "cfd" }),
    fill({ provider: "exness", native_fill_id: "a-part", native_position_id: "position-a", occurred_at: "2026-11-24T02:00:00Z", symbol: "XAUUSD", native_symbol: "XAUUSD", product: "cfd", side: "sell", action: "close" }),
    fill({ provider: "exness", native_fill_id: "b-close", native_position_id: "position-b", occurred_at: "2026-11-24T02:30:00Z", symbol: "XAUUSD", native_symbol: "XAUUSD", product: "cfd", side: "sell", action: "close" }),
    fill({ provider: "exness", native_fill_id: "a-close", native_position_id: "position-a", occurred_at: "2026-11-24T03:00:00Z", symbol: "XAUUSD", native_symbol: "XAUUSD", product: "cfd", side: "sell", action: "close" }),
  ];
  const events = [
    cash({ native_event_id: "swap-a", native_position_id: "position-a", occurred_at: "2026-11-24T01:45:00Z", amount: "-2", usd_value: "-2" }),
    cash({ native_event_id: "swap-b", native_position_id: "position-b", occurred_at: "2026-11-24T01:50:00Z", amount: "-1", usd_value: "-1" }),
    cash({ native_event_id: "div-a", native_position_id: "position-a", occurred_at: "2026-11-24T02:15:00Z", type: "dividend", native_type: "DIVIDEND", amount: "3", usd_value: "3" }),
    cash({ native_event_id: "balance", native_position_id: null, occurred_at: "2026-11-24T02:20:00Z", type: "deposit", native_type: "BALANCE", amount: "100", usd_value: "100", symbol: null }),
  ];

  const cycles = reconstructPositionIdCycles({
    provider: "exness", connection_id: connectionId, account_currency: "USD", fills, cash_events: events,
  });
  assert.equal(cycles.length, 2);
  const positionA = cycles.find((cycle) => cycle.native_position_id === "position-a");
  const positionB = cycles.find((cycle) => cycle.native_position_id === "position-b");
  assert.ok(positionA && positionB);
  assert.deepEqual(positionA.fill_ids, ["a-open", "a-part", "a-close"]);
  assert.deepEqual(positionA.allocations, [
    { native_fill_id: "a-open", quantity: "2", role: "open", sort_order: 0 },
    { native_fill_id: "a-part", quantity: "1", role: "reduce", sort_order: 1 },
    { native_fill_id: "a-close", quantity: "1", role: "close", sort_order: 2 },
  ]);
  assert.equal(positionA.funding_or_swap, "-2");
  assert.equal(positionA.dividends, "3");
  assert.equal(positionB.funding_or_swap, "-1");
  assert.equal(positionB.dividends, "0");
});

test("funding without a unique position match remains unassigned instead of changing either hedge cycle", () => {
  const cycles = reconstructNetZeroCycles({
    provider: "okx", connection_id: connectionId, account_currency: "USDT",
    fills: [
      fill({ native_fill_id: "long-open", occurred_at: "2026-11-24T01:00:00Z", position_side: "long" }),
      fill({ native_fill_id: "short-open", occurred_at: "2026-11-24T01:00:01Z", position_side: "short", side: "sell" }),
      fill({ native_fill_id: "long-close", occurred_at: "2026-11-24T03:00:00Z", position_side: "long", side: "sell", action: "close" }),
      fill({ native_fill_id: "short-close", occurred_at: "2026-11-24T03:00:01Z", position_side: "short", side: "buy", action: "close" }),
    ],
    cash_events: [cash({ provider: "okx", native_event_id: "ambiguous", occurred_at: "2026-11-24T02:00:00Z", type: "funding", native_type: "FUNDING", symbol: "BTCUSDT", asset: "USDT" })],
  });
  assert.deepEqual(cycles.map((cycle) => cycle.funding_or_swap), ["0", "0"]);
});

function previous(overrides: Partial<PreviousCycleIdentity> & Pick<PreviousCycleIdentity, "id" | "anchor_fill_id" | "fill_ids" | "created_at">): PreviousCycleIdentity {
  return { revision: 1, fill_digest: "old", has_review: false, ...overrides };
}

function next(overrides: Partial<NextCycleCandidate> & Pick<NextCycleCandidate, "stable_key" | "anchor_fill_id" | "fill_ids">): NextCycleCandidate {
  return { fill_digest: `digest-${overrides.stable_key}`, allocation_digest: `allocation-${overrides.stable_key}`, ...overrides };
}

test("lineage retains the stable ID and increments revision when a late fill extends a cycle", () => {
  const result = reconcileCycleLineage(
    [previous({ id: "old-id", created_at: "2026-11-24T01:00:00Z", anchor_fill_id: "f1", fill_ids: ["f1", "f2"] })],
    [next({ stable_key: "extended", anchor_fill_id: "f1", fill_ids: ["f1", "f2", "f3"] })],
    () => "unused",
  );
  assert.deepEqual(result.assignments, [{ candidate_index: 0, id: "old-id", revision: 2, previous_ids: ["old-id"] }]);
  assert.deepEqual(result.aliases, []);
});

test("lineage keeps the old ID on the anchor-containing split and creates an ID for the other fragment", () => {
  const generated = ["new-fragment-id"];
  const result = reconcileCycleLineage(
    [previous({ id: "old-id", created_at: "2026-11-24T01:00:00Z", anchor_fill_id: "f1", fill_ids: ["f1", "f2", "f3", "f4"] })],
    [
      next({ stable_key: "left", anchor_fill_id: "f1", fill_ids: ["f1", "f2"] }),
      next({ stable_key: "right", anchor_fill_id: "f3", fill_ids: ["f3", "f4"] }),
    ],
    () => generated.shift() ?? "unexpected",
  );
  assert.deepEqual(result.assignments.map(({ id, revision }) => ({ id, revision })), [
    { id: "old-id", revision: 2 },
    { id: "new-fragment-id", revision: 1 },
  ]);
  assert.deepEqual(result.aliases, []);
});

test("lineage chooses the oldest ID on merge and flags two existing reviews without combining their text", () => {
  const result = reconcileCycleLineage(
    [
      previous({ id: "older", created_at: "2026-11-24T01:00:00Z", anchor_fill_id: "f1", fill_ids: ["f1", "f2"], has_review: true }),
      previous({ id: "newer", created_at: "2026-11-24T02:00:00Z", anchor_fill_id: "f3", fill_ids: ["f3", "f4"], has_review: true }),
    ],
    [next({ stable_key: "merged", anchor_fill_id: "f1", fill_ids: ["f1", "f2", "f3", "f4"] })],
    () => "unused",
  );
  assert.deepEqual(result.assignments, [{ candidate_index: 0, id: "older", revision: 2, previous_ids: ["older", "newer"] }]);
  assert.deepEqual(result.aliases, [{ alias_cycle_id: "newer", canonical_cycle_id: "older", relation: "merged", source_revision: 1 }]);
  assert.deepEqual(result.needs_reconciliation, [{ canonical_cycle_id: "older", review_cycle_ids: ["older", "newer"] }]);
});
