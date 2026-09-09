import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import KnowledgePage from "./page";

afterEach(() => cleanup());

describe("knowledge library landing page", () => {
  it("keeps discovery focused on search and the three books", () => {
    render(<KnowledgePage />);

    expect(screen.getByRole("region", { name: "搜索全部知识库" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "选择一本书" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /封面/ })).toHaveLength(3);

    expect(screen.queryByRole("navigation", { name: "知识库阅读方式" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "知识来源" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "按八大主题学习" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "按问题查答案" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "按原书章节阅读" })).toBeNull();
  });
});
