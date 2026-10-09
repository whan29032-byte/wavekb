import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

type FetchEvent = { request: { url: string; method: string; mode: string; destination?: string }; respondWith: ReturnType<typeof vi.fn> };

async function bootServiceWorker() {
  const policySource = await readFile(join(process.cwd(), "public", "sw-policy.js"), "utf8").catch(() => "");
  const workerSource = await readFile(join(process.cwd(), "public", "sw.js"), "utf8").catch(() => "");
  const listeners = new Map<string, (event: FetchEvent & Record<string, unknown>) => void>();
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue(undefined),
  };
  const networkFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, type: "basic", clone: () => ({ ok: true }) });
  const readingFetch = vi.fn(async (request: unknown) => ({ response: await networkFetch(request), verified: false }));
  const readingHelper = { canHandle: vi.fn().mockReturnValue(false), fetch: readingFetch, cancel: vi.fn().mockReturnValue(1) };
  const importScripts = vi.fn();
  const scope: Record<string, unknown> = {
    location: { origin: "https://wavekb.com" },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    WaveKBReadingImages: readingHelper,
    addEventListener: (type: string, handler: (event: FetchEvent & Record<string, unknown>) => void) => listeners.set(type, handler),
  };

  if (policySource) new Function("self", policySource)(scope);
  if (workerSource) new Function("self", "caches", "fetch", "importScripts", workerSource)(scope, caches, networkFetch, importScripts);
  // Keep fetch-handler tests isolated; the bundled helper's real range/SHA
  // behavior is separately exercised by its own tests and real-browser tests.
  scope.WaveKBReadingImages = readingHelper;
  return { policySource, workerSource, listeners, caches, cache, networkFetch, readingFetch, readingHelper, importScripts, scope };
}

function dispatchAsset(listeners: Map<string, (event: FetchEvent & Record<string, unknown>) => void>, url = "https://wavekb.com/assets/books/cover.png") {
  const event = {
    request: { url, method: "GET", mode: "no-cors", destination: "image" },
    respondWith: vi.fn(),
    waitUntil: vi.fn(),
  };
  listeners.get("fetch")?.(event);
  return event;
}

