import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchAnalysisEditor } from "./workbench-analysis-editor";
import type { WorkbenchAnalysis } from "@wavekb/domain";
import { installBrowserStorage } from "@/test/browser-storage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
const { supabase } = vi.hoisted(() => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => supabase }));
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

describe("AI knowledge selection", () => {
  const saved: WorkbenchAnalysis = {
    id: "saved-analysis", owner_id: "local-test", schema_version: "workbench-v1", input_source: "manual", instrument: "BTCUSDT", market: "crypto",
    primary_timeframe: "4小时", parent_timeframe: "日线", child_timeframe: "1小时", holding_style: "波段", execution_status: "draft",
    step_data: {}, rule_result: {}, score_result: {}, risk_result: {}, drawdown_result: {}, created_at: "2026-01-01", updated_at: "2026-01-01",
  };

  beforeEach(() => {
    supabase.from.mockImplementation(() => ({ update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: saved, error: null }) }) }) }) }) }));
  });

  it("keeps one selected scope for this editor mount and sends its strict v2 payload without replacing saved analysis on refresh failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job-1", status: "queued" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);

    fireEvent.click(screen.getByRole("radio", { name: /自然法则/ }));
    expect((screen.getByRole("radio", { name: /自然法则/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
      request_version: 2, client_request_id: "11111111-1111-4111-8111-111111111111", task_type: "wave_analysis", step: 4,
      analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "single", book_id: "elliott-wave-natural-law" },
    });
    await screen.findByText(/任务状态：/);
    fireEvent.click(screen.getByRole("button", { name: "刷新 AI 状态" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("radio", { name: /自然法则/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/任务状态：/).textContent).toContain("queued");
    vi.unstubAllGlobals();
  });

  it("keeps legacy diagnostics usable without exposing forged citation metadata", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job-2", status: "queued" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: {
        id: "job-2", status: "completed", output_payload: {
          legacy_note: "保留的旧输出", knowledge_citations: ["model-supplied-id"],
          citations: [{ href: "https://example.test/forged", title: "伪造依据" }],
        },
      } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);

    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    await screen.findByText(/任务状态：/);
    const refresh = screen.getByRole("button", { name: "刷新 AI 状态" }) as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    fireEvent.click(refresh);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByText("原始 JSON 诊断"));
    const diagnostics = await screen.findByText((_, element) => element?.tagName === "PRE" && element.textContent?.includes("保留的旧输出") === true);
    expect(diagnostics.textContent).not.toContain("https://example.test/forged");
    expect(diagnostics.textContent).not.toContain("model-supplied-id");
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    vi.unstubAllGlobals();
  });
});
