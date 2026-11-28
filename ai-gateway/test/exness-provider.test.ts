import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { reconstructPositionIdCycles } from "../src/trading/cycles.ts";
import { ExnessTradingProviderAdapter } from "../src/trading/providers/exness.ts";
import type { ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const now = Date.parse("2026-11-24T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const privateJwk = privateKey.export({ format: "jwk" });
const privateHex = Buffer.concat([
  Buffer.from(privateJwk.d ?? "", "base64url"),
  Buffer.from(privateJwk.x ?? "", "base64url"),
]).toString("hex");

function credentials(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    api_key: "exnsk-test-key", private_key: privatePem, discovery_base_url: "https://gateway.exness.com",
    account_ids: JSON.stringify(["101", "202"]), trading_scope: "read_only", ...overrides,
  };
}

function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    connection_id: "55555555-5555-4555-8555-555555555555", external_account_id: "101", account_currency: "USD",
    credentials: credentials({ account_ids: JSON.stringify(["101"]) }),
    capabilities: {
      products: ["cfd"], history_age_days: 120, history_range_days: 14, page_size: 200, pagination: "opaque",
      position_grouping: "position_id_cycle", has_position_id: true, has_realized_pnl: true, has_fee_asset: true,
      has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true, account_currency: "USD",
      settlement_assets: ["USD"], valuation_pairs: ["USD"],
      candles: { availability: "unavailable", timeframes: [], maximum_page_size: null, maximum_range_seconds: null, price_modes: [], unavailable_reason: "implementation_pending" },
    },
    ...overrides,
  };
}

function limits(maxCandles: number | null = 2) {
  const methods: Array<Record<string, unknown>> = [{
    api_operation_id: "getDealsHistory", http_method: "GET", path: "/v1/history/accounts/{account_id}/deals",
    rate_limit: { limit: 5, window_seconds: 1 }, limits: { history_age_days: 120, history_range_days: 14 },
  }];
  if (maxCandles !== null) methods.push({
    api_operation_id: "getCandleHistory", http_method: "GET", path: "/v1/market-data/accounts/{account_id}/candles",
    rate_limit: { limit: 5, window_seconds: 1 }, limits: { max_candles_per_request: maxCandles },
  });
  return { limits: { rest: { global_account_rate: { limit: 10, window_seconds: 1 }, methods }, websocket: { global_account_limits: {}, endpoints: [] } } };
}

function candleRequest() {
  return {
    product: "cfd" as const,
    native_symbol: "XAUUSD",
    normalized_symbol: "XAU/USD",
    timeframe: "1m" as const,
    price_mode: "bid" as const,
    from: "2026-11-24T11:58:00.000Z",
    to: "2026-11-24T12:00:00.000Z",
    limit: 2,
  };
}

test("signs exact EXN-DATA bytes, discovers official access points, and validates 1-10 read-only accounts", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/v1/trading/access-point") return json({
      access_point: "https://ap-demo.exness.com",
      account_id: url.searchParams.get("account_id"),
    });
    if (url.pathname.endsWith("/account")) {
      const id = url.pathname.split("/").at(-2);
      return json({ account_id: id, account_name: `Trading ${id}`, create_date: "2026-01-01T00:00:00Z", settings: { currency: "USD", leverage: "100", trade_mode: "enabled", account_status: "active", execution_mode: "market" } });
    }
    if (url.pathname.endsWith("/limits")) return json(limits());
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const validated = await adapter.validateCredentials({
    provider: "exness",
    credentials: credentials({ private_key: `\n  ${privateHex}  \n` }),
    read_only_ack: true,
  });
  assert.equal(validated.length, 2);
  assert.deepEqual(validated.map((item) => item.external_account_id), ["101", "202"]);
  assert.deepEqual(validated.map((item) => item.account_identifier_mask), ["••••0101", "••••0202"]);
  assert.ok(calls.length >= 6);
  for (const call of calls) {
    assert.equal(call.headers.get("EXN-API-KEY"), "exnsk-test-key");
    assert.equal(call.headers.get("EXN-TIMESTAMP"), String(now));
    assert.equal(call.headers.get("EXN-SIGN-VERSION"), "1");
    assert.equal(call.headers.get("EXN-IDEMPOTENCY-KEY"), "");
    const data = Buffer.from(call.headers.get("EXN-DATA") ?? "", "base64url");
    const signed = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    assert.equal(signed.method, "GET");
    assert.equal(signed.path, `${call.url.pathname}${call.url.search}`);
    assert.equal(signed.body_hash, "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
    assert.equal(verify(null, data, publicKey, Buffer.from(call.headers.get("EXN-SIGN") ?? "", "base64url")), true);
  }
});

