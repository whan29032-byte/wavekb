import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { finalizeCanonicalCandleBatch, unavailableCandleBatch, unavailableCandleCapabilities } from "./contracts.ts";
import type {
  CandleRequest,
  CandleUnavailableReason,
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
const EMPTY_BODY_HASH = createHash("sha256").update("").digest("base64url");
const DISCOVERY_PATH = "/v1/trading/access-point";
const CANDLE_PATH = (accountId: string) => `/v1/market-data/accounts/${accountId}/candles`;
const CANDLE_FETCH_TIMEOUT_MS = 12_000;
const ACCESS_POINT_CACHE_MS = 15 * 60_000;
const EXNESS_CANDLE_TIMEFRAMES = {
  "1m": "M1", "3m": "M3", "5m": "M5", "15m": "M15", "30m": "M30",
  "1h": "H1", "2h": "H2", "4h": "H4", "1d": "D1", "1w": "W1", "1M": "MN",
} as const satisfies Partial<Record<CandleRequest["timeframe"], string>>;
const timeframeMilliseconds: Readonly<Record<Exclude<keyof typeof EXNESS_CANDLE_TIMEFRAMES, "1M">, number>> = {
  "1m": 60_000, "3m": 3 * 60_000, "5m": 5 * 60_000, "15m": 15 * 60_000, "30m": 30 * 60_000,
  "1h": 60 * 60_000, "2h": 2 * 60 * 60_000, "4h": 4 * 60 * 60_000, "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

function failure(code: string, statusCode: number): Error {
  return Object.assign(new Error(code), { statusCode });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error(`exness_invalid_${field}`), { statusCode: 502 });
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if ((typeof value !== "string" && typeof value !== "number") || (!allowEmpty && String(value).length === 0)) {
    throw Object.assign(new Error(`exness_invalid_${field}`), { statusCode: 502 });
  }
  return String(value);
}

function decimal(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(result)) throw Object.assign(new Error(`exness_invalid_${field}`), { statusCode: 502 });
  return result.startsWith("+") ? result.slice(1) : result;
}

