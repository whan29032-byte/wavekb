import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminMentors } from "./admin-mentors";

const meta = {
  title: "Admin/Mentors and orders",
  component: AdminMentors,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl px-4 py-10 md:px-6"><Story /></main>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    initialStore: {
      mentors: [{
        id: "mentor-1", owner_id: "52ea303d-c11d-4ffb-9653-3ac93f436805", display_name: "林舟", headline: "从规则与备选计数开始复盘", bio: "专注推动浪、调整浪与风险失效点。", avatar_url: null, specialties: ["推动浪", "调整浪", "加密资产"], credentials: ["平台认证导师"], languages: ["中文"], verification_label: "平台认证", active: true, sort_order: 10,
        mentor_offers: [{ id: "offer-1", mentor_id: "mentor-1", name: "一对一波浪辅导", price_cents: 29900, currency: "USDT", duration_days: 30, weekly_questions: 3, active: true, sort_order: 10, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" }, { id: "offer-2", mentor_id: "mentor-1", name: "季度复盘计划", price_cents: 69900, currency: "USDT", duration_days: 90, weekly_questions: 5, active: false, sort_order: 20, created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-13T00:00:00.000Z" }],
        payment_methods: [{ id: "payment-1", mentor_id: "mentor-1", kind: "binance", label: "币安 Pay", account_name: "", account_value: "UID 94217", network: "USDT", instructions: "", active: true, sort_order: 10, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" }],
      }],
      orders: [{ id: "11111111-1111-4111-8111-111111111111", buyer_id: "22222222-2222-4222-8222-222222222222", mentor_id: "mentor-1", offer_id: "offer-1", amount_cents: 29900, currency: "USDT", status: "pending", payment_provider: "manual", provider_order_id: null, paid_at: null, created_at: "2026-08-14T01:00:00.000Z" }, { id: "33333333-3333-4333-8333-333333333333", buyer_id: "44444444-4444-4444-8444-444444444444", mentor_id: "mentor-1", offer_id: "offer-1", amount_cents: 29900, currency: "USDT", status: "paid", payment_provider: "manual", provider_order_id: null, paid_at: "2026-08-12T02:00:00.000Z", created_at: "2026-08-12T01:00:00.000Z" }],
    },
  },
} satisfies Meta<typeof AdminMentors>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
