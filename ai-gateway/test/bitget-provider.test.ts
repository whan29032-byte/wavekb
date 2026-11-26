import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BitgetTradingProviderAdapter } from "../src/trading/providers/bitget.ts";
import type { CandleRequest, ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const now = Date.parse("2026-11-24T12:00:00.000Z");

function account(): ProviderAccount {
  return {
    connection_id: "44444444-4444-4444-8444-444444444444", external_account_id: "bitget-id", account_currency: "USDT",
    credentials: { api_key: "bg-key", secret_key: "bg-secret", passphrase: "bg-pass" },
    capabilities: {
      products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 90, page_size: 100, pagination: "opaque",
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

function bitgetCandle(openTime: number, close = "101"): unknown[] {
  return [String(openTime), "100", "110", "99", close, "12.5", "1250"];
}

test("signs fixed Bitget GET paths and keeps independent fills and bills cursors", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return url.pathname.endsWith("fills")
      ? json({ code: "00000", data: { fillList: [{ tradeId: "f1" }], endId: "fill-next" }, msg: "success" })
      : json({ code: "00000", data: { bills: [{ id: "b1" }], endId: "bill-next" }, msg: "success" });
  };
  const adapter = new BitgetTradingProviderAdapter("https://api.bitget.com", fetcher, () => now);
  const page = await adapter.fetchHistory(account(), { kind: "opaque", value: JSON.stringify({ fills_before: "fill-old", bills_before: "bill-old", start: now - 1000, end: now }) });
  assert.deepEqual(calls.map((call) => call.url.pathname).sort(), ["/api/v2/mix/account/bill", "/api/v2/mix/order/fills"]);
  for (const call of calls) {
    assert.equal(call.headers.get("ACCESS-KEY"), "bg-key");
    assert.equal(call.headers.get("ACCESS-PASSPHRASE"), "bg-pass");
    assert.equal(call.headers.get("ACCESS-TIMESTAMP"), String(now));
    const requestPath = `${call.url.pathname}${call.url.search}`;
    assert.equal(call.headers.get("ACCESS-SIGN"), createHmac("sha256", "bg-secret").update(`${now}GET${requestPath}`).digest("base64"));
    assert.equal(call.url.searchParams.get("productType"), "USDT-FUTURES");
    assert.equal(call.url.searchParams.has("idLessThan"), true);
  }
  assert.match(page.cursor.value ?? "", /fill-next/);
  assert.match(page.cursor.value ?? "", /bill-next/);
});

test("validates USDT-FUTURES accounts by user attestation and enforces the 90-day cap", async () => {
  const fetcher: typeof fetch = async () => json({ code: "00000", data: [{ marginCoin: "USDT", accountEquity: "100", available: "90", unrealizedPL: "10", posMode: "hedge_mode" }], msg: "success" });
  const adapter = new BitgetTradingProviderAdapter("https://api.bitget.com", fetcher, () => now);
  const validated = await adapter.validateCredentials({ provider: "bitget", credentials: account().credentials, read_only_ack: true });
  assert.equal(validated[0]?.account_currency, "USDT");
  assert.equal(validated[0]?.read_only_status, "user_attested");
  const old = now - 91 * 24 * 60 * 60 * 1_000;
  await assert.rejects(() => adapter.fetchHistory(account(), { kind: "opaque", value: JSON.stringify({ start: old, end: old + 1000 }) }), /history_range_exceeded/);
});

test("normalizes one-way and hedge fills with signed fee/funding and rejects non-USDT rows", () => {
  const adapter = new BitgetTradingProviderAdapter();
  const page: ProviderHistoryPage = {
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: {
      connection_id: account().connection_id, exhausted: true,
      fills: [
        { productType: "USDT-FUTURES", tradeId: "f1", orderId: "o1", symbol: "BTCUSDT", price: "100", baseVolume: "1", side: "buy", tradeSide: "open", posMode: "one_way_mode", profit: "0", feeDetail: [{ feeCoin: "USDT", totalFee: "-0.1" }], tradeScope: "taker", cTime: "1763985600100" },
        { productType: "USDT-FUTURES", tradeId: "f2", orderId: "o2", symbol: "ETHUSDT", price: "200", baseVolume: "2", side: "sell", tradeSide: "close", posMode: "hedge_mode", holdSide: "long", profit: "5", feeDetail: [{ feeCoin: "USDT", totalFee: "-0.2" }], tradeScope: "maker", cTime: "1763985600200" },
        { productType: "COIN-FUTURES", tradeId: "skip", orderId: "skip", symbol: "BTCUSD", price: "1", baseVolume: "1", side: "buy", tradeSide: "open", posMode: "one_way_mode", profit: "0", feeDetail: [], cTime: "1763985600250" },
        { productType: "USDT-FUTURES", tradeId: "f3", orderId: "o3", symbol: "SOLUSDT", price: "50", baseVolume: "3", side: "sell", tradeSide: "open", posMode: "hedge_mode", holdSide: "short", profit: "0", feeDetail: [{ feeCoin: "USDT", totalFee: "0.03" }], tradeScope: "maker", cTime: "1763985600300" },
      ],
      bills: [
        { id: "b1", productType: "USDT-FUTURES", businessType: "trans_from_exchange", amount: "100", marginCoin: "USDT", symbol: "BTCUSDT", cTime: "1763985600400" },
        { id: "b2", productType: "USDT-FUTURES", businessType: "funding_fee", amount: "-2", marginCoin: "USDT", symbol: "BTCUSDT", cTime: "1763985600500" },
      ],
    },
  };
  const batch = adapter.normalizeHistory(page);
  assert.deepEqual(batch.fills.map((fill) => [fill.position_side, fill.action, fill.fee.amount]), [
    ["both", "open", "-0.1"], ["long", "close", "-0.2"], ["short", "open", "0.03"],
  ]);
  assert.deepEqual(batch.cash_events.map((event) => [event.type, event.amount]), [["internal_transfer", "100"], ["funding", "-2"]]);
});

test("projects rate limits safely and fails closed on unknown position modes", async () => {
  const limited: typeof fetch = async () => json({ code: "429", msg: "rate limited bg-secret" }, 429);
  await assert.rejects(() => new BitgetTradingProviderAdapter("https://api.bitget.com", limited).fetchAccountSnapshot(account()),
    (error: Error & { statusCode?: number }) => error.message === "bitget_rate_limited" && error.statusCode === 429 && !error.message.includes("secret"));
  assert.throws(() => new BitgetTradingProviderAdapter().normalizeHistory({
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: { connection_id: account().connection_id, exhausted: true, fills: [{ productType: "USDT-FUTURES", tradeId: "x", orderId: "x", symbol: "BTCUSDT", price: "1", baseVolume: "1", side: "buy", tradeSide: "open", posMode: "mystery", profit: "0", feeDetail: [], cTime: "1763985600000" }], bills: [] },
  }), /unknown_position_mode/);
});

test("advertises audited Bitget V3 historical trade and mark candle capabilities", async () => {
  const discovered = await new BitgetTradingProviderAdapter().discoverCapabilities(account());
  assert.deepEqual(discovered.candles, {
    availability: "available",
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "6h", "12h", "1d"],
    maximum_page_size: 100,
    maximum_range_seconds: 90 * 24 * 60 * 60,
    price_modes: ["trade", "mark"],
    unavailable_reason: null,
  });
});

test("rejects unsafe Bitget candle symbols before any upstream request", async () => {
  let calls = 0;
  const adapter = new BitgetTradingProviderAdapter("https://api.bitget.com", async () => { calls += 1; return json({ code: "00000", requestTime: candleStart, data: [] }); });
  await assert.rejects(() => adapter.fetchCandles(account(), candleRequest({ native_symbol: "BTCUSDT&secret=x" })), /bitget_invalid_candle_request/);
  assert.equal(calls, 0);
});

test("loads Bitget V3 public history pages without signatures and returns deduplicated ascending partial candles plus gaps", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const data = calls.length === 1
      ? [bitgetCandle(candleStart), bitgetCandle(candleStart + minute, "102")]
      : [bitgetCandle(candleStart + minute, "102"), bitgetCandle(candleStart + 3 * minute, "104"), bitgetCandle(candleStart + 4 * minute, "105")];
    return json({ code: "00000", msg: "success", requestTime: candleStart + 4 * minute + 30_000, data });
  };
  const adapter = new BitgetTradingProviderAdapter("https://api.bitget.com", fetcher, () => candleStart + 4 * minute + 30_000);
  const batch = await adapter.fetchCandles(account(), candleRequest());
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.pathname, "/api/v3/market/history-candles");
  assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), {
    category: "USDT-FUTURES", symbol: "BTCUSDT", interval: "1m", startTime: String(candleStart - 1),
    endTime: String(candleStart + 5 * minute), type: "market", limit: "5",
  });
  assert.equal(calls[1]?.url.searchParams.get("startTime"), String(candleStart + minute));
  assert.equal(calls.every(({ headers }) => headers.get("ACCESS-KEY") === null && headers.get("ACCESS-SIGN") === null), true);
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.status, candle.gap_before, candle.gap_after]), [
    [new Date(candleStart).toISOString(), "final", false, false],
    [new Date(candleStart + minute).toISOString(), "final", false, true],
    [new Date(candleStart + 3 * minute).toISOString(), "final", true, false],
    [new Date(candleStart + 4 * minute).toISOString(), "partial", false, false],
  ]);
  assert.deepEqual(batch.coverage.gaps, [{ series_basis: "trade", from: new Date(candleStart + 2 * minute).toISOString(), to: new Date(candleStart + 3 * minute).toISOString() }]);
  assert.deepEqual(batch.warnings, ["historical_gap"]);
});

