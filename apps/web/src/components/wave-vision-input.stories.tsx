import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import type { AnalysisImageServices } from "@/lib/workbench/analysis-images";
import { WaveVisionInput } from "./wave-vision-input";
const owner = "11111111-1111-4111-8111-111111111111";
const analysis = "22222222-2222-4222-8222-222222222222";
const imageId = "33333333-3333-4333-8333-333333333333";
// A one-pixel synthetic PNG, not a chart or real market evidence. No external
// service or credentials are used by these visual interaction fixtures.
const preview = { id: imageId, signedUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=", byteSize: 68, mimeType: "image/png" };
const syntheticServices: AnalysisImageServices = { verifyOwner: async () => {}, load: async () => [preview], upload: async () => preview };
const unavailableServices: AnalysisImageServices = { ...syntheticServices, load: async () => { throw new Error("image_unavailable"); } };
function Preview(args: Parameters<typeof WaveVisionInput>[0]) {
  const [ids, setIds] = useState(args.value);
  return <WaveVisionInput {...args} value={ids} onChange={setIds} />;
}
const meta = {
  title: "Workbench/Vision input", component: WaveVisionInput,
  args: { actorId: owner, analysisId: analysis, step: 4, instrument: "SYNTHETIC", timeframe: "4小时", ensureAnalysis: async () => ({ id: analysis }), onChange: fn(), services: syntheticServices },
  render: (args) => <Preview {...args} />,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-3xl gap-4 px-4 py-8 md:px-6"><p className="text-sm text-muted-foreground">合成 UI 测试，不联网、不保存真实截图，也不证明模型已支持视觉。</p><Story /></main>],
} satisfies Meta<typeof WaveVisionInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { name: "可选截图输入", play: async ({ canvas }) => { await userEvent.click(canvas.getByText("行情截图（可选）")); await expect(canvas.getByLabelText("上传行情截图")).toBeVisible(); await expect(canvas.getByText(/不能代替精确 OHLC/)).toBeVisible(); } };
export const Selected: Story = { name: "已选截图（合成预览）", args: { value: [imageId] }, play: async ({ canvas }) => { await expect(canvas.getByAltText("本步骤行情截图 1")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "移除截图 1" })); await expect(canvas.getByText(/云端资料保留/)).toBeVisible(); } };
export const Unavailable: Story = { name: "无法验证的截图停用", args: { value: [imageId], services: unavailableServices }, play: async ({ canvas }) => { await expect(canvas.getByRole("alert")).toHaveTextContent("已停用"); await expect(canvas.queryByRole("img")).not.toBeInTheDocument(); } };
export const Submitting: Story = { name: "AI 提交时只读", args: { value: [imageId], disabled: true }, play: async ({ canvas }) => { await expect(canvas.getByRole("button", { name: "移除截图 1" })).toBeDisabled(); } };
