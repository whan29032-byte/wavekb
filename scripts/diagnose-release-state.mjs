import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const identity = /^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$/;
const phases = new Set(["prepared", "preheating", "activating", "awaiting-acceptance", "rolling-back", "rolled-back", "accepted"]);
const stages = new Set(["candidate-extraction", "research-preheat", "research-unit-install", "current-link-switch", "systemd-reload", "web-service-restart", "web-health", "research-service-reset", "research-timer-enable", "research-timer-start", "research-runtime-check", "awaiting-acceptance"]);
const errorCodes = new Set(["not_configured", "unauthorized", "forbidden", "rate_limited", "network_error", "invalid_response", "repeated_cursor", "page_limit", "record_limit", "deadline_exceeded", "storage_error", "sync_failed"]);
const properties = {
  LoadState: new Set(["loaded", "not-found", "masked", "error", "bad-setting", "merged", "stub"]),
  ActiveState: new Set(["active", "inactive", "activating", "deactivating", "failed", "reloading", "maintenance", "refreshing"]),
  SubState: new Set(["running", "exited", "dead", "failed", "waiting", "elapsed", "start", "start-pre", "start-post", "stop", "stop-sigterm", "stop-sigkill", "stop-post", "auto-restart", "reload", "plugged", "listening"]),
  Result: new Set(["success", "exit-code", "signal", "core-dump", "timeout", "watchdog", "start-limit-hit", "resources", "protocol", "oom-kill", "dependency", "assert", "condition"]),
  UnitFileState: new Set(["enabled", "disabled", "static", "masked", "indirect", "generated", "transient", "not-found", "enabled-runtime", "masked-runtime", "linked", "linked-runtime"]),
};
const enumValue = (allowed, value) => allowed.has(value) ? value : "unknown";
const object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function instant(value) {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function reason(error) {
  if (error?.code === "ENOENT") return "missing";
  if (["EACCES", "EPERM"].includes(error?.code)) return "unreadable";
  return "read_error";
}
function canonicalDirectory(directory) {
  return path.isAbsolute(directory) && path.resolve(directory) === directory
    && fs.lstatSync(directory).isDirectory() && fs.realpathSync(directory) === directory;
}
function regularFile(file) {
  if (!canonicalDirectory(path.dirname(file))) return false;
  const info = fs.lstatSync(file);
  return info.isFile() && !info.isSymbolicLink() && fs.realpathSync(file) === file;
}
function fileState(file) {
  try {
    if (!canonicalDirectory(path.dirname(file))) return { state: "unsafe_path" };
    const info = fs.lstatSync(file);
    const kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : info.isSymbolicLink() ? "symlink" : "other";
    return { state: "present", kind, mode: (info.mode & 0o777).toString(8) };
  } catch (error) { return { state: reason(error) }; }
}
function readMetadata(file, releaseId, candidate) {
  try {
    if (!regularFile(file)) return { result: { state: "unsafe_path" } };
    const info = fs.statSync(file);
    if (info.uid !== process.getuid() || (info.mode & 0o022) !== 0) return { result: { state: "unsafe_metadata_permissions" } };
    if (info.size > 65536) return { result: { state: "invalid_metadata" } };
    let value;
    try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return { result: { state: "invalid_metadata" } }; }
    if (!object(value) || value.releaseId !== releaseId || value.sha !== releaseId.slice(0, 40) || value.releaseDir !== candidate) return { result: { state: "identity_mismatch" } };
    const tline = object(value.tline) ? value.tline : null;
    return { value, result: {
      state: "read", phase: enumValue(phases, value.phase), diagnosticStage: enumValue(stages, value.diagnosticStage),
      webMutated: value.webMutated === true,
      previousVersionValid: typeof value.previousVersion === "string" && /^[0-9a-f]{40}$/.test(value.previousVersion),
      tline: tline ? {
        backupComplete: tline.backupComplete === true, preheatComplete: tline.preheatComplete === true,
        unitsInstalled: tline.unitsInstalled === true, hasLastSuccess: instant(tline.lastSuccess) !== null,
      } : null,
    } };
  } catch (error) { return { result: { state: reason(error) } }; }
}
function currentState(current, candidate, previous, releases) {
  try {
    if (!canonicalDirectory(path.dirname(current)) || !fs.lstatSync(current).isSymbolicLink()) return { state: "unsafe_path", candidate: false, previous: false };
    const target = fs.realpathSync(current);
    if (path.dirname(target) !== releases) return { state: "unsafe_path", candidate: false, previous: false };
    const validPrevious = typeof previous === "string" && path.resolve(previous) === previous && path.dirname(previous) === releases && previous !== candidate;
    return { state: "read", candidate: target === candidate, previous: Boolean(validPrevious && target === previous) };
  } catch (error) { return { state: reason(error), candidate: false, previous: false }; }
}

