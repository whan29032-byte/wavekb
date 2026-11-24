import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";
import {
  TradingWorkbenchService,
  type TradingWorkbenchStore,
  type WorkbenchConnectionRecord,
  type WorkbenchFacts,
  type WorkbenchReviewRecord,
  type WorkbenchTradeBundle,
} from "../src/trading/workbench-service.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-11-24T12:00:00.000Z");

const connections: WorkbenchConnectionRecord[] = [
  { id: "c-binance", owner_id: owner, provider: "binance", account_label: "合约主账户", account_identifier_mask: "••••1001", account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified", status: "active", public_enabled: false, history_coverage_started_at: "2026-10-01T00:00:00.000Z", equity_tracking_started_at: "2026-10-01T00:00:00.000Z", last_synced_at: "2026-11-24T11:55:00.000Z", last_error_code: "", consecutive_failures: 0, sync_generation: 4 },
  { id: "c-exness", owner_id: owner, provider: "exness", account_label: "黄金账户", account_identifier_mask: "••••2002", account_currency: "USD", products: ["cfd"], read_only_status: "verified", status: "active", public_enabled: false, history_coverage_started_at: "2026-11-01T00:00:00.000Z", equity_tracking_started_at: "2026-11-01T00:00:00.000Z", last_synced_at: "2026-11-24T11:58:00.000Z", last_error_code: "", consecutive_failures: 0, sync_generation: 8 },
];

const facts: WorkbenchFacts = {
  snapshots: [
    { connection_id: "c-binance", provider: "binance", captured_at: "2026-11-24T11:45:00.000Z", account_currency: "USDT", equity: "1000", wallet_balance: "1000", unrealized_pnl: "0", usd_equity: "1000", usd_wallet_balance: "1000", usd_unrealized_pnl: "0", valuation: { status: "approximate", rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: "2026-11-24T11:45:00.000Z" }, generation: 4 },
    { connection_id: "c-binance", provider: "binance", captured_at: "2026-11-24T12:00:00.000Z", account_currency: "USDT", equity: "1100", wallet_balance: "1100", unrealized_pnl: "0", usd_equity: "1100", usd_wallet_balance: "1100", usd_unrealized_pnl: "0", valuation: { status: "approximate", rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: "2026-11-24T12:00:00.000Z" }, generation: 4 },
    { connection_id: "c-exness", provider: "exness", captured_at: "2026-11-24T11:45:00.000Z", account_currency: "USD", equity: "2000", wallet_balance: "2000", unrealized_pnl: "0", usd_equity: "2000", usd_wallet_balance: "2000", usd_unrealized_pnl: "0", valuation: { status: "direct", rate: "1", source: "USD", path: ["USD"], quoted_at: "2026-11-24T11:45:00.000Z" }, generation: 8 },
    { connection_id: "c-exness", provider: "exness", captured_at: "2026-11-24T12:00:00.000Z", account_currency: "USD", equity: "1980", wallet_balance: "1980", unrealized_pnl: "0", usd_equity: "1980", usd_wallet_balance: "1980", usd_unrealized_pnl: "0", valuation: { status: "direct", rate: "1", source: "USD", path: ["USD"], quoted_at: "2026-11-24T12:00:00.000Z" }, generation: 8 },
    { connection_id: "c-binance", provider: "binance", captured_at: "2026-11-24T12:00:00.000Z", account_currency: "USDT", equity: "999999", wallet_balance: "999999", unrealized_pnl: "0", usd_equity: "999999", usd_wallet_balance: "999999", usd_unrealized_pnl: "0", valuation: { status: "approximate", rate: "1", source: "stale generation", path: ["USDT", "USD"], quoted_at: "2026-11-24T12:00:00.000Z" }, generation: 3 },
  ],
  cash_events: [],
  cycles: [
    { id: "t-binance", connection_id: "c-binance", provider: "binance", revision: 2, product: "usdt_perpetual", symbol: "BTCUSDT", direction: "long", native_position_id: null, opened_at: "2026-11-23T18:00:00.000Z", closed_at: "2026-11-23T20:00:00.000Z", entry_price: "90000", exit_price: "90120", quantity: "0.1", realized_pnl: "12", fees: "-1", funding_or_swap: "-0.5", dividends: "0", net_pnl: "10.5", account_currency: "USDT", usd_net_pnl: "10.5", valuation_status: "approximate", completeness: "complete", generation: 4, is_current: true },
    { id: "t-exness", connection_id: "c-exness", provider: "exness", revision: 1, product: "cfd", symbol: "XAUUSD", direction: "short", native_position_id: "position-77", opened_at: "2026-11-23T16:30:00.000Z", closed_at: "2026-11-23T17:30:00.000Z", entry_price: "2400", exit_price: "2410", quantity: "1", realized_pnl: "-10", fees: "-1", funding_or_swap: "-2", dividends: "0", net_pnl: "-13", account_currency: "USD", usd_net_pnl: "-13", valuation_status: "direct", completeness: "complete", generation: 8, is_current: true },
    { id: "stale-cycle", connection_id: "c-exness", provider: "exness", revision: 1, product: "cfd", symbol: "SHOULD_NOT_APPEAR", direction: "long", native_position_id: "old", opened_at: "2026-11-23T00:00:00.000Z", closed_at: "2026-11-23T01:00:00.000Z", entry_price: "1", exit_price: "2", quantity: "1", realized_pnl: "1", fees: "0", funding_or_swap: "0", dividends: "0", net_pnl: "1", account_currency: "USD", usd_net_pnl: "1", valuation_status: "direct", completeness: "complete", generation: 7, is_current: true },
  ],
  reviews: [{ cycle_id: "t-binance", cycle_revision: 2, reason: "突破", plan_compliance: "yes", next_improvement: "等待确认", tags: [], planned_stop_price: "89000", planned_risk_amount: "100", needs_reconciliation: false }],
};

class Store implements TradingWorkbenchStore {
  saved: unknown = null;
  async listConnections(ownerId: string) { return ownerId === owner ? connections : []; }
  async loadFacts() { return facts; }
  async getTrade(ownerId: string, id: string): Promise<WorkbenchTradeBundle | null> {
    const cycle = facts.cycles.find((item) => item.id === id);
    const connection = connections.find((item) => item.id === cycle?.connection_id);
    if (ownerId !== owner || !cycle || !connection) return null;
    return { cycle, connection, review: facts.reviews.find((item) => item.cycle_id === id) ?? null, conflicting_reviews: [] };
  }
  async saveReview(input: WorkbenchReviewRecord & { owner_id: string }): Promise<WorkbenchReviewRecord> { this.saved = input; return input; }
}

test("combines only published generations and filters every metric, attribution, calendar, and trade list", async () => {
  const service = new TradingWorkbenchService({ store: new Store(), now: () => now });
  const all = await service.getDashboard(owner, { range: "30d", timezone: "Asia/Shanghai" });
  assert.equal(all.connections.length, 2);
  assert.equal(all.headline_metrics.length, 6);
  assert.equal(all.metrics.current_equity_usd, "3080");
  assert.equal(all.metrics.closed_trade_count, 2);
  assert.deepEqual(all.trades.map((item) => item.symbol), ["BTCUSDT", "XAUUSD"]);
  assert.equal(JSON.stringify(all).includes("SHOULD_NOT_APPEAR"), false);
  assert.deepEqual(all.calendar.map((item) => item.local_date), ["2026-11-24"]);

  const exness = await service.getDashboard(owner, { range: "30d", providers: "exness", timezone: "Asia/Shanghai" });
  assert.equal(exness.metrics.current_equity_usd, "1980");
  assert.equal(exness.metrics.closed_trade_count, 1);
  assert.deepEqual(exness.trades.map((item) => item.id), ["t-exness"]);
  assert.deepEqual(exness.attributions.provider.map((item) => item.key), ["exness"]);

  const account = await service.getDashboard(owner, { range: "30d", connection_ids: "c-binance", timezone: "America/New_York" });
  assert.equal(account.metrics.current_equity_usd, "1100");
  assert.deepEqual(account.calendar.map((item) => item.local_date), ["2026-11-23"]);
});

test("returns an explicit empty dashboard and partial valuation coverage instead of invented values", async () => {
  const empty = new TradingWorkbenchService({ store: new Store(), now: () => now });
  const none = await empty.getDashboard("22222222-2222-4222-8222-222222222222", { range: "7d", timezone: "Invalid/Zone" });
  assert.equal(none.connections.length, 0);
  assert.equal(none.metrics.current_equity_usd, null);
  assert.equal(none.timezone, "Asia/Shanghai");
  assert.equal(none.status.kind, "no_connections");
});

test("serves provider-specific safe facts and saves only the narrow review fields at the expected revision", async () => {
  const store = new Store();
  const service = new TradingWorkbenchService({ store, now: () => now });
  const exness = await service.getTrade(owner, "t-exness", "Asia/Shanghai");
  assert.equal(exness.trade.native_position_id, "position-77");
  assert.equal(exness.provider_facts.swap, "-2");
  assert.equal("raw_payload" in exness, false);
  const saved = await service.saveReview(owner, "t-exness", { expected_cycle_revision: 1, reason: "计划内反转", plan_compliance: "partial", next_improvement: "等待收盘确认", tags: ["黄金"], planned_stop_price: "2420", planned_risk_amount: "50", ignored: "not saved" });
  assert.equal(saved.cycle_revision, 1);
  assert.deepEqual(Object.keys(store.saved as object).sort(), ["cycle_id", "cycle_revision", "needs_reconciliation", "next_improvement", "owner_id", "plan_compliance", "planned_risk_amount", "planned_stop_price", "reason", "tags"]);
});

test("wires authenticated dashboard, trade detail and PUT review routes", async () => {
  const service = new TradingWorkbenchService({ store: new Store(), now: () => now });
  const api = { authorize: async () => ({ id: owner, role: "member" }) } as any;
  const server = buildServer({ config: loadConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test-only-long", SUPABASE_PUBLISHABLE_KEY: "publishable-test-only-long", AI_SECRET_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"), AUTH_SITE_URL: "https://wavekb.example" }), api, tradingWorkbench: service });
  const dashboard = await server.inject({ method: "GET", url: "/v1/user/trading-workbench?range=30d&timezone=Asia%2FShanghai", headers: { authorization: "Bearer valid" } });
  assert.equal(dashboard.statusCode, 200);
  const detail = await server.inject({ method: "GET", url: "/v1/user/trading-trades/t-exness", headers: { authorization: "Bearer valid" } });
  assert.equal(detail.statusCode, 200);
  const saved = await server.inject({ method: "PUT", url: "/v1/user/trading-trades/t-exness/review", headers: { authorization: "Bearer valid" }, payload: { expected_cycle_revision: 1, reason: "理由", plan_compliance: "yes", next_improvement: "改进", tags: [], planned_stop_price: null, planned_risk_amount: null } });
  assert.equal(saved.statusCode, 200);
  const stale = await server.inject({ method: "PUT", url: "/v1/user/trading-trades/t-exness/review", headers: { authorization: "Bearer valid" }, payload: { expected_cycle_revision: 99, reason: "理由", plan_compliance: "yes", next_improvement: "改进", tags: [], planned_stop_price: null, planned_risk_amount: null } });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.json(), { error: "stale_trade_cycle_revision" });
});
