import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PrivateEntryEditor } from "./private-entry-editor";

const meta = {
  title: "Workbench/Private entry editor",
  component: PrivateEntryEditor,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-7 px-4 py-10 md:px-6 md:py-14"><header className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">编辑私人记录</h1><p className="text-sm text-muted-foreground">验证桌面、移动端与双主题下的真实编辑密度。</p></header><Story /></main>],
  args: {
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    entry: {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
      kind: "review",
      title: "BTC 4 小时主升段复盘",
      body: "入场前保留主计数与备选计数。价格触及失效位后没有移动止损，执行与结构判断需要分开复盘。",
      instrument: "BTCUSDT",
      market: "加密",
      timeframe: "4小时",
      tags: ["主升", "执行纪律"],
      knowledge_ids: ["unit-ewp-rule-impulse"],
      workbench_analysis_id: null,
      review_data: { editor_mode: "professional", outcome: "loss", count_result: "correct", rule_compliance: "yes", execution_score: 3, lesson: "结构成立不等于执行合格。" },
      created_at: "2026-08-13T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
      deleted_at: null,
      private_entry_images: [],
    },
  },
} satisfies Meta<typeof PrivateEntryEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProfessionalReview: Story = {};
