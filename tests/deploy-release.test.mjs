import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const moduleUrl = new URL("../scripts/deploy-release.mjs", import.meta.url);
const api = fs.existsSync(moduleUrl) ? await import(moduleUrl.href) : {};
const sha = "b".repeat(40);
const oldSha = "a".repeat(40);

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-deploy-test-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const applicationRoot = path.join(dir, "application");
  const old = path.join(applicationRoot, "releases", "legacy-name-not-a-sha");
  fs.mkdirSync(path.join(old, "apps/web/.next/static"), { recursive: true });
  fs.writeFileSync(path.join(old, "apps/web/server.js"), "old server");
  fs.writeFileSync(path.join(old, "apps/web/.next/static/old.js"), "old static");
  fs.symlinkSync(old, path.join(applicationRoot, "current"));
  const unitFile = path.join(dir, "wavekb-next-preview.service");
  fs.writeFileSync(unitFile, "previous exact unit\n");
  const environmentFile = path.join(dir, "next-preview.env");
  fs.writeFileSync(environmentFile, "CUSTOM_KEEP=this-must-survive\nDEPLOYMENT_VERSION=" + oldSha + "\n");
  const candidate = path.join(dir, "candidate");
  fs.mkdirSync(path.join(candidate, "apps/web/.next/static"), { recursive: true });
  fs.writeFileSync(path.join(candidate, "apps/web/server.js"), "new server");
  fs.writeFileSync(path.join(candidate, "apps/web/.next/static/new.js"), "new static");
  const archive = path.join(dir, "candidate.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", candidate, "."]);
  const calls = [];
  const ownedCaches = new Map();
  let failCandidateHealth = false;
  const options = {
    applicationRoot, backupRoot: path.join(dir, "backups"), unitFile, environmentFile,
    archive, sha, runId: "123", runAttempt: "1", deployUser: "fixture", baseSha: oldSha,
    ownCache: async (directory, user) => { ownedCaches.set(directory, user); },
    service: async (command) => { calls.push(command); return command === "is-active" ? "active" : command === "is-enabled" ? "enabled" : ""; },
    health: async () => {
      const current = fs.realpathSync(path.join(applicationRoot, "current"));
      if (current === old) return { ok: true, deployment: oldSha };
      return { ok: !failCandidateHealth, deployment: sha };
    },
  };
  return { dir, old, options, calls, ownedCaches, failHealth: () => { failCandidateHealth = true; }, env: fs.readFileSync(environmentFile, "utf8") };
}

test("same-SHA attempts are immutable and never replace the running release directory", async (t) => {
  assert.equal(typeof api.activate, "function", "release transaction must exist");
  const f = fixture(t);
  const first = await api.activate(f.options);
  assert.equal(path.basename(first.releaseDir), `${sha}-123-1`);
  assert.equal(fs.readFileSync(path.join(f.old, "apps/web/server.js"), "utf8"), "old server");
  await assert.rejects(api.activate(f.options), /already exists/);
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), first.releaseDir);
  const second = await api.activate({ ...f.options, runAttempt: "2", baseSha: sha });
  assert.equal(path.basename(second.releaseDir), `${sha}-123-2`);
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

test("failed candidate health restores the exact previous link, unit and version without inferring its basename", async (t) => {
  assert.equal(typeof api.activate, "function", "release transaction must exist");
  const f = fixture(t); f.failHealth();
  await assert.rejects(api.activate(f.options), /health/);
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
  assert.equal(fs.readFileSync(f.options.unitFile, "utf8"), "previous exact unit\n");
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
  assert.equal(fs.readFileSync(path.join(f.old, "apps/web/.next/static/old.js"), "utf8"), "old static");
  assert.equal(f.calls.filter((value) => value === "restart").length, 2);
});

