import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkbenchPage from "./page";

vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: async () => ({ id: "owner" }) }));
vi.mock("@/components/trading-workbench-dashboard", () => ({ TradingWorkbenchDashboard: ({ actorId }: { actorId: string }) => <main data-testid="dashboard">自动复盘 {actorId}</main> }));
afterEach(cleanup);

describe("workbench page navigation", () => {
  it("uses the automatic dashboard as the default private workbench", async () => {
    render(await WorkbenchPage());
    expect(screen.getByTestId("dashboard").textContent).toContain("owner");
    expect(screen.queryByText("新建分析")).toBeNull();
    expect(screen.queryByText(/11 步/)).toBeNull();
  });
});