function publicResponse(body: BodyInit) {
  const response = new Response(body, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
  // A same-origin fetch has type "basic"; constructed test Responses default
  // to "default". Keep native Response/body/clone behavior for this fixture.
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

it.each([
  ["POST", "https://wavekb.com/knowledge"],
  ["GET", "https://wavekb.com/knowledge?q=impulse"],
  ["GET", "https://cdn.wavekb.com/assets/book.png"],
  ["GET", "https://wavekb.com/api/health"],
  ["GET", "https://wavekb.com/admin/users"],
  ["GET", "https://wavekb.com/friends"],
  ["GET", "https://wavekb.com/messages/abc"],
  ["GET", "https://wavekb.com/member/profile"],
  ["GET", "https://wavekb.com/tutoring/abc"],
  ["GET", "https://wavekb.com/mentor/manage"],
  ["GET", "https://wavekb.com/mentors/public-id"],
  ["GET", "https://wavekb.com/workbench"],
  ["GET", "https://wavekb.com/login"],
])("does not intercept %s %s", async (method, url) => {
  const { listeners } = await bootServiceWorker();
  const respondWith = vi.fn();

  listeners.get("fetch")?.({ request: { url, method, mode: "navigate", destination: "document" }, respondWith });

  expect(respondWith).not.toHaveBeenCalled();
});

it("uses network-first public knowledge navigation with the static offline fallback", async () => {
  const { listeners, caches, cache, networkFetch } = await bootServiceWorker();
  const respondWith = vi.fn();
  networkFetch.mockRejectedValueOnce(new Error("offline"));
  caches.match.mockImplementation(async (key: unknown) => key === "/offline.html" ? { status: 200 } : undefined);

  listeners.get("fetch")?.({ request: { url: "https://wavekb.com/knowledge/unit-ewp-rule-impulse-core", method: "GET", mode: "navigate", destination: "document" }, respondWith });

  expect(respondWith).toHaveBeenCalledOnce();
  await expect(respondWith.mock.calls[0][0]).resolves.toMatchObject({ status: 200 });
  expect(networkFetch).toHaveBeenCalledOnce();
  expect(caches.match).toHaveBeenCalledWith("/offline.html");
  expect(caches.match).toHaveBeenCalledOnce();
  expect(cache.put).not.toHaveBeenCalled();
});

it.each(["https://wavekb.com/", "https://wavekb.com/knowledge/unit-ewp-rule-impulse-core"])("never writes navigation HTML for %s to Cache Storage", async (url) => {
  const { listeners, caches, cache, networkFetch } = await bootServiceWorker();
  const respondWith = vi.fn();

  listeners.get("fetch")?.({ request: { url, method: "GET", mode: "navigate", destination: "document" }, respondWith });

  expect(respondWith).toHaveBeenCalledOnce();
  await expect(respondWith.mock.calls[0][0]).resolves.toMatchObject({ status: 200 });
  expect(networkFetch).toHaveBeenCalledOnce();
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it("does not cache an allowlisted asset response marked private or no-store", async () => {
  const { listeners, cache, networkFetch } = await bootServiceWorker();
  networkFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    type: "basic",
    headers: { get: (name: string) => name === "cache-control" ? "private, no-store" : null },
    clone: vi.fn(),
  });

  const { respondWith, waitUntil } = dispatchAsset(listeners);

  expect(respondWith).toHaveBeenCalledOnce();
  await expect(respondWith.mock.calls[0][0]).resolves.toMatchObject({ status: 200 });
  await waitUntil.mock.calls[0][0];
  expect(cache.put).not.toHaveBeenCalled();
});

it("returns the actual network response while a cache write is still pending", async () => {
  const { listeners, cache, networkFetch } = await bootServiceWorker();
  const response = publicResponse("actual network bytes");
  networkFetch.mockResolvedValueOnce(response);
  let finishWrite!: () => void;
  cache.put.mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
  const { respondWith, waitUntil } = dispatchAsset(listeners);
  // waitUntil is registered during event dispatch, before any awaited fetch.
  expect(waitUntil).toHaveBeenCalledOnce();
  let persisted = false;
  const background = waitUntil.mock.calls[0][0] as Promise<void>;
  void background.then(() => { persisted = true; });
  try {
    const delivered = await respondWith.mock.calls[0][0] as Response;
    expect(delivered).toBe(response);
    expect(await delivered.text()).toBe("actual network bytes");
    expect(cache.put).toHaveBeenCalledOnce();
    expect(persisted).toBe(false);
  } finally {
    finishWrite?.();
    await background;
  }
  expect(persisted).toBe(true);
});

it("lets the browser read a streaming body before cache persistence consumes its final byte", async () => {
  const { listeners, cache, networkFetch } = await bootServiceWorker();
  const firstBytes = new TextEncoder().encode("first network bytes");
  let finishBody!: () => void;
  let bodyClosed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(firstBytes); finishBody = () => { if (!bodyClosed) { bodyClosed = true; controller.close(); } }; },
  });
  const response = publicResponse(body);
  networkFetch.mockResolvedValueOnce(response);
  cache.put.mockImplementationOnce(async (_request: unknown, copy: Response) => { await copy.arrayBuffer(); });
  const { respondWith, waitUntil } = dispatchAsset(listeners);
  let persisted = false;
  const background = waitUntil.mock.calls[0][0] as Promise<void>;
  void background.then(() => { persisted = true; });
  try {
    const delivered = await respondWith.mock.calls[0][0] as Response;
    expect(delivered).toBe(response);
    const reader = delivered.body!.getReader();
    expect(await reader.read()).toEqual({ done: false, value: firstBytes });
    expect(persisted).toBe(false);
    finishBody();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    await background;
    expect(persisted).toBe(true);
  } finally {
    finishBody();
    await background;
  }
});

