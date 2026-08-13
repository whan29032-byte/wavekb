import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorOffer, MentorPaymentMethod } from "@wavekb/domain";

export type MentorOfferInput = {
  id?: string;
  mentorId: string;
  name: string;
  description: string;
  price: number;
  durationDays: number;
  weeklyQuestions: number;
  active: boolean;
  sortOrder?: number;
};

export type MentorPaymentMethodInput = {
  id?: string;
  mentorId: string;
  kind: MentorPaymentMethod["kind"];
  label: string;
  accountName: string;
  accountValue: string;
  network: string;
  instructions: string;
  active: boolean;
  sortOrder?: number;
};

export type MentorCheckoutGateway = {
  createOrder(offerId: string, paymentMethodId: string): Promise<string>;
  submitClaim(orderId: string, note: string): Promise<string>;
};

function defaultCheckoutGateway(client: SupabaseClient): MentorCheckoutGateway {
  return {
    async createOrder(offerId, paymentMethodId) {
      const result = await client.rpc("create_manual_mentor_order", { p_offer_id: offerId, p_payment_method_id: paymentMethodId });
      if (result.error) throw result.error;
      return String(result.data);
    },
    async submitClaim(orderId, note) {
      const result = await client.rpc("submit_mentor_payment_claim", { p_order_id: orderId, p_buyer_note: note });
      if (result.error) throw result.error;
      return String(result.data);
    },
  };
}

export async function submitManualMentorPayment(
  client: SupabaseClient,
  value: { offerId: string; paymentMethodId: string; buyerNote: string },
  injectedGateway?: MentorCheckoutGateway,
) {
  const gateway = injectedGateway ?? defaultCheckoutGateway(client);
  const orderId = await gateway.createOrder(value.offerId, value.paymentMethodId);
  const claimId = await gateway.submitClaim(orderId, String(value.buyerNote || "").trim().slice(0, 1000));
  return { orderId, claimId };
}

export async function sendMentorMessage(client: SupabaseClient, threadId: string, body: string) {
  const result = await client.rpc("send_mentor_message", { p_thread_id: threadId, p_body: body });
  if (result.error) throw result.error;
  return Number(result.data);
}

export async function reviewMentorPaymentClaim(client: SupabaseClient, claimId: string, confirm: boolean) {
  const result = await client.rpc("review_mentor_payment_claim", { p_claim_id: claimId, p_confirm: confirm });
  if (result.error) throw result.error;
  return result.data ? String(result.data) : null;
}

export async function saveMentorOffer(client: SupabaseClient, value: MentorOfferInput): Promise<MentorOffer> {
  const name = String(value.name || "").trim();
  const description = String(value.description || "").trim();
  const price = Number(value.price);
  const durationDays = Number(value.durationDays);
  const weeklyQuestions = Number(value.weeklyQuestions);
  if (name.length < 2 || name.length > 80) throw new Error("服务名称需要 2-80 个字符。");
  if (!Number.isFinite(price) || price < 0) throw new Error("请输入有效的 USDT 价格。");
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366) throw new Error("服务周期需要 1-366 天。");
  if (!Number.isInteger(weeklyQuestions) || weeklyQuestions < 1 || weeklyQuestions > 100) throw new Error("每周提问次数需要 1-100 次。");
  const row = {
    ...(value.id ? { id: value.id } : {}),
    mentor_id: value.mentorId,
    name,
    description,
    price_cents: Math.round(price * 100),
    currency: "USDT",
    duration_days: durationDays,
    weekly_questions: weeklyQuestions,
    active: value.active,
    sort_order: Number(value.sortOrder || 100),
    updated_at: new Date().toISOString(),
  };
  const result = await client.from("mentor_offers").upsert(row).select("*").single();
  if (result.error) throw result.error;
  return result.data as MentorOffer;
}

export async function saveMentorPaymentMethod(client: SupabaseClient, value: MentorPaymentMethodInput): Promise<MentorPaymentMethod> {
  const label = String(value.label || "").trim();
  const accountValue = String(value.accountValue || "").trim();
  if (label.length < 2 || label.length > 60) throw new Error("收款方式名称需要 2-60 个字符。");
  if (accountValue.length < 2 || accountValue.length > 240) throw new Error("收款账号需要 2-240 个字符。");
  const row = {
    ...(value.id ? { id: value.id } : {}),
    mentor_id: value.mentorId,
    kind: value.kind,
    label,
    account_name: String(value.accountName || "").trim(),
    account_value: accountValue,
    network: String(value.network || "").trim(),
    instructions: String(value.instructions || "").trim(),
    active: value.active,
    sort_order: Number(value.sortOrder || 100),
    updated_at: new Date().toISOString(),
  };
  const result = await client.from("mentor_payment_methods").upsert(row).select("*").single();
  if (result.error) throw result.error;
  return result.data as MentorPaymentMethod;
}
