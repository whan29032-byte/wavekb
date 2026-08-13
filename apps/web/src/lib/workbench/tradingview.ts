export type TradingViewPackage = {
  version: 1;
  provider: "tradingview";
  chart_url: string;
  symbol: string;
  interval: string;
  theme: "auto" | "light" | "dark";
  imported_at: string;
  layout: { content: unknown; summary?: Record<string, unknown> } | null;
};

export function normalizeTradingViewSymbol(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "").replace(/[^A-Za-z0-9:_./-]/g, "").toUpperCase().slice(0, 80);
}

export function normalizeTradingViewInterval(value: unknown) {
  const raw = String(value ?? "").trim().slice(0, 16);
  return ({ "1分钟": "1", "5分钟": "5", "15分钟": "15", "1小时": "60", "4小时": "240", "日线": "D", "周线": "W", "月线": "M" } as Record<string, string>)[raw] || raw || "D";
}

export function parseTradingViewInput(value: string) {
  const raw = value.trim().slice(0, 2000);
  if (!raw) return { chartUrl: "", symbol: "", interval: "" };
  if (!/^https?:\/\//i.test(raw)) return { chartUrl: "", symbol: normalizeTradingViewSymbol(raw), interval: "" };
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || (host !== "tradingview.com" && !host.endsWith(".tradingview.com"))) {
    throw new Error("请输入 TradingView 的完整 https 图表链接。");
  }
  let symbol = normalizeTradingViewSymbol(url.searchParams.get("symbol"));
  if (!symbol) {
    const pathSymbol = url.pathname.match(/\/symbols\/([^/?#]+)\/?$/i)?.[1];
    if (pathSymbol) {
      const decoded = decodeURIComponent(pathSymbol);
      const separator = decoded.indexOf("-");
      symbol = normalizeTradingViewSymbol(separator > 0 ? `${decoded.slice(0, separator)}:${decoded.slice(separator + 1)}` : decoded);
    }
  }
  return { chartUrl: url.toString(), symbol, interval: normalizeTradingViewInterval(url.searchParams.get("interval") || "") };
}

export function buildTradingViewPackage(input: {
  source: string;
  symbol: string;
  interval: string;
  theme: string;
  layout?: TradingViewPackage["layout"];
}): TradingViewPackage | null {
  const parsed = parseTradingViewInput(input.source);
  const symbol = normalizeTradingViewSymbol(input.symbol || parsed.symbol);
  const interval = normalizeTradingViewInterval(input.interval || parsed.interval);
  if (!parsed.chartUrl && !symbol && !input.layout) return null;
  return {
    version: 1,
    provider: "tradingview",
    chart_url: parsed.chartUrl,
    symbol,
    interval,
    theme: ["light", "dark"].includes(input.theme) ? input.theme as "light" | "dark" : "auto",
    imported_at: new Date().toISOString(),
    layout: input.layout ?? null,
  };
}

export function parseTradingViewPackage(text: string): TradingViewPackage {
  if (new Blob([text]).size > 800_000) throw new Error("图表配置不能超过 800 KB。");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("无法识别该配置，请导入有效的 JSON 文件。"); }
  const value = parsed as Partial<TradingViewPackage>;
  if (value.provider !== "tradingview") throw new Error("该文件不是 TradingView 图表配置。");
  return buildTradingViewPackage({
    source: String(value.chart_url || ""),
    symbol: String(value.symbol || ""),
    interval: String(value.interval || "D"),
    theme: String(value.theme || "auto"),
    layout: value.layout ?? null,
  })!;
}

export function tradingViewEmbedUrl(value: TradingViewPackage) {
  const query = new URLSearchParams({
    symbol: value.symbol || "NASDAQ:AAPL",
    interval: normalizeTradingViewInterval(value.interval),
    theme: value.theme === "light" ? "light" : "dark",
    style: "1",
    locale: "zh_CN",
    hide_top_toolbar: "0",
  });
  return `https://www.tradingview.com/widgetembed/?${query}`;
}
