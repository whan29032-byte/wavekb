import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MembershipWalletSummary } from "./membership-wallet";
import { walletPreviewMine, walletPreviewOrder, walletPreviewVerification } from "./membership-wallet.fixtures";
import { membershipPreviewPlan } from "./membership-commerce.fixtures";

const meta = { title: "Membership/Wallet", component: MembershipWalletSummary, parameters: { layout: "fullscreen" }, decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-6"><header className="grid gap-2"><h1 className="text-3xl font-semibold">VIP 钱包支付预览</h1><p className="text-sm leading-6 text-muted-foreground">虚拟组件预览，不读取真实账号，不提交真实付款。所有地址已遮蔽，复制和转账操作禁用。</p></header><Story /></main>], args: { mine: walletPreviewMine(), plans: [membershipPreviewPlan], preview: true, onRefresh: () => {}, onRecover: () => {}, onCreate: () => {}, onSubmit: () => {} } } satisfies Meta<typeof MembershipWalletSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unconfigured: Story = {};
export const Pending: Story = { args: { mine: { ...walletPreviewMine(true), orders: [walletPreviewOrder()] } } };
export const Checking: Story = { args: { mine: { ...walletPreviewMine(true), orders: [walletPreviewOrder()], verifications: [walletPreviewVerification()] } } };
export const WaitingConfirmation: Story = { args: { mine: { ...walletPreviewMine(true), orders: [walletPreviewOrder()], verifications: [walletPreviewVerification("waiting")] } } };
export const Review: Story = { args: { mine: { ...walletPreviewMine(true), orders: [walletPreviewOrder("review")], verifications: [walletPreviewVerification("review")] } } };
export const Paid: Story = { args: { mine: { ...walletPreviewMine(true), orders: [walletPreviewOrder("paid")], verifications: [walletPreviewVerification("settled")], effective: { ...walletPreviewMine().effective, has_vip: true, ai_daily_limit: 50, mentor_discount_bps: 1000 }, purchase_grants: [{ id: "00000000-0000-4000-8000-000000000114", order_id: walletPreviewOrder().id, plan_key: "vip", title: "VIP 会员", benefits: {}, ai_daily_limit: 50, mentor_discount_bps: 1000, starts_at: "2099-10-10T00:10:00Z", ends_at: "2099-11-10T00:10:00Z", status: "active" }] } } };
export const MultipleNetworks: Story = { args: { mine: walletPreviewMine(true) } };
export const UnknownReceipt: Story = { args: { mine: walletPreviewMine(true), blocked: true, hasAttempt: true, message: "结果仍不确定，原请求已保留。请先核对订单，不要重复转账。" } };
