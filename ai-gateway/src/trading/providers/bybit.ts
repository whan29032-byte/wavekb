import { createHmac } from "node:crypto";
import { unavailableCandleBatch, unavailableCandleCapabilities } from "./contracts.ts";
import type {
  CandleRequest,
  CanonicalCandleBatch,
  CanonicalCashEvent,
  CanonicalFill,
  CanonicalHistoryBatch,
  ProviderAccount,
  ProviderCapabilities,
  ProviderCredentialInput,
  ProviderCursor,
  ProviderHistoryPage,
  TradingProviderAdapter,
  ValidatedAccount,
} from "./contracts.ts";

type Fetcher = typeof fetch;
const HISTORY_LIMIT_MS = 90 * 24 * 60 * 60 * 1_000;
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const ALLOWED_HOSTS = new Set(["api.bybit.com"]);
const ALLOWED_PATHS = new Set(["/v5/user/query-api", "/v5/account/wallet-balance", "/v5/execution/list", "/v5/account/transaction-log"]);

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error(`bybit_invalid_${field}`), { statusCode: 502 });
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if ((typeof value !== "string" && typeof value !== "number") || (!allowEmpty && String(value).length === 0)) {
    throw Object.assign(new Error(`bybit_invalid_${field}`), { statusCode: 502 });
  }
  return String(value);
}

function isoTime(value: unknown, field: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error(`bybit_invalid_${field}`), { statusCode: 502 });
  return new Date(number).toISOString();
}

function resolveCredentials(value: Readonly<Record<string, string>>) {
  const apiKey = value.api_key ?? value.apiKey;
  const secretKey = value.secret_key ?? value.secretKey;
  if (!apiKey || !secretKey) throw Object.assign(new Error("bybit_credentials_required"), { statusCode: 400 });
  return { apiKey, secretKey };
}

function safeError(code: number, status: number) {
  const rateLimited = code === 10006 || status === 429;
  const permissionDenied = code === 10005;
  return Object.assign(new Error(rateLimited ? "bybit_rate_limited" : permissionDenied ? "bybit_permission_denied" : "bybit_unavailable"), {
    statusCode: rateLimited ? 429 : status >= 500 ? 503 : 400,
  });
}

