import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelHiddenReadingImage, readingImageWorkerReady } from "./reading-image-worker";
import type { PwaRegistrationWindow } from "@/lib/pwa-bootstrap";

const url = `/assets/reading-images/${"a".repeat(64)}.webp`;
const previous = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
type Worker = { scriptURL: string; postMessage: (message: unknown, ports: Array<{ postMessage: (value: unknown) => void }>) => void };
let workers: EventTarget & { controller: Worker | null; ready: Promise<unknown> };
const worker = (path = "/sw.js", capable = true, version = 3): Worker => ({
  scriptURL: new URL(path, location.href).href,
  postMessage: vi.fn((_message, ports) => { if (capable) ports[0].postMessage({ version }); }),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("MessageChannel", class {
    port1 = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, close: vi.fn() };
    port2 = { postMessage: (value: unknown) => this.port1.onmessage?.({ data: value }), close: vi.fn() };
  });
  workers = Object.assign(new EventTarget(), { controller: null as Worker | null, ready: new Promise(() => {}) });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: workers });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as PwaRegistrationWindow).__wavekbPwaRegistration;
  delete (window as PwaRegistrationWindow).__wavekbPwaRegistrationFailed;
  if (previous) Object.defineProperty(navigator, "serviceWorker", previous);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("a bounded first-visit reading worker opportunity", () => {
  it("does not delay unsupported, insecure, original or cross-origin sources", () => {
    const signal = new AbortController().signal;
    for (const input of [undefined, "/assets/figures-v10/page-043.png", "https://external.invalid" + url, url + "?preview=1", url + "#fragment"]) {
      expect(readingImageWorkerReady(input, signal)).toBeUndefined();
    }
    vi.stubGlobal("isSecureContext", false);
    expect(readingImageWorkerReady(url, signal)).toBeUndefined();
  });

  it("confirms an already controlling worker's capability before using it", async () => {
    workers.controller = worker();
    await readingImageWorkerReady(url, new AbortController().signal);
    expect(workers.controller.postMessage).toHaveBeenCalledWith({ type: "wavekb-reading-delivery-ready" }, expect.any(Array));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves at the first real controllerchange and clears lifetime listeners", async () => {
    const remove = vi.spyOn(workers, "removeEventListener");
    const result = readingImageWorkerReady(url, new AbortController().signal);
    expect(result).toBeInstanceOf(Promise);
    workers.controller = worker();
    workers.dispatchEvent(new Event("controllerchange"));
    await result;
    expect(remove).toHaveBeenCalledWith("controllerchange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back within 1200ms if registration is blocked or never becomes ready", async () => {
    const finished = vi.fn();
    const result = readingImageWorkerReady(url, new AbortController().signal);
    void result?.then(finished);
    await vi.advanceTimersByTimeAsync(1199);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not treat an unrelated controller as the reading worker", async () => {
    workers.controller = worker("/another-worker.js");
    const result = readingImageWorkerReady(url, new AbortController().signal);
    expect(result).toBeInstanceOf(Promise);
    workers.dispatchEvent(new Event("controllerchange"));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1200);
    await result;
  });

  it("an old same-URL controller does not pass until a capable replacement really claims the tab", async () => {
    workers.controller = worker("/sw.js", true, 2);
    const finished = vi.fn();
    const result = readingImageWorkerReady(url, new AbortController().signal);
    void result?.then(finished);
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).not.toHaveBeenCalled();
    workers.controller = worker();
    workers.dispatchEvent(new Event("controllerchange"));
    await result;
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back if the browser exposes unusable worker readiness", () => {
    Object.defineProperty(workers, "ready", { get: () => { throw new Error("Worker disabled"); } });
    expect(readingImageWorkerReady(url, new AbortController().signal)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unblocks immediately when parser registration explicitly returns undefined or rejects", async () => {
    for (const registration of [Promise.resolve(undefined), Promise.reject(new Error("blocked"))]) {
      (window as PwaRegistrationWindow).__wavekbPwaRegistration = registration;
      await readingImageWorkerReady(url, new AbortController().signal);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("does not wait after a known synchronous failure, but a new pending retry still gets its bounded chance", async () => {
    const owner = window as PwaRegistrationWindow;
    owner.__wavekbPwaRegistrationFailed = true;
    expect(readingImageWorkerReady(url, new AbortController().signal)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    owner.__wavekbPwaRegistration = new Promise(() => {});
    const result = readingImageWorkerReady(url, new AbortController().signal);
    expect(result).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(1200);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("registration rejection and unmount cancellation unblock normal delivery without leaked timers", async () => {
    workers.ready = Promise.reject(new Error("Registration disabled"));
    await readingImageWorkerReady(url, new AbortController().signal);
    expect(vi.getTimerCount()).toBe(0);
    workers.ready = new Promise(() => {});
    const cancel = new AbortController();
    const result = readingImageWorkerReady(url, cancel.signal);
    cancel.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
    expect(readingImageWorkerReady(url, cancel.signal)).toBeUndefined();
  });
});

describe("hidden-image cancellation scope", () => {
  it("sends only the public hashed pathname to this tab's real root controller", () => {
    workers.controller = worker();
    cancelHiddenReadingImage(url);
    expect(workers.controller.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "wavekb-reading-image-hidden", path: url });
  });

  it("does not send original, cross-origin, query, hash or unrelated-controller targets", () => {
    const root = worker();
    workers.controller = root;
    for (const value of [undefined, "/assets/figures-v10/page-043.png", "https://external.invalid" + url, url + "?preview=1", url + "#fragment"]) cancelHiddenReadingImage(value);
    expect(root.postMessage).not.toHaveBeenCalled();
    const other = worker("/other.js");
    workers.controller = other;
    cancelHiddenReadingImage(url);
    expect(other.postMessage).not.toHaveBeenCalled();
  });
});