function subtractDecimal(left: string, right: string): string {
  const split = (value: string) => {
    const negative = value.startsWith("-");
    const unsigned = value.replace(/^[+-]/, "");
    const [whole = "0", fraction = ""] = unsigned.split(".");
    return { negative, whole, fraction };
  };
  const a = split(left);
  const b = split(right);
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const toInteger = (value: ReturnType<typeof split>) => {
    const digits = BigInt(`${value.whole}${value.fraction.padEnd(scale, "0")}`);
    return value.negative ? -digits : digits;
  };
  const difference = toInteger(a) - toInteger(b);
  const negative = difference < 0n;
  const digits = (negative ? -difference : difference).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const result = `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return result === "-0" ? "0" : result;
}

function normalizeFee(value: unknown): string {
  const amount = decimal(value ?? "0", "commission");
  if (Number(amount) === 0) return "0";
  return amount.startsWith("-") ? amount : `-${amount}`;
}

function safeBaseUrl(value: string, field: "discovery" | "access_point"): string {
  let url: URL;
  try { url = new URL(value); } catch { throw Object.assign(new Error(`exness_${field}_not_allowed`), { statusCode: 400 }); }
  const hostname = url.hostname.toLowerCase();
  const official = hostname === "exness.com" || hostname.endsWith(".exness.com") || hostname === "exness-api.com" || hostname.endsWith(".exness-api.com");
  if (url.protocol !== "https:" || !official || url.username || url.password || url.port || url.pathname !== "/") {
    throw Object.assign(new Error(`exness_${field}_not_allowed`), { statusCode: 400 });
  }
  return url.origin;
}

function allowedPath(path: string): boolean {
  return path === DISCOVERY_PATH
    || /^\/v1\/configuration\/accounts\/\d{1,20}\/(?:account|limits)$/.test(path)
    || /^\/v1\/trading\/accounts\/\d{1,20}\/snapshot$/.test(path)
    || /^\/v1\/history\/accounts\/\d{1,20}\/deals$/.test(path)
    || /^\/v1\/market-data\/accounts\/\d{1,20}\/candles$/.test(path);
}

function privateKey(value: string): KeyObject {
  const input = value.trim();
  try {
    if (input.startsWith("-----BEGIN PRIVATE KEY-----")) {
      const key = createPrivateKey(input);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("unexpected_key_type");
      return key;
    }
    if (/^[a-fA-F0-9]{128}$/.test(input)) {
      const raw = Buffer.from(input, "hex");
      const seed = raw.subarray(0, 32);
      const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
      const key = createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" });
      const publicJwk = createPublicKey(key).export({ format: "jwk" });
      if (!Buffer.from(publicJwk.x ?? "", "base64url").equals(raw.subarray(32))) {
        throw new Error("public_half_mismatch");
      }
      return key;
    }
  } catch {
    // Converted below to a credential-safe public error.
  }
  throw Object.assign(new Error("exness_invalid_private_key"), { statusCode: 400 });
}

function resolveCredentials(value: Readonly<Record<string, string>>) {
  const apiKey = value.api_key ?? value.apiKey;
  const privateKeyValue = value.private_key ?? value.privateKey;
  const discoveryBaseUrl = value.discovery_base_url ?? value.discoveryBaseUrl;
  if (!apiKey || !privateKeyValue || !discoveryBaseUrl) throw Object.assign(new Error("exness_credentials_required"), { statusCode: 400 });
  return { apiKey, key: privateKey(privateKeyValue), discoveryBaseUrl: safeBaseUrl(discoveryBaseUrl, "discovery") };
}

function accountIds(value: Readonly<Record<string, string>>): string[] {
  const encoded = value.account_ids ?? value.accountIds ?? value.account_id ?? value.accountId;
  if (!encoded) throw Object.assign(new Error("exness_account_ids_required"), { statusCode: 400 });
  let values: unknown;
  try { values = encoded.trim().startsWith("[") ? JSON.parse(encoded) : encoded.split(",").map((item) => item.trim()); }
  catch { throw Object.assign(new Error("exness_invalid_account_ids"), { statusCode: 400 }); }
  if (!Array.isArray(values) || values.length < 1 || values.length > 10 || values.some((item) => typeof item !== "string" || !/^\d{1,20}$/.test(item))) {
    throw Object.assign(new Error("exness_invalid_account_ids"), { statusCode: 400 });
  }
  return [...new Set(values as string[])];
}

function safeError(payload: unknown, status: number) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const rawCode = root.code ?? root.error_code;
  const numericCode = typeof rawCode === "number" ? rawCode : typeof rawCode === "string" && /^\d+$/.test(rawCode) ? Number(rawCode) : null;
  const publicCode = typeof rawCode === "string" ? rawCode : "";
  const rateLimited = status === 429 || numericCode === 1 || numericCode === 3015 || publicCode === "REQUEST_RATE_LIMIT";
  const message = rateLimited
    ? "exness_rate_limited"
    : numericCode === 1000 || publicCode === "AUTH_INVALID_API_KEY"
      ? "exness_invalid_api_key"
      : numericCode === 1001 || publicCode === "AUTH_INVALID_SIGNATURE"
        ? "exness_invalid_signature"
        : numericCode === 1002 || publicCode === "AUTH_PERMISSION_DENIED" || status === 403
          ? "exness_permission_denied"
          : "exness_unavailable";
  const statusCode = rateLimited ? 429
    : message === "exness_invalid_api_key" || message === "exness_invalid_signature" || status === 401 ? 401
      : message === "exness_permission_denied" ? 403
        : status >= 500 ? 503 : 400;
  return failure(message, statusCode);
}

function limitsFromResponse(payload: unknown): { historyAgeDays: number; historyRangeDays: number } {
  const root = record(payload, "limits_response");
  const limits = record(root.limits, "limits");
  const rest = record(limits.rest, "rest_limits");
  if (!Array.isArray(rest.methods)) throw Object.assign(new Error("exness_history_limits_missing"), { statusCode: 502 });
  const method = rest.methods.map((item) => record(item, "method_limit")).find((item) => item.api_operation_id === "getDealsHistory");
  if (!method || !method.limits) throw Object.assign(new Error("exness_history_limits_missing"), { statusCode: 502 });
  const methodLimits = record(method.limits, "deal_history_limits");
  const historyAgeDays = Number(methodLimits.history_age_days);
  const historyRangeDays = Number(methodLimits.history_range_days);
  if (!Number.isInteger(historyAgeDays) || historyAgeDays < 1 || !Number.isInteger(historyRangeDays) || historyRangeDays < 1) {
    throw Object.assign(new Error("exness_history_limits_missing"), { statusCode: 502 });
  }
  return { historyAgeDays, historyRangeDays };
}

function candleLimitFromResponse(payload: unknown): number | null {
  const root = record(payload, "limits_response");
  const limits = record(root.limits, "limits");
  const rest = record(limits.rest, "rest_limits");
  if (!Array.isArray(rest.methods)) throw failure("exness_candle_limits_missing", 502);
  const method = rest.methods.map((item) => record(item, "method_limit"))
    .find((item) => item.api_operation_id === "getCandleHistory");
  if (!method) return null;
  if (method.http_method !== "GET" || method.path !== "/v1/market-data/accounts/{account_id}/candles" || !method.limits) {
    throw failure("exness_candle_limits_invalid", 502);
  }
  const methodLimits = record(method.limits, "candle_history_limits");
  const maximum = methodLimits.max_candles_per_request;
  if (!Number.isSafeInteger(maximum) || (maximum as number) < 1 || (maximum as number) > 100_000) {
    throw failure("exness_candle_limits_invalid", 502);
  }
  return maximum as number;
}

function capabilities(currency: string, historyAgeDays: number, historyRangeDays: number, candleLimit: number | null): ProviderCapabilities {
  return {
    products: ["cfd"], history_age_days: historyAgeDays, history_range_days: historyRangeDays, page_size: 200,
    pagination: "opaque", position_grouping: "position_id_cycle", has_position_id: true, has_realized_pnl: true,
    has_fee_asset: true, has_funding_or_swap: true, has_external_cash_flow: true,
    has_usd_valuation: currency === "USD" || currency === "USDT", account_currency: currency,
    settlement_assets: [currency], valuation_pairs: currency === "USD" ? ["USD"] : currency === "USDT" ? ["USDT/USD"] : [`${currency}/USD`],
    candles: candleLimit === null ? unavailableCandleCapabilities("account_scope_unavailable") : {
      availability: "available", timeframes: Object.keys(EXNESS_CANDLE_TIMEFRAMES) as Array<keyof typeof EXNESS_CANDLE_TIMEFRAMES>,
      maximum_page_size: candleLimit, maximum_range_seconds: candleLimit * 60,
      price_modes: ["bid", "ask", "both"], unavailable_reason: null,
    },
  };
}

function exactUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validCandleRequest(request: CandleRequest): boolean {
  return request.product === "cfd"
    && Object.hasOwn(EXNESS_CANDLE_TIMEFRAMES, request.timeframe)
    && (request.price_mode === "bid" || request.price_mode === "ask" || request.price_mode === "both")
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(request.native_symbol)
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(request.normalized_symbol)
    && exactUtc(request.from) && exactUtc(request.to)
    && Date.parse(request.from) < Date.parse(request.to)
    && Number.isInteger(request.limit) && request.limit >= 1 && request.limit <= 3_000
    && (request.price_mode !== "both" || request.limit >= 2);
}

function candleEnd(openTime: number, timeframe: keyof typeof EXNESS_CANDLE_TIMEFRAMES): number {
  if (timeframe !== "1M") return openTime + timeframeMilliseconds[timeframe];
  const date = new Date(openTime);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function advanceCandles(timestamp: number, count: number, timeframe: keyof typeof EXNESS_CANDLE_TIMEFRAMES): number {
  if (timeframe !== "1M") return timestamp + timeframeMilliseconds[timeframe] * count;
  let result = timestamp;
  for (let index = 0; index < count; index += 1) result = candleEnd(result, timeframe);
  return result;
}

function candleTimestamp(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw failure("exness_invalid_candle_time", 502);
  return Date.parse(value);
}

function canonicalUnsignedDecimal(value: unknown, field: string, allowZero: boolean): string {
  let raw: string;
  if (typeof value === "string") raw = value;
  else if (typeof value === "number" && Number.isFinite(value) && value >= 0) raw = String(value);
  else throw failure(`exness_invalid_${field}`, 502);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) throw failure(`exness_invalid_${field}`, 502);
  const [whole = "0", fraction = ""] = raw.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const result = normalizedFraction.length > 0 ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
  const [resultWhole = "", resultFraction = ""] = result.split(".");
  if (resultWhole.length > 20 || resultFraction.length > 18 || (!allowZero && result === "0")) {
    throw failure(`exness_invalid_${field}`, 502);
  }
  return result;
}

function degradedCandleBatch(provider: "exness", request: CandleRequest, reason: CandleUnavailableReason): CanonicalCandleBatch {
  const batch = unavailableCandleBatch(provider, request, reason);
  if (reason === "rate_limited") batch.warnings.push("rate_limited");
  return batch;
}

function degradedReason(error: unknown): CandleUnavailableReason {
  const statusCode = error instanceof Error ? (error as Error & { statusCode?: number }).statusCode : undefined;
  if (error instanceof Error && (statusCode === 401 || statusCode === 403
    || error.message === "exness_invalid_api_key" || error.message === "exness_invalid_signature"
    || error.message === "exness_permission_denied" || error.message === "exness_credentials_required"
    || error.message === "exness_invalid_private_key" || error.message === "exness_discovery_not_allowed"
    || error.message === "exness_access_point_not_allowed" || error.message === "exness_candle_limits_missing")) {
    return "account_scope_unavailable";
  }
  if (error instanceof Error && error.message === "exness_rate_limited") return "rate_limited";
  return "upstream_unavailable";
}

function parseHistoryPayload(page: ProviderHistoryPage) {
  const payload = record(page.payload, "history_payload");
  if (!Array.isArray(payload.items) || typeof payload.has_more !== "boolean") throw Object.assign(new Error("exness_invalid_history_payload"), { statusCode: 502 });
  return {
    connectionId: text(payload.connection_id, "connection_id"),
    accountCurrency: text(payload.account_currency, "account_currency").toUpperCase(),
    items: payload.items.map((item) => record(item, "history_item")),
    hasMore: payload.has_more,
    coverageStartedAt: payload.coverage_started_at === undefined ? null : text(payload.coverage_started_at, "coverage_started_at"),
  };
}

type ExnessHistoryCursor = {
  version: 1;
  history_start: string;
  window_from: string;
  window_to: string;
  provider_cursor: string | null;
};

function historyCursor(value: string | null, account: ProviderAccount, now: number): ExnessHistoryCursor {
  const historyStart = new Date(now - account.capabilities.history_age_days * 24 * 60 * 60 * 1_000).toISOString();
  const windowTo = new Date(now).toISOString();
  const windowFrom = new Date(Math.max(Date.parse(historyStart), now - account.capabilities.history_range_days * 24 * 60 * 60 * 1_000)).toISOString();
  if (!value) return { version: 1, history_start: historyStart, window_from: windowFrom, window_to: windowTo, provider_cursor: null };
  try {
    const parsed = JSON.parse(value) as Partial<ExnessHistoryCursor>;
    if (parsed.version === 1 && typeof parsed.history_start === "string" && typeof parsed.window_from === "string" && typeof parsed.window_to === "string"
      && (parsed.provider_cursor === null || typeof parsed.provider_cursor === "string")
      && [parsed.history_start, parsed.window_from, parsed.window_to].every((item) => Number.isFinite(Date.parse(item)))) {
      return parsed as ExnessHistoryCursor;
    }
  } catch {
    // A pre-window cursor is resumed inside the current provider window.
  }
  return { version: 1, history_start: historyStart, window_from: windowFrom, window_to: windowTo, provider_cursor: value };
}

export class ExnessTradingProviderAdapter implements TradingProviderAdapter {
  readonly provider = "exness" as const;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly accessPoints = new Map<string, { baseUrl: string; expiresAt: number }>();

  constructor(fetcher: Fetcher = fetch, now: () => number = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
  }

  private async get(
    baseUrl: string,
    path: string,
    parameters: Record<string, string>,
    rawCredentials: Readonly<Record<string, string>>,
    signal: AbortSignal = AbortSignal.timeout(CANDLE_FETCH_TIMEOUT_MS),
  ): Promise<unknown> {
    if (!allowedPath(path)) throw Object.assign(new Error("exness_path_not_allowed"), { statusCode: 500 });
    const credentials = resolveCredentials(rawCredentials);
    const query = new URLSearchParams(parameters).toString();
    const requestPath = `${path}${query ? `?${query}` : ""}`;
    const timestamp = this.now();
    const signedData = Buffer.from(JSON.stringify({
      api_key: credentials.apiKey, idempotency_key: "", timestamp, sign_version: 1, method: "GET", path: requestPath, body_hash: EMPTY_BODY_HASH,
    }), "utf8");
    const signature = sign(null, signedData, credentials.key).toString("base64url");
    let response: Response;
    try {
      response = await this.fetcher(`${baseUrl}${requestPath}`, {
        method: "GET", redirect: "error", signal,
        headers: {
          accept: "application/json", "EXN-API-KEY": credentials.apiKey, "EXN-IDEMPOTENCY-KEY": "",
          "EXN-TIMESTAMP": String(timestamp), "EXN-SIGN-VERSION": "1", "EXN-DATA": signedData.toString("base64url"), "EXN-SIGN": signature,
        },
      });
    } catch {
      throw failure(signal.aborted ? "exness_time_limit" : "exness_unavailable", 503);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (signal.aborted) throw failure("exness_time_limit", 503);
      payload = null;
    }
    if (!response.ok) throw safeError(payload, response.status);
    return payload;
  }

  private accessPointKey(accountId: string, rawCredentials: Readonly<Record<string, string>>): string {
    const credentials = resolveCredentials(rawCredentials);
    return createHash("sha256").update(`${credentials.discoveryBaseUrl}\0${credentials.apiKey}\0${accountId}`).digest("base64url");
  }

  private async accessPoint(
    accountId: string,
    rawCredentials: Readonly<Record<string, string>>,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<string> {
    const credentials = resolveCredentials(rawCredentials);
    const cacheKey = this.accessPointKey(accountId, rawCredentials);
    const cached = this.accessPoints.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > this.now()) return cached.baseUrl;
    const payload = record(await this.get(
      credentials.discoveryBaseUrl,
      DISCOVERY_PATH,
      { account_id: accountId },
      rawCredentials,
      options.signal,
    ), "discovery_response");
    if (payload.account_id !== undefined && text(payload.account_id, "discovery_account_id") !== accountId) {
      throw failure("exness_account_id_mismatch", 502);
    }
    const accessPoint = safeBaseUrl(text(payload.access_point, "access_point"), "access_point");
    this.accessPoints.set(cacheKey, { baseUrl: accessPoint, expiresAt: this.now() + ACCESS_POINT_CACHE_MS });
    return accessPoint;
  }

  private invalidateAccessPoint(accountId: string, rawCredentials: Readonly<Record<string, string>>): void {
    try { this.accessPoints.delete(this.accessPointKey(accountId, rawCredentials)); } catch { /* Invalid credentials have no cache entry. */ }
  }

  private async accountGetWithRefresh(
    accountId: string,
    path: string,
    parameters: Record<string, string>,
    rawCredentials: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const accessPoint = await this.accessPoint(accountId, rawCredentials, { signal });
    try {
      return await this.get(accessPoint, path, parameters, rawCredentials, signal);
    } catch (error) {
      if (!(error instanceof Error) || error.message === "exness_time_limit"
        || (error as Error & { statusCode?: number }).statusCode !== 503) throw error;
      this.invalidateAccessPoint(accountId, rawCredentials);
      const refreshed = await this.accessPoint(accountId, rawCredentials, { force: true, signal });
      return this.get(refreshed, path, parameters, rawCredentials, signal);
    }
  }

  private async accountDetails(accountId: string, rawCredentials: Readonly<Record<string, string>>) {
    const accessPoint = await this.accessPoint(accountId, rawCredentials);
    return record(await this.get(accessPoint, `/v1/configuration/accounts/${accountId}/account`, {}, rawCredentials), "account_details");
  }

  private async accountLimits(accountId: string, rawCredentials: Readonly<Record<string, string>>) {
    const accessPoint = await this.accessPoint(accountId, rawCredentials);
    return this.get(accessPoint, `/v1/configuration/accounts/${accountId}/limits`, {}, rawCredentials);
  }

  async validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]> {
    if (input.provider !== this.provider) throw Object.assign(new Error("exness_provider_mismatch"), { statusCode: 400 });
    if (!input.read_only_ack) throw Object.assign(new Error("exness_read_only_ack_required"), { statusCode: 400 });
    if ((input.credentials.trading_scope ?? input.credentials.tradingScope) !== "read_only") {
      throw Object.assign(new Error("exness_read_only_scope_required"), { statusCode: 400 });
    }
    resolveCredentials(input.credentials);
    const ids = accountIds(input.credentials);
    return Promise.all(ids.map(async (accountId) => {
      const [details, limitPayload] = await Promise.all([this.accountDetails(accountId, input.credentials), this.accountLimits(accountId, input.credentials)]);
      limitsFromResponse(limitPayload);
      const settings = record(details.settings, "account_settings");
      if (settings.trade_mode === "trading_disabled") throw Object.assign(new Error("exness_account_trading_disabled"), { statusCode: 400 });
      const returnedId = text(details.account_id, "account_id");
      if (returnedId !== accountId) throw Object.assign(new Error("exness_account_id_mismatch"), { statusCode: 502 });
      const currency = text(settings.currency, "account_currency").toUpperCase();
      const suffix = accountId.slice(-4).padStart(4, "0");
      return {
        external_account_id: accountId, account_label: `${text(details.account_name ?? "Exness", "account_name")} · ${suffix}`,
        account_identifier_mask: `\u2022\u2022\u2022\u2022${suffix}`, account_currency: currency, products: ["cfd" as const], read_only_status: "verified" as const,
      };
    }));
  }

  async discoverCapabilities(account: ProviderAccount): Promise<ProviderCapabilities> {
    const payload = await this.accountLimits(account.external_account_id, account.credentials);
    const limits = limitsFromResponse(payload);
    return capabilities(account.account_currency, limits.historyAgeDays, limits.historyRangeDays, candleLimitFromResponse(payload));
  }

  async fetchAccountSnapshot(account: ProviderAccount) {
    const accessPoint = await this.accessPoint(account.external_account_id, account.credentials);
    const payload = record(await this.get(accessPoint, `/v1/trading/accounts/${account.external_account_id}/snapshot`, {}, account.credentials), "snapshot");
    const state = record(payload.account_state, "account_state");
    const balance = decimal(state.balance, "balance");
    const equity = decimal(state.equity, "equity");
    const unrealized = subtractDecimal(equity, balance);
    const capturedAt = new Date(this.now()).toISOString();
    const currency = account.account_currency.toUpperCase();
    const usd = currency === "USD" || currency === "USDT";
    return {
      provider: this.provider, connection_id: account.connection_id, captured_at: capturedAt, account_currency: currency,
      equity, wallet_balance: balance, unrealized_pnl: unrealized,
      usd_equity: usd ? equity : null, usd_wallet_balance: usd ? balance : null, usd_unrealized_pnl: usd ? unrealized : null,
      valuation: currency === "USD"
        ? { status: "direct" as const, rate: "1", source: "USD", path: ["USD"], quoted_at: capturedAt }
        : currency === "USDT" ? { status: "approximate" as const, rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: capturedAt }
          : { status: "unavailable" as const, rate: null, source: null, path: [currency], quoted_at: null },
    };
  }

  async fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
    if (cursor.kind !== "opaque") throw Object.assign(new Error("exness_invalid_history_cursor"), { statusCode: 400 });
    const accessPoint = await this.accessPoint(account.external_account_id, account.credentials);
    const parameters: Record<string, string> = { limit: "200" };
    const state = historyCursor(cursor.value, account, this.now());
    if (state.provider_cursor) parameters.cursor = state.provider_cursor;
    else { parameters.from = state.window_from; parameters.to = state.window_to; }
    const payload = record(await this.get(accessPoint, `/v1/history/accounts/${account.external_account_id}/deals`, parameters, account.credentials), "deals_history");
    if (!Array.isArray(payload.items) || typeof payload.has_more !== "boolean") throw Object.assign(new Error("exness_invalid_deals_history"), { statusCode: 502 });
    const providerCursor = payload.next_cursor === undefined ? null : text(payload.next_cursor, "next_cursor");
    let next: ExnessHistoryCursor | null = null;
    if (payload.has_more) {
      if (!providerCursor) throw Object.assign(new Error("exness_next_cursor_missing"), { statusCode: 502 });
      next = { ...state, provider_cursor: providerCursor };
    } else if (Date.parse(state.window_from) > Date.parse(state.history_start)) {
      const nextTo = Date.parse(state.window_from);
      const nextFrom = Math.max(Date.parse(state.history_start), nextTo - account.capabilities.history_range_days * 24 * 60 * 60 * 1_000);
      next = { ...state, window_from: new Date(nextFrom).toISOString(), window_to: new Date(nextTo).toISOString(), provider_cursor: null };
    }
    return {
      payload: {
        connection_id: account.connection_id, account_currency: account.account_currency,
        items: payload.items, has_more: next !== null, coverage_started_at: state.window_from,
      },
      cursor: { kind: "opaque", value: next ? JSON.stringify(next) : null }, fetched_at: new Date(this.now()).toISOString(),
    };
  }

  async fetchCandles(account: ProviderAccount, request: CandleRequest): Promise<CanonicalCandleBatch> {
    if (!validCandleRequest(request)) throw failure("exness_invalid_candle_request", 400);
    const priceMode = request.price_mode;
    if (priceMode !== "bid" && priceMode !== "ask" && priceMode !== "both") {
      throw failure("exness_invalid_candle_request", 400);
    }
    const startedAt = this.now();
    const fetchedAt = new Date(startedAt).toISOString();
    const signal = AbortSignal.timeout(CANDLE_FETCH_TIMEOUT_MS);
    const accountId = account.external_account_id;
    let maximumPageSize: number;
    try {
      resolveCredentials(account.credentials);
      const limitPayload = await this.accountGetWithRefresh(
        accountId,
        `/v1/configuration/accounts/${accountId}/limits`,
        {},
        account.credentials,
        signal,
      );
      const limit = candleLimitFromResponse(limitPayload);
      if (limit === null) return degradedCandleBatch(this.provider, request, "account_scope_unavailable");
      maximumPageSize = limit;
    } catch (error) {
      return degradedCandleBatch(this.provider, request, degradedReason(error));
    }

    const timeframe = request.timeframe as keyof typeof EXNESS_CANDLE_TIMEFRAMES;
    const upstreamTimeframe = EXNESS_CANDLE_TIMEFRAMES[timeframe];
    const seriesCount = priceMode === "both" ? 2 : 1;
    const rows = new Map<string, CanonicalCandle>();
    const from = Date.parse(request.from);
    const to = Date.parse(request.to);
    let cursor = from;
    let pages = 0;
    const pageBudget = Math.max(1, Math.ceil(request.limit / (maximumPageSize * seriesCount))) + 1;
    let stopReason: "complete" | "provider_limit" | "time_limit" = "complete";

    while (cursor < to && rows.size < request.limit) {
      if (signal.aborted || this.now() >= startedAt + CANDLE_FETCH_TIMEOUT_MS) {
        stopReason = "time_limit";
        break;
      }
      if (pages >= pageBudget) {
        stopReason = "provider_limit";
        break;
      }
      const availableBars = Math.floor((request.limit - rows.size) / seriesCount);
      if (availableBars < 1) {
        stopReason = "provider_limit";
        break;
      }
      const pageBars = Math.min(maximumPageSize, availableBars);
      const pageTo = Math.min(to, advanceCandles(cursor, pageBars, timeframe));
      if (!Number.isSafeInteger(pageTo) || pageTo <= cursor) {
        stopReason = "provider_limit";
        break;
      }
      let payload: unknown;
      try {
        payload = await this.accountGetWithRefresh(
          accountId,
          CANDLE_PATH(accountId),
          {
            instrument: request.native_symbol,
            price_type: priceMode,
            timeframe: upstreamTimeframe,
            from: new Date(cursor).toISOString(),
            to: new Date(pageTo).toISOString(),
          },
          account.credentials,
          signal,
        );
      } catch (error) {
        if (error instanceof Error && error.message === "exness_time_limit" && rows.size > 0) {
          stopReason = "time_limit";
          break;
        }
        return degradedCandleBatch(this.provider, request, degradedReason(error));
      }
      pages += 1;
      try {
        const root = record(payload, "candle_history");
        if (!Array.isArray(root.candles)) throw failure("exness_invalid_candles", 502);
        for (const value of root.candles) {
          const item = record(value, "candle");
          const openTime = candleTimestamp(item.time);
          const closeTime = candleEnd(openTime, timeframe);
          if (openTime < cursor || openTime >= pageTo || openTime < from || openTime >= to || closeTime <= from) {
            throw failure("exness_invalid_candle_range", 502);
          }
          const volume = item.volume === undefined || item.volume === null
            ? null : canonicalUnsignedDecimal(item.volume, "candle_volume", true);
          const addSeries = (basis: "bid" | "ask", raw: Record<string, unknown>) => {
            const candle: CanonicalCandle = {
              provider: this.provider, product: request.product, native_symbol: request.native_symbol,
              normalized_symbol: request.normalized_symbol, timeframe: request.timeframe, series_basis: basis,
              open_time: new Date(openTime).toISOString(), close_time: new Date(closeTime).toISOString(),
              open: canonicalUnsignedDecimal(raw.open, "candle_open", false),
              high: canonicalUnsignedDecimal(raw.high, "candle_high", false),
              low: canonicalUnsignedDecimal(raw.low, "candle_low", false),
              close: canonicalUnsignedDecimal(raw.close, "candle_close", false),
              volume, source: "signed_account", source_timestamp: fetchedAt, fetched_at: fetchedAt,
              status: closeTime <= startedAt ? "final" : "partial", gap_before: false, gap_after: false,
            };
            rows.set(`${openTime}:${basis}`, candle);
          };
          if (priceMode === "both") {
            addSeries("bid", record(item.bid, "candle_bid"));
            addSeries("ask", record(item.ask, "candle_ask"));
          } else {
            addSeries(priceMode, item);
          }
        }
      } catch {
        return degradedCandleBatch(this.provider, request, "upstream_unavailable");
      }
      cursor = pageTo;
    }
    if (rows.size >= request.limit && cursor < to) stopReason = "provider_limit";
    const basisOrder = new Map<string, number>([["bid", 0], ["ask", 1]]);
    const candles = [...rows.values()].sort((left, right) => Date.parse(left.open_time) - Date.parse(right.open_time)
      || (basisOrder.get(left.series_basis) ?? 99) - (basisOrder.get(right.series_basis) ?? 99));
    return finalizeCanonicalCandleBatch(this.provider, request, candles, fetchedAt, stopReason);
  }

  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch {
    const payload = parseHistoryPayload(page);
    const fillsById = new Map<string, CanonicalFill>();
    const eventsById = new Map<string, CanonicalCashEvent>();
    for (const item of payload.items) {
      const occurredAt = new Date(text(item.event_time, "event_time")).toISOString();
      const deal = record(item.deal, "deal");
      const id = text(deal.deal_id, "deal_id");
      const type = text(deal.type, "deal_type");
      if (type === "open" || type === "close") {
        const direction = text(deal.direction, "direction");
        if (direction !== "buy" && direction !== "sell") throw Object.assign(new Error("exness_unknown_direction"), { statusCode: 502 });
        const positionId = text(deal.position_id, "position_id");
        const symbol = text(deal.instrument, "instrument").toUpperCase();
        const profit = record(deal.profit, "profit");
        const profitAmount = decimal(profit.amount, "profit_amount");
        const profitCurrency = text(profit.currency, "profit_currency").toUpperCase();
        const positionSide: CanonicalFill["position_side"] = type === "open"
          ? direction === "buy" ? "long" : "short"
          : direction === "sell" ? "long" : "short";
        fillsById.set(id, {
          provider: this.provider, connection_id: payload.connectionId, native_fill_id: id,
          native_order_id: text(deal.order_id ?? id, "order_id"), native_position_id: positionId, symbol, native_symbol: symbol,
          product: "cfd", side: direction, position_side: positionSide, action: type,
          price: decimal(deal.price, "price"), quantity: decimal(deal.volume, "volume"), contract_multiplier: "1",
          occurred_at: occurredAt, realized_pnl: { amount: profitAmount, asset: profitCurrency, usd_value: profitCurrency === "USD" ? profitAmount : null },
          fee: { amount: normalizeFee(deal.commission), asset: profitCurrency, usd_value: profitCurrency === "USD" ? normalizeFee(deal.commission) : null }, liquidity: "unknown",
        });
        continue;
      }
      const profit = record(deal.profit, "profit");
      const amount = decimal(profit.amount, "profit_amount");
      const currency = text(profit.currency, "profit_currency").toUpperCase();
      const eventType: CanonicalCashEvent["type"] = type === "balance" ? (amount.startsWith("-") ? "withdrawal" : "deposit")
        : type === "swap_fee" ? "swap_fee" : type === "dividend" ? "dividend"
          : type === "exness_dollar" ? "bonus" : type === "admin_fee" || type === "null_compensation" ? "admin_adjustment" : "unknown";
      eventsById.set(id, {
        provider: this.provider, connection_id: payload.connectionId, native_event_id: id, native_type: type,
        type: eventType, amount, asset: currency, usd_value: currency === "USD" ? amount : null,
        occurred_at: occurredAt, symbol: deal.instrument === undefined ? null : text(deal.instrument, "instrument").toUpperCase(),
        native_position_id: deal.position_id === undefined ? null : text(deal.position_id, "position_id"),
      });
    }
    const fills = [...fillsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const cashEvents = [...eventsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const times = [...fills.map((fill) => fill.occurred_at), ...cashEvents.map((event) => event.occurred_at)].sort();
    return {
      fills, cash_events: cashEvents, next_cursor: page.cursor, exhausted: !payload.hasMore,
      coverage_started_at: times[0] ?? payload.coverageStartedAt ?? page.fetched_at, coverage_ended_at: times.at(-1) ?? page.fetched_at,
      warnings: cashEvents.some((event) => event.type === "unknown") ? ["exness_unknown_deal_type"] : [],
    };
  }
}
