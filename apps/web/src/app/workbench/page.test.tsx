import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkbenchPage from "./page";

const records = vi.hoisted(() => ({ empty: false, entryRequests: [] as unknown[][], analysisRequests: [] as unknown[][] }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: async () => ({ id: "owner" }) }));
vi.mock("@/lib/workbench/server-repository", () => ({
  listPrivateEntries: async (...args: unknown[]) => { records.entryRequests.push(args); return { page: Number(args[2] || 1), hasNext: !records.empty, items: records.empty ? [] : [{ id: "entry", kind: "journal", title: "分页日记", body: "正文", market: "crypto", instrument: "BTC", timeframe: "4小时", updated_at: "2026-09-01" }] }; },
  listWorkbenchAnalyses: async (...args: unknown[]) => { records.analysisRequests.push(args); return { page: Number(args[1] || 1), hasNext: !records.empty, items: records.empty ? [] : [{ id: "analysis", execution_status: "draft", instrument: "BTC", primary_timeframe: "4小时", updated_at: "2026-09-01" }] }; },
}));
beforeEach(() => { records.empty = false; records.entryRequests = []; records.analysisRequests = []; });
afterEach(cleanup);

describe("workbench page navigation", () => {
  it("passes independent page requests and preserves the other list's page and type filter", async () => {
    render(await WorkbenchPage({ searchParams: Promise.resolve({ type: "journal", page: "3", analysisPage: "2" }) }));
    expect(screen.getByText("分页日记")).toBeDefined();
    expect(records.entryRequests).toEqual([["owner", "journal", 3]]);
    expect(records.analysisRequests).toEqual([["owner", 2]]);
    const nextLinks = screen.getAllByRole("link", { name: "下一页" }).map((link) => link.getAttribute("href"));
    expect(nextLinks).toContain("/workbench?type=journal&page=3&analysisPage=3");
    expect(nextLinks).toContain("/workbench?type=journal&analysisPage=2&page=4");
    expect(screen.getByRole("link", { name: "复盘" }).getAttribute("href")).toBe("/workbench?type=review&analysisPage=2");
  });
  it("offers a way back on empty later pages without claiming the account has no records", async () => {
    records.empty = true;
    render(await WorkbenchPage({ searchParams: Promise.resolve({ page: "8", analysisPage: "4" }) }));
    expect(screen.getAllByRole("link", { name: "上一页" })).toHaveLength(2);
    expect(screen.getByText("本页没有私人记录")).toBeDefined();
    expect(screen.queryByText("还没有私人记录")).toBeNull();
  });
});
