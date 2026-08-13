import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WorkbenchAnalysisEditor } from "./workbench-analysis-editor";

const analysis = {
  id: "11111111-1111-4111-8111-111111111111", owner_id: "79facf84-b98c-44f6-a223-b9ee4bc31f08", schema_version: "workbench-v1" as const,
  input_source: "manual" as const, instrument: "BINANCE:BTCUSDT", market: "crypto", primary_timeframe: "4小时", parent_timeframe: "日线", child_timeframe: "1小时", holding_style: "波段",
  step_data: { "6": { direction: "up", w1_start: 100, w1_end: 120, w2_end: 110, w3_end: 160, w4_end: 140, w5_end: 175, notes: "等待同级别结构完成。" } },
  rule_result: {}, score_result: {}, risk_result: {}, drawdown_result: {}, execution_status: "draft" as const,
  created_at: "2026-08-13T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z",
};

const meta = {
  title: "Workbench/Analysis editor",
  component: WorkbenchAnalysisEditor,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-7xl px-4 py-10 md:px-6"><Story /></main>],
  args: { actorId: analysis.owner_id, initialAnalysis: analysis, initialStep: 6 },
} satisfies Meta<typeof WorkbenchAnalysisEditor>;

export default meta;
type Story = StoryObj<typeof meta>;
export const RuleCheck: Story = {};
export const RiskCalculation: Story = { args: { initialStep: 8 } };
