import { describe, expect, it, vi } from "vitest";
import { adminRewardLotteryMutations, loadAdminRewardLottery } from "./reward-lottery-client-repository";

describe("admin reward lottery repository", () => {
  it("sends exact campaign and prize RPC payloads", async () => {
    const rpc = vi.fn(async () => ({ data: "created-id", error: null }));
    const actions = adminRewardLotteryMutations({ rpc } as never);

    await actions.upsertCampaign({ id: null, title: "九月抽奖", description: "公开概率", imageUrl: null, entryCostPoints: 100, startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-30T00:00:00.000Z" });
    await actions.upsertPrize({ id: null, campaignId: "campaign-id", name: "研究称号", summary: "管理员人工发放", imageUrl: null, probabilityBps: 250, stockTotal: 10, sortOrder: 10 });

    expect(rpc).toHaveBeenNthCalledWith(1, "admin_upsert_reward_lottery_campaign", {
      p_id: null, p_title: "九月抽奖", p_description: "公开概率", p_image_url: null,
      p_entry_cost_points: 100, p_starts_at: "2026-09-01T00:00:00.000Z", p_ends_at: "2026-09-30T00:00:00.000Z",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_upsert_reward_lottery_prize", {
      p_id: null, p_campaign_id: "campaign-id", p_name: "研究称号", p_summary: "管理员人工发放", p_image_url: null,
      p_probability_bps: 250, p_stock_total: 10, p_fulfillment_type: "manual", p_reward_points: null, p_sort_order: 10,
    });
  });

  it("normalizes admin state numeric values", async () => {
    const rpc = vi.fn(async () => ({ data: {
      campaigns: [{ id: "campaign-id", entry_cost_points: "100" }],
      prizes: [{ id: "prize-id", campaign_id: "campaign-id", probability_bps: "250", stock_total: "10", stock_remaining: "8", sort_order: "10" }],
      draws: [{ id: "draw-id", public_uid: "12345", entry_cost_points: "100" }],
    }, error: null }));

    const store = await loadAdminRewardLottery({ rpc } as never);

    expect(store.campaigns[0].entry_cost_points).toBe(100);
    expect(store.prizes[0]).toMatchObject({ probability_bps: 250, stock_total: 10, stock_remaining: 8, sort_order: 10 });
    expect(store.draws[0]).toMatchObject({ public_uid: 12345, entry_cost_points: 100 });
  });

  it("keeps status and fulfillment operations narrowly scoped", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const actions = adminRewardLotteryMutations({ rpc } as never);
    await actions.setStatus("campaign-id", "active");
    await actions.fulfillDraw("draw-id", "已私信发放");
    expect(rpc).toHaveBeenNthCalledWith(1, "admin_set_reward_lottery_campaign_status", { p_campaign_id: "campaign-id", p_status: "active" });
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_fulfill_reward_lottery_draw", { p_draw_id: "draw-id", p_note: "已私信发放" });
  });
});
