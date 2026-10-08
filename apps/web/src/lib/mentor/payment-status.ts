import type { SupabaseClient } from "@supabase/supabase-js";

export type BuyerMentorClaim = {
  id: string;
  order_id: string;
  buyer_id: string;
  mentor_id: string;
  payment_method_id: string | null;
  status: "submitted" | "confirmed" | "rejected" | "cancelled";
  submitted_at: string;
  reviewed_at: string | null;
  order?: MentorOrderSummary | null;
};

export type MentorOrderSummary = {
  offer_name_snapshot?: string | null; amount_cents?: number; currency?: string;
  duration_days_snapshot?: number | null; weekly_questions_snapshot?: number | null;
};

export type BuyerPendingMentorOrder = {
  id: string; buyer_id: string; mentor_id: string; offer_id: string;
  payment_method_id: string | null; status: "pending"; created_at: string;
  payment_provider?: string | null;
  idempotency_key?: string;
} & MentorOrderSummary;

export async function readBuyerPendingMentorOrders(client: SupabaseClient, actorId: string, mentorId?: string): Promise<BuyerPendingMentorOrder[]> {
  const auth = await client.auth.getUser();
  if (auth.error || auth.data.user?.id !== actorId) throw new Error("authentication_required");
  let query = client.from("mentor_orders")
    .select("id,buyer_id,mentor_id,offer_id,payment_method_id,payment_provider,status,created_at,idempotency_key,offer_name_snapshot,amount_cents,currency,duration_days_snapshot,weekly_questions_snapshot")
    .eq("buyer_id", actorId).eq("status", "pending");
  if (mentorId) query = query.eq("mentor_id", mentorId);
  const result = await query.order("created_at", { ascending: false });
  if (result.error) throw result.error;
  return (result.data ?? []) as BuyerPendingMentorOrder[];
}

// The similarly named RPC is the mentor's inbox, not the buyer's history.
// Keep the explicit buyer predicate even though RLS also protects this table.
export async function readBuyerMentorClaims(client: SupabaseClient, actorId: string, mentorId?: string): Promise<BuyerMentorClaim[]> {
  const auth = await client.auth.getUser();
  if (auth.error || auth.data.user?.id !== actorId) throw new Error("authentication_required");
  let query = client.from("mentor_payment_claims")
    .select("id,order_id,buyer_id,mentor_id,payment_method_id,status,submitted_at,reviewed_at,order:mentor_orders(offer_name_snapshot,amount_cents,currency,duration_days_snapshot,weekly_questions_snapshot)")
    .eq("buyer_id", actorId);
  if (mentorId) query = query.eq("mentor_id", mentorId);
  const result = await query.order("submitted_at", { ascending: false });
  if (result.error) throw result.error;
  return (result.data ?? []) as BuyerMentorClaim[];
}
