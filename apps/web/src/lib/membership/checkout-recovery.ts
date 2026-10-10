import { parseMembershipPrice, type MembershipExpectedQuote } from "./commerce-types";

export type MembershipCheckoutAttempt = { ownerId: string; requestId: string; expectedQuote: MembershipExpectedQuote };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const membershipAttemptKey = (ownerId: string) => `wavekb:membership-checkout:${ownerId}`;

export function readMembershipAttempt(ownerId: string): MembershipCheckoutAttempt | null {
  const raw = window.localStorage.getItem(membershipAttemptKey(ownerId));
  if (!raw) return null;
  const value = JSON.parse(raw) as MembershipCheckoutAttempt;
  const quote = value?.expectedQuote;
  if (!uuid(value?.ownerId) || value.ownerId !== ownerId || !uuid(value.requestId) || !quote
    || !Number.isSafeInteger(quote.plan_revision) || quote.plan_revision < 1) throw new Error("membership_checkpoint_invalid");
  parseMembershipPrice({ id: quote.price_id, plan_key: quote.plan_key, revision: quote.price_revision, amount_minor: quote.amount_minor, currency: quote.currency, term_months: quote.term_months, published: true });
  return { ownerId, requestId: value.requestId, expectedQuote: { price_id: quote.price_id, plan_key: quote.plan_key, price_revision: quote.price_revision, plan_revision: quote.plan_revision, amount_minor: quote.amount_minor, currency: quote.currency, term_months: quote.term_months } };
}

export function writeMembershipAttempt(attempt: MembershipCheckoutAttempt) {
  const previous = readMembershipAttempt(attempt.ownerId);
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error("membership_checkpoint_changed");
  window.localStorage.setItem(membershipAttemptKey(attempt.ownerId), JSON.stringify(attempt));
  if (JSON.stringify(readMembershipAttempt(attempt.ownerId)) !== JSON.stringify(attempt)) throw new Error("membership_checkpoint_changed");
}

export function clearMembershipAttempt(attempt: MembershipCheckoutAttempt) {
  if (readMembershipAttempt(attempt.ownerId)?.requestId !== attempt.requestId) throw new Error("membership_checkpoint_changed");
  window.localStorage.removeItem(membershipAttemptKey(attempt.ownerId));
}

export function safeMembershipCheckoutUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("membership_checkout_url_invalid");
  const url = new URL(value);
  if (url.origin !== "https://checkout.stripe.com" || url.username || url.password) throw new Error("membership_checkout_url_invalid");
  return url.href;
}

export function openMembershipCheckout(value: string) {
  window.location.assign(safeMembershipCheckoutUrl(value));
}

export class MembershipQuoteRejected extends Error {
  constructor() { super("membership_quote_changed"); this.name = "MembershipQuoteRejected"; }
}

export async function membershipCheckoutFailure(error: unknown) {
  if (error && typeof error === "object" && "context" in error && error.context instanceof Response) {
    try { const value = await error.context.clone().json(); if (error.context.status === 409 && value?.error === "membership_quote_changed") return new MembershipQuoteRejected(); if (typeof value?.error === "string") return new Error(value.error); } catch { /* No valid public error acknowledgement. */ }
  }
  return error;
}

export function membershipCheckoutError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (/membership_(billing_unavailable|checkout_unavailable|price_unavailable|plan_disabled)/.test(code)) return "当前付款或方案不可用，请核对原订单并稍后再试；不要重新创建订单付款。";
  if (/membership_(order_not_payable|payment_confirmation_pending)/.test(code)) return "原订单正在核对付款或已不能付款，请刷新原订单状态，不要再次付款。";
  if (/request_conflict/.test(code)) return "原请求与服务器记录不一致，请核实原订单；不会更改请求或另建订单付款。";
  return "";
}
