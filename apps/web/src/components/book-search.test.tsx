import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BookSearch } from "./book-search";

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
});
