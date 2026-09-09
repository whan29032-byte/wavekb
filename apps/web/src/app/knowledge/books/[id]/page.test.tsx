import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import KnowledgeBookDetailPage from "./page";
import { CORE_BOOK_ID } from "@/lib/knowledge/book-catalog";

afterEach(() => cleanup());

async function renderBook(id: string) {
  render(await KnowledgeBookDetailPage({ params: Promise.resolve({ id }) }));
}

describe("knowledge book reading pages", () => {
  it.each([CORE_BOOK_ID, "elliott-wave-natural-law", "chan-theory-complete"])("renders the common reading shell for %s", async (id) => {
    await renderBook(id);

    expect(screen.getByRole("search", { name: "搜索本书" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "阅读方式" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "本书导航" })).toBeTruthy();
    expect(screen.queryByText("已核验章节")).toBeNull();
  });

  it("keeps core Units and curated routes distinct from the generated extension reading views", async () => {
    await renderBook(CORE_BOOK_ID);

    expect(screen.getByText("117 个已核验 Units")).toBeTruthy();
    expect(screen.getByRole("link", { name: "规则与指引" }).getAttribute("href")).toBe("/knowledge/core-system");
    expect(screen.getByRole("link", { name: /按原书章节/ }).getAttribute("href")).toBe("#core-chapters");
  });

  it("labels extension navigation as generated pages and preserves its boundaries", async () => {
    await renderBook("chan-theory-complete");

    expect(screen.getByRole("link", { name: "查看 WaveKB 蒸馏 PDF" }).getAttribute("href")).toContain("-distilled.pdf");
    expect(screen.getByText("生成页面导航")).toBeTruthy();
    expect(screen.getByRole("link", { name: /生成 · 第 1 页/ }).getAttribute("href")).toBe("#page-1");
    expect(screen.getByRole("heading", { name: "使用边界" })).toBeTruthy();
  });
});