export function readResearchState(file, { now = Date.now, Database = DatabaseSync } = {}) {
  let database;
  try {
    if (!regularFile(file)) return { state: "unsafe_path" };
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try { if (!regularFile(file + suffix)) return { state: "unsafe_path" }; }
      catch (error) { if (error?.code !== "ENOENT") return { state: reason(error) }; }
    }
    // Normal read-only WAL coordination runs as the retained service account.
    // Sidecars may be absent after the writer closes; do not ignore active WAL
    // with immutable mode or claim SHM lock bytes are invariant.
    const header = Buffer.alloc(20);
    const fd = fs.openSync(file, "r");
    try { if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) return { state: "invalid_database" }; }
    finally { fs.closeSync(fd); }
    if (header.subarray(0, 16).toString("ascii") !== "SQLite format 3\0") return { state: "invalid_database" };
    database = new Database(file, { readOnly: true });
    // No ResearchStore construction, schema initialization, lease operations,
    // report reads, journal-mode changes, checkpoints or write SQL.
    const version = database.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 1) return { state: "unsupported_schema" };
    let row;
    try {
      database.prepare("SELECT slug,name,raw,updated_at FROM institutions LIMIT 0");
      database.prepare("SELECT id,institution_slug,published_at,ingested_at,raw,search_text,first_seen_at,updated_at FROM research LIMIT 0");
      row = database.prepare("SELECT schema_version,last_attempt,last_success,error_code,retry_at,lease_owner IS NOT NULL AND lease_owner <> '' AS has_lease_owner,lease_expires FROM sync_state WHERE singleton=1").get();
    } catch { return { state: "unsupported_schema" }; }
    if (!row || row.schema_version !== 1) return { state: "unsupported_schema" };
    return {
      state: "read", lastAttempt: instant(row.last_attempt), lastSuccess: instant(row.last_success),
      errorCode: row.error_code == null ? null : enumValue(errorCodes, row.error_code), retryAt: instant(row.retry_at),
      leaseValid: row.has_lease_owner === 1 && Number.isSafeInteger(row.lease_expires) && row.lease_expires > now(),
    };
  } catch (error) { return { state: reason(error) }; }
  finally { try { database?.close(); } catch { /* Do not expose database/path errors. */ } }
}

const researchStates = new Set(["read", "missing", "unreadable", "read_error", "unsafe_path", "invalid_database", "unsupported_schema", "wal_coordination_unavailable", "owner_unavailable", "unavailable"]);
// Fixed SQL code executes as the retained service account, never as root. The
// child receives no environment or credentials and cannot invoke a worker/sync.
const researchProbe = `import fs from "node:fs"; import path from "node:path"; import { DatabaseSync } from "node:sqlite";
const errorCodes = new Set(${JSON.stringify([...errorCodes])});
const enumValue = ${enumValue.toString()};
${instant.toString()}\n${reason.toString()}\n${canonicalDirectory.toString()}\n${regularFile.toString()}\n${readResearchState.toString().replace(/^export /, "")}
console.log(JSON.stringify(readResearchState(process.argv[1])));`;

export function readResearchForOwner(file, user, execute = execFileSync) {
  if (typeof user !== "string" || !/^[a-z_][a-z0-9_-]*$/.test(user) || user === "root") return { state: "owner_unavailable" };
  try {
    const output = execute("runuser", ["-u", user, "--", "/usr/bin/env", "-i", "/usr/bin/node", "--input-type=module", "-e", researchProbe, file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000, maxBuffer: 65536 });
    const value = JSON.parse(String(output));
    const state = enumValue(researchStates, value?.state);
    if (state !== "read") return { state };
    // Even subprocess stdout is untrusted: project again, never relay it.
    return { state, lastAttempt: instant(value.lastAttempt), lastSuccess: instant(value.lastSuccess),
      errorCode: value.errorCode == null ? null : enumValue(errorCodes, value.errorCode), retryAt: instant(value.retryAt), leaseValid: value.leaseValid === true };
  } catch { return { state: "unavailable" }; }
}

function unitState(unit, execute) {
  try {
    // This is the only command boundary: fixed systemctl show + fixed fields.
    const output = execute("systemctl", ["show", unit, ...Object.keys(properties).flatMap((key) => ["-p", key])],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000, maxBuffer: 65536 });
    const parsed = Object.fromEntries(String(output).split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
    return { state: "read", ...Object.fromEntries(Object.entries(properties).map(([key, values]) => [key, enumValue(values, parsed[key])])) };
  } catch { return { state: "unavailable" }; }
}

/** Injected roots/commands are for fixtures only; the CLI takes only an identity. */
export function diagnoseReleaseState(releaseId, { applicationRoot = "/srv/wavekb-next-preview", backupRoot = "/var/backups/wavekb-next-production", execute = execFileSync, researchReader = readResearchForOwner } = {}) {
  if (!identity.test(releaseId)) throw new Error("Invalid release identity");
  const releases = path.join(applicationRoot, "releases"), candidate = path.join(releases, releaseId);
  const metadata = readMetadata(path.join(backupRoot, releaseId, "rollback.json"), releaseId, candidate);
  return {
    releaseId, metadata: metadata.result,
    current: currentState(path.join(applicationRoot, "current"), candidate, metadata.value?.previousRelease, releases),
    candidate: Object.fromEntries(Object.entries({ root: candidate, server: path.join(candidate, "apps/web/server.js"), static: path.join(candidate, "apps/web/.next/static"), cache: path.join(candidate, "apps/web/.next/cache"), launcher: path.join(candidate, "start-release.sh") }).map(([key, file]) => [key, fileState(file)])),
    research: researchReader(path.join(applicationRoot, "data/tline/research.sqlite"), metadata.value?.tline?.user, execute),
    units: Object.fromEntries(Object.entries({ web: "wavekb-next-preview.service", research: "wavekb-tline-sync.service", timer: "wavekb-tline-sync.timer", warmup: `wavekb-tline-warmup-${releaseId}.service` }).map(([key, unit]) => [key, unitState(unit, execute)])),
  };
}

const executedFile = process.argv[1];
if (executedFile && (executedFile === "-" || import.meta.url === pathToFileURL(executedFile).href)) {
  try {
    if (process.argv.length !== 3) throw new Error("Invalid arguments");
    console.log(JSON.stringify(diagnoseReleaseState(process.argv[2])));
  } catch { console.error("Release state diagnostic rejected invalid input."); process.exitCode = 1; }
}
