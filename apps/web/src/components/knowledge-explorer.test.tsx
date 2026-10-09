import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { KnowledgeExplorer } from "./knowledge-explorer";

afterEach(() => cleanup());

it("keeps SSR search disabled and offers native book links until the interactive search takes over", () => {
  const ssr = new DOMParser().parseFromString(renderToString(<KnowledgeExplorer items={[]} />), "text/html");
  expect(ssr.querySelector<HTMLInputElement>('input[type="search"]')?.disabled).toBe(true);
  expect(ssr.getElementById("knowledge-search-hint")?.textContent).toContain("仍可从下方书架选择图书");
  expect(ssr.querySelector("noscript")?.textContent).toContain("图书链接仍可直接使用");
  render(<KnowledgeExplorer items={[]} />);
  expect((screen.getByRole("searchbox", { name: "搜索知识标题和正文" }) as HTMLInputElement).disabled).toBe(false);
});

it("labels distilled extension-page search results as generated instead of verified auxiliary material", () => {
  render(<KnowledgeExplorer items={[{
    id: "chan-theory-complete::page::p0001",
    title: "缠中说禅 CHM 整本文集蒸馏 · 第 1 页",
    kind: "generated",
    label: "蒸馏生成页面",
    parent: null,
    href: "/knowledge/books/chan-theory-complete#page-1",
    searchText: "只在蒸馏网页正文中出现的检索词",
  }]} />);

  fireEvent.change(screen.getByRole("searchbox", { name: "搜索知识标题和正文" }), { target: { value: "检索词" } });

  expect(screen.getByRole("link", { name: /缠中说禅.*蒸馏生成页面/ })).toBeTruthy();
  expect(screen.queryByText("已核验辅助资料")).toBeNull();
});
