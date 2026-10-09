import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { diagnoseReleaseState, readResearchState, readResearchForOwner } from "../scripts/diagnose-release-state.mjs";

const sha = "a".repeat(40), releaseId = `${sha}-37936509896-1`;
const sentinel = "SECRET_DO_NOT_OUTPUT_token-password-report-owner";
const now = Date.parse("2026-10-09T13:43:00Z");

function fixture(t, { wal = false, open = false, user = "wavekb" } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-release-state-")));
  const applicationRoot = path.join(directory, "application"), backupRoot = path.join(directory, "backups");
  const candidate = path.join(applicationRoot, "releases", releaseId), previous = path.join(applicationRoot, "releases", "previous");
  fs.mkdirSync(path.join(candidate, "apps/web/.next/static"), { recursive: true });
  fs.mkdirSync(previous, { recursive: true });
  fs.writeFileSync(path.join(candidate, "apps/web/server.js"), sentinel);
  fs.writeFileSync(path.join(candidate, "start-release.sh"), sentinel, { mode: 0o755 });
  fs.symlinkSync(previous, path.join(applicationRoot, "current"));
  const metadata = path.join(backupRoot, releaseId, "rollback.json");
  fs.mkdirSync(path.dirname(metadata), { recursive: true });
  const value = { releaseId, sha, releaseDir: candidate, previousRelease: previous, previousVersion: "b".repeat(40),
    phase: "rolled-back", diagnosticStage: "research-preheat", webMutated: false,
    unsafe: sentinel, tline: { user, backupComplete: true, preheatComplete: false, unitsInstalled: false, lastSuccess: "2026-10-09T12:00:00Z", credentials: sentinel } };
  fs.writeFileSync(metadata, JSON.stringify(value), { mode: 0o600 });
  const file = path.join(applicationRoot, "data/tline/research.sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const writer = new DatabaseSync(file);
  if (wal) writer.exec("PRAGMA journal_mode=WAL");
  writer.exec(`PRAGMA user_version=1;
    CREATE TABLE institutions(slug TEXT PRIMARY KEY,name TEXT NOT NULL,raw TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE research(id TEXT PRIMARY KEY,institution_slug TEXT NOT NULL,published_at TEXT,ingested_at TEXT NOT NULL,raw TEXT NOT NULL,search_text TEXT NOT NULL,first_seen_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE sync_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL,first_success TEXT,last_success TEXT,watermark TEXT,last_attempt TEXT,result TEXT,error_code TEXT,retry_at TEXT,lease_owner TEXT,lease_expires INTEGER);`);
  writer.prepare("INSERT INTO institutions VALUES(?,?,?,?)").run("private", "private", sentinel, "2026-10-09T12:00:00Z");
  writer.prepare("INSERT INTO research VALUES(?,?,?,?,?,?,?,?)").run("private", "private", null, "2026-10-09T12:00:00Z", sentinel, sentinel, "2026-10-09T12:00:00Z", "2026-10-09T12:00:00Z");
  writer.prepare("INSERT INTO sync_state VALUES(1,1,?,?,?,?,?,?,?,?,?)").run(null, "2026-10-09T12:00:00Z", sentinel, "2026-10-09T13:42:20Z", sentinel, "rate_limited", "2026-10-09T14:42:20Z", sentinel, now + 10000);
  if (!open) writer.close();
  t.after(() => { if (open) writer.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(command, "systemctl");
    assert.equal(args[0], "show");
    return `LoadState=loaded\nActiveState=inactive\nSubState=dead\nResult=success\nUnitFileState=disabled\nEnvironment=${sentinel}\n`;
  };
  const researchReader = (target) => readResearchState(target, { now: () => now });
  return { directory, applicationRoot, backupRoot, candidate, previous, metadata, value, file, writer, calls, execute, researchReader };
}

test("metadata and real SQLite state project only fixed fields, without record or file changes", (t) => {
  const f = fixture(t), before = fs.readFileSync(f.file), names = fs.readdirSync(path.dirname(f.file));
  const result = diagnoseReleaseState(releaseId, f);
  assert.deepEqual(result.metadata, { state: "read", phase: "rolled-back", diagnosticStage: "research-preheat", webMutated: false,
    previousVersionValid: true, tline: { backupComplete: true, preheatComplete: false, unitsInstalled: false, hasLastSuccess: true } });
  assert.deepEqual(result.current, { state: "read", candidate: false, previous: true });
  assert.deepEqual(result.research, { state: "read", lastAttempt: "2026-10-09T13:42:20.000Z", lastSuccess: "2026-10-09T12:00:00.000Z",
    errorCode: "rate_limited", retryAt: "2026-10-09T14:42:20.000Z", leaseValid: true });
  assert.equal(result.candidate.server.kind, "file");
  assert.equal(result.candidate.launcher.mode, "755");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT|\/application|\/backups|credentials|lease_owner|Environment/);
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), names);
  assert.deepEqual(f.calls.map(({ args }) => args[1]), ["wavekb-next-preview.service", "wavekb-tline-sync.service", "wavekb-tline-sync.timer", `wavekb-tline-warmup-${releaseId}.service`]);
  for (const { args, options } of f.calls) {
    assert.deepEqual(args.slice(2), ["-p", "LoadState", "-p", "ActiveState", "-p", "SubState", "-p", "Result", "-p", "UnitFileState"]);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
  }
});

