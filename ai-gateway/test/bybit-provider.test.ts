import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BybitTradingProviderAdapter } from "../src/trading/providers/bybit.ts";
import type { CandleRequest, ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

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
      candles: { availability: "unavailable", timeframes: [], maximum_page_size: null, maximum_range_seconds: null, price_modes: [], unavailable_reason: "implementation_pending" },
    },
  };
}

const minute = 60_000;
const candleStart = Date.UTC(2026, 10, 24, 8, 0, 0);

function candleRequest(overrides: Partial<CandleRequest> = {}): CandleRequest {
  return {
    product: "usdt_perpetual", native_symbol: "BTCUSDT", normalized_symbol: "BTCUSDT", timeframe: "1m",
    price_mode: "trade", from: new Date(candleStart).toISOString(), to: new Date(candleStart + 5 * minute).toISOString(), limit: 5,
    ...overrides,
  };
}

function bybitCandle(openTime: number, close = "101"): unknown[] {
  return [String(openTime), "100", "110", "99", close, "12.5", "1250"];
}

function bybitMarkCandle(openTime: number, close = "101"): unknown[] {
  return [String(openTime), "100", "110", "99", close];
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

test("advertises audited Bybit linear trade and mark candle capabilities", async () => {
  const discovered = await new BybitTradingProviderAdapter().discoverCapabilities(account());
  assert.deepEqual(discovered.candles, {
    availability: "available",
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M"],
    maximum_page_size: 1_000,
    maximum_range_seconds: 90 * 24 * 60 * 60,
    price_modes: ["trade", "mark"],
    unavailable_reason: null,
  });
});

test("rejects unsafe Bybit candle symbols before any upstream request", async () => {
  let calls = 0;
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", async () => { calls += 1; return json({ retCode: 0, result: { list: [] }, time: candleStart }); });
  await assert.rejects(() => adapter.fetchCandles(account(), candleRequest({ native_symbol: "BTCUSDT&secret=x" })), /bybit_invalid_candle_request/);
  assert.equal(calls, 0);
});

test("keeps the Bybit candle intersecting a live right boundary without inventing a historical gap", async () => {
  const liveTo = candleStart + minute + 30_000;
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", async () => json({
    retCode: 0,
    result: { list: [bybitCandle(candleStart + minute, "102"), bybitCandle(candleStart)] },
    time: liveTo,
  }), () => liveTo);
  const batch = await adapter.fetchCandles(account(), candleRequest({ to: new Date(liveTo).toISOString(), limit: 3 }));
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.status]), [
    [new Date(candleStart).toISOString(), "final"],
    [new Date(candleStart + minute).toISOString(), "partial"],
  ]);
  assert.equal(batch.coverage.status, "complete");
  assert.deepEqual(batch.coverage.gaps, []);
  assert.deepEqual(batch.warnings, []);
});

test("rejects numeric Bybit OHLCV fields before JavaScript can round them", async () => {
  const row = bybitCandle(candleStart);
  row[1] = 9_007_199_254_740_993;
  row[2] = "9007199254740994";
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", async () => json({ retCode: 0, result: { list: [row] }, time: candleStart + minute }), () => candleStart + minute);
  await assert.rejects(
    () => adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + minute).toISOString(), limit: 1 })),
    /bybit_invalid_candle_open/,
  );
});

test("bounds Bybit short and stalled pages with one request-scoped abort signal", async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", async (_input, init) => {
    calls += 1;
    signals.push(init?.signal as AbortSignal);
    return json({ retCode: 0, result: { list: [bybitCandle(candleStart + (10 - calls) * minute)] }, time: candleStart + 10 * minute });
  }, () => candleStart + 10 * minute);
  const partial = await adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 1_001 }));
  assert.equal(calls, 3);
  assert.equal(new Set(signals).size, 1);
  assert.equal(partial.coverage.status, "partial");
  assert.equal(partial.warnings.includes("provider_limit_reached"), true);
  assert.equal(partial.warnings.includes("historical_gap"), false);
  assert.deepEqual(partial.coverage.gaps, []);

  calls = 0;
  const stalled = await new BybitTradingProviderAdapter("https://api.bybit.com", async () => {
    calls += 1;
    return json({ retCode: 0, result: { list: [bybitCandle(candleStart + 9 * minute)] }, time: candleStart + 10 * minute });
  }, () => candleStart + 10 * minute).fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 1_001 }));
  assert.equal(calls, 2);
  assert.equal(stalled.coverage.status, "partial");
  assert.equal(stalled.warnings.includes("provider_limit_reached"), true);
  assert.equal(stalled.warnings.includes("historical_gap"), false);
});

