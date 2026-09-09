import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RewardLottery } from "./reward-lottery";

const meta = {
  title: "Rewards/Lottery",
  component: RewardLottery,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl px-4 py-10 md:px-6"><Story /></main>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    initialState: {
      campaign: { id: "campaign-1", title: "九月研究抽奖", description: "使用研究积分参与一次，奖品与概率公开。", image_url: null, entry_cost_points: 100, starts_at: "2026-09-01T00:00:00.000Z", ends_at: "2026-09-30T00:00:00.000Z", status: "active" },
      availability: "open",
      eligible: true,
      eligibility_reason: "eligible",
      balance: 1680,
      effective_miss_probability_bps: 8750,
      prizes: [
        { id: "prize-1", name: "研究积分 50", summary: "中奖后自动到账", image_url: null, probability_bps: 250, stock_total: 100, stock_remaining: 83, fulfillment_type: "points", reward_points: 50 },
        { id: "prize-2", name: "导师答疑券", summary: "由管理员人工发放", image_url: null, probability_bps: 1000, stock_total: 5, stock_remaining: 3, fulfillment_type: "manual", reward_points: null },
      ],
      draw: null,
    },
  },
} satisfies Meta<typeof RewardLottery>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ReadyToDraw: Story = {};