test("signs the exact DNS-widget discovery path with the required empty idempotency key before loading candles", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits());
    if (url.pathname.endsWith("/candles")) return json({ candles: [] });
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  await adapter.fetchCandles(account(), candleRequest());

  const discovery = calls[0];
  assert.ok(discovery);
  assert.equal(discovery.url.origin, "https://gateway.exness.com");
  assert.equal(discovery.url.pathname + discovery.url.search, "/v1/trading/access-point?account_id=101");
  assert.equal(discovery.headers.get("EXN-IDEMPOTENCY-KEY"), "");
  const data = Buffer.from(discovery.headers.get("EXN-DATA") ?? "", "base64url");
  assert.deepEqual(JSON.parse(data.toString("utf8")), {
    api_key: "exnsk-test-key",
    idempotency_key: "",
    timestamp: now,
    sign_version: 1,
    method: "GET",
    path: "/v1/trading/access-point?account_id=101",
    body_hash: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
  });
  assert.equal(verify(null, data, publicKey, Buffer.from(discovery.headers.get("EXN-SIGN") ?? "", "base64url")), true);
});

const invalidDiscoveryAccountIds: Array<{ name: string; accountId?: string | number }> = [
  { name: "missing" },
  { name: "numeric", accountId: 101 },
  { name: "mismatched string", accountId: "202" },
];

for (const item of invalidDiscoveryAccountIds) {
  test(`rejects a ${item.name} Exness discovery account ID without caching the access point`, async () => {
    let discoveries = 0;
    let accountRequests = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/trading/access-point") {
        discoveries += 1;
        return json({ access_point: "https://ap-demo.exness.com", ...(item.accountId === undefined ? {} : { account_id: item.accountId }) });
      }
      accountRequests += 1;
      if (url.pathname.endsWith("/limits")) return json(limits(2));
      if (url.pathname.endsWith("/candles")) return json({ candles: [] });
      throw new Error(`unexpected path ${url.pathname}`);
    };
    const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

    const first = await adapter.fetchCandles(account(), candleRequest());
    const second = await adapter.fetchCandles(account(), candleRequest());

    for (const result of [first, second]) {
      assert.equal(result.coverage.status, "unavailable", item.name);
      assert.equal(result.coverage.unavailable_reason, "upstream_unavailable", item.name);
    }
    assert.equal(discoveries, 2, item.name);
    assert.equal(accountRequests, 0, item.name);
  });
}

test("loads candles only from the discovered access point and signs the exact official path and query", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits());
    if (url.pathname.endsWith("/candles")) return json({
      candles: [
        { time: "2026-11-24T11:58:00.000Z", open: 2000.1, high: 2001.2, low: 1999.9, close: 2000.8, volume: 12 },
        { time: "2026-11-24T11:59:00.000Z", open: 2000.8, high: 2002.1, low: 2000.4, close: 2001.7, volume: 8 },
      ],
    });
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  await adapter.fetchCandles(account(), candleRequest());

  const candleCall = calls.find((call) => call.url.pathname.endsWith("/candles"));
  assert.ok(candleCall);
  assert.equal(candleCall.url.origin, "https://ap-demo.exness.com");
  const expectedPath = "/v1/market-data/accounts/101/candles?instrument=XAUUSD&price_type=bid&timeframe=M1&from=2026-11-24T11%3A58%3A00.000Z&to=2026-11-24T12%3A00%3A00.000Z";
  assert.equal(candleCall.url.pathname + candleCall.url.search, expectedPath);
  assert.equal(candleCall.headers.get("EXN-IDEMPOTENCY-KEY"), "");
  const data = Buffer.from(candleCall.headers.get("EXN-DATA") ?? "", "base64url");
  assert.equal((JSON.parse(data.toString("utf8")) as Record<string, unknown>).path, expectedPath);
  assert.equal(verify(null, data, publicKey, Buffer.from(candleCall.headers.get("EXN-SIGN") ?? "", "base64url")), true);
});