test("metadata-only diagnostics work without a service user or candidate worker", (t) => {
  const f = fixture(t, { user: undefined });
  delete f.value.tline.user;
  fs.writeFileSync(f.metadata, JSON.stringify(f.value));
  const result = diagnoseReleaseState(releaseId, { ...f, researchReader: undefined });
  assert.equal(result.metadata.diagnosticStage, "research-preheat");
  assert.equal(result.research.state, "owner_unavailable");
  assert.equal(f.calls.length, 4);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT/);
});

test("unknown enums, timestamp-like secrets and lease owners never escape", (t) => {
  const f = fixture(t, { open: true });
  f.value.phase = sentinel; f.value.diagnosticStage = sentinel; f.value.previousVersion = sentinel;
  fs.writeFileSync(f.metadata, JSON.stringify(f.value));
  f.writer.prepare("UPDATE sync_state SET last_attempt=?,last_success=?,error_code=?,retry_at=?,lease_expires=?").run(sentinel, sentinel, sentinel, sentinel, now - 1);
  f.execute = () => `LoadState=${sentinel}\nActiveState=${sentinel}\nSubState=${sentinel}\nResult=${sentinel}\nUnitFileState=${sentinel}\n`;
  const result = diagnoseReleaseState(releaseId, f);
  assert.equal(result.metadata.phase, "unknown"); assert.equal(result.metadata.diagnosticStage, "unknown");
  assert.equal(result.metadata.previousVersionValid, false);
  assert.deepEqual(result.research, { state: "read", lastAttempt: null, lastSuccess: null, errorCode: "unknown", retryAt: null, leaseValid: false });
  assert.equal(result.units.web.LoadState, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT/);
});

test("invalid identity is rejected before reads or commands", () => {
  for (const id of ["../outside", `${sha}-1-0`, `${sha}-1-1'`, `A${sha.slice(1)}-1-1`]) {
    assert.throws(() => diagnoseReleaseState(id, { execute() { assert.fail("Command must not execute"); } }), /Invalid release identity/);
  }
});

test("malformed, oversized and mismatched metadata classify safely", (t) => {
  const f = fixture(t);
  for (const [text, state] of [[sentinel, "invalid_metadata"], ["x".repeat(65537), "invalid_metadata"],
    [JSON.stringify({ ...f.value, sha: "b".repeat(40) }), "identity_mismatch"],
    [JSON.stringify({ ...f.value, releaseDir: sentinel }), "identity_mismatch"]]) {
    fs.writeFileSync(f.metadata, text);
    const result = diagnoseReleaseState(releaseId, { ...f, researchReader: undefined });
    assert.equal(result.metadata.state, state); assert.equal(result.research.state, "owner_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT/);
  }
  fs.chmodSync(f.metadata, 0o622);
  assert.equal(diagnoseReleaseState(releaseId, f).metadata.state, "unsafe_metadata_permissions");
});

test("missing metadata and DB do not hide other safe projections", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.metadata); fs.unlinkSync(f.file);
  const result = diagnoseReleaseState(releaseId, f);
  assert.equal(result.metadata.state, "missing"); assert.equal(result.research.state, "missing");
  assert.equal(result.candidate.server.state, "present"); assert.equal(result.units.timer.state, "read");
});

