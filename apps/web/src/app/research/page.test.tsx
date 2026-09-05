import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ResearchPage from "./page";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tline/server", () => ({ readResearchDirectory: read }));

const state = { lastSuccess: "2026-09-05T11:55:00.000Z", watermark: "2026-09-05T11:50:00.000Z", lastAttempt: "2026-09-05T11:50:00.000Z", errorCode: null, retryAt: null };
function result(overrides: Record<string, unknown> = {}) {
  return {
    initialized: true,
    delayed: false,
    data: Array.from({ length: 30 }, (_, index) => ({ id: String(index), title: { zh: `黄金 ${index}` }, institution: { slug: "bank", name: "机构" } })),
    institutions: [{ slug: "bank", name: "机构" }],
    institutionOptions: [{ slug: "bank", name: "机构" }],
    total: 65, available: 65, page: 2, pages: 3,
    query: { q: "黄金", institution: "bank", page: 2 },
    window: { since: "2026-08-29T11:55:00.000Z", until: "2026-09-05T11:55:00.000Z" },
    state,
    ...overrides,
  };
}

afterEach(() => { cleanup(); vi.useRealTimers(); read.mockReset(); });

it("renders local DB rows and preserves both window bounds and filters in controls and links", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  read.mockResolvedValue(result());
  render(await ResearchPage({ searchParams: Promise.resolve({ since: "2026-08-29T11:55:00.000Z", until: "2026-09-05T11:55:00.000Z", page: "2", q: "黄金", institution: "bank" }) }));

  expect(screen.getAllByRole("article")).toHaveLength(30);
  expect(screen.getByText(/每 10 分钟/)).toBeTruthy();
  expect(screen.getByText(/最近成功同步/)).toBeTruthy();
  expect(screen.queryByText(/全文分析/)).toBeNull();
  const next = new URL(screen.getByRole("link", { name: "下一页研报" }).getAttribute("href")!, "http://localhost");
  expect(Object.fromEntries(next.searchParams)).toEqual({ since: "2026-08-29T11:55:00.000Z", until: "2026-09-05T11:55:00.000Z", q: "黄金", institution: "bank", page: "3" });
  const previous = new URL(screen.getByRole("link", { name: "上一页研报" }).getAttribute("href")!, "http://localhost");
  expect(previous.searchParams.get("until")).toBe("2026-09-05T11:55:00.000Z");
  const refresh = new URL(screen.getByRole("link", { name: "刷新列表" }).getAttribute("href")!, "http://localhost");
  expect(Object.fromEntries(refresh.searchParams)).toEqual({ since: "2026-08-29T11:55:00.000Z", until: "2026-09-05T11:55:00.000Z", q: "黄金", institution: "bank", page: "2" });
  expect((screen.getByRole("searchbox", { name: "搜索研报内容" }) as HTMLInputElement).value).toBe("黄金");
  expect(document.querySelector<HTMLInputElement>('input[name="until"]')?.value).toBe("2026-09-05T11:55:00.000Z");
});

it("remounts edited filter controls when navigation changes the query", async () => {
  read.mockResolvedValueOnce(result()).mockResolvedValueOnce(result({
    data: [], total: 0, available: 0, page: 1, pages: 1, institutionOptions: [],
    query: { q: "", institution: "", page: 1 },
  }));
  const rendered = render(await ResearchPage({ searchParams: Promise.resolve({ q: "黄金", institution: "bank" }) }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "已编辑内容" } });
  rendered.rerender(await ResearchPage({ searchParams: Promise.resolve({}) }));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
});

it("renders preparation separately from a successfully initialized empty catalogue", async () => {
  read.mockResolvedValueOnce(result({ initialized: false, data: [], institutions: [], institutionOptions: [], total: 0, available: 0, page: 1, pages: 1, state: { ...state, lastSuccess: null } }));
  const preparing = render(await ResearchPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("heading", { name: "研报正在准备" })).toBeTruthy();
  expect(screen.queryByRole("searchbox")).toBeNull();
  preparing.unmount();

  read.mockResolvedValueOnce(result({ data: [], institutions: [], institutionOptions: [], total: 0, available: 0, page: 1, pages: 1, query: { q: "", institution: "", page: 1 } }));
  render(await ResearchPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("heading", { name: "暂无已同步研报" })).toBeTruthy();
});

it("warns honestly when saved data is stale or the latest sync failed", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:30:01Z"));
  read.mockResolvedValue(result({ delayed: true, state: { ...state, errorCode: "network_error" } }));
  render(await ResearchPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("alert").textContent).toContain("更新延迟");
  expect(screen.getByRole("alert").textContent).toContain("已保存内容");
  expect(screen.getByRole("alert").textContent).not.toContain("network_error");
});

it("offers local recovery for an invalid or expired window", async () => {
  read.mockRejectedValue(new Error("时间窗口已过期或无效"));
  render(await ResearchPage({ searchParams: Promise.resolve({ since: "2000-01-01T00:00:00Z", until: "2000-01-08T00:00:00Z" }) }));
  expect(screen.getByRole("alert").textContent).toContain("无效");
  expect(screen.getByRole("link", { name: "重新打开研报" }).getAttribute("href")).toBe("/research");
});
