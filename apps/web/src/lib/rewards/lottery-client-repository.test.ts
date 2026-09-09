import { describe, expect, it, vi } from "vitest";
import { loadRewardLottery, rewardLotteryMutations } from "./lottery-client-repository";

describe("reward lottery repository", () => {
  it("keeps draws scoped to the campaign and idempotency request", async () => {
    const draw = vi.fn(async () => ({ draw_id: "draw-id", outcome: "miss" as const, balance: 900 }));
    const actions = rewardLotteryMutations({} as never, { draw });

    await actions.draw("campaign-id", "request-id");

    expect(draw).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledWith("campaign-id", "request-id");
  });

  it("calls the member RPC with its exact boundary payload", async () => {
    const rpc = vi.fn(async () => ({ data: { draw_id: "draw-id", outcome: "miss", balance: "900" }, error: null }));
    const actions = rewardLotteryMutations({ rpc } as never);

    await expect(actions.draw("campaign-id", "request-id")).resolves.toMatchObject({ balance: 900 });
    expect(rpc).toHaveBeenCalledWith("draw_reward_lottery", { p_campaign_id: "campaign-id", p_request_id: "request-id" });
  });

  it("normalizes member state returned by Supabase", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        campaign: { id: "campaign-id", entry_cost_points: "100" },
        balance: "900",
        effective_miss_probability_bps: "2500",
        prizes: [{ id: "prize-id", probability_bps: "7500", stock_total: "4", stock_remaining: "3", reward_points: "50" }],
        draw: null,
      },
      error: null,
    }));

    const state = await loadRewardLottery({ rpc } as never);

    expect(state?.campaign.entry_cost_points).toBe(100);
    expect(state?.prizes[0]).toMatchObject({ probability_bps: 7500, stock_total: 4, stock_remaining: 3, reward_points: 50 });
    expect(state?.effective_miss_probability_bps).toBe(2500);
  });
});
