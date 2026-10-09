import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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
  it("does not expose an active JavaScript-only form before hydration", () => {
    const html = renderToString(<BookPageNavigation bookId="test" pageNumbers={pageNumbers} />);
    const markup = document.createElement("div");
    markup.innerHTML = html;
    expect(markup.querySelector<HTMLInputElement>('input[name="page"]')?.disabled).toBe(true);
    expect(markup.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(markup.querySelector('a[href="#page-1"]')?.textContent).toBe("1");
    expect(markup.textContent).toContain("仍可使用下方页码链接阅读");
    renderNavigator();
    expect((screen.getByRole("textbox", { name: "跳至页码" }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "跳转" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the actual input when a browser restores its value without a React change event", () => {
    renderNavigator();
    const input = screen.getByRole("textbox", { name: "跳至页码" }) as HTMLInputElement;
    input.value = "20";
    fireEvent.submit(screen.getByRole("button", { name: "跳转" }).closest("form")!);
    expect(window.location.hash).toBe("#page-20");
    expect(document.activeElement?.id).toBe("page-20");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["summary", "button"] as const)("keeps an already focused %s when initial hash navigation hydrates", (control) => {
    window.history.replaceState({}, "", "/knowledge/books/test?q=结构#page-57");
    const { container } = render(<section id="page-57" tabIndex={-1}>
      {control === "summary" ? <details><summary>查看原页</summary><p>原页内容</p></details> : <button type="button">放大查看</button>}
    </section>);
    const focused = container.querySelector<HTMLElement>(control)!;
    focused.focus();
    expect(document.activeElement).toBe(focused);

    render(<BookPageNavigation bookId="test" pageNumbers={[57]} />);

    expect(document.activeElement).toBe(focused);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("当前定位：第 57 页");
    expect(screen.getByRole("textbox", { name: "跳至页码" }).getAttribute("value")).toBe("57");
    expect(new URL(window.location.href).searchParams.get("q")).toBe("结构");
  });

  it("restores an initial hash target when the reader has not focused a control", () => {
    window.history.replaceState({}, "", "/knowledge/books/test?q=结构#page-20");
    expect(document.activeElement).toBe(document.body);

    renderNavigator();

    expect(document.activeElement?.id).toBe("page-20");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(screen.getByRole("status").textContent).toContain("当前定位：第 20 页");
    expect(new URL(window.location.href).searchParams.get("q")).toBe("结构");
  });

  it.each(["hashchange", "popstate"] as const)("still moves focus for explicit %s navigation", (eventType) => {
    renderNavigator();
    const input = screen.getByRole("textbox", { name: "跳至页码" });
    input.focus();
    expect(document.activeElement).toBe(input);
    window.history.replaceState({}, "", "/knowledge/books/test?q=结构#page-20");

    fireEvent(window, eventType === "hashchange" ? new HashChangeEvent("hashchange") : new PopStateEvent("popstate"));

    expect(document.activeElement?.id).toBe("page-20");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(screen.getByRole("status").textContent).toContain("当前定位：第 20 页");
    expect(screen.getByRole("textbox", { name: "跳至页码" }).getAttribute("value")).toBe("20");
    expect(new URL(window.location.href).searchParams.get("q")).toBe("结构");
  });

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
