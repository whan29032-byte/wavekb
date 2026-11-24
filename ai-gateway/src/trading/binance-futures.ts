import { createHmac } from "node:crypto";

type Fetcher = typeof fetch;
const BINANCE_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
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
  return Object.assign(new Error(known.has(code) ? `binance_${code.replace("-", "")}` : responseStatus === 429 ? "binance_rate_limited" : "binance_unavailable"), { statusCode: responseStatus === 429 ? 429 : responseStatus >= 500 ? 503 : 400 });
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
    if (!response.ok) throw safeApiError(payload, response.status);
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

  async historyPage(startTime: number): Promise<BinanceHistoryPage> {
    if (!Number.isFinite(startTime) || startTime < 0) throw Object.assign(new Error("binance_invalid_history_cursor"), { statusCode: 400 });
    const endTime = Math.min(Math.floor(startTime) + BINANCE_HISTORY_WINDOW_MS, this.now());
    const parameters = { startTime: Math.floor(startTime), endTime, limit: 1000 };
    const [tradesPayload, incomePayload] = await Promise.all([
      this.signed("/fapi/v1/userTrades", parameters),
      this.signed("/fapi/v1/income", parameters),
    ]);
    if (!Array.isArray(tradesPayload)) throw Object.assign(new Error("binance_invalid_trades"), { statusCode: 502 });
    if (!Array.isArray(incomePayload)) throw Object.assign(new Error("binance_invalid_income"), { statusCode: 502 });
    const exhausted = endTime >= this.now() && tradesPayload.length < 1000 && incomePayload.length < 1000;
    return {
      trades: tradesPayload as Array<Record<string, unknown>>,
      income: incomePayload as Array<Record<string, unknown>>,
      nextStartTime: exhausted ? null : endTime + 1,
      exhausted,
    };
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
