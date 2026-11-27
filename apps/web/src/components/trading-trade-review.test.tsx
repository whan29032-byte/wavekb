import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingTradeReview } from "./trading-trade-review";

const renderTradeChart = vi.hoisted(() => vi.fn());

vi.mock("./trading/openalgo-trade-chart", () => ({
  OpenAlgoTradeChart: (props: unknown) => {
    renderTradeChart(props);
    return null;
  },
}));

afterEach(() => { cleanup(); renderTradeChart.mockReset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const trade = {
  trade: { id: "t-exness", revision: 3, provider: "exness", connection_id: "c2", account_label: "黄金账户", account_currency: "USD", product: "cfd", symbol: "XAUUSD", native_position_id: "p77", direction: "short", opened_at: "2026-11-23T16:30:00Z", closed_at: "2026-11-23T17:30:00Z", entry_price: "2400", exit_price: "2410", quantity: "1", realized_pnl: "-10", fees: "-1", funding_or_swap: "-2", dividends: "0", net_pnl: "-13", usd_net_pnl: "-13", valuation_status: "direct", completeness: "complete", review_status: "needs_reconciliation", ai_status: "stale" },
  review: { cycle_id: "t-exness", cycle_revision: 2, reason: "原理由", plan_compliance: "partial", next_improvement: "原改进", tags: [], planned_stop_price: "2420", planned_risk_amount: "50", needs_reconciliation: true },
  provider_facts: { lot_quantity: "1", position_id: "p77", swap: "-2", account_currency: "USD" },
  reconciliation: [{ cycle_id: "old", reason: "旧周期文字", plan_compliance: "yes", next_improvement: "旧改进" }], timezone: "Asia/Shanghai",
};

const chart = {
  schema_version: "wavekb-trade-chart-projection-v1",
  cycle_id: "t-exness",
  cycle_revision: 3,
  provider: "exness",
  product: "cfd",
  symbol: "XAUUSD",
  native_symbol: "XAUUSDm",
  direction: "short",
  opened_at: "2026-11-23T16:30:00Z",
  closed_at: "2026-11-23T17:30:00Z",
  timeframe: "1m",
  price_type: "bid",
  range: { from: "2026-11-23T16:18:00.000Z", to: "2026-11-23T17:42:00.000Z" },
  candles: [],
  markers: [],
  chart_state: null,
  coverage: { status: "empty", source: null, fetched_at: null, gaps: [], unavailable_reason: null },
  warnings: ["empty_range"],
};

describe("TradingTradeReview", () => {
  it("shows Exness facts, reconciliation and the three primary subjective fields without mojibake", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      return url.includes("/chart?")
        ? new Response(JSON.stringify({ chart }), { status: 200 })
        : new Response(JSON.stringify({ detail: trade }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TradingTradeReview tradeId="t-exness" />);
    expect(await screen.findByText("XAUUSD")).toBeTruthy();
    expect(screen.getByText(/position ID.*p77/i)).toBeTruthy();
    expect(screen.getByText(/Swap.*-2/i)).toBeTruthy();
    expect(screen.getByLabelText("交易理由")).toBeTruthy();
    expect(screen.getByLabelText("是否遵守计划")).toBeTruthy();
    expect(screen.getByLabelText("下次改进")).toBeTruthy();
    expect(screen.getByText("需要处理历史复盘冲突")).toBeTruthy();
    const boundary = await screen.findByTestId("trade-chart-boundary");
    await waitFor(() => expect(renderTradeChart).toHaveBeenCalledWith(expect.objectContaining({ projection: chart, loading: false, loadError: null })));
    const chartCall = fetcher.mock.calls.find(([input]) => String(input).includes("/chart?"));
    const chartUrl = new URL(String(chartCall?.[0]), "https://wavekb.test");
    expect(chartUrl.searchParams.get("timeframe")).toBe("1m");
    expect(chartUrl.searchParams.get("from")).toBe("2026-11-23T16:18:00.000Z");
    expect(chartUrl.searchParams.get("to")).toBe("2026-11-23T17:42:00.000Z");
    const reviewHeading = screen.getByRole("heading", { name: "极简复盘" });
    expect(boundary.compareDocumentPosition(reviewHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toContain("raw_payload");
    expect(document.body.textContent).not.toContain("姝ｅ");
  });

  it("autosaves a narrow review payload and reports the saved state", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.includes("/chart?")) return new Response(JSON.stringify({ chart }), { status: 200 });
      if (url.endsWith("/review")) return new Response(JSON.stringify({ review: { ...trade.review, cycle_revision: 3, reason: "新的理由" } }), { status: 200 });
      return new Response(JSON.stringify({ detail: { ...trade, trade: { ...trade.trade, review_status: "saved" }, reconciliation: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher); render(<TradingTradeReview tradeId="t-exness" />);
    fireEvent.change(await screen.findByLabelText("交易理由"), { target: { value: "新的理由" } });
    await waitFor(() => expect(fetcher.mock.calls.some(([input]) => String(input).endsWith("/review"))).toBe(true), { timeout: 2000 });
    const saveCall = fetcher.mock.calls.find(([input]) => String(input).endsWith("/review"));
    const payload = JSON.parse(String(saveCall?.[1]?.body));
    expect(payload).toMatchObject({ expected_cycle_revision: 3, reason: "新的理由", plan_compliance: "partial", next_improvement: "原改进" });
    expect(Object.keys(payload).sort()).toEqual(["expected_cycle_revision", "next_improvement", "plan_compliance", "planned_risk_amount", "planned_stop_price", "reason", "tags"]);
    expect(screen.getByRole("status").textContent).toContain("已自动保存");
  });

  it("handles a stale cycle revision without overwriting the edited text", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.includes("/chart?")) return new Response(JSON.stringify({ chart }), { status: 200 });
      if (url.endsWith("/review")) return new Response(JSON.stringify({ error: "stale_trade_cycle_revision" }), { status: 409 });
      return new Response(JSON.stringify({ detail: trade }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher); render(<TradingTradeReview tradeId="t-exness" />);
    const reason = await screen.findByLabelText("交易理由");
    fireEvent.change(reason, { target: { value: "保留我的编辑" } });
    expect(await screen.findByText("交易数据已更新，需要重新载入事实后再保存。", {}, { timeout: 2000 })).toBeTruthy();
    expect((reason as HTMLTextAreaElement).value).toBe("保留我的编辑");
  });

  it("selects knowledge sources, renders grounded AI sections and never overwrites the user draft", async () => {
    const aiOutput = {
      fact_summary: ["该交易净盈亏为 -13 USD。"],
      discipline_observations: [{ observation: "用户记录了计划执行偏差。", basis: "user_statement" }],
      wave_structure_hypothesis: { status: "unknown", summary: "证据不足，结构未知。", evidence_limit: "缺少图表和连续价格数据。" },
      citations: [{ knowledge_id: "k1", book_title: "艾略特波浪理论", title: "纪律", href: "/knowledge/unit-discipline", pages: [12], snippet: "先核对规则。" }],
      next_checklist: ["复核入场前的失效条件。"],
    };
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.includes("/chart?")) return new Response(JSON.stringify({ chart }), { status: 200 });
      if (url.endsWith("/ai-review")) return new Response(JSON.stringify({ job: { id: "job-1", status: "queued" } }), { status: 202 });
      if (url.includes("/api/ai/jobs/job-1")) return new Response(JSON.stringify({ job: { id: "job-1", status: "succeeded", stale: false, output_payload: aiOutput } }), { status: 200 });
      return new Response(JSON.stringify({ detail: trade }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TradingTradeReview tradeId="t-exness" />);
    const reason = await screen.findByLabelText("交易理由") as HTMLTextAreaElement;
    expect(reason.value).toBe("原理由");
    fireEvent.change(screen.getByLabelText("知识库范围"), { target: { value: "elliott-wave-natural-law" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 AI 复盘建议" }));
    expect(await screen.findByText("证据不足，结构未知。")).toBeTruthy();
    expect(screen.getByText("复核入场前的失效条件。")).toBeTruthy();
    expect(screen.getByRole("link", { name: /纪律/ }).getAttribute("href")).toBe("/knowledge/unit-discipline");
    expect(reason.value).toBe("原理由");
    const submissionCall = fetcher.mock.calls.find(([input]) => String(input).endsWith("/ai-review"));
    const submission = JSON.parse(String(submissionCall?.[1]?.body));
    expect(submission).toMatchObject({ task_type: "trade_review", cycle_revision: 3, knowledge_scope: { book_ids: ["elliott-wave-natural-law"] } });
  });
});
