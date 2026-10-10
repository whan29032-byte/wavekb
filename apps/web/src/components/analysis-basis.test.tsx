import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnalysisBasis } from "./analysis-basis";

afterEach(cleanup);

const structure = {
  kind: "structure",
  summary: "同级别回撤后仍需检查内部结构是否完成。",
  conditions: ["上一级方向与当前计数保持一致。"],
  invalidations: ["价格越过结构失效位时排除该计数。"],
};
const hypothesis = {
  kind: "hypothesis",
  summary: "当前调整可能尚缺最后一个子浪。",
  conditions: ["末端仍未形成完整结构。"],
  invalidations: [],
};
const output = {
  schema_version: "wavekb-public-analysis-v1",
  source_visibility: "private_research",
  analysis_basis: [structure, hypothesis],
};

describe("public analysis basis", () => {
  it.each(["private_research", "public_books"])("renders only approved reasoning in %s mode with readable states", (source_visibility) => {
    render(<AnalysisBasis output={{ ...output, source_visibility }} />);
    const section = screen.getByRole("region", { name: "分析依据" });
    expect(within(section).getByText("结构判断")).toBeDefined();
    expect(within(section).getByText("候选假设（未验证）")).toBeDefined();
    expect(within(section).getByText(structure.summary)).toBeDefined();
    expect(within(section).getByText(structure.conditions[0])).toBeDefined();
    expect(within(section).getByText(structure.invalidations[0])).toBeDefined();
    expect(within(section).getAllByText("成立条件")).toHaveLength(2);
    expect(within(section).getByText("失效条件")).toBeDefined();
    expect(within(section).queryByText("已复核经验")).toBeNull();
    expect(within(section).getByText(/不等同于已验证的学习成果/)).toBeDefined();
    expect(within(section).queryByRole("link")).toBeNull();
  });

  it.each([
    undefined, null, [], {},
    { ...output, schema_version: "wave-analysis-v2" },
    { ...output, schema_version: 1 },
    { ...output, source_visibility: "private_research " },
    { ...output, source_visibility: "unknown" },
    { ...output, analysis_basis: {} },
    { ...output, analysis_basis: [] },
    { ...output, analysis_basis: Array.from({ length: 13 }, () => structure) },
  ])("does not render an absent, unsupported, or oversized contract: %j", (candidate) => {
    const { container } = render(<AnalysisBasis output={candidate} />);
    expect(container.textContent).toBe("");
  });

  it("never renders root-level private metadata or nested diagnostics", () => {
    render(<AnalysisBasis output={{ ...output,
      local_book_title: "私有课件标题",
      local_path: "/Users/private/secret.pdf",
      citations: [{ href: "file:///Users/private/secret.pdf" }],
      provenance: { source_id: "secret-source-id", nested: { source: "私有来源" } },
    }} />);
    expect(screen.getByText(structure.summary)).toBeDefined();
    for (const privateText of ["私有课件标题", "/Users/private/secret.pdf", "secret-source-id", "私有来源"]) {
      expect(screen.queryByText(privateText)).toBeNull();
    }
  });

  it.each([
    { ...structure, kind: "reviewed" },
    { ...structure, kind: "learned" },
    { ...structure, reviewed: true },
    { ...structure, source: { path: "/Users/private/book.pdf" } },
    { ...structure, summary: "" },
    { ...structure, summary: " ", conditions: [] },
    { ...structure, summary: "x".repeat(501) },
    { ...structure, summary: { text: "unknown object" } },
    { ...structure, conditions: null },
    { ...structure, conditions: Array(7).fill("太多条件") },
    { ...structure, conditions: ["x".repeat(281)] },
    { ...structure, invalidations: [4] },
    { ...structure, invalidations: Array(7).fill("太多失效条件") },
    { ...structure, invalidations: ["x".repeat(281)] },
  ])("rejects unapproved status, unknown keys, or invalid entry fields: %j", (item) => {
    const { container } = render(<AnalysisBasis output={{ ...output, analysis_basis: [item] }} />);
    expect(container.textContent).toBe("");
  });

  it.each([
    "请查看 /Users/private/notes/book.pdf",
    "资料位置是/Users/private/book",
    "请查看 /home/private/book",
    "请查看 /var/private/book",
    "请查看 /opt/hermes/book",
    "请查看 /srv/knowledge/book",
    "请查看 ~/knowledge/book",
    "请查看 ../knowledge/book",
    "请查看 ./knowledge/book",
    "请查看 C:\\private\\book",
    "请查看 file:///private/book",
    "请查看 https://private.example/book",
    "请查看 www.private.example",
    "请查看 /knowledge/books/private-book#page-1",
    "source_id: secret",
    "knowledge_id: secret",
    "book_title: 私有标题",
    "citation-private-001",
    "private-kb-secret-001",
    "local-kb-secret-001",
    "unit-ewp-private-001",
    "资料来源是 lesson.pdf。",
    "资料来源是 internal.md",
    "来源\u0000被隐藏",
    "来\u200b源被隐藏",
    "来\u202e源被隐藏",
  ])("refuses visible provenance or unsupported control characters: %s", (summary) => {
    const { container } = render(<AnalysisBasis output={{ ...output, analysis_basis: [{ ...structure, summary }] }} />);
    expect(container.textContent).toBe("");
  });

  it("applies the same privacy guards to conditions and invalidations", () => {
    const { container } = render(<AnalysisBasis output={{ ...output, analysis_basis: [
      { ...structure, conditions: ["https://private.example/source"] },
      { ...structure, invalidations: ["file:///Users/private/source.pdf"] },
    ] }} />);
    expect(container.textContent).toBe("");
  });

  it("keeps valid entries without promoting or displaying malformed siblings", () => {
    render(<AnalysisBasis output={{ ...output, analysis_basis: [structure, { ...hypothesis, kind: "reviewed" }] }} />);
    expect(screen.getByText(structure.summary)).toBeDefined();
    expect(screen.queryByText(hypothesis.summary)).toBeNull();
    expect(screen.queryByText("已复核经验")).toBeNull();
  });
});
