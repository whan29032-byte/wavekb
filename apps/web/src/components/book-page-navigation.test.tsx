import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BookPageNavigation } from "./book-page-navigation";

const pageNumbers = Array.from({ length: 36 }, (_, index) => index + 1);
beforeEach(() => {
  window.history.replaceState({}, "", "/knowledge/books/test?q=结构");
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderNavigator(pages = pageNumbers) {
  return render(<><BookPageNavigation bookId="test" pageNumbers={pages} />{pages.map((page) => <section key={page} id={`page-${page}`} tabIndex={-1}>正文 {page}</section>)}</>);
}

describe("book page navigation", () => {
  it("jumps directly to an existing page and keeps the numbered window bounded", () => {
    renderNavigator();
    fireEvent.change(screen.getByRole("textbox", { name: "跳至页码" }), { target: { value: "20" } });
    fireEvent.submit(screen.getByRole("button", { name: "跳转" }).closest("form")!);

    expect(window.location.hash).toBe("#page-20");
    expect(document.activeElement?.id).toBe("page-20");
    expect(screen.getByRole("status").textContent).toContain("当前定位：第 20 页");
    expect(screen.getAllByRole("link", { name: /生成 · 第/ })).toHaveLength(7);
    expect(screen.getByRole("link", { name: "生成 · 第 20 页" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "上一页" }).getAttribute("href")).toBe("#page-19");
    expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toBe("#page-21");
  });

  it("rejects unknown and fractional page numbers without changing the location", () => {
    renderNavigator([1, 3, 5]);
    for (const value of ["2", "999", "1.5", "", "-1"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "跳至页码" }), { target: { value } });
      fireEvent.submit(screen.getByRole("button", { name: "跳转" }).closest("form")!);
      expect(screen.getByRole("alert").textContent).toContain("请输入本书已有页码");
      expect(window.location.hash).toBe("");
    }
  });

  it("restores the page target from direct links and browser history", () => {
    window.history.replaceState({}, "", "/knowledge/books/test#page-36");
    renderNavigator();
    expect(document.activeElement?.id).toBe("page-36");
    expect(screen.getByRole("textbox", { name: "跳至页码" }).getAttribute("value")).toBe("36");
    expect(screen.queryByRole("link", { name: "下一页" })).toBeNull();

    window.history.replaceState({}, "", "/knowledge/books/test#page-4");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(document.activeElement?.id).toBe("page-4");
    expect(screen.getByRole("status").textContent).toContain("第 4 页");
  });

  it("reports a missing rendered page rather than claiming a successful jump", () => {
    render(<BookPageNavigation bookId="test" pageNumbers={[1, 2]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "跳至页码" }), { target: { value: "2" } });
    fireEvent.submit(screen.getByRole("button", { name: "跳转" }).closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("未找到该页正文");
    expect(window.location.hash).toBe("");
  });
});
