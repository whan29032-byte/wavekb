import assert from "node:assert/strict";
import test from "node:test";
import { BinanceTradingProviderAdapter } from "../src/trading/providers/binance.ts";
import type { CandleRequest, ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function account(credentials: Record<string, string> = { api_key: "key", secret_key: "secret" }): ProviderAccount {
  return {
    connection_id: "11111111-1111-4111-8111-111111111111", external_account_id: "alias-123456", account_currency: "USDT", credentials,
    capabilities: {
      products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7, page_size: 1000, pagination: "time",
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
    product: "usdt_perpetual",
    native_symbol: "BTCUSDT",
    normalized_symbol: "BTCUSDT",
    timeframe: "1m",
    price_mode: "trade",
    from: new Date(candleStart).toISOString(),
    to: new Date(candleStart + 5 * minute).toISOString(),
    limit: 5,
    ...overrides,
  };
}

function binanceKline(openTime: number, close = "101"): unknown[] {
  return [openTime, "100", "110", "99", close, "12.5", openTime + minute - 1, "0", 7, "0", "0", "0"];
}

test("validates a migrated credential envelope alias and fails closed on trading or non-USDT permissions", async () => {
  const safeFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("accountConfig")
    ? json({ multiAssetsMargin: false })
    : json({ accountAlias: "legacy-alias", canTrade: false, totalMarginBalance: "10", totalWalletBalance: "9", totalUnrealizedProfit: "1", assets: [{ asset: "USDT", marginBalance: "10" }] });
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", safeFetcher, () => 1_700_000_000_000);
  const validated = await adapter.validateCredentials({ provider: "binance", credentials: { apiKey: "legacy-key", secretKey: "legacy-secret" }, read_only_ack: true });
  assert.deepEqual(validated, [{
    external_account_id: "legacy-alias", account_label: "Binance USD-M · lias", account_identifier_mask: "••••lias",
    account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified",
  }]);

  const unsafeFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("accountConfig")
    ? json({ multiAssetsMargin: false })
    : json({ accountAlias: "unsafe", canTrade: true, totalMarginBalance: "10", totalWalletBalance: "10", totalUnrealizedProfit: "0", assets: [{ asset: "USDT", marginBalance: "10" }] });
  await assert.rejects(
    () => new BinanceTradingProviderAdapter("https://fapi.binance.com", unsafeFetcher).validateCredentials({ provider: "binance", credentials: { api_key: "key", secret_key: "secret" }, read_only_ack: true }),
    /trading_permission_not_allowed/,
  );

  const coinFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("accountConfig")
    ? json({ multiAssetsMargin: false })
    : json({ accountAlias: "coin", canTrade: false, totalMarginBalance: "10", totalWalletBalance: "10", totalUnrealizedProfit: "0", assets: [{ asset: "BTC", marginBalance: "1" }] });
  await assert.rejects(
    () => new BinanceTradingProviderAdapter("https://fapi.binance.com", coinFetcher).validateCredentials({ provider: "binance", credentials: { api_key: "key", secret_key: "secret" }, read_only_ack: true }),
    /non_usdt_product_not_supported/,
  );
});

test("normalizes BOTH/LONG/SHORT fills, deduplicates overlaps, and classifies income safely", () => {
  const adapter = new BinanceTradingProviderAdapter();
  const page: ProviderHistoryPage = {
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "time", value: "1763985600001" },
    payload: {
      connection_id: "11111111-1111-4111-8111-111111111111",
      trades: [
        { symbol: "BTCUSDT", id: 1, orderId: 10, side: "BUY", positionSide: "BOTH", price: "100", qty: "1", realizedPnl: "0", commission: "0.1", commissionAsset: "USDT", time: 1763985600000, maker: false },
        { symbol: "BTCUSDT", id: 1, orderId: 10, side: "BUY", positionSide: "BOTH", price: "100", qty: "1", realizedPnl: "0", commission: "0.1", commissionAsset: "USDT", time: 1763985600000, maker: false },
        { symbol: "ETHUSDT", id: 2, orderId: 11, side: "SELL", positionSide: "LONG", price: "200", qty: "2", realizedPnl: "5", commission: "0.2", commissionAsset: "USDT", time: 1763985600100, maker: true },
        { symbol: "SOLUSDT", id: 3, orderId: 12, side: "SELL", positionSide: "SHORT", price: "50", qty: "3", realizedPnl: "0", commission: "0.3", commissionAsset: "USDT", time: 1763985600200, maker: false },
      ],
      income: [
        { symbol: "BTCUSDT", incomeType: "TRANSFER", income: "100", asset: "USDT", time: 1763985600300, tranId: 20 },
        { symbol: "BTCUSDT", incomeType: "FUNDING_FEE", income: "-2", asset: "USDT", time: 1763985600400, tranId: 21 },
        { symbol: "BTCUSDT", incomeType: "COMMISSION", income: "-1", asset: "USDT", time: 1763985600500, tranId: 22 },
      ],
      exhausted: true,
    },
  };
  const batch = adapter.normalizeHistory(page);
  assert.equal(batch.fills.length, 3);
  assert.deepEqual(batch.fills.map((fill) => [fill.position_side, fill.action, fill.side, fill.fee.amount]), [
    ["both", "open", "buy", "-0.1"], ["long", "close", "sell", "-0.2"], ["short", "open", "sell", "-0.3"],
  ]);
  assert.deepEqual(batch.cash_events.map((event) => [event.type, event.amount]), [
    ["internal_transfer", "100"], ["funding", "-2"], ["commission_adjustment", "-1"],
  ]);
  assert.equal(batch.exhausted, true);
  assert.equal(batch.next_cursor?.value, "1763985600001");
});

test("fetches canonical snapshots and history without exposing the secret", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("accountConfig")) return json({ multiAssetsMargin: false });
    if (url.pathname.endsWith("account")) return json({ totalMarginBalance: "123.5", totalWalletBalance: "120", totalUnrealizedProfit: "3.5" });
    return json([]);
  };
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", fetcher, () => 1_700_000_000_000);
  const snapshot = await adapter.fetchAccountSnapshot(account());
  assert.equal(snapshot.usd_equity, "123.5");
  assert.equal(snapshot.valuation.status, "approximate");
  const history = await adapter.fetchHistory(account(), { kind: "time", value: "1699990000000" });
  assert.equal(history.cursor.kind, "time");
  assert.equal(urls.some((url) => url.toString().includes("secret")), false);
});