test("maps Bitget mark bars and bounds the V3 upstream page to 100 and total output to 3000", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return json({ code: "00000", requestTime: candleStart + minute, data: urls.length === 1 ? [bitgetCandle(candleStart)] : [] });
  };
  const adapter = new BitgetTradingProviderAdapter("https://api.bitget.com", fetcher, () => candleStart + minute);
  const batch = await adapter.fetchCandles(account(), candleRequest({ price_mode: "mark", timeframe: "1d", to: new Date(candleStart + 2 * 24 * 60 * minute).toISOString(), limit: 3_000 }));
  assert.equal(urls[0]?.searchParams.get("interval"), "1D");
  assert.equal(urls[0]?.searchParams.get("type"), "mark");
  assert.equal(urls[0]?.searchParams.get("limit"), "100");
  assert.equal(batch.candles.length <= 3_000, true);
  assert.equal(batch.candles[0]?.series_basis, "mark");
  assert.equal(batch.candles[0]?.volume, null);
});

test("redacts Bitget candle auth, rate-limit, HTTP, and malformed upstream responses", async () => {
  const cases = [
    { status: 401, payload: { code: "40014", msg: "bg-secret bg-pass" }, message: "bitget_invalid_signature", statusCode: 400 },
    { status: 429, payload: { code: "429", msg: "bg-secret bg-pass" }, message: "bitget_rate_limited", statusCode: 429 },
    { status: 503, payload: { code: "50000", msg: "bg-secret bg-pass" }, message: "bitget_unavailable", statusCode: 503 },
    { status: 200, payload: { code: "00000", requestTime: candleStart, data: { raw: "bg-secret bg-pass" } }, message: "bitget_invalid_candles", statusCode: 502 },
  ];
  for (const fixture of cases) {
    const adapter = new BitgetTradingProviderAdapter("https://api.bitget.com", async () => json(fixture.payload, fixture.status));
    await assert.rejects(() => adapter.fetchCandles(account(), candleRequest()), (error: unknown) => {
      const safe = error as Error & { statusCode?: number };
      assert.equal(safe.message, fixture.message);
      assert.equal(safe.statusCode, fixture.statusCode);
      assert.equal(/bg-secret|bg-pass/.test(safe.message), false);
      return true;
    });
  }
});
