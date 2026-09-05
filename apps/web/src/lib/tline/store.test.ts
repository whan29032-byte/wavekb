// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { ResearchStore } from "./store.ts";

const dirs: string[] = [];
const stores: ResearchStore[] = [];
const start = "2026-09-05T00:00:00Z";
const finish = "2026-09-05T00:01:00Z";
const institutions = [{ slug: "bank", name: "机构" }];
const report = (id: string, title: unknown = { zh: "黄金" }) => ({ id, title, ingestedAt: "2026-09-01T00:00:00Z", institution: { slug: "bank" } });
const query = { since: "2026-08-29T00:00:00Z", until: "2026-09-05T00:02:00Z", q: "", institution: "", page: 1 };
function file() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "tline-store-"))); dirs.push(dir); return join(dir, "research.sqlite"); }
function open(path = file(), readOnly = false) { const store = new ResearchStore(path, { readOnly }); stores.push(store); return store; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("persists raw records and start watermark after close and independent process reopen", () => {
  const path = file(); const store = open(path);
  store.publish(institutions, [report("r1")], start, finish); store.close();
  const reader = open(path, true);
  expect(reader.detail("r1")?.title).toEqual({ zh: "黄金" });
  expect(reader.status()).toEqual({ watermark: "2026-09-05T00:00:00Z", lastSuccess: "2026-09-05T00:01:00Z", lastAttempt: "2026-09-05T00:00:00Z", errorCode: null, retryAt: null });
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import {ResearchStore} from ${JSON.stringify(new URL("./store.ts", import.meta.url).href)}; const s=new ResearchStore(process.argv[1],{readOnly:true}); console.log(s.detail('r1').id); s.close();`, path], { encoding: "utf8" });
  expect(output.trim()).toBe("r1");
});

it("does not create or mutate through read-only connections", () => {
  const path = file(); expect(() => open(path, true)).toThrow();
  open(path).publish(institutions, [report("r1")], start, finish);
  const reader = open(path, true);
  expect(() => reader.publish([], [], start, finish)).toThrow();
  expect(() => reader.failure(start, "network_error", null)).toThrow();
  expect(() => reader.acquireLease("owner", 0)).toThrow();
  expect(reader.detail("r1")).not.toBeNull();
});

it("keeps full integrity scans off reader open/detail/status but rejects corruption on writer open", () => {
  const path = file(); const writer = open(path);
  writer.publish(institutions, [report("r1")], start, finish); writer.close();
  const db = new DatabaseSync(path);
  // A real constraint violation outside the requested rows: readable schema/data,
  // but the writer's whole-database integrity gate must still reject this file.
  db.exec("PRAGMA ignore_check_constraints=ON; INSERT INTO sync_state(singleton,schema_version) VALUES(2,1)"); db.close();
  const prepared = vi.spyOn(DatabaseSync.prototype, "prepare");
  try {
    const reader = open(path, true);
    expect(reader.detail("r1")?.title).toEqual({ zh: "黄金" });
    expect(reader.status().watermark).toBe(start);
    expect(prepared.mock.calls.some(([sql]) => /\b(?:quick_check|integrity_check)\b/i.test(sql))).toBe(false);
    expect(() => open(path)).toThrow("Corrupt research database");
    expect(prepared.mock.calls.some(([sql]) => /\bquick_check\b/i.test(sql))).toBe(true);
  } finally { prepared.mockRestore(); }
});

it("keeps all prior values on validation and mid-transaction write failure", () => {
  const path = file(); const store = open(path); store.publish(institutions, [report("old")], start, finish);
  const before = store.status();
  expect(() => store.publish([{ slug: "new" }], [report("new"), { id: "bad", ingestedAt: "invalid" }], start, finish)).toThrow();
  const db = new DatabaseSync(path); db.exec("CREATE TRIGGER reject_new BEFORE INSERT ON research WHEN NEW.id='new' BEGIN SELECT RAISE(ABORT, 'write failure'); END;"); db.close();
  expect(() => store.publish([{ slug: "new" }], [report("new")], start, finish)).toThrow();
  expect(store.status()).toEqual(before); expect(store.institutions()).toEqual(institutions); expect(store.detail("new")).toBeNull();
});

it.each(["%", "_", "' OR 1=1 --", "黄金 ＡＢＣ", "机构"]) ("searches %s literally with Unicode normalization and all terms", (q) => {
  const store = open(); store.publish(institutions, [report("hit", `${q} ABC 黄金`), { ...report("miss", "unrelated"), institution: { slug: "other" } }], start, finish);
  expect(store.query({ ...query, q: q === "黄金 ＡＢＣ" ? "黄金 abc" : q }).data.map((r) => r.id)).toEqual(["hit"]);
});

it("updates duplicate IDs without deleting historical reports or moving first-seen time", () => {
  const store = open(); store.publish(institutions, [report("a"), report("b"), report("a", "updated")], start, finish);
  store.publish(institutions, [report("a", "latest"), report("late")], "2026-09-05T00:03:00Z", "2026-09-05T00:04:00Z");
  expect(store.query(query).data.map((r) => r.id)).toEqual(["b", "a"]);
  expect(store.detail("a")?.title).toBe("latest"); expect(store.detail("late")).not.toBeNull();
});

it("searches the displayed institution name and excludes opaque IDs and URLs", () => {
  const store = open(); store.publish(institutions, [{ ...report("opaque-id"), institution: { slug: "bank", name: "自有名称" }, sourceUrl: "https://secret-metadata.invalid" }], start, finish);
  expect(store.query({ ...query, q: "自有" }).total).toBe(1);
  for (const q of ["机构", "opaque-id", "secret-metadata"]) expect(store.query({ ...query, q }).total).toBe(0);
});

it("rejects missing IDs, invented dates, cyclic JSON and stale-owner publications atomically", () => {
  const store = open(); store.publish(institutions, [report("old")], start, finish);
  for (const invalid of [{ ingestedAt: finish }, { ...report(" ") }, { ...report("new"), ingestedAt: undefined }]) expect(() => store.publish([], [invalid], start, finish)).toThrow();
  const cyclic: Record<string, unknown> = report("cyclic"); cyclic.analysis = cyclic;
  expect(() => store.publish([], [cyclic], start, finish)).toThrow();
  store.acquireLease("owner", Date.parse(start));
  expect(() => store.publish([], [report("new")], start, finish, "stale-owner")).toThrow(/lease/);
  expect(store.detail("new")).toBeNull(); expect(store.detail("old")).not.toBeNull();
});

it("returns stable 30-row pages and counts and institution options from committed snapshot", () => {
  const path = file(); const writer = open(path); const reader = open(path, true);
  writer.publish(institutions, Array.from({ length: 65 }, (_, i) => report(String(i).padStart(3, "0"))), start, finish);
  const first = reader.query(query); const second = reader.query({ ...query, page: 2 });
  expect(first).toMatchObject({ total: 65, available: 65, page: 1, pages: 3, institutionOptions: [{ slug: "bank", name: "机构" }] });
  expect(first.data).toHaveLength(30); expect(first.data[0].id).toBe("064"); expect(second.data[0].id).toBe("034");
  expect(reader.query({ ...query, institution: "bank", page: 99 }).data).toHaveLength(5);
  expect(reader.query({ ...query, institution: "missing" })).toMatchObject({ total: 0, available: 65, page: 1, pages: 1 });
  expect(() => reader.query({ ...query, page: 0 })).toThrow();
});

it("backs up committed WAL content into an independently readable snapshot without overwrite", () => {
  const store = open(); store.publish(institutions, [report("r1")], start, finish);
  const backup = file(); store.backupTo(backup); store.publish(institutions, [report("r2")], start, finish);
  const reader = open(backup, true); expect(reader.detail("r1")).not.toBeNull(); expect(reader.detail("r2")).toBeNull();
  expect(() => store.backupTo(backup)).toThrow();
});

it("rejects unsafe paths and corrupt or unknown schemas without repairing them", () => {
  const path = file(); expect(() => open("relative.sqlite")).toThrow(); expect(() => open(join(path, "missing", "db"))).toThrow();
  writeFileSync(path, "corrupt"); expect(() => open(path)).toThrow();
  const linked = file(); symlinkSync(path, linked); expect(() => open(linked)).toThrow();
  const parent = file(); symlinkSync(join(path, ".."), parent); expect(() => open(join(parent, "child.sqlite"))).toThrow();
  const unknown = file(); const db = new DatabaseSync(unknown); db.exec("PRAGMA user_version=99"); db.close(); expect(() => open(unknown)).toThrow();
  const sidecar = file(); symlinkSync(path, `${sidecar}-wal`); expect(() => open(sidecar)).toThrow();
});

it("enforces cross-process expiring leases and owner-safe release after crash recovery", () => {
  const path = file(); const store = open(path);
  expect(store.acquireLease("first", 1000)).toBe(true);
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import {ResearchStore} from ${JSON.stringify(new URL("./store.ts", import.meta.url).href)}; const s=new ResearchStore(process.argv[1]); console.log(s.acquireLease('second',2000)); s.close();`, path], { encoding: "utf8" });
  expect(output.trim()).toBe("false");
  const contender = open(path); expect(contender.acquireLease("second", 901000)).toBe(true);
  store.releaseLease("first"); expect(store.acquireLease("third", 902000)).toBe(false);
  contender.releaseLease("second"); expect(store.acquireLease("third", 902000)).toBe(true);
});
