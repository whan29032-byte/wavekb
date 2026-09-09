import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RewardLotteryDraw, RewardLotteryState } from "@wavekb/domain";
import { RewardLottery } from "./reward-lottery";

const rpc = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "actor-id" } } })) },
    rpc,
  }),
}));

const state: RewardLotteryState = {
  campaign: {
    id: "campaign-id",
    title: "九月研究抽奖",
    description: "每位用户仅可参与一次",
    image_url: null,
    entry_cost_points: 100,
    starts_at: "2026-09-01T00:00:00.000Z",
    ends_at: "2026-09-30T00:00:00.000Z",
    status: "active",
  },
  availability: "open",
  eligible: true,
  eligibility_reason: "eligible",
  balance: 900,
  effective_miss_probability_bps: 8750,
  prizes: [
    { id: "prize-a", name: "研究积分 50", summary: "自动到账", image_url: null, probability_bps: 250, stock_total: 10, stock_remaining: 8, fulfillment_type: "points", reward_points: 50 },
    { id: "prize-b", name: "导师答疑券", summary: "后台人工发放", image_url: null, probability_bps: 1000, stock_total: 2, stock_remaining: 0, fulfillment_type: "manual", reward_points: null },
  ],
  draw: null,
};

function drawResult(outcome: "won" | "miss", fulfillment: "points" | "manual" = "manual"): RewardLotteryDraw {
  const prize = outcome === "won" ? {
    id: fulfillment === "points" ? "prize-a" : "prize-b",
    name: fulfillment === "points" ? "研究积分 50" : "导师答疑券",
    summary: fulfillment === "points" ? "自动到账" : "后台人工发放",
    image_url: null,
    probability_bps: fulfillment === "points" ? 250 : 1000,
    stock_total: 10,
    stock_remaining: 7,
    fulfillment_type: fulfillment,
    reward_points: fulfillment === "points" ? 50 : null,
  } as const : null;
  return {
    draw_id: "draw-id",
    campaign_id: "campaign-id",
    outcome,
    prize,
    entry_cost_points: 100,
    random_bucket: 8000,
    fulfillment_status: outcome === "miss" ? "not_required" : fulfillment === "points" ? "fulfilled" : "pending",
    fulfillment_note: "",
    balance: outcome === "won" && fulfillment === "points" ? 850 : 800,
    created_at: "2026-09-09T00:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  rpc.mockReset();
  refresh.mockReset();
});

describe("member reward lottery", () => {
  it("shows exact odds, stock and the single draw action", () => {
    render(<RewardLottery actorId="actor-id" initialState={state} />);

    expect(screen.getByText("2.50%")).toBeTruthy();
    expect(screen.getByText("未中奖概率 87.50%")).toBeTruthy();
    expect(screen.getByText("已兑完")).toBeTruthy();
    expect((screen.getByRole("button", { name: "使用 100 积分翻牌" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables unavailable draws with a precise reason", () => {
    const { rerender } = render(<RewardLottery actorId="actor-id" initialState={{ ...state, eligible: false, eligibility_reason: "insufficient_balance" }} />);
    expect((screen.getByRole("button", { name: "积分不足" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<RewardLottery actorId="actor-id" initialState={{ ...state, eligible: false, eligibility_reason: "not_open", availability: "scheduled" }} />);
    expect((screen.getByRole("button", { name: "活动尚未开始" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a persisted result without offering a second draw", () => {
    render(<RewardLottery actorId="actor-id" initialState={{ ...state, eligible: false, eligibility_reason: "already_drawn", draw: drawResult("won") }} />);
    expect(screen.getByText("抽中：导师答疑券")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /翻牌/ })).toBeNull();
  });

  it.each([
    ["manual", "抽中：导师答疑券", "等待管理员发放"],
    ["points", "抽中：研究积分 50", "奖励已自动到账"],
    ["miss", "本次未中奖", "感谢参与"],
  ] as const)("reveals an authoritative %s result", async (kind, heading, note) => {
    const result = kind === "miss" ? drawResult("miss") : drawResult("won", kind);
    rpc.mockResolvedValueOnce({ data: result, error: null });
    rpc.mockRejectedValueOnce(new Error("refresh unavailable"));
    render(<RewardLottery actorId="actor-id" initialState={state} />);

    fireEvent.click(screen.getByRole("button", { name: "使用 100 积分翻牌" }));

    expect(await screen.findByText(heading)).toBeTruthy();
    expect(screen.getByText(note)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /翻牌/ })).toBeNull();
  });

  it("prevents a double click from sending two draws", async () => {
    let resolveDraw: ((value: unknown) => void) | undefined;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveDraw = resolve; }));
    render(<RewardLottery actorId="actor-id" initialState={state} />);
    const button = screen.getByRole("button", { name: "使用 100 积分翻牌" });

    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    resolveDraw?.({ data: drawResult("miss"), error: null });
    await waitFor(() => expect(screen.getByText("本次未中奖")).toBeTruthy());
  });

  it("renders nothing when there is no active campaign", () => {
    const { container } = render(<RewardLottery actorId="actor-id" initialState={null} />);
    expect(container.innerHTML).toBe("");
  });
});
