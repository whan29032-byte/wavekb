import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { OkxTradingProviderAdapter } from "../src/trading/providers/okx.ts";
import type { CandleRequest, ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const now = Date.parse("2026-11-24T12:00:00.000Z");

function account(): ProviderAccount {
  return {
    connection_id: "22222222-2222-4222-8222-222222222222", external_account_id: "okx-uid", account_currency: "USDT",
    credentials: { api_key: "ok-key", secret_key: "ok-secret", passphrase: "ok-pass" },
    capabilities: {
      products: ["usdt_perpetual", "usdt_delivery"], history_age_days: 90, history_range_days: 90, page_size: 100,
      pagination: "opaque", position_grouping: "hedge_zero_cycle", has_position_id: false, has_realized_pnl: true,
      has_fee_asset: true, has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true,
      account_currency: "USDT", settlement_assets: ["USDT"], valuation_pairs: ["USDT/USD"],
      candles: { availability: "unavailable", timeframes: [], maximum_page_size: null, maximum_range_seconds: null, price_modes: [], unavailable_reason: "implementation_pending" },
    },
  };
}

const minute = 60_000;
const candleStart = Date.UTC(2026, 10, 24, 8, 0, 0);

function candleRequest(overrides: Partial<CandleRequest> = {}): CandleRequest {
  return {
    product: "usdt_perpetual", native_symbol: "BTC-USDT-SWAP", normalized_symbol: "BTCUSDT",
    timeframe: "1m", price_mode: "trade", from: new Date(candleStart).toISOString(),
    to: new Date(candleStart + 5 * minute).toISOString(), limit: 5, ...overrides,
  };
}

function okxCandle(openTime: number, close = "101", confirm = "1"): unknown[] {
  return [String(openTime), "100", "110", "99", close, "12.5", "1250", "1250", confirm];
}

function okxMarkCandle(openTime: number, close = "101", confirm = "1"): unknown[] {
  return [String(openTime), "100", "110", "99", close, confirm];
}

test("signs only official GET paths with OKX headers and preserves opaque pagination", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return json({ code: "0", data: url.pathname.includes("fills")
      ? [{ instType: url.searchParams.get("instType"), tradeId: `${calls.length}`, fillTime: String(now - calls.length) }]
      : [{ billId: "bill-1", ts: String(now - 3) }] });
  };
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", fetcher, () => now);
  const page = await adapter.fetchHistory(account(), { kind: "opaque", value: JSON.stringify({ fills_after: "old-fill", bills_after: "old-bill" }) });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.url.pathname).sort(), [
    "/api/v5/account/bills-archive", "/api/v5/trade/fills-history", "/api/v5/trade/fills-history",
  ]);
  for (const call of calls) {
    assert.equal(call.headers.get("OK-ACCESS-KEY"), "ok-key");
    assert.equal(call.headers.get("OK-ACCESS-PASSPHRASE"), "ok-pass");
    assert.equal(call.headers.get("OK-ACCESS-TIMESTAMP"), "2026-11-24T12:00:00.000Z");
    const path = `${call.url.pathname}${call.url.search}`;
    const expected = createHmac("sha256", "ok-secret").update(`2026-11-24T12:00:00.000ZGET${path}`).digest("base64");
    assert.equal(call.headers.get("OK-ACCESS-SIGN"), expected);
    assert.equal(call.url.searchParams.has("after"), true);
  }
  assert.equal(page.cursor.kind, "opaque");
  assert.match(page.cursor.value ?? "", /fills_after/);
});