test("discovers Exness candle capabilities from the live getCandleHistory account limit", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(37));
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.discoverCapabilities(account());

  assert.deepEqual(result.candles, {
    availability: "available",
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"],
    maximum_page_size: 37,
    maximum_range_seconds: 37 * 60,
    price_modes: ["bid", "ask", "both"],
    unavailable_reason: null,
  });
});

test("reports candles as account-scope unavailable when Exness omits getCandleHistory from live limits", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(null));
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.discoverCapabilities(account());

  assert.deepEqual(result.candles, {
    availability: "unavailable",
    timeframes: [],
    maximum_page_size: null,
    maximum_range_seconds: null,
    price_modes: [],
    unavailable_reason: "account_scope_unavailable",
  });
});

test("normalizes official Exness bid, ask, and both payloads into separate decimal-string candle series", async () => {
  let discoveries = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") {
      discoveries += 1;
      return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    }
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles")) {
      const priceType = url.searchParams.get("price_type");
      if (priceType === "both") return json({ candles: [{
        time: "2026-11-24T11:59:00+00:00",
        bid: { open: 2000.1, high: 2001.2, low: 1999.9, close: 2000.8 },
        ask: { open: 2000.3, high: 2001.4, low: 2000.1, close: 2001 },
        volume: 12,
      }] });
      return json({ candles: [{
        time: "2026-11-24T11:59:00+00:00",
        open: priceType === "bid" ? 2000.1 : 2000.3,
        high: priceType === "bid" ? 2001.2 : 2001.4,
        low: priceType === "bid" ? 1999.9 : 2000.1,
        close: priceType === "bid" ? 2000.8 : 2001,
        volume: 12,
      }] });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const singleRange = { ...candleRequest(), from: "2026-11-24T11:59:00.000Z" };

  const bid = await adapter.fetchCandles(account(), { ...singleRange, price_mode: "bid" });
  const ask = await adapter.fetchCandles(account(), { ...singleRange, price_mode: "ask" });
  const both = await adapter.fetchCandles(account(), { ...singleRange, price_mode: "both", limit: 4 });

  assert.equal(discoveries, 1);
  assert.deepEqual(bid.candles.map((item) => [item.series_basis, item.open, item.high, item.low, item.close, item.volume, item.status]), [
    ["bid", "2000.1", "2001.2", "1999.9", "2000.8", "12", "final"],
  ]);
  assert.deepEqual(ask.candles.map((item) => [item.series_basis, item.open, item.high, item.low, item.close, item.volume, item.status]), [
    ["ask", "2000.3", "2001.4", "2000.1", "2001", "12", "final"],
  ]);
  assert.deepEqual(both.candles.map((item) => [item.series_basis, item.open, item.close]), [
    ["bid", "2000.1", "2000.8"],
    ["ask", "2000.3", "2001"],
  ]);
  assert.ok([...bid.candles, ...ask.candles, ...both.candles].every((item) => item.source === "signed_account"));
});

test("maps every supported WaveKB timeframe to the exact official Exness timeframe and rejects unsupported ones before fetch", async () => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles")) {
      seen.push(url.searchParams.get("timeframe") ?? "");
      return json({ candles: [] });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const mappings = [
    ["1m", "M1"], ["3m", "M3"], ["5m", "M5"], ["15m", "M15"], ["30m", "M30"],
    ["1h", "H1"], ["2h", "H2"], ["4h", "H4"], ["1d", "D1"], ["1w", "W1"], ["1M", "MN"],
  ] as const;
  for (const [timeframe] of mappings) {
    const from = timeframe === "1M" ? "2026-11-01T00:00:00.000Z" : "2026-11-24T11:59:00.000Z";
    const to = timeframe === "1M" ? "2026-12-01T00:00:00.000Z" : "2026-11-24T12:00:00.000Z";
    await adapter.fetchCandles(account(), { ...candleRequest(), timeframe, from, to });
  }
  assert.deepEqual(seen, mappings.map(([, upstream]) => upstream));
  const before = seen.length;
  await assert.rejects(
    () => adapter.fetchCandles(account(), { ...candleRequest(), timeframe: "6h" }),
    /exness_invalid_candle_request/,
  );
  assert.equal(seen.length, before);
});

