import { createHash, createHmac } from "node:crypto";
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
const ALLOWED_HOSTS = new Set(["api.bitget.com"]);
const ALLOWED_PATHS = new Set(["/api/v2/mix/account/accounts", "/api/v2/mix/order/fills", "/api/v2/mix/account/bill"]);

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error(`bitget_invalid_${field}`), { statusCode: 502 });
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if ((typeof value !== "string" && typeof value !== "number") || (!allowEmpty && String(value).length === 0)) {
    throw Object.assign(new Error(`bitget_invalid_${field}`), { statusCode: 502 });
  }
  return String(value);
}

function isoTime(value: unknown, field: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error(`bitget_invalid_${field}`), { statusCode: 502 });
  return new Date(number).toISOString();
}

function resolveCredentials(value: Readonly<Record<string, string>>) {
  const apiKey = value.api_key ?? value.apiKey;
  const secretKey = value.secret_key ?? value.secretKey;
  const passphrase = value.passphrase;
  if (!apiKey || !secretKey || !passphrase) throw Object.assign(new Error("bitget_credentials_required"), { statusCode: 400 });
  return { apiKey, secretKey, passphrase };
}

function safeError(code: string, status: number) {
  const rateLimited = code === "429" || code === "40010" || status === 429;
  return Object.assign(new Error(rateLimited ? "bitget_rate_limited" : code === "40014" ? "bitget_invalid_signature" : "bitget_unavailable"), {
    statusCode: rateLimited ? 429 : status >= 500 ? 503 : 400,
  });
}

function capabilities(): ProviderCapabilities {
  return {
    products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 90, page_size: 100,
    pagination: "opaque", position_grouping: "hedge_zero_cycle", has_position_id: false, has_realized_pnl: true,
    has_fee_asset: true, has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true,
    account_currency: "USDT", settlement_assets: ["USDT"], valuation_pairs: ["USDT/USD"],
    candles: unavailableCandleCapabilities(),
  };
}

function parseHistoryPayload(page: ProviderHistoryPage) {
  const payload = record(page.payload, "history_payload");
  if (!Array.isArray(payload.fills) || !Array.isArray(payload.bills) || typeof payload.exhausted !== "boolean") {
    throw Object.assign(new Error("bitget_invalid_history_payload"), { statusCode: 502 });
  }
  return {
    connectionId: text(payload.connection_id, "connection_id"),
    fills: payload.fills.map((item) => record(item, "fill")),
    bills: payload.bills.map((item) => record(item, "bill")),
    exhausted: payload.exhausted,
  };
}

function billType(value: string): CanonicalCashEvent["type"] {
  if (["trans_from_exchange", "trans_to_exchange", "TRANSFER_IN", "TRANSFER_OUT"].includes(value)) return "internal_transfer";
  if (["funding_fee", "contract_settle_fee", "SETTLEMENT"].includes(value)) return "funding";
  if (["fee_return", "FEE_REFUND"].includes(value)) return "commission_adjustment";
  if (value === "bonus" || value === "BONUS") return "bonus";
  return "unknown";
}

type BitgetResponse = { data: unknown };

export class BitgetTradingProviderAdapter implements TradingProviderAdapter {
  readonly provider = "bitget" as const;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;

