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
  try {
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
        // Old controllers have the same script URL. Version 2 additionally
        // requires the worker-wide bounded image delivery, not per-image slots.
        const channel = new MessageChannel();
        ports.add(channel.port1);
        ports.add(channel.port2);
        channel.port1.onmessage = (event) => { if (event.data?.version === 2) finish(); };
        worker.postMessage({ type: "wavekb-reading-delivery-ready" }, [channel.port2]);
      } catch { finish(); }
    };
    const timer = setTimeout(finish, workerWaitMs);
    workers.addEventListener("controllerchange", check);
    signal.addEventListener("abort", finish, { once: true });
    void ready.then(check, finish);
    // The worker may have claimed this tab between the first check and listener.
    check();
  });
}
