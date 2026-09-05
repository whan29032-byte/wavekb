// @vitest-environment node
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchStore } from "./store";
import { LocalResearchNotFoundError, readResearch, readResearchDirectory } from "./server";

const roots: string[] = [];
const now = Date.parse("2026-09-05T12:00:00.000Z");
const lastSuccess = "2026-09-05T11:55:00.000Z";

function fixture(records = 65) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "wavekb-research-reader-"));
  roots.push(root);
  const file = join(root, "research.sqlite");
  const store = new ResearchStore(file);
  store.publish(
    [{ slug: "bank-a", name: "机构甲" }, { slug: "bank-b", name: "机构乙" }],
    Array.from({ length: records }, (_, index) => ({
      id: `r${String(index).padStart(2, "0")}`,
      title: { zh: index === 64 ? "黄金 %_\\ 策略" : `市场研报 ${index}`, en: index === 63 ? "UPPERCASE OUTLOOK" : `Report ${index}` },
      institution: { slug: index >= 63 ? "bank-b" : "bank-a" },
      ingestedAt: new Date(Date.parse("2026-09-05T11:00:00.000Z") - index * 60_000).toISOString(),
      publishedAt: "2026-09-05T00:00:00.000Z",
      analysis: { summary: { zh: index === 62 ? "跨页中文主题" : "本地摘要" } },
      assets: index === 61 ? [{ ticker: "XAUUSD", name: { zh: "黄金" } }] : [],
    })),
    "2026-09-05T11:50:00.000Z",
    lastSuccess,
  );
  store.close();
  return file;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("TLINE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network prohibited"); }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local research directory", () => {
  it("reads real SQLite pages, counts, filters, and a fixed window without network access", async () => {
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", fixture());
    const network = vi.mocked(fetch);

    const first = await readResearchDirectory({});
    const second = await readResearchDirectory({ since: first.window.since, until: first.window.until, page: "2" });
    expect(first).toMatchObject({ initialized: true, delayed: false, total: 65, available: 65, page: 1, pages: 3 });
    expect(first.data).toHaveLength(30);
    expect(second.data).toHaveLength(30);
    expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(60);
    expect(first.window).toEqual({ since: "2026-08-29T11:55:00.000Z", until: lastSuccess });
    expect(first.state.lastSuccess).toBe(lastSuccess);
    expect(first.institutionOptions).toEqual([{ slug: "bank-a", name: "机构甲" }, { slug: "bank-b", name: "机构乙" }]);

    for (const q of ["uppercase", "跨页中文", "xauusd", "%_\\"]) {
      const result = await readResearchDirectory({ since: first.window.since, until: first.window.until, q });
      expect(result.total, q).toBe(1);
    }
    const bank = await readResearchDirectory({ since: first.window.since, until: first.window.until, institution: "bank-b" });
    expect(bank.total).toBe(2);
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps pagination stable when a later sync publishes a new record", async () => {
    const file = fixture();
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", file);
    const first = await readResearchDirectory({});
    const firstIds = first.data.map((row) => row.id);

    const writer = new ResearchStore(file);
    writer.publish([], [{ id: "new", title: "后来同步", institution: { slug: "bank-a" }, ingestedAt: "2026-09-05T12:01:00.000Z" }], "2026-09-05T12:02:00.000Z", "2026-09-05T12:03:00.000Z");
    writer.close();

    const sameWindow = await readResearchDirectory({ since: first.window.since, until: first.window.until });
    expect(sameWindow.data.map((row) => row.id)).toEqual(firstIds);
    expect(sameWindow.available).toBe(65);
  });

  it("marks saved data delayed after a failed sync without exposing its code as UI text", async () => {
    const file = fixture(2);
    const writer = new ResearchStore(file);
    writer.failure("2026-09-05T11:59:00.000Z", "network_error", null);
    writer.close();
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", file);
    const result = await readResearchDirectory({});
    expect(result.delayed).toBe(true);
    expect(result.state.errorCode).toBe("network_error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates malformed filters and windows before touching the database", async () => {
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", "relative.sqlite");
    for (const params of [
      { q: ["x"] }, { q: "x".repeat(201) }, { page: "1.2" }, { since: ["x"] },
      { since: "2026-09-01T00:00:00Z", until: ["x"] }, { until: "2026-09-05T00:00:00Z" },
    ] as Array<Record<string, string | string[] | undefined>>) {
      await expect(readResearchDirectory(params)).rejects.toThrow(/无效|Invalid research filters/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not create a missing database and returns a preparation state", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "wavekb-research-missing-"));
    roots.push(root);
    const file = join(root, "missing.sqlite");
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", file);
    const result = await readResearchDirectory({});
    expect(result).toMatchObject({ initialized: false, data: [], total: 0, available: 0, page: 1, pages: 1 });
    expect(result.state.lastSuccess).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes an initialized empty catalogue from an old last-good catalogue", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "wavekb-research-states-"));
    roots.push(root);
    const emptyFile = join(root, "empty.sqlite");
    const emptyWriter = new ResearchStore(emptyFile);
    emptyWriter.publish([], [], "2026-09-05T11:50:00.000Z", lastSuccess);
    emptyWriter.close();
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", emptyFile);
    expect(await readResearchDirectory({})).toMatchObject({ initialized: true, delayed: false, data: [], total: 0, available: 0 });

    const staleFile = join(root, "stale.sqlite");
    const staleWriter = new ResearchStore(staleFile);
    staleWriter.publish([], [{ id: "saved", title: "旧但可读", ingestedAt: "2026-08-19T00:00:00.000Z" }], "2026-08-20T08:59:00.000Z", "2026-08-20T09:00:00.000Z");
    staleWriter.close();
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", staleFile);
    const stale = await readResearchDirectory({});
    expect(stale).toMatchObject({ initialized: true, delayed: true, total: 1, available: 1 });
    expect(stale.window).toEqual({ since: "2026-08-13T09:00:00.000Z", until: "2026-08-20T09:00:00.000Z" });
  });

  it("fails safely for an invalid configured database path after validating the request", async () => {
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", "relative.sqlite");
    await expect(readResearchDirectory({})).rejects.toMatchObject({ name: "LocalResearchUnavailableError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("local research detail", () => {
  it("reads saved detail repeatedly with institutions and never fetches", async () => {
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", fixture(2));
    expect((await readResearch("r01")).data.id).toBe("r01");
    expect((await readResearch("r01")).institutions).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a local 404 for absent, malformed, or unavailable details", async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "wavekb-research-no-detail-"));
    roots.push(root);
    vi.stubEnv("TLINE_RESEARCH_DB_PATH", join(root, "missing.sqlite"));
    await expect(readResearch("absent")).rejects.toBeInstanceOf(LocalResearchNotFoundError);
    await expect(readResearch(".")).rejects.toBeInstanceOf(LocalResearchNotFoundError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
