import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminRewardLottery } from "./admin-reward-lottery";

const meta = {
  title: "Admin/Reward lottery",
  component: AdminRewardLottery,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl p-6"><Story /></main>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    initialStore: {
      campaigns: [{ id: "campaign-1", title: "九月研究抽奖", description: "公开概率，每人一次。", image_url: null, entry_cost_points: 100, starts_at: "2026-09-01T00:00:00.000Z", ends_at: "2026-09-30T00:00:00.000Z", status: "draft", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
      prizes: [{ id: "prize-1", campaign_id: "campaign-1", name: "研究称号", summary: "管理员人工发放", image_url: null, probability_bps: 250, stock_total: 100, stock_remaining: 100, fulfillment_type: "manual", reward_points: null, sort_order: 10, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
      draws: [],
    },
  },
} satisfies Meta<typeof AdminRewardLottery>;

export default meta;
type Story = StoryObj<typeof meta>;
export const DraftCampaign: Story = {};
