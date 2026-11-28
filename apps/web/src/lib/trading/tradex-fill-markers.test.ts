import type { TradeChartProjection } from "@wavekb/domain/trading-review";
import { describe, expect, it } from "vitest";
import { DEFAULT_TRADEX_MARKET } from "./tradex-bridge";
import { fitTradeXTimeframe, toTradeXMarkers, tradeXMarketForProjection } from "./tradex-fill-markers";

const projection = {
  provider: "binance", product: "usdt_perpetual", symbol: "BTC/USDT", native_symbol: "BTCUSDT", timeframe: "1m", price_type: "trade",
  markers: [
    { fill_id: "secret1", marker_key: "private1", occurred_at: "2026-11-28T08:01:02.123Z", price: "60012.01", allocated_quantity: "123.456", allocation_role: "open", annotation: { body: "private note" } },
    { fill_id: "secret2", marker_key: "private2", occurred_at: "2026-11-28T08:01:09.012Z", price: "60014.50", allocated_quantity: "11.22", allocation_role: "add", annotation: null },
  ],
} as TradeChartProjection;

describe("TradeX fill packet", () => {
  it("accepts the Binance adapter's stored native-style cycle symbol", () => {
    expect(tradeXMarketForProjection({ ...projection, symbol: "BTCUSDT" })).toEqual(DEFAULT_TRADEX_MARKET);
  });
  it("matches listed contracts with a one-character base without accepting a different market", () => {
    expect(tradeXMarketForProjection({ ...projection, symbol: "W/USDT", native_symbol: "WUSDT" })?.symbol).toBe("WUSDT");
    expect(tradeXMarketForProjection({ ...projection, symbol: "WUSDT", native_symbol: "WUSDT" })?.symbol).toBe("WUSDT");
    expect(tradeXMarketForProjection({ ...projection, symbol: "W/USDT", native_symbol: "SUSDT" })).toBeNull();
  });
  it("uses a longer chart period if a previous fill would fall out of the live chart's initial history", () => {
    expect(fitTradeXTimeframe(DEFAULT_TRADEX_MARKET, projection.markers, Date.parse("2026-11-28T09:00:00Z")).timeframe).toBe("1m");
    expect(fitTradeXTimeframe(DEFAULT_TRADEX_MARKET, projection.markers, Date.parse("2026-11-29T08:00:00Z")).timeframe).toBe("5m");
    expect(fitTradeXTimeframe(DEFAULT_TRADEX_MARKET, projection.markers, Date.parse("2026-11-30T20:00:00Z")).timeframe).toBe("15m");
  });
  it("keeps each fill at exact time and price without including private fields", () => {
    expect(tradeXMarketForProjection(projection)).toEqual(DEFAULT_TRADEX_MARKET);
    expect(toTradeXMarkers(DEFAULT_TRADEX_MARKET, projection)).toEqual([
      { marker: "m1", timestamp: "2026-11-28T08:01:02.123Z", price: "60012.01", role: "open" },
      { marker: "m2", timestamp: "2026-11-28T08:01:09.012Z", price: "60014.50", role: "add" },
    ]);
  });

  it("refuses a different market and conflicting native and canonical symbols", () => {
    expect(toTradeXMarkers({ ...DEFAULT_TRADEX_MARKET, symbol: "ETHUSDT" }, projection)).toEqual([]);
    for (const overrides of [{ provider: "bybit" }, { product: "usdt_delivery" }, { native_symbol: "ETHUSDT" }, { price_type: "mark" }]) {
      const mismatched = { ...projection, ...overrides } as TradeChartProjection;
      expect(tradeXMarketForProjection(mismatched)).toBeNull();
      expect(toTradeXMarkers(DEFAULT_TRADEX_MARKET, mismatched)).toEqual([]);
    }
  });
});
