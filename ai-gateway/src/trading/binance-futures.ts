import { createHmac } from "node:crypto";

type Fetcher = typeof fetch;
const BINANCE_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const BINANCE_HISTORY_PAGE_SIZE = 1000;
const BINANCE_HISTORY_REQUEST_LIMIT = 64;
const cooldownByFetcher = new WeakMap<Fetcher, Map<string, number>>();
const ALLOWED_SIGNED_PATHS = new Set([
  "/fapi/v3/account",
  "/fapi/v1/accountConfig",
  "/fapi/v1/income",
  "/fapi/v1/userTrades",
]);

export type BinanceAccountSnapshot = {
  equityUsdt: number;
  walletBalanceUsdt: number;
  unrealizedPnlUsdt: number;
};

function finiteNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error(`binance_invalid_${field}`), { statusCode: 502 });
  return number;
}

function safeApiError(payload: unknown, responseStatus: number) {
  const code = payload && typeof payload === "object" && "code" in payload ? String((payload as { code?: unknown }).code || "") : "";
  const known = new Set(["-1021", "-1022", "-2014", "-2015"]);
  if (responseStatus === 418 || responseStatus === 429 || code === "-1003") return rateLimited();
  return Object.assign(new Error(known.has(code) ? `binance_${code.replace("-", "")}` : "binance_unavailable"), { statusCode: responseStatus >= 500 ? 503 : 400 });
}

function rateLimited() {
  return Object.assign(new Error("binance_rate_limited"), { statusCode: 429 });
}

function retryUntil(response: Response, now: number) {
  const interval = response.headers.get("retry-after")?.trim() ?? "";
  const delay = /^\d+$/.test(interval) ? Number(interval) * 1_000 : Date.parse(interval) - now;
  return now + (Number.isSafeInteger(delay) && delay > 0 ? delay : response.status === 418 ? 120_000 : 60_000);
}

export type BinanceHistoryPage = {
  trades: Array<Record<string, unknown>>;
  income: Array<Record<string, unknown>>;
  nextStartTime: number | null;
  exhausted: boolean;
};

export class BinanceFuturesClient {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;

