import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminRewardLotteryCampaign, AdminRewardLotteryDraw, AdminRewardLotteryPrize, AdminRewardLotteryStore, RewardLotteryCampaignInput, RewardLotteryPrizeInput } from "./reward-lottery-types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function normalizeCampaign(value: unknown): AdminRewardLotteryCampaign {
  const item = record(value);
  return { ...item, entry_cost_points: Number(item.entry_cost_points ?? 0) } as AdminRewardLotteryCampaign;
}

function normalizePrize(value: unknown): AdminRewardLotteryPrize {
  const item = record(value);
  return {
    ...item,
    probability_bps: Number(item.probability_bps ?? 0),
    stock_total: Number(item.stock_total ?? 0),
    stock_remaining: Number(item.stock_remaining ?? 0),
    reward_points: item.reward_points == null ? null : Number(item.reward_points),
    sort_order: Number(item.sort_order ?? 0),
  } as AdminRewardLotteryPrize;
}

function normalizeDraw(value: unknown): AdminRewardLotteryDraw {
  const item = record(value);
  return {
    ...item,
    public_uid: item.public_uid == null ? null : Number(item.public_uid),
    entry_cost_points: Number(item.entry_cost_points ?? 0),
    prize: item.prize ? record(item.prize) : null,
  } as AdminRewardLotteryDraw;
}

export function normalizeAdminRewardLottery(value: unknown): AdminRewardLotteryStore {
  const item = record(value);
  return {
    campaigns: Array.isArray(item.campaigns) ? item.campaigns.map(normalizeCampaign) : [],
    prizes: Array.isArray(item.prizes) ? item.prizes.map(normalizePrize) : [],
    draws: Array.isArray(item.draws) ? item.draws.map(normalizeDraw) : [],
  };
}

export type AdminRewardLotteryMutationGateway = {
  upsertCampaign(input: RewardLotteryCampaignInput): Promise<string>;
  upsertPrize(input: RewardLotteryPrizeInput): Promise<string>;
  setStatus(campaignId: string, status: "active" | "closed"): Promise<void>;
  fulfillDraw(drawId: string, note: string): Promise<void>;
};

function defaultGateway(client: SupabaseClient): AdminRewardLotteryMutationGateway {
  return {
    async upsertCampaign(input) {
      const result = await client.rpc("admin_upsert_reward_lottery_campaign", {
        p_id: input.id || null,
        p_title: input.title.trim(),
        p_description: input.description.trim(),
        p_image_url: input.imageUrl?.trim() || null,
        p_entry_cost_points: input.entryCostPoints,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
      });
      if (result.error) throw result.error;
      return String(result.data);
    },
    async upsertPrize(input) {
      const result = await client.rpc("admin_upsert_reward_lottery_prize", {
        p_id: input.id || null,
        p_campaign_id: input.campaignId,
        p_name: input.name.trim(),
        p_summary: input.summary.trim(),
        p_image_url: input.imageUrl?.trim() || null,
        p_probability_bps: input.probabilityBps,
        p_stock_total: input.stockTotal,
        p_fulfillment_type: input.fulfillmentType,
        p_reward_points: input.rewardPoints,
        p_sort_order: input.sortOrder,
      });
      if (result.error) throw result.error;
      return String(result.data);
    },
    async setStatus(campaignId, status) {
      const result = await client.rpc("admin_set_reward_lottery_campaign_status", { p_campaign_id: campaignId, p_status: status });
      if (result.error) throw result.error;
    },
    async fulfillDraw(drawId, note) {
      const result = await client.rpc("admin_fulfill_reward_lottery_draw", { p_draw_id: drawId, p_note: note.trim() });
      if (result.error) throw result.error;
    },
  };
}

export function adminRewardLotteryMutations(client: SupabaseClient, injectedGateway?: AdminRewardLotteryMutationGateway) {
  const gateway = injectedGateway ?? defaultGateway(client);
  return {
    upsertCampaign: (input: RewardLotteryCampaignInput) => gateway.upsertCampaign(input),
    upsertPrize: (input: RewardLotteryPrizeInput) => gateway.upsertPrize(input),
    setStatus: (campaignId: string, status: "active" | "closed") => gateway.setStatus(campaignId, status),
    fulfillDraw: (drawId: string, note: string) => gateway.fulfillDraw(drawId, note),
  };
}

export async function loadAdminRewardLottery(client: SupabaseClient): Promise<AdminRewardLotteryStore> {
  const result = await client.rpc("admin_get_reward_lottery");
  if (result.error) throw result.error;
  return normalizeAdminRewardLottery(result.data);
}
