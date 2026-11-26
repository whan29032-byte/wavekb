import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanonicalCandleBatch,
  assertCanonicalHistoryBatch,
  assertProviderCapabilities,
  normalizeProviderCapabilities,
  unavailableCandleBatch,
  type CandleRequest,
  type CanonicalCandleBatch,
  type CanonicalHistoryBatch,
  type ProviderAccount,
  type ProviderCredentialInput,
  type ProviderCursor,
  type ProviderHistoryPage,
  type TradingProvider,
  type TradingProviderAdapter,
} from "../src/trading/providers/contracts.ts";
import { createTradingProviderRegistry } from "../src/trading/providers/registry.ts";

const capturedAt = "2026-11-24T08:02:00.000Z";

const candleRequest: CandleRequest = {
  product: "usdt_perpetual",
  native_symbol: "BTCUSDT",
  normalized_symbol: "BTC/USDT",
  timeframe: "1m",
  price_mode: "trade",
  from: "2026-11-24T07:58:00.000Z",
  to: "2026-11-24T08:01:00.000Z",
  limit: 2,
};

function validCandleBatch(): CanonicalCandleBatch {
  return {
    provider: "binance",
    request: candleRequest,
    candles: [
      {
        provider: "binance",
        product: "usdt_perpetual",
        native_symbol: "BTCUSDT",
        normalized_symbol: "BTC/USDT",
        timeframe: "1m",
        series_basis: "trade",
        open_time: "2026-11-24T07:58:00.000Z",
        close_time: "2026-11-24T07:59:00.000Z",
        open: "12345678901234567890.123456789012345678",
        high: "12345678901234567890.223456789012345678",
        low: "12345678901234567890.023456789012345678",
        close: "12345678901234567890.173456789012345678",
        volume: "0.000000000000000001",
        source: "public_api",
        source_timestamp: "2026-11-24T07:59:01.000Z",
        fetched_at: capturedAt,
        status: "final",
        gap_before: false,
        gap_after: true,
      },
      {
        provider: "binance",
        product: "usdt_perpetual",
        native_symbol: "BTCUSDT",
        normalized_symbol: "BTC/USDT",
        timeframe: "1m",
        series_basis: "trade",
        open_time: "2026-11-24T08:00:00.000Z",
        close_time: "2026-11-24T08:01:00.000Z",
        open: "12345678901234567890.173456789012345678",
        high: "12345678901234567890.273456789012345678",
        low: "12345678901234567890.073456789012345678",
        close: "12345678901234567890.223456789012345678",
        volume: null,
        source: "public_api",
        source_timestamp: "2026-11-24T08:01:00.000Z",
        fetched_at: capturedAt,
        status: "partial",
        gap_before: true,
        gap_after: false,
      },
    ],
    coverage: {
      status: "gapped",
      range_start: candleRequest.from,
      range_end: candleRequest.to,
      source: "public_api",
      fetched_at: capturedAt,
      gaps: [{ series_basis: "trade", from: "2026-11-24T07:59:00.000Z", to: "2026-11-24T08:00:00.000Z" }],
      unavailable_reason: null,
    },
    warnings: ["historical_gap"],
  };
}

function validBatch(): CanonicalHistoryBatch {
  return {
    fills: [{
      provider: "binance",
      connection_id: "11111111-1111-4111-8111-111111111111",
      native_fill_id: "fill-1",
      native_order_id: "order-1",
      native_position_id: null,
      symbol: "BTCUSDT",
      native_symbol: "BTCUSDT",
      product: "usdt_perpetual",
      side: "buy",
      position_side: "long",
      action: "open",
      price: "60000",
      quantity: "0.01",
      contract_multiplier: "1",
      occurred_at: capturedAt,
      realized_pnl: { amount: "0", asset: "USDT", usd_value: "0" },
      fee: { amount: "-0.24", asset: "USDT", usd_value: "-0.24" },
      liquidity: "taker",
    }],
    cash_events: [{
      provider: "binance",
      connection_id: "11111111-1111-4111-8111-111111111111",
      native_event_id: "income-1",
      native_type: "FUNDING_FEE",
      type: "funding",
      amount: "-0.12",
      asset: "USDT",
      usd_value: "-0.12",
      occurred_at: capturedAt,
      symbol: "BTCUSDT",
      native_position_id: null,
    }],
    next_cursor: { kind: "time", value: "1732435200000" },
    exhausted: false,
    coverage_started_at: "2026-11-01T00:00:00.000Z",
    coverage_ended_at: capturedAt,
    warnings: [],
  };
}

