import { createHmac } from "node:crypto";
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
const ALLOWED_HOSTS = new Set(["www.okx.com"]);
const ALLOWED_PATHS = new Set([
  "/api/v5/account/config",
  "/api/v5/account/balance",
  "/api/v5/trade/fills-history",
  "/api/v5/account/bills-archive",
]);

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error(`okx_invalid_${field}`), { statusCode: 502 });
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if ((typeof value !== "string" && typeof value !== "number") || (!allowEmpty && String(value).length === 0)) {
    throw Object.assign(new Error(`okx_invalid_${field}`), { statusCode: 502 });
  }
  return String(value);
}

function isoTime(value: unknown, field: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error(`okx_invalid_${field}`), { statusCode: 502 });
  return new Date(number).toISOString();
}

function resolveCredentials(value: Readonly<Record<string, string>>) {
  const apiKey = value.api_key ?? value.apiKey;
  const secretKey = value.secret_key ?? value.secretKey;
  const passphrase = value.passphrase;
  if (!apiKey || !secretKey || !passphrase) throw Object.assign(new Error("okx_credentials_required"), { statusCode: 400 });
  return { apiKey, secretKey, passphrase };
}

function safeError(code: string, status: number): Error & { statusCode: number } {
  const rateLimited = code === "50011" || status === 429;
  return Object.assign(new Error(rateLimited ? "okx_rate_limited" : code === "50113" ? "okx_invalid_signature" : "okx_unavailable"), {
    statusCode: rateLimited ? 429 : status >= 500 ? 503 : 400,
  });
}

function capabilities(positionMode: "net_mode" | "long_short_mode" = "long_short_mode"): ProviderCapabilities {
  return {
    products: ["usdt_perpetual", "usdt_delivery"], history_age_days: 90, history_range_days: 90, page_size: 100,
    pagination: "opaque", position_grouping: positionMode === "net_mode" ? "net_zero_cycle" : "hedge_zero_cycle",
    has_position_id: false, has_realized_pnl: true, has_fee_asset: true, has_funding_or_swap: true,
    has_external_cash_flow: true, has_usd_valuation: true, account_currency: "USDT", settlement_assets: ["USDT"],
    valuation_pairs: ["USDT/USD"],
  };
}

type OkxResponse = { code: string; data: Array<Record<string, unknown>> };

function parseHistoryPayload(page: ProviderHistoryPage) {
  const payload = record(page.payload, "history_payload");
  if (!Array.isArray(payload.fills) || !Array.isArray(payload.bills) || typeof payload.exhausted !== "boolean") {
    throw Object.assign(new Error("okx_invalid_history_payload"), { statusCode: 502 });
  }
  return {
    connectionId: text(payload.connection_id, "connection_id"),
    fills: payload.fills.map((item) => record(item, "fill")),
    bills: payload.bills.map((item) => record(item, "bill")),
    exhausted: payload.exhausted,
  };
}

function billType(type: string): CanonicalCashEvent["type"] {
  if (type === "8") return "funding";
  if (type === "1" || type === "6") return "internal_transfer";
  return "unknown";
}

export class OkxTradingProviderAdapter implements TradingProviderAdapter {
  readonly provider = "okx" as const;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;

