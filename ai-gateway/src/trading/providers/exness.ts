import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import type {
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
    || /^\/v1\/history\/accounts\/\d{1,20}\/deals$/.test(path);
}

function privateKey(value: string): KeyObject {
  try {
    if (value.includes("BEGIN PRIVATE KEY")) return createPrivateKey(value);
    if (/^[a-fA-F0-9]{128}$/.test(value)) {
      const seed = Buffer.from(value.slice(0, 64), "hex");
      const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
      return createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" });
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
  const code = Number(root.code);
  const rateLimited = status === 429 || code === 1 || code === 3015;
  const message = rateLimited ? "exness_rate_limited" : code === 1001 ? "exness_invalid_signature" : code === 1002 ? "exness_permission_denied" : "exness_unavailable";
  return Object.assign(new Error(message), { statusCode: rateLimited ? 429 : status >= 500 ? 503 : 400 });
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

function capabilities(currency: string, historyAgeDays: number, historyRangeDays: number): ProviderCapabilities {
  return {
    products: ["cfd"], history_age_days: historyAgeDays, history_range_days: historyRangeDays, page_size: 200,
    pagination: "opaque", position_grouping: "position_id_cycle", has_position_id: true, has_realized_pnl: true,
    has_fee_asset: true, has_funding_or_swap: true, has_external_cash_flow: true,
    has_usd_valuation: currency === "USD" || currency === "USDT", account_currency: currency,
    settlement_assets: [currency], valuation_pairs: currency === "USD" ? ["USD"] : currency === "USDT" ? ["USDT/USD"] : [`${currency}/USD`],
  };
}

function parseHistoryPayload(page: ProviderHistoryPage) {
  const payload = record(page.payload, "history_payload");
  if (!Array.isArray(payload.items) || typeof payload.has_more !== "boolean") throw Object.assign(new Error("exness_invalid_history_payload"), { statusCode: 502 });
  return {
    connectionId: text(payload.connection_id, "connection_id"),
    accountCurrency: text(payload.account_currency, "account_currency").toUpperCase(),
    items: payload.items.map((item) => record(item, "history_item")),
    hasMore: payload.has_more,
  };
}

export class ExnessTradingProviderAdapter implements TradingProviderAdapter {
  readonly provider = "exness" as const;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly accessPoints = new Map<string, string>();

  constructor(fetcher: Fetcher = fetch, now: () => number = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
  }

  private async get(baseUrl: string, path: string, parameters: Record<string, string>, rawCredentials: Readonly<Record<string, string>>): Promise<unknown> {
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
        method: "GET", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: {
          accept: "application/json", "EXN-API-KEY": credentials.apiKey, "EXN-IDEMPOTENCY-KEY": "",
          "EXN-TIMESTAMP": String(timestamp), "EXN-SIGN-VERSION": "1", "EXN-DATA": signedData.toString("base64url"), "EXN-SIGN": signature,
        },
      });
    } catch {
      throw Object.assign(new Error("exness_unavailable"), { statusCode: 503 });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw safeError(payload, response.status);
    return payload;
  }

  private async accessPoint(accountId: string, rawCredentials: Readonly<Record<string, string>>): Promise<string> {
    const cached = this.accessPoints.get(accountId);
    if (cached) return cached;
    const credentials = resolveCredentials(rawCredentials);
    const payload = record(await this.get(credentials.discoveryBaseUrl, DISCOVERY_PATH, { account_id: accountId }, rawCredentials), "discovery_response");
    const accessPoint = safeBaseUrl(text(payload.access_point, "access_point"), "access_point");
    this.accessPoints.set(accountId, accessPoint);
    return accessPoint;
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
      const suffix = accountId.slice(-4);
      return {
        external_account_id: accountId, account_label: `${text(details.account_name ?? "Exness", "account_name")} · ${suffix}`,
        account_identifier_mask: `••••${suffix}`, account_currency: currency, products: ["cfd" as const], read_only_status: "verified" as const,
      };
    }));
  }

  async discoverCapabilities(account: ProviderAccount): Promise<ProviderCapabilities> {
    const payload = await this.accountLimits(account.external_account_id, account.credentials);
    const limits = limitsFromResponse(payload);
    return capabilities(account.account_currency, limits.historyAgeDays, limits.historyRangeDays);
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
    if (cursor.value) parameters.cursor = cursor.value;
    else {
      const rangeMs = account.capabilities.history_range_days * 24 * 60 * 60 * 1_000;
      parameters.from = new Date(this.now() - rangeMs).toISOString();
      parameters.to = new Date(this.now()).toISOString();
    }
    const payload = record(await this.get(accessPoint, `/v1/history/accounts/${account.external_account_id}/deals`, parameters, account.credentials), "deals_history");
    if (!Array.isArray(payload.items) || typeof payload.has_more !== "boolean") throw Object.assign(new Error("exness_invalid_deals_history"), { statusCode: 502 });
    const nextCursor = payload.next_cursor === undefined ? null : text(payload.next_cursor, "next_cursor");
    return {
      payload: { connection_id: account.connection_id, account_currency: account.account_currency, items: payload.items, has_more: payload.has_more },
      cursor: { kind: "opaque", value: nextCursor }, fetched_at: new Date(this.now()).toISOString(),
    };
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
      coverage_started_at: times[0] ?? page.fetched_at, coverage_ended_at: times.at(-1) ?? page.fetched_at,
      warnings: cashEvents.some((event) => event.type === "unknown") ? ["exness_unknown_deal_type"] : [],
    };
  }
}
