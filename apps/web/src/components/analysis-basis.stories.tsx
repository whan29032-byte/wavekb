import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { AnalysisBasis } from "./analysis-basis";

// Synthetic UI fixtures only: no local book extracts, source metadata, or
// actual research material are read or included in these development stories.
const structure = {
  kind: "structure",
  summary: "示例计数需要同级别内部结构完成后才能确认。",
  conditions: ["当前级别与上一级示例方向一致。", "末端子浪结构完成。"],
  invalidations: ["示例价格越过结构失效位。"],
};
const hypothesis = {
  kind: "hypothesis",
  summary: "示例调整可能尚缺一个子浪；目前仅为待验证假设。",
  conditions: ["后续走势保留当前计数。"],
  invalidations: ["后续走势破坏示例计数。"],
};
const publicOutput = {
  schema_version: "wavekb-public-analysis-v1",
  source_visibility: "private_research",
};

const meta = {
  title: "Workbench/Analysis basis",
  component: AnalysisBasis,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-3xl gap-4 px-4 py-8 md:px-6">
    <p className="text-sm text-muted-foreground">合成预览数据，不代表真实分析或学习结果。</p>
    <div className="min-w-0 rounded-xl border bg-surface p-5"><Story /></div>
  </main>],
} satisfies Meta<typeof AnalysisBasis>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Structure: Story = {
  name: "结构判断",
  args: { output: { ...publicOutput, analysis_basis: [structure] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "分析依据" })).toBeInTheDocument();
    await expect(canvas.getByText("结构判断")).toBeInTheDocument();
    await expect(canvas.queryByText("已复核经验")).not.toBeInTheDocument();
  },
};

export const CandidateHypothesis: Story = {
  name: "候选假设（未验证）",
  args: { output: { ...publicOutput, analysis_basis: [hypothesis] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("候选假设（未验证）")).toBeInTheDocument();
    await expect(canvas.getByText(hypothesis.summary)).toBeInTheDocument();
    await expect(canvas.queryByText("已复核经验")).not.toBeInTheDocument();
  },
};

export const PrivateResearchWithMaliciousReferences: Story = {
  name: "私有研究：恶意引用不显示",
  args: { output: {
    ...publicOutput,
    analysis_basis: [structure, hypothesis],
    // Deliberately malicious, entirely invented provenance for privacy checks.
    citations: [{ book_title: "合成私有标题（不得显示）", href: "file:///synthetic/secret.pdf" }],
    knowledge_citations: ["synthetic-private-citation-id"],
    source_details: { local_path: "/synthetic/private-material.pdf", nested: { title: "合成内部来源（不得显示）" } },
  } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(structure.summary)).toBeInTheDocument();
    await expect(canvas.getByText("候选假设（未验证）")).toBeInTheDocument();
    await expect(canvas.queryByText("合成私有标题（不得显示）")).not.toBeInTheDocument();
    await expect(canvas.queryByText("合成内部来源（不得显示）")).not.toBeInTheDocument();
    await expect(canvas.queryByText("synthetic-private-citation-id")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
  },
};

export const NoBasis: Story = {
  name: "无依据",
  args: { output: { ...publicOutput, analysis_basis: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("heading", { name: "分析依据" })).not.toBeInTheDocument();
    await expect(canvas.queryByText("结构判断")).not.toBeInTheDocument();
    await expect(canvas.queryByText("候选假设（未验证）")).not.toBeInTheDocument();
  },
};