  constructor(baseUrl = "https://www.okx.com", fetcher: Fetcher = fetch, now: () => number = Date.now) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.pathname !== "/") {
      throw new Error("okx_base_url_not_allowed");
    }
    this.baseUrl = url.origin;
    this.fetcher = fetcher;
    this.now = now;
  }

  private async get(path: string, parameters: Record<string, string> = {}, rawCredentials: Readonly<Record<string, string>>): Promise<OkxResponse> {
    if (!ALLOWED_PATHS.has(path)) throw Object.assign(new Error("okx_path_not_allowed"), { statusCode: 500 });
    const credentials = resolveCredentials(rawCredentials);
    const query = new URLSearchParams(parameters);
    const requestPath = `${path}${query.size > 0 ? `?${query}` : ""}`;
    const timestamp = new Date(this.now()).toISOString();
    const signature = createHmac("sha256", credentials.secretKey).update(`${timestamp}GET${requestPath}`).digest("base64");
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${requestPath}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: {
          accept: "application/json", "OK-ACCESS-KEY": credentials.apiKey, "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp, "OK-ACCESS-PASSPHRASE": credentials.passphrase,
        },
      });
    } catch {
      throw Object.assign(new Error("okx_unavailable"), { statusCode: 503 });
    }
    const payload = await response.json().catch(() => null);
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const code = typeof root.code === "string" ? root.code : "";
    if (!response.ok || code !== "0") throw safeError(code, response.status);
    if (!Array.isArray(root.data)) throw Object.assign(new Error("okx_invalid_response"), { statusCode: 502 });
    return { code, data: root.data.map((item) => record(item, "response_item")) };
  }

  async validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]> {
    if (input.provider !== this.provider) throw Object.assign(new Error("okx_provider_mismatch"), { statusCode: 400 });
    if (!input.read_only_ack) throw Object.assign(new Error("okx_read_only_ack_required"), { statusCode: 400 });
    const [configResponse, balanceResponse] = await Promise.all([
      this.get("/api/v5/account/config", {}, input.credentials),
      this.get("/api/v5/account/balance", {}, input.credentials),
    ]);
    const config = configResponse.data[0];
    if (!config) throw Object.assign(new Error("okx_invalid_account_config"), { statusCode: 502 });
    const positionMode = text(config.posMode, "position_mode");
    if (positionMode !== "net_mode" && positionMode !== "long_short_mode") throw Object.assign(new Error("okx_unknown_position_mode"), { statusCode: 400 });
    const permission = text(config.perm ?? "", "permission", true).toLowerCase();
    if (permission.split(",").some((entry) => entry.trim() === "trade")) throw Object.assign(new Error("okx_trading_permission_not_allowed"), { statusCode: 400 });
    const balance = balanceResponse.data[0];
    const details = balance && Array.isArray(balance.details) ? balance.details.map((item) => record(item, "balance_detail")) : [];
    if (details.some((detail) => text(detail.ccy, "balance_currency").toUpperCase() !== "USDT" && Number(detail.eq ?? detail.cashBal ?? 0) !== 0)) {
      throw Object.assign(new Error("okx_non_usdt_product_not_supported"), { statusCode: 400 });
    }
    const uid = text(config.uid, "uid");
    const suffix = uid.slice(-4);
    return [{
      external_account_id: uid, account_label: `OKX · ${suffix}`, account_identifier_mask: `••••${suffix}`,
      account_currency: "USDT", products: capabilities(positionMode).products,
      read_only_status: permission.includes("read_only") ? "verified" : "user_attested",
    }];
  }

  async discoverCapabilities(account: ProviderAccount): Promise<ProviderCapabilities> {
    return account.capabilities.position_grouping === "net_zero_cycle" ? capabilities("net_mode") : capabilities("long_short_mode");
  }

  async fetchAccountSnapshot(account: ProviderAccount) {
    const response = await this.get("/api/v5/account/balance", {}, account.credentials);
    const balance = response.data[0];
    if (!balance) throw Object.assign(new Error("okx_invalid_balance"), { statusCode: 502 });
    const details = Array.isArray(balance.details) ? balance.details.map((item) => record(item, "balance_detail")) : [];
    const usdt = details.find((detail) => String(detail.ccy).toUpperCase() === "USDT");
    const equity = usdt ? text(usdt.eq, "equity") : text(balance.totalEq, "total_equity");
    const wallet = usdt ? text(usdt.cashBal ?? usdt.eq, "wallet_balance") : equity;
    const unrealized = usdt ? text(usdt.upl ?? "0", "unrealized_pnl") : "0";
    const capturedAt = new Date(this.now()).toISOString();
    return {
      provider: this.provider, connection_id: account.connection_id, captured_at: capturedAt, account_currency: "USDT",
      equity, wallet_balance: wallet, unrealized_pnl: unrealized, usd_equity: equity, usd_wallet_balance: wallet,
      usd_unrealized_pnl: unrealized,
      valuation: { status: "approximate" as const, rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: capturedAt },
    };
  }

  async fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
    if (cursor.kind !== "opaque") throw Object.assign(new Error("okx_invalid_history_cursor"), { statusCode: 400 });
    let parsed: Record<string, unknown> = {};
    if (cursor.value) {
      try { parsed = record(JSON.parse(cursor.value), "history_cursor"); } catch { throw Object.assign(new Error("okx_invalid_history_cursor"), { statusCode: 400 }); }
    }
    const fillsAfter = typeof parsed.fills_after === "string" ? parsed.fills_after : "0";
    const billsAfter = typeof parsed.bills_after === "string" ? parsed.bills_after : "0";
    const [swap, futures, bills] = await Promise.all([
      this.get("/api/v5/trade/fills-history", { instType: "SWAP", after: fillsAfter, limit: "100" }, account.credentials),
      this.get("/api/v5/trade/fills-history", { instType: "FUTURES", after: fillsAfter, limit: "100" }, account.credentials),
      this.get("/api/v5/account/bills-archive", { after: billsAfter, limit: "100" }, account.credentials),
    ]);
    const fills = [...swap.data, ...futures.data];
    const lastFill = [...fills].sort((left, right) => Number(right.fillTime ?? right.ts ?? 0) - Number(left.fillTime ?? left.ts ?? 0)).at(-1);
    const lastBill = [...bills.data].sort((left, right) => Number(right.ts ?? 0) - Number(left.ts ?? 0)).at(-1);
    const next = {
      fills_after: lastFill ? text(lastFill.tradeId, "trade_id") : fillsAfter,
      bills_after: lastBill ? text(lastBill.billId, "bill_id") : billsAfter,
    };
    return {
      payload: { connection_id: account.connection_id, fills, bills: bills.data, exhausted: swap.data.length < 100 && futures.data.length < 100 && bills.data.length < 100 },
      cursor: { kind: "opaque", value: JSON.stringify(next) }, fetched_at: new Date(this.now()).toISOString(),
    };
  }

  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch {
    const payload = parseHistoryPayload(page);
    const fillsById = new Map<string, CanonicalFill>();
    for (const fill of payload.fills) {
      const instrumentType = text(fill.instType, "instrument_type").toUpperCase();
      if (instrumentType !== "SWAP" && instrumentType !== "FUTURES") continue;
      const instrumentId = text(fill.instId, "instrument_id").toUpperCase();
      if (!(instrumentId.includes("-USDT-") || instrumentId.endsWith("-USDT"))) continue;
      const rawPositionSide = text(fill.posSide, "position_side").toLowerCase();
      if (!new Set(["net", "long", "short"]).has(rawPositionSide)) throw Object.assign(new Error("okx_unknown_position_mode"), { statusCode: 502 });
      const side = text(fill.side, "side").toLowerCase();
      if (side !== "buy" && side !== "sell") throw Object.assign(new Error("okx_unknown_side"), { statusCode: 502 });
      const positionSide: CanonicalFill["position_side"] = rawPositionSide === "net" ? "both" : rawPositionSide as "long" | "short";
      const pnl = text(fill.fillPnl ?? "0", "fill_pnl");
      const action: CanonicalFill["action"] = positionSide === "long" ? (side === "buy" ? "open" : "close")
        : positionSide === "short" ? (side === "sell" ? "open" : "close") : Number(pnl) !== 0 ? "close" : "open";
      const nativeId = `${instrumentId}:${text(fill.tradeId, "trade_id")}`;
      if (fillsById.has(nativeId)) continue;
      const feeAsset = text(fill.feeCcy, "fee_currency").toUpperCase();
      const fee = text(fill.fee ?? "0", "fee");
      fillsById.set(nativeId, {
        provider: this.provider, connection_id: payload.connectionId, native_fill_id: nativeId,
        native_order_id: text(fill.ordId, "order_id"), native_position_id: null, symbol: instrumentId,
        native_symbol: instrumentId, product: instrumentType === "SWAP" ? "usdt_perpetual" : "usdt_delivery",
        side: side as "buy" | "sell", position_side: positionSide, action,
        price: text(fill.fillPx, "fill_price"), quantity: text(fill.fillSz, "fill_size"),
        contract_multiplier: text(fill.ctVal ?? "1", "contract_multiplier"), occurred_at: isoTime(fill.fillTime ?? fill.ts, "fill_time"),
        realized_pnl: { amount: pnl, asset: "USDT", usd_value: pnl }, fee: { amount: fee, asset: feeAsset, usd_value: feeAsset === "USDT" ? fee : null },
        liquidity: fill.execType === "M" ? "maker" : fill.execType === "T" ? "taker" : "unknown",
      });
    }
    const eventsById = new Map<string, CanonicalCashEvent>();
    for (const bill of payload.bills) {
      const instrumentType = text(bill.instType ?? "", "bill_instrument_type", true).toUpperCase();
      if (instrumentType && instrumentType !== "SWAP" && instrumentType !== "FUTURES") continue;
      const currency = text(bill.ccy, "bill_currency").toUpperCase();
      if (currency !== "USDT") continue;
      const nativeType = text(bill.type, "bill_type");
      const id = text(bill.billId, "bill_id");
      if (eventsById.has(id)) continue;
      const amount = text(bill.balChg, "balance_change");
      const symbol = bill.instId === undefined || bill.instId === "" ? null : text(bill.instId, "bill_instrument_id").toUpperCase();
      eventsById.set(id, {
        provider: this.provider, connection_id: payload.connectionId, native_event_id: id,
        native_type: `${nativeType}:${text(bill.subType ?? "", "bill_subtype", true)}`, type: billType(nativeType),
        amount, asset: currency, usd_value: amount, occurred_at: isoTime(bill.ts, "bill_time"), symbol, native_position_id: null,
      });
    }
    const fills = [...fillsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const cashEvents = [...eventsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const times = [...fills.map((fill) => fill.occurred_at), ...cashEvents.map((event) => event.occurred_at)].sort();
    return {
      fills, cash_events: cashEvents, next_cursor: page.cursor, exhausted: payload.exhausted,
      coverage_started_at: times[0] ?? page.fetched_at, coverage_ended_at: times.at(-1) ?? page.fetched_at,
      warnings: cashEvents.some((event) => event.type === "unknown") ? ["okx_unknown_bill_type"] : [],
    };
  }
}