function adapter(provider: TradingProvider): TradingProviderAdapter {
  return {
    provider,
    async validateCredentials(_input: ProviderCredentialInput) { return []; },
    async discoverCapabilities(_account: ProviderAccount) {
      return {
        products: ["usdt_perpetual"],
        history_age_days: 90,
        history_range_days: 7,
        page_size: 100,
        pagination: "time" as const,
        position_grouping: "net_zero_cycle" as const,
        has_position_id: false,
        has_realized_pnl: true,
        has_fee_asset: true,
        has_funding_or_swap: true,
        has_external_cash_flow: true,
        has_usd_valuation: true,
        account_currency: "USDT",
        settlement_assets: ["USDT"],
        valuation_pairs: ["USDT/USD"],
        candles: {
          availability: "unavailable" as const,
          timeframes: [],
          maximum_page_size: null,
          maximum_range_seconds: null,
          price_modes: [],
          unavailable_reason: "implementation_pending" as const,
        },
      };
    },
    async fetchAccountSnapshot(_account: ProviderAccount) {
      return {
        provider,
        connection_id: _account.connection_id,
        captured_at: capturedAt,
        account_currency: "USDT",
        equity: "1000",
        wallet_balance: "1000",
        unrealized_pnl: "0",
        usd_equity: "1000",
        usd_wallet_balance: "1000",
        usd_unrealized_pnl: "0",
        valuation: {
          status: "approximate" as const,
          rate: "1",
          source: "usdt_usd_approximation",
          path: ["USDT", "USD"],
          quoted_at: capturedAt,
        },
      };
    },
    async fetchHistory(_account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
      return { payload: {}, cursor, fetched_at: capturedAt };
    },
    normalizeHistory(_page: ProviderHistoryPage) { return validBatch(); },
    async fetchCandles() { return validCandleBatch(); },
  };
}

test("canonical candle batches preserve exact decimals and complete source metadata", () => {
  const batch = validCandleBatch();
  assert.equal(assertCanonicalCandleBatch(batch), batch);
  assert.equal(batch.candles[0]?.open, "12345678901234567890.123456789012345678");
  assert.equal(batch.candles[1]?.volume, null);
});

test("canonical candle batches preserve separate Exness bid and ask series for both mode", () => {
  const batch = structuredClone(validCandleBatch()) as Record<string, any>;
  batch.provider = "exness";
  batch.request = {
    ...batch.request,
    product: "cfd",
    native_symbol: "XAUUSD",
    normalized_symbol: "XAU/USD",
    price_mode: "both",
    to: "2026-11-24T07:59:00.000Z",
    limit: 4,
  };
  const base = batch.candles[0];
  batch.candles = [
    { ...base, provider: "exness", product: "cfd", native_symbol: "XAUUSD", normalized_symbol: "XAU/USD", series_basis: "bid", source: "signed_account", gap_after: false },
    { ...base, provider: "exness", product: "cfd", native_symbol: "XAUUSD", normalized_symbol: "XAU/USD", series_basis: "ask", source: "signed_account", open: "12345678901234567890.223456789012345678", high: "12345678901234567890.323456789012345678", low: "12345678901234567890.123456789012345678", close: "12345678901234567890.273456789012345678", gap_after: false },
  ];
  batch.coverage = { ...batch.coverage, status: "complete", range_end: batch.request.to, source: "signed_account", gaps: [] };

  assert.equal(assertCanonicalCandleBatch(batch), batch);
  assert.deepEqual(batch.candles.map((candle: any) => candle.series_basis), ["bid", "ask"]);
});

test("canonical candle batches preserve crypto mark price series", () => {
  const batch = structuredClone(validCandleBatch()) as Record<string, any>;
  batch.request.price_mode = "mark";
  batch.request.to = "2026-11-24T07:59:00.000Z";
  batch.request.limit = 1;
  batch.candles = [{ ...batch.candles[0], series_basis: "mark", gap_after: false }];
  batch.coverage = { ...batch.coverage, status: "complete", range_end: batch.request.to, gaps: [] };
  assert.equal(assertCanonicalCandleBatch(batch), batch);
});

