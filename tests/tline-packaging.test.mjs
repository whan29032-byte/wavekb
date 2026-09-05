import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ResearchStore } from "../apps/web/src/lib/tline/store.ts";

test("prepared worker runs independently of the source checkout without shipping catalogue or test fixtures", (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-worker-package-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "apps/web");
  const output = path.join(app, ".next/standalone/apps/web");
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, "server.js"), "server");
  fs.mkdirSync(path.join(app, ".next/static"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(new URL("../scripts/tline-sync.mjs", import.meta.url), path.join(root, "scripts/tline-sync.mjs"));
  fs.cpSync(new URL("../apps/web/src/lib/tline/", import.meta.url), path.join(app, "src/lib/tline"), { recursive: true });
  fs.writeFileSync(path.join(app, "src/lib/tline/research.sqlite"), "must not ship");
  const worker = path.join(output, "tline-worker");
  const stale = path.join(worker, "legacy/unlisted.txt");
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, "stale incremental-build file must not ship");
  execFileSync(process.execPath, [new URL("../apps/web/scripts/prepare-standalone.mjs", import.meta.url).pathname], { cwd: app });
  assert.ok(!fs.existsSync(stale), "repackaging must remove stale files outside the worker allowlist");
  assert.equal(fs.readFileSync(path.join(output, "server.js"), "utf8"), "server", "cleanup must preserve the sibling standalone server");
  assert.ok(fs.existsSync(path.join(worker, "cli.mjs")), "portable worker launcher must be packaged");
  const shipped = fs.readdirSync(worker, { recursive: true });
  assert.ok(!shipped.some((file) => /sqlite|test\.|e2e/.test(file)));
  const dbFile = path.join(root, "smoke.sqlite");
  const db = new ResearchStore(dbFile); db.publish([], [], "2026-09-05T00:00:00Z", "2026-09-05T00:00:01Z"); db.close();
  // Move the artifact away, then remove source: no accidental checkout imports.
  const detached = path.join(root, "detached"); fs.renameSync(worker, detached);
  fs.rmSync(path.join(root, "apps"), { recursive: true }); fs.rmSync(path.join(root, "scripts"), { recursive: true });
  const status = JSON.parse(execFileSync(process.execPath, [path.join(detached, "cli.mjs"), "status"], { env: { ...process.env, TLINE_API_KEY: "", TLINE_RESEARCH_DB_PATH: dbFile }, encoding: "utf8" }));
  assert.equal(status.lastSuccess, "2026-09-05T00:00:01Z");
});

test("fixture config rejects unmanaged external servers before creating a database", () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./apps/web/playwright.config.ts")'], { cwd: new URL("../", import.meta.url), env: { ...process.env, TLINE_E2E_FIXTURE: "1", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3999" }, encoding: "utf8" });
  assert.notEqual(run.status, 0, "fixture mode must not mutate a database without its owning server");
  assert.match(run.stderr, /fixture.*external|external.*fixture/i);
});

test("fixture publish rejects an unowned missing database instead of creating one", (t) => {
  const file = path.join(fs.realpathSync(os.tmpdir()), `wavekb-tline-e2e-unowned-${process.pid}.sqlite`);
  t.after(() => { for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true }); });
  const run = spawnSync(process.execPath, ["apps/web/scripts/start-tline-e2e.mjs", "publish", "r-refresh-unowned", "Synthetic"], { cwd: new URL("../", import.meta.url), env: { ...process.env, TLINE_E2E_DB_PATH: file, TLINE_API_KEY: "" }, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.ok(!fs.existsSync(file), "an unmanaged writer must not create a catalogue");
});
