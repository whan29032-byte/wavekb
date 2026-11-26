import { createHmac } from "node:crypto";
import { assertCanonicalCandleBatch } from "./contracts.ts";
import type {
  CandleRequest,
  CanonicalCandle,
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
const ALLOWED_CANDLE_PATHS = new Set(["/v5/market/kline", "/v5/market/mark-price-kline"]);
const BYBIT_CANDLE_MAXIMUM_PAGE_SIZE = 1_000;
const BYBIT_CANDLE_MAXIMUM_RANGE_SECONDS = 90 * 24 * 60 * 60;
const BYBIT_CANDLE_INTERVALS: Readonly<Partial<Record<CandleRequest["timeframe"], string>>> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240",
  "6h": "360", "12h": "720", "1d": "D", "1w": "W", "1M": "M",
};
const timeframeMilliseconds: Readonly<Partial<Record<CandleRequest["timeframe"], number>>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000,
  "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000,
};

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
  const unauthorized = code === 10003 || code === 10004 || status === 401;
  return Object.assign(new Error(rateLimited ? "bybit_rate_limited" : permissionDenied ? "bybit_permission_denied" : unauthorized ? "bybit_unauthorized" : "bybit_unavailable"), {
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
    candles: {
      availability: "available", timeframes: Object.keys(BYBIT_CANDLE_INTERVALS) as CandleRequest["timeframe"][],
      maximum_page_size: BYBIT_CANDLE_MAXIMUM_PAGE_SIZE, maximum_range_seconds: BYBIT_CANDLE_MAXIMUM_RANGE_SECONDS,
      price_modes: ["trade", "mark"], unavailable_reason: null,
    },
  };
}

function candleFailure(code: string, statusCode: number): Error {
  return Object.assign(new Error(code), { statusCode });
}

function validCandleRequestIdentity(request: CandleRequest): boolean {
  const exactUtc = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
  return /^[A-Z0-9]{1,100}$/.test(request.native_symbol)
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(request.normalized_symbol)
    && exactUtc(request.from)
    && exactUtc(request.to);
}

function candleEnd(openTime: number, timeframe: CandleRequest["timeframe"]): number {
  if (timeframe !== "1M") {
    const milliseconds = timeframeMilliseconds[timeframe];
    if (!milliseconds) throw candleFailure("bybit_invalid_candle_request", 400);
    return openTime + milliseconds;
  }
  const date = new Date(openTime);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function finiteTimestamp(value: unknown, field: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw candleFailure(`bybit_invalid_${field}`, 502);
  return result;
}

function canonicalUnsignedDecimal(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== "string" && typeof value !== "number") throw candleFailure(`bybit_invalid_${field}`, 502);
  const raw = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) throw candleFailure(`bybit_invalid_${field}`, 502);
  const [whole = "0", fraction = ""] = raw.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const result = normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
  if (!allowZero && result === "0") throw candleFailure(`bybit_invalid_${field}`, 502);
  return result;
}

