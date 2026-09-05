import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ResearchPage from "./page";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tline/server", () => ({ readResearchPage: read }));
afterEach(() => { cleanup(); vi.useRealTimers(); read.mockReset(); });

it("uses the server cursor and unchanged since in the next-page link", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  read.mockResolvedValue({ institutions: [], data: [], nextCursor: "opaque+&/=" });
  render(await ResearchPage({ searchParams: Promise.resolve({ since: "2026-08-29T12:00:00Z", cursor: "previous" }) }));
  const next = new URL(screen.getByRole("link", { name: "下一页研报" }).getAttribute("href")!, "http://localhost");
  expect(next.pathname).toBe("/research"); expect(next.searchParams.get("since")).toBe("2026-08-29T12:00:00Z"); expect(next.searchParams.get("cursor")).toBe("opaque+&/=");
});

it("rejects arbitrary historical windows without contacting the paid upstream", async () => {
  render(await ResearchPage({ searchParams: Promise.resolve({ since: "2000-01-01T00:00:00Z" }) }));
  expect(screen.getByRole("alert").textContent).toContain("无效"); expect(read).not.toHaveBeenCalled();
});