test("advertises the audited USD-M candle contract", async () => {
  const adapter = new BinanceTradingProviderAdapter();
  const discovered = await adapter.discoverCapabilities(account());
  assert.deepEqual(discovered.candles, {
    availability: "available",
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M"],
    maximum_page_size: 1_500,
    maximum_range_seconds: 200 * 24 * 60 * 60,
    price_modes: ["trade", "mark"],
    unavailable_reason: null,
  });
});

test("rejects unsafe Binance candle symbols before any upstream request", async () => {
  let calls = 0;
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", async () => { calls += 1; return json([]); });
  await assert.rejects(() => adapter.fetchCandles(account(), candleRequest({ native_symbol: "BTCUSDT&signature=leak" })), /binance_invalid_candle_request/);
  assert.equal(calls, 0);
});

test("keeps the Binance candle intersecting a live right boundary without inventing a historical gap", async () => {
  const liveTo = candleStart + minute + 30_000;
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", async () => json([
    binanceKline(candleStart),
    binanceKline(candleStart + minute, "102"),
  ]), () => liveTo);
  const batch = await adapter.fetchCandles(account(), candleRequest({ to: new Date(liveTo).toISOString(), limit: 3 }));
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.status]), [
    [new Date(candleStart).toISOString(), "final"],
    [new Date(candleStart + minute).toISOString(), "partial"],
  ]);
  assert.equal(batch.coverage.status, "complete");
  assert.deepEqual(batch.coverage.gaps, []);
  assert.deepEqual(batch.warnings, []);
});

test("rejects numeric Binance OHLCV fields before JavaScript can round them", async () => {
  const row = binanceKline(candleStart);
  row[1] = 9_007_199_254_740_993;
  row[2] = "9007199254740994";
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", async () => json([row]), () => candleStart + minute);
  await assert.rejects(
    () => adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + minute).toISOString(), limit: 1 })),
    /binance_invalid_candle_open/,
  );
});

test("bounds Binance short and stalled pages with one request-scoped abort signal", async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", async (input, init) => {
    calls += 1;
    signals.push(init?.signal as AbortSignal);
    return json([binanceKline(Number(new URL(String(input)).searchParams.get("startTime")))]);
  }, () => candleStart + 10 * minute);
  const partial = await adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 3_000 }));
  assert.equal(calls, 3);
  assert.equal(new Set(signals).size, 1);
  assert.equal(partial.coverage.status, "partial");
  assert.equal(partial.warnings.includes("provider_limit_reached"), true);
  assert.equal(partial.warnings.includes("historical_gap"), false);
  assert.deepEqual(partial.coverage.gaps, []);

  calls = 0;
  const stalled = await new BinanceTradingProviderAdapter("https://fapi.binance.com", async () => {
    calls += 1;
    return json([binanceKline(candleStart)]);
  }, () => candleStart + 10 * minute).fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 3_000 }));
  assert.equal(calls, 2);
  assert.equal(stalled.coverage.status, "partial");
  assert.equal(stalled.warnings.includes("provider_limit_reached"), true);
  assert.equal(stalled.warnings.includes("historical_gap"), false);
});

