import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalAccountSnapshot, CanonicalCashEvent } from "../src/trading/providers/contracts.ts";
import {
  buildPortfolioSeries,
  calculateTradingMetrics,
  matchInternalTransfers,
  valueAmount,
  type AccountingCycle,
  type ValuationQuote,
} from "../src/trading/accounting.ts";

const at = "2026-11-24T12:00:00Z";

function quote(overrides: Partial<ValuationQuote> & Pick<ValuationQuote, "base_asset" | "quote_asset" | "rate">): ValuationQuote {
  return { source: "provider-market", quoted_at: at, ...overrides };
}

test("valuation pins USD, labels USDT approximation, and supports direct, inverse, and unique one-hop paths", () => {
  assert.deepEqual(valueAmount({ amount: "12.5", asset: "USD", at }, []), {
    amount: "12.5", asset: "USD", usd_value: "12.5", rate: "1", status: "direct", source: "USD", path: ["USD"], quoted_at: at, reason: null,
  });
  assert.equal(valueAmount({ amount: "10", asset: "USDT", at }, []).status, "approximate");
  assert.equal(valueAmount({ amount: "10", asset: "USDT", at }, []).usd_value, "10");

  const direct = valueAmount({ amount: "10", asset: "EUR", at }, [quote({ base_asset: "EUR", quote_asset: "USD", rate: "1.1" })]);
  assert.equal(direct.usd_value, "11");
  assert.equal(direct.status, "direct");

  const inverse = valueAmount({ amount: "300", asset: "JPY", at }, [quote({ base_asset: "USD", quote_asset: "JPY", rate: "150" })]);
  assert.equal(inverse.usd_value, "2");
  assert.deepEqual(inverse.path, ["JPY", "USD"]);

  const triangular = valueAmount({ amount: "2", asset: "ETH", at }, [
    quote({ base_asset: "ETH", quote_asset: "BTC", rate: "0.05" }),
    quote({ base_asset: "BTC", quote_asset: "USD", rate: "60000" }),
  ]);
  assert.equal(triangular.usd_value, "6000");
  assert.equal(triangular.status, "triangulated");
  assert.deepEqual(triangular.path, ["ETH", "BTC", "USD"]);

  const stablecoinHop = valueAmount({ amount: "2", asset: "ETH", at }, [
    quote({ base_asset: "ETH", quote_asset: "USDT", rate: "3000" }),
  ]);
  assert.equal(stablecoinHop.usd_value, "6000");
  assert.equal(stablecoinHop.status, "triangulated");
  assert.equal(stablecoinHop.source, "provider-market + USDT approximate");
});

test("valuation excludes stale quotes and ambiguous one-hop routes instead of coercing them to zero", () => {
  const stale = valueAmount({ amount: "1", asset: "EUR", at }, [
    quote({ base_asset: "EUR", quote_asset: "USD", rate: "1.1", quoted_at: "2026-11-24T11:24:59Z" }),
  ]);
  assert.equal(stale.status, "unavailable");
  assert.equal(stale.usd_value, null);
  assert.equal(stale.reason, "stale_quote");

  const ambiguous = valueAmount({ amount: "1", asset: "ETH", at }, [
    quote({ base_asset: "ETH", quote_asset: "BTC", rate: "0.05" }),
    quote({ base_asset: "BTC", quote_asset: "USD", rate: "60000" }),
    quote({ base_asset: "ETH", quote_asset: "EUR", rate: "3000" }),
    quote({ base_asset: "EUR", quote_asset: "USD", rate: "1.1" }),
  ]);
  assert.equal(ambiguous.status, "unavailable");
  assert.equal(ambiguous.reason, "ambiguous_path");
});

function event(overrides: Partial<CanonicalCashEvent> & Pick<CanonicalCashEvent, "connection_id" | "native_event_id" | "occurred_at" | "amount">): CanonicalCashEvent {
  return {
    provider: "binance", native_type: "TRANSFER", type: "internal_transfer", asset: "USDT", usd_value: overrides.amount,
    symbol: null, native_position_id: null, ...overrides,
  };
}

test("internal transfers pair only equal opposite amounts across different selected connections", () => {
  const result = matchInternalTransfers([
    event({ connection_id: "a", native_event_id: "a-out", occurred_at: "2026-11-24T01:00:00Z", amount: "-100" }),
    event({ connection_id: "b", native_event_id: "b-in", occurred_at: "2026-11-24T01:02:00Z", amount: "100" }),
    event({ connection_id: "a", native_event_id: "unpaired", occurred_at: "2026-11-24T02:00:00Z", amount: "-25" }),
  ]);
  assert.deepEqual(result.matches, [{ outgoing_event_id: "a-out", incoming_event_id: "b-in", asset: "USDT", amount: "100" }]);
  assert.deepEqual(result.unpaired_event_ids, ["unpaired"]);
});

function snapshot(connectionId: string, capturedAt: string, equity: string): CanonicalAccountSnapshot {
  return {
    provider: "binance", connection_id: connectionId, captured_at: capturedAt, account_currency: "USDT",
    equity, wallet_balance: equity, unrealized_pnl: "0", usd_equity: equity, usd_wallet_balance: equity,
    usd_unrealized_pnl: "0", valuation: { status: "approximate", rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: capturedAt },
  };
}