test("pages by the live Exness candle limit, deduplicates rows, and preserves ascending UTC order", async () => {
  const windows: Array<[string | null, string | null]> = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(1));
    if (url.pathname.endsWith("/candles")) {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      windows.push([from, to]);
      const candle = { time: from, open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 4 };
      return json({ candles: windows.length === 1 ? [candle, { ...candle }] : [candle] });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.fetchCandles(account(), {
    ...candleRequest(), from: "2026-11-24T11:57:00.000Z", to: "2026-11-24T12:00:00.000Z", limit: 3,
  });

  assert.deepEqual(windows, [
    ["2026-11-24T11:57:00.000Z", "2026-11-24T11:58:00.000Z"],
    ["2026-11-24T11:58:00.000Z", "2026-11-24T11:59:00.000Z"],
    ["2026-11-24T11:59:00.000Z", "2026-11-24T12:00:00.000Z"],
  ]);
  assert.deepEqual(result.candles.map((item) => item.open_time), windows.map(([from]) => from));
  assert.equal(result.coverage.status, "complete");
});

test("marks the current Exness candle partial without fabricating a completed bar", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles")) return json({ candles: [{
      time: "2026-11-24T12:00:00.000Z", open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 4,
    }] });
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.fetchCandles(account(), {
    ...candleRequest(), from: "2026-11-24T12:00:00.000Z", to: "2026-11-24T12:01:00.000Z",
  });

  assert.equal(result.candles[0]?.status, "partial");
  assert.equal(result.candles[0]?.close_time, "2026-11-24T12:01:00.000Z");
});

test("returns bounded partial coverage when the Exness page budget is exhausted", async () => {
  let candleRequests = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(1));
    if (url.pathname.endsWith("/candles")) {
      candleRequests += 1;
      return json({ candles: [] });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.fetchCandles(account(), {
    ...candleRequest(), from: "2026-11-24T11:50:00.000Z", to: "2026-11-24T12:00:00.000Z", limit: 2,
  });

  assert.equal(candleRequests, 3);
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.warnings, ["partial_coverage", "provider_limit_reached"]);
});

test("uses one whole-fetch deadline and returns time-limit partial coverage after preserving parsed candles", async () => {
  let clock = now;
  let candleRequests = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(1));
    if (url.pathname.endsWith("/candles")) {
      candleRequests += 1;
      clock += 12_001;
      return json({ candles: [{ time: url.searchParams.get("from"), open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 4 }] });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => clock);

  const result = await adapter.fetchCandles(account(), {
    ...candleRequest(), from: "2026-11-24T11:57:00.000Z", to: "2026-11-24T12:00:00.000Z", limit: 3,
  });

  assert.equal(candleRequests, 1);
  assert.equal(result.candles.length, 1);
  assert.equal(result.coverage.status, "partial");
  assert.ok(result.warnings.includes("time_limit_reached"));
});

test("caches an access point per credential scope and refreshes it once after a stale-host failure", async () => {
  let discoveries = 0;
  let oldHostCandles = 0;
  let newHostCandles = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") {
      discoveries += 1;
      return json({ access_point: discoveries === 1 ? "https://old-ap.exness.com" : "https://new-ap.exness.com", account_id: "101" });
    }
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles") && url.hostname === "old-ap.exness.com") {
      oldHostCandles += 1;
      return json({ code: "SYSTEM_TEMPORARY_UNAVAILABLE", description: "old internal host" }, 503);
    }
    if (url.pathname.endsWith("/candles") && url.hostname === "new-ap.exness.com") {
      newHostCandles += 1;
      return json({ candles: [{ time: "2026-11-24T11:59:00.000Z", open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 4 }] });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const first = await adapter.fetchCandles(account(), { ...candleRequest(), from: "2026-11-24T11:59:00.000Z" });
  const second = await adapter.fetchCandles(account(), { ...candleRequest(), from: "2026-11-24T11:59:00.000Z" });

  assert.equal(first.candles.length, 1);
  assert.equal(second.candles.length, 1);
  assert.equal(discoveries, 2);
  assert.equal(oldHostCandles, 1);
  assert.equal(newHostCandles, 2);
});

