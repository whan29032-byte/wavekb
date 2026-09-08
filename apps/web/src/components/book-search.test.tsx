import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BookSearch } from "./book-search";
import { buildBookReadingModel, buildLibrarySearchDocuments } from "@/lib/knowledge/book-reading";
import { knowledgeData } from "@wavekb/knowledge";

const items = [
  { id: "page-1", title: "第一章", text: "第三浪不能是最短浪。", meta: "第 1 页", href: "#page-1" },
  { id: "page-2", title: "第二章", text: "调整浪常见锯齿、平台与三角形。", meta: "第 2 页", href: "#page-2" },
];

afterEach(() => cleanup());

describe("BookSearch", () => {
  it("limits results to the current book and keeps the query in the URL", () => {
    window.history.replaceState({}, "", "/knowledge/books/test");
    render(<BookSearch bookId="test" items={items} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索本书" }), { target: { value: "第三浪" } });

    expect(screen.getByText("第一章")).toBeDefined();
    expect(screen.queryByText("第二章")).toBeNull();
    expect(new URL(window.location.href).searchParams.get("q")).toBe("第三浪");
  });

  it("matches common Chinese and Arabic wave-number aliases", () => {
    render(<BookSearch bookId="test-alias" items={items} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索本书" }), { target: { value: "第3浪" } });

    expect(screen.getByText("第一章")).toBeDefined();
  });

  it("normalizes whitespace and keeps the result list bounded", () => {
    const manyItems = Array.from({ length: 30 }, (_, index) => ({
      id: `item-${index}`,
      title: `结果 ${index}`,
      text: "唯一 查询 词",
      meta: "测试",
      href: `#item-${index}`,
    }));
    render(<BookSearch bookId="bounded" items={manyItems} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索本书" }), { target: { value: "唯一   查询 词" } });

    expect(screen.getAllByRole("link", { name: /结果/ })).toHaveLength(24);
  });

  it("includes Chan page body text in the library documents without leaking it into another book", () => {
    const data = knowledgeData();
    const chan = buildBookReadingModel("chan-theory-complete", data);
    const natural = buildBookReadingModel("elliott-wave-natural-law", data);
    if (!chan || !natural) throw new Error("Expected extension reading models");
    const chanOnlyTerm = chan.searchDocuments[0]!.text.split(/\s+/).find((term) => term.length > 5)!;
    const libraryDocuments = buildLibrarySearchDocuments(data);

    expect(libraryDocuments.find((document) => document.text.includes(chanOnlyTerm))).toMatchObject({
      id: "chan-theory-complete::page::p0001",
      bookId: "chan-theory-complete",
      href: "/knowledge/books/chan-theory-complete#page-1",
    });
    expect(natural.searchDocuments.some((document) => document.text.includes(chanOnlyTerm))).toBe(false);
  });
});
