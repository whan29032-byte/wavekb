import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ResearchPage from "./page";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tline/server", () => ({ readResearchPage: read, readResearchCollection: read }));
afterEach(() => { cleanup(); vi.useRealTimers(); read.mockReset(); });

it("renders thirty reports and preserves since and filters while navigating forward and back", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  read.mockResolvedValue({ institutions: [], data: Array.from({ length: 65 }, (_, i) => ({ id: String(i), title: { zh: `黄金 ${i}` }, institution: { slug: "bank", name: "机构" } })) });
  render(await ResearchPage({ searchParams: Promise.resolve({ since: "2026-08-29T12:00:00Z", page: "2", q: "黄金", institution: "bank" }) }));
  const next = new URL(screen.getByRole("link", { name: "下一页研报" }).getAttribute("href")!, "http://localhost");
  expect(screen.getAllByRole("article")).toHaveLength(30);
  expect(next.pathname).toBe("/research"); expect(next.searchParams.get("since")).toBe("2026-08-29T12:00:00Z"); expect(next.searchParams.get("page")).toBe("3");
  expect(next.searchParams.get("q")).toBe("黄金"); expect(next.searchParams.get("institution")).toBe("bank");
  const previous = new URL(screen.getByRole("link", { name: "上一页研报" }).getAttribute("href")!, "http://localhost");
  expect(previous.searchParams.get("page")).toBe("1");
  expect((screen.getByRole("searchbox", { name: "搜索研报内容" }) as HTMLInputElement).value).toBe("黄金");
});

it("rejects arbitrary historical windows without contacting the paid upstream", async () => {
  render(await ResearchPage({ searchParams: Promise.resolve({ since: "2000-01-01T00:00:00Z" }) }));
  expect(screen.getByRole("alert").textContent).toContain("无效"); expect(read).not.toHaveBeenCalled();
});

it("resets edited controls when a client navigation clears the URL filters", async () => {
  read.mockResolvedValue({ institutions: [], data: [{ id: "a", title: "黄金", institution: { slug: "bank", name: "机构" } }] });
  const rendered = render(await ResearchPage({ searchParams: Promise.resolve({ q: "黄金", institution: "bank" }) }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "已编辑内容" } });
  rendered.rerender(await ResearchPage({ searchParams: Promise.resolve({}) }));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
});