test("metadata and main SQLite symlinks are rejected without following them", (t) => {
  const f = fixture(t), outside = path.join(f.directory, "outside");
  fs.writeFileSync(outside, sentinel);
  fs.unlinkSync(f.metadata); fs.symlinkSync(outside, f.metadata);
  fs.unlinkSync(f.file); fs.symlinkSync(outside, f.file);
  const result = diagnoseReleaseState(releaseId, f);
  assert.equal(result.metadata.state, "unsafe_path"); assert.equal(result.research.state, "unsafe_path");
  assert.equal(fs.readFileSync(outside, "utf8"), sentinel);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT/);
});

test("each potentially used SQLite sidecar rejects symlinks", (t) => {
  const f = fixture(t), outside = path.join(f.directory, "outside");
  fs.writeFileSync(outside, sentinel);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    fs.symlinkSync(outside, f.file + suffix);
    assert.equal(readResearchState(f.file).state, "unsafe_path");
    fs.unlinkSync(f.file + suffix);
  }
  assert.equal(fs.readFileSync(outside, "utf8"), sentinel);
});

test("canonical parent paths and out-of-tree current targets are rejected", (t) => {
  const f = fixture(t), outside = path.join(f.directory, "outside");
  fs.mkdirSync(outside);
  fs.unlinkSync(path.join(f.applicationRoot, "current")); fs.symlinkSync(outside, path.join(f.applicationRoot, "current"));
  assert.equal(diagnoseReleaseState(releaseId, f).current.state, "unsafe_path");
  const linkedParent = path.join(f.directory, "linked"); fs.symlinkSync(path.dirname(f.file), linkedParent);
  assert.equal(readResearchState(path.join(linkedParent, "research.sqlite")).state, "unsafe_path");
});

test("corrupt or incompatible SQLite never exposes raw SQL or error paths", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.file, sentinel);
  assert.equal(readResearchState(f.file).state, "invalid_database");
  fs.unlinkSync(f.file);
  const database = new DatabaseSync(f.file); database.exec("PRAGMA user_version=1; CREATE TABLE sync_state(singleton)"); database.close();
  assert.equal(readResearchState(f.file).state, "unsupported_schema");
  const changed = new DatabaseSync(f.file); changed.exec("PRAGMA user_version=2"); changed.close();
  assert.equal(readResearchState(f.file).state, "unsupported_schema");
});

test("active WAL state is current and reads preserve main and WAL application bytes", (t) => {
  const f = fixture(t, { wal: true, open: true });
  f.writer.prepare("UPDATE sync_state SET error_code=?,last_attempt=?").run("network_error", "2026-10-09T13:42:55Z");
  const before = fs.readFileSync(f.file), wal = fs.readFileSync(f.file + "-wal");
  assert.equal(readResearchState(f.file, { now: () => now }).errorCode, "network_error");
  assert.equal(readResearchState(f.file).lastAttempt, "2026-10-09T13:42:55.000Z");
  assert.deepEqual(fs.readFileSync(f.file), before); assert.deepEqual(fs.readFileSync(f.file + "-wal"), wal);
  assert.equal(f.writer.prepare("SELECT lease_owner FROM sync_state").get().lease_owner, sentinel);
});

test("closed idle WAL with normally absent sidecars remains readable without SQL mutation", (t) => {
  const f = fixture(t, { wal: true });
  assert.equal(fs.readFileSync(f.file)[18], 2);
  assert.equal(fs.existsSync(f.file + "-wal"), false); assert.equal(fs.existsSync(f.file + "-shm"), false);
  const before = fs.readFileSync(f.file);
  assert.equal(readResearchState(f.file, { now: () => now }).errorCode, "rate_limited");
  assert.deepEqual(fs.readFileSync(f.file), before);
  // Ordinary readonly SQLite SHM/WAL coordination is permitted; no immutable
  // mode or main/WAL-data/lease/cooldown write is requested by the diagnostic.
});

