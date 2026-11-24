import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingTradeReview } from "./trading-trade-review";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const trade = {
  trade: { id: "t-exness", revision: 3, provider: "exness", connection_id: "c2", account_label: "黄金账户", account_currency: "USD", product: "cfd", symbol: "XAUUSD", native_position_id: "p77", direction: "short", opened_at: "2026-11-23T16:30:00Z", closed_at: "2026-11-23T17:30:00Z", entry_price: "2400", exit_price: "2410", quantity: "1", realized_pnl: "-10", fees: "-1", funding_or_swap: "-2", dividends: "0", net_pnl: "-13", usd_net_pnl: "-13", valuation_status: "direct", completeness: "complete", review_status: "needs_reconciliation", ai_status: "stale" },
  review: { cycle_id: "t-exness", cycle_revision: 2, reason: "原理由", plan_compliance: "partial", next_improvement: "原改进", tags: [], planned_stop_price: "2420", planned_risk_amount: "50", needs_reconciliation: true },
  provider_facts: { lot_quantity: "1", position_id: "p77", swap: "-2", account_currency: "USD" },
  reconciliation: [{ cycle_id: "old", reason: "旧周期文字", plan_compliance: "yes", next_improvement: "旧改进" }], timezone: "Asia/Shanghai",
};

describe("TradingTradeReview", () => {
  it("shows Exness facts, reconciliation and the three primary subjective fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: trade }), { status: 200 })));
    render(<TradingTradeReview tradeId="t-exness" />);
    expect(await screen.findByText("XAUUSD")).toBeTruthy();
    expect(screen.getByText(/position ID.*p77/i)).toBeTruthy();
    expect(screen.getByText(/Swap.*-2/i)).toBeTruthy();
    expect(screen.getByLabelText("交易理由")).toBeTruthy();
    expect(screen.getByLabelText("是否遵守计划")).toBeTruthy();
    expect(screen.getByLabelText("下次改进")).toBeTruthy();
    expect(screen.getByText("需要处理历史复盘冲突")).toBeTruthy();
    expect(document.body.textContent).not.toContain("raw_payload");
  });

  it("autosaves a narrow review payload and reports the saved state", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { ...trade, trade: { ...trade.trade, review_status: "saved" }, reconciliation: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ review: { ...trade.review, cycle_revision: 3, reason: "新的理由" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher); render(<TradingTradeReview tradeId="t-exness" />);
    fireEvent.change(await screen.findByLabelText("交易理由"), { target: { value: "新的理由" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const payload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(payload).toMatchObject({ expected_cycle_revision: 3, reason: "新的理由", plan_compliance: "partial", next_improvement: "原改进" });
    expect(Object.keys(payload).sort()).toEqual(["expected_cycle_revision", "next_improvement", "plan_compliance", "planned_risk_amount", "planned_stop_price", "reason", "tags"]);
    expect(screen.getByRole("status").textContent).toContain("已自动保存");
  });

  it("handles a stale cycle revision without overwriting the edited text", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: trade }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "stale_trade_cycle_revision" }), { status: 409 }));
    vi.stubGlobal("fetch", fetcher); render(<TradingTradeReview tradeId="t-exness" />);
    const reason = await screen.findByLabelText("交易理由");
    fireEvent.change(reason, { target: { value: "保留我的编辑" } });
    expect(await screen.findByText("交易数据已更新，需要重新载入事实后再保存。", {}, { timeout: 2000 })).toBeTruthy();
    expect((reason as HTMLTextAreaElement).value).toBe("保留我的编辑");
  });
});
