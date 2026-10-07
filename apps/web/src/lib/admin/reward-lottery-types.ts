export type AdminRewardLotteryCampaign = {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  entry_cost_points: number;
  starts_at: string;
  ends_at: string;
  status: "draft" | "active" | "closed";
  created_at: string;
  updated_at: string;
};

export type AdminRewardLotteryPrize = {
  id: string;
  campaign_id: string;
  name: string;
  summary: string;
  image_url: string | null;
  probability_bps: number;
  stock_total: number;
  stock_remaining: number;
  fulfillment_type: "manual";
  reward_points: null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AdminRewardLotteryDraw = {
  id: string;
  campaign_id: string;
  user_id: string;
  public_uid: number | null;
  outcome: "won" | "miss";
  prize: Record<string, unknown> | null;
  entry_cost_points: number;
  fulfillment_status: "not_required" | "pending" | "fulfilled";
  fulfillment_note: string;
  created_at: string;
  fulfilled_at: string | null;
};

export type AdminRewardLotteryStore = {
  campaigns: AdminRewardLotteryCampaign[];
  prizes: AdminRewardLotteryPrize[];
  draws: AdminRewardLotteryDraw[];
};

export type RewardLotteryCampaignInput = {
  id?: string | null;
  title: string;
  description: string;
  imageUrl?: string | null;
  entryCostPoints: number;
  startsAt: string;
  endsAt: string;
};

export type RewardLotteryPrizeInput = {
  id?: string | null;
  campaignId: string;
  name: string;
  summary: string;
  imageUrl?: string | null;
  probabilityBps: number;
  stockTotal: number;
  sortOrder: number;
};