  constructor(
    apiKey: string,
    secretKey: string,
    baseUrl = "https://fapi.binance.com",
    fetcher: Fetcher = fetch,
    now: () => number = Date.now,
  ) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
    this.now = now;
  }

  private async signed(path: string, parameters: Record<string, string | number> = {}) {
    if (!ALLOWED_SIGNED_PATHS.has(path)) throw Object.assign(new Error("binance_path_not_allowed"), { statusCode: 500 });
    const origin = new URL(this.baseUrl).origin;
    const remaining = cooldownByFetcher.get(this.fetcher)?.get(origin);
    if (remaining !== undefined && remaining > this.now()) throw rateLimited();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) query.set(key, String(value));
    query.set("recvWindow", "5000");
    query.set("timestamp", String(this.now()));
    const signature = createHmac("sha256", this.secretKey).update(query.toString()).digest("hex");
    query.set("signature", signature);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}?${query}`, {
        headers: { "X-MBX-APIKEY": this.apiKey, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw Object.assign(new Error("binance_unavailable"), { statusCode: 503 });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = safeApiError(payload, response.status);
      if (error.statusCode === 429) {
        const cooldown = cooldownByFetcher.get(this.fetcher) ?? new Map<string, number>();
        cooldown.set(origin, Math.max(cooldown.get(origin) ?? 0, retryUntil(response, this.now())));
        cooldownByFetcher.set(this.fetcher, cooldown);
      }
      throw error;
    }
    return payload;
  }

  async accountDetails(): Promise<{ account: Record<string, unknown>; configuration: Record<string, unknown> }> {
    const [account, configuration] = await Promise.all([
      this.signed("/fapi/v3/account"),
      this.signed("/fapi/v1/accountConfig"),
    ]) as [Record<string, unknown>, Record<string, unknown>];
    if (configuration.multiAssetsMargin === true) {
      throw Object.assign(new Error("binance_multi_asset_not_supported"), { statusCode: 400 });
    }
    return { account, configuration };
  }

  async accountSnapshot(): Promise<BinanceAccountSnapshot> {
    const { account } = await this.accountDetails();
    const equityUsdt = finiteNumber(account.totalMarginBalance, "equity");
    const walletBalanceUsdt = finiteNumber(account.totalWalletBalance, "wallet_balance");
    const unrealizedPnlUsdt = finiteNumber(account.totalUnrealizedProfit, "unrealized_pnl");
    if (equityUsdt < 0) throw Object.assign(new Error("binance_invalid_equity"), { statusCode: 502 });
    return { equityUsdt, walletBalanceUsdt, unrealizedPnlUsdt };
  }

  async historyPage(startTime: number, knownSymbols: readonly string[] = []): Promise<BinanceHistoryPage> {
    if (!Number.isSafeInteger(startTime) || startTime < 0) {
      throw Object.assign(new Error("binance_invalid_history_cursor"), { statusCode: 400 });
    }
    const until = this.now();
    if (startTime > until) return { trades: [], income: [], nextStartTime: null, exhausted: true };
    const endTime = Math.min(startTime + BINANCE_HISTORY_WINDOW_MS, until);
    let requests = 0;
    const readWindow = async (
      path: "/fapi/v1/income" | "/fapi/v1/userTrades", from: number, to: number, symbol?: string,
    ): Promise<Array<Record<string, unknown>>> => {
      if (++requests > BINANCE_HISTORY_REQUEST_LIMIT) {
        throw Object.assign(new Error("binance_income_window_too_large"), { statusCode: 409 });
      }
      const rows = await this.signed(path, { startTime: from, endTime: to, limit: BINANCE_HISTORY_PAGE_SIZE,
        ...(symbol === undefined ? {} : { symbol }) });
      if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
        throw Object.assign(new Error(symbol === undefined ? "binance_invalid_income" : "binance_invalid_trades"), { statusCode: 502 });
      }
      if (rows.length < BINANCE_HISTORY_PAGE_SIZE) return rows;
      if (from >= to) throw Object.assign(new Error("binance_income_window_too_large"), { statusCode: 409 });
      const middle = from + Math.floor((to - from) / 2);
      return [...await readWindow(path, from, middle, symbol), ...await readWindow(path, middle + 1, to, symbol)];
    };
    const income = await readWindow("/fapi/v1/income", startTime, endTime);
    const symbols = new Set([...knownSymbols, ...income.map((row) => row.symbol)]
      .filter((symbol): symbol is string => typeof symbol === "string" && /^[A-Z0-9]{1,32}$/.test(symbol)));
    const trades: Array<Record<string, unknown>> = [];
    for (const symbol of symbols) {
      trades.push(...await readWindow("/fapi/v1/userTrades", startTime, endTime, symbol));
    }
    return { trades, income, nextStartTime: endTime < until ? endTime + 1 : null, exhausted: endTime === until };
  }

  async netExternalTransfers(startTime: number, endTime: number): Promise<number> {
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return 0;
    let total = 0;
    for (let page = 1; page <= 10; page += 1) {
      const rows = await this.signed("/fapi/v1/income", {
        incomeType: "TRANSFER",
        startTime: Math.floor(startTime),
        endTime: Math.floor(endTime),
        page,
        limit: 1000,
      });
      if (!Array.isArray(rows)) throw Object.assign(new Error("binance_invalid_income"), { statusCode: 502 });
      for (const row of rows as Array<Record<string, unknown>>) {
        if (String(row.asset || "").toUpperCase() !== "USDT") {
          throw Object.assign(new Error("binance_transfer_asset_not_supported"), { statusCode: 400 });
        }
        total += finiteNumber(row.income, "income");
      }
      if (rows.length < 1000) return total;
    }
    throw Object.assign(new Error("binance_income_window_too_large"), { statusCode: 409 });
  }
}
