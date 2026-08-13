(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottTVReview = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_LAYOUT_BYTES = 800000;
  const INTERVAL_ALIASES = {
    "1分钟": "1",
    "3分钟": "3",
    "5分钟": "5",
    "15分钟": "15",
    "30分钟": "30",
    "45分钟": "45",
    "1小时": "60",
    "2小时": "120",
    "3小时": "180",
    "4小时": "240",
    "日线": "D",
    "周线": "W",
    "月线": "M"
  };
  const INTERVAL_LABELS = Object.freeze({
    "1": "1分钟",
    "3": "3分钟",
    "5": "5分钟",
    "15": "15分钟",
    "30": "30分钟",
    "45": "45分钟",
    "60": "1小时",
    "120": "2小时",
    "180": "3小时",
    "240": "4小时",
    "D": "日线",
    "W": "周线",
    "M": "月线"
  });

  function cleanText(value, limit) {
    return String(value || "").trim().slice(0, limit);
  }

  function normalizeInterval(value) {
    const raw = cleanText(value, 16);
    return INTERVAL_ALIASES[raw] || raw || "D";
  }

  function normalizeSymbol(value) {
    return cleanText(value, 80)
      .replace(/\s+/g, "")
      .replace(/[^A-Za-z0-9:_./-]/g, "")
      .toUpperCase();
  }

  function intervalLabel(value) {
    const normalized = normalizeInterval(value);
    return INTERVAL_LABELS[normalized] || cleanText(value, 16) || "日线";
  }

  function marketGroupForSymbol(value) {
    const symbol = normalizeSymbol(value);
    const [exchange, ticker = ""] = symbol.includes(":")
      ? symbol.split(":", 2)
      : ["", symbol];
    if (/XAU|GOLD|XAG|SILVER|PLATINUM|PALLADIUM/.test(ticker)) return "precious_metals";
    if (/^(BINANCE|COINBASE|BYBIT|OKX|KRAKEN|BITSTAMP|BITGET)$/.test(exchange)) return "crypto";
    if (/^(FX|OANDA|FOREXCOM|FX_IDC)$/.test(exchange)) return "forex";
    if (/^(SPX|NDX|DJI|IXIC|RUT|HSI|HSCEI|N225|NI225|DAX|UKX)$/.test(ticker)) return "indices";
    if (/^(NASDAQ|NYSE|AMEX|HKEX|SSE|SZSE)$/.test(exchange)) return "stocks";
    if (/^(NYMEX|COMEX|CBOT|CME|ICEUS|ICEEUR)$/.test(exchange)) return "commodities";
    return "";
  }

  function parseChartUrl(rawUrl) {
    const value = cleanText(rawUrl, 2000);
    if (!value) return {url: "", symbol: "", interval: ""};
    if (!/^https?:\/\//i.test(value)) {
      return {url: "", symbol: normalizeSymbol(value), interval: ""};
    }
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !(
      host === "tradingview.com"
      || host.endsWith(".tradingview.com")
    )) {
      throw new Error("请输入 TradingView 的完整 https 图表链接。");
    }
    let symbol = normalizeSymbol(url.searchParams.get("symbol") || "");
    if (!symbol) {
      const pathMatch = url.pathname.match(/\/symbols\/([^/?#]+)\/?$/i);
      const pathSymbol = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
      if (pathSymbol) {
        const separator = pathSymbol.indexOf("-");
        symbol = normalizeSymbol(separator > 0
          ? `${pathSymbol.slice(0, separator)}:${pathSymbol.slice(separator + 1)}`
          : pathSymbol);
      }
    }
    return {
      url: url.toString(),
      symbol,
      interval: url.searchParams.get("interval")
        ? normalizeInterval(url.searchParams.get("interval"))
        : "",
      theme: normalizeTheme(
        url.searchParams.get("theme")
        || url.searchParams.get("colorTheme")
        || url.searchParams.get("appearance")
      )
    };
  }

  function normalizeTheme(value) {
    const theme = cleanText(value, 16).toLowerCase();
    if (["light", "white", "day"].includes(theme)) return "light";
    if (["dark", "black", "night"].includes(theme)) return "dark";
    return "auto";
  }

  function resolvedTheme(value, view) {
    const theme = normalizeTheme(value);
    if (theme !== "auto") return theme;
    const documentTheme = view && view.document && view.document.documentElement
      ? String(view.document.documentElement.dataset.theme || "").toLowerCase()
      : "";
    if (documentTheme === "light" || documentTheme === "dark") return documentTheme;
    return view && typeof view.matchMedia === "function"
      && view.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function visit(value, path, result, depth) {
    if (depth > 10 || value == null) return;
    if (Array.isArray(value)) {
      value.slice(0, 300).forEach((item, index) => {
        visit(item, `${path}[${index}]`, result, depth + 1);
      });
      return;
    }
    if (typeof value !== "object") return;
    Object.entries(value).slice(0, 300).forEach(([key, item]) => {
      const lower = key.toLowerCase();
      if (!result.symbol && ["symbol", "shortname", "ticker"].includes(lower)) {
        result.symbol = normalizeSymbol(item);
      }
      if (!result.interval && ["interval", "resolution", "timeframe"].includes(lower)) {
        result.interval = normalizeInterval(item);
      }
      if (
        ["studies", "studytemplates", "indicators"].includes(lower)
        && Array.isArray(item)
      ) {
        result.indicatorCount = Math.max(result.indicatorCount, item.length);
      }
      if (
        ["drawings", "linetools", "sources"].includes(lower)
        && Array.isArray(item)
      ) {
        result.drawingCount = Math.max(result.drawingCount, item.length);
      }
      visit(item, path ? `${path}.${key}` : key, result, depth + 1);
    });
  }

  function parseLayoutText(text) {
    const source = String(text || "");
    if (!source.trim()) return null;
    if (new Blob([source]).size > MAX_LAYOUT_BYTES) {
      throw new Error("图表配置不能超过 800 KB。");
    }
    let content;
    try {
      content = JSON.parse(source);
    } catch (_) {
      throw new Error("无法识别该配置，请导入有效的 JSON 文件。");
    }
    const summary = {
      symbol: "",
      interval: "",
      indicatorCount: 0,
      drawingCount: 0
    };
    visit(content, "", summary, 0);
    return {content, summary};
  }

  function buildPackage(input) {
    const source = input || {};
    const fromUrl = parseChartUrl(source.chartUrl || "");
    const layout = source.layoutText
      ? parseLayoutText(source.layoutText)
      : source.layout && source.layout.content
        ? source.layout
        : null;
    const symbol = normalizeSymbol(
      source.symbol || layout && layout.summary && layout.summary.symbol || fromUrl.symbol
    );
    const interval = normalizeInterval(
      source.interval || layout && layout.summary && layout.summary.interval || fromUrl.interval
    );
    if (!fromUrl.url && !layout && !symbol) {
      return null;
    }
    return {
      version: 1,
      provider: "tradingview",
      chart_url: fromUrl.url,
      symbol,
      interval,
      theme: normalizeTheme(source.theme || fromUrl.theme),
      imported_at: new Date().toISOString(),
      layout: layout
        ? {
          content: layout.content,
          summary: {
            symbol: normalizeSymbol(layout.summary && layout.summary.symbol),
            interval: normalizeInterval(layout.summary && layout.summary.interval),
            indicatorCount: Number(layout.summary && layout.summary.indicatorCount || 0),
            drawingCount: Number(layout.summary && layout.summary.drawingCount || 0)
          }
        }
        : null
    };
  }

  function widgetConfig(chartPackage, view) {
    const value = chartPackage || {};
    return {
      autosize: true,
      symbol: normalizeSymbol(value.symbol) || "NASDAQ:AAPL",
      interval: normalizeInterval(value.interval),
      timezone: "Asia/Shanghai",
      theme: resolvedTheme(value.theme, view),
      style: "1",
      locale: "zh_CN",
      allow_symbol_change: true,
      save_image: true,
      calendar: false,
      details: false,
      hotlist: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      withdateranges: true,
      studies: []
    };
  }

  function mountWidget(container, chartPackage) {
    if (!container || !chartPackage) return;
    container.replaceChildren();
    const widget = container.ownerDocument.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    const script = container.ownerDocument.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify(widgetConfig(
      chartPackage,
      container.ownerDocument && container.ownerDocument.defaultView
    ));
    container.append(widget, script);
  }

  function exportFile(chartPackage) {
    const content = JSON.stringify(chartPackage, null, 2);
    return new Blob([content], {type: "application/json;charset=utf-8"});
  }

  const CONNECTION_KEY = "wavekb:tradingview-connection-v1";

  function normalizeProfileUrl(value) {
    const raw = cleanText(value, 500);
    if (!raw) return "";
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://www.tradingview.com/u/${raw}/`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || host !== "tradingview.com") {
      throw new Error("请输入 TradingView 用户名或 tradingview.com 资料链接。");
    }
    return url.toString();
  }

  function readConnection(view) {
    try {
      const stored = view && view.localStorage
        ? JSON.parse(view.localStorage.getItem(CONNECTION_KEY) || "null")
        : null;
      return stored && typeof stored === "object" ? stored : null;
    } catch (_) {
      return null;
    }
  }

  function saveConnection(view, value) {
    const profileUrl = normalizeProfileUrl(value && (value.profileUrl || value.username));
    const connection = {
      provider: "tradingview",
      username: cleanText(value && value.username, 80),
      profile_url: profileUrl,
      preferred_theme: normalizeTheme(value && value.theme),
      connected_at: new Date().toISOString()
    };
    if (view && view.localStorage) {
      view.localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    }
    return connection;
  }

  return {
    MAX_LAYOUT_BYTES,
    normalizeInterval,
    normalizeTheme,
    resolvedTheme,
    intervalLabel,
    normalizeSymbol,
    marketGroupForSymbol,
    parseChartUrl,
    parseLayoutText,
    buildPackage,
    widgetConfig,
    mountWidget,
    exportFile,
    normalizeProfileUrl,
    readConnection,
    saveConnection
  };
});
