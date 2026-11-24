import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkbenchPage from "./page";

const state = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: async () => ({ id: "owner" }) }));
vi.mock("@/lib/trading/config", () => ({ tradingWorkbenchV2Enabled: async () => state.enabled }));
vi.mock("@/components/trading-workbench-dashboard", () => ({ TradingWorkbenchDashboard: ({ actorId }: { actorId: string }) => <main data-testid="dashboard">自动复盘 {actorId}</main> }));
vi.mock("@/components/legacy-workbench-home", () => ({ LegacyWorkbenchHome: ({ actorId }: { actorId: string }) => <main data-testid="legacy">旧版私人记录 {actorId}</main> }));
afterEach(() => { cleanup(); state.enabled = true; });

describe("workbench page cutover", () => {
  it("uses the automatic dashboard when the total flag is enabled", async () => {
    render(await WorkbenchPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("dashboard").textContent).toContain("owner");
    expect(screen.queryByTestId("legacy")).toBeNull();
  });

  it("keeps the old private workbench available when the total flag is disabled", async () => {
    state.enabled = false;
    render(await WorkbenchPage({ searchParams: Promise.resolve({ type: "review" }) }));
    expect(screen.getByTestId("legacy").textContent).toContain("owner");
    expect(screen.queryByTestId("dashboard")).toBeNull();
  });
});
