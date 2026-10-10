import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminMembershipCommerceSummary } from "./admin-membership-commerce";
import { membershipPreviewAdmin } from "./membership-commerce.fixtures";
const meta = { title: "Membership/AdminCommerce", component: AdminMembershipCommerceSummary, parameters: { layout: "fullscreen" }, decorators: [(Story) => <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:px-6"><header><h1 className="text-3xl font-semibold">会员购买配置</h1><p className="mt-2 text-sm text-muted-foreground">虚拟组件预览，不保存真实配置，不授权付款或会员。</p></header><Story /></main>], args: { store: membershipPreviewAdmin(), refresh: () => {}, retry: () => {}, savePrice: () => {}, saveEntitlements: () => {}, saveSettings: () => {} } } satisfies Meta<typeof AdminMembershipCommerceSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PaymentClosed: Story = {};
export const UnknownSaveReceipt: Story = { args: { uncertain: true, error: "未获得有效回执。", message: "保存结果尚未确认，已保留原请求。请勿重复编辑提交。" } };
export const ServiceUnavailable: Story = { args: { store: null, error: "会员购买服务尚未部署，暂不可使用。" } };
