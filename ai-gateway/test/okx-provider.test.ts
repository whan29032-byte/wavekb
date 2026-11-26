import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { OkxTradingProviderAdapter } from "../src/trading/providers/okx.ts";
import type { ProviderAccount, ProviderHistoryPage } from "../src/trading/providers/contracts.ts";

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
      candles: { availability: "unavailable", timeframes: [], maximum_page_size: null, maximum_range_seconds: null, price_bases: [], unavailable_reason: "implementation_pending" },
    },
  };
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
