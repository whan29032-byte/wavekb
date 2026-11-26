import { describe, expect, it } from "vitest";
import {
  TRADE_CHART_CANDLE_SERIES_BASES,
  TRADE_CHART_CANDLE_SOURCES,
  TRADE_CHART_COVERAGE_STATUSES,
  TRADE_CHART_DRAWING_TOOL_SCHEMAS,
  TRADE_CHART_DRAWING_TOOL_IDS,
  TRADE_CHART_INDICATOR_IDS,
  TRADE_CHART_PRICE_TYPES,
  TRADE_CHART_PROJECTION_SCHEMA_VERSION,
  TRADE_CHART_STATE_SCHEMA_VERSION,
  TRADE_CHART_TIMEFRAMES,
  TRADING_PROVIDERS,
  isTradingProvider,
} from "./trading-review";

describe("trading provider domain", () => {
  it("round-trips the five supported providers and rejects unknown values", () => {
    expect([...TRADING_PROVIDERS]).toEqual(["binance", "okx", "bybit", "bitget", "exness"]);
    for (const provider of TRADING_PROVIDERS) expect(isTradingProvider(provider)).toBe(true);
    expect(isTradingProvider("coinbase")).toBe(false);
    expect(isTradingProvider(null)).toBe(false);
  });
});

describe("trade chart domain contract", () => {
  it("keeps version, timeframe, price, indicator, and drawing allowlists aligned with persistence", () => {
    expect(TRADE_CHART_STATE_SCHEMA_VERSION).toBe("wavekb-trade-chart-v1");
    expect(TRADE_CHART_PROJECTION_SCHEMA_VERSION).toBe("wavekb-trade-chart-projection-v1");
    expect([...TRADE_CHART_TIMEFRAMES]).toEqual([
      "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M",
    ]);
    expect([...TRADE_CHART_PRICE_TYPES]).toEqual(["trade", "mark", "bid", "ask", "both"]);
    expect([...TRADE_CHART_CANDLE_SERIES_BASES]).toEqual(["trade", "mark", "bid", "ask"]);
    expect([...TRADE_CHART_CANDLE_SOURCES]).toEqual(["public_api", "signed_account"]);
    expect([...TRADE_CHART_COVERAGE_STATUSES]).toEqual(["complete", "partial", "gapped", "stale", "empty", "unavailable"]);
    expect([...TRADE_CHART_INDICATOR_IDS]).toEqual([
      "sma", "ema", "wma", "hma", "vwap", "bollinger", "rsi", "macd", "stochastic", "adx", "atr",
      "supertrend", "ichimoku", "donchian", "keltner-channel", "chandelier-exit", "zigzag",
      "williams-fractals", "pivot-points", "cpr", "obv", "mfi", "chaikin-money-flow",
    ]);
    expect([...TRADE_CHART_DRAWING_TOOL_IDS]).toEqual([
      "trend-line", "ray", "horizontal-line", "vertical-line", "rectangle", "text", "long-position", "short-position",
      "fib-retracement", "fib-extension", "fib-time-zone", "fib-fan", "fib-channel", "elliott-impulse",
      "elliott-correction", "elliott-triangle", "elliott-double-combo", "elliott-triple-combo",
    ]);
    expect(Object.fromEntries(Object.entries(TRADE_CHART_DRAWING_TOOL_SCHEMAS).map(([tool, schema]) => [tool, schema.pointCount]))).toEqual({
      "trend-line": 2,
      ray: 2,
      "horizontal-line": 1,
      "vertical-line": 1,
      rectangle: 2,
      text: 1,
      "long-position": 2,
      "short-position": 2,
      "fib-retracement": 2,
      "fib-extension": 3,
      "fib-time-zone": 2,
      "fib-fan": 2,
      "fib-channel": 3,
      "elliott-impulse": 6,
      "elliott-correction": 4,
      "elliott-triangle": 6,
      "elliott-double-combo": 4,
      "elliott-triple-combo": 6,
    });
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["trend-line"].styleKeys).toContain("showStats");
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS.ray.styleKeys).toContain("showStats");
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["long-position"].styleKeys).toEqual(expect.arrayContaining(["accountSize", "risk"]));
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["short-position"].styleKeys).toEqual(expect.arrayContaining(["accountSize", "risk"]));
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["horizontal-line"].textKeys).not.toEqual(expect.arrayContaining(["align", "valign"]));
  });
});
