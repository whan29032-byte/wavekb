import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BookReadingLink, navigateToBookTarget, scrollToBookTarget } from "./book-reading-link";

const scrollIntoView = vi.fn();
beforeEach(() => {
  window.history.replaceState({}, "", "/knowledge/books/test?q=结构");
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("book reading links", () => {
  it("scrolls and focuses the real target while preserving the search query", () => {
    render(<><BookReadingLink href="#page-2">第二页</BookReadingLink><section id="page-2" tabIndex={-1}>目标正文</section></>);
    fireEvent.click(screen.getByRole("link", { name: "第二页" }));

    expect(document.activeElement?.id).toBe("page-2");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(window.location.hash).toBe("#page-2");
    expect(new URL(window.location.href).searchParams.get("q")).toBe("结构");
  });

  it("repositions an already selected hash without duplicating browser history", () => {
    render(<><BookReadingLink href="#page-2">第二页</BookReadingLink><section id="page-2" tabIndex={-1}>目标正文</section></>);
    fireEvent.click(screen.getByRole("link", { name: "第二页" }));
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(screen.getByRole("link", { name: "第二页" }));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("page-2");
  });

  it("opens collapsed ancestors before scrolling and focusing", () => {
    render(<details><summary>目录</summary><section id="page-2" tabIndex={-1}>目标正文</section></details>);
    expect(navigateToBookTarget("#page-2")).toBe(true);
    expect(document.querySelector("details")?.open).toBe(true);
    expect(document.activeElement?.id).toBe("page-2");
  });

  it("does not consume modified clicks or invent missing targets", () => {
    render(<><BookReadingLink href="#page-2">第二页</BookReadingLink><section id="page-2" tabIndex={-1}>目标正文</section></>);
    fireEvent.click(screen.getByRole("link", { name: "第二页" }), { ctrlKey: true });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(navigateToBookTarget("#page-404")).toBe(false);
    expect(scrollToBookTarget("#%broken")).toBe(false);
    expect(window.location.hash).toBe("");
  });
});
