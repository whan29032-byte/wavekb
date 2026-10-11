import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, type ComponentProps, type CSSProperties } from "react";
import { MentorCheckout, MentorOfferComparison } from "./mentor-checkout";
import { MentorPaymentSummary } from "./mentor-payment-status";

const lightTheme = {
  colorScheme: "light",
  "--background": "oklch(0.975 0.006 75)",
  "--surface": "oklch(0.995 0.003 75)",
  "--foreground": "oklch(0.22 0.025 255)",
  "--muted": "oklch(0.94 0.008 75)",
  "--muted-foreground": "oklch(0.47 0.022 255)",
  "--border": "oklch(0.86 0.012 75)",
  "--input": "oklch(0.79 0.016 75)",
  "--ring": "oklch(0.49 0.12 230)",
  "--primary": "oklch(0.42 0.115 230)",
  "--primary-foreground": "oklch(0.985 0.004 75)",
} as CSSProperties;

const meta = {
  title: "Mentors/Manual checkout",
  component: MentorCheckout,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="min-h-dvh bg-background text-foreground" style={lightTheme}><main className="mx-auto max-w-3xl px-4 py-10 md:px-6 md:py-14"><Story /></main></div>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    mentorName: "林舟",
    returnPath: "/mentors/11111111-1111-4111-8111-111111111111",
    offers: [
      { id: "offer-1", name: "30 天结构陪跑", description: "适合正在建立计数体系的交易者，围绕主计数、备选计数和失效条件逐步复盘。", price_cents: 12800, currency: "USDT", duration_days: 30, weekly_questions: 3, active: true },
      { id: "offer-2", name: "90 天进阶复盘", description: "适合已有规则框架、希望持续校准结构判断与执行纪律的交易者。", price_cents: 29800, currency: "USDT", duration_days: 90, weekly_questions: 5, active: true },
    ],
    paymentMethods: [
      { id: "method-1", kind: "binance", label: "币安 UID", account_name: "Wave Mentor", account_value: "821064218", network: "USDT", instructions: "请核对收款昵称，不要在转账备注中填写敏感信息。", active: true },
      { id: "method-2", kind: "crypto", label: "TRC20 地址", account_name: "", account_value: "TQ5QXJzLYU8tDPHnq9Q9dT1aX2cdexample", network: "TRC20", instructions: "仅支持 USDT TRC20。", active: true },
    ],
  },
} satisfies Meta<typeof MentorCheckout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToPay: Story = {};

// Pure display fixture: no checkout mount, Supabase reads, order writes or mail.
function PendingComparisonPreview({ offers }: Pick<ComponentProps<typeof MentorCheckout>, "offers">) {
  const [selectedOfferId, setSelectedOfferId] = useState(offers[0]?.id || "");
  return <div className="grid gap-4"><p role="note" className="text-sm text-muted-foreground">本地合成待核对记录，仅用于方案比较验收，不会发起付款或修改订单。</p><MentorOfferComparison offers={offers} selectedOfferId={selectedOfferId} onSelect={setSelectedOfferId} blockedReason="你已有待核对付款，请继续处理原订单。" /><MentorPaymentSummary claims={[{
    id: "claim-preview", order_id: "order-preview", buyer_id: "buyer-preview", mentor_id: "mentor-preview", payment_method_id: null,
    status: "submitted", submitted_at: "2026-08-04T03:00:00Z", reviewed_at: null,
    order: { offer_name_snapshot: "原辅导方案", amount_cents: 1000, currency: "USDT", duration_days_snapshot: 30, weekly_questions_snapshot: 3 },
  }]} pendingOrders={[1, 2].map((index) => ({
    id: `legacy-order-preview-${index}`, buyer_id: "buyer-preview", mentor_id: "mentor-preview", offer_id: "legacy-offer-preview", payment_method_id: null,
    payment_provider: "legacy", status: "pending" as const, created_at: "2026-08-04T03:00:00Z", amount_cents: 29900, currency: "USDT",
  }))} error="" refresh={async () => undefined} /></div>;
}

export const PendingCanCompare: Story = { render: (args) => <PendingComparisonPreview offers={args.offers} /> };