it.each(["open", "put"] as const)("does not fail a real network response when cache %s rejects", async (operation) => {
  const { listeners, caches, cache, networkFetch } = await bootServiceWorker();
  const response = publicResponse("successful download despite unavailable storage");
  networkFetch.mockResolvedValueOnce(response);
  (operation === "open" ? caches.open : cache.put).mockRejectedValueOnce(new Error("Storage unavailable"));
  const { respondWith, waitUntil } = dispatchAsset(listeners);
  const delivered = await respondWith.mock.calls[0][0] as Response;
  expect(delivered).toBe(response);
  expect(await delivered.text()).toBe("successful download despite unavailable storage");
  await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
});

it("does not cache a failed network fetch or hide its genuine failure", async () => {
  const { listeners, caches, cache, networkFetch } = await bootServiceWorker();
  const error = new Error("Network unavailable");
  networkFetch.mockRejectedValueOnce(error);
  const { respondWith, waitUntil } = dispatchAsset(listeners);
  await expect(respondWith.mock.calls[0][0]).rejects.toBe(error);
  await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it.each([206, 404, 500])("does not cache an asset response with HTTP status %s", async (status) => {
  const { listeners, caches, cache, networkFetch } = await bootServiceWorker();
  const response = { ok: status < 400, status, type: "basic", clone: vi.fn() };
  networkFetch.mockResolvedValueOnce(response);
  const { respondWith, waitUntil } = dispatchAsset(listeners);
  await expect(respondWith.mock.calls[0][0]).resolves.toBe(response);
  await waitUntil.mock.calls[0][0];
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
  expect(response.clone).not.toHaveBeenCalled();
});

it("serves an existing asset cache hit without another fetch or write", async () => {
  const { listeners, caches, cache, networkFetch, readingFetch } = await bootServiceWorker();
  const cached = publicResponse("already cached bytes");
  caches.match.mockResolvedValueOnce(cached);
  const { respondWith, waitUntil } = dispatchAsset(listeners);
  await expect(respondWith.mock.calls[0][0]).resolves.toBe(cached);
  await waitUntil.mock.calls[0][0];
  expect(networkFetch).not.toHaveBeenCalled();
  expect(readingFetch).not.toHaveBeenCalled();
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it("retains the bundled asset policy before the reading helper without importing scripts", async () => {
  const { policySource, workerSource, importScripts } = await bootServiceWorker();
  expect(workerSource.indexOf(policySource)).toBeGreaterThan(0);
  expect(workerSource.indexOf("scope.WaveKBReadingImages =")).toBeGreaterThan(workerSource.indexOf(policySource));
  expect(importScripts).not.toHaveBeenCalled();
});

it("acknowledges only its public reading capability without fetching or accessing caches", async () => {
  const { listeners, caches, cache, networkFetch, readingHelper } = await bootServiceWorker();
  const postMessage = vi.fn();
  listeners.get("message")?.({ data: { type: "wavekb-reading-delivery-ready" }, ports: [{ postMessage }] } as never);
  expect(postMessage.mock.calls).toEqual([[{ version: 3 }]]);
  expect(networkFetch).not.toHaveBeenCalled();
  expect(readingHelper.canHandle).not.toHaveBeenCalled();
  expect(readingHelper.fetch).not.toHaveBeenCalled();
  expect(caches.match).not.toHaveBeenCalled();
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it.each([undefined, null, {}, { type: "other-message" }])("ignores a nonmatching capability message %j", async (data) => {
  const { listeners, networkFetch } = await bootServiceWorker();
  const postMessage = vi.fn();
  listeners.get("message")?.({ data, ports: [{ postMessage }] } as never);
  expect(postMessage).not.toHaveBeenCalled();
  expect(networkFetch).not.toHaveBeenCalled();
});

it.each([undefined, [], [{}]])("safely ignores a capability message without a usable port %j", async (ports) => {
  const { listeners } = await bootServiceWorker();
  expect(() => listeners.get("message")?.({ data: { type: "wavekb-reading-delivery-ready" }, ports } as never)).not.toThrow();
});

it.each(["canHandle", "fetch", "cancel"] as const)("does not acknowledge a missing reading helper %s capability", async (method) => {
  const { listeners, readingHelper } = await bootServiceWorker();
  Reflect.deleteProperty(readingHelper, method);
  const postMessage = vi.fn();
  listeners.get("message")?.({ data: { type: "wavekb-reading-delivery-ready" }, ports: [{ postMessage }] } as never);
  expect(postMessage).not.toHaveBeenCalled();
});

it("delivers and caches a public constructed response only after the reading helper verifies its complete bytes", async () => {
  const { listeners, cache, readingFetch, networkFetch } = await bootServiceWorker();
  const response = new Response("complete verified image bytes", {
    headers: { "cache-control": "public, max-age=31536000, immutable", "content-type": "image/webp" },
  });
  expect(response.type).toBe("default");
  readingFetch.mockResolvedValueOnce({ response, verified: true });
  const { request, respondWith, waitUntil } = dispatchAsset(listeners, `https://wavekb.com/assets/reading-images/${"a".repeat(64)}.webp`);
  const delivered = await respondWith.mock.calls[0][0] as Response;
  expect(delivered).toBe(response);
  expect(await delivered.text()).toBe("complete verified image bytes");
  await waitUntil.mock.calls[0][0];
  expect(readingFetch).toHaveBeenCalledWith(request, undefined);
  expect(networkFetch).not.toHaveBeenCalled();
  expect(cache.put).toHaveBeenCalledOnce();
  const saved = cache.put.mock.calls[0][1] as Response;
  expect(saved.status).toBe(200);
  expect(await saved.text()).toBe("complete verified image bytes");
});

it("forwards the real fetch-event client id without accepting a caller-supplied identity", async () => {
  const { listeners, readingFetch } = await bootServiceWorker();
  const event = { request: { url: "https://wavekb.com/assets/books/cover.png", method: "GET", mode: "no-cors", destination: "image" }, clientId: "actual-browser-client", respondWith: vi.fn(), waitUntil: vi.fn() };
  listeners.get("fetch")?.(event);
  await event.respondWith.mock.calls[0][0];
  await event.waitUntil.mock.calls[0][0];
  expect(readingFetch).toHaveBeenCalledWith(event.request, "actual-browser-client");
});

it.each(["/", "/login", "/account", "/knowledge/core-full-book#page-43"])("cancels only the same-origin window sender's exact public image after SPA navigation from %s", async (initialDocument) => {
  const { listeners, readingHelper, networkFetch, caches } = await bootServiceWorker();
  const path = `/assets/reading-images/${"a".repeat(64)}.webp`;
  listeners.get("message")?.({ data: { type: "wavekb-reading-image-hidden", path, clientId: "other-tab", size: 1 }, source: { id: "real-tab", type: "window", url: `https://wavekb.com${initialDocument}` } } as never);
  expect(readingHelper.cancel).toHaveBeenCalledExactlyOnceWith("real-tab", path);
  expect(networkFetch).not.toHaveBeenCalled();
  expect(caches.match).not.toHaveBeenCalled();
  expect(caches.open).not.toHaveBeenCalled();
});

it.each([
  { source: undefined },
  { source: { id: "", type: "window", url: "https://wavekb.com/knowledge" } },
  { source: { id: "tab", type: "worker", url: "https://wavekb.com/knowledge" } },
  { source: { id: "tab", type: "window", url: "https://other.example/knowledge" } },
  { source: { id: "tab", type: "window", url: "https://wavekb.com/knowledge" }, path: "/api/private" },
  { source: { id: "tab", type: "window", url: "https://wavekb.com/knowledge" }, path: `/assets/reading-images/${"a".repeat(64)}.webp?token=secret` },
])("ignores an invalid visibility cancellation %#", async ({ source, path }) => {
  const { listeners, readingHelper, networkFetch } = await bootServiceWorker();
  listeners.get("message")?.({ data: { type: "wavekb-reading-image-hidden", path: path || `/assets/reading-images/${"a".repeat(64)}.webp` }, source } as never);
  expect(readingHelper.cancel).not.toHaveBeenCalled();
  expect(networkFetch).not.toHaveBeenCalled();
});

it.each([
  { reason: "unverified bytes", verified: false, cacheControl: "public, max-age=31536000, immutable" },
  { reason: "missing public directive", verified: true, cacheControl: "max-age=31536000, immutable" },
  { reason: "private response", verified: true, cacheControl: "public, private" },
  { reason: "no-store response", verified: true, cacheControl: "public, no-store" },
  { reason: "cookie-bearing response", verified: true, cacheControl: "public", setCookie: "session=private" },
  { reason: "opaque response", verified: true, cacheControl: "public", type: "opaque" },
])("does not cache constructed reading delivery with $reason", async ({ verified, cacheControl, setCookie, type }) => {
  const { listeners, caches, cache, readingFetch } = await bootServiceWorker();
  const headers = new Headers({ "cache-control": cacheControl });
  if (setCookie) headers.set("set-cookie", setCookie);
  const response = new Response("not cache-authorized", { headers });
  if (type) Object.defineProperty(response, "type", { value: type });
  const clone = vi.spyOn(response, "clone");
  readingFetch.mockResolvedValueOnce({ response, verified });
  const { respondWith, waitUntil } = dispatchAsset(listeners, `https://wavekb.com/assets/reading-images/${"a".repeat(64)}.webp`);
  await expect(respondWith.mock.calls[0][0]).resolves.toBe(response);
  await waitUntil.mock.calls[0][0];
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
  expect(clone).not.toHaveBeenCalled();
});

it("bundles the exact public helpers without serial importScripts requests", async () => {
  const { policySource, workerSource, importScripts } = await bootServiceWorker();
  const readingSource = await readFile(join(process.cwd(), "public", "sw-reading-images.js"), "utf8");
  expect(workerSource).toContain(`/* BEGIN BUNDLED PUBLIC WORKER HELPERS */\n${policySource}\n${readingSource}\n/* END BUNDLED PUBLIC WORKER HELPERS */`);
  expect(workerSource).not.toMatch(/\bimportScripts\s*\(/);
  expect(importScripts).not.toHaveBeenCalled();
});

it("pre-caches only the exact account-free offline shell bytes without a network fetch", async () => {
  const { listeners, caches, cache, networkFetch, readingFetch, scope } = await bootServiceWorker();
  const offlineBytes = await readFile(join(process.cwd(), "public", "offline.html"));
  const waitUntil = vi.fn();

  listeners.get("install")?.({ waitUntil } as never);

  expect(waitUntil).toHaveBeenCalledOnce();
  await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  expect(caches.open).toHaveBeenCalledExactlyOnceWith("wavekb-shell-v2");
  expect(cache.put).toHaveBeenCalledOnce();
  expect(cache.put.mock.calls[0][0]).toBe("/offline.html");
  const response = cache.put.mock.calls[0][1] as Response;
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(offlineBytes);
  expect(cache.addAll).not.toHaveBeenCalled();
  expect(networkFetch).not.toHaveBeenCalled();
  expect(readingFetch).not.toHaveBeenCalled();
  expect(scope.skipWaiting).toHaveBeenCalledOnce();
});

it.each(["open", "put"] as const)("still calls skipWaiting without networking when the local offline shell cache %s rejects", async (operation) => {
  const { listeners, caches, cache, networkFetch, readingFetch, scope } = await bootServiceWorker();
  (operation === "open" ? caches.open : cache.put).mockRejectedValueOnce(new Error("Local shell storage unavailable"));
  const waitUntil = vi.fn();

  listeners.get("install")?.({ waitUntil } as never);

  expect(waitUntil).toHaveBeenCalledOnce();
  await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  expect(caches.open).toHaveBeenCalledExactlyOnceWith("wavekb-shell-v2");
  if (operation === "open") expect(cache.put).not.toHaveBeenCalled();
  else {
    expect(cache.put).toHaveBeenCalledOnce();
    expect(cache.put.mock.calls[0][0]).toBe("/offline.html");
  }
  expect(cache.addAll).not.toHaveBeenCalled();
  expect(networkFetch).not.toHaveBeenCalled();
  expect(readingFetch).not.toHaveBeenCalled();
  expect(scope.skipWaiting).toHaveBeenCalledOnce();
});
