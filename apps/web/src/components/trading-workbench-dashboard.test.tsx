import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingWorkbenchDashboard } from "./trading-workbench-dashboard";

vi.mock("./exchange-account-manager", () => ({ ExchangeAccountManager: () => <div>账户管理内容</div> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const body = {
  timezone: "Asia/Shanghai", range: "30d", status: { kind: "partial", messages: ["部分账户缺少美元估值"] },
  connections: [
    { id: "c1", provider: "binance", account_label: "合约账户", account_identifier_mask: "••••1001", account_currency: "USDT", status: "active" },
    { id: "c2", provider: "exness", account_label: "黄金账户", account_identifier_mask: "••••2002", account_currency: "USD", status: "active" },
  ],
  headline_metrics: [
    { key: "equity", label: "当前权益", value: "$3,080" }, { key: "profit", label: "累计净盈利", value: "$80" },
    { key: "return", label: "收益率", value: "2.6%" }, { key: "drawdown", label: "最大回撤", value: "0.7%" },
    { key: "realized", label: "已实现净盈利", value: "-$2.50" }, { key: "win_rate", label: "胜率", value: "50%" },
  ],
  series: [{ at: "2026-11-24T12:00:00Z", equity_usd: "3080", cumulative_profit_usd: "80" }],
  calendar: [{ local_date: "2026-11-24", trade_count: 2, net_pnl_usd: "-2.5" }],
  attributions: { provider: [{ key: "binance", label: "Binance", trade_count: 1, net_pnl_usd: "10.5" }], account: [], symbol: [], direction: [], session: [] },
  trades: [
    { id: "t1", revision: 1, provider: "binance", connection_id: "c1", account_label: "合约账户", account_currency: "USDT", product: "usdt_perpetual", symbol: "BTCUSDT", native_position_id: null, direction: "long", opened_at: "2026-11-23T18:00:00Z", closed_at: "2026-11-23T20:00:00Z", entry_price: "90000", exit_price: "90120", quantity: "0.1", realized_pnl: "12", fees: "-1", funding_or_swap: "-0.5", dividends: "0", net_pnl: "10.5", usd_net_pnl: "10.5", valuation_status: "approximate", completeness: "complete", review_status: "saved", ai_status: "none" },
    { id: "t2", revision: 1, provider: "exness", connection_id: "c2", account_label: "黄金账户", account_currency: "USD", product: "cfd", symbol: "XAUUSD", native_position_id: "p77", direction: "short", opened_at: "2026-11-23T16:30:00Z", closed_at: "2026-11-23T17:30:00Z", entry_price: "2400", exit_price: "2410", quantity: "1", realized_pnl: "-10", fees: "-1", funding_or_swap: "-2", dividends: "0", net_pnl: "-13", usd_net_pnl: "-13", valuation_status: "direct", completeness: "complete", review_status: "none", ai_status: "none" },
  ],
};

function response(value: unknown = body) { return Promise.resolve(new Response(JSON.stringify({ workbench: value }), { status: 200 })); }

describe("TradingWorkbenchDashboard", () => {
  it("shows exactly six headline metrics, coverage warnings, all filters and no 11-step creation CTA", async () => {
    const fetcher = vi.fn((url: string) => { void url; return response(); }); vi.stubGlobal("fetch", fetcher);
    render(<TradingWorkbenchDashboard actorId="owner" />);
    expect(await screen.findAllByTestId(/^headline-/)).toHaveLength(6);
    expect(screen.getByText("部分账户缺少美元估值")).toBeTruthy();
    expect(screen.getByLabelText("统计范围")).toBeTruthy();
    expect(screen.getByLabelText("交易平台")).toBeTruthy();
    expect(screen.getByLabelText("交易账户")).toBeTruthy();
    expect(screen.queryByText("新建分析")).toBeNull();
    expect(screen.queryByText(/11 步/)).toBeNull();
    expect(screen.getByRole("link", { name: /私人记录/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /历史分析工具/ })).toBeTruthy();
  });

  it("requeries the backend for range, provider and account filters", async () => {
    const fetcher = vi.fn((url: string) => { void url; return response(); }); vi.stubGlobal("fetch", fetcher);
    render(<TradingWorkbenchDashboard actorId="owner" />); await screen.findByText("BTCUSDT");
    fireEvent.change(screen.getByLabelText("统计范围"), { target: { value: "7d" } });
    fireEvent.change(screen.getByLabelText("交易平台"), { target: { value: "exness" } });
    fireEvent.change(screen.getByLabelText("交易账户"), { target: { value: "c2" } });
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("range=7d") && String(url).includes("providers=exness") && String(url).includes("connection_ids=c2"))).toBe(true));
  });

  it("uses native keyboard navigation for recent trades and stays fluid at 390px", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response()));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<TradingWorkbenchDashboard actorId="owner" />);
    const list = await screen.findByRole("list", { name: "最近交易周期" });
    const links = within(list).getAllByRole("link");
    links[0]!.focus(); fireEvent.keyDown(links[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    expect(screen.getByTestId("workbench-dashboard").className).not.toContain("min-w-");
  });

  it("shows signed P&L in a monthly heatmap and opens only the trades for the selected local date", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({
      ...body,
      calendar: [
        { local_date: "2026-10-31", trade_count: 1, net_pnl_usd: "4" },
        ...body.calendar,
        { local_date: "2026-11-25", trade_count: 1, net_pnl_usd: "10" },
        { local_date: "2026-11-26", trade_count: 1, net_pnl_usd: "95" },
        { local_date: "2026-11-27", trade_count: 1, net_pnl_usd: "0" },
        { local_date: "2026-11-28", trade_count: 1, net_pnl_usd: null },
      ],
      trades: [...body.trades, { ...body.trades[0], id: "t3", symbol: "ETHUSDT", closed_at: "2026-11-24T20:00:00Z" }],
    })));
    render(<TradingWorkbenchDashboard actorId="owner" pnlCalendarEnabled />);
    const calendar = await screen.findByRole("region", { name: "交易日历" });
    const byDate = (name: RegExp) => within(calendar).getByRole("button", { name });
    const loss = byDate(/2026-11-24.*-.*2\.50/);
    expect(loss.className).toContain("bg-destructive/10");
    expect(byDate(/2026-11-25.*\+.*10\.00/).className).toContain("bg-success/10");
    expect(byDate(/2026-11-26.*\+.*95\.00/).className).toContain("bg-success/30");
    expect(byDate(/2026-11-27.*0\.00/).className).not.toMatch(/bg-(success|destructive)/);
    expect(byDate(/2026-11-28.*缺少估值/).className).not.toMatch(/bg-(success|destructive)/);
    expect(byDate(/2026-11-29.*暂无记录/).className).not.toMatch(/bg-(success|destructive)/);

    fireEvent.click(loss);
    expect(loss.getAttribute("aria-pressed")).toBe("true");
    const selected = within(calendar).getByRole("list", { name: "当日交易" });
    expect(within(selected).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/workbench/trades/t1", "/workbench/trades/t2"]);
    fireEvent.click(within(calendar).getByRole("button", { name: "上一月" }));
    expect(byDate(/2026-10-31.*\+.*4\.00/)).toBeTruthy();
    expect(within(calendar).queryByRole("list", { name: "当日交易" })).toBeNull();
  });

  it("does not label a real sub-cent profit or loss as zero", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({
      ...body,
      calendar: [
        { local_date: "2026-11-23", trade_count: 1, net_pnl_usd: "-0.0001" },
        { local_date: "2026-11-24", trade_count: 1, net_pnl_usd: "0.0001" },
      ],
      trades: [{ ...body.trades[0], usd_net_pnl: "0.0001" }],
    })));
    render(<TradingWorkbenchDashboard actorId="owner" pnlCalendarEnabled />);
    const calendar = await screen.findByRole("region", { name: "交易日历" });
    const loss = within(calendar).getByRole("button", { name: /2026-11-23.*亏损不足.*0\.01/ });
    const profit = within(calendar).getByRole("button", { name: /2026-11-24.*盈利不足.*0\.01/ });
    expect(loss.textContent).toContain("−<.01");
    expect(profit.textContent).toContain("+<.01");
    fireEvent.click(loss);
    expect(within(calendar).getByText(/亏损不足.*0\.01/)).toBeTruthy();
    fireEvent.click(profit);
    expect(within(calendar).getByRole("link", { name: /BTCUSDT.*盈利不足.*0\.01/ })).toBeTruthy();
  });
});
