import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KnowledgeExplorer } from "./knowledge-explorer";

afterEach(() => cleanup());

it("labels distilled extension-page search results as generated instead of verified auxiliary material", () => {
  render(<KnowledgeExplorer items={[{
    id: "chan-theory-complete::page::p0001",
    title: "缠中说禅 CHM 整本文集蒸馏 · 第 1 页",
    kind: "generated",
    parent: null,
    href: "/knowledge/books/chan-theory-complete#page-1",
    searchText: "只在蒸馏网页正文中出现的检索词",
  }]} />);

  fireEvent.change(screen.getByRole("searchbox", { name: "搜索知识标题和正文" }), { target: { value: "检索词" } });

  expect(screen.getByRole("link", { name: /缠中说禅.*蒸馏生成页面/ })).toBeTruthy();
  expect(screen.queryByText("已核验辅助资料")).toBeNull();
});
