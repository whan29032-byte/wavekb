import assert from "node:assert/strict";
import test from "node:test";
import { BinanceTradingProviderAdapter } from "../src/trading/providers/binance.ts";
import type { ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function account(credentials: Record<string, string> = { api_key: "key", secret_key: "secret" }): ProviderAccount {
  return {
    connection_id: "11111111-1111-4111-8111-111111111111", external_account_id: "alias-123456", account_currency: "USDT", credentials,
    capabilities: {
      products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7, page_size: 1000, pagination: "time",
      position_grouping: "hedge_zero_cycle", has_position_id: false, has_realized_pnl: true, has_fee_asset: true,
      has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true, account_currency: "USDT",
      settlement_assets: ["USDT"], valuation_pairs: ["USDT/USD"],
    },
  };
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
