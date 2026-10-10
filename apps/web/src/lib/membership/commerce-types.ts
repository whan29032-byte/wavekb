import { membershipTextLength, parsePlanReceipt, type MembershipPlan } from "./types";

export type MembershipCurrency = "USD" | "CNY" | "HKD";
export type MembershipPaymentMode = "test" | "live";
export type MembershipPrice = { id: string; plan_key: string; term_months: 1 | 12; amount_minor: number; currency: MembershipCurrency; published: boolean; revision: number };
export type CommercePlan = MembershipPlan & { ai_daily_limit: number; mentor_discount_bps: number; prices: MembershipPrice[] };
export type CommerceSettings = { billing_enabled: boolean; payment_mode: MembershipPaymentMode; revision: number };
export type MembershipCatalog = Omit<CommerceSettings, "revision"> & { settings_revision: number; purchase_available: boolean; plans: CommercePlan[] };
export type MembershipExpectedQuote = { price_id: string; plan_key: string; price_revision: number; plan_revision: number; amount_minor: number; currency: MembershipCurrency; term_months: 1 | 12 };
export type EffectiveMembershipEntitlements = { user_id: string; eligible: boolean; has_vip: boolean; ai_daily_limit: number; mentor_discount_bps: number };
export type MembershipOrder = MembershipExpectedQuote & {
  id: string; buyer_id: string; request_id: string; payment_mode: MembershipPaymentMode; livemode: boolean;
  status: "pending" | "paid" | "expired" | "failed" | "refunded";
  title_snapshot: string; description_snapshot: string; benefits_snapshot: Record<string, string>;
  ai_daily_limit_snapshot: number; mentor_discount_bps_snapshot: number;
  provider_session_id: string | null; checkout_url: string | null; checkout_expires_at: string | null;
  paid_at: string | null; created_at: string;
};
export type MembershipPurchaseGrant = {
  id: string; order_id: string; plan_key: string; title: string; benefits: Record<string, string>;
  ai_daily_limit: number; mentor_discount_bps: number;
  status: "active" | "scheduled" | "expired" | "disabled" | "revoked" | "test";
  starts_at: string; ends_at: string;
};
export type MyMembershipCommerce = { catalog: MembershipCatalog; orders: MembershipOrder[]; purchase_grants: MembershipPurchaseGrant[]; effective: EffectiveMembershipEntitlements };
export type CommerceHistory = { id: string; action: "price_updated" | "entitlements_updated" | "settings_updated"; reason: string; created_at: string };
export type MembershipCommerceAdminStore = { settings: CommerceSettings; plans: CommercePlan[]; history: CommerceHistory[] };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (v: unknown, low: number, high = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= low && v <= high;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(v);
const mode = (v: unknown): v is MembershipPaymentMode => v === "test" || v === "live";
const currency = (v: unknown): v is MembershipCurrency => v === "USD" || v === "CNY" || v === "HKD";
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
function invalid(): never { throw new Error("membership_commerce_response_invalid"); }
const validPlan = (v: unknown) => { try { parsePlanReceipt(v); return true; } catch { return false; } };
function labels(v: unknown): v is Record<string, string> {
  return record(v) && Object.keys(v).length <= 20 && Object.entries(v).every(([k, x]) => /^[a-z][a-z0-9_]{1,59}$/.test(k)
    && typeof x === "string" && membershipTextLength(x.trim()) > 0 && membershipTextLength(x) <= 240);
}
function plan(v: unknown): v is CommercePlan {
  return record(v) && validPlan(v) && integer(v.ai_daily_limit, 0, 10000) && integer(v.mentor_discount_bps, 0, 9900)
    && Array.isArray(v.prices) && v.prices.every(price) && v.prices.every((p) => p.plan_key === v.key)
    && new Set(v.prices.map((p) => p.id)).size === v.prices.length;
}
function price(v: unknown): v is MembershipPrice {
  return record(v) && uuid(v.id) && key(v.plan_key) && (v.term_months === 1 || v.term_months === 12)
    && integer(v.amount_minor, 1, 100000000) && currency(v.currency) && typeof v.published === "boolean" && integer(v.revision, 1);
}
function settings(v: unknown): v is CommerceSettings {
  return record(v) && typeof v.billing_enabled === "boolean" && mode(v.payment_mode) && integer(v.revision, 1);
}
function effective(v: unknown): v is EffectiveMembershipEntitlements {
  return record(v) && uuid(v.user_id) && typeof v.eligible === "boolean" && typeof v.has_vip === "boolean"
    && integer(v.ai_daily_limit, 0, 10000) && integer(v.mentor_discount_bps, 0, 10000)
    && (v.eligible || (!v.has_vip && v.ai_daily_limit === 0 && v.mentor_discount_bps === 0));
}
function quote(v: unknown): boolean {
  return record(v) && uuid(v.price_id) && key(v.plan_key) && integer(v.price_revision, 1) && integer(v.plan_revision, 1)
    && integer(v.amount_minor, 1, 100000000) && currency(v.currency) && (v.term_months === 1 || v.term_months === 12);
}
function order(v: unknown): v is MembershipOrder {
  if (!record(v) || !quote(v) || !uuid(v.id) || !uuid(v.buyer_id) || !uuid(v.request_id) || !mode(v.payment_mode)
    || v.livemode !== (v.payment_mode === "live") || typeof v.status !== "string" || !["pending", "paid", "expired", "failed", "refunded"].includes(v.status)
    || typeof v.title_snapshot !== "string" || membershipTextLength(v.title_snapshot.trim()) < 2 || membershipTextLength(v.title_snapshot) > 60
    || typeof v.description_snapshot !== "string" || membershipTextLength(v.description_snapshot) > 1000 || !labels(v.benefits_snapshot)
    || !integer(v.ai_daily_limit_snapshot, 0, 10000) || !integer(v.mentor_discount_bps_snapshot, 0, 10000)
    || !date(v.created_at) || !(v.paid_at === null || date(v.paid_at)) || (v.status === "paid" && !date(v.paid_at))) return false;
  if (v.provider_session_id === null) return v.checkout_url === null && v.checkout_expires_at === null && v.status === "pending";
  if (typeof v.provider_session_id !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(v.provider_session_id)) return false;
  // Verified callbacks may seal an unacknowledged session without returning a
  // checkout URL. Only terminal orders can carry this non-actionable route.
  if (v.checkout_url === null && v.checkout_expires_at === null) return v.status !== "pending";
  return typeof v.checkout_url === "string" && /^https:\/\/checkout\.stripe\.com\/[A-Za-z0-9_/?#=.%:+-]+$/.test(v.checkout_url) && date(v.checkout_expires_at);
}
function purchase(v: unknown): v is MembershipPurchaseGrant {
  return record(v) && uuid(v.id) && uuid(v.order_id) && key(v.plan_key) && typeof v.title === "string"
    && membershipTextLength(v.title.trim()) >= 2 && membershipTextLength(v.title) <= 60 && labels(v.benefits)
    && integer(v.ai_daily_limit, 0, 10000) && integer(v.mentor_discount_bps, 0, 10000)
    && typeof v.status === "string" && ["active", "scheduled", "expired", "disabled", "revoked", "test"].includes(v.status)
    && date(v.starts_at) && date(v.ends_at) && Date.parse(v.ends_at) > Date.parse(v.starts_at);
}
export function parseMembershipPrice(v: unknown): MembershipPrice { if (!price(v)) invalid(); return v; }
export function parseCommercePlan(v: unknown): CommercePlan { if (!plan(v)) invalid(); return v; }
export function parseCommerceSettings(v: unknown): CommerceSettings { if (!settings(v)) invalid(); return v; }
export function parseMembershipOrder(v: unknown): MembershipOrder { if (!order(v)) invalid(); return v; }
export function parseEffectiveMembershipEntitlements(v: unknown): EffectiveMembershipEntitlements { if (!effective(v)) invalid(); return v; }
export function parseMembershipCatalog(v: unknown): MembershipCatalog {
  if (!record(v) || typeof v.billing_enabled !== "boolean" || !mode(v.payment_mode) || !integer(v.settings_revision, 1)
    || typeof v.purchase_available !== "boolean" || !Array.isArray(v.plans) || !v.plans.every(plan)
    || v.plans.some((p) => !p.enabled || p.prices.some((x) => !x.published))
    || new Set(v.plans.map((p) => p.key)).size !== v.plans.length
    || v.purchase_available !== (v.billing_enabled && v.plans.some((p) => p.prices.length > 0))) invalid();
  return v as MembershipCatalog;
}
export function parseMyMembershipCommerce(v: unknown): MyMembershipCommerce {
  if (!record(v) || !Array.isArray(v.orders) || !v.orders.every(order) || !Array.isArray(v.purchase_grants)
    || !v.purchase_grants.every(purchase) || !effective(v.effective)) invalid();
  parseMembershipCatalog(v.catalog);
  const userId=v.effective.user_id;
  if (v.orders.some((o) => o.buyer_id !== userId) || new Set(v.orders.map((o) => o.id)).size !== v.orders.length
    || new Set(v.purchase_grants.map((g) => g.order_id)).size !== v.purchase_grants.length) invalid();
  return v as MyMembershipCommerce;
}
export function parseMembershipCommerceAdminStore(v: unknown): MembershipCommerceAdminStore {
  if (!record(v) || !settings(v.settings) || !Array.isArray(v.plans) || !v.plans.every(plan) || !Array.isArray(v.history)
    || !v.history.every((e) => record(e) && uuid(e.id) && typeof e.action === "string" && ["price_updated", "entitlements_updated", "settings_updated"].includes(e.action)
      && typeof e.reason === "string" && membershipTextLength(e.reason.trim()) >= 3 && membershipTextLength(e.reason) <= 500 && date(e.created_at))) invalid();
  return v as MembershipCommerceAdminStore;
}
export function membershipQuote(plan: CommercePlan, price: MembershipPrice): MembershipExpectedQuote {
  if (!validPlan(plan) || !integer(plan.ai_daily_limit, 0, 10000) || !integer(plan.mentor_discount_bps, 0, 9900) || !price || !parseMembershipPrice(price)
    || price.plan_key !== plan.key) invalid();
  return { price_id: price.id, plan_key: plan.key, price_revision: price.revision, plan_revision: plan.revision, amount_minor: price.amount_minor, currency: price.currency, term_months: price.term_months };
}
export function membershipCommerceError(error: unknown) {
  const message = error instanceof Error ? error.message : record(error) && typeof error.message === "string" ? error.message : "";
  if (/PGRST202|schema cache|does not exist/.test(message)) return "会员购买服务尚未部署，暂不可使用。";
  if (/membership_billing_unavailable|membership_price_unavailable|payment_unavailable/.test(message)) return "购买尚未开放或支付服务不可用，请稍后再试。";
  if (/membership_quote_changed|membership_changed_concurrently/.test(message)) return "方案或价格已经更新，请刷新并确认新报价。";
  if (/membership_payment_mode_locked/.test(message)) return "仍有待处理订单或实盘付费会员，不能切换支付环境；可以先关闭新购买。";
  if (/membership_pending_order_exists/.test(message)) return "已有待支付订单，请先查询或恢复原订单。";
  if (/admin_required|account_ineligible|authentication_required/.test(message)) return "请重新登录并确认账户状态与操作权限。";
  return "未获得有效回执。请查询原订单后使用原请求重试，不要另建订单重复付款。";
}