test("returns structured Binance time-limit coverage when the whole fetch deadline expires", async () => {
  let calls = 0;
  let clockCalls = 0;
  const clock = () => [candleStart + 10 * minute, candleStart + 10 * minute, candleStart + 10 * minute + 12_001][Math.min(clockCalls++, 2)]!;
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", async (input) => {
    calls += 1;
    return json([binanceKline(Number(new URL(String(input)).searchParams.get("startTime")))]);
  }, clock);
  const batch = await adapter.fetchCandles(account(), candleRequest({ to: new Date(candleStart + 10 * minute).toISOString(), limit: 3_000 }));
  assert.equal(calls, 1);
  assert.equal(batch.coverage.status, "partial");
  assert.equal(batch.warnings.includes("time_limit_reached"), true);
  assert.equal(batch.warnings.includes("historical_gap"), false);
});

test("loads public USD-M trade candles through the gateway with exact pagination, deduplication, partial state, and gap evidence", async () => {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (calls.length === 1) return json([
      binanceKline(candleStart),
      binanceKline(candleStart + minute, "102"),
    ]);
    return json([
      binanceKline(candleStart + minute, "102"),
      binanceKline(candleStart + 3 * minute, "104"),
      binanceKline(candleStart + 4 * minute, "105"),
    ]);
  };
  const now = candleStart + 4 * minute + 30_000;
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", fetcher, () => now);
  const batch = await adapter.fetchCandles(account({ api_key: "private-key", secret_key: "private-secret" }), candleRequest());

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.pathname, "/fapi/v1/klines");
  assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), {
    symbol: "BTCUSDT", interval: "1m", startTime: String(candleStart), endTime: String(candleStart + 5 * minute - 1), limit: "5",
  });
  assert.equal(calls[1]?.url.searchParams.get("startTime"), String(candleStart + 2 * minute));
  assert.equal(JSON.stringify(calls).includes("private-key"), false);
  assert.equal(JSON.stringify(calls).includes("private-secret"), false);
  assert.equal(calls.every(({ init }) => init?.signal instanceof AbortSignal), true);
  assert.deepEqual(batch.candles.map((candle) => [candle.open_time, candle.close, candle.status, candle.gap_before, candle.gap_after]), [
    [new Date(candleStart).toISOString(), "101", "final", false, false],
    [new Date(candleStart + minute).toISOString(), "102", "final", false, true],
    [new Date(candleStart + 3 * minute).toISOString(), "104", "final", true, false],
    [new Date(candleStart + 4 * minute).toISOString(), "105", "partial", false, false],
  ]);
  assert.deepEqual(batch.coverage.gaps, [{
    series_basis: "trade",
    from: new Date(candleStart + 2 * minute).toISOString(),
    to: new Date(candleStart + 3 * minute).toISOString(),
  }]);
  assert.equal(batch.coverage.status, "gapped");
  assert.deepEqual(batch.warnings, ["historical_gap"]);
});

test("maps Binance mark-price candles, enforces the 1500-row page limit, and never returns more than 3000 rows", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return json(urls.length === 1 ? [binanceKline(candleStart)] : []);
  };
  const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", fetcher, () => candleStart + minute);
  const batch = await adapter.fetchCandles(account(), candleRequest({
    price_mode: "mark",
    to: new Date(candleStart + 3_000 * minute).toISOString(),
    limit: 3_000,
  }));
  assert.equal(urls[0]?.pathname, "/fapi/v1/markPriceKlines");
  assert.equal(urls[0]?.searchParams.get("limit"), "1500");
  assert.equal(batch.candles.length <= 3_000, true);
  assert.equal(batch.candles[0]?.series_basis, "mark");
  assert.equal(batch.candles[0]?.volume, null);
});

test("maps Binance HTTP, auth, rate-limit, and malformed payload failures to fixed redacted errors", async () => {
  const cases: Array<{ status: number; payload: unknown; expected: RegExp; statusCode: number }> = [
    { status: 401, payload: { code: -2015, msg: "private-key private-secret" }, expected: /binance_unauthorized/, statusCode: 400 },
    { status: 429, payload: { code: -1003, msg: "private-key private-secret" }, expected: /binance_rate_limited/, statusCode: 429 },
    { status: 503, payload: "private-key private-secret", expected: /binance_unavailable/, statusCode: 503 },
    { status: 200, payload: { raw: "private-key private-secret" }, expected: /binance_invalid_candles/, statusCode: 502 },
  ];
  for (const fixture of cases) {
    const adapter = new BinanceTradingProviderAdapter("https://fapi.binance.com", async () => json(fixture.payload, fixture.status));
    await assert.rejects(
      () => adapter.fetchCandles(account({ api_key: "private-key", secret_key: "private-secret" }), candleRequest()),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        const safe = error as Error & { statusCode?: number };
        assert.match(safe.message, fixture.expected);
        assert.equal(safe.statusCode, fixture.statusCode);
        assert.equal(safe.message.includes("private-key"), false);
        assert.equal(safe.message.includes("private-secret"), false);
        return true;
      },
    );
  }
});