test("canonical candle batches reject float prices, non-UTC timestamps, and invalid OHLC order", () => {
  const floatPrice = structuredClone(validCandleBatch()) as Record<string, any>;
  floatPrice.candles[0].open = 123.45;
  assert.throws(() => assertCanonicalCandleBatch(floatPrice), /canonical_candles_invalid_open/);

  const offsetTime = structuredClone(validCandleBatch()) as Record<string, any>;
  offsetTime.candles[0].open_time = "2026-11-24T15:58:00+08:00";
  assert.throws(() => assertCanonicalCandleBatch(offsetTime), /canonical_candles_invalid_open_time/);

  const impossibleHigh = structuredClone(validCandleBatch()) as Record<string, any>;
  impossibleHigh.candles[0].high = "1";
  assert.throws(() => assertCanonicalCandleBatch(impossibleHigh), /canonical_candles_invalid_ohlc/);

  const tooManyIntegerDigits = structuredClone(validCandleBatch()) as Record<string, any>;
  tooManyIntegerDigits.candles[0].open = "123456789012345678901";
  tooManyIntegerDigits.candles[0].high = "123456789012345678902";
  assert.throws(() => assertCanonicalCandleBatch(tooManyIntegerDigits), /canonical_candles_invalid_open/);
});

test("canonical candle batches reject unordered candles and inconsistent gap metadata", () => {
  const unordered = structuredClone(validCandleBatch()) as Record<string, any>;
  unordered.candles.reverse();
  assert.throws(() => assertCanonicalCandleBatch(unordered), /canonical_candles_invalid_order/);

  const undeclaredGap = structuredClone(validCandleBatch()) as Record<string, any>;
  undeclaredGap.coverage.status = "complete";
  assert.throws(() => assertCanonicalCandleBatch(undeclaredGap), /canonical_candles_invalid_gaps/);

  const overlap = structuredClone(validCandleBatch()) as Record<string, any>;
  overlap.candles[1].open_time = "2026-11-24T07:58:30.000Z";
  overlap.candles[1].close_time = "2026-11-24T07:59:30.000Z";
  assert.throws(() => assertCanonicalCandleBatch(overlap), /canonical_candles_invalid_overlap/);

  const unrelatedGap = structuredClone(validCandleBatch()) as Record<string, any>;
  unrelatedGap.coverage.gaps = [{ series_basis: "trade", from: "2026-11-24T07:58:30.000Z", to: "2026-11-24T07:58:45.000Z" }];
  assert.throws(() => assertCanonicalCandleBatch(unrelatedGap), /canonical_candles_invalid_gaps/);

  const falseFlag = structuredClone(validCandleBatch()) as Record<string, any>;
  falseFlag.candles[0].gap_after = false;
  assert.throws(() => assertCanonicalCandleBatch(falseFlag), /canonical_candles_invalid_gap_flags/);
});

test("canonical candle batches reject mixed providers and source kinds that contradict the provider", () => {
  const mixedProviders = structuredClone(validCandleBatch()) as Record<string, any>;
  mixedProviders.candles[1].provider = "okx";
  assert.throws(() => assertCanonicalCandleBatch(mixedProviders), /canonical_candles_invalid_provider_consistency/);

  const wrongSource = structuredClone(validCandleBatch()) as Record<string, any>;
  wrongSource.candles[0].source = "signed_account";
  assert.throws(() => assertCanonicalCandleBatch(wrongSource), /canonical_candles_invalid_source/);

  const wrongCoverageSource = structuredClone(validCandleBatch()) as Record<string, any>;
  wrongCoverageSource.coverage.source = "signed_account";
  assert.throws(() => assertCanonicalCandleBatch(wrongCoverageSource), /canonical_candles_invalid_coverage_source/);

  const wrongFetchedEvidence = structuredClone(validCandleBatch()) as Record<string, any>;
  wrongFetchedEvidence.coverage.fetched_at = "2026-11-24T08:03:00.000Z";
  assert.throws(() => assertCanonicalCandleBatch(wrongFetchedEvidence), /canonical_candles_invalid_coverage_fetched_at/);
});

test("zero-candle batches require explicit empty or unavailable coverage", () => {
  const falseComplete = structuredClone(validCandleBatch()) as Record<string, any>;
  falseComplete.candles = [];
  falseComplete.coverage = { ...falseComplete.coverage, status: "complete", gaps: [] };
  assert.throws(() => assertCanonicalCandleBatch(falseComplete), /canonical_candles_invalid_empty/);

  const empty = structuredClone(falseComplete) as Record<string, any>;
  empty.coverage.status = "empty";
  empty.warnings = ["empty_range"];
  assert.equal(assertCanonicalCandleBatch(empty), empty);
});

