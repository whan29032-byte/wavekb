import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@wavekb/ui";

const meta = {
  title: "Foundation/Button",
  component: Button,
  args: { children: "发布内容" },
  decorators: [(Story) => <div className="min-w-56 bg-background p-8"><Story /></div>],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary", children: "保存草稿" } };
export const Disabled: Story = { args: { disabled: true, children: "正在发布" } };