test("acceptance rollback recovers a missing old release, including static assets, from the full backup", async (t) => {
  assert.equal(typeof api.rollback, "function", "release transaction must exist");
  const f = fixture(t);
  const result = await api.activate(f.options);
  fs.rmSync(f.old, { recursive: true });
  await api.rollback({ ...f.options, releaseId: result.releaseId });
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
  assert.equal(fs.readFileSync(path.join(f.old, "apps/web/.next/static/old.js"), "utf8"), "old static");
  assert.equal(fs.readFileSync(f.options.unitFile, "utf8"), "previous exact unit\n");
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

test("cleanup occurs only after accepted finalize and preserves current, previous and unrecognized directories", async (t) => {
  assert.equal(typeof api.finalize, "function", "release transaction must exist");
  const f = fixture(t);
  const stale = path.join(f.options.applicationRoot, "releases", `${"c".repeat(40)}-9-1`);
  fs.mkdirSync(stale); fs.utimesSync(stale, new Date(0), new Date(0));
  const other = path.join(f.options.applicationRoot, "releases", "owner-managed"); fs.mkdirSync(other);
  const result = await api.activate(f.options);
  assert.ok(fs.existsSync(stale));
  await assert.rejects(api.finalize({ ...f.options, releaseId: result.releaseId }), /acceptance/);
  await api.finalize({ ...f.options, releaseId: result.releaseId, accepted: true });
  assert.ok(!fs.existsSync(stale));
  assert.ok(fs.existsSync(f.old)); assert.ok(fs.existsSync(result.releaseDir)); assert.ok(fs.existsSync(other));
});

test("a malformed candidate never restarts or rewrites the currently running service", async (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, "candidate/apps/web/server.js"));
  execFileSync("tar", ["-czf", f.options.archive, "-C", path.join(f.dir, "candidate"), "."]);
  await assert.rejects(api.activate(f.options), /server.*missing/);
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
  assert.equal(f.calls.filter((value) => value === "restart").length, 0);
  assert.equal(fs.readFileSync(f.options.unitFile, "utf8"), "previous exact unit\n");
});

test("rollback refuses to clobber a different concurrently activated release", async (t) => {
  const f = fixture(t);
  const result = await api.activate(f.options);
  const independent = path.join(f.options.applicationRoot, "releases", "independent-operator-release");
  fs.mkdirSync(independent);
  fs.unlinkSync(path.join(f.options.applicationRoot, "current"));
  fs.symlinkSync(independent, path.join(f.options.applicationRoot, "current"));
  await assert.rejects(api.rollback({ ...f.options, releaseId: result.releaseId }), /Another release/);
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), independent);
});

