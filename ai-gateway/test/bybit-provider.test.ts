import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BybitTradingProviderAdapter } from "../src/trading/providers/bybit.ts";
import type { ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const now = Date.parse("2026-11-24T12:00:00.000Z");

function account(): ProviderAccount {
  return {
    connection_id: "33333333-3333-4333-8333-333333333333", external_account_id: "bybit-id", account_currency: "USDT",
    credentials: { api_key: "by-key", secret_key: "by-secret" },
    capabilities: {
      products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7, page_size: 100, pagination: "opaque",
      position_grouping: "hedge_zero_cycle", has_position_id: false, has_realized_pnl: true, has_fee_asset: true,
      has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true, account_currency: "USDT",
      settlement_assets: ["USDT"], valuation_pairs: ["USDT/USD"],
      candles: { availability: "unavailable", timeframes: [], maximum_page_size: null, maximum_range_seconds: null, price_bases: [], unavailable_reason: "implementation_pending" },
    },
  };
}

test("signs V5 GET queries and preserves independent execution and transaction cursors", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const list = url.pathname.includes("execution") ? [{ execId: "e1" }] : [{ id: "t1" }];
    return json({ retCode: 0, retMsg: "OK", result: { category: "linear", list, nextPageCursor: `${calls.length}-next` }, time: now });
  };
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", fetcher, () => now);
  const cursor = JSON.stringify({ execution_cursor: "e-old", transaction_cursor: "t-old", window_start: now - 86_400_000, window_end: now });
  const page = await adapter.fetchHistory(account(), { kind: "opaque", value: cursor });
  assert.deepEqual(calls.map((call) => call.url.pathname).sort(), ["/v5/account/transaction-log", "/v5/execution/list"]);
  for (const call of calls) {
    const query = call.url.searchParams.toString();
    assert.equal(call.headers.get("X-BAPI-API-KEY"), "by-key");
    assert.equal(call.headers.get("X-BAPI-TIMESTAMP"), String(now));
    assert.equal(call.headers.get("X-BAPI-RECV-WINDOW"), "5000");
    assert.equal(call.headers.get("X-BAPI-SIGN"), createHmac("sha256", "by-secret").update(`${now}by-key5000${query}`).digest("hex"));
    assert.equal(call.url.searchParams.get("category"), "linear");
    assert.equal(call.url.searchParams.get("currency") ?? call.url.searchParams.get("settleCoin"), "USDT");
  }
  assert.match(page.cursor.value ?? "", /execution_cursor/);
  assert.match(page.cursor.value ?? "", /transaction_cursor/);
});

test("validates read-only linear accounts and rejects write permissions and history older than 90 days", async () => {
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("query-api")) return json({ retCode: 0, result: { id: "member-1234", readOnly: 1, permissions: { ContractTrade: ["Position"] } } });
    return json({ retCode: 0, result: { list: [{ totalEquity: "100", totalWalletBalance: "90", totalPerpUPL: "10", coin: [{ coin: "USDT", equity: "100" }] }] } });
  };
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", fetcher, () => now);
  const validated = await adapter.validateCredentials({ provider: "bybit", credentials: account().credentials, read_only_ack: true });
  assert.equal(validated[0]?.external_account_id, "member-1234");
  assert.equal(validated[0]?.read_only_status, "verified");

  const unsafe: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("query-api")
    ? json({ retCode: 0, result: { id: "x", readOnly: 0, permissions: {} } })
    : json({ retCode: 0, result: { list: [] } });
  await assert.rejects(() => new BybitTradingProviderAdapter("https://api.bybit.com", unsafe).validateCredentials({ provider: "bybit", credentials: account().credentials, read_only_ack: true }), /trading_permission_not_allowed/);

  const old = now - 91 * 24 * 60 * 60 * 1_000;
  await assert.rejects(() => adapter.fetchHistory(account(), { kind: "opaque", value: JSON.stringify({ window_start: old, window_end: old + 1000 }) }), /history_range_exceeded/);
});

test("normalizes USDT linear one-way and hedge fills plus transaction cash classifications", () => {
  const adapter = new BybitTradingProviderAdapter();
  const page: ProviderHistoryPage = {
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: {
      connection_id: account().connection_id, exhausted: true,
      executions: [
        { category: "linear", symbol: "BTCUSDT", execId: "e1", orderId: "o1", side: "Buy", positionIdx: 0, execPrice: "100", execQty: "1", execPnl: "0", closedSize: "0", execFee: "0.1", feeCurrency: "USDT", isMaker: false, execTime: "1763985600100" },
        { category: "linear", symbol: "ETHUSDT", execId: "e2", orderId: "o2", side: "Sell", positionIdx: 1, execPrice: "200", execQty: "2", execPnl: "5", closedSize: "2", execFee: "0.2", feeCurrency: "USDT", isMaker: true, execTime: "1763985600200" },
        { category: "linear", symbol: "SOLUSDT", execId: "e3", orderId: "o3", side: "Sell", positionIdx: 2, execPrice: "50", execQty: "3", execPnl: "0", closedSize: "0", execFee: "-0.03", feeCurrency: "USDT", isMaker: true, execTime: "1763985600300" },
      ],
      transactions: [
        { id: "t1", category: "linear", symbol: "BTCUSDT", type: "TRANSFER_IN", cashFlow: "100", funding: "0", fee: "0", currency: "USDT", transactionTime: "1763985600400" },
        { id: "t2", category: "linear", symbol: "BTCUSDT", type: "SETTLEMENT", cashFlow: "0", funding: "-2", fee: "0", currency: "USDT", transactionTime: "1763985600500" },
        { id: "t3", category: "linear", symbol: "BTCUSDT", type: "FEE_REFUND", cashFlow: "1", funding: "0", fee: "0", currency: "USDT", transactionTime: "1763985600600" },
      ],
    },
  };
  const batch = adapter.normalizeHistory(page);
  assert.deepEqual(batch.fills.map((fill) => [fill.position_side, fill.action, fill.fee.amount]), [
    ["both", "open", "-0.1"], ["long", "close", "-0.2"], ["short", "open", "0.03"],
  ]);
  assert.deepEqual(batch.cash_events.map((event) => [event.type, event.amount]), [
    ["internal_transfer", "100"], ["funding", "-2"], ["commission_adjustment", "1"],
  ]);
});

test("maps permission/rate-limit failures safely and rejects unknown position enums", async () => {
  const limited: typeof fetch = async () => json({ retCode: 10006, retMsg: "Too many visits by-secret" }, 200);
  await assert.rejects(() => new BybitTradingProviderAdapter("https://api.bybit.com", limited).fetchAccountSnapshot(account()),
    (error: Error & { statusCode?: number }) => error.message === "bybit_rate_limited" && error.statusCode === 429 && !error.message.includes("secret"));
  assert.throws(() => new BybitTradingProviderAdapter().normalizeHistory({
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: { connection_id: account().connection_id, exhausted: true, executions: [{ category: "linear", symbol: "BTCUSDT", execId: "x", orderId: "x", side: "Buy", positionIdx: 9, execPrice: "1", execQty: "1", execPnl: "0", closedSize: "0", execFee: "0", feeCurrency: "USDT", execTime: "1763985600000" }], transactions: [] },
  }), /unknown_position_mode/);
});