test("canonical candle boundary accepts only safe symbols and warning codes", () => {
  const unsafeSymbol = structuredClone(validCandleBatch()) as Record<string, any>;
  unsafeSymbol.request.normalized_symbol = "BTC/USDT api_key=secret";
  unsafeSymbol.candles[0].normalized_symbol = unsafeSymbol.request.normalized_symbol;
  unsafeSymbol.candles[1].normalized_symbol = unsafeSymbol.request.normalized_symbol;
  assert.throws(() => assertCanonicalCandleBatch(unsafeSymbol), /canonical_candles_invalid_request_normalized_symbol/);

  const rawWarning = structuredClone(validCandleBatch()) as Record<string, any>;
  rawWarning.warnings = ["upstream said api_key=secret"];
  assert.throws(() => assertCanonicalCandleBatch(rawWarning), /canonical_candles_invalid_warnings/);
});

test("provider candle capabilities are a truthful discriminated union", () => {
  const base = {
    products: ["usdt_perpetual"],
    history_age_days: 90,
    history_range_days: 7,
    page_size: 100,
    pagination: "time",
    position_grouping: "net_zero_cycle",
    has_position_id: false,
    has_realized_pnl: true,
    has_fee_asset: true,
    has_funding_or_swap: true,
    has_external_cash_flow: true,
    has_usd_valuation: true,
    account_currency: "USDT",
    settlement_assets: ["USDT"],
    valuation_pairs: ["USDT/USD"],
  };
  const value = {
    ...base,
    candles: {
      availability: "available",
      timeframes: ["1m"],
      maximum_page_size: 1_000,
      maximum_range_seconds: 86_400,
      price_modes: ["trade", "mark"],
      unavailable_reason: null,
    },
  };
  assert.equal(assertProviderCapabilities(value), value);

  const contradictory = structuredClone(value) as Record<string, any>;
  contradictory.candles.timeframes = [];
  assert.throws(() => assertProviderCapabilities(contradictory), /provider_capabilities_invalid_candles/);

  const unavailableWithLimits = structuredClone(value) as Record<string, any>;
  unavailableWithLimits.candles = {
    availability: "unavailable",
    timeframes: [],
    maximum_page_size: 1_000,
    maximum_range_seconds: null,
    price_modes: [],
    unavailable_reason: "implementation_pending",
  };
  assert.throws(() => assertProviderCapabilities(unavailableWithLimits), /provider_capabilities_invalid_candles/);

  const legacy = normalizeProviderCapabilities(base, { allowLegacyMissingCandles: true });
  assert.deepEqual(legacy.candles, {
    availability: "unavailable",
    timeframes: [],
    maximum_page_size: null,
    maximum_range_seconds: null,
    price_modes: [],
    unavailable_reason: "legacy_capability_missing",
  });
});

test("provider capabilities reject coercible non-string enum values", async () => {
  const base = await adapter("binance").discoverCapabilities({} as ProviderAccount);
  for (const pagination of [
    ["time"],
    { 0: "time" },
    1,
    { toString: () => "time" },
  ]) {
    const capabilities = structuredClone(base) as Record<string, any>;
    capabilities.pagination = pagination;
    assert.throws(() => assertProviderCapabilities(capabilities), /provider_capabilities_invalid_pagination/);
  }

  const grouping = structuredClone(base) as Record<string, any>;
  grouping.position_grouping = ["net_zero_cycle"];
  assert.throws(() => assertProviderCapabilities(grouping), /provider_capabilities_invalid_position_grouping/);
});

test("candle contracts reject single-element arrays instead of coercing enums", () => {
  for (const [field, expected] of [
    ["product", /canonical_candles_invalid_request_product/],
    ["timeframe", /canonical_candles_invalid_request_timeframe/],
    ["price_mode", /canonical_candles_invalid_request_price_mode/],
  ] as const) {
    const request = structuredClone(candleRequest) as Record<string, any>;
    request[field] = [request[field]];
    assert.throws(() => unavailableCandleBatch("binance", request as CandleRequest), expected);
  }

  for (const { error, mutate } of [{
    error: /canonical_candles_invalid_series_basis/,
    mutate(value: Record<string, any>) {
      value.candles[0].series_basis = ["trade"];
    },
  }, {
    error: /canonical_candles_invalid_source/,
    mutate(value: Record<string, any>) {
      value.candles[0].source = ["public_api"];
    },
  }, {
    error: /canonical_candles_invalid_status/,
    mutate(value: Record<string, any>) {
      value.candles[0].status = ["final"];
    },
  }, {
    error: /canonical_candles_invalid_coverage_source/,
    mutate(value: Record<string, any>) {
      value.coverage.source = ["public_api"];
    },
  }, {
    error: /canonical_candles_invalid_gaps/,
    mutate(value: Record<string, any>) {
      value.coverage.gaps[0].series_basis = ["trade"];
    },
  }]) {
    const batch = structuredClone(validCandleBatch()) as Record<string, any>;
    mutate(batch);
    assert.throws(() => assertCanonicalCandleBatch(batch), error);
  }

  const coverageStatus = structuredClone(validCandleBatch()) as Record<string, any>;
  coverageStatus.request.to = coverageStatus.candles[0].close_time;
  coverageStatus.request.limit = 1;
  coverageStatus.candles = [{ ...coverageStatus.candles[0], gap_after: false }];
  coverageStatus.coverage = {
    ...coverageStatus.coverage,
    status: ["complete"],
    range_end: coverageStatus.request.to,
    gaps: [],
  };
  coverageStatus.warnings = [];
  assert.throws(() => assertCanonicalCandleBatch(coverageStatus), /canonical_candles_invalid_coverage_status/);
});

