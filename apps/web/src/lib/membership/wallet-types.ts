import { membershipQuote, parseCommercePlan, parseEffectiveMembershipEntitlements, parseMembershipPrice, type CommercePlan, type EffectiveMembershipEntitlements, type MembershipExpectedQuote, type MembershipPrice, type MembershipPurchaseGrant } from "./commerce-types";

export const walletRouteDefinitions = {
  "tron-usdt": { chain: "tron", asset: "USDT", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
  "ethereum-usdt": { chain: "ethereum", asset: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  "ethereum-usdc": { chain: "ethereum", asset: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  "base-usdc": { chain: "base", asset: "USDC", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
} as const;
export type WalletRouteId = keyof typeof walletRouteDefinitions;
export type WalletChain = "tron" | "ethereum" | "base";
export type WalletAsset = "USDT" | "USDC";
export type WalletSettings = { enabled: boolean; revision: number };
export type WalletRoute = { id: WalletRouteId; chain: WalletChain; asset: WalletAsset; contract: string; decimals: 6; recipient: string | null; enabled: boolean; revision: number };
export type WalletCatalog = { settings: WalletSettings; routes: WalletRoute[]; purchase_available: boolean };
export type WalletQuote = MembershipExpectedQuote & { route_revision: number };
export type WalletOrder = WalletQuote & {
  id: string; buyer_id: string; request_id: string; route_id: WalletRouteId; chain: WalletChain; asset: WalletAsset; contract: string; recipient: string;
  currency: "USD"; base_amount_units: string; amount_units: string; amount_decimal: string;
  title_snapshot: string; description_snapshot: string; benefits_snapshot: Record<string, string>; ai_daily_limit_snapshot: number; mentor_discount_bps_snapshot: number;
  status: "pending" | "expired" | "paid" | "review" | "revoked"; created_at: string; expires_at: string; paid_at: string | null;
};
export type WalletVerification = { id: string; order_id: string; tx_hash: string; status: "queued" | "leased" | "waiting" | "settled" | "review"; attempts: number; next_attempt_at: string; lease_id: string | null; lease_expires_at: string | null; reason_code?: string | null };
export type WalletPurchaseGrant = Omit<MembershipPurchaseGrant, "status"> & { status: Exclude<MembershipPurchaseGrant["status"], "test"> };
export type MyMembershipWallet = { catalog: WalletCatalog; orders: WalletOrder[]; verifications: WalletVerification[]; purchase_grants: WalletPurchaseGrant[]; effective: EffectiveMembershipEntitlements };
export type WalletReconciliationReceipt = { id: string; order_id: string; verification_id: string; chain: WalletChain; tx_hash: string; event_index: number; outcome: "paid" | "review" | "ignored_order_state"; reason_code: string | null; created_at: string };
export type WalletAdminStore = { settings: WalletSettings; routes: WalletRoute[]; orders: WalletOrder[]; verifications: WalletVerification[]; receipts: WalletReconciliationReceipt[]; history: { id: string; action: "settings_updated" | "route_updated" | "wallet_order_revoked"; reason: string; created_at: string }[] };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const int = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export const walletUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown, min: number, max: number): value is string => typeof value === "string" && Array.from(value.trim()).length >= min && Array.from(value).length <= max;
const notes = (value: unknown): value is Record<string, string> => object(value) && Object.keys(value).length <= 20 && Object.entries(value).every(([key, item]) => /^[a-z][a-z0-9_]{1,59}$/.test(key) && text(item, 1, 240));
const units = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,17}$/.test(value);
const reasonCode = (value: unknown) => value === null || typeof value === "string" && Object.prototype.hasOwnProperty.call(walletReasonLabels, value);
export const walletRouteId = (value: unknown): value is WalletRouteId => typeof value === "string" && Object.prototype.hasOwnProperty.call(walletRouteDefinitions, value);
function invalid(): never { throw new Error("membership_wallet_response_invalid"); }

export function walletAddressValid(chain: WalletChain, address: unknown): address is string {
  if (typeof address !== "string") return false;
  return chain === "tron" ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) : /^0x[0-9a-f]{40}$/.test(address) && !/^0x0{40}$/.test(address);
}
export function walletTransferHash(chain: WalletChain, value: unknown): string {
  if (typeof value !== "string") throw new Error("membership_wallet_tx_hash_invalid");
  const hash = value.trim().toLowerCase();
  if (chain === "tron" ? /^[0-9a-f]{64}$/.test(hash) : /^0x[0-9a-f]{64}$/.test(hash)) return hash;
  throw new Error("membership_wallet_tx_hash_invalid");
}
export function walletAmountDecimal(value: string): string {
  if (!units(value)) invalid();
  const amount = BigInt(value);
  return `${amount / BigInt(1000000)}.${(amount % BigInt(1000000)).toString().padStart(6, "0")}`;
}
export const walletNetworkLabel = (chain: WalletChain) => ({ tron: "TRON（TRC20）", ethereum: "Ethereum（ERC20）", base: "Base" })[chain];
export const walletRouteLabel = (route: Pick<WalletRoute, "chain" | "asset">) => `${walletNetworkLabel(route.chain)} · ${route.asset}`;
const walletReasonLabels: Record<string, string> = { payment_before_invoice: "转账时间早于订单创建", payment_after_expiry: "转账时间超过报价期限", payment_amount_mismatch: "实际到账金额不符", matching_transfer_missing: "未找到本订单对应的同链同币转账", multiple_matching_transfers: "找到多笔相同转账，需人工核对", transaction_failed: "链上交易失败", invoice_invalid: "订单快照需核对", verification_disabled: "核验服务暂停", chain_rpc_unconfigured: "该网络核验服务尚未就绪", transaction_pending: "交易尚未确认或哈希未查到", finality_unavailable: "暂未取得最终确认", finality_pending: "等待网络最终确认", solidification_pending: "等待 TRON 固化确认", additional_transfer: "同一订单的额外转账，需人工处理", reconciliation_required: "需人工对账", verification_waiting: "等待核验条件恢复", order_already_paid_reconciliation: "订单已由另一哈希付款确认，此哈希仅保留人工对账" };
export function walletReasonLabel(code: string | null | undefined): string { return code ? walletReasonLabels[code] ?? "等待进一步核对" : "—"; }

export function parseWalletSettings(value: unknown): WalletSettings {
  if (!object(value) || typeof value.enabled !== "boolean" || !int(value.revision, 1)) invalid(); return value as WalletSettings;
}
export function parseWalletRoute(value: unknown): WalletRoute {
  if (!object(value) || !walletRouteId(value.id)) invalid();
  const canonical = walletRouteDefinitions[value.id];
  if (value.chain !== canonical.chain || value.asset !== canonical.asset || value.contract !== canonical.contract || value.decimals !== 6 || typeof value.enabled !== "boolean" || !int(value.revision, 1)
    || !(value.recipient === null || walletAddressValid(canonical.chain, value.recipient)) || value.recipient === canonical.contract || (value.enabled && value.recipient === null)) invalid();
  return value as WalletRoute;
}
function routes(value: unknown): WalletRoute[] {
  if (!Array.isArray(value) || value.length !== 4) invalid();
  const result = value.map(parseWalletRoute); if (new Set(result.map((route) => route.id)).size !== 4) invalid(); return result;
}
export function parseWalletCatalog(value: unknown): WalletCatalog {
  if (!object(value) || typeof value.purchase_available !== "boolean") invalid();
  const settings = parseWalletSettings(value.settings); const items = routes(value.routes);
  if (value.purchase_available !== (settings.enabled && items.some((route) => route.enabled && route.recipient !== null))) invalid();
  return { settings, routes: items, purchase_available: value.purchase_available };
}
export function parseWalletQuote(value: unknown): WalletQuote {
  if (!object(value) || !int(value.route_revision, 1) || !int(value.plan_revision, 1) || value.currency !== "USD") invalid();
  parseMembershipPrice({ id: value.price_id, plan_key: value.plan_key, term_months: value.term_months, amount_minor: value.amount_minor, currency: value.currency, published: true, revision: value.price_revision });
  return { price_id: value.price_id as string, plan_key: value.plan_key as string, term_months: value.term_months as 1 | 12, amount_minor: value.amount_minor as number, currency: "USD", price_revision: value.price_revision as number, plan_revision: value.plan_revision as number, route_revision: value.route_revision };
}
export function walletExpectedQuote(plan: CommercePlan, price: MembershipPrice, route: WalletRoute): WalletQuote {
  parseCommercePlan(plan); parseWalletRoute(route); return parseWalletQuote({ ...membershipQuote(plan, price), route_revision: route.revision });
}
export function parseWalletOrder(value: unknown): WalletOrder {
  if (!object(value)) invalid(); parseWalletQuote(value);
  if (!walletUuid(value.id) || !walletUuid(value.buyer_id) || !walletUuid(value.request_id) || !walletRouteId(value.route_id)) invalid();
  const canonical = walletRouteDefinitions[value.route_id];
  if (value.chain !== canonical.chain || value.asset !== canonical.asset || value.contract !== canonical.contract || !walletAddressValid(canonical.chain, value.recipient) || value.recipient === canonical.contract
    || !units(value.base_amount_units) || !units(value.amount_units) || value.amount_decimal !== walletAmountDecimal(value.amount_units)
    || BigInt(value.base_amount_units) !== BigInt(value.amount_minor as number) * BigInt(10000) || BigInt(value.amount_units) - BigInt(value.base_amount_units) < BigInt(1) || BigInt(value.amount_units) - BigInt(value.base_amount_units) > BigInt(9999)
    || !text(value.title_snapshot, 2, 60) || !text(value.description_snapshot, 0, 1000) || !notes(value.benefits_snapshot)
    || !int(value.ai_daily_limit_snapshot, 0, 10000) || !int(value.mentor_discount_bps_snapshot, 0, 10000)
    || !["pending", "expired", "paid", "review", "revoked"].includes(String(value.status)) || !date(value.created_at) || !date(value.expires_at)
    || Date.parse(value.expires_at) - Date.parse(value.created_at) !== 30 * 60 * 1000 || !(value.paid_at === null || date(value.paid_at)) || (value.status === "paid" && !date(value.paid_at))) invalid();
  return value as WalletOrder;
}
export function parseWalletVerification(value: unknown): WalletVerification {
  if (!object(value) || !walletUuid(value.id) || !walletUuid(value.order_id) || !text(value.tx_hash, 64, 66) || !/^(?:0x)?[0-9a-f]{64}$/.test(value.tx_hash)
    || !["queued", "leased", "waiting", "settled", "review"].includes(String(value.status)) || !int(value.attempts, 0) || !date(value.next_attempt_at)
    || !(value.lease_id === null || walletUuid(value.lease_id)) || !(value.lease_expires_at === null || date(value.lease_expires_at))
    || (value.status === "leased" && (value.lease_id === null || value.lease_expires_at === null)) || (value.reason_code !== undefined && !reasonCode(value.reason_code))) invalid();
  const proof = value as WalletVerification;
  return { id: proof.id, order_id: proof.order_id, tx_hash: proof.tx_hash, status: proof.status, attempts: proof.attempts, next_attempt_at: proof.next_attempt_at, lease_id: proof.lease_id, lease_expires_at: proof.lease_expires_at, ...(proof.reason_code !== undefined ? { reason_code: proof.reason_code } : {}) };
}
function grant(value: unknown): value is WalletPurchaseGrant {
  return object(value) && walletUuid(value.id) && walletUuid(value.order_id) && text(value.plan_key, 1, 40) && text(value.title, 2, 60) && notes(value.benefits)
    && int(value.ai_daily_limit, 0, 10000) && int(value.mentor_discount_bps, 0, 10000) && ["active", "scheduled", "expired", "disabled", "revoked"].includes(String(value.status))
    && date(value.starts_at) && date(value.ends_at) && Date.parse(value.ends_at) > Date.parse(value.starts_at);
}
export function parseWalletPurchaseGrant(value: unknown): WalletPurchaseGrant { if (!grant(value)) invalid(); return value; }
export function parseMyMembershipWallet(value: unknown): MyMembershipWallet {
  if (!object(value) || !Array.isArray(value.orders) || value.orders.length > 50 || !Array.isArray(value.verifications) || value.verifications.length > 50 || !Array.isArray(value.purchase_grants) || !value.purchase_grants.every(grant)) invalid();
  const catalog = parseWalletCatalog(value.catalog); const orders = value.orders.map(parseWalletOrder); const verifications = value.verifications.map(parseWalletVerification); const effective = parseEffectiveMembershipEntitlements(value.effective);
  if (orders.some((order) => order.buyer_id !== effective.user_id) || new Set(orders.map((order) => order.id)).size !== orders.length || new Set(orders.map((order) => order.request_id)).size !== orders.length
    || new Set(verifications.map((proof) => proof.id)).size !== verifications.length || verifications.some((proof) => { const order = orders.find((entry) => entry.id === proof.order_id); return !order || walletTransferHash(order.chain, proof.tx_hash) !== proof.tx_hash; })) invalid();
  return { catalog, orders, verifications, purchase_grants: value.purchase_grants as WalletPurchaseGrant[], effective };
}
export function parseWalletAdminStore(value: unknown): WalletAdminStore {
  if (!object(value) || !Array.isArray(value.history) || value.history.length > 50 || !value.history.every((event) => object(event) && walletUuid(event.id) && ["settings_updated", "route_updated", "wallet_order_revoked"].includes(String(event.action)) && text(event.reason, 3, 500) && date(event.created_at))) invalid();
  const orderData = value.orders ?? [], verificationData = value.verifications ?? [], receiptData = value.receipts ?? [];
  if (!Array.isArray(orderData) || orderData.length > 50 || !Array.isArray(verificationData) || verificationData.length > 50 || !Array.isArray(receiptData) || receiptData.length > 50) invalid();
  const orders = orderData.map(parseWalletOrder), verifications = verificationData.map(parseWalletVerification);
  if (new Set(orders.map((order) => order.id)).size !== orders.length || new Set(verifications.map((proof) => proof.id)).size !== verifications.length
    || verifications.some((proof) => { const order = orders.find((entry) => entry.id === proof.order_id); return !order || walletTransferHash(order.chain, proof.tx_hash) !== proof.tx_hash; })) invalid();
  const receipts = receiptData.map((receipt) => {
    if (!object(receipt) || !walletUuid(receipt.id) || !walletUuid(receipt.order_id) || !walletUuid(receipt.verification_id) || !["tron", "ethereum", "base"].includes(String(receipt.chain)) || !int(receipt.event_index, 0) || !["paid", "review", "ignored_order_state"].includes(String(receipt.outcome)) || !reasonCode(receipt.reason_code) || !date(receipt.created_at)) invalid();
    const order = orders.find((entry) => entry.id === receipt.order_id); if (!order || order.chain !== receipt.chain || walletTransferHash(order.chain, receipt.tx_hash) !== receipt.tx_hash) invalid();
    const proof = verifications.find((entry) => entry.id === receipt.verification_id); if (proof && (proof.order_id !== receipt.order_id || proof.tx_hash !== receipt.tx_hash)) invalid();
    const item = receipt as WalletReconciliationReceipt;
    return { id: item.id, order_id: item.order_id, verification_id: item.verification_id, chain: item.chain, tx_hash: item.tx_hash, event_index: item.event_index, outcome: item.outcome, reason_code: item.reason_code, created_at: item.created_at };
  });
  if (new Set(receipts.map((receipt) => receipt.id)).size !== receipts.length) invalid();
  const history = (value.history as WalletAdminStore["history"]).map((event) => ({ id: event.id, action: event.action, reason: event.reason, created_at: event.created_at }));
  return { settings: parseWalletSettings(value.settings), routes: routes(value.routes), orders, verifications, receipts, history };
}
export function membershipWalletError(failure: unknown): string {
  const code = failure instanceof Error ? failure.message : object(failure) && typeof failure.message === "string" ? failure.message : "";
  if (/authentication_required|admin_required|account_ineligible/.test(code)) return "账号或权限已变化，请重新登录并核对当前账号。";
  if (/PGRST202|schema cache|does not exist/.test(code)) return "钱包支付服务尚未部署，暂不可付款。";
  if (/checkpoint|storage|SecurityError|QuotaExceededError/.test(code)) return "无法安全保存原请求，请先核对已有订单；不会继续发起新付款。";
  if (/wallet_.*unavailable|wallet_.*disabled|billing_unavailable/.test(code)) return "钱包收款尚未配置或未开放，不能创建付款订单。";
  if (/tx_hash_invalid/.test(code)) return "请填写所选网络的完整交易哈希，不能使用钱包地址代替。";
  if (/verification_pending_limit/.test(code)) return "原订单已有 3 个哈希正在核验，请先等待结果；不要重复付款或另开订单。";
  if (/transfer_rate_limited/.test(code)) return "近期提交的不同哈希较多，请等待 10 分钟后核对原订单再试；相同哈希可恢复原回执，不要重复付款。";
  if (/transfer_order_limit/.test(code)) return "原订单已达到哈希核验次数上限，请联系人工核对并保留交易凭据，不要再次转账。";
  if (/wallet_order_not_paid/.test(code)) return "该订单已不是可撤销的已付款订单，请核对最新状态；不会自动退款或改动其他权益。";
  if (/address_invalid/.test(code)) return "收款地址校验未通过，请核对所选网络及完整地址（TRON 包含校验码）。";
  if (/quote_changed|changed_concurrently/.test(code)) return "报价或收款配置已经更新，请刷新后核对；不会自动创建另一笔付款。";
  if (/pending_order_exists/.test(code)) return "已有未核对的付款订单，请先处理原订单，不能重复创建付款。";
  if (/request_conflict|tx_hash_conflict|transaction_claimed/.test(code)) return "原订单或交易哈希与已有记录冲突，请人工核对，不要再次转账。";
  return "结果尚未核实，请刷新原订单或使用原请求重试，不要重复转账。";
}
