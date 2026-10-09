const workerWaitMs = 1200;
const deliveryPath = /^\/assets\/reading-images\/[a-f0-9]{64}\.webp$/;

/** A short first-visit opportunity, never a prerequisite for reading a source. */
export function readingImageWorkerReady(url: string | undefined, signal: AbortSignal): Promise<void> | undefined {
  if (!url || typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator) || typeof MessageChannel === "undefined") return;
  let target: URL;
  try { target = new URL(url, window.location.href); } catch { return; }
  if (target.origin !== window.location.origin || target.search || target.hash || !deliveryPath.test(target.pathname)) return;
  let workers: ServiceWorkerContainer;
  let ready: Promise<ServiceWorkerRegistration>;
  let registration: PwaRegistrationWindow["__wavekbPwaRegistration"];
  try {
    const owner = window as PwaRegistrationWindow;
    registration = owner.__wavekbPwaRegistration;
    if (owner.__wavekbPwaRegistrationFailed && !registration) return;
    workers = navigator.serviceWorker;
    ready = workers.ready;
    if (typeof workers.addEventListener !== "function" || !ready || signal.aborted) return;
  } catch { return; }
  return new Promise<void>((resolve) => {
    let settled = false;
    const ports = new Set<MessagePort>();
    const attempted = new Set<ServiceWorker>();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      workers.removeEventListener("controllerchange", check);
      signal.removeEventListener("abort", finish);
      for (const port of ports) port.close();
      resolve();
    };
    const check = () => {
      if (settled) return;
      const worker = workers.controller;
      if (!worker || attempted.has(worker)) return;
      try {
        if (new URL(worker.scriptURL).href !== new URL("/sw.js", window.location.href).href) return;
        attempted.add(worker);
        // Old same-URL controllers cannot cancel an obsolete viewport request.
        const channel = new MessageChannel();
        ports.add(channel.port1);
        ports.add(channel.port2);
        channel.port1.onmessage = (event) => { if (event.data?.version === 3) finish(); };
        worker.postMessage({ type: "wavekb-reading-delivery-ready" }, [channel.port2]);
      } catch { finish(); }
    };
    const timer = setTimeout(finish, workerWaitMs);
    workers.addEventListener("controllerchange", check);
    signal.addEventListener("abort", finish, { once: true });
    void ready.then(check, finish);
    // A blocked worker exposes a permanently pending `ready`. Registration's
    // actual failure is already decisive; do not spend the remaining budget.
    void registration?.then((value) => { if (!value) finish(); }, finish);
    // The worker may have claimed this tab between the first check and listener.
    check();
  });
}

/** Cancels only an existing public image owned by this tab's current worker. */
export function cancelHiddenReadingImage(url: string | undefined): void {
  if (!url || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const target = new URL(url, window.location.href);
    if (target.origin !== window.location.origin || target.search || target.hash || !deliveryPath.test(target.pathname)) return;
    const controller = navigator.serviceWorker.controller;
    if (!controller || new URL(controller.scriptURL).href !== new URL("/sw.js", window.location.href).href) return;
    controller.postMessage({ type: "wavekb-reading-image-hidden", path: target.pathname });
  } catch { /* Unsupported workers must not make ordinary reading fail. */ }
}
import type { PwaRegistrationWindow } from "@/lib/pwa-bootstrap";
