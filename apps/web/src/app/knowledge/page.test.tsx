import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { knowledgeData } from "@wavekb/knowledge";
import { KnowledgeExplorer } from "@/components/knowledge-explorer";
import { SOURCE_BOOK_ID } from "@/lib/knowledge/book-catalog";
import KnowledgePage from "./page";

afterEach(() => cleanup());

describe("knowledge library landing page", () => {
  it("retains every migrated article and searchable source page in catalog priority order", () => {
    const view = KnowledgePage();
    const explorer = view.props.children.find((child: unknown) => isValidElement(child) && child.type === KnowledgeExplorer) as ReactElement<{ items: Array<{ id: string; href?: string; label: string }> }>;
    const items = explorer.props.items;
    const data = knowledgeData();
    const ids = new Set(items.map((item) => item.id));
    expect(ids.size).toBe(items.length);
    expect(items).toHaveLength(data.pages.length + 4 + 315 + 36 + 25);
    for (const page of data.pages) expect(ids.has(page.id)).toBe(true);
    expect(items[0].id).toBe(`book-${SOURCE_BOOK_ID}`);
    expect(items[1].href).toBe(`/knowledge/books/${SOURCE_BOOK_ID}#page-4`);
    expect(items[1].label).toBe("第11版原书文字层提取 · 未逐页核验");
    const lastOriginal = items.findIndex((item) => item.href === `/knowledge/books/${SOURCE_BOOK_ID}#page-319`);
    expect(items[lastOriginal + 1].id).toBe("book-elliott-wave-principle-tenth-edition");
    for (const book of data.library.books) for (const page of book.text_pages) {
      const found = items.find((item) => item.href === `/knowledge/books/${book.id}#page-${page.page}`);
      expect(Boolean(found)).toBe(page.extraction?.status !== "image_only");
    }
  });

  it("returns original-book text first without mislabeling it verified and retains an old Unit's real source", () => {
    render(<KnowledgePage />);
    const search = screen.getByRole("region", { name: "搜索全部知识库" });
    const input = within(search).getByRole("searchbox", { name: "搜索知识标题和正文" });
    fireEvent.change(input, { target: { value: "浪二" } });
    const first = within(search).getAllByRole("link")[0];
    expect(first.getAttribute("href")).toContain(`/knowledge/books/${SOURCE_BOOK_ID}#page-`);
    expect(first.textContent).toContain("第11版原书文字层提取 · 未逐页核验");
    expect(first.textContent).not.toContain("蒸馏生成页面");
    expect(first.textContent).not.toContain("已核验核心知识");
    fireEvent.change(input, { target: { value: "名义价格与定值价格应并行检查" } });
    const oldUnit = within(search).getByRole("link", { name: /名义价格与定值价格应并行检查/ });
    expect(oldUnit.getAttribute("href")).toBe("/knowledge/unit-ewp-method-nominal-vs-real");
    expect(oldUnit.textContent).toContain("补充与版本对照 · 第10版");
    fireEvent.change(input, { target: { value: "词汇表：双重锯齿、等同、平台、推动与驱动" } });
    const mixed = within(search).getByRole("link", { name: /词汇表：双重锯齿、等同、平台、推动与驱动/ });
    expect(mixed.getAttribute("href")).toBe("/knowledge/unit-ewp-glossary-283");
    expect(mixed.textContent).toContain("补充与版本对照 · 第11版 / 第10版");
  });

  it("keeps discovery focused on search and the four edition-aware books", () => {
    render(<KnowledgePage />);

    expect(screen.getByRole("region", { name: "搜索全部知识库" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "选择一本书" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /封面/ })).toHaveLength(4);

    expect(screen.queryByRole("navigation", { name: "知识库阅读方式" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "知识来源" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "按八大主题学习" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "按问题查答案" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "按原书章节阅读" })).toBeNull();
  });
});