test("portfolio accounting uses 15-minute UTC buckets, removes external cash flow, and compounds TWR", () => {
  const series = buildPortfolioSeries(
    [
      snapshot("a", "2026-11-24T00:00:00Z", "100"), snapshot("b", "2026-11-24T00:00:00Z", "200"),
      snapshot("a", "2026-11-24T00:15:00Z", "110"), snapshot("b", "2026-11-24T00:15:00Z", "220"),
      snapshot("a", "2026-11-24T00:30:00Z", "120"), snapshot("b", "2026-11-24T00:30:00Z", "230"),
    ],
    [event({ connection_id: "a", native_event_id: "deposit", occurred_at: "2026-11-24T00:10:00Z", amount: "10", type: "deposit", native_type: "DEPOSIT" })],
    { connection_ids: ["a", "b"], from: "2026-11-24T00:00:00Z", to: "2026-11-24T00:30:00Z", timezone: "Asia/Shanghai" },
  );
  assert.deepEqual(series.points.map((point) => point.at), [
    "2026-11-24T00:00:00.000Z", "2026-11-24T00:15:00.000Z", "2026-11-24T00:30:00.000Z",
  ]);
  assert.deepEqual(series.points.map((point) => point.equity_usd), ["300", "330", "350"]);
  assert.equal(series.points[1]?.period_return, "0.066666666666666666");
  assert.equal(series.points[2]?.period_return, "0.060606060606060606");
  assert.equal(series.cumulative_profit_usd, "40");
  assert.equal(series.time_weighted_return, "0.131313131313131313");
  assert.equal(series.is_complete, true);
});

test("portfolio series marks 35-minute gaps and never calculates a return across the gap", () => {
  const series = buildPortfolioSeries(
    [snapshot("a", "2026-11-24T00:00:00Z", "100"), snapshot("a", "2026-11-24T01:00:00Z", "120")],
    [],
    { connection_ids: ["a"], from: "2026-11-24T00:00:00Z", to: "2026-11-24T01:00:00Z", timezone: "UTC" },
  );
  assert.deepEqual(series.points.map((point) => point.equity_usd), ["100", "100", "100", null, "120"]);
  assert.equal(series.points[3]?.period_return, null);
  assert.equal(series.points[4]?.period_return, null);
  assert.equal(series.is_complete, false);
  assert.ok(series.incomplete_reasons.includes("stale_snapshot_gap"));
});

test("UTC bucket boundaries remain stable across midnight and a daylight-saving transition", () => {
  const midnight = buildPortfolioSeries(
    [snapshot("a", "2026-11-23T23:45:00Z", "100"), snapshot("a", "2026-11-24T00:15:00Z", "101")], [],
    { connection_ids: ["a"], from: "2026-11-23T23:45:00Z", to: "2026-11-24T00:15:00Z", timezone: "Asia/Shanghai" },
  );
  assert.deepEqual(midnight.points.map((point) => point.at), ["2026-11-23T23:45:00.000Z", "2026-11-24T00:00:00.000Z", "2026-11-24T00:15:00.000Z"]);

  const dst = buildPortfolioSeries(
    [snapshot("a", "2026-11-01T05:45:00Z", "100"), snapshot("a", "2026-11-01T06:15:00Z", "101")], [],
    { connection_ids: ["a"], from: "2026-11-01T05:45:00Z", to: "2026-11-01T06:15:00Z", timezone: "America/New_York" },
  );
  assert.deepEqual(dst.points.map((point) => point.at), ["2026-11-01T05:45:00.000Z", "2026-11-01T06:00:00.000Z", "2026-11-01T06:15:00.000Z"]);
});

function cycle(net: string | null, completeness: AccountingCycle["completeness"] = "complete"): AccountingCycle {
  return { closed_at: completeness === "open" ? null : at, completeness, net_pnl: net ?? "25", usd_net_pnl: net };
}

test("metrics use only complete valued cycles for money and closed cycles for win statistics", () => {
  const series = buildPortfolioSeries(
    [
      snapshot("a", "2026-11-24T00:00:00Z", "100"), snapshot("a", "2026-11-24T00:15:00Z", "120"),
      snapshot("a", "2026-11-24T00:30:00Z", "90"), snapshot("a", "2026-11-24T00:45:00Z", "135"),
    ], [],
    { connection_ids: ["a", "missing"], from: "2026-11-24T00:00:00Z", to: "2026-11-24T00:45:00Z", timezone: "UTC" },
  );
  const metrics = calculateTradingMetrics([cycle("100"), cycle("-50"), cycle("0"), cycle("999", "open"), cycle(null)], series);
  assert.equal(metrics.current_equity_usd, "135");
  assert.equal(metrics.cumulative_profit_usd, "35");
  assert.equal(metrics.maximum_drawdown, "0.25");
  assert.equal(metrics.realized_net_pnl_usd, "50");
  assert.equal(metrics.closed_trade_count, 4);
  assert.equal(metrics.win_rate, "0.5");
  assert.equal(metrics.average_win_loss_ratio, "2");
  assert.equal(metrics.profit_factor, "2");
  assert.equal(metrics.included_connection_count, 1);
  assert.equal(metrics.excluded_connection_count, 1);
  assert.equal(metrics.is_complete, false);
  assert.ok(metrics.incomplete_reasons.includes("unvalued_closed_cycle"));
});
