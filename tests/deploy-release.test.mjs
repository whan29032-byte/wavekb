import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ResearchStore } from "../apps/web/src/lib/tline/store.ts";

const moduleUrl = new URL("../scripts/deploy-release.mjs", import.meta.url);
const api = fs.existsSync(moduleUrl) ? await import(moduleUrl.href) : {};
const sha = "b".repeat(40);
const oldSha = "a".repeat(40);

test("Tline credentials stay outside code and original env; rollback restores the exact previous unit", async (t) => {
  const f = fixture(t);
  const key = "tli_fixture_only_not_a_real_secret";
  const result = await api.activate({ ...f.options, tlineApiKey: key });
  const secretFile = path.join(f.options.backupRoot, result.releaseId, "tline.env");
  assert.ok(fs.existsSync(secretFile), "runtime secret must be provisioned outside the public release");
  assert.equal(fs.statSync(secretFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(secretFile, "utf8"), `TLINE_API_KEY=${key}\n`);
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
  const unit = fs.readFileSync(f.options.unitFile, "utf8");
  assert.ok(unit.includes(`EnvironmentFile=${secretFile}\n`));
  for (const content of [unit, fs.readFileSync(path.join(result.releaseDir, "start-release.sh"), "utf8"), fs.readFileSync(path.join(f.options.backupRoot, result.releaseId, "rollback.json"), "utf8")]) assert.ok(!content.includes(key));
  await api.rollback({ ...f.options, releaseId: result.releaseId });
  assert.equal(fs.readFileSync(f.options.unitFile, "utf8"), "previous exact unit\n");
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

test("invalid Tline environment input aborts before production mutation", async (t) => {
  const f = fixture(t);
  await assert.rejects(api.activate({ ...f.options, tlineApiKey: "tli_invalid\nOTHER=value" }), /Tline/);
  assert.equal(fs.readdirSync(path.join(f.options.applicationRoot, "releases")).length, 1);
  assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
});

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

function persistentFixture(t, prior = false) {
  const f = fixture(t);
  const worker = path.join(f.dir, "candidate/apps/web/tline-worker");
  fs.mkdirSync(worker);
  fs.writeFileSync(path.join(worker, "cli.mjs"), "fixture worker");
  execFileSync("tar", ["-czf", f.options.archive, "-C", path.join(f.dir, "candidate"), "."]);
  const units = new Map();
  const events = [];
  const data = path.join(f.options.applicationRoot, "data/tline");
  const database = path.join(data, "research.sqlite");
  for (const name of ["service", "timer"]) {
    const file = path.join(f.dir, `wavekb-tline-sync.${name}`);
    if (prior) { fs.writeFileSync(file, `old ${name}\n`); fs.chmodSync(file, 0o640); }
    units.set(name, { exists: prior, active: prior ? "active" : "inactive", enabled: prior ? "enabled" : "disabled" });
  }
  if (prior) {
    fs.mkdirSync(data, { recursive: true });
    const db = new ResearchStore(database);
    db.publish([], [{ id: "old", ingestedAt: "2026-09-05T00:00:00Z" }], "2026-09-05T00:00:00Z", "2026-09-05T00:00:01Z");
    db.close();
  }
  let fault;
  const options = { ...f.options, tline: true, tlineApiKey: "tli_fixture_only_not_a_real_secret",
    syncUnitFile: path.join(f.dir, "wavekb-tline-sync.service"), timerUnitFile: path.join(f.dir, "wavekb-tline-sync.timer"),
    probe: async () => { events.push("probe"); if (fault === "probe") throw new Error("probe rejected"); },
    syncService: async (action, name) => {
      events.push(`${action}:${name}`);
      const unit = units.get(name);
      if (action === "state") return { ...unit };
      if (fault === `${action}:${name}`) { fault = undefined; throw new Error("injected fault"); }
      if (action === "stop") unit.active = "inactive";
      if (action === "start") { unit.exists = true; unit.active = "active"; }
      if (["enable", "disable"].includes(action)) unit.enabled = action === "enable" ? "enabled" : "disabled";
      if (action === "check") return { next: "2026-09-05T01:10:00Z", result: "success" };
    },
    worker: async ({ command, file, output, user, environmentFiles }) => {
      events.push(command);
      if (fault === "backup" && command === "backup") throw new Error("backup failed");
      assert.equal(file, database);
      assert.equal(user, "fixture");
      assert.equal(f.ownedCaches.get(data), "fixture", "DB operations run as the catalogue owner");
      if (command === "sync") {
        assert.ok(environmentFiles.every((file) => fs.existsSync(file)));
        if (prior) assert.ok(fs.existsSync(path.join(f.options.backupRoot, `${sha}-${options.runId}-${options.runAttempt}`, "research.sqlite")), "backup precedes warmup");
        if (fault === "sync") throw new Error("warmup failed");
        if (fault === "locked" || fault === "deferred") return { status: fault, lastSuccess: "2026-09-05T00:00:01Z" };
      }
      const db = new ResearchStore(file, { readOnly: command === "status" });
      try {
        if (command === "backup") { assert.equal(path.dirname(output), data, "service writes snapshot to owned staging, not protected backup root"); db.backupTo(output); return { status: "backed_up" }; }
        if (command === "status") return db.status();
        db.publish([], [{ id: "new", ingestedAt: "2026-09-05T00:01:00Z" }], "2026-09-05T00:01:00Z", "2026-09-05T00:01:01Z");
        return { status: "synced", lastSuccess: "2026-09-05T00:01:01Z" };
      } finally { db.close(); }
    },
  };
  return { ...f, options, units, events, database, fault: (value) => { fault = value; } };
}

test("persistent capability rejection occurs before production files or services mutate", async (t) => {
  const f = persistentFixture(t); f.fault("probe");
  await assert.rejects(api.activate(f.options), /probe/);
  assert.deepEqual(f.events, ["probe"]);
  assert.equal(fs.readdirSync(path.join(f.options.applicationRoot, "releases")).length, 1);
  assert.ok(!fs.existsSync(path.dirname(f.database)));
});

test("an activating writer drains under a bounded wait before backup instead of losing its lease to SIGTERM", async (t) => {
  const f = persistentFixture(t, true);
  f.units.get("service").active = "activating";
  const control = f.options.syncService;
  f.options.syncService = async (action, name) => {
    if (action === "stop" && name === "service") assert.notEqual(f.units.get(name).active, "activating", "must not kill a leased writer");
    if (action === "wait-idle") { assert.equal(f.units.get("timer").active, "inactive"); f.units.get("service").active = "inactive"; }
    return control(action, name);
  };
  await api.activate(f.options);
  assert.ok(f.events.indexOf("wait-idle:service") < f.events.indexOf("backup"));
});

for (const phase of ["sync", "locked", "deferred", "enable:timer", "start:timer", "check:timer"]) {
  test(`persistent failure at ${phase} restores exact previous units and retains data`, async (t) => {
    const f = persistentFixture(t, true); f.fault(phase);
    await assert.rejects(api.activate(f.options));
    assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
    for (const name of ["service", "timer"]) {
      const file = name === "service" ? f.options.syncUnitFile : f.options.timerUnitFile;
      assert.equal(fs.readFileSync(file, "utf8"), `old ${name}\n`);
      assert.equal(fs.statSync(file).mode & 0o777, 0o640);
      assert.deepEqual(f.units.get(name), { exists: true, enabled: "enabled", active: "active" });
    }
    assert.equal(fs.readFileSync(f.options.environmentFile, "utf8"), f.env);
    if (["sync", "locked", "deferred"].includes(phase)) assert.equal(f.calls.filter((call) => call === "restart").length, 0, "warmup failure must not restart the live web service");
    const db = new ResearchStore(f.database, { readOnly: true });
    assert.ok(db.detail("old")); db.close();
    assert.ok(f.events.indexOf("stop:timer") < f.events.indexOf("backup"));
    assert.ok(f.events.indexOf("stop:service") < f.events.indexOf("backup"));
  });
}

for (const enabled of ["disabled", "static"]) {
  test(`rollback preserves previously ${enabled}, inactive sync units without starting them`, async (t) => {
    const f = persistentFixture(t, true);
    for (const unit of f.units.values()) { unit.enabled = enabled; unit.active = "inactive"; }
    const webControl = f.options.service;
    f.options.service = async (action) => {
      if (action === "daemon-reload" && enabled === "static") {
        // systemd derives "static" from the restored unit's lack of [Install],
        // not an enable/disable operation. Model that external reload boundary.
        for (const [name, file] of [["service", f.options.syncUnitFile], ["timer", f.options.timerUnitFile]]) {
          if (fs.readFileSync(file, "utf8") === `old ${name}\n`) f.units.get(name).enabled = "static";
        }
      }
      return webControl(action);
    };
    const result = await api.activate(f.options);
    f.events.length = 0;
    await api.rollback({ ...f.options, releaseId: result.releaseId });
    for (const unit of f.units.values()) { assert.equal(unit.active, "inactive"); assert.equal(unit.enabled, enabled); }
    assert.ok(!f.events.some((event) => event.startsWith("start:")));
  });
}

test("failed backup and bounded old-writer drain leave web untouched and restore its prior timer", async (t) => {
  for (const fault of ["backup", "wait-idle:service", "stop:timer", "stop:service"]) {
    const f = persistentFixture(t, true); f.fault(fault);
    await assert.rejects(api.activate(f.options));
    assert.equal(fs.realpathSync(path.join(f.options.applicationRoot, "current")), f.old);
    assert.equal(f.units.get("timer").active, "active");
    assert.equal(f.calls.filter((call) => call === "restart").length, 0);
    assert.ok(!f.events.includes("sync"));
  }
});

test("first install rollback removes only newly managed units and keeps catalogue and snapshot", async (t) => {
  const f = persistentFixture(t);
  const result = await api.activate(f.options);
  const state = JSON.parse(fs.readFileSync(path.join(f.options.backupRoot, result.releaseId, "rollback.json")));
  assert.equal(state.tline.preheatComplete, true);
  assert.ok(!fs.readFileSync(f.options.syncUnitFile, "utf8").includes(`EnvironmentFile=${f.options.environmentFile}`), "worker does not receive unrelated site secrets");
  assert.match(fs.readFileSync(f.options.unitFile, "utf8"), /UnsetEnvironment=TLINE_API_KEY/);
  assert.match(fs.readFileSync(f.options.syncUnitFile, "utf8"), /ReadWritePaths=.*\/data\/tline\n/);
  assert.match(fs.readFileSync(f.options.timerUnitFile, "utf8"), /OnCalendar=\*-\*-\* \*:0\/10:00\nPersistent=true/);
  await api.rollback({ ...f.options, releaseId: result.releaseId });
  assert.ok(!fs.existsSync(f.options.syncUnitFile)); assert.ok(!fs.existsSync(f.options.timerUnitFile));
  const db = new ResearchStore(f.database, { readOnly: true }); assert.ok(db.detail("new")); db.close();
});

test("production adapter bounds an active writer wait without stopping or clearing its lease", async () => {
  let elapsed = 0;
  const adapter = api.productionResearchAdapter({
    execute: (command, args) => {
      assert.equal(command, "systemctl"); assert.equal(args[0], "show");
      return "LoadState=loaded\nActiveState=activating\nUnitFileState=static\nFragmentPath=/etc/systemd/system/wavekb-tline-sync.service\nDropInPaths=\n";
    },
    now: () => elapsed, pause: async (ms) => { elapsed += ms; },
  });
  await assert.rejects(adapter.syncService("wait-idle", "service"), /Timed out/);
  assert.equal(elapsed, 540_000);
});

test("host adapter distinguishes absent units from systemctl errors and keeps credentials out of argv", async () => {
  const adapter = api.productionResearchAdapter({ execute: (command, args) => {
    if (command === "systemctl") return "LoadState=not-found\n";
    assert.equal(command, "systemd-run");
    assert.ok(args.includes("--property=EnvironmentFile=/protected/tline.env"));
    assert.ok(!args.some((arg) => arg.includes("site.env") || arg.includes("tli_")));
    assert.ok(args.includes("--uid=fixture")); assert.ok(args.includes("--property=TimeoutStartSec=540"));
    return '{"status":"synced","lastSuccess":"2026-09-05T00:00:00Z"}';
  } });
  assert.deepEqual(await adapter.syncService("state", "timer"), { exists: false, active: "inactive", enabled: "disabled" });
  await adapter.worker({ command: "sync", worker: "/candidate/cli.mjs", file: "/data/research.sqlite", user: "fixture", environmentFiles: ["/protected/site.env", "/protected/tline.env"], releaseId: `${sha}-123-1` });
  const broken = api.productionResearchAdapter({ execute: () => { throw new Error("systemctl transport failure"); } });
  await assert.rejects(broken.syncService("state", "timer"), /transport failure/);
});

test("the host accepts explicit not-found show output even when systemctl exits one", async () => {
  const adapter = api.productionResearchAdapter({ execute: () => {
    throw Object.assign(new Error("unit absent"), { status: 1, stdout: "LoadState=not-found\nActiveState=inactive\nUnitFileState=\nFragmentPath=\nDropInPaths=\n" });
  } });
  assert.deepEqual(await adapter.syncService("state", "timer"), { exists: false, active: "inactive", enabled: "disabled" });
});

test("existing failed worker status does not invalidate a successful candidate warmup", async (t) => {
  const f = persistentFixture(t, true);
  f.units.get("service").active = "failed";
  const control = f.options.syncService;
  let result = "exit-code";
  f.options.syncService = async (action, name) => {
    if (action === "reset-failed") result = "success";
    const value = await control(action, name);
    return action === "check" ? { ...value, result } : value;
  };
  await api.activate(f.options);
  assert.ok(f.events.indexOf("reset-failed:service") > f.events.indexOf("sync"));
});

test("two accepted releases share one catalogue and preserve consistent WAL backup on finalize", async (t) => {
  const f = persistentFixture(t, true);
  const openWriter = new ResearchStore(f.database);
  openWriter.publish([], [{ id: "wal-only", ingestedAt: "2026-09-05T00:00:00Z" }], "2026-09-05T00:00:00Z", "2026-09-05T00:00:01Z");
  t.after(() => openWriter.close());
  const first = await api.activate(f.options);
  await api.finalize({ ...f.options, releaseId: first.releaseId, accepted: true });
  const backup = new ResearchStore(path.join(f.options.backupRoot, first.releaseId, "research.sqlite"), { readOnly: true });
  assert.ok(backup.detail("wal-only")); assert.ok(!backup.detail("new")); backup.close();
  f.options.runAttempt = "2"; f.options.baseSha = sha;
  const second = await api.activate(f.options);
  await api.finalize({ ...f.options, releaseId: second.releaseId, accepted: true });
  const db = new ResearchStore(f.database, { readOnly: true }); assert.ok(db.detail("wal-only")); assert.ok(db.detail("new")); db.close();
});

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
