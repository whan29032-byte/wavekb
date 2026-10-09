import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeImageViewer } from "./knowledge-image-viewer";

const asset = { url: "/assets/books/sample.png", alt: "原书图5–7", width: 1296, height: 1770, caption: "图源 PDF 30 / 原书 19" };
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); document.body.style.overflow = ""; vi.unstubAllGlobals(); });

describe("knowledge image reading controls", () => {
  it("uses a full-width single image and retains dimensions, lazy loading and provenance", () => {
    const { container } = render(<KnowledgeImageViewer assets={[asset]} />);
    expect(container.querySelector("figure")?.parentElement?.className).not.toContain("sm:grid-cols-2");
    const image = screen.getByAltText(asset.alt);
    expect(image.getAttribute("width")).toBe("1296");
    expect(image.getAttribute("height")).toBe("1770");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(screen.getByText(asset.caption)).toBeTruthy();
  });

  it("focuses close, traps keyboard focus, supports zoom and restores original scroll/focus on Escape", () => {
    document.body.style.overflow = "clip";
    render(<KnowledgeImageViewer assets={[asset]} />);
    const trigger = screen.getByRole("button", { name: `放大查看：${asset.alt}` });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "关闭图片查看器" });
    const shrink = within(dialog).getByRole("button", { name: "缩小" });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(shrink);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.click(within(dialog).getByRole("button", { name: "放大" }));
    expect(within(dialog).getByRole("status").textContent).toBe("125%");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("clip");
  });

  it("falls back to the original PNG in the full viewer when its lossless delivery copy fails", () => {
    const source = { ...asset, url: "/assets/figures-v10/page-043.png" };
    render(<KnowledgeImageViewer assets={[source]} />);
    fireEvent.click(screen.getByRole("button", { name: `放大查看：${source.alt}` }));
    const dialog = screen.getByRole("dialog");
    const image = dialog.querySelector("img")!;
    expect(dialog.querySelector("source")?.getAttribute("srcset")).toMatch(/\/assets\/reading-images\/[a-f0-9]{64}\.webp$/);
    fireEvent.error(image);
    expect(dialog.querySelector("source")).toBeNull();
    expect(image.getAttribute("src")).toBe(source.url);
    expect(within(dialog).getByText("正在载入原图…")).toBeTruthy();
    fireEvent.load(image);
    expect(within(dialog).queryByText("正在载入原图…")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
