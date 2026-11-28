export const TRADEX_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type TradeXTimeframe = typeof TRADEX_TIMEFRAMES[number];
export type TradeXMarket = { provider: "binance"; product: "usdt_perpetual"; symbol: string; timeframe: TradeXTimeframe };
export type TradeXMarker = { marker: string; timestamp: string; price: string; role: "open" | "add" | "reduce" | "close" | "reverse_open" };
export type TradeXMessage =
  | { v: 1; type: "ready"; session: string; epoch: string }
  | { v: 1; type: "marker-selected"; session: string; marker: string };

export const DEFAULT_TRADEX_MARKET: TradeXMarket = { provider: "binance", product: "usdt_perpetual", symbol: "BTCUSDT", timeframe: "1m" };

export function parseTradeXOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (value === url.origin || value === `${url.origin}/`) ? url : null;
  } catch { return null; }
}

const nonce = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function parseTradeXMessage(value: unknown): TradeXMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { v, type, session, epoch, marker } = value as Record<string, unknown>;
  if (v !== 1 || typeof session !== "string" || !nonce.test(session) || Object.keys(value).length !== 4) return null;
  if (type === "ready" && typeof epoch === "string" && nonce.test(epoch)) return { v, type, session, epoch };
  if (type === "marker-selected" && typeof marker === "string" && /^m[1-9]\d{0,5}$/.test(marker)) return { v, type, session, marker };
  return null;
}
