import type { SupabaseClient } from "@supabase/supabase-js";
import type { RewardLotteryCampaign, RewardLotteryDraw, RewardLotteryPrize, RewardLotteryState } from "@wavekb/domain";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeCampaign(value: unknown): RewardLotteryCampaign {
  const item = record(value);
  return {
    id: String(item.id ?? ""),
    title: String(item.title ?? ""),
    description: String(item.description ?? ""),
    image_url: nullableText(item.image_url),
    entry_cost_points: Number(item.entry_cost_points ?? 0),
    starts_at: String(item.starts_at ?? ""),
    ends_at: String(item.ends_at ?? ""),
    status: item.status === "draft" || item.status === "closed" ? item.status : "active",
  };
}

function normalizePrize(value: unknown): RewardLotteryPrize {
  const item = record(value);
  return {
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    summary: String(item.summary ?? ""),
    image_url: nullableText(item.image_url),
    probability_bps: Number(item.probability_bps ?? 0),
    stock_total: Number(item.stock_total ?? 0),
    stock_remaining: Number(item.stock_remaining ?? 0),
    fulfillment_type: "manual",
    reward_points: null,
  };
}

export function normalizeRewardLotteryDraw(value: unknown): RewardLotteryDraw {
  const item = record(value);
  return {
    draw_id: String(item.draw_id ?? ""),
    campaign_id: String(item.campaign_id ?? ""),
    outcome: item.outcome === "won" ? "won" : "miss",
    prize: item.prize ? normalizePrize(item.prize) : null,
    entry_cost_points: Number(item.entry_cost_points ?? 0),
    random_bucket: Number(item.random_bucket ?? 0),
    fulfillment_status: item.fulfillment_status === "pending" || item.fulfillment_status === "fulfilled" ? item.fulfillment_status : "not_required",
    fulfillment_note: String(item.fulfillment_note ?? ""),
    balance: Number(item.balance ?? 0),
    created_at: String(item.created_at ?? ""),
  };
}

export function normalizeRewardLotteryState(value: unknown): RewardLotteryState | null {
  const item = record(value);
  if (!item.campaign) return null;
  return {
    campaign: normalizeCampaign(item.campaign),
    availability: item.availability === "scheduled" || item.availability === "ended" ? item.availability : "open",
    eligible: Boolean(item.eligible),
    eligibility_reason: item.eligibility_reason === "account_ineligible"
      || item.eligibility_reason === "already_drawn"
      || item.eligibility_reason === "not_open"
      || item.eligibility_reason === "insufficient_balance"
      ? item.eligibility_reason
      : "eligible",
    balance: Number(item.balance ?? 0),
    effective_miss_probability_bps: Number(item.effective_miss_probability_bps ?? 0),
    prizes: Array.isArray(item.prizes) ? item.prizes.map(normalizePrize) : [],
    draw: item.draw ? normalizeRewardLotteryDraw(item.draw) : null,
  };
}

export type RewardLotteryMutationGateway = {
  draw(campaignId: string, requestId: string): Promise<unknown>;
};

function defaultGateway(client: SupabaseClient): RewardLotteryMutationGateway {
  return {
    async draw(campaignId, requestId) {
      const result = await client.rpc("draw_reward_lottery", { p_campaign_id: campaignId, p_request_id: requestId });
      if (result.error) throw result.error;
      return result.data;
    },
  };
}

export function rewardLotteryMutations(client: SupabaseClient, injectedGateway?: RewardLotteryMutationGateway) {
  const gateway = injectedGateway ?? defaultGateway(client);
  return {
    async draw(campaignId: string, requestId: string) {
      return normalizeRewardLotteryDraw(await gateway.draw(campaignId, requestId));
    },
  };
}

export async function loadRewardLottery(client: SupabaseClient): Promise<RewardLotteryState | null> {
  const result = await client.rpc("get_my_reward_lottery");
  if (result.error) throw result.error;
  return normalizeRewardLotteryState(result.data);
}
