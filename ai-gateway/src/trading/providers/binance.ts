import { createHash } from "node:crypto";
import { BinanceFuturesClient } from "../binance-futures.ts";
import { createCandleFetchGuard, finalizeCanonicalCandleBatch } from "./contracts.ts";
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

const BINANCE_CANDLE_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M"] as const;
const BINANCE_CANDLE_MAXIMUM_PAGE_SIZE = 1_500;
const BINANCE_CANDLE_MAXIMUM_RANGE_SECONDS = 200 * 24 * 60 * 60;
const timeframeMilliseconds: Readonly<Record<Exclude<CandleRequest["timeframe"], "1M">, number>> = {
  "1m": 60_000, "3m": 3 * 60_000, "5m": 5 * 60_000, "15m": 15 * 60_000, "30m": 30 * 60_000,
  "1h": 60 * 60_000, "2h": 2 * 60 * 60_000, "4h": 4 * 60 * 60_000, "6h": 6 * 60 * 60_000,
  "8h": 8 * 60 * 60_000, "12h": 12 * 60 * 60_000, "1d": 24 * 60 * 60_000, "1w": 7 * 24 * 60 * 60_000,
};

type BinanceHistoryPayload = {
  connection_id: string;
  trades: Array<Record<string, unknown>>;
  income: Array<Record<string, unknown>>;
  exhausted: boolean;
};

function credentials(value: Readonly<Record<string, string>>): { apiKey: string; secretKey: string } {
  const apiKey = value.api_key ?? value.apiKey;
  const secretKey = value.secret_key ?? value.secretKey;
  if (!apiKey || !secretKey) throw Object.assign(new Error("binance_credentials_required"), { statusCode: 400 });
  return { apiKey, secretKey };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error(`binance_invalid_${field}`), { statusCode: 502 });
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw Object.assign(new Error(`binance_invalid_${field}`), { statusCode: 502 });
  }
  return String(value);
}

function timestamp(value: unknown, field: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error(`binance_invalid_${field}`), { statusCode: 502 });
  return new Date(number).toISOString();
}

function negativeFee(value: unknown): string {
  const fee = string(value, "commission");
  if (!Number.isFinite(Number(fee))) throw Object.assign(new Error("binance_invalid_commission"), { statusCode: 502 });
  return Number(fee) === 0 ? "0" : fee.startsWith("-") ? fee : `-${fee}`;
}

function capabilities(): ProviderCapabilities {
  return {
    products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7, page_size: 1000, pagination: "time",
    position_grouping: "hedge_zero_cycle", has_position_id: false, has_realized_pnl: true, has_fee_asset: true,
    has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true, account_currency: "USDT",
    settlement_assets: ["USDT"], valuation_pairs: ["USDT/USD"],
    candles: {
      availability: "available", timeframes: [...BINANCE_CANDLE_TIMEFRAMES],
      maximum_page_size: BINANCE_CANDLE_MAXIMUM_PAGE_SIZE,
      maximum_range_seconds: BINANCE_CANDLE_MAXIMUM_RANGE_SECONDS,
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
  if (timeframe !== "1M") return openTime + timeframeMilliseconds[timeframe];
  const date = new Date(openTime);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function canonicalUnsignedDecimal(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== "string") throw candleFailure(`binance_invalid_${field}`, 502);
  const raw = value;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) throw candleFailure(`binance_invalid_${field}`, 502);
  const [whole = "0", fraction = ""] = raw.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const result = normalizedFraction.length > 0 ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
  if (!allowZero && result === "0") throw candleFailure(`binance_invalid_${field}`, 502);
  return result;
}

function finiteTimestamp(value: unknown, field: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw candleFailure(`binance_invalid_${field}`, 502);
  return result;
}

function candleRow(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 7) throw candleFailure("binance_invalid_candles", 502);
  return value;
}

