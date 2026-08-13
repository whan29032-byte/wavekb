import { describe, expect, it } from "vitest";
import { buildTradingViewPackage, parseTradingViewInput, parseTradingViewPackage } from "./tradingview";

describe("TradingView binding", () => {
  it("accepts symbols and safe TradingView links", () => {
    expect(parseTradingViewInput(" binance:btcusdt ").symbol).toBe("BINANCE:BTCUSDT");
    expect(parseTradingViewInput("https://www.tradingview.com/chart/demo/?symbol=NASDAQ%3AAAPL&interval=60")).toMatchObject({ symbol: "NASDAQ:AAPL", interval: "60" });
  });

  it("rejects lookalike hosts", () => {
    expect(() => parseTradingViewInput("https://tradingview.com.attacker.example/chart/?symbol=AAPL")).toThrow("TradingView");
  });

  it("round trips an exported package", () => {
    const value = buildTradingViewPackage({ source: "BINANCE:BTCUSDT", symbol: "", interval: "4小时", theme: "auto" });
    expect(parseTradingViewPackage(JSON.stringify(value))).toMatchObject({ symbol: "BINANCE:BTCUSDT", interval: "240" });
  });
});
