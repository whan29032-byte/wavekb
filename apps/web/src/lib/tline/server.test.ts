// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readInstitutions, readResearchPage } from "./server";
const calls = vi.hoisted(() => ({ institutions: vi.fn(), page: vi.fn() }));
vi.mock("./client", async (original) => ({ ...await original<typeof import("./client")>(), TlineClient: class { institutions = calls.institutions; researchPage = calls.page; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });

it("coalesces concurrent reads and verifies institutions before accessing research", async () => {
  vi.stubEnv("TLINE_API_KEY", "test-cache-1");
  let finish!: (value: unknown[]) => void;
  calls.institutions.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  calls.page.mockResolvedValue({ data: [{ id: "real" }], nextCursor: null });
  const first = readResearchPage("2026-09-01T00:00:00Z");
  const second = readResearchPage("2026-09-01T00:00:00Z");
  expect(calls.page).not.toHaveBeenCalled();
  finish([{ slug: "bank", name: "机构" }]);
  expect((await first).data).toEqual([{ id: "real" }]); expect(await second).toEqual(await first);
  expect(calls.institutions).toHaveBeenCalledTimes(1); expect(calls.page).toHaveBeenCalledTimes(1);
});

it("does not cache rejected reads or reuse a response across credential changes", async () => {
  vi.stubEnv("TLINE_API_KEY", "test-cache-2");
  calls.institutions.mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce([{ name: "A" }]).mockResolvedValueOnce([{ name: "B" }]);
  await expect(readInstitutions()).rejects.toThrow("denied");
  expect(await readInstitutions()).toEqual([{ name: "A" }]);
  vi.stubEnv("TLINE_API_KEY", "test-cache-3");
  expect(await readInstitutions()).toEqual([{ name: "B" }]);
});

it("keeps a pending read shared beyond the TTL and starts TTL after completion", async () => {
  vi.stubEnv("TLINE_API_KEY", "test-cache-pending"); vi.useFakeTimers(); vi.setSystemTime(0);
  let finish!: (value: unknown[]) => void;
  calls.institutions.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = readInstitutions();
  vi.setSystemTime(61000);
  const second = readInstitutions();
  expect(calls.institutions).toHaveBeenCalledTimes(1);
  finish([]); await first; await second;
  vi.setSystemTime(62000); await readInstitutions();
  expect(calls.institutions).toHaveBeenCalledTimes(1);
});

it("bounds concurrent distinct research requests before hitting the upstream", async () => {
  vi.stubEnv("TLINE_API_KEY", "test-cache-cap");
  calls.institutions.mockResolvedValue([]);
  const finish: Array<(value: unknown) => void> = [];
  calls.page.mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
  const pending = ["a", "b", "c", "d"].map((cursor) => readResearchPage("2026-09-01T00:00:00Z", cursor));
  await vi.waitFor(() => expect(finish).toHaveLength(4));
  await expect(readResearchPage("2026-09-01T00:00:00Z", "e")).rejects.toMatchObject({ code: "busy", status: 429 });
  for (const resolve of finish) resolve({ data: [], nextCursor: null });
  await Promise.all(pending);
  expect(calls.page).toHaveBeenCalledTimes(4);
});
