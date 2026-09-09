import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdminRewardLotteryStore } from "@/lib/admin/reward-lottery-types";
import { AdminRewardLottery } from "./admin-reward-lottery";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: { id: "admin-id" } } })) }, rpc }) }));

const store: AdminRewardLotteryStore = {
  campaigns: [{ id: "campaign-id", title: "九月抽奖", description: "公开概率", image_url: null, entry_cost_points: 100, starts_at: "2026-09-01T00:00:00.000Z", ends_at: "2026-09-30T00:00:00.000Z", status: "draft", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
  prizes: [{ id: "prize-id", campaign_id: "campaign-id", name: "积分奖励", summary: "自动到账", image_url: null, probability_bps: 250, stock_total: 10, stock_remaining: 10, fulfillment_type: "points", reward_points: 50, sort_order: 10, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
  draws: [{ id: "draw-id", campaign_id: "campaign-id", user_id: "user-id", public_uid: 12345, outcome: "won", prize: { name: "导师答疑券" }, entry_cost_points: 100, fulfillment_status: "pending", fulfillment_note: "", created_at: "2026-09-09T00:00:00.000Z", fulfilled_at: null }],
};

afterEach(() => { cleanup(); rpc.mockReset(); vi.restoreAllMocks(); });

describe("admin reward lottery", () => {
  it("converts a valid percent to basis points at the mutation boundary", async () => {
    rpc.mockResolvedValueOnce({ data: "new-prize", error: null });
    rpc.mockRejectedValueOnce(new Error("refresh unavailable"));
    render(<AdminRewardLottery actorId="admin-id" initialStore={store} />);

    fireEvent.change(screen.getByLabelText("奖品名称"), { target: { value: "人工研究券" } });
    fireEvent.change(screen.getByLabelText("中奖概率（%）"), { target: { value: "2.50" } });
    fireEvent.change(screen.getByLabelText("奖品库存"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("发放方式"), { target: { value: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: "添加奖品" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_upsert_reward_lottery_prize", expect.objectContaining({ p_probability_bps: 250, p_stock_total: 3, p_fulfillment_type: "manual" })));
  });

  it("rejects invalid probability and non-integer inventory locally", () => {
    render(<AdminRewardLottery actorId="admin-id" initialStore={store} />);
    fireEvent.change(screen.getByLabelText("奖品名称"), { target: { value: "无效奖品" } });
    fireEvent.change(screen.getByLabelText("中奖概率（%）"), { target: { value: "100.01" } });
    fireEvent.change(screen.getByLabelText("奖品库存"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "添加奖品" }));
    expect(screen.getByRole("alert").textContent).toContain("概率");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires confirmation before activation and a note before fulfillment", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminRewardLottery actorId="admin-id" initialStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "开启活动" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "确认发放" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
