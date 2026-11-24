import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanonicalHistoryBatch,
  type CanonicalHistoryBatch,
  type ProviderAccount,
  type ProviderCredentialInput,
  type ProviderCursor,
  type ProviderHistoryPage,
  type TradingProvider,
  type TradingProviderAdapter,
} from "../src/trading/providers/contracts.ts";
import { createTradingProviderRegistry } from "../src/trading/providers/registry.ts";

const capturedAt = "2026-11-24T08:00:00.000Z";

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
  };
}

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
