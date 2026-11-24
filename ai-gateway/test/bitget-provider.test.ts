import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BitgetTradingProviderAdapter } from "../src/trading/providers/bitget.ts";
import type { ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

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
    },
  };
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