test("does not reuse a cached access point after the API-key or DNS-widget Gateway scope changes", async () => {
  const discoveries: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") {
      discoveries.push(url.origin);
      return json({ access_point: discoveries.length === 1 ? "https://ap-one.exness.com" : "https://ap-two.exness.com", account_id: "101" });
    }
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles")) return json({ candles: [] });
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  await adapter.fetchCandles(account(), candleRequest());
  await adapter.fetchCandles(account({ credentials: credentials({
    api_key: "exnsk-rotated-key",
    discovery_base_url: "https://rotated-gateway.exness.com",
    account_ids: JSON.stringify(["101"]),
  }) }), candleRequest());

  assert.deepEqual(discoveries, ["https://gateway.exness.com", "https://rotated-gateway.exness.com"]);
});

test("maps 401, 403, 429, and repeated 503 candle failures to redacted degraded coverage", async () => {
  const cases = [
    [401, "AUTH_INVALID_API_KEY", "account_scope_unavailable", false],
    [401, "UNKNOWN_AUTH_FAILURE", "account_scope_unavailable", false],
    [403, "AUTH_PERMISSION_DENIED", "account_scope_unavailable", false],
    [429, "REQUEST_RATE_LIMIT", "rate_limited", true],
    [503, "SYSTEM_TEMPORARY_UNAVAILABLE", "upstream_unavailable", false],
  ] as const;
  for (const [status, code, reason, rateLimited] of cases) {
    const sensitive = `secret-${status}-https://private-ap.exness.com`;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://private-ap.exness.com", account_id: "101" });
      if (url.pathname.endsWith("/limits")) return json(limits(2));
      if (url.pathname.endsWith("/candles")) return json({ code, description: sensitive, api_key: "exnsk-test-key", private_key: privatePem }, status);
      throw new Error(`unexpected URL ${url}`);
    };
    const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

    const result = await adapter.fetchCandles(account(), candleRequest());

    assert.equal(result.coverage.status, "unavailable");
    assert.equal(result.coverage.unavailable_reason, reason);
    assert.equal(result.warnings.includes("rate_limited"), rateLimited);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(sensitive), false);
    assert.equal(serialized.includes("private-ap.exness.com"), false);
    assert.equal(serialized.includes("exnsk-test-key"), false);
    assert.equal(serialized.includes("PRIVATE KEY"), false);
    assert.equal(serialized.includes("101"), false);
  }
});

test("returns account-scope unavailable coverage when the DNS-widget Gateway Host is missing without guessing a host", async () => {
  let fetches = 0;
  const adapter = new ExnessTradingProviderAdapter(async () => {
    fetches += 1;
    throw new Error("must not fetch");
  }, () => now);
  const missingGateway = account({ credentials: credentials({ discovery_base_url: "" }) });

  const result = await adapter.fetchCandles(missingGateway, candleRequest());

  assert.equal(fetches, 0);
  assert.equal(result.coverage.status, "unavailable");
  assert.equal(result.coverage.unavailable_reason, "account_scope_unavailable");
  assert.deepEqual(result.warnings, ["candles_unavailable"]);
});

test("degrades malformed Exness candle payloads without exposing raw upstream data", async () => {
  const raw = "raw-private-upstream-payload";
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles")) return json({ candles: [{ time: raw, open: raw }] });
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.fetchCandles(account(), candleRequest());

  assert.equal(result.coverage.status, "unavailable");
  assert.equal(result.coverage.unavailable_reason, "upstream_unavailable");
  assert.equal(JSON.stringify(result).includes(raw), false);
});

test("degrades an Exness response that returns a candle outside the exact signed page window", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits(2));
    if (url.pathname.endsWith("/candles")) return json({ candles: [
      { time: "2026-11-24T11:57:00.000Z", open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 4 },
      { time: "2026-11-24T11:58:00.000Z", open: 1.2, high: 1.4, low: 1.1, close: 1.3, volume: 5 },
      { time: "2026-11-24T11:59:00.000Z", open: 1.3, high: 1.5, low: 1.2, close: 1.4, volume: 6 },
    ] });
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);

  const result = await adapter.fetchCandles(account(), {
    ...candleRequest(), from: "2026-11-24T11:57:00.000Z", to: "2026-11-24T12:00:00.000Z", limit: 2,
  });

  assert.equal(result.coverage.status, "unavailable");
  assert.equal(result.coverage.unavailable_reason, "upstream_unavailable");
});

