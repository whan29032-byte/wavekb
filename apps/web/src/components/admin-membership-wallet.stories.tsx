import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminMembershipWalletSummary } from "./admin-membership-wallet";
import { walletPreviewAdmin, walletPreviewOrder, walletPreviewVerification } from "./membership-wallet.fixtures";

const meta = { title: "Membership/WalletAdmin", component: AdminMembershipWalletSummary, parameters: { layout: "fullscreen" }, decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-6"><header className="grid gap-2"><h1 className="text-3xl font-semibold">会员钱包配置预览</h1><p className="text-sm leading-6 text-muted-foreground">虚拟组件预览，不保存真实配置，不查询或开放真实收款。</p></header><Story /></main>], args: { store: walletPreviewAdmin(), preview: true, refresh: () => {}, retry: () => {}, saveRoute: () => {}, saveSettings: () => {} } } satisfies Meta<typeof AdminMembershipWalletSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MissingAddresses: Story = {};
export const UnknownSaveReceipt: Story = { args: { uncertain: true, message: "保存结果尚未确认，原请求已保留。先核对当前配置，再使用原请求重试。" } };
export const Reconciliation: Story = { args: { store: { ...walletPreviewAdmin(), orders: [walletPreviewOrder("paid")], verifications: [{ ...walletPreviewVerification("review"), reason_code: "order_already_paid_reconciliation" }], receipts: [{ id: "00000000-0000-4000-8000-000000000117", order_id: walletPreviewOrder().id, verification_id: walletPreviewVerification().id, chain: "base", tx_hash: walletPreviewVerification().tx_hash, event_index: 0, outcome: "review", reason_code: "additional_transfer", created_at: "2099-10-10T00:15:00Z" }] } } };
