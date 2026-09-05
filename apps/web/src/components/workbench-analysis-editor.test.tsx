import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchAnalysisEditor } from "./workbench-analysis-editor";
import type { WorkbenchAnalysis } from "@wavekb/domain";
import { installBrowserStorage } from "@/test/browser-storage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
beforeEach(installBrowserStorage);
afterEach(cleanup);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = () => fireEvent.click(screen.getByRole("button", { name: "下一步" }));

describe("analysis results", () => {
  it("requires entered pivots, never presents sample prices as real input", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={6} />);
    expect((screen.getByLabelText("浪1起点") as HTMLInputElement).value).toBe("");
  });

  it("checks the selected structure and shows no fabricated score", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={5} />);
    change("驱动结构候选", "impulse"); next();
    ["浪1起点", "浪1终点", "浪2终点", "浪3终点", "浪4终点", "浪5终点"].forEach((label, i) => change(label, String([200,240,220,320,280,350][i])));
    fireEvent.click(screen.getByRole("button", { name: "执行硬规则检查" }));
    const results = within(screen.getByRole("complementary"));
    expect(results.queryByText("66")).toBeNull();
    expect(results.queryByText("71")).toBeNull();
    expect(results.getByText("已通过已实现规则")).toBeDefined();
    change("浪2终点", "190");
    expect(results.queryByText("已通过已实现规则")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "执行硬规则检查" }));
    expect(results.getByText("浪2不得越过浪1起点。")).toBeDefined();
  });

  it("does not apply ordinary impulse rules to diagonals", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={5} />);
    change("驱动结构候选", "ending_diagonal"); next();
    fireEvent.click(screen.getByRole("button", { name: "执行硬规则检查" }));
    expect(screen.getByRole("alert").textContent).toContain("尚未实现");
  });

  it("shows calculation errors and clears obsolete results after input changes", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={3} />);
    fireEvent.click(screen.getByRole("button", { name: "测量最大回撤" }));
    expect(screen.getByRole("alert").textContent).toContain("至少");
    change("价格或权益序列", "100,120,90");
    fireEvent.click(screen.getByRole("button", { name: "测量最大回撤" }));
    expect(within(screen.getByRole("complementary")).getByText("30")).toBeDefined();
    change("价格或权益序列", "100,110");
    expect(within(screen.getByRole("complementary")).queryByText("30")).toBeNull();
  });

  it("invalidates risk results when the analysis instrument changes", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={8} />);
    change("计划入场价", "100"); change("交易止损价", "95"); change("目标价", "115");
    fireEvent.click(screen.getByRole("button", { name: "计算风险收益" }));
    expect(within(screen.getByRole("complementary")).getByText("200")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /第 1 步/ }));
    change("分析品种", "TEST:NEW");
    expect(within(screen.getByRole("complementary")).queryByText("200")).toBeNull();
  });

  it("does not turn missing risk prices into zero values", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={8} />);
    fireEvent.click(screen.getByRole("button", { name: "计算风险收益" }));
    expect(screen.getByRole("alert").textContent).toContain("有效数字");
  });

  it.each(["server", "local"])("requires a fresh check for obsolete %s results, including diagonals", async (source) => {
    const old: WorkbenchAnalysis = {
      id: "saved", owner_id: "local-test", schema_version: "workbench-v1", input_source: "manual", instrument: "TEST:OLD", market: "crypto",
      primary_timeframe: "4小时", parent_timeframe: "日线", child_timeframe: "1小时", holding_style: "波段", execution_status: "draft",
      step_data: { "5": { pattern: "ending_diagonal" } }, rule_result: { status: "valid", checks: [{ passed: true, message: "旧普通推动浪规则" }] },
      score_result: { structural_score: 66, trading_suitability: 71 }, risk_result: {}, drawdown_result: {}, created_at: "2026-01-01", updated_at: "2026-01-01",
    };
    if (source === "local") window.localStorage.setItem("wavekb:next:analysis:local-test", JSON.stringify(old));
    render(<WorkbenchAnalysisEditor actorId="local-test" initialStep={6} initialAnalysis={source === "server" ? old : undefined} />);
    await screen.findByText("历史规则结果需要重新检查。");
    const results = within(screen.getByRole("complementary"));
    expect(results.queryByText("已通过已实现规则")).toBeNull();
    expect(results.queryByText("旧普通推动浪规则")).toBeNull();
    expect(results.queryByText("66")).toBeNull();
  });
});
