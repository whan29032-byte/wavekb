import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MembershipPlansCatalog } from "./membership-plans-catalog";
import { membershipPreviewCatalog } from "./membership-commerce.fixtures";
const meta = { title: "Membership/PublicPlans", component: MembershipPlansCatalog, parameters: { layout: "fullscreen" }, decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-6"><header><h1 className="text-3xl font-semibold">会员方案</h1><p className="mt-2 text-sm text-muted-foreground">虚拟组件预览，不是真实报价、账户或支付授权。</p></header><Story /></main>], args: { catalog: membershipPreviewCatalog(), signedIn: false } } satisfies Meta<typeof MembershipPlansCatalog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PublishedPaymentClosed: Story = {};
export const ServiceUnavailable: Story = { args: { catalog: null, error: "会员购买服务尚未部署，暂不可使用。" } };
export const TestPurchasePreview: Story = { args: { catalog: membershipPreviewCatalog(true) } };
