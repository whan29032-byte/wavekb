import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { buildWaveChart, type ChartSpec } from "../../../../ai-gateway/src/research/wave-chart.ts";
import { WaveAnalysisChart } from "./wave-analysis-chart";

// Invented prices for visual acceptance only; no local book content or market
// credentials are used and none of these fixtures represent trading signals.
const bars = [100, 104, 110, 106, 103, 114, 126, 119, 116, 129, 137, 131].map((close, index) => ({ time: 1_760_000_000 + index * 3600, open: close - 1, high: close + 2, low: close - 2, close }));
const spec: ChartSpec = { scenarios: [
  { key: "primary", direction: "up", points: [0, 2, 4, 6, 8, 10].map((bar_index, index) => ({ bar_index, field: "close", label: String(index) as "0", certainty: index === 4 ? "uncertain" : "candidate" })), invalidation: { bar_index: 0, field: "low" } },
  { key: "alternative_a", direction: "up", points: [0, 2, 4, 6, 8].map((bar_index, index) => ({ bar_index, field: "close", label: ["0", "A", "B", "C", "X"][index] as "A", certainty: "uncertain" })), invalidation: null },
] };
const analysis = { instrument: "BTCUSDT", primary_timeframe: "1h", step_data: { 0: { chart_data: { schema_version: "wavekb-chart-input-v1", bars } } } };
const up = buildWaveChart(analysis, { step: 0, chartSpec: spec });
const downBars = bars.map((bar) => ({ time: bar.time, open: 250 - bar.open, high: 250 - bar.low, low: 250 - bar.high, close: 250 - bar.close }));
const down = buildWaveChart({ ...analysis, step_data: { 0: { chart_data: { schema_version: "wavekb-chart-input-v1", bars: downBars } } } }, { step: 0, chartSpec: { scenarios: [{ ...spec.scenarios[0], direction: "down" }] } });
const structure = buildWaveChart({ instrument: "结构示例", primary_timeframe: "日线", step_data: { 1: { direction: "up", w1_start: 100, w1_end: 110, w2_end: 104, w3_end: 126, w4_end: 116, w5_end: 137 } } }, { step: 1 });

const meta = {
  title: "Workbench/Wave analysis chart",
  component: WaveAnalysisChart,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-4 px-4 py-8 md:px-6"><p className="text-sm leading-6 text-muted-foreground">合成价格与计数，仅用于界面验收；不是实时行情、实际模型结论或交易建议。</p><div className="min-w-0 rounded-xl border bg-surface p-4 md:p-5"><Story /></div></main>],
} satisfies Meta<typeof WaveAnalysisChart>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PrimaryAndAlternative: Story = {
  name: "合成 K 线 · 主备选计数",
  args: { value: up },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("img", { name: "BTCUSDT 波浪分析图：主计数" })).toBeInTheDocument();
    await expect(canvas.getByText("存疑计数（点线＋?）")).toBeInTheDocument();
    await expect(canvas.getByText("不是账户回撤")).toBeInTheDocument();
  },
};

export const Falling: Story = { name: "合成下跌计数", args: { value: down } };
export const StructureOnly: Story = { name: "合成结构示意 · 非时间 K 线", args: { value: structure } };
export const PricesWithoutCount: Story = { name: "合成价格 · 暂无浪型计数", args: { value: buildWaveChart(analysis, { step: 0 }) } };
export const NoData: Story = { name: "无数据 · 不凭空生成行情", args: { value: null } };
export const PrivateMetadataRejected: Story = { name: "合成恶意来源字段 · 安全空态", args: { value: { ...up, source_path: "file:///synthetic/private.pdf" } }, play: async ({ canvas }) => {
  await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
  await expect(canvas.getByText(/暂无可用图表数据/)).toBeInTheDocument();
} };