test("validates read-only USDT accounts and fails closed on trading permission or unknown position mode", async () => {
  const safeFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("config")
    ? json({ code: "0", data: [{ uid: "12345678", posMode: "long_short_mode", perm: "read_only" }] })
    : json({ code: "0", data: [{ totalEq: "100", details: [{ ccy: "USDT", eq: "100", cashBal: "90", upl: "10" }] }] });
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", safeFetcher, () => now);
  const accounts = await adapter.validateCredentials({ provider: "okx", credentials: account().credentials, read_only_ack: true });
  assert.equal(accounts[0]?.external_account_id, "12345678");
  assert.equal(accounts[0]?.read_only_status, "verified");

  const unsafeFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("config")
    ? json({ code: "0", data: [{ uid: "1", posMode: "net_mode", perm: "read_only,trade" }] })
    : json({ code: "0", data: [] });
  await assert.rejects(() => new OkxTradingProviderAdapter("https://www.okx.com", unsafeFetcher).validateCredentials({ provider: "okx", credentials: account().credentials, read_only_ack: true }), /trading_permission_not_allowed/);

  const unknownFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("config")
    ? json({ code: "0", data: [{ uid: "1", posMode: "future_mode", perm: "read_only" }] })
    : json({ code: "0", data: [] });
  await assert.rejects(() => new OkxTradingProviderAdapter("https://www.okx.com", unknownFetcher).validateCredentials({ provider: "okx", credentials: account().credentials, read_only_ack: true }), /unknown_position_mode/);
});

test("normalizes SWAP/FUTURES fills, net/long/short sides, signed fees, funding, and timestamp order", () => {
  const adapter = new OkxTradingProviderAdapter();
  const page: ProviderHistoryPage = {
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: {
      connection_id: account().connection_id, exhausted: true,
      fills: [
        { instType: "FUTURES", instId: "ETH-USDT-261225", tradeId: "2", ordId: "12", side: "sell", posSide: "long", fillPx: "2000", fillSz: "2", fillPnl: "10", fee: "-0.2", feeCcy: "USDT", execType: "M", fillTime: "1763985600200" },
        { instType: "SWAP", instId: "BTC-USDT-SWAP", tradeId: "1", ordId: "11", side: "buy", posSide: "net", fillPx: "100000", fillSz: "1", fillPnl: "0", fee: "-0.1", feeCcy: "USDT", execType: "T", fillTime: "1763985600100" },
        { instType: "SWAP", instId: "SOL-USDT-SWAP", tradeId: "3", ordId: "13", side: "sell", posSide: "short", fillPx: "100", fillSz: "3", fillPnl: "0", fee: "0.03", feeCcy: "USDT", execType: "M", fillTime: "1763985600300" },
      ],
      bills: [
        { instType: "SWAP", instId: "BTC-USDT-SWAP", billId: "b2", type: "8", subType: "173", balChg: "-2", ccy: "USDT", ts: "1763985600500" },
        { instType: "SWAP", instId: "BTC-USDT-SWAP", billId: "b1", type: "1", subType: "12", balChg: "100", ccy: "USDT", ts: "1763985600400" },
      ],
    },
  };
  const batch = adapter.normalizeHistory(page);
  assert.deepEqual(batch.fills.map((fill) => [fill.product, fill.position_side, fill.action, fill.fee.amount, fill.liquidity]), [
    ["usdt_perpetual", "both", "open", "-0.1", "taker"],
    ["usdt_delivery", "long", "close", "-0.2", "maker"],
    ["usdt_perpetual", "short", "open", "0.03", "maker"],
  ]);
  assert.deepEqual(batch.cash_events.map((event) => [event.type, event.amount]), [["internal_transfer", "100"], ["funding", "-2"]]);
});

test("projects OKX rate limits safely and rejects unknown fill enums", async () => {
  const limited: typeof fetch = async () => json({ code: "50011", msg: "Rate limit; secret=ok-secret" }, 429);
  await assert.rejects(
    () => new OkxTradingProviderAdapter("https://www.okx.com", limited).fetchAccountSnapshot(account()),
    (error: Error & { statusCode?: number }) => error.message === "okx_rate_limited" && error.statusCode === 429 && !error.message.includes("secret"),
  );
  const adapter = new OkxTradingProviderAdapter();
  assert.throws(() => adapter.normalizeHistory({
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: { connection_id: account().connection_id, fills: [{ instType: "SWAP", instId: "BTC-USDT-SWAP", tradeId: "x", ordId: "x", side: "buy", posSide: "mystery", fillPx: "1", fillSz: "1", fillPnl: "0", fee: "0", feeCcy: "USDT", fillTime: "1763985600000" }], bills: [], exhausted: true },
  }), /unknown_position_mode/);
});

