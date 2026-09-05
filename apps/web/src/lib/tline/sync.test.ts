// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchStore } from "./store.ts";
import { syncResearch } from "./sync.ts";
import { TlineError } from "./client.ts";
import type { TlineClient } from "./client.ts";

const dirs: string[] = [];
const epoch = Date.parse("2026-09-05T00:00:00Z");
const row = (id: string) => ({ id, ingestedAt: "2026-09-04T00:00:00Z", title: "黄金" });
const client = (researchPage: TlineClient["researchPage"] = vi.fn(async () => ({ data: [row("r1")], nextCursor: null }))) => ({ institutions: vi.fn(async () => [{ slug: "bank", name: "机构" }]), researchPage });
function path() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "tline-sync-"))); dirs.push(dir); return join(dir, "research.sqlite"); }
function snapshot(file: string) { const s = new ResearchStore(file, { readOnly: true }); try { return { state: s.status(), r1: s.detail("r1"), r2: s.detail("r2") }; } finally { s.close(); } }
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }); });

it("publishes complete fixed-cursor cycles including empty middle pages and overlaps next watermark", async () => {
  const file = path(); const pages = vi.fn().mockResolvedValueOnce({ data: [row("r1")], nextCursor: "a" }).mockResolvedValueOnce({ data: [], nextCursor: "b" }).mockResolvedValueOnce({ data: [row("r2")], nextCursor: null });
  let time = epoch; const api = client(pages);
  const result = await syncResearch({ path: file, client: api, now: () => time++ });
  expect(result).toMatchObject({ status: "synced", count: 2 });
  expect(pages.mock.calls).toEqual([["2026-08-29T00:00:00.000Z", undefined], ["2026-08-29T00:00:00.000Z", "a"], ["2026-08-29T00:00:00.000Z", "b"]]);
  expect(api.institutions.mock.invocationCallOrder[0]).toBeLessThan(pages.mock.invocationCallOrder[0]);
  const next = client(); await syncResearch({ path: file, client: next, now: () => epoch + 600000 });
  expect(next.researchPage).toHaveBeenCalledWith("2026-09-04T23:50:00.000Z", undefined);
  expect(snapshot(file).r2).not.toBeNull();
});

it.each([401, 403, 429, 502])("keeps committed reports and watermark after later-page %s with safe status", async (status) => {
  const file = path(); await syncResearch({ path: file, client: client(), now: () => epoch });
  const pages = vi.fn().mockResolvedValueOnce({ data: [row("r2")], nextCursor: "a" }).mockRejectedValueOnce(new TlineError(status, "SECRET arbitrary provider code", "SECRET raw error", status === 429 ? 3600 : undefined));
  await expect(syncResearch({ path: file, client: client(pages), now: () => epoch + 600000 })).rejects.toThrow();
  const saved = snapshot(file); expect(saved.r2).toBeNull(); expect(saved.r1).not.toBeNull(); expect(saved.state.watermark).toBe("2026-09-05T00:00:00.000Z"); expect(JSON.stringify(saved.state)).not.toContain("SECRET");
  if (status === 429) {
    const next = client(); expect(await syncResearch({ path: file, client: next, now: () => epoch + 700000 })).toMatchObject({ status: "deferred" }); expect(next.institutions).not.toHaveBeenCalled();
    expect(saved.state.retryAt).toBe("2026-09-05T01:10:00.000Z");
    expect(await syncResearch({ path: file, client: client(), now: () => epoch + 4200000 })).toMatchObject({ status: "synced" });
  } else expect(await syncResearch({ path: file, client: client(), now: () => epoch + 700000 })).toMatchObject({ status: "synced" });
});

it.each(["repeat", "unique", "records", "invalid"]) ("rejects %s incomplete cycles without publishing", async (mode) => {
  const file = path(); let calls = 0;
  const api = client(vi.fn(async () => { calls++; return { data: mode === "records" ? Array.from({ length: 201 }, (_, i) => row(`${calls}-${i}`)) : mode === "invalid" ? [{ id: "bad" }] : [], nextCursor: mode === "invalid" ? null : mode === "repeat" ? "repeat" : String(calls) }; }));
  await expect(syncResearch({ path: file, client: api, now: () => epoch })).rejects.toThrow();
  expect(calls).toBeLessThanOrEqual(50); expect(snapshot(file).state.lastSuccess).toBeNull();
});

it("does not publish injected client results after the total deadline and releases the lease", async () => {
  const file = path(); let time = epoch;
  const api = client(vi.fn(async () => { time += 480001; return { data: [row("r1")], nextCursor: null }; }));
  await expect(syncResearch({ path: file, client: api, now: () => time })).rejects.toThrow(/deadline/);
  expect(snapshot(file).r1).toBeNull(); expect(await syncResearch({ path: file, client: client(), now: () => time })).toMatchObject({ status: "synced" });
});

it("rolls back if validation work crosses the total deadline before publication", async () => {
  const file = path(); let time = epoch;
  const record = { ...row("r1"), toJSON() { time += 480001; return row("r1"); } };
  await expect(syncResearch({ path: file, client: client(vi.fn(async () => ({ data: [record], nextCursor: null }))), now: () => time })).rejects.toThrow(/deadline/);
  expect(snapshot(file).r1).toBeNull();
});

it("skips a concurrent sync before network access, while readers retain prior snapshot", async () => {
  const file = path(); await syncResearch({ path: file, client: client(), now: () => epoch });
  let resolve!: (value: { data: ReturnType<typeof row>[]; nextCursor: null }) => void;
  const pending = new Promise<{ data: ReturnType<typeof row>[]; nextCursor: null }>((r) => { resolve = r; });
  const first = syncResearch({ path: file, client: client(vi.fn(() => pending)), now: () => epoch + 600000 });
  await Promise.resolve(); const other = client();
  expect(await syncResearch({ path: file, client: other, now: () => epoch + 600000 })).toMatchObject({ status: "locked" }); expect(other.institutions).not.toHaveBeenCalled(); expect(snapshot(file).r1).not.toBeNull();
  resolve({ data: [row("r2")], nextCursor: null }); await first; expect(snapshot(file).r2).not.toBeNull();
});

it("bounds production Retry-After sleeps by the remaining total deadline", async () => {
  vi.useFakeTimers(); vi.stubEnv("TLINE_API_KEY", "test-only"); vi.setSystemTime(epoch);
  const file = path(); const fetcher = vi.fn(async () => { vi.setSystemTime(epoch + 470000); return new Response("{}", { status: 429, headers: { "Retry-After": "120" } }); });
  // Near-deadline HTTP responses must persist the full retry time, not begin an excessive sleep.
  vi.stubGlobal("fetch", fetcher);
  const run = syncResearch({ path: file }); const failed = expect(run).rejects.toThrow();
  await failed;
  expect(snapshot(file).state.retryAt).toBe("2026-09-05T00:09:50.000Z"); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("aborts production fetches at the total deadline even if their transport ignores cancellation", async () => {
  vi.useFakeTimers(); vi.stubEnv("TLINE_API_KEY", "test-only"); vi.setSystemTime(epoch);
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const file = path(); const run = syncResearch({ path: file }); const failed = expect(run).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(480001); await failed; expect(snapshot(file).state.lastSuccess).toBeNull();
});