test("returns structured Bybit time-limit coverage when the whole fetch deadline expires", async () => {
  let calls = 0;
  let clockCalls = 0;
  const clock = () => [candleStart + 10 * minute, candleStart + 10 * minute, candleStart + 10 * minute + 12_001][Math.min(clockCalls++, 2)]!;
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", async () => {
    calls += 1;
    return json({ retCode: 0, result: { list: [bybitCandle(candleStart + (10 - calls) * minute)] }, time: candleStart + 10 * minute });
  }, clock);
  const batch = await adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 1_001 }));
  assert.equal(calls, 1);
  assert.equal(batch.coverage.status, "partial");
  assert.equal(batch.warnings.includes("time_limit_reached"), true);
  assert.equal(batch.warnings.includes("historical_gap"), false);
});

test("loads reverse-sorted Bybit public pages without signatures and emits ascending partial candles plus gap evidence", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const list = calls.length === 1
      ? [bybitCandle(candleStart + 4 * minute, "105"), bybitCandle(candleStart + 3 * minute, "104")]
      : [bybitCandle(candleStart + 3 * minute, "104"), bybitCandle(candleStart + minute, "102"), bybitCandle(candleStart)];
    return json({ retCode: 0, retMsg: "OK", result: { category: "linear", symbol: "BTCUSDT", list }, time: candleStart + 4 * minute + 30_000 });
  };
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", fetcher, () => candleStart + 4 * minute + 30_000);
  const batch = await adapter.fetchCandles(account(), candleRequest());
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.pathname, "/v5/market/kline");
  assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), {
    category: "linear", symbol: "BTCUSDT", interval: "1", start: String(candleStart), end: String(candleStart + 5 * minute - 1), limit: "5",
  });
  assert.equal(calls[1]?.url.searchParams.get("end"), String(candleStart + 3 * minute - 1));
  assert.equal(calls.every(({ headers }) => headers.get("X-BAPI-API-KEY") === null && headers.get("X-BAPI-SIGN") === null), true);
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.status, candle.gap_before, candle.gap_after]), [
    [new Date(candleStart).toISOString(), "final", false, false],
    [new Date(candleStart + minute).toISOString(), "final", false, true],
    [new Date(candleStart + 3 * minute).toISOString(), "final", true, false],
    [new Date(candleStart + 4 * minute).toISOString(), "partial", false, false],
  ]);
  assert.deepEqual(batch.coverage.gaps, [{ series_basis: "trade", from: new Date(candleStart + 2 * minute).toISOString(), to: new Date(candleStart + 3 * minute).toISOString() }]);
  assert.deepEqual(batch.warnings, ["historical_gap"]);
});

test("maps Bybit mark price bars and bounds the upstream limit to 1000 and total output to 3000", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return json({ retCode: 0, result: { category: "linear", symbol: "BTCUSDT", list: urls.length === 1 ? [bybitMarkCandle(candleStart)] : [] }, time: candleStart + minute });
  };
  const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", fetcher, () => candleStart + minute);
  const batch = await adapter.fetchCandles(account(), candleRequest({ price_mode: "mark", timeframe: "1d", to: new Date(candleStart + 2 * 24 * 60 * minute).toISOString(), limit: 3_000 }));
  assert.equal(urls[0]?.pathname, "/v5/market/mark-price-kline");
  assert.equal(urls[0]?.searchParams.get("interval"), "D");
  assert.equal(urls[0]?.searchParams.get("limit"), "1000");
  assert.equal(batch.candles.length <= 3_000, true);
  assert.equal(batch.candles[0]?.series_basis, "mark");
  assert.equal(batch.candles[0]?.volume, null);
});

test("redacts Bybit candle auth, rate-limit, HTTP, and malformed upstream responses", async () => {
  const cases = [
    { status: 401, payload: { retCode: 10004, retMsg: "by-secret" }, message: "bybit_unauthorized", statusCode: 400 },
    { status: 200, payload: { retCode: 10006, retMsg: "by-secret" }, message: "bybit_rate_limited", statusCode: 429 },
    { status: 503, payload: { retCode: -1, retMsg: "by-secret" }, message: "bybit_unavailable", statusCode: 503 },
    { status: 200, payload: { retCode: 0, result: { list: { raw: "by-secret" } }, time: candleStart }, message: "bybit_invalid_candles", statusCode: 502 },
  ];
  for (const fixture of cases) {
    const adapter = new BybitTradingProviderAdapter("https://api.bybit.com", async () => json(fixture.payload, fixture.status));
    await assert.rejects(() => adapter.fetchCandles(account(), candleRequest()), (error: unknown) => {
      const safe = error as Error & { statusCode?: number };
      assert.equal(safe.message, fixture.message);
      assert.equal(safe.statusCode, fixture.statusCode);
      assert.equal(safe.message.includes("by-secret"), false);
      return true;
    });
  }
});