function negateExpense(value: unknown): string {
  const amount = text(value, "fee");
  if (!Number.isFinite(Number(amount))) throw Object.assign(new Error("bybit_invalid_fee"), { statusCode: 502 });
  if (Number(amount) === 0) return "0";
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

function capabilities(): ProviderCapabilities {
  return {
    products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7, page_size: 100,
    pagination: "opaque", position_grouping: "hedge_zero_cycle", has_position_id: false, has_realized_pnl: true,
    has_fee_asset: true, has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true,
    account_currency: "USDT", settlement_assets: ["USDT"], valuation_pairs: ["USDT/USD"],
    candles: unavailableCandleCapabilities(),
  };
}

type BybitResponse = { result: Record<string, unknown> };

function parseHistoryPayload(page: ProviderHistoryPage) {
  const payload = record(page.payload, "history_payload");
  if (!Array.isArray(payload.executions) || !Array.isArray(payload.transactions) || typeof payload.exhausted !== "boolean") {
    throw Object.assign(new Error("bybit_invalid_history_payload"), { statusCode: 502 });
  }
  return {
    connectionId: text(payload.connection_id, "connection_id"),
    executions: payload.executions.map((item) => record(item, "execution")),
    transactions: payload.transactions.map((item) => record(item, "transaction")),
    exhausted: payload.exhausted,
  };
}

function transactionType(value: string): CanonicalCashEvent["type"] {
  if (value === "TRANSFER_IN" || value === "TRANSFER_OUT") return "internal_transfer";
  if (value === "SETTLEMENT") return "funding";
  if (value === "FEE_REFUND") return "commission_adjustment";
  if (value === "BONUS") return "bonus";
  return "unknown";
}

export class BybitTradingProviderAdapter implements TradingProviderAdapter {
  readonly provider = "bybit" as const;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;

  constructor(baseUrl = "https://api.bybit.com", fetcher: Fetcher = fetch, now: () => number = Date.now) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.pathname !== "/") throw new Error("bybit_base_url_not_allowed");
    this.baseUrl = url.origin;
    this.fetcher = fetcher;
    this.now = now;
  }

  private async get(path: string, parameters: Record<string, string>, rawCredentials: Readonly<Record<string, string>>): Promise<BybitResponse> {
    if (!ALLOWED_PATHS.has(path)) throw Object.assign(new Error("bybit_path_not_allowed"), { statusCode: 500 });
    const credentials = resolveCredentials(rawCredentials);
    const query = new URLSearchParams(parameters).toString();
    const timestamp = String(this.now());
    const receiveWindow = "5000";
    const signature = createHmac("sha256", credentials.secretKey).update(`${timestamp}${credentials.apiKey}${receiveWindow}${query}`).digest("hex");
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: { accept: "application/json", "X-BAPI-API-KEY": credentials.apiKey, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-RECV-WINDOW": receiveWindow, "X-BAPI-SIGN": signature },
      });
    } catch {
      throw Object.assign(new Error("bybit_unavailable"), { statusCode: 503 });
    }
    const payload = await response.json().catch(() => null);
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const code = Number(root.retCode);
    if (!response.ok || code !== 0) throw safeError(Number.isFinite(code) ? code : -1, response.status);
    return { result: record(root.result, "response_result") };
  }

  async validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]> {
    if (input.provider !== this.provider) throw Object.assign(new Error("bybit_provider_mismatch"), { statusCode: 400 });
    if (!input.read_only_ack) throw Object.assign(new Error("bybit_read_only_ack_required"), { statusCode: 400 });
    const [keyInfo, wallet] = await Promise.all([
      this.get("/v5/user/query-api", {}, input.credentials),
      this.get("/v5/account/wallet-balance", { accountType: "UNIFIED", coin: "USDT" }, input.credentials),
    ]);
    if (Number(keyInfo.result.readOnly) !== 1) throw Object.assign(new Error("bybit_trading_permission_not_allowed"), { statusCode: 400 });
    const accounts = Array.isArray(wallet.result.list) ? wallet.result.list.map((item) => record(item, "wallet_account")) : [];
    const coins = accounts.flatMap((entry) => Array.isArray(entry.coin) ? entry.coin.map((item) => record(item, "wallet_coin")) : []);
    if (coins.some((coin) => text(coin.coin, "coin").toUpperCase() !== "USDT" && Number(coin.equity ?? coin.walletBalance ?? 0) !== 0)) {
      throw Object.assign(new Error("bybit_non_usdt_product_not_supported"), { statusCode: 400 });
    }
    const id = text(keyInfo.result.id, "account_id");
    const suffix = id.slice(-4);
    return [{
      external_account_id: id, account_label: `Bybit · ${suffix}`, account_identifier_mask: `••••${suffix}`,
      account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified",
    }];
  }

  async discoverCapabilities(_account: ProviderAccount): Promise<ProviderCapabilities> {
    return capabilities();
  }

  async fetchAccountSnapshot(account: ProviderAccount) {
    const response = await this.get("/v5/account/wallet-balance", { accountType: "UNIFIED", coin: "USDT" }, account.credentials);
    const wallet = Array.isArray(response.result.list) ? record(response.result.list[0], "wallet") : null;
    if (!wallet) throw Object.assign(new Error("bybit_invalid_wallet"), { statusCode: 502 });
    const equity = text(wallet.totalEquity, "total_equity");
    const balance = text(wallet.totalWalletBalance, "wallet_balance");
    const unrealized = text(wallet.totalPerpUPL ?? "0", "unrealized_pnl");
    const capturedAt = new Date(this.now()).toISOString();
    return {
      provider: this.provider, connection_id: account.connection_id, captured_at: capturedAt, account_currency: "USDT",
      equity, wallet_balance: balance, unrealized_pnl: unrealized, usd_equity: equity, usd_wallet_balance: balance,
      usd_unrealized_pnl: unrealized,
      valuation: { status: "approximate" as const, rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: capturedAt },
    };
  }

  async fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
    if (cursor.kind !== "opaque") throw Object.assign(new Error("bybit_invalid_history_cursor"), { statusCode: 400 });
    let parsed: Record<string, unknown> = {};
    if (cursor.value) {
      try { parsed = record(JSON.parse(cursor.value), "history_cursor"); } catch { throw Object.assign(new Error("bybit_invalid_history_cursor"), { statusCode: 400 }); }
    }
    const windowEnd = typeof parsed.window_end === "number" ? parsed.window_end : this.now();
    const windowStart = typeof parsed.window_start === "number" ? parsed.window_start : Math.max(this.now() - HISTORY_WINDOW_MS, this.now() - HISTORY_LIMIT_MS);
    if (windowStart < this.now() - HISTORY_LIMIT_MS || windowEnd - windowStart > HISTORY_WINDOW_MS || windowEnd <= windowStart) {
      throw Object.assign(new Error("bybit_history_range_exceeded"), { statusCode: 400 });
    }
    const executionCursor = typeof parsed.execution_cursor === "string" ? parsed.execution_cursor : "";
    const transactionCursor = typeof parsed.transaction_cursor === "string" ? parsed.transaction_cursor : "";
    const executionParams: Record<string, string> = { category: "linear", settleCoin: "USDT", startTime: String(windowStart), endTime: String(windowEnd), limit: "100" };
    const transactionParams: Record<string, string> = { accountType: "UNIFIED", category: "linear", currency: "USDT", startTime: String(windowStart), endTime: String(windowEnd), limit: "50" };
    if (executionCursor) executionParams.cursor = executionCursor;
    if (transactionCursor) transactionParams.cursor = transactionCursor;
    const [execution, transaction] = await Promise.all([
      this.get("/v5/execution/list", executionParams, account.credentials),
      this.get("/v5/account/transaction-log", transactionParams, account.credentials),
    ]);
    const executions = Array.isArray(execution.result.list) ? execution.result.list.map((item) => record(item, "execution")) : [];
    const transactions = Array.isArray(transaction.result.list) ? transaction.result.list.map((item) => record(item, "transaction")) : [];
    const nextExecution = text(execution.result.nextPageCursor ?? "", "execution_cursor", true);
    const nextTransaction = text(transaction.result.nextPageCursor ?? "", "transaction_cursor", true);
    return {
      payload: { connection_id: account.connection_id, executions, transactions, exhausted: !nextExecution && !nextTransaction },
      cursor: { kind: "opaque", value: JSON.stringify({ execution_cursor: nextExecution, transaction_cursor: nextTransaction, window_start: windowStart, window_end: windowEnd }) },
      fetched_at: new Date(this.now()).toISOString(),
    };
  }

  async fetchCandles(_account: ProviderAccount, request: CandleRequest): Promise<CanonicalCandleBatch> {
    return unavailableCandleBatch(request);
  }

  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch {
    const payload = parseHistoryPayload(page);
    const fillsById = new Map<string, CanonicalFill>();
    for (const execution of payload.executions) {
      if (text(execution.category, "category").toLowerCase() !== "linear") continue;
      const symbol = text(execution.symbol, "symbol").toUpperCase();
      if (!symbol.endsWith("USDT")) continue;
      const rawSide = text(execution.side, "side");
      if (rawSide !== "Buy" && rawSide !== "Sell") throw Object.assign(new Error("bybit_unknown_side"), { statusCode: 502 });
      const side = rawSide === "Buy" ? "buy" as const : "sell" as const;
      const positionIndex = Number(execution.positionIdx);
      if (![0, 1, 2].includes(positionIndex)) throw Object.assign(new Error("bybit_unknown_position_mode"), { statusCode: 502 });
      const positionSide: CanonicalFill["position_side"] = positionIndex === 0 ? "both" : positionIndex === 1 ? "long" : "short";
      const closedSize = text(execution.closedSize ?? "0", "closed_size");
      const action: CanonicalFill["action"] = Number(closedSize) > 0 ? "close"
        : positionSide === "long" ? (side === "buy" ? "open" : "close")
        : positionSide === "short" ? (side === "sell" ? "open" : "close") : "open";
      const id = text(execution.execId, "execution_id");
      if (fillsById.has(id)) continue;
      const feeAsset = text(execution.feeCurrency || "USDT", "fee_currency").toUpperCase();
      const fee = negateExpense(execution.execFee ?? "0");
      const pnl = text(execution.execPnl ?? "0", "execution_pnl");
      fillsById.set(id, {
        provider: this.provider, connection_id: payload.connectionId, native_fill_id: id,
        native_order_id: text(execution.orderId, "order_id"), native_position_id: null, symbol, native_symbol: symbol,
        product: "usdt_perpetual", side, position_side: positionSide, action,
        price: text(execution.execPrice, "execution_price"), quantity: text(execution.execQty, "execution_quantity"), contract_multiplier: "1",
        occurred_at: isoTime(execution.execTime, "execution_time"), realized_pnl: { amount: pnl, asset: "USDT", usd_value: pnl },
        fee: { amount: fee, asset: feeAsset, usd_value: feeAsset === "USDT" ? fee : null },
        liquidity: execution.isMaker === true ? "maker" : execution.isMaker === false ? "taker" : "unknown",
      });
    }
    const eventsById = new Map<string, CanonicalCashEvent>();
    for (const transaction of payload.transactions) {
      if (text(transaction.category, "transaction_category").toLowerCase() !== "linear") continue;
      const currency = text(transaction.currency, "transaction_currency").toUpperCase();
      if (currency !== "USDT") continue;
      const rawType = text(transaction.type, "transaction_type").toUpperCase();
      const id = text(transaction.id ?? transaction.transactionId, "transaction_id");
      if (eventsById.has(id)) continue;
      const type = transactionType(rawType);
      const amount = type === "funding" ? text(transaction.funding ?? "0", "funding") : text(transaction.cashFlow ?? "0", "cash_flow");
      const symbol = transaction.symbol === undefined || transaction.symbol === "" ? null : text(transaction.symbol, "transaction_symbol").toUpperCase();
      eventsById.set(id, {
        provider: this.provider, connection_id: payload.connectionId, native_event_id: id, native_type: rawType, type,
        amount, asset: currency, usd_value: amount, occurred_at: isoTime(transaction.transactionTime ?? transaction.transactionTimeNano, "transaction_time"),
        symbol, native_position_id: null,
      });
    }
    const fills = [...fillsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const cashEvents = [...eventsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const times = [...fills.map((fill) => fill.occurred_at), ...cashEvents.map((event) => event.occurred_at)].sort();
    return {
      fills, cash_events: cashEvents, next_cursor: page.cursor, exhausted: payload.exhausted,
      coverage_started_at: times[0] ?? page.fetched_at, coverage_ended_at: times.at(-1) ?? page.fetched_at,
      warnings: cashEvents.some((event) => event.type === "unknown") ? ["bybit_unknown_transaction_type"] : [],
    };
  }
}
