import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MembershipGrantForm, type MembershipGrantInput } from "./admin-memberships";

function GrantPreview(args: ComponentProps<typeof MembershipGrantForm>) {
  const [result, setResult] = useState<MembershipGrantInput | null>(null);
  const [error, setError] = useState("");
  return <>
    <MembershipGrantForm {...args} invalid={setError} submit={(value) => { setError(""); setResult(value); }} />
    {error ? <p role="alert" className="mt-4 text-sm">{error}</p> : null}
    {result ? <p role="status" data-testid="membership-grant-preview-result" data-action={result.action} data-end={result.endsAt ?? ""} className="mt-4 rounded-lg border p-4 text-sm leading-6">虚拟预览收到 {result.action}；到期时间：{result.endsAt ?? "不使用"}；操作原因：{result.reason}。未提交实际授权。</p> : null}
  </>;
}

const meta = {
  title: "Membership/Admin grant",
  component: MembershipGrantForm,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-3xl px-4 py-8"><header className="mb-6"><h1 className="text-3xl font-semibold">会员授权表单预览</h1><p className="mt-2 leading-6 text-muted-foreground">虚拟组件预览 · 不查询账号，不提交实际授权。</p></header><Story /></main>],
  args: { plans: [{ key: "vip", title: "VIP 会员（虚拟方案）", description: "仅用于组件预览", benefits: {}, enabled: true, revision: 1 }], pending: false, submit: () => {}, invalid: () => {} },
  render: (args) => <GrantPreview {...args} />,
} satisfies Meta<typeof MembershipGrantForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DateValidation: Story = {};