test("advertises audited OKX historical trade and mark candle capabilities", async () => {
  const discovered = await new OkxTradingProviderAdapter().discoverCapabilities(account());
  assert.deepEqual(discovered.candles, {
    availability: "available",
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M"],
    maximum_page_size: 100,
    maximum_range_seconds: 90 * 24 * 60 * 60,
    price_modes: ["trade", "mark"],
    unavailable_reason: null,
  });
});

test("rejects unsafe OKX candle symbols before any upstream request", async () => {
  let calls = 0;
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", async () => { calls += 1; return json({ code: "0", data: [] }); });
  await assert.rejects(() => adapter.fetchCandles(account(), candleRequest({ native_symbol: "BTC-USDT-SWAP&secret=x" })), /okx_invalid_candle_request/);
  assert.equal(calls, 0);
});

test("keeps the OKX candle intersecting a live right boundary without inventing a historical gap", async () => {
  const liveTo = candleStart + minute + 30_000;
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", async () => json({ code: "0", data: [
    okxCandle(candleStart + minute, "102", "0"),
    okxCandle(candleStart),
  ] }), () => liveTo);
  const batch = await adapter.fetchCandles(account(), candleRequest({ to: new Date(liveTo).toISOString(), limit: 3 }));
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.status]), [
    [new Date(candleStart).toISOString(), "final"],
    [new Date(candleStart + minute).toISOString(), "partial"],
  ]);
  assert.equal(batch.coverage.status, "complete");
  assert.deepEqual(batch.coverage.gaps, []);
  assert.deepEqual(batch.warnings, []);
});

test("rejects numeric OKX OHLCV fields before JavaScript can round them", async () => {
  const row = okxCandle(candleStart);
  row[1] = 9_007_199_254_740_993;
  row[2] = "9007199254740994";
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", async () => json({ code: "0", data: [row] }), () => candleStart + minute);
  await assert.rejects(
    () => adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + minute).toISOString(), limit: 1 })),
    /okx_invalid_candle_open/,
  );
});

test("bounds OKX short and stalled pages with one request-scoped abort signal", async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", async (_input, init) => {
    calls += 1;
    signals.push(init?.signal as AbortSignal);
    return json({ code: "0", data: [okxCandle(candleStart + (10 - calls) * minute)] });
  }, () => candleStart + 10 * minute);
  const partial = await adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 101 }));
  assert.equal(calls, 3);
  assert.equal(new Set(signals).size, 1);
  assert.equal(partial.coverage.status, "partial");
  assert.equal(partial.warnings.includes("provider_limit_reached"), true);
  assert.equal(partial.warnings.includes("historical_gap"), false);
  assert.deepEqual(partial.coverage.gaps, []);

  calls = 0;
  const stalled = await new OkxTradingProviderAdapter("https://www.okx.com", async () => {
    calls += 1;
    return json({ code: "0", data: [okxCandle(candleStart + 9 * minute)] });
  }, () => candleStart + 10 * minute).fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 101 }));
  assert.equal(calls, 2);
  assert.equal(stalled.coverage.status, "partial");
  assert.equal(stalled.warnings.includes("provider_limit_reached"), true);
  assert.equal(stalled.warnings.includes("historical_gap"), false);
});

test("returns structured OKX time-limit coverage when the whole fetch deadline expires", async () => {
  let calls = 0;
  let clockCalls = 0;
  const clock = () => [candleStart + 10 * minute, candleStart + 10 * minute, candleStart + 10 * minute + 12_001][Math.min(clockCalls++, 2)]!;
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", async () => {
    calls += 1;
    return json({ code: "0", data: [okxCandle(candleStart + (10 - calls) * minute)] });
  }, clock);
  const batch = await adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 101 }));
  assert.equal(calls, 1);
  assert.equal(batch.coverage.status, "partial");
  assert.equal(batch.warnings.includes("time_limit_reached"), true);
  assert.equal(batch.warnings.includes("historical_gap"), false);
});