test("canonical history rejects single-element arrays across enum fields", () => {
  const cases: Array<{ field: string; error: RegExp }> = [
    { field: "product", error: /canonical_history_invalid_product/ },
    { field: "side", error: /canonical_history_invalid_side/ },
    { field: "position_side", error: /canonical_history_invalid_position_side/ },
    { field: "action", error: /canonical_history_invalid_action/ },
    { field: "liquidity", error: /canonical_history_invalid_liquidity/ },
  ];
  for (const { field, error } of cases) {
    const batch = validBatch() as unknown as Record<string, any>;
    batch.fills[0][field] = [batch.fills[0][field]];
    assert.throws(() => assertCanonicalHistoryBatch(batch), error);
  }

  const cashType = validBatch() as unknown as Record<string, any>;
  cashType.cash_events[0].type = ["funding"];
  assert.throws(() => assertCanonicalHistoryBatch(cashType), /canonical_history_invalid_cash_event_type/);

  const cursorKind = validBatch() as unknown as Record<string, any>;
  cursorKind.next_cursor.kind = ["time"];
  assert.throws(() => assertCanonicalHistoryBatch(cursorKind), /canonical_history_invalid_cursor_kind/);
});

test("canonical candle contracts reject hidden and symbol-keyed fields", () => {
  const hiddenField = structuredClone(validCandleBatch()) as unknown as Record<string, any>;
  Object.defineProperty(hiddenField.request, "api_secret", { value: "must-not-cross-boundary", enumerable: false });
  assert.throws(() => assertCanonicalCandleBatch(hiddenField), /canonical_candles_invalid_request_keys/);

  const symbolField = structuredClone(validCandleBatch()) as unknown as Record<string, any>;
  symbolField.candles[0][Symbol("raw_response")] = "must-not-cross-boundary";
  assert.throws(() => assertCanonicalCandleBatch(symbolField), /canonical_candles_invalid_candle_keys/);
});

test("canonical history rejects unknown critical fill and cash-event enums", () => {
  const unknownPosition = validBatch() as unknown as Record<string, any>;
  unknownPosition.fills[0].position_side = "mystery";
  assert.throws(() => assertCanonicalHistoryBatch(unknownPosition), /canonical_history_invalid_position_side/);

  const unknownCashType = validBatch() as unknown as Record<string, any>;
  unknownCashType.cash_events[0].type = "rebate";
  assert.throws(() => assertCanonicalHistoryBatch(unknownCashType), /canonical_history_invalid_cash_event_type/);
});

test("registry rejects duplicate providers instead of silently replacing one", () => {
  assert.throws(
    () => createTradingProviderRegistry([adapter("binance"), adapter("binance")], ["binance"]),
    /duplicate_trading_provider:binance/,
  );
});

test("registry excludes disabled providers", () => {
  const registry = createTradingProviderRegistry([adapter("binance"), adapter("okx")], ["binance"]);
  assert.equal(registry.size, 1);
  assert.equal(registry.has("binance"), true);
  assert.equal(registry.has("okx"), false);
});

test("registry rejects adapters that expose trading mutation methods", () => {
  const unsafe = Object.assign(adapter("binance"), {
    placeOrder: async () => ({ id: "forbidden" }),
  });
  assert.throws(
    () => createTradingProviderRegistry([unsafe], ["binance"]),
    /unsafe_trading_adapter_method:placeOrder/,
  );
});

test("registry rejects adapters without the mandatory candle reader", () => {
  const incomplete = adapter("binance") as unknown as Record<string, unknown>;
  delete incomplete.fetchCandles;
  assert.throws(
    () => createTradingProviderRegistry([incomplete as unknown as TradingProviderAdapter], ["binance"]),
    /invalid_trading_adapter_method:fetchCandles/,
  );
});