function candleRow(value: unknown, priceMode: "trade" | "mark"): unknown[] {
  if (!Array.isArray(value) || value.length < (priceMode === "mark" ? 5 : 7)) throw candleFailure("bybit_invalid_candles", 502);
  return value;
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

  private async publicCandles(path: string, parameters: Record<string, string>): Promise<{ rows: unknown[]; sourceTime: number }> {
    if (!ALLOWED_CANDLE_PATHS.has(path)) throw candleFailure("bybit_path_not_allowed", 500);
    const query = new URLSearchParams(parameters);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}?${query}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" },
      });
    } catch {
      throw candleFailure("bybit_unavailable", 503);
    }
    const payload: unknown = await response.json().catch(() => null);
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const code = typeof root.retCode === "number" ? root.retCode : Number(root.retCode);
    if (!response.ok || code !== 0) throw safeError(Number.isFinite(code) ? code : -1, response.status);
    const result = root.result && typeof root.result === "object" && !Array.isArray(root.result) ? root.result as Record<string, unknown> : {};
    if (!Array.isArray(result.list)) throw candleFailure("bybit_invalid_candles", 502);
    return { rows: result.list, sourceTime: finiteTimestamp(root.time, "candle_source_time") };
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
    const suffix = id.slice(-4).padStart(4, "0");
    return [{
      external_account_id: id, account_label: `Bybit · ${suffix}`, account_identifier_mask: `\u2022\u2022\u2022\u2022${suffix}`,
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

  async fetchCandles(account: ProviderAccount, request: CandleRequest): Promise<CanonicalCandleBatch> {
    resolveCredentials(account.credentials);
    const interval = BYBIT_CANDLE_INTERVALS[request.timeframe];
    if (!validCandleRequestIdentity(request) || request.product !== "usdt_perpetual" || !interval || (request.price_mode !== "trade" && request.price_mode !== "mark")
      || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 3_000) throw candleFailure("bybit_invalid_candle_request", 400);
    const seriesBasis: "trade" | "mark" = request.price_mode;
    const from = Date.parse(request.from);
    const to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > BYBIT_CANDLE_MAXIMUM_RANGE_SECONDS * 1_000) {
      throw candleFailure("bybit_invalid_candle_request", 400);
    }
    const fetchedAtMs = this.now();
    const fetchedAt = new Date(fetchedAtMs).toISOString();
    const rows = new Map<number, { row: unknown[]; sourceTime: number }>();
    let cursor = to;
    let providerLimitReached = false;
    while (cursor > from && rows.size < request.limit) {
      const page = await this.publicCandles(request.price_mode === "mark" ? "/v5/market/mark-price-kline" : "/v5/market/kline", {
        category: "linear", symbol: request.native_symbol, interval, start: String(from), end: String(cursor - 1),
        limit: String(Math.min(BYBIT_CANDLE_MAXIMUM_PAGE_SIZE, request.limit - rows.size)),
      });
      if (page.rows.length === 0) break;
      let earliest = Number.POSITIVE_INFINITY;
      for (const value of page.rows) {
        const row = candleRow(value, seriesBasis);
        const openTime = finiteTimestamp(row[0], "candle_time");
        earliest = Math.min(earliest, openTime);
        const closeTime = candleEnd(openTime, request.timeframe);
        if (openTime >= from && closeTime <= to && rows.size < request.limit) rows.set(openTime, { row, sourceTime: page.sourceTime });
      }
      if (!Number.isFinite(earliest) || earliest >= cursor) throw candleFailure("bybit_invalid_candle_order", 502);
      cursor = earliest;
    }
    if (rows.size >= request.limit && cursor > from) providerLimitReached = true;
    const candles: CanonicalCandle[] = [...rows.entries()].sort(([left], [right]) => left - right).map(([openTime, value]) => {
      const closeTime = candleEnd(openTime, request.timeframe);
      return {
        provider: this.provider, product: request.product, native_symbol: request.native_symbol,
        normalized_symbol: request.normalized_symbol, timeframe: request.timeframe, series_basis: seriesBasis,
        open_time: new Date(openTime).toISOString(), close_time: new Date(closeTime).toISOString(),
        open: canonicalUnsignedDecimal(value.row[1], "candle_open", false), high: canonicalUnsignedDecimal(value.row[2], "candle_high", false),
        low: canonicalUnsignedDecimal(value.row[3], "candle_low", false), close: canonicalUnsignedDecimal(value.row[4], "candle_close", false),
        volume: request.price_mode === "mark" ? null : canonicalUnsignedDecimal(value.row[5], "candle_volume", true), source: "public_api",
        source_timestamp: new Date(Math.min(value.sourceTime, fetchedAtMs)).toISOString(), fetched_at: fetchedAt,
        status: closeTime <= fetchedAtMs ? "final" : "partial", gap_before: false, gap_after: false,
      };
    });
    const gaps: CanonicalCandleBatch["coverage"]["gaps"] = [];
    let expectedOpen = from;
    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index]!;
      const openTime = Date.parse(candle.open_time);
      if (openTime > expectedOpen) gaps.push({ series_basis: seriesBasis, from: new Date(expectedOpen).toISOString(), to: candle.open_time });
      candle.gap_before = openTime > expectedOpen;
      const next = candles[index + 1];
      candle.gap_after = next ? Date.parse(next.open_time) > Date.parse(candle.close_time) : to > Date.parse(candle.close_time);
      expectedOpen = Date.parse(candle.close_time);
    }
    if (candles.length > 0 && expectedOpen < to) gaps.push({ series_basis: seriesBasis, from: new Date(expectedOpen).toISOString(), to: request.to });
    const warnings: CanonicalCandleBatch["warnings"] = [];
    if (gaps.length > 0) warnings.push("historical_gap");
    if (providerLimitReached) warnings.push("provider_limit_reached");
    if (candles.length === 0) warnings.push("empty_range");
    return assertCanonicalCandleBatch({
      provider: this.provider, request, candles,
      coverage: { status: candles.length === 0 ? "empty" : gaps.length > 0 ? "gapped" : "complete", range_start: request.from,
        range_end: request.to, source: "public_api", fetched_at: fetchedAt, gaps, unavailable_reason: null },
      warnings,
    });
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