test("rejects a generated Exness private key whose public half does not match its seed before fetch", async () => {
  let fetches = 0;
  const adapter = new ExnessTradingProviderAdapter(async () => {
    fetches += 1;
    return json({});
  }, () => now);
  const mismatched = `${privateHex.slice(0, 64)}${"0".repeat(64)}`;
  await assert.rejects(
    () => adapter.validateCredentials({
      provider: "exness",
      credentials: credentials({ private_key: mismatched, account_ids: JSON.stringify(["101"]) }),
      read_only_ack: true,
    }),
    /exness_invalid_private_key/,
  );
  assert.equal(fetches, 0);
});

test("maps official Exness authentication failures to fixed actionable errors", async () => {
  const cases = [
    [1000, "exness_invalid_api_key", 401],
    [1001, "exness_invalid_signature", 401],
    [1002, "exness_permission_denied", 403],
  ] as const;
  for (const [code, expected, status] of cases) {
    const adapter = new ExnessTradingProviderAdapter(async () => json({ code, error_message: "private upstream detail" }, status), () => now);
    await assert.rejects(
      () => adapter.validateCredentials({
        provider: "exness",
        credentials: credentials({ account_ids: JSON.stringify(["101"]) }),
        read_only_ack: true,
      }),
      (error: unknown) => error instanceof Error
        && error.message === expected
        && !error.message.includes("private upstream detail"),
    );
  }
});

test("uses live history limits, decimal snapshots, and opaque deal cursors", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/limits")) return json(limits());
    if (url.pathname.endsWith("/snapshot")) return json({ orders: [], positions: [], account_state: { balance: "1000.125", equity: "1010.375", used_margin: "25.5" } });
    if (url.pathname.endsWith("/deals")) return json({ items: [], next_cursor: "opaque-next", has_more: true, range: { from: "2026-11-10T12:00:00Z", to: "2026-11-24T12:00:00Z" } });
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const discovered = await adapter.discoverCapabilities(account());
  assert.equal(discovered.history_age_days, 120);
  assert.equal(discovered.history_range_days, 14);
  const snapshot = await adapter.fetchAccountSnapshot(account());
  assert.equal(snapshot.equity, "1010.375");
  assert.equal(snapshot.unrealized_pnl, "10.25");
  const history = await adapter.fetchHistory(account(), { kind: "opaque", value: null });
  const cursor = JSON.parse(history.cursor.value ?? "null") as Record<string, unknown>;
  assert.equal(cursor.provider_cursor, "opaque-next");
  assert.equal(cursor.window_from, "2026-11-10T12:00:00.000Z");
  assert.equal(cursor.window_to, "2026-11-24T12:00:00.000Z");
  const second = await adapter.fetchHistory(account(), history.cursor);
  assert.equal(second.cursor.kind, "opaque");
});

