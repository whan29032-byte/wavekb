import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkbenchPage from "./page";

const state = vi.hoisted(() => ({ enabled: true, publicUid: 44444 }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: async () => ({ id: "owner", publicUid: state.publicUid }) }));
vi.mock("@/lib/trading/config", () => ({ tradingWorkbenchV2Enabled: async () => state.enabled }));
vi.mock("@/components/exchange-account-manager", () => ({ ExchangeAccountManager: () => null }));
vi.mock("@/components/legacy-workbench-home", () => ({ LegacyWorkbenchHome: ({ actorId }: { actorId: string }) => <main data-testid="legacy">旧版私人记录 {actorId}</main> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.enabled = true; state.publicUid = 44444; });

const workbench = {
  timezone: "Asia/Shanghai", range: "30d", status: { kind: "ready", messages: [] },
  connections: [], metrics: {}, headline_metrics: [], series: [],
  calendar: [{ local_date: "2026-11-24", trade_count: 1, net_pnl_usd: "2.50" }],
  attributions: { provider: [], account: [], symbol: [], direction: [], session: [] }, trades: [],
};

describe("workbench page cutover", () => {
  it("uses the automatic dashboard when the total flag is enabled", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ workbench }));
    render(await WorkbenchPage({ searchParams: Promise.resolve({}) }));
    expect(await screen.findByRole("heading", { name: "交易日历" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "交易工作台" })).toBeTruthy();
    expect(screen.queryByTestId("legacy")).toBeNull();
  });

  it("keeps the old private workbench available when the total flag is disabled", async () => {
    state.enabled = false;
    render(await WorkbenchPage({ searchParams: Promise.resolve({ type: "review" }) }));
    expect(screen.getByTestId("legacy").textContent).toContain("owner");
    expect(screen.queryByTestId("workbench-dashboard")).toBeNull();
  });

  it("enables the heatmap for the authenticated pilot UID", async () => {
    state.publicUid = 33333;
    vi.stubGlobal("fetch", async () => Response.json({ workbench }));
    render(await WorkbenchPage({ searchParams: Promise.resolve({}) }));
    expect(await screen.findByRole("button", { name: /2026-11-24.*2\.50/ })).toBeTruthy();
  });

  it("preserves the original calendar for other members regardless of query parameters", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ workbench }));
    const searchParams = { type: "review", uid: "33333" };
    render(await WorkbenchPage({ searchParams: Promise.resolve(searchParams) }));
    await screen.findByRole("heading", { name: "交易日历" });
    expect(screen.queryByRole("group", { name: "月度盈亏" })).toBeNull();
    expect(screen.getByText("2026-11-24")).toBeTruthy();
  });
});