function candleQueryStart(timestamp: number, timeframe: CandleRequest["timeframe"]): number {
  if (timeframe !== "1M") return Math.floor(timestamp / timeframeMilliseconds[timeframe]) * timeframeMilliseconds[timeframe];
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function safeCandleError(status: number): Error {
  if (status === 401 || status === 403) return candleFailure("binance_unauthorized", 400);
  if (status === 429 || status === 418) return candleFailure("binance_rate_limited", 429);
  return candleFailure(status >= 500 ? "binance_unavailable" : "binance_invalid_candle_request", status >= 500 ? 503 : 400);
}

function historyPayload(page: ProviderHistoryPage): BinanceHistoryPayload {
  const payload = record(page.payload, "history_payload");
  if (!Array.isArray(payload.trades) || !Array.isArray(payload.income) || typeof payload.exhausted !== "boolean") {
    throw Object.assign(new Error("binance_invalid_history_payload"), { statusCode: 502 });
  }
  return {
    connection_id: string(payload.connection_id, "connection_id"),
    trades: payload.trades.map((item) => record(item, "trade")),
    income: payload.income.map((item) => record(item, "income")),
    exhausted: payload.exhausted,
  };
}

function incomeType(value: string): CanonicalCashEvent["type"] {
  const mapping: Record<string, CanonicalCashEvent["type"]> = {
    TRANSFER: "internal_transfer",
    FUNDING_FEE: "funding",
    COMMISSION: "commission_adjustment",
    COMMISSION_REBATE: "commission_adjustment",
    INSURANCE_CLEAR: "admin_adjustment",
  };
  return mapping[value] ?? "unknown";
}

export class BinanceTradingProviderAdapter implements TradingProviderAdapter {
  readonly provider = "binance" as const;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;

  constructor(
    baseUrl = "https://fapi.binance.com",
    fetcher: Fetcher = fetch,
    now: () => number = Date.now,
  ) {
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
    this.now = now;
  }

  private client(value: Readonly<Record<string, string>>): BinanceFuturesClient {
    const resolved = credentials(value);
    return new BinanceFuturesClient(resolved.apiKey, resolved.secretKey, this.baseUrl, this.fetcher, this.now);
  }

  async validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]> {
    if (input.provider !== this.provider) throw Object.assign(new Error("binance_provider_mismatch"), { statusCode: 400 });
    if (!input.read_only_ack) throw Object.assign(new Error("binance_read_only_ack_required"), { statusCode: 400 });
    const resolved = credentials(input.credentials);
    const { account } = await this.client(input.credentials).accountDetails();
    if (account.canTrade === true) throw Object.assign(new Error("binance_trading_permission_not_allowed"), { statusCode: 400 });
    const assets = Array.isArray(account.assets) ? account.assets.map((item) => record(item, "asset")) : [];
    const unsupported = assets.some((asset) => String(asset.asset).toUpperCase() !== "USDT" && Number(asset.marginBalance ?? asset.walletBalance ?? 0) !== 0);
    if (unsupported) throw Object.assign(new Error("binance_non_usdt_product_not_supported"), { statusCode: 400 });
    const externalId = typeof account.accountAlias === "string" && account.accountAlias.length > 0
      ? account.accountAlias
      : `key-${createHash("sha256").update(resolved.apiKey).digest("hex").slice(0, 16)}`;
    const suffix = externalId.slice(-4).padStart(4, "0");
    return [{
      external_account_id: externalId,
      account_label: `Binance USD-M · ${suffix}`,
      account_identifier_mask: `\u2022\u2022\u2022\u2022${suffix}`,
      account_currency: "USDT",
      products: ["usdt_perpetual"],
      read_only_status: account.canTrade === false ? "verified" : "user_attested",
    }];
  }

  async discoverCapabilities(_account: ProviderAccount): Promise<ProviderCapabilities> {
    return capabilities();
  }

  async fetchAccountSnapshot(account: ProviderAccount) {
    const snapshot = await this.client(account.credentials).accountSnapshot();
    const capturedAt = new Date(this.now()).toISOString();
    return {
      provider: this.provider,
      connection_id: account.connection_id,
      captured_at: capturedAt,
      account_currency: "USDT",
      equity: String(snapshot.equityUsdt),
      wallet_balance: String(snapshot.walletBalanceUsdt),
      unrealized_pnl: String(snapshot.unrealizedPnlUsdt),
      usd_equity: String(snapshot.equityUsdt),
      usd_wallet_balance: String(snapshot.walletBalanceUsdt),
      usd_unrealized_pnl: String(snapshot.unrealizedPnlUsdt),
      valuation: { status: "approximate" as const, rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: capturedAt },
    };
  }

  async fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
    if (cursor.kind !== "time") throw Object.assign(new Error("binance_invalid_history_cursor"), { statusCode: 400 });
    const start = cursor.value === null ? this.now() - 90 * 24 * 60 * 60 * 1_000 : Number(cursor.value);
    if (!Number.isFinite(start)) throw Object.assign(new Error("binance_invalid_history_cursor"), { statusCode: 400 });
    const page = await this.client(account.credentials).historyPage(start);
    return {
      payload: { connection_id: account.connection_id, trades: page.trades, income: page.income, exhausted: page.exhausted },
      cursor: { kind: "time", value: page.nextStartTime === null ? null : String(page.nextStartTime) },
      fetched_at: new Date(this.now()).toISOString(),
    };
  }

  async fetchCandles(account: ProviderAccount, request: CandleRequest): Promise<CanonicalCandleBatch> {
    credentials(account.credentials);
    if (!validCandleRequestIdentity(request) || request.product !== "usdt_perpetual" || !(BINANCE_CANDLE_TIMEFRAMES as readonly string[]).includes(request.timeframe)
      || (request.price_mode !== "trade" && request.price_mode !== "mark")
      || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 3_000) {
      throw candleFailure("binance_invalid_candle_request", 400);
    }
    const from = Date.parse(request.from);
    const to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to
      || to - from > BINANCE_CANDLE_MAXIMUM_RANGE_SECONDS * 1_000) {
      throw candleFailure("binance_invalid_candle_request", 400);
    }

    const seriesBasis: "trade" | "mark" = request.price_mode;
    const fetchedAtMs = this.now();
    const fetchedAt = new Date(fetchedAtMs).toISOString();
    const rows = new Map<number, unknown[]>();
    let cursor = candleQueryStart(from, request.timeframe);
    let stopReason: "complete" | "provider_limit" | "time_limit" = "complete";
    const guard = createCandleFetchGuard(request.limit, BINANCE_CANDLE_MAXIMUM_PAGE_SIZE, fetchedAtMs, this.now);
    while (cursor < to && rows.size < request.limit) {
      const decision = guard.nextPage();
      if (decision !== "request") {
        stopReason = decision;
        break;
      }
      const pageLimit = Math.min(BINANCE_CANDLE_MAXIMUM_PAGE_SIZE, request.limit - rows.size);
      const url = new URL(request.price_mode === "mark" ? "/fapi/v1/markPriceKlines" : "/fapi/v1/klines", this.baseUrl);
      url.searchParams.set("symbol", request.native_symbol);
      url.searchParams.set("interval", request.timeframe);
      url.searchParams.set("startTime", String(cursor));
      url.searchParams.set("endTime", String(to - 1));
      url.searchParams.set("limit", String(pageLimit));
      let response: Response;
      try {
        response = await this.fetcher(url, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: guard.signal });
      } catch {
        if (guard.signal.aborted) {
          stopReason = "time_limit";
          break;
        }
        throw candleFailure("binance_unavailable", 503);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (guard.signal.aborted) {
          stopReason = "time_limit";
          break;
        }
        payload = null;
      }
      if (!response.ok) throw safeCandleError(response.status);
      if (!Array.isArray(payload)) throw candleFailure("binance_invalid_candles", 502);
      if (payload.length === 0) break;
      let latestOpen = -1;
      for (const value of payload) {
        const row = candleRow(value);
        const openTime = finiteTimestamp(row[0], "candle_time");
        latestOpen = Math.max(latestOpen, openTime);
        const closeTime = candleEnd(openTime, request.timeframe);
        if (openTime < to && closeTime > from && rows.size < request.limit) rows.set(openTime, row);
      }
      if (latestOpen < cursor) {
        stopReason = "provider_limit";
        break;
      }
      const nextCursor = candleEnd(latestOpen, request.timeframe);
      if (nextCursor <= cursor) {
        stopReason = "provider_limit";
        break;
      }
      cursor = nextCursor;
    }
    if (rows.size >= request.limit && cursor < to) stopReason = "provider_limit";

    const candles: CanonicalCandle[] = [...rows.entries()].sort(([left], [right]) => left - right).map(([openTime, row]) => {
      const closeTime = candleEnd(openTime, request.timeframe);
      const upstreamCloseTime = finiteTimestamp(row[6], "candle_close_time");
      return {
        provider: this.provider, product: request.product, native_symbol: request.native_symbol,
        normalized_symbol: request.normalized_symbol, timeframe: request.timeframe, series_basis: seriesBasis,
        open_time: new Date(openTime).toISOString(), close_time: new Date(closeTime).toISOString(),
        open: canonicalUnsignedDecimal(row[1], "candle_open", false),
        high: canonicalUnsignedDecimal(row[2], "candle_high", false),
        low: canonicalUnsignedDecimal(row[3], "candle_low", false),
        close: canonicalUnsignedDecimal(row[4], "candle_close", false),
        volume: request.price_mode === "mark" ? null : canonicalUnsignedDecimal(row[5], "candle_volume", true),
        source: "public_api", source_timestamp: new Date(Math.min(upstreamCloseTime, fetchedAtMs)).toISOString(), fetched_at: fetchedAt,
        status: closeTime <= fetchedAtMs ? "final" : "partial", gap_before: false, gap_after: false,
      };
    });

    return finalizeCanonicalCandleBatch(this.provider, request, candles, fetchedAt, stopReason);
  }

  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch {
    const payload = historyPayload(page);
    const fillsById = new Map<string, CanonicalFill>();
    for (const trade of payload.trades) {
      const symbol = string(trade.symbol, "symbol").toUpperCase();
      if (!symbol.endsWith("USDT")) throw Object.assign(new Error("binance_non_usdt_product_not_supported"), { statusCode: 400 });
      const rawPositionSide = string(trade.positionSide, "position_side").toUpperCase();
      if (!new Set(["BOTH", "LONG", "SHORT"]).has(rawPositionSide)) throw Object.assign(new Error("binance_unknown_position_side"), { statusCode: 502 });
      const rawSide = string(trade.side, "side").toUpperCase();
      if (rawSide !== "BUY" && rawSide !== "SELL") throw Object.assign(new Error("binance_unknown_side"), { statusCode: 502 });
      const realizedPnl = string(trade.realizedPnl, "realized_pnl");
      const positionSide = rawPositionSide.toLowerCase() as CanonicalFill["position_side"];
      const side = rawSide.toLowerCase() as CanonicalFill["side"];
      const action: CanonicalFill["action"] = positionSide === "long" ? (side === "buy" ? "open" : "close")
        : positionSide === "short" ? (side === "sell" ? "open" : "close")
        : Number(realizedPnl) !== 0 ? "close" : "open";
      const nativeId = `${symbol}:${string(trade.id, "trade_id")}`;
      if (fillsById.has(nativeId)) continue;
      const feeAsset = string(trade.commissionAsset, "commission_asset").toUpperCase();
      const fee = negativeFee(trade.commission);
      fillsById.set(nativeId, {
        provider: this.provider, connection_id: payload.connection_id, native_fill_id: nativeId,
        native_order_id: string(trade.orderId, "order_id"), native_position_id: null, symbol, native_symbol: symbol,
        product: "usdt_perpetual", side, position_side: positionSide, action,
        price: string(trade.price, "price"), quantity: string(trade.qty, "quantity"), contract_multiplier: "1",
        occurred_at: timestamp(trade.time, "trade_time"),
        realized_pnl: { amount: realizedPnl, asset: "USDT", usd_value: realizedPnl },
        fee: { amount: fee, asset: feeAsset, usd_value: feeAsset === "USDT" ? fee : null },
        liquidity: trade.maker === true ? "maker" : trade.maker === false ? "taker" : "unknown",
      });
    }

    const eventsById = new Map<string, CanonicalCashEvent>();
    for (const income of payload.income) {
      const rawType = string(income.incomeType, "income_type").toUpperCase();
      const nativeId = `${rawType}:${string(income.tranId, "transaction_id")}`;
      if (eventsById.has(nativeId)) continue;
      const asset = string(income.asset, "income_asset").toUpperCase();
      const amount = string(income.income, "income");
      const rawSymbol = income.symbol === undefined || income.symbol === null || income.symbol === "" ? null : string(income.symbol, "income_symbol").toUpperCase();
      eventsById.set(nativeId, {
        provider: this.provider, connection_id: payload.connection_id, native_event_id: nativeId, native_type: rawType,
        type: incomeType(rawType), amount, asset, usd_value: asset === "USDT" ? amount : null,
        occurred_at: timestamp(income.time, "income_time"), symbol: rawSymbol, native_position_id: null,
      });
    }
    const fills = [...fillsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const cashEvents = [...eventsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const times = [...fills.map((fill) => fill.occurred_at), ...cashEvents.map((event) => event.occurred_at)];
    const fallback = page.fetched_at;
    return {
      fills, cash_events: cashEvents, next_cursor: page.cursor, exhausted: payload.exhausted,
      coverage_started_at: times.length > 0 ? [...times].sort()[0] ?? fallback : fallback,
      coverage_ended_at: times.length > 0 ? [...times].sort().at(-1) ?? fallback : fallback,
      warnings: cashEvents.some((event) => event.type === "unknown") ? ["binance_unknown_income_type"] : [],
    };
  }
}
