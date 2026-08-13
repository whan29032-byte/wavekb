import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RewardCenter } from "./reward-center";

const meta = {
  title: "Rewards/Member reward center",
  component: RewardCenter,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14"><Story /></main>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    initialCenter: {
      wallet: { balance: 1680, lifetime_earned: 4260 },
      checked_today: false,
      streak: 6,
      products: [
        { id: "product-1", name: "铂光序列铭牌", summary: "冷银蓝金属质感身份特效", description: "兑换后可佩戴 30 天。", image_url: null, category: "identity", product_type: "nameplate", price_points: 1200, stock: -1, metadata: { nameplate_style: "platinum", duration_days: 30 }, active: true, sort_order: 10 },
        { id: "product-2", name: "一对一复盘优先券", summary: "辅导专区优先答疑权益", description: "兑换后由管理员确认并发放。", image_url: null, category: "service", product_type: "service", price_points: 1200, stock: 17, metadata: {}, active: true, sort_order: 20 },
        { id: "product-3", name: "紫曜鎏金铭牌", summary: "紫金交织动态身份特效", description: "兑换后可佩戴 30 天。", image_url: null, category: "identity", product_type: "nameplate", price_points: 2200, stock: -1, metadata: { nameplate_style: "purplegold", duration_days: 30 }, active: true, sort_order: 30 },
      ],
      nameplates: [{ id: "entitlement-1", product_id: "product-1", product_name: "铂光序列铭牌", style: "platinum", starts_at: "2026-08-01T00:00:00.000Z", expires_at: "2026-09-01T00:00:00.000Z", equipped: true, source: "redeemed" }],
      ledger: [
        { id: 3, action_key: "daily_checkin", points: 10, balance_after: 1680, note: "每日签到", created_at: "2026-08-14T00:00:00.000Z" },
        { id: 2, action_key: "review_saved", points: 20, balance_after: 1670, note: "完成一篇复盘", created_at: "2026-08-13T08:00:00.000Z" },
        { id: 1, action_key: "product_redeemed", points: -1200, balance_after: 1650, note: "兑换：铂光序列铭牌", created_at: "2026-08-01T08:00:00.000Z" },
      ],
    },
    leaderboard: [
      { rank_no: 1, user_id: "user-1", public_uid: 10001, display_name: "结构记录者", avatar_url: null, display_title: "波浪研究者", nameplate_style: "blackgold", balance: 3200, lifetime_earned: 9200 },
      { rank_no: 2, user_id: "user-2", public_uid: 10002, display_name: "林舟", avatar_url: null, display_title: "平台导师", nameplate_style: "platinum", balance: 2800, lifetime_earned: 7600 },
      { rank_no: 3, user_id: "user-3", public_uid: 10003, display_name: "守规则的人", avatar_url: null, display_title: "结构观察者", nameplate_style: "classic", balance: 1900, lifetime_earned: 6100 },
    ],
  },
} satisfies Meta<typeof RewardCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveWallet: Story = {};
