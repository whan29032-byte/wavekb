import assert from "node:assert/strict";
import test from "node:test";
import { BinanceFuturesClient } from "../src/trading/binance-futures.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("reads a single-asset USD-M account through signed USER_DATA requests", async () => {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/fapi/v1/accountConfig") return json({ multiAssetsMargin: false });
    return json({ totalMarginBalance: "123.50", totalWalletBalance: "120.00", totalUnrealizedProfit: "3.50" });
  };
  const client = new BinanceFuturesClient("api-key-example-value", "secret-key-example-value", "https://fapi.binance.com", fetcher, () => 1_700_000_000_000);
  assert.deepEqual(await client.accountSnapshot(), { equityUsdt: 123.5, walletBalanceUsdt: 120, unrealizedPnlUsdt: 3.5 });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.headers.get("X-MBX-APIKEY"), "api-key-example-value");
    assert.equal(call.url.searchParams.get("timestamp"), "1700000000000");
    assert.match(call.url.searchParams.get("signature") || "", /^[a-f0-9]{64}$/);
    assert.equal(call.url.toString().includes("secret-key-example-value"), false);
  }
});

test("uses only USDT transfers as external cash flow and rejects unsupported multi-asset accounting", async () => {
  const transferFetcher: typeof fetch = async () => json([
    { asset: "USDT", income: "100" },
    { asset: "USDT", income: "-25.5" },
  ]);
  const transferClient = new BinanceFuturesClient("api-key-example-value", "secret-key-example-value", "https://fapi.binance.com", transferFetcher);
  assert.equal(await transferClient.netExternalTransfers(1000, 2000), 74.5);

  const multiAssetFetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith("accountConfig")
    ? json({ multiAssetsMargin: true })
    : json({ totalMarginBalance: "100", totalWalletBalance: "100", totalUnrealizedProfit: "0" });
  const multiAssetClient = new BinanceFuturesClient("api-key-example-value", "secret-key-example-value", "https://fapi.binance.com", multiAssetFetcher);
  await assert.rejects(() => multiAssetClient.accountSnapshot(), /multi_asset_not_supported/);
});

test("does not expose Binance error messages or credentials", async () => {
  const fetcher: typeof fetch = async () => json({ code: -2015, msg: "Invalid API-key api-key-example-value" }, 401);
  const client = new BinanceFuturesClient("api-key-example-value", "secret-key-example-value", "https://fapi.binance.com", fetcher);
  await assert.rejects(() => client.accountSnapshot(), (error: Error) => {
    assert.equal(error.message, "binance_2015");
    assert.equal(error.message.includes("api-key-example-value"), false);
    return true;
  });
});
