import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { WaveChartInput } from "./wave-chart-input";

// Entirely synthetic interaction fixtures, never auto-filled into a real analysis.
const fixture = {
  schema_version: "wavekb-chart-input-v1",
  bars: [
    { time: 1728000000, open: 100, high: 104, low: 99, close: 102 },
    { time: 1728003600, open: 102, high: 106, low: 101, close: 105 },
  ],
};

function InputPreview({ value, disabled, instrument, timeframe, inactive }: { value?: unknown; disabled?: boolean; instrument?: string; timeframe?: string; inactive?: boolean }) {
  const [input, setInput] = useState(value);
  return <WaveChartInput value={input} onChange={setInput} disabled={disabled} instrument={instrument} timeframe={timeframe} inactive={inactive} />;
}

const meta = {
  title: "Workbench/Wave chart input",
  component: WaveChartInput,
  args: { onChange: fn(), instrument: "SYNTHETIC", timeframe: "4小时" },
  render: (args) => <InputPreview value={args.value} disabled={args.disabled} instrument={args.instrument} timeframe={args.timeframe} inactive={args.inactive} />,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-3xl gap-4 px-4 py-8 md:px-6">
    <p className="text-sm text-muted-foreground">合成 UI 验收数据，不是联网行情，也不代表真实分析。</p>
    <Story />
  </main>],
} satisfies Meta<typeof WaveChartInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  name: "空白可选输入",
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("绘图行情（可选）"));
    await expect(canvas.getByText(/未提供时不会补造行情/)).toBeVisible();
    await expect(canvas.getByLabelText("导入 JSON 行情文件")).toBeVisible();
    await expect(canvas.queryByText(/当前绘图输入/)).not.toBeInTheDocument();
  },
};

export const Supplied: Story = {
  name: "已提供行情（未联网核验）",
  args: { value: fixture },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText(/绘图行情（可选）/));
    await expect(canvas.getByText(/当前绘图输入：2 根/)).toBeVisible();
    await expect(canvas.getByText(/这不代表行情来源或浪型已验证/)).toBeVisible();
  },
};

export const InvalidSavedInput: Story = {
  name: "无效输入不回显内部内容",
  args: { value: { local_source: "/synthetic/private-notes.pdf" } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("绘图行情（可选）"));
    await expect(canvas.getByRole("alert")).toBeVisible();
    await expect(canvas.queryByText("/synthetic/private-notes.pdf")).not.toBeInTheDocument();
  },
};

export const Processing: Story = {
  name: "提交期间只读",
  args: { value: fixture, disabled: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText(/绘图行情（可选）/));
    await expect(canvas.getByLabelText("导入 JSON 行情文件")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "清除本步骤绘图输入" })).toBeDisabled();
  },
};

export const InactiveContext: Story = {
  name: "品种或周期改变后停用旧行情",
  args: { value: fixture, instrument: "SYNTHETIC2", timeframe: "1小时", inactive: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText(/绘图行情（可选）/));
    await expect(canvas.getByText(/此行情属于其他或未确认标的／周期，已停用/)).toBeVisible();
    await expect(canvas.getByLabelText("导入 JSON 行情文件")).toBeEnabled();
    await expect(canvas.queryByText(/当前绘图输入/)).not.toBeInTheDocument();
  },
};
