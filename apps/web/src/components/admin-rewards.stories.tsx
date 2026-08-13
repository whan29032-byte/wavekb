import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminRewards } from "./admin-rewards";

const meta = {
  title: "Admin/Reward operations",
  component: AdminRewards,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl px-4 py-10 md:px-6"><Story /></main>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    initialStore: {
      products: [
        { id: "product-1", name: "铂光序列铭牌", summary: "冷银蓝金属质感身份特效", description: "兑换后可佩戴 30 天。", image_url: null, category: "identity", product_type: "nameplate", price_points: 1200, stock: -1, metadata: { nameplate_style: "platinum", duration_days: 30 }, active: true, sort_order: 10, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" },
        { id: "product-2", name: "一对一复盘优先券", summary: "辅导专区优先答疑权益", description: "由管理员确认并发放。", image_url: null, category: "service", product_type: "service", price_points: 1200, stock: 17, metadata: {}, active: true, sort_order: 20, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" },
        { id: "product-3", name: "旧版数字资料", summary: "已停止兑换", description: "保留历史订单。", image_url: null, category: "digital", product_type: "digital", price_points: 300, stock: 0, metadata: {}, active: false, sort_order: 90, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-08-10T00:00:00.000Z" },
      ],
      wallets: [
        { user_id: "user-1", public_uid: 10001, display_name: "结构记录者", bio: "", display_title: "波浪研究者", nameplate_style: "platinum", balance: 1680, lifetime_earned: 4260, updated_at: "2026-08-14T00:00:00.000Z" },
        { user_id: "user-2", public_uid: 10942, display_name: "林舟", bio: "", display_title: null, nameplate_style: "classic", balance: 420, lifetime_earned: 980, updated_at: "2026-08-13T00:00:00.000Z" },
      ],
      entitlements: [
        { id: "entitlement-1", user_id: "user-1", public_uid: 10001, display_name: "结构记录者", product_id: "product-1", product_name: "铂光序列铭牌", style: "platinum", starts_at: "2026-08-01T00:00:00.000Z", expires_at: "2026-09-01T00:00:00.000Z", equipped: true, source: "redeemed" },
      ],
      redemptions: [
        { id: "redemption-1", user_id: "user-2", public_uid: 10942, display_name: "林舟", product_id: "product-2", product_name: "一对一复盘优先券", quantity: 1, points_spent: 1200, status: "pending", fulfillment_note: "等待联系", created_at: "2026-08-14T01:00:00.000Z" },
        { id: "redemption-2", user_id: "user-1", public_uid: 10001, display_name: "结构记录者", product_id: "product-1", product_name: "铂光序列铭牌", quantity: 1, points_spent: 1200, status: "fulfilled", fulfillment_note: "系统自动发放", created_at: "2026-08-01T08:00:00.000Z" },
      ],
    },
  },
} satisfies Meta<typeof AdminRewards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