  constructor(baseUrl = "https://api.bitget.com", fetcher: Fetcher = fetch, now: () => number = Date.now) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.pathname !== "/") throw new Error("bitget_base_url_not_allowed");
    this.baseUrl = url.origin;
    this.fetcher = fetcher;
    this.now = now;
  }

  private async get(path: string, parameters: Record<string, string>, rawCredentials: Readonly<Record<string, string>>): Promise<BitgetResponse> {
    if (!ALLOWED_PATHS.has(path)) throw Object.assign(new Error("bitget_path_not_allowed"), { statusCode: 500 });
    const credentials = resolveCredentials(rawCredentials);
    const query = new URLSearchParams(parameters).toString();
    const requestPath = `${path}${query ? `?${query}` : ""}`;
    const timestamp = String(this.now());
    const signature = createHmac("sha256", credentials.secretKey).update(`${timestamp}GET${requestPath}`).digest("base64");
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${requestPath}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: { accept: "application/json", "Content-Type": "application/json", locale: "en-US", "ACCESS-KEY": credentials.apiKey, "ACCESS-SIGN": signature, "ACCESS-PASSPHRASE": credentials.passphrase, "ACCESS-TIMESTAMP": timestamp },
      });
    } catch {
      throw Object.assign(new Error("bitget_unavailable"), { statusCode: 503 });
    }
    const payload = await response.json().catch(() => null);
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const code = typeof root.code === "string" ? root.code : "";
    if (!response.ok || code !== "00000") throw safeError(code, response.status);
    return { data: root.data };
  }

  async validateCredentials(input: ProviderCredentialInput): Promise<ValidatedAccount[]> {
    if (input.provider !== this.provider) throw Object.assign(new Error("bitget_provider_mismatch"), { statusCode: 400 });
    if (!input.read_only_ack) throw Object.assign(new Error("bitget_read_only_ack_required"), { statusCode: 400 });
    const credentials = resolveCredentials(input.credentials);
    const response = await this.get("/api/v2/mix/account/accounts", { productType: "USDT-FUTURES" }, input.credentials);
    if (!Array.isArray(response.data)) throw Object.assign(new Error("bitget_invalid_accounts"), { statusCode: 502 });
    const accounts = response.data.map((item) => record(item, "account"));
    const usdt = accounts.find((entry) => text(entry.marginCoin, "margin_coin").toUpperCase() === "USDT");
    if (!usdt) throw Object.assign(new Error("bitget_usdt_account_not_found"), { statusCode: 400 });
    const mode = text(usdt.posMode ?? "hedge_mode", "position_mode");
    if (mode !== "hedge_mode" && mode !== "one_way_mode") throw Object.assign(new Error("bitget_unknown_position_mode"), { statusCode: 400 });
    const id = `key-${createHash("sha256").update(credentials.apiKey).digest("hex").slice(0, 16)}`;
    const suffix = id.slice(-4).padStart(4, "0");
    return [{
      external_account_id: id, account_label: `Bitget · ${suffix}`, account_identifier_mask: `\u2022\u2022\u2022\u2022${suffix}`,
      account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "user_attested",
    }];
  }

  async discoverCapabilities(account: ProviderAccount): Promise<ProviderCapabilities> {
    return { ...capabilities(), position_grouping: account.capabilities.position_grouping === "net_zero_cycle" ? "net_zero_cycle" : "hedge_zero_cycle" };
  }

  async fetchAccountSnapshot(account: ProviderAccount) {
    const response = await this.get("/api/v2/mix/account/accounts", { productType: "USDT-FUTURES" }, account.credentials);
    if (!Array.isArray(response.data)) throw Object.assign(new Error("bitget_invalid_accounts"), { statusCode: 502 });
    const usdt = response.data.map((item) => record(item, "account")).find((entry) => String(entry.marginCoin).toUpperCase() === "USDT");
    if (!usdt) throw Object.assign(new Error("bitget_usdt_account_not_found"), { statusCode: 502 });
    const equity = text(usdt.accountEquity, "account_equity");
    const balance = text(usdt.available ?? usdt.accountEquity, "available_balance");
    const unrealized = text(usdt.unrealizedPL ?? "0", "unrealized_pnl");
    const capturedAt = new Date(this.now()).toISOString();
    return {
      provider: this.provider, connection_id: account.connection_id, captured_at: capturedAt, account_currency: "USDT",
      equity, wallet_balance: balance, unrealized_pnl: unrealized, usd_equity: equity, usd_wallet_balance: balance,
      usd_unrealized_pnl: unrealized,
      valuation: { status: "approximate" as const, rate: "1", source: "USDT approximate", path: ["USDT", "USD"], quoted_at: capturedAt },
    };
  }

  async fetchHistory(account: ProviderAccount, cursor: ProviderCursor): Promise<ProviderHistoryPage> {
    if (cursor.kind !== "opaque") throw Object.assign(new Error("bitget_invalid_history_cursor"), { statusCode: 400 });
    let parsed: Record<string, unknown> = {};
    if (cursor.value) {
      try { parsed = record(JSON.parse(cursor.value), "history_cursor"); } catch { throw Object.assign(new Error("bitget_invalid_history_cursor"), { statusCode: 400 }); }
    }
    const end = typeof parsed.end === "number" ? parsed.end : this.now();
    const start = typeof parsed.start === "number" ? parsed.start : this.now() - HISTORY_LIMIT_MS;
    if (start < this.now() - HISTORY_LIMIT_MS || end <= start || end - start > HISTORY_LIMIT_MS) {
      throw Object.assign(new Error("bitget_history_range_exceeded"), { statusCode: 400 });
    }
    const fillsBefore = typeof parsed.fills_before === "string" ? parsed.fills_before : "";
    const billsBefore = typeof parsed.bills_before === "string" ? parsed.bills_before : "";
    const fillParams: Record<string, string> = { productType: "USDT-FUTURES", startTime: String(start), endTime: String(end), limit: "100" };
    const billParams: Record<string, string> = { productType: "USDT-FUTURES", startTime: String(start), endTime: String(end), limit: "100" };
    if (fillsBefore) fillParams.idLessThan = fillsBefore;
    if (billsBefore) billParams.idLessThan = billsBefore;
    const [fillResponse, billResponse] = await Promise.all([
      this.get("/api/v2/mix/order/fills", fillParams, account.credentials),
      this.get("/api/v2/mix/account/bill", billParams, account.credentials),
    ]);
    const fillData = record(fillResponse.data, "fills_data");
    const billData = record(billResponse.data, "bills_data");
    const fills = Array.isArray(fillData.fillList) ? fillData.fillList.map((item) => record(item, "fill")) : [];
    const bills = Array.isArray(billData.bills) ? billData.bills.map((item) => record(item, "bill")) : [];
    const nextFills = text(fillData.endId ?? "", "fills_cursor", true);
    const nextBills = text(billData.endId ?? "", "bills_cursor", true);
    return {
      payload: { connection_id: account.connection_id, fills, bills, exhausted: !nextFills && !nextBills },
      cursor: { kind: "opaque", value: JSON.stringify({ fills_before: nextFills, bills_before: nextBills, start, end }) },
      fetched_at: new Date(this.now()).toISOString(),
    };
  }

  async fetchCandles(_account: ProviderAccount, request: CandleRequest): Promise<CanonicalCandleBatch> {
    return unavailableCandleBatch(this.provider, request);
  }

  normalizeHistory(page: ProviderHistoryPage): CanonicalHistoryBatch {
    const payload = parseHistoryPayload(page);
    const fillsById = new Map<string, CanonicalFill>();
    for (const fill of payload.fills) {
      if (text(fill.productType ?? "USDT-FUTURES", "product_type") !== "USDT-FUTURES") continue;
      const symbol = text(fill.symbol, "symbol").toUpperCase();
      if (!symbol.endsWith("USDT")) continue;
      const mode = text(fill.posMode, "position_mode");
      if (mode !== "one_way_mode" && mode !== "hedge_mode") throw Object.assign(new Error("bitget_unknown_position_mode"), { statusCode: 502 });
      const side = text(fill.side, "side").toLowerCase();
      if (side !== "buy" && side !== "sell") throw Object.assign(new Error("bitget_unknown_side"), { statusCode: 502 });
      const tradeSide = text(fill.tradeSide, "trade_side").toLowerCase();
      if (tradeSide !== "open" && tradeSide !== "close") throw Object.assign(new Error("bitget_unknown_trade_side"), { statusCode: 502 });
      let positionSide: CanonicalFill["position_side"] = "both";
      if (mode === "hedge_mode") {
        const holdSide = text(fill.holdSide ?? (tradeSide === "open" ? (side === "buy" ? "long" : "short") : side === "sell" ? "long" : "short"), "hold_side").toLowerCase();
        if (holdSide !== "long" && holdSide !== "short") throw Object.assign(new Error("bitget_unknown_hold_side"), { statusCode: 502 });
        positionSide = holdSide;
      }
      const id = text(fill.tradeId, "trade_id");
      if (fillsById.has(id)) continue;
      const feeDetails = Array.isArray(fill.feeDetail) ? fill.feeDetail.map((item) => record(item, "fee_detail")) : [];
      const feeDetail = feeDetails[0];
      const feeAsset = feeDetail ? text(feeDetail.feeCoin, "fee_coin").toUpperCase() : "USDT";
      const fee = feeDetail ? text(feeDetail.totalFee ?? feeDetail.totalDeductionFee ?? "0", "total_fee") : "0";
      const pnl = text(fill.profit ?? "0", "profit");
      fillsById.set(id, {
        provider: this.provider, connection_id: payload.connectionId, native_fill_id: id, native_order_id: text(fill.orderId, "order_id"),
        native_position_id: null, symbol, native_symbol: symbol, product: "usdt_perpetual", side: side as "buy" | "sell",
        position_side: positionSide, action: tradeSide as "open" | "close", price: text(fill.price, "price"),
        quantity: text(fill.baseVolume, "base_volume"), contract_multiplier: "1", occurred_at: isoTime(fill.cTime, "created_time"),
        realized_pnl: { amount: pnl, asset: "USDT", usd_value: pnl }, fee: { amount: fee, asset: feeAsset, usd_value: feeAsset === "USDT" ? fee : null },
        liquidity: fill.tradeScope === "maker" ? "maker" : fill.tradeScope === "taker" ? "taker" : "unknown",
      });
    }
    const eventsById = new Map<string, CanonicalCashEvent>();
    for (const bill of payload.bills) {
      if (text(bill.productType ?? "USDT-FUTURES", "bill_product_type") !== "USDT-FUTURES") continue;
      const currency = text(bill.marginCoin ?? bill.coin, "margin_coin").toUpperCase();
      if (currency !== "USDT") continue;
      const businessType = text(bill.businessType, "business_type");
      const id = text(bill.id ?? bill.billId, "bill_id");
      if (eventsById.has(id)) continue;
      const amount = text(bill.amount, "bill_amount");
      const symbol = bill.symbol === undefined || bill.symbol === "" ? null : text(bill.symbol, "bill_symbol").toUpperCase();
      eventsById.set(id, {
        provider: this.provider, connection_id: payload.connectionId, native_event_id: id, native_type: businessType,
        type: billType(businessType), amount, asset: currency, usd_value: amount, occurred_at: isoTime(bill.cTime ?? bill.ts, "bill_time"),
        symbol, native_position_id: null,
      });
    }
    const fills = [...fillsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const cashEvents = [...eventsById.values()].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
    const times = [...fills.map((fill) => fill.occurred_at), ...cashEvents.map((event) => event.occurred_at)].sort();
    return {
      fills, cash_events: cashEvents, next_cursor: page.cursor, exhausted: payload.exhausted,
      coverage_started_at: times[0] ?? page.fetched_at, coverage_ended_at: times.at(-1) ?? page.fetched_at,
      warnings: cashEvents.some((event) => event.type === "unknown") ? ["bitget_unknown_bill_type"] : [],
    };
  }
}
