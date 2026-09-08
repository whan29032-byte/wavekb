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
  const scope: Record<string, unknown> = {
    location: { origin: "https://wavekb.com" },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    addEventListener: (type: string, handler: (event: FetchEvent & Record<string, unknown>) => void) => listeners.set(type, handler),
  };

  if (policySource) new Function("self", policySource)(scope);
  if (workerSource) new Function("self", "caches", "fetch", "importScripts", workerSource)(scope, caches, networkFetch, vi.fn());
  return { policySource, workerSource, listeners, caches, cache, networkFetch };
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
  const { listeners, caches, networkFetch } = await bootServiceWorker();
  const respondWith = vi.fn();
  networkFetch.mockRejectedValueOnce(new Error("offline"));
  caches.match.mockImplementation(async (key: unknown) => key === "/offline.html" ? { status: 200 } : undefined);

  listeners.get("fetch")?.({ request: { url: "https://wavekb.com/knowledge/unit-ewp-rule-impulse-core", method: "GET", mode: "navigate", destination: "document" }, respondWith });

  expect(respondWith).toHaveBeenCalledOnce();
  await expect(respondWith.mock.calls[0][0]).resolves.toMatchObject({ status: 200 });
  expect(networkFetch).toHaveBeenCalledOnce();
  expect(caches.match).toHaveBeenCalledWith("/offline.html");
});

it("pre-caches only the account-free offline shell", async () => {
  const { listeners, cache } = await bootServiceWorker();
  const waitUntil = vi.fn();

  listeners.get("install")?.({ waitUntil } as never);

  expect(waitUntil).toHaveBeenCalledOnce();
  await waitUntil.mock.calls[0][0];
  expect(cache.addAll).toHaveBeenCalledWith(["/offline.html"]);
});