test("walks backward through provider-sized Exness history windows until the live age limit", async () => {
  const windows: Array<[string | null, string | null]> = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/trading/access-point") return json({ access_point: "https://ap-demo.exness.com", account_id: "101" });
    if (url.pathname.endsWith("/deals")) {
      windows.push([url.searchParams.get("from"), url.searchParams.get("to")]);
      return json({ items: [], has_more: false });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  const adapter = new ExnessTradingProviderAdapter(fetcher, () => now);
  const narrowAccount = account({ capabilities: { ...account().capabilities, history_age_days: 30, history_range_days: 10 } });
  let cursor: ProviderHistoryPage["cursor"] = { kind: "opaque", value: null };
  do {
    const page = await adapter.fetchHistory(narrowAccount, cursor);
    cursor = page.cursor;
  } while (cursor.value !== null);
  assert.deepEqual(windows, [
    ["2026-11-14T12:00:00.000Z", "2026-11-24T12:00:00.000Z"],
    ["2026-11-04T12:00:00.000Z", "2026-11-14T12:00:00.000Z"],
    ["2026-10-25T12:00:00.000Z", "2026-11-04T12:00:00.000Z"],
  ]);
});

test("keeps same-symbol position IDs separate through partial close and classifies swap, balance, admin fee, and dividend", () => {
  const adapter = new ExnessTradingProviderAdapter();
  const deal = (event_time: string, fields: Record<string, unknown>) => ({ event_time, deal: fields });
  const page: ProviderHistoryPage = {
    fetched_at: "2026-11-24T12:00:00Z", cursor: { kind: "opaque", value: null },
    payload: {
      connection_id: account().connection_id, account_currency: "USD", has_more: false,
      items: [
        deal("2026-11-24T01:00:00Z", { deal_id: "1", order_id: "o1", position_id: "p1", type: "open", direction: "buy", instrument: "XAUUSD", volume: "2", price: "2000.10", profit: { amount: "0", currency: "USD" }, commission: "-1.25", create_time: "2026-11-24T01:00:00Z" }),
        deal("2026-11-24T01:30:00Z", { deal_id: "2", order_id: "o2", position_id: "p2", type: "open", direction: "buy", instrument: "XAUUSD", volume: "1", price: "2001.20", profit: { amount: "0", currency: "USD" }, commission: "-0.75", create_time: "2026-11-24T01:30:00Z" }),
        deal("2026-11-24T02:00:00Z", { deal_id: "3", order_id: "o3", position_id: "p1", type: "close", direction: "sell", instrument: "XAUUSD", volume: "1", price: "2010", profit: { amount: "9.9", currency: "USD" }, commission: "-0.5", create_time: "2026-11-24T02:00:00Z" }),
        deal("2026-11-24T02:15:00Z", { deal_id: "4", position_id: "p1", type: "swap_fee", instrument: "XAUUSD", profit: { amount: "-2", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:15:00Z" }),
        deal("2026-11-24T02:30:00Z", { deal_id: "5", position_id: "p1", type: "dividend", instrument: "XAUUSD", profit: { amount: "3", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:30:00Z" }),
        deal("2026-11-24T02:45:00Z", { deal_id: "6", type: "balance", profit: { amount: "100", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:45:00Z" }),
        deal("2026-11-24T02:50:00Z", { deal_id: "9", type: "admin_fee", profit: { amount: "-4", currency: "USD" }, commission: "0", create_time: "2026-11-24T02:50:00Z" }),
        deal("2026-11-24T03:00:00Z", { deal_id: "7", order_id: "o7", position_id: "p2", type: "close", direction: "sell", instrument: "XAUUSD", volume: "1", price: "2012", profit: { amount: "10.8", currency: "USD" }, commission: "-0.5", create_time: "2026-11-24T03:00:00Z" }),
        deal("2026-11-24T03:30:00Z", { deal_id: "8", order_id: "o8", position_id: "p1", type: "close", direction: "sell", instrument: "XAUUSD", volume: "1", price: "2015", profit: { amount: "14.9", currency: "USD" }, commission: "-0.5", create_time: "2026-11-24T03:30:00Z" }),
      ],
    },
  };
  const batch = adapter.normalizeHistory(page);
  assert.equal(batch.fills.length, 5);
  assert.deepEqual(batch.cash_events.map((event) => [event.type, event.native_position_id, event.amount]), [
    ["swap_fee", "p1", "-2"], ["dividend", "p1", "3"], ["deposit", null, "100"], ["admin_adjustment", null, "-4"],
  ]);
  const cycles = reconstructPositionIdCycles({ provider: "exness", connection_id: account().connection_id, account_currency: "USD", fills: batch.fills, cash_events: batch.cash_events });
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles.map((cycle) => [cycle.native_position_id, cycle.fill_ids]), [["p1", ["1", "3", "8"]], ["p2", ["2", "7"]]]);
  assert.equal(cycles[0]?.funding_or_swap, "-2");
  assert.equal(cycles[0]?.dividends, "3");
});

test("rejects full-access scopes and malicious discovery hosts before sending account requests", async () => {
  const adapter = new ExnessTradingProviderAdapter(async () => json({ access_point: "http://127.0.0.1:8080", account_id: "101" }), () => now);
  await assert.rejects(() => adapter.validateCredentials({ provider: "exness", credentials: credentials({ trading_scope: "full_access", account_ids: JSON.stringify(["101"]) }), read_only_ack: true }), /read_only_scope_required/);
  await assert.rejects(() => adapter.validateCredentials({ provider: "exness", credentials: credentials({ account_ids: JSON.stringify(["101"]) }), read_only_ack: true }), /access_point_not_allowed/);
});
