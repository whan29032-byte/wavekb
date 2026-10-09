import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeReadingImage } from "./knowledge-reading-image";
import * as readingWorker from "@/lib/knowledge/reading-image-worker";

const source = { url: "/assets/figures-v10/page-043.png", optimizedUrl: "/assets/reading-images/page-043.webp", alt: "第10版原页摘录", width: 1191, height: 1755 };
let notify: IntersectionObserverCallback;
let target: Element;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const disconnect = vi.fn();
const unobserve = vi.fn();
const observe = vi.fn((element: Element) => { target = element; });

beforeEach(() => {
  disconnect.mockClear();
  unobserve.mockClear();
  observe.mockClear();
  frames.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback, public options: IntersectionObserverInit) { notify = callback; }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function enterViewport(isIntersecting = true) {
  act(() => {
    notify([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    flushFrames();
  });
}

function flushFrames() {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(0);
}

function notifyImages(entries: Array<[Element, boolean]>) {
  notify(entries.map(([element, isIntersecting]) => ({ target: element, isIntersecting } as IntersectionObserverEntry)), {} as IntersectionObserver);
}

const neighbor = { ...source, url: "/assets/figures-v10/page-047.png", optimizedUrl: "/assets/reading-images/neighbor.webp", alt: "临近原页" };

function renderNeighbors() {
  const view = render(<><section id="neighbor-figure" tabIndex={-1}><KnowledgeReadingImage {...neighbor} /></section><section id="target-figure" tabIndex={-1}><KnowledgeReadingImage {...source} /></section></>);
  const nearImage = screen.getByAltText(neighbor.alt) as HTMLImageElement;
  const mainImage = screen.getByAltText(source.alt) as HTMLImageElement;
  return { ...view, nearImage, mainImage, nearFrame: nearImage.parentElement!, mainFrame: mainImage.parentElement! };
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
    act(flushFrames);
    await waitFor(() => expect((image as HTMLImageElement).style.display).toBe("block"));
    expect(image.getAttribute("loading")).toBe("eager");
  });

  it("fails open when a partial observer implementation throws, without a stale update after unmount", async () => {
    vi.stubGlobal("IntersectionObserver", class { constructor() { throw new Error("Unsupported observer"); } });
    const { unmount } = render(<KnowledgeReadingImage {...source} />);
    act(flushFrames);
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

  it("aggregates neighbor-first visibility notifications and admits the truly visible focused target first", () => {
    const ready = vi.spyOn(readingWorker, "readingImageWorkerReady").mockReturnValue(undefined);
    const { nearImage, mainImage, nearFrame, mainFrame } = renderNeighbors();
    act(() => {
      notifyImages([[nearFrame, true]]);
      document.getElementById("target-figure")!.focus();
      notifyImages([[mainFrame, true]]);
      expect(ready).not.toHaveBeenCalled();
      flushFrames();
    });
    expect(ready).toHaveBeenCalledOnce();
    expect(ready.mock.calls[0][0]).toBe(source.optimizedUrl);
    expect(mainImage.style.display).toBe("block");
    expect(nearImage.style.display).toBe("none");
    expect(mainFrame.getAttribute("data-reading-image-state")).toBe("loading");
    expect(nearFrame.getAttribute("data-reading-image-state")).toBe("waiting");
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("prioritizes a visible generic hash target regardless of neighbor IO ordering", () => {
    const { nearImage, mainImage, nearFrame, mainFrame } = renderNeighbors();
    act(() => {
      notifyImages([[nearFrame, true], [mainFrame, true]]);
      window.history.replaceState(null, "", "/#target-figure");
      window.dispatchEvent(new Event("hashchange"));
      flushFrames();
    });
    expect(mainImage.style.display).toBe("block");
    expect(nearImage.style.display).toBe("none");
  });

  it("uses actual viewport reading position rather than DOM registration or IO arrival order without an explicit target", () => {
    const { nearImage, mainImage, nearFrame, mainFrame } = renderNeighbors();
    vi.spyOn(nearFrame, "getBoundingClientRect").mockReturnValue({ top: 400, bottom: 500, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    vi.spyOn(mainFrame, "getBoundingClientRect").mockReturnValue({ top: 20, bottom: 120, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    act(() => { notifyImages([[nearFrame, true], [mainFrame, true]]); flushFrames(); });
    expect(mainImage.style.display).toBe("block"); expect(nearImage.style.display).toBe("none");
  });

  it("cancels and replaces an already revealed pending native neighbor when a visible hash target is chosen", () => {
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { nearImage: previous, mainImage, nearFrame, mainFrame } = renderNeighbors();
    act(() => { notifyImages([[nearFrame, true], [mainFrame, true]]); flushFrames(); });
    expect(previous.style.display).toBe("block"); expect(previous.getAttribute("srcset")).toBe(neighbor.optimizedUrl);
    act(() => {
      window.history.replaceState(null, "", "/#target-figure");
      window.dispatchEvent(new Event("hashchange")); flushFrames();
    });
    const hidden = screen.getByAltText(neighbor.alt) as HTMLImageElement;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(neighbor.optimizedUrl);
    expect(hidden).not.toBe(previous); expect(hidden.style.display).toBe("none");
    expect(mainImage.style.display).toBe("block"); expect(mainImage.getAttribute("srcset")).toBe(source.optimizedUrl);
    fireEvent.error(previous); fireEvent.load(previous);
    expect(nearFrame.getAttribute("data-reading-image-state")).toBe("waiting");
    expect(mainFrame.getAttribute("data-reading-image-state")).toBe("loading");
    expect(hidden.getAttribute("srcset")).toBeNull();
  });

  it("preempts and cancels a pending neighbor on explicit focus, ignores its late completion, then continues it after the target loads", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const ready = vi.spyOn(readingWorker, "readingImageWorkerReady").mockReturnValueOnce(pending).mockReturnValue(undefined);
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { nearImage: previous, mainImage, nearFrame, mainFrame } = renderNeighbors();
    act(() => { notifyImages([[nearFrame, true]]); flushFrames(); });
    const signal = ready.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    act(() => {
      document.getElementById("target-figure")!.focus();
      notifyImages([[mainFrame, true]]); flushFrames();
    });
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(neighbor.optimizedUrl);
    const hidden = screen.getByAltText(neighbor.alt) as HTMLImageElement;
    expect(hidden).not.toBe(previous);
    expect(hidden.style.display).toBe("none");
    expect(mainImage.style.display).toBe("block");
    await act(async () => { finish(); await pending; });
    fireEvent.error(previous); fireEvent.load(previous);
    expect(nearFrame.getAttribute("data-reading-image-state")).toBe("waiting");
    expect(hidden.getAttribute("srcset")).toBeNull();
    fireEvent.load(mainImage);
    act(flushFrames);
    expect(mainFrame.getAttribute("data-reading-image-state")).toBe("loaded");
    expect(hidden.style.display).toBe("block");
    expect(hidden.getAttribute("srcset")).toBe(neighbor.optimizedUrl);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps a visible active download through ordinary scrolling, and starts the next visible image only after real load", () => {
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { nearImage, mainImage, nearFrame, mainFrame } = renderNeighbors();
    vi.spyOn(nearFrame, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    const mainRect = vi.spyOn(mainFrame, "getBoundingClientRect").mockReturnValue({ top: 300, bottom: 400, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    act(() => { notifyImages([[mainFrame, true], [nearFrame, true]]); flushFrames(); });
    expect(nearImage.style.display).toBe("block"); expect(mainImage.style.display).toBe("none");
    mainRect.mockReturnValue({ top: 20, bottom: 120, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    act(() => { window.dispatchEvent(new Event("scroll")); flushFrames(); });
    expect(cancel).not.toHaveBeenCalled(); expect(mainImage.style.display).toBe("none");
    fireEvent.load(nearImage); act(flushFrames);
    expect(nearFrame.getAttribute("data-reading-image-state")).toBe("loaded");
    expect(mainImage.style.display).toBe("block");
    expect(mainFrame.getAttribute("data-reading-image-state")).toBe("loading");
  });

  it("does not let a focused offscreen image or stale hash block the visible reading position", () => {
    const { nearImage, mainImage, nearFrame, mainFrame } = renderNeighbors();
    vi.spyOn(mainFrame, "getBoundingClientRect").mockReturnValue({ top: 2000, bottom: 2100, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    act(() => {
      document.getElementById("target-figure")!.focus();
      window.history.replaceState(null, "", "/#target-figure");
      notifyImages([[mainFrame, true], [nearFrame, true]]); flushFrames();
    });
    expect(mainImage.style.display).toBe("none"); expect(nearImage.style.display).toBe("block");
  });

  it("releases an active genuine source failure so another visible image can load, without invented success", () => {
    const { nearImage, mainImage, nearFrame, mainFrame } = renderNeighbors();
    act(() => { notifyImages([[nearFrame, true], [mainFrame, true]]); flushFrames(); });
    fireEvent.error(nearImage); fireEvent.error(nearImage); act(flushFrames);
    expect(nearFrame.getAttribute("data-reading-image-state")).toBe("error");
    expect(mainImage.style.display).toBe("block");
    expect(mainFrame.getAttribute("data-reading-image-state")).toBe("loading");
  });

  it("cancels only the active uncompleted image and releases the shared observer/frame on complete unmount", () => {
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { nearFrame, mainFrame, unmount } = renderNeighbors();
    act(() => { notifyImages([[nearFrame, true], [mainFrame, true]]); flushFrames(); });
    unmount();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(neighbor.optimizedUrl);
    expect(unobserve).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    act(() => { window.dispatchEvent(new Event("hashchange")); document.body.dispatchEvent(new Event("focusin", { bubbles: true })); flushFrames(); });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses a zero-margin shared observer and still releases ownership when a partial observer cleanup throws", () => {
    let options: IntersectionObserverInit | undefined;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback, supplied: IntersectionObserverInit) { notify = callback; options = supplied; }
      observe = observe;
      unobserve() { throw new Error("Partial observer cleanup"); }
      disconnect() { throw new Error("Partial observer disconnect"); }
    });
    const cancel = vi.spyOn(readingWorker, "cancelHiddenReadingImage").mockImplementation(() => {});
    const { unmount } = render(<KnowledgeReadingImage {...source} />);
    enterViewport();
    expect(options?.rootMargin).toBe("0px");
    expect(() => unmount()).not.toThrow();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(source.optimizedUrl);
    expect(frames.size).toBe(0);
  });
});