test("service-owner boundary uses fixed SQL under env-i and reprojects subprocess output", (t) => {
  const f = fixture(t);
  let calls = 0;
  const result = readResearchForOwner(f.file, "wavekb", (command, args, options) => {
    calls++;
    assert.equal(command, "runuser");
    assert.deepEqual(args.slice(0, 9), ["-u", "wavekb", "--", "/usr/bin/env", "-i", "/usr/bin/node", "--input-type=module", "-e", args[8]]);
    assert.equal(args[9], f.file);
    assert.match(args[8], /new Database\(file, \{ readOnly: true \}\)/);
    assert.doesNotMatch(args[8], /immutable\s*[:=]|new ResearchStore|\.exec\(|sync\(|EnvironmentFile|cli\.mjs/);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    return JSON.stringify({ state: "read", lastAttempt: sentinel, lastSuccess: "2026-10-09T12:00:00Z", errorCode: sentinel, retryAt: sentinel, leaseValid: true, owner: sentinel });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { state: "read", lastAttempt: null, lastSuccess: "2026-10-09T12:00:00.000Z", errorCode: "unknown", retryAt: null, leaseValid: true });
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT/);
});

test("fixed SQL subprocess actually reads the real fixture with no application bytes changed", (t) => {
  const f = fixture(t), before = fs.readFileSync(f.file);
  const result = readResearchForOwner(f.file, "wavekb", (command, args) => {
    assert.equal(command, "runuser");
    return execFileSync(process.execPath, ["--input-type=module", "-e", args[8], args[9]], { encoding: "utf8", env: {}, stdio: ["ignore", "pipe", "pipe"] });
  });
  assert.equal(result.state, "read"); assert.equal(result.errorCode, "rate_limited");
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test("root, invalid, missing service accounts and private subprocess errors fail closed", () => {
  for (const user of ["root", undefined, "", "../outside", "wavekb;command", "Secret User"]) {
    assert.equal(readResearchForOwner("/unused", user, () => assert.fail("No command allowed")).state, "owner_unavailable");
  }
  const result = readResearchForOwner("/unused", "wavekb", () => { throw Object.assign(new Error(sentinel), { stderr: sentinel }); });
  assert.deepEqual(result, { state: "unavailable" });
  assert.deepEqual(readResearchForOwner("/unused", "wavekb", () => JSON.stringify({ state: sentinel, secret: sentinel })), { state: "unknown" });
});

test("systemctl failures and unrecognized states never relay raw stdout or stderr", (t) => {
  const f = fixture(t); f.execute = () => { throw Object.assign(new Error(sentinel), { stdout: sentinel, stderr: sentinel }); };
  const result = diagnoseReleaseState(releaseId, f);
  assert.deepEqual(result.units.web, { state: "unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_OUTPUT/);
});

test("new workflow operation is isolated and preserves all prior operation contracts", () => {
  const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml");
  const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/diagnose-next-production.yml", import.meta.url), "utf8"));
  const inputs = (workflow.on ?? workflow.true).workflow_dispatch.inputs;
  assert.equal(inputs.operation.default, "release");
  assert.deepEqual(inputs.operation.options, ["release", "release-state", "knowledge-transport", "mentor-account", "integration-config"]);
  const steps = workflow.jobs.diagnose.steps, step = steps.find((value) => value.if === "inputs.operation == 'release-state'");
  assert.match(step.run, /< scripts\/diagnose-release-state\.mjs/);
  assert.match(step.run, /sudo -n \/usr\/bin\/node --input-type=module - '\$\{RELEASE_ID\}'/);
  assert.deepEqual(Object.keys(step.env).sort(), ["DEPLOY_HOST", "DEPLOY_USER", "RELEASE_ID"]);
  assert.doesNotMatch(step.run, /systemd-run|systemctl|journalctl|\.env|EnvironmentFile|sync|backup/);
  assert.match(steps.find((value) => value.if === "inputs.operation == 'release'").run, /< scripts\/diagnose-release\.mjs/);
  assert.match(steps.find((value) => value.if === "inputs.operation == 'mentor-account'").run, /CREATE_DISPOSABLE_MENTOR_AUDIT_ACCOUNT/);
  assert.match(steps.find((value) => value.if === "inputs.operation == 'integration-config'").run, /< scripts\/integration-config-audit\.mjs/);
});