test("loads descending OKX history pages through the gateway and returns deduplicated ascending candles with gaps", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return calls.length === 1
      ? json({ code: "0", data: [okxCandle(candleStart + 4 * minute, "105", "0"), okxCandle(candleStart + 3 * minute, "104")] })
      : json({ code: "0", data: [okxCandle(candleStart + 3 * minute, "104"), okxCandle(candleStart + minute, "102"), okxCandle(candleStart)] });
  };
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", fetcher, () => candleStart + 4 * minute + 30_000);
  const batch = await adapter.fetchCandles(account(), candleRequest());
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.pathname, "/api/v5/market/history-candles");
  assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), {
    instId: "BTC-USDT-SWAP", bar: "1m", after: String(candleStart + 5 * minute), limit: "5",
  });
  assert.equal(calls[1]?.url.searchParams.get("after"), String(candleStart + 3 * minute));
  assert.equal(calls.every(({ headers }) => headers.get("OK-ACCESS-KEY") === null && headers.get("OK-ACCESS-SIGN") === null), true);
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.status, candle.gap_before, candle.gap_after]), [
    [new Date(candleStart).toISOString(), "final", false, false],
    [new Date(candleStart + minute).toISOString(), "final", false, true],
    [new Date(candleStart + 3 * minute).toISOString(), "final", true, false],
    [new Date(candleStart + 4 * minute).toISOString(), "partial", false, false],
  ]);
  assert.deepEqual(batch.coverage.gaps, [{ series_basis: "trade", from: new Date(candleStart + 2 * minute).toISOString(), to: new Date(candleStart + 3 * minute).toISOString() }]);
  assert.deepEqual(batch.warnings, ["historical_gap"]);
});

test("maps OKX UTC bars and mark-price endpoint while bounding every upstream page", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return json({ code: "0", data: urls.length === 1 ? [okxMarkCandle(candleStart)] : [] });
  };
  const adapter = new OkxTradingProviderAdapter("https://www.okx.com", fetcher, () => candleStart + minute);
  const batch = await adapter.fetchCandles(account(), candleRequest({ timeframe: "1d", price_mode: "mark", to: new Date(candleStart + 2 * 24 * 60 * minute).toISOString(), limit: 3_000 }));
  assert.equal(urls[0]?.pathname, "/api/v5/market/history-mark-price-candles");
  assert.equal(urls[0]?.searchParams.get("bar"), "1Dutc");
  assert.equal(urls[0]?.searchParams.get("limit"), "100");
  assert.equal(batch.candles.length <= 3_000, true);
  assert.equal(batch.candles[0]?.series_basis, "mark");
  assert.equal(batch.candles[0]?.volume, null);
});

test("redacts OKX candle auth, rate-limit, HTTP, and malformed upstream responses", async () => {
  const cases = [
    { status: 401, payload: { code: "50113", msg: "ok-secret ok-pass" }, message: "okx_invalid_signature", statusCode: 400 },
    { status: 429, payload: { code: "50011", msg: "ok-secret ok-pass" }, message: "okx_rate_limited", statusCode: 429 },
    { status: 503, payload: { code: "50000", msg: "ok-secret ok-pass" }, message: "okx_unavailable", statusCode: 503 },
    { status: 200, payload: { code: "0", data: { raw: "ok-secret ok-pass" } }, message: "okx_invalid_candles", statusCode: 502 },
  ];
  for (const fixture of cases) {
    const adapter = new OkxTradingProviderAdapter("https://www.okx.com", async () => json(fixture.payload, fixture.status));
    await assert.rejects(() => adapter.fetchCandles(account(), candleRequest()), (error: unknown) => {
      const safe = error as Error & { statusCode?: number };
      assert.equal(safe.message, fixture.message);
      assert.equal(safe.statusCode, fixture.statusCode);
      assert.equal(/ok-secret|ok-pass/.test(safe.message), false);
      return true;
    });
  }
});
