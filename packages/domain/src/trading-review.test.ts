import { describe, expect, it } from "vitest";
import { TRADING_PROVIDERS, isTradingProvider } from "./trading-review";

describe("trading provider domain", () => {
  it("round-trips the five supported providers and rejects unknown values", () => {
    expect([...TRADING_PROVIDERS]).toEqual(["binance", "okx", "bybit", "bitget", "exness"]);
    for (const provider of TRADING_PROVIDERS) expect(isTradingProvider(provider)).toBe(true);
    expect(isTradingProvider("coinbase")).toBe(false);
    expect(isTradingProvider(null)).toBe(false);
  });
});
