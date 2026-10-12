import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchAnalysisEditor } from "./workbench-analysis-editor";
import type { WorkbenchAnalysis } from "@wavekb/domain";
import { installBrowserStorage } from "@/test/browser-storage";
import { buildWaveChart } from "../../../../ai-gateway/src/research/wave-chart";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
const { supabase } = vi.hoisted(() => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn(), onAuthStateChange: vi.fn() } } }));
const { visionServices } = vi.hoisted(() => ({ visionServices: { verifyOwner: vi.fn(), load: vi.fn(), upload: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => supabase }));
vi.mock("@/lib/workbench/analysis-images", async (original) => ({ ...await original<typeof import("@/lib/workbench/analysis-images")>(), browserAnalysisImageServices: () => visionServices }));
beforeEach(() => {
  installBrowserStorage();
  supabase.auth.getUser.mockReset(); supabase.auth.onAuthStateChange.mockReset();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "local-test" } }, error: null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  visionServices.verifyOwner.mockReset(); visionServices.verifyOwner.mockResolvedValue(undefined);
  visionServices.load.mockReset(); visionServices.load.mockImplementation(async (_context, ids: string[]) => ids.map((id) => ({ id, signedUrl: "https://project.supabase.co/storage/v1/object/sign/private.png?token=synthetic", byteSize: 3, mimeType: "image/png" })));
  visionServices.upload.mockReset();
});
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
  const chartInput = {
    schema_version: "wavekb-chart-input-v1",
    bars: [{ time: 1728000000, open: 100, high: 105, low: 99, close: 104 }, { time: 1728003600, open: 104, high: 107, low: 102, close: 105 }],
  };
  const chartContext = { schema_version: "wavekb-chart-context-v1", instrument: "BTCUSDT", timeframe: "4小时" };

  beforeEach(() => {
    supabase.from.mockImplementation(() => ({ update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: saved, error: null }) }) }) }) }) }));
  });

  const imageId = "33333333-3333-4333-8333-333333333333";
  const otherImageId = "44444444-4444-4444-8444-444444444444";
  it("sends only explicitly selected current-step screenshots in v3, not earlier or future step references", async () => {
    const update = vi.fn((value) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...saved, ...value }, error: null }) }) }) }) }));
    supabase.from.mockImplementation(() => ({ update }));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { id: "vision-job", status: "queued" } })));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "2": { vision_image_ids: [otherImageId] }, "4": { notes: "保留文字", vision_image_ids: [imageId] }, "5": { vision_image_ids: [otherImageId] } } }} initialStep={4} />);
    await screen.findByAltText("本步骤行情截图 1"); fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByText(/任务状态：/);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ request_version: 3, step: 4, vision_image_ids: [imageId], vision_context: { instrument: "BTCUSDT", timeframe: "4小时" } });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(otherImageId); expect(JSON.stringify(fetcher.mock.calls)).not.toContain("token=");
    expect(update.mock.calls[0][0].step_data["4"]).toEqual({ notes: "保留文字", vision_image_ids: [imageId] }); vi.unstubAllGlobals();
  });
  it("does not inherit earlier/future image references into a no-image v2 action", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { id: "text-job", status: "queued" } }))); vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "2": { vision_image_ids: [imageId] }, "5": { vision_image_ids: [otherImageId] } } }} initialStep={4} />);
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByText(/任务状态：/);
    const request = JSON.parse(fetcher.mock.calls[0][1].body); expect(request.request_version).toBe(2); expect(request).not.toHaveProperty("vision_image_ids"); expect(visionServices.load).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it.each(["instrument", "timeframe"])("clears all old screenshot references when the %s changes, preserving notes and other step fields", async (context) => {
    const update = vi.fn((value) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...saved, ...value }, error: null }) }) }) }) }));
    supabase.from.mockImplementation(() => ({ update }));
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "2": { vision_image_ids: [otherImageId], mode: "motive" }, "4": { notes: "不可丢失", vision_image_ids: [imageId] } } }} initialStep={context === "instrument" ? 0 : 1} />);
    await screen.findByText(/服务器版本已加载/);
    if (context === "instrument") change("分析品种", "ETHUSDT"); else { change("当前分析周期", "1小时"); change("下一级周期", "15分钟"); }
    fireEvent.click(screen.getByRole("button", { name: "保存分析" })); await screen.findByText("分析已保存。");
    expect(update.mock.calls[0][0].step_data).toEqual({ "2": { mode: "motive" }, "4": { notes: "不可丢失" } });
  });
  it("blocks unverified screenshot input instead of silently submitting a text-only task", async () => {
    visionServices.load.mockRejectedValue(new Error("image_unavailable")); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { vision_image_ids: [imageId] } } }} initialStep={4} />);
    await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByText(/截图加载失败时不会静默改为文字分析/);
    expect(fetcher).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("retries the exact accepted screenshot selection after lost acknowledgements even after local removal", async () => {
    supabase.from.mockImplementation(() => ({ update: (value: Record<string, unknown>) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...saved, ...value }, error: null }) }) }) }) }) }));
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("ack lost")).mockRejectedValueOnce(new TypeError("ack lost again")).mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "recovered-vision", status: "queued" } })));
    vi.stubGlobal("fetch", fetcher); render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { vision_image_ids: [imageId] } } }} initialStep={4} />);
    await screen.findByAltText("本步骤行情截图 1"); fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByText(/结果待核实/);
    fireEvent.click(screen.getByRole("button", { name: "清除本步骤截图" })); fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByText(/任务状态：/);
    const bodies = fetcher.mock.calls.map((call) => call[1].body); expect(bodies[1]).toBe(bodies[0]); expect(bodies[2]).toBe(bodies[0]); expect(JSON.parse(bodies[2]).vision_image_ids).toEqual([imageId]); vi.unstubAllGlobals();
  });
  it.each(["vision_model_required", "invalid_image_input", "image_unavailable"])("explains the fixed screenshot rejection %s without raw codes", async (code) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), { status: 400 })); vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />); fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    const alert = await screen.findByRole("alert"); expect(alert.textContent).not.toContain(code); expect(alert.textContent).toMatch(/截图/); vi.unstubAllGlobals();
  });

  it("saves optional chart data inside the current step without changing notes or AI request shape", async () => {
    const update = vi.fn((value) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...saved, ...value }, error: null }) }) }) }) }));
    supabase.from.mockImplementation(() => ({ update }));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { id: "chart-job", status: "queued" } })));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { notes: "保留分析记录。" } } }} initialStep={4} />);
    await screen.findByText(/服务器版本已加载/);
    change("行情 JSON", JSON.stringify(chartInput));
    fireEvent.click(screen.getByRole("button", { name: "检查并应用行情" }));
    expect(screen.getByText(/当前绘图输入：2 根/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    await screen.findByText(/任务状态：/);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].step_data["4"]).toEqual({ notes: "保留分析记录。", chart_data: chartInput, chart_context: chartContext });
    const request = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(request.step).toBe(4); expect(request.task_type).toBe("wave_analysis");
    expect(request).not.toHaveProperty("chart_data"); expect(request).not.toHaveProperty("step_data");
    vi.unstubAllGlobals();
  });

  it("restores chart data with the existing owner-scoped local draft", async () => {
    localStorage.setItem("wavekb:next:analysis:local-test:saved-analysis", JSON.stringify({ draft: { ...saved, step_data: { "4": { notes: "恢复的记录", chart_data: chartInput, chart_context: chartContext } } }, savedAt: "2026-10-11T00:00:00Z" }));
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);
    await screen.findByText(/已恢复 .* 的本地草稿/);
    expect(screen.getByText(/当前绘图输入：2 根/)).toBeDefined();
    expect((screen.getByLabelText("分析记录") as HTMLTextAreaElement).value).toBe("恢复的记录");
  });

  it("removes only the current step chart field rather than saving a null dataset", async () => {
    const update = vi.fn((value) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...saved, ...value }, error: null }) }) }) }) }));
    supabase.from.mockImplementation(() => ({ update }));
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { notes: "继续保留", chart_data: chartInput, chart_context: chartContext }, "5": { chart_data: chartInput, pattern: "impulse", chart_context: chartContext } } }} initialStep={4} />);
    await screen.findByText(/服务器版本已加载/);
    fireEvent.click(screen.getByRole("button", { name: "清除本步骤绘图输入" }));
    fireEvent.click(screen.getByRole("button", { name: "保存分析" }));
    await screen.findByText("分析已保存。");
    expect(update.mock.calls[0][0].step_data["4"]).toEqual({ notes: "继续保留" });
    expect(update.mock.calls[0][0].step_data["5"]).toEqual({ chart_data: chartInput, pattern: "impulse", chart_context: chartContext });
  });

  it("makes reused earlier chart data explicit while ignoring later-step datasets", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "2": { chart_data: chartInput, chart_context: chartContext }, "5": { chart_data: { ...chartInput, bars: [chartInput.bars[0]] }, chart_context: chartContext } } }} initialStep={4} />);
    expect(screen.getByText(/AI 将沿用第 3 步的 2 根用户输入 K 线/)).toBeDefined();
    expect(screen.getByText(/后续步骤的行情不会参与本次分析/)).toBeDefined();
    expect(screen.queryByText(/当前绘图输入/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看第 3 步绘图输入" }));
    expect(screen.getByText(/当前绘图输入：2 根/)).toBeDefined();
  });

  it("does not suggest that a later chart dataset is available to the current analysis", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "5": { chart_data: chartInput } } }} initialStep={4} />);
    expect(screen.queryByText(/AI 将沿用/)).toBeNull();
    expect(screen.queryByText(/当前绘图输入/)).toBeNull();
  });

  it("explains an invalid earlier dataset instead of silently claiming an older valid chart is used", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "2": { chart_data: chartInput }, "3": { chart_data: null } } }} initialStep={4} />);
    expect(screen.getByText(/第 4 步已有行情格式无效；不会退回更早的数据/)).toBeDefined();
    expect(screen.queryByText(/AI 将沿用第 3 步/)).toBeNull();
  });

  it("disables an unbound legacy dataset without treating it as current market data", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { chart_data: chartInput } } }} initialStep={4} />);
    expect(screen.getByText(/此行情属于其他或未确认标的／周期，已停用/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("请重新导入并核对");
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("preserves old chart drafts but blocks reuse after changing instruments until explicit reimport", async () => {
    const update = vi.fn((value) => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...saved, ...value }, error: null }) }) }) }) }));
    supabase.from.mockImplementation(() => ({ update }));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { id: "reimported", status: "queued" } })));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { notes: "保留原草稿", chart_data: chartInput, chart_context: chartContext } } }} initialStep={0} />);
    await screen.findByText(/服务器版本已加载/);
    change("分析品种", "SOLUSDT");
    fireEvent.click(screen.getByRole("button", { name: /第 5 步/ }));
    expect(screen.getByText(/此行情属于其他或未确认标的／周期，已停用/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    await screen.findByRole("alert"); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存分析" })); await screen.findByText("分析已保存。");
    expect(update.mock.calls[0][0].step_data["4"]).toEqual({ notes: "保留原草稿", chart_data: chartInput, chart_context: chartContext });
    change("行情 JSON", JSON.stringify(chartInput)); fireEvent.click(screen.getByRole("button", { name: "检查并应用行情" }));
    expect(screen.queryByText(/此行情属于其他或未确认标的／周期，已停用/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByText(/任务状态：/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[1][0].step_data["4"].chart_context).toEqual({ ...chartContext, instrument: "SOLUSDT" });
    vi.unstubAllGlobals();
  });

  it("deactivates bound chart data after changing the analysis timeframe", async () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "4": { chart_data: chartInput, chart_context: chartContext } } }} initialStep={1} />);
    await screen.findByText(/服务器版本已加载/);
    change("当前分析周期", "1小时"); change("下一级周期", "15分钟");
    fireEvent.click(screen.getByRole("button", { name: /第 5 步/ }));
    expect(screen.getByText(/此行情属于其他或未确认标的／周期，已停用/)).toBeDefined();
  });

  it("does not fall back to earlier valid chart data when the latest context is mismatched", () => {
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={{ ...saved, step_data: { "2": { chart_data: chartInput, chart_context: chartContext }, "3": { chart_data: chartInput, chart_context: { ...chartContext, instrument: "SOLUSDT" } } } }} initialStep={4} />);
    expect(screen.getByText(/第 4 步行情属于其他或未确认标的／周期，已停用/)).toBeDefined();
    expect(screen.queryByText(/AI 将沿用第 3 步/)).toBeNull();
  });

  it.each(["null", "[]", '{"draft":{"instrument":4}}', '{"draft":{"owner_id":"other"}}', "{bad json"])("rejects malformed local drafts without replacing the server analysis: %s", async (savedDraft) => {
    localStorage.setItem("wavekb:next:analysis:local-test:saved-analysis", savedDraft);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={0} />);
    await screen.findByText("本地草稿无法读取，已从服务器版本继续。");
    expect((screen.getByLabelText("分析品种") as HTMLInputElement).value).toBe("BTCUSDT");
    expect(localStorage.getItem("wavekb:next:analysis:local-test:saved-analysis")).toBeNull();
  });

  it("continues with server data when both storage reads and removals are disabled", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new DOMException("disabled", "SecurityError"); });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new DOMException("disabled", "SecurityError"); });
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={0} />);
    await screen.findByText("本地草稿无法读取，已从服务器版本继续。");
    expect((screen.getByLabelText("分析品种") as HTMLInputElement).value).toBe("BTCUSDT");
  });

  it("does not turn a committed server save into a failure when local draft removal fails", async () => {
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new DOMException("disabled", "SecurityError"); });
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={0} />);
    await screen.findByText(/服务器版本已加载/);
    fireEvent.click(screen.getByRole("button", { name: "保存分析" }));
    await screen.findByText("分析已保存。");
    expect(screen.getByText(/已保存到服务器，但本机暂存无法清除/)).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still starts the AI task after a committed save whose local cleanup is blocked", async () => {
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new DOMException("disabled", "SecurityError"); });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { id: "storage-safe", status: "queued" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);
    await screen.findByText(/服务器版本已加载/);
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    await screen.findByText(/任务状态：/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("reuses the exact original AI request after both acknowledgement attempts are lost", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("ack lost")).mockRejectedValueOnce(new TypeError("ack lost again"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "recovered", status: "queued" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);
    const start = screen.getByRole("button", { name: "启动 AI 候选分析" });
    fireEvent.click(start); await screen.findByText(/结果待核实/);
    fireEvent.click(screen.getByRole("radio", { name: /自然法则/ }));
    fireEvent.click(start); await screen.findByText(/任务状态：/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String(call[1].body)));
    expect(bodies[1]).toEqual(bodies[0]); expect(bodies[2]).toEqual(bodies[0]);
    vi.unstubAllGlobals();
  });

  it.each(["before", "after"])("binds a new managed submission to the current actor %s its acknowledgement", async (phase) => {
    const quota = { user_id: "local-test", usage_day: "2026-10-10", timezone: "Asia/Shanghai", has_vip: true, daily_limit: 50, used: 2, remaining: 48, enabled: true, configured: true, available: true };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(quota)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "old-owner-job", status: "queued" } })));
    vi.stubGlobal("fetch", fetcher); render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);
    fireEvent.click(screen.getByRole("button", { name: "核实 Hermes 会员额度" })); await screen.findByText(/剩余 48 次/);
    fireEvent.click(screen.getByRole("radio", { name: /Hermes 云端研究/ }));
    supabase.from.mockClear(); supabase.auth.getUser.mockReset();
    if (phase === "after") {
      supabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "local-test" } }, error: null })
        .mockResolvedValueOnce({ data: { user: { id: "local-test" } }, error: null });
    }
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" })); await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("登录账号已变化或退出");
    expect(fetcher).toHaveBeenCalledTimes(phase === "before" ? 1 : 2);
    if (phase === "before") expect(supabase.from).not.toHaveBeenCalled();
    expect(screen.queryByText(/任务状态：/)).toBeNull(); vi.unstubAllGlobals();
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

  it("does not expose raw legacy diagnostics or trust shape-valid citations from a matching legacy version", async () => {
    const forgedCitation = {
      knowledge_id: "unit-ewp-rule-impulse-core",
      book_id: "elliott-wave-principle-tenth-edition",
      book_title: "伪造书名",
      title: "伪造依据",
      source_id: "forged-source",
      pages: [32],
      href: "/knowledge/unit-ewp-rule-impulse-core",
      snippet: "伪造但结构完整的片段",
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job-2", status: "queued" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: {
        id: "job-2", status: "completed", knowledge_version: "ewp-10-zh-2016", output_payload: {
          knowledge_version: "ewp-10-zh-2016",
          legacy_note: "保留的旧输出", knowledge_citations: ["model-supplied-id"],
          citations: [forgedCitation],
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

    expect(screen.queryByText("原始 JSON 诊断")).toBeNull();
    expect(screen.queryByText("保留的旧输出")).toBeNull();
    expect(screen.queryByText("model-supplied-id")).toBeNull();
    expect(screen.queryByText("伪造书名")).toBeNull();
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    expect(screen.queryByRole("link", { name: "打开知识原文" })).toBeNull();
    vi.unstubAllGlobals();
  });

  const artifactVersion = "e50017a8f53a9d78e65bfa51871de50864c8f4ebb0e7cabe2d68018a04b5da61";
  const publicCitation = {
    knowledge_id: "unit-ewp-rule-impulse-core", book_id: "elliott-wave-principle-tenth-edition",
    book_title: "公开补充书籍", title: "公开推动浪规则", source_id: "ewp-11-zh-2021::canonical-units",
    pages: [32], href: "/knowledge/unit-ewp-rule-impulse-core", snippet: "浪二不得越过浪一的起点。",
  };

  async function loadAiOutput(output_payload: unknown, error_message?: string) {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "private-job", status: "queued" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: {
        id: "private-job", status: "completed", knowledge_version: artifactVersion, output_payload, error_message,
      } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkbenchAnalysisEditor actorId="local-test" initialAnalysis={saved} initialStep={4} />);
    fireEvent.click(screen.getByRole("button", { name: "启动 AI 候选分析" }));
    const refresh = await screen.findByRole("button", { name: "刷新 AI 状态" }) as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    fireEvent.click(refresh);
    await screen.findByText("completed");
    expect(screen.queryByText("AI 任务已进入服务器队列，将经过知识检索和规则闸门。")).toBeNull();
  }

  it("shows the complete image observation summary beyond the old 180-character limit", async () => {
    const observations = "截图标题为图形验收，标记为 marker 7319；可见蓝色折线和绿色方块。";
    const explanation = "这里只记录图中可见形状，不把示意图识别为已验证行情，也不确认波浪计数。";
    const current_pattern = `${observations}${explanation.repeat(8)}`.slice(0, 232) + "完整结尾可见。";
    expect(current_pattern).toHaveLength(239);
    await loadAiOutput({
      schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research",
      instrument: "BTCUSDT", current_pattern,
    });
    const summary = screen.getByRole("region", { name: "AI 分析摘要" });
    expect(within(summary).getByText(current_pattern)).toBeDefined();
    expect(summary.textContent).toContain("marker 7319");
    expect(summary.textContent).toContain("蓝色折线和绿色方块");
    expect(summary.textContent).toContain("完整结尾可见。");
    vi.unstubAllGlobals();
  });

  it.each([2000, 2001])("uses the full current-pattern boundary at %i characters without truncating", async (length) => {
    const current_pattern = `结构长度边界${"观".repeat(length - "结构长度边界".length)}`;
    expect(current_pattern).toHaveLength(length);
    await loadAiOutput({
      schema_version: "wavekb-public-analysis-v1", source_visibility: "public_books",
      instrument: "BTCUSDT", current_pattern,
    });
    const summary = screen.getByRole("region", { name: "AI 分析摘要" });
    if (length === 2000) expect(within(summary).getByText(current_pattern)).toBeDefined();
    else expect(summary.textContent).not.toContain("结构长度边界");
    vi.unstubAllGlobals();
  });

  it.each([
    ["private path", "/Users/private/book.pdf"],
    ["remote URL", "https://private.example/source"],
    ["file URL", "file:///tmp/theory.pdf"],
    ["bidirectional control", "\u202e"],
    ["ASCII control", "\u0001"],
  ])("rejects a long current-pattern string with a %s beyond the old display limit", async (_kind, suffix) => {
    const prefix = "不应显示的结构观察：" + "可见图形不代表已验证行情。".repeat(20);
    expect(prefix.length).toBeGreaterThan(180);
    const current_pattern = prefix + suffix;
    expect(current_pattern.length).toBeLessThanOrEqual(2000);
    await loadAiOutput({
      schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research",
      instrument: "BTCUSDT", current_pattern,
    });
    const summary = screen.getByRole("region", { name: "AI 分析摘要" });
    expect(summary.textContent).not.toContain("不应显示的结构观察");
    expect(document.body.textContent).not.toContain(suffix);
    vi.unstubAllGlobals();
  });

  it.each([
    ["instrument", 180], ["instrument", 181],
    ["timeframe", 180], ["timeframe", 181],
    ["analysis_level", 180], ["analysis_level", 181],
    ["current_subwave", 180], ["current_subwave", 181],
  ] as const)("preserves the short-field limit for %s at %i characters", async (field, length) => {
    const marker = `短字段边界${field}`;
    const value = marker + "值".repeat(length - marker.length);
    expect(value).toHaveLength(length);
    await loadAiOutput({
      schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research",
      current_pattern: "安全的结构观察仍然可见。", [field]: value,
    });
    const summary = screen.getByRole("region", { name: "AI 分析摘要" });
    if (length === 180) expect(within(summary).getByText(value)).toBeDefined();
    else expect(summary.textContent).not.toContain(marker);
    vi.unstubAllGlobals();
  });

  it.each([
    { schema_version: "wavekb-public-analysis-v999", source_visibility: "private_research" },
    { schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research " },
    { schema_version: "wavekb-public-analysis-v1", source_visibility: "unknown" },
    { schema_version: undefined, source_visibility: "private_research" },
  ])("does not expose longer summaries through an unsupported contract %j", async (contract) => {
    const current_pattern = "不支持契约的结构观察" + "观".repeat(200);
    await loadAiOutput({ ...contract, instrument: "不支持契约的品种", current_pattern });
    expect(screen.queryByRole("region", { name: "AI 分析摘要" })).toBeNull();
    expect(document.body.textContent).not.toContain("不支持契约的结构观察");
    expect(document.body.textContent).not.toContain("不支持契约的品种");
    vi.unstubAllGlobals();
  });

  it("keeps the legacy unversioned current-pattern display at 180 characters", async () => {
    await loadAiOutput({ instrument: "BTCUSDT", current_pattern: "旧契约长结构观察" + "观".repeat(180) });
    const summary = screen.getByRole("region", { name: "AI 分析摘要" });
    expect(within(summary).getByText("BTCUSDT")).toBeDefined();
    expect(summary.textContent).not.toContain("旧契约长结构观察");
    vi.unstubAllGlobals();
  });

  it("renders a validated wave chart only inside the public analysis contract", async () => {
    const wave_chart = buildWaveChart({ instrument: "BTCUSDT", primary_timeframe: "4小时", step_data: { "4": { chart_data: chartInput } } }, { step: 4 });
    await loadAiOutput({ schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research", wave_chart });
    expect(screen.getByRole("heading", { name: "波浪分析图" })).toBeDefined();
    expect(screen.getByText("用户提供历史价格")).toBeDefined();
    expect(screen.getByRole("img")).toBeDefined();
    expect(screen.queryByText("原始 JSON 诊断")).toBeNull();
    vi.unstubAllGlobals();
  });

  it.each([undefined, "wavekb-public-analysis-v0"])("does not render a shape-valid chart from raw or unsupported model output %s", async (schema_version) => {
    const wave_chart = buildWaveChart({ instrument: "BTCUSDT", primary_timeframe: "4小时", step_data: { "4": { chart_data: chartInput } } }, { step: 4 });
    await loadAiOutput({ schema_version, source_visibility: "private_research", wave_chart });
    expect(screen.queryByRole("heading", { name: "波浪分析图" })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("refuses unsafe chart fields without displaying private paths or raw markup", async () => {
    await loadAiOutput({ schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research", wave_chart: { schema_version: "wavekb-wave-chart-v1", instrument: "/Users/private/book.pdf", raw_svg: "<script>alert(1)</script>" } });
    expect(screen.getByText(/暂无可用图表数据/)).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("/Users/private/book.pdf")).toBeNull();
    expect(screen.queryByText("<script>alert(1)</script>")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows approved private analysis basis without citations or private output diagnostics", async () => {
    await loadAiOutput({
      schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research", instrument: "BTCUSDT",
      knowledge_version: artifactVersion, citations: [publicCitation],
      analysis_basis: [{ kind: "hypothesis", summary: "可能尚缺最后一个子浪。", conditions: ["末端结构未完成。"], invalidations: ["突破确认位。"] }],
      local_source: { title: "私有笔记", path: "/Users/private/book.pdf", citation_id: "secret-id" },
    });
    expect(screen.getByRole("heading", { name: "分析依据" })).toBeDefined();
    expect(screen.getByText("候选假设（未验证）")).toBeDefined();
    expect(screen.getByText("可能尚缺最后一个子浪。")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    expect(screen.queryByRole("link", { name: "打开知识原文" })).toBeNull();
    for (const hidden of ["公开补充书籍", "原始 JSON 诊断", "私有笔记", "/Users/private/book.pdf", "secret-id", "已复核经验"]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    vi.unstubAllGlobals();
  });

  it.each([undefined, "wavekb-public-analysis-v0"])("does not display an unversioned or unsupported private analysis contract %s", async (schema_version) => {
    await loadAiOutput({
      schema_version, source_visibility: "private_research", instrument: "应隐藏的摘要",
      knowledge_version: artifactVersion, citations: [publicCitation],
      analysis_basis: [{ kind: "structure", summary: "应隐藏的依据", conditions: [], invalidations: [] }],
    });
    expect(screen.queryByText("应隐藏的摘要")).toBeNull();
    expect(screen.queryByText("应隐藏的依据")).toBeNull();
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps the existing four-book citation contract in public mode", async () => {
    await loadAiOutput({
      knowledge_version: artifactVersion, citations: [publicCitation], instrument: "BTCUSDT",
    });
    expect(screen.getByRole("heading", { name: "本次知识依据" })).toBeDefined();
    expect(screen.getByText("公开补充书籍")).toBeDefined();
    expect(screen.getByRole("link", { name: "打开知识原文" }).getAttribute("href")).toBe(publicCitation.href);
    expect(screen.queryByText("原始 JSON 诊断")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("refuses explicit unknown source policies and hides source paths in summaries and errors", async () => {
    await loadAiOutput({
      schema_version: "wavekb-public-analysis-v1", source_visibility: "private_research ",
      knowledge_version: artifactVersion, citations: [publicCitation], instrument: "/Users/private/book.pdf",
      analysis_basis: [{ kind: "structure", summary: "不可信政策依据", conditions: [], invalidations: [] }],
    }, "读取 /Users/private/book.pdf 失败");
    expect(screen.queryByRole("region", { name: "AI 分析摘要" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "本次知识依据" })).toBeNull();
    expect(screen.queryByText("不可信政策依据")).toBeNull();
    expect(screen.queryByText("读取 /Users/private/book.pdf 失败")).toBeNull();
    expect(screen.getByText("AI 任务暂时不可用，请稍后刷新状态。")).toBeDefined();
    vi.unstubAllGlobals();
  });
});
