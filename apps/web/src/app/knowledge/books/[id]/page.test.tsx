import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import KnowledgeBookDetailPage from "./page";
import { CORE_BOOK_ID } from "@/lib/knowledge/book-catalog";

afterEach(() => cleanup());

async function renderBook(id: string, section?: string) {
  return render(await KnowledgeBookDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(section ? { section } : {}),
  }));
}

describe("knowledge book reading pages", () => {
  it.each([CORE_BOOK_ID, "elliott-wave-natural-law", "chan-theory-complete"])("keeps search inside %s", async (id) => {
    await renderBook(id);

    expect(screen.getByRole("search", { name: "搜索本书" })).toBeTruthy();
    expect(screen.queryByText("已核验章节")).toBeNull();
  });

  it("moves the core book themes, questions, and chapters into a compact book index", async () => {
    const view = await renderBook(CORE_BOOK_ID);

    expect(screen.getByText("117 个已核验 Units")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "本书内容" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "本书内容" })).toBeTruthy();
    expect(screen.getByText("主题学习")).toBeTruthy();
    expect(screen.getByText("问题解答")).toBeTruthy();
    expect(screen.getByText("原书目录")).toBeTruthy();
    expect(screen.getByText("当前运动更可能是驱动浪还是调整浪？")).toBeTruthy();
    expect(view.container.querySelector("#core-themes")?.hasAttribute("open")).toBe(false);
    expect(view.container.querySelector("#core-questions")?.hasAttribute("open")).toBe(false);
    expect(view.container.querySelector("#core-chapters")?.hasAttribute("open")).toBe(false);
    expect(screen.queryByRole("heading", { name: "阅读方式" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "本书导航" })).toBeNull();
  });

  it("opens the requested core book index section from a deep link", async () => {
    const view = await renderBook(CORE_BOOK_ID, "questions");

    expect(view.container.querySelector("#core-questions")?.hasAttribute("open")).toBe(true);
    expect(view.container.querySelector("#core-themes")?.hasAttribute("open")).toBe(false);
  });

  it("labels extension navigation as generated pages and preserves its boundaries", async () => {
    await renderBook("chan-theory-complete");

    expect(screen.getByRole("heading", { name: "阅读方式" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "本书导航" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看 WaveKB 蒸馏 PDF" }).getAttribute("href")).toContain("-distilled.pdf");
    expect(screen.getByText("生成页面导航")).toBeTruthy();
    expect(screen.getByRole("link", { name: /生成 · 第 1 页/ }).getAttribute("href")).toBe("#page-1");
    expect(screen.getByRole("heading", { name: "使用边界" })).toBeTruthy();
  });
});
