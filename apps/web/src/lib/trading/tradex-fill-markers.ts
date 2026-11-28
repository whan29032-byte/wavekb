import type { FillMarker, TradeChartProjection } from "@wavekb/domain/trading-review";
import { TRADEX_TIMEFRAMES, type TradeXMarket, type TradeXMarker, type TradeXTimeframe } from "./tradex-bridge";

export function tradeXMarketForProjection(projection: TradeChartProjection): TradeXMarket | null {
  if (projection.provider !== "binance" || projection.product !== "usdt_perpetual" || projection.price_type !== "trade"
    || !(TRADEX_TIMEFRAMES as readonly string[]).includes(projection.timeframe)) return null;
  const canonical = /^([A-Z0-9]{2,24})\/?USDT$/.exec(projection.symbol);
  if (!canonical || projection.native_symbol !== `${canonical[1]}USDT`) return null;
  return { provider: "binance", product: "usdt_perpetual", symbol: projection.native_symbol, timeframe: projection.timeframe as TradeXTimeframe };
}

export function toTradeXMarkers(market: TradeXMarket, projection: TradeChartProjection): TradeXMarker[] {
  const identity = tradeXMarketForProjection(projection);
  if (!identity || market.provider !== identity.provider || market.product !== identity.product || market.symbol !== identity.symbol) return [];
  return projection.markers.map((fill, index) => ({
    marker: `m${index + 1}`, timestamp: fill.occurred_at, price: fill.price, role: fill.allocation_role,
  }));
}

const periodMs: Record<TradeXTimeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

/** Start with a period that includes the oldest selected fill in the chart's 600-bar load. */
export function fitTradeXTimeframe(market: TradeXMarket, fills: readonly Pick<FillMarker, "occurred_at">[], nowMs: number): TradeXMarket {
  const oldest = fills.reduce((value, { occurred_at }) => {
    const timestamp = Date.parse(occurred_at);
    return Number.isFinite(timestamp) ? Math.min(value, timestamp) : value;
  }, nowMs);
  const timeframe = TRADEX_TIMEFRAMES.find((period) => periodMs[period] >= periodMs[market.timeframe] && (nowMs - oldest) < periodMs[period] * 550) ?? "1d";
  return timeframe === market.timeframe ? market : { ...market, timeframe };
}