test("a changed live base aborts before creating any candidate or modifying the environment", async (t) => {
  const f = fixture(t);
  await assert.rejects(api.activate({ ...f.options, baseSha: "c".repeat(40) }), /health/);
  assert.equal(fs.readdirSync(path.join(f.options.applicationRoot, "releases")).length, 1);
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

test("release startup remains executable by the service user under a restrictive sudo umask", async (t) => {
  const f = fixture(t);
  const previousUmask = process.umask(0o077);
  try {
    const result = await api.activate(f.options);
    assert.equal(fs.statSync(result.releaseDir).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(result.releaseDir, "start-release.sh")).mode & 0o777, 0o755);
    assert.ok(fs.statSync(path.join(result.releaseDir, "apps/web")).mode & 0o005, "service user can traverse archived directories");
    assert.ok(fs.statSync(path.join(result.releaseDir, "apps/web/server.js")).mode & 0o004, "service user can read archived code");
  } finally { process.umask(previousUmask); }
});

test("the non-root service can write only its separate release cache without owning source or uploads", async (t) => {
  const f = fixture(t);
  const result = await api.activate(f.options);
  const cacheLink = path.join(result.releaseDir, "apps/web/.next/cache");
  assert.ok(fs.existsSync(cacheLink), "Next image cache must be prepared before activation");
  assert.ok(fs.lstatSync(cacheLink).isSymbolicLink());
  const cache = fs.realpathSync(cacheLink);
  assert.equal(cache, path.join(f.options.applicationRoot, "runtime", result.releaseId));
  assert.equal(fs.statSync(cache).mode & 0o777, 0o750);
  // The only simulated external boundary is root's chown. Model the service's
  // non-root permission check, then perform the actual cache mkdir/write.
  function writeAsService(directory) {
    assert.equal(f.ownedCaches.get(directory), "fixture", "service has no write ownership outside its cache");
    fs.mkdirSync(path.join(directory, "images"));
    fs.writeFileSync(path.join(directory, "images", "optimized.webp"), "cached image");
  }
  writeAsService(cache);
  assert.throws(() => writeAsService(result.releaseDir), /no write ownership/);
  assert.equal(f.ownedCaches.size, 1);
  assert.equal(fs.readFileSync(path.join(cache, "images/optimized.webp"), "utf8"), "cached image");
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

test("automatic failed-job rollback leaves an already accepted release untouched", async (t) => {
  const f = fixture(t);
  const result = await api.activate(f.options);
  await api.finalize({ ...f.options, releaseId: result.releaseId, accepted: true });
  const callsBefore = f.calls.length;
  await api.rollback({ ...f.options, releaseId: result.releaseId });
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), result.releaseDir);
  assert.equal(f.calls.length, callsBefore);
});

test("explicit accepted rollback confirms the exact previous SHA and restores it even if the candidate is unhealthy", async (t) => {
  assert.equal(typeof api.rollbackAccepted, "function", "explicit accepted rollback must exist");
  const f = fixture(t);
  const result = await api.activate(f.options);
  await api.finalize({ ...f.options, releaseId: result.releaseId, accepted: true });
  f.failHealth();
  await api.rollbackAccepted({ ...f.options, releaseId: result.releaseId, confirmedPreviousVersion: oldSha });
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
  assert.equal(fs.readFileSync(f.options.unitFile, "utf8"), "previous exact unit\n");
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

test("explicit accepted rollback rejects missing or incorrect confirmation without changing the current service", async (t) => {
  assert.equal(typeof api.rollbackAccepted, "function", "explicit accepted rollback must exist");
  const f = fixture(t);
  const result = await api.activate(f.options);
  await api.finalize({ ...f.options, releaseId: result.releaseId, accepted: true });
  const callsBefore = f.calls.length;
  for (const confirmedPreviousVersion of [undefined, "c".repeat(40)]) {
    await assert.rejects(api.rollbackAccepted({ ...f.options, releaseId: result.releaseId, confirmedPreviousVersion }), /confirmation/);
  }
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), result.releaseDir);
  assert.equal(f.calls.length, callsBefore);
});

test("explicit accepted rollback requires accepted state and the exact candidate to remain current", async (t) => {
  assert.equal(typeof api.rollbackAccepted, "function", "explicit accepted rollback must exist");
  const f = fixture(t);
  const result = await api.activate(f.options);
  await assert.rejects(api.rollbackAccepted({ ...f.options, releaseId: result.releaseId, confirmedPreviousVersion: oldSha }), /accepted/);
  await api.finalize({ ...f.options, releaseId: result.releaseId, accepted: true });
  fs.unlinkSync(path.join(f.options.applicationRoot, "current"));
  fs.symlinkSync(f.old, path.join(f.options.applicationRoot, "current"));
  await assert.rejects(api.rollbackAccepted({ ...f.options, releaseId: result.releaseId, confirmedPreviousVersion: oldSha }), /exact candidate/);
});

test("an authorized manual restoration records resumable state before a restored-health failure", async (t) => {
  const f = fixture(t);
  const result = await api.activate(f.options);
  await api.finalize({ ...f.options, releaseId: result.releaseId, accepted: true });
  await assert.rejects(api.rollbackAccepted({
    ...f.options, releaseId: result.releaseId, confirmedPreviousVersion: oldSha,
    health: async () => ({ ok: false, deployment: oldSha }),
  }), /health/);
  const metadata = path.join(f.options.backupRoot, result.releaseId, "rollback.json");
  assert.equal(JSON.parse(fs.readFileSync(metadata, "utf8")).phase, "rolling-back");
  await api.rollback({ ...f.options, releaseId: result.releaseId });
  assert.equal(JSON.parse(fs.readFileSync(metadata, "utf8")).phase, "rolled-back");
  assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
});
