import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeReadingImage } from "./knowledge-reading-image";
import * as readingWorker from "@/lib/knowledge/reading-image-worker";

const source = { url: "/assets/figures-v10/page-043.png", optimizedUrl: "/assets/reading-images/page-043.webp", alt: "第10版原页摘录", width: 1191, height: 1755 };
let notify: IntersectionObserverCallback;
let target: Element;
const disconnect = vi.fn();
const observe = vi.fn((element: Element) => { target = element; });

beforeEach(() => {
  disconnect.mockClear();
  observe.mockClear();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback, public options: IntersectionObserverInit) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function enterViewport(isIntersecting = true) {
  act(() => notify([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
}

describe("knowledge reading image loading", () => {
  it("retains original source and native dimensions while deferring the real image outside the viewport", () => {
    const { container } = render(<KnowledgeReadingImage {...source} />);
    const image = screen.getByAltText(source.alt);
    expect(image.getAttribute("src")).toBe(source.url);
    expect(image.getAttribute("width")).toBe("1191");
    expect(image.getAttribute("height")).toBe("1755");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("srcset")).toBeNull();
    expect((image as HTMLImageElement).style.display).toBe("none");
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("style")).toContain("aspect-ratio: 1191 / 1755");
    enterViewport(false);
    expect((image as HTMLImageElement).style.display).toBe("none");
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("promotes only an intersecting source to a real eager image without claiming it has loaded", () => {
    const { container } = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    const image = screen.getByAltText(source.alt);
    expect(image.getAttribute("src")).toBe(source.url);
    expect(image.getAttribute("srcset")).toBe(source.optimizedUrl);
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.getAttribute("fetchpriority")).toBe("high");
    expect((image as HTMLImageElement).style.display).toBe("block");
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("loading");
    expect(screen.getByRole("status").textContent).toBe("正在载入原图…");
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.load(image);
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("loaded");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back once from a failed derivative to the original, then reports a genuine source error", () => {
    const { container } = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    const image = screen.getByAltText(source.alt);
    fireEvent.error(image);
    expect(image.getAttribute("srcset")).toBeNull();
    expect(image.getAttribute("src")).toBe(source.url);
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("loading");
    fireEvent.error(image);
    expect(screen.getByRole("status").textContent).toBe("图片加载失败，点击查看原图。");
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("error");
    expect(image.getAttribute("srcset")).toBeNull();
  });

  it("does not hide images permanently when IntersectionObserver is unsupported", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<KnowledgeReadingImage {...source} />);
    const image = screen.getByAltText(source.alt);
    await waitFor(() => expect((image as HTMLImageElement).style.display).toBe("block"));
    expect(image.getAttribute("loading")).toBe("eager");
  });

  it("fails open when a partial observer implementation throws, without a stale update after unmount", async () => {
    vi.stubGlobal("IntersectionObserver", class { constructor() { throw new Error("Unsupported observer"); } });
    const { unmount } = render(<KnowledgeReadingImage {...source} />);
    await waitFor(() => expect((screen.getByAltText(source.alt) as HTMLImageElement).style.display).toBe("block"));
    unmount();
    const discarded = render(<KnowledgeReadingImage {...source} />);
    discarded.unmount();
    await act(async () => { await Promise.resolve(); });
  });

  it("preserves a usable original source in server HTML with a no-JavaScript visibility fallback", () => {
    const html = renderToStaticMarkup(<KnowledgeReadingImage {...source} />);
    expect(html).toContain(`src="${source.url}"`);
    expect(html).not.toContain("srcSet=");
    expect(html).toContain('<noscript><style>');
    expect(html).toContain(".knowledge-reading-image > img { display: block !important; }");
    expect(html).toContain("width=\"1191\"");
  });

  it("resets request, failure, and load state when a different source replaces the image", () => {
    const { rerender, container } = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    fireEvent.load(screen.getByAltText(source.alt));
    rerender(<KnowledgeReadingImage {...source} url="/assets/figures-v10/page-047.png" />);
    const image = screen.getByAltText(source.alt);
    expect(image.getAttribute("src")).toBe("/assets/figures-v10/page-047.png");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect((image as HTMLImageElement).style.display).toBe("none");
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("waiting");
  });

  it("cancels a hidden pending native image without triggering a PNG fallback, then requests the same real source on re-entry", () => {
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { container } = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    const previous = screen.getByAltText(source.alt);
    enterViewport(false);
    const hidden = screen.getByAltText(source.alt);
    expect(hidden).not.toBe(previous);
    expect((hidden as HTMLImageElement).style.display).toBe("none");
    expect(hidden.getAttribute("loading")).toBe("lazy");
    expect(hidden.getAttribute("src")).toBe(source.url);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(source.optimizedUrl);
    fireEvent.error(previous);
    fireEvent.error(hidden);
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("waiting");
    enterViewport();
    const resumed = screen.getByAltText(source.alt);
    expect(resumed.getAttribute("srcset")).toBe(source.optimizedUrl);
    expect(resumed.getAttribute("src")).toBe(source.url);
    expect(resumed.getAttribute("width")).toBe("1191");
    expect(resumed.getAttribute("height")).toBe("1755");
    expect((resumed as HTMLImageElement).style.display).toBe("block");
    fireEvent.error(previous);
    expect(resumed.getAttribute("srcset")).toBe(source.optimizedUrl);
    fireEvent.error(resumed);
    expect(resumed.getAttribute("srcset")).toBeNull();
    fireEvent.load(resumed);
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("loaded");
  });

  it("aborts worker preparation on exit and ignores its late resolution before normal re-entry", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const ready = vi.spyOn(readingWorker, "readingImageWorkerReady").mockReturnValueOnce(pending).mockReturnValue(undefined);
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { container } = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    const signal = ready.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    enterViewport(false);
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => { finish(); await pending; });
    expect((screen.getByAltText(source.alt) as HTMLImageElement).style.display).toBe("none");
    expect(container.querySelector("[data-reading-image-state]")?.getAttribute("data-reading-image-state")).toBe("waiting");
    enterViewport();
    expect((screen.getByAltText(source.alt) as HTMLImageElement).style.display).toBe("block");
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it("does not cancel completed bytes when scrolling away, but cancels a pending request on unmount", () => {
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const first = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    fireEvent.load(screen.getByAltText(source.alt));
    enterViewport(false);
    expect(cancel).not.toHaveBeenCalled();
    expect((screen.getByAltText(source.alt) as HTMLImageElement).style.display).toBe("block");
    first.unmount();
    expect(cancel).not.toHaveBeenCalled();
    const pending = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    pending.unmount();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(source.optimizedUrl);
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
