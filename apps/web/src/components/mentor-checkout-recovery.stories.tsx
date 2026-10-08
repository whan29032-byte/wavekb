import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MentorAvatar } from "./mentor-avatar";
import { MentorPaymentSummary } from "./mentor-payment-status";

// Local display fixtures only. These stories do not create orders or send mail.
const meta = {
  title: "Mentors/Payment recovery",
  component: MentorPaymentSummary,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid min-h-dvh max-w-3xl content-start gap-6 bg-background px-4 py-8 text-foreground md:px-6"><header className="flex items-center gap-3"><MentorAvatar name="林舟" url="data:image/png;base64,broken" /><div><h1 className="text-2xl font-semibold">辅导付款状态</h1><p className="mt-1 text-sm text-muted-foreground">本地演示数据，不会发起付款或邮件。</p></div></header><Story /></main>],
  args: { claims: [], pendingOrders: [], error: "", refresh: async () => undefined },
} satisfies Meta<typeof MentorPaymentSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

const terms = { offer_name_snapshot: "30 天结构陪跑", amount_cents: 12800, currency: "USDT", duration_days_snapshot: 30, weekly_questions_snapshot: 3 };

export const Submitted: Story = { args: { claims: [{
  id: "11111111-1111-4111-8111-111111111111", order_id: "22222222-2222-4222-8222-222222222222",
  buyer_id: "33333333-3333-4333-8333-333333333333", mentor_id: "44444444-4444-4444-8444-444444444444",
  payment_method_id: "55555555-5555-4555-8555-555555555555", status: "submitted",
  submitted_at: "2026-10-08T03:00:00Z", reviewed_at: null, order: terms,
}] } };

export const LegacyOrder: Story = { args: { pendingOrders: [{
  id: "22222222-2222-4222-8222-222222222222", buyer_id: "33333333-3333-4333-8333-333333333333",
  mentor_id: "44444444-4444-4444-8444-444444444444", offer_id: "66666666-6666-4666-8666-666666666666",
  payment_method_id: "55555555-5555-4555-8555-555555555555", status: "pending",
  payment_provider: "manual",
  created_at: "2026-10-08T03:00:00Z", ...terms,
}] } };

export const QueryUnavailable: Story = { args: { error: "暂时无法核对付款声明状态。请重试查询，不要重复转账或提交。" } };
