import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HermesMemberAiCard } from "./hermes-member-ai-card";

const meta = {
  title: "Workbench/Hermes Member AI",
  component: HermesMemberAiCard,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-6"><h1 className="text-3xl font-semibold">AI 控制中心</h1><p className="text-sm text-muted-foreground">入口组件预览，不代表当前账号已有会员权益。</p><Story /></main>],
} satisfies Meta<typeof HermesMemberAiCard>;

export default meta;
type Story = StoryObj<typeof meta>;
export const MemberExclusive: Story = {};
