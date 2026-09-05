import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const releasePattern = /^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$/;
const shaPattern = /^[0-9a-f]{40}$/;
const serviceName = "wavekb-next-preview.service";

function requireValue(condition, message) { if (!condition) throw new Error(message); }
function paths(options, releaseId) {
  requireValue(releasePattern.test(releaseId), "Invalid release identity");
  const applicationRoot = fs.realpathSync(options.applicationRoot);
  requireValue(applicationRoot !== "/", "Unsafe application root");
  return {
    applicationRoot, releasesRoot: path.join(applicationRoot, "releases"),
    current: path.join(applicationRoot, "current"),
    releaseDir: path.join(applicationRoot, "releases", releaseId),
    backup: path.join(options.backupRoot, releaseId),
    metadata: path.join(options.backupRoot, releaseId, "rollback.json"),
  };
}
function saveMetadata(file, value) {
  const temporary = `${file}.new`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function replaceCurrent(current, target) {
  const temporary = `${current}.new`;
  requireValue(!fs.existsSync(temporary), "Unfinished current-link transaction requires operator review");
  fs.symlinkSync(target, temporary);
  fs.renameSync(temporary, current);
}
function checkArchive(archive) {
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
  requireValue(entries.length > 0 && entries.every((entry) => !entry.startsWith("/") && !entry.split("/").includes("..")), "Unsafe release archive");
}
async function requireHealth(options, version) {
  const health = await options.health(version);
  requireValue(health?.ok === true && health.deployment === version, "Deployment health/version check failed");
}

function syncFiles(options) { return { service: options.syncUnitFile, timer: options.timerUnitFile }; }
function validSuccess(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
async function captureSync(options, backup) {
  const units = {};
  for (const [name, file] of Object.entries(syncFiles(options))) {
    const status = await options.syncService("state", name);
    const exists = fs.existsSync(file);
    requireValue(status.exists === exists, "Unmanaged sync unit requires operator review");
    requireValue(["active", "activating", "inactive", "failed"].includes(status.active) && ["enabled", "disabled", "static"].includes(status.enabled), "Unsupported sync unit state");
    units[name] = { ...status, mode: exists ? fs.statSync(file).mode & 0o777 : null };
    if (exists) {
      requireValue(fs.lstatSync(file).isFile(), "Sync unit must be a regular file");
      fs.copyFileSync(file, path.join(backup, `previous-sync.${name}`));
      fs.chmodSync(path.join(backup, `previous-sync.${name}`), 0o600);
    }
  }
  return { units, preheatComplete: false };
}
async function stopSync(options, state) {
  for (const name of ["timer", "service"]) {
    // An absent first-install unit is expected; all unexpected command errors fail closed.
    const current = await options.syncService("state", name);
    if (current.exists || state.tline.units[name].exists) {
      if (name === "service") await options.syncService("wait-idle", name);
      await options.syncService("stop", name);
    }
  }
}
async function restoreSync(options, state, backup) {
  if (state.tline.unitsInstalled) await stopSync(options, state);
  for (const [name, file] of Object.entries(state.tline.unitsInstalled ? syncFiles(options) : {})) {
    const previous = state.tline.units[name];
    const current = await options.syncService("state", name);
    if (current.exists) await options.syncService("disable", name);
    if (previous.exists) {
      fs.copyFileSync(path.join(backup, `previous-sync.${name}`), file);
      fs.chmodSync(file, previous.mode);
    } else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  await options.service("daemon-reload");
  for (const name of ["service", "timer"]) {
    const previous = state.tline.units[name];
    if (!previous.exists) continue;
    if (previous.enabled === "enabled") await options.syncService("enable", name);
    // A previously running oneshot is scheduled once, never resumed mid-write.
    // systemd serializes this same service even if the restored timer also fires.
    if (["active", "activating"].includes(previous.active)) await options.syncService("start", name);
  }
}
async function prepareSync(options, p, state, environmentFiles) {
  const worker = path.join(p.releaseDir, "apps/web/tline-worker/cli.mjs");
  requireValue(fs.existsSync(worker), "Candidate research worker is missing");
  state.tline = await captureSync(options, p.backup);
  state.tline.user = options.deployUser;
  state.phase = "preheating"; saveMetadata(p.metadata, state);
  await stopSync(options, state);
  const dataRoot = path.join(p.applicationRoot, "data");
  const data = path.join(dataRoot, "tline");
  for (const directory of [dataRoot, data]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o750 });
    requireValue(fs.realpathSync(directory) === directory && fs.lstatSync(directory).isDirectory(), "Unsafe research data directory");
    fs.chmodSync(directory, 0o750);
    await options.ownCache(directory, options.deployUser);
  }
  state.tline.file = path.join(data, "research.sqlite");
  const request = { worker, file: state.tline.file, user: options.deployUser, environmentFiles, releaseId: state.releaseId };
  if (fs.existsSync(request.file)) {
    // SQLite runs as the owner so root cannot create root-owned WAL/SHM files.
    // Stage inside the owner-only writable directory, then copy the CLOSED
    // consistent snapshot into root's protected backup (possibly another FS).
    const staging = path.join(data, `backup-${state.releaseId}.sqlite`);
    const result = await options.worker({ ...request, command: "backup", output: staging });
    requireValue(result?.status === "backed_up", "Research backup failed");
    fs.copyFileSync(staging, path.join(p.backup, "research.sqlite"), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(p.backup, "research.sqlite"), 0o600);
    fs.unlinkSync(staging);
    state.tline.backupComplete = true; saveMetadata(p.metadata, state);
  }
  const result = await options.worker({ ...request, command: "sync" });
  requireValue(result?.status === "synced" && validSuccess(result.lastSuccess), "Research warmup did not complete a sync");
  const status = await options.worker({ ...request, command: "status" });
  requireValue(validSuccess(status?.lastSuccess) && status.lastSuccess === result.lastSuccess, "Research warmup watermark is missing");
  state.tline.preheatComplete = true;
  state.tline.lastSuccess = status.lastSuccess;
  saveMetadata(p.metadata, state);
}
function installSync(options, p, state, environmentFiles) {
  requireValue(state.tline.preheatComplete, "Research preheat is required");
  const service = `[Unit]\nDescription=WaveKB research background synchronization\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nUser=${options.deployUser}\nWorkingDirectory=${p.current}\nEnvironmentFile=${environmentFiles.at(-1)}\nEnvironment=TLINE_RESEARCH_DB_PATH=${state.tline.file}\nExecStart=/usr/bin/env TLINE_RESEARCH_DB_PATH=${state.tline.file} /usr/bin/node ${p.current}/apps/web/tline-worker/cli.mjs sync\nTimeoutStartSec=540\nTimeoutStopSec=20\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${path.dirname(state.tline.file)}\nUMask=0077\n`;
  const timer = "[Unit]\nDescription=Sync WaveKB research every ten minutes\n\n[Timer]\nOnCalendar=*-*-* *:0/10:00\nPersistent=true\nUnit=wavekb-tline-sync.service\n\n[Install]\nWantedBy=timers.target\n";
  fs.writeFileSync(options.syncUnitFile, service); fs.chmodSync(options.syncUnitFile, 0o644);
  fs.writeFileSync(options.timerUnitFile, timer); fs.chmodSync(options.timerUnitFile, 0o644);
}
async function checkSync(options, state) {
  requireValue(state.tline?.preheatComplete && validSuccess(state.tline.lastSuccess), "Research preheat metadata is missing");
  const timer = await options.syncService("check", "timer");
  requireValue(timer?.next && timer.result === "success", "Research timer or worker check failed");
  const status = await options.worker({ command: "status", worker: path.join(state.releaseDir, "apps/web/tline-worker/cli.mjs"), file: state.tline.file, user: state.tline.user });
  requireValue(validSuccess(status?.lastSuccess), "Research catalogue is not ready");
}

export async function activate(options) {
  if (options.tlineApiKey !== undefined) requireValue(/^tli_[A-Za-z0-9_-]{20,200}$/.test(options.tlineApiKey), "Invalid Tline runtime credential");
  requireValue(shaPattern.test(options.sha) && shaPattern.test(options.baseSha), "Invalid candidate or live base SHA");
  requireValue(/^[a-z_][a-z0-9_-]*$/.test(options.deployUser), "Invalid service user");
  if (options.tline) await options.probe();
  if (options.tline) requireValue(options.tlineApiKey !== undefined, "Research warmup requires supplemental credential");
  const releaseId = `${options.sha}-${options.runId}-${options.runAttempt}`;
  const p = paths(options, releaseId);
  requireValue(!fs.existsSync(p.releaseDir) && !fs.existsSync(p.backup), "Release identity already exists; use a new run attempt");
  requireValue(fs.lstatSync(p.current).isSymbolicLink(), "Current service must be a symlink before automated deployment");
  const previousRelease = fs.realpathSync(p.current);
  requireValue(path.dirname(previousRelease) === p.releasesRoot, "Previous release is outside the managed releases directory");
  requireValue(fs.existsSync(options.environmentFile), "Existing environment file is required; never generated by deployment");
  requireValue(fs.existsSync(options.unitFile), "Existing service unit is required for exact rollback");
  await requireHealth(options, options.baseSha);
  const previousActive = await options.service("is-active");
  const previousEnabled = await options.service("is-enabled");
  requireValue(previousActive === "active", "Previous service must be healthy and active");
  checkArchive(options.archive);

  fs.mkdirSync(p.releaseDir, { recursive: false, mode: 0o755 });
  fs.chmodSync(p.releaseDir, 0o755);
  fs.mkdirSync(p.backup, { recursive: true, mode: 0o750 });
  // Preserve the complete old runtime, including .next/static and public assets.
  const archiveBackup = path.join(p.backup, "previous-release.tar.gz");
  execFileSync("tar", ["-czf", archiveBackup, "-C", previousRelease, "."]);
  fs.chmodSync(archiveBackup, 0o600);
  checkArchive(archiveBackup);
  fs.copyFileSync(options.unitFile, path.join(p.backup, "previous.service"));
  const previousUnitMode = fs.statSync(options.unitFile).mode & 0o777;
  fs.chmodSync(path.join(p.backup, "previous.service"), 0o600);
  const state = { releaseId, sha: options.sha, releaseDir: p.releaseDir, previousRelease, previousVersion: options.baseSha, previousActive, previousEnabled, previousUnitMode, phase: "prepared" };
  saveMetadata(p.metadata, state);

  try {
    // GNU tar applies a non-root test runner's umask unless permissions are
    // explicit, and the archive's '.' entry can overwrite releaseDir's mode.
    execFileSync("tar", ["-xzf", options.archive, "-C", p.releaseDir, "--no-same-owner", "--same-permissions"]);
    fs.chmodSync(p.releaseDir, 0o755);
    requireValue(fs.existsSync(path.join(p.releaseDir, "apps/web/server.js")), "Candidate server is missing");
    requireValue(fs.statSync(path.join(p.releaseDir, "apps/web/.next/static")).isDirectory(), "Candidate static assets are missing");
    // Next's image optimizer writes .next/cache/images at runtime. Keep that
    // writable state outside the root-owned immutable code and static release.
    const runtimeRoot = path.join(p.applicationRoot, "runtime");
    if (!fs.existsSync(runtimeRoot)) {
      fs.mkdirSync(runtimeRoot, { mode: 0o755 }); fs.chmodSync(runtimeRoot, 0o755);
    }
    requireValue(fs.realpathSync(runtimeRoot) === runtimeRoot && fs.statSync(runtimeRoot).isDirectory(), "Unsafe runtime cache root");
    const cacheDir = path.join(runtimeRoot, releaseId);
    const cacheLink = path.join(p.releaseDir, "apps/web/.next/cache");
    requireValue(!fs.existsSync(cacheLink), "Standalone candidate must omit mutable runtime cache");
    fs.mkdirSync(cacheDir, { mode: 0o750 }); fs.chmodSync(cacheDir, 0o750);
    await options.ownCache(cacheDir, options.deployUser);
    fs.symlinkSync(cacheDir, cacheLink);
    fs.writeFileSync(path.join(p.releaseDir, "DEPLOYMENT_VERSION"), options.sha + "\n", { flag: "wx", mode: 0o644 });
    fs.writeFileSync(path.join(p.releaseDir, "start-release.sh"), `#!/bin/sh\nexport DEPLOYMENT_VERSION='${options.sha}'\n${options.tline ? `export TLINE_RESEARCH_DB_PATH='${p.applicationRoot}/data/tline/research.sqlite'\n` : ""}exec /usr/bin/node apps/web/server.js\n`, { flag: "wx", mode: 0o755 });
    fs.chmodSync(path.join(p.releaseDir, "DEPLOYMENT_VERSION"), 0o644);
    fs.chmodSync(path.join(p.releaseDir, "start-release.sh"), 0o755);
    // systemd reads this as root. Never put credentials in the immutable code
    // archive or overwrite the site's existing environment file. Previous units
    // keep referencing their own protected files when rolled back.
    let supplementalEnvironment = "";
    const environmentFiles = [options.environmentFile];
    if (options.tlineApiKey !== undefined) {
      const secretFile = path.join(p.backup, "tline.env");
      fs.writeFileSync(secretFile, `TLINE_API_KEY=${options.tlineApiKey}\n`, { flag: "wx", mode: 0o600 });
      supplementalEnvironment = `EnvironmentFile=${secretFile}\n`;
      environmentFiles.push(secretFile);
    }
    if (options.tline) await prepareSync(options, p, state, environmentFiles);
    const unit = `[Unit]\nDescription=WaveKB Next.js production\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${options.deployUser}\nWorkingDirectory=${p.current}\nEnvironmentFile=${options.environmentFile}\nExecStart=${p.current}/start-release.sh\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${p.applicationRoot}\nUMask=0027\n\n[Install]\nWantedBy=multi-user.target\n`;
    // Arm durable rollback before changing the service file or current link.
    state.phase = "activating"; state.webMutated = true; saveMetadata(p.metadata, state);
    const webEnvironment = options.tline ? `Environment=TLINE_RESEARCH_DB_PATH=${state.tline.file}\nUnsetEnvironment=TLINE_API_KEY\n` : supplementalEnvironment;
    fs.writeFileSync(options.unitFile, unit.replace(`EnvironmentFile=${options.environmentFile}\n`, `EnvironmentFile=${options.environmentFile}\n${webEnvironment}`), { mode: 0o644 });
    if (options.tline) { state.tline.unitsInstalled = true; saveMetadata(p.metadata, state); installSync(options, p, state, environmentFiles); }
    replaceCurrent(p.current, p.releaseDir);
    await options.service("daemon-reload");
    await options.service("restart");
    await requireHealth(options, options.sha);
    if (options.tline) {
      await options.syncService("reset-failed", "service");
      await options.syncService("enable", "timer");
      await options.syncService("start", "timer");
      await checkSync(options, state);
    }
    state.phase = "awaiting-acceptance"; saveMetadata(p.metadata, state);
    return { releaseId, releaseDir: p.releaseDir };
  } catch (error) {
    await rollback({ ...options, releaseId });
    throw error;
  }
}

export async function rollbackAccepted(options) {
  return rollback({ ...options, acceptedRollback: true });
}

export async function rollback(options) {
  const p = paths(options, options.releaseId);
  if (options.acceptedRollback) requireValue(fs.existsSync(p.metadata), "Accepted rollback metadata is missing");
  if (!fs.existsSync(p.metadata)) return; // No production mutation was armed.
  const state = JSON.parse(fs.readFileSync(p.metadata, "utf8"));
  if (options.acceptedRollback) {
    requireValue(state.phase === "accepted", "Explicit rollback requires an accepted release");
    requireValue(shaPattern.test(options.confirmedPreviousVersion) && options.confirmedPreviousVersion === state.previousVersion, "Previous SHA confirmation is missing or incorrect");
  } else if (state.phase === "rolled-back" || state.phase === "accepted") return;
  requireValue(state.releaseId === options.releaseId && state.releaseDir === p.releaseDir, "Invalid rollback metadata");
  requireValue(path.dirname(state.previousRelease) === p.releasesRoot && state.previousRelease !== p.releaseDir, "Unsafe previous release in rollback metadata");
  requireValue(shaPattern.test(state.previousVersion), "Missing exact previous version metadata");
  if (state.phase === "prepared") {
    state.phase = "rolled-back"; saveMetadata(p.metadata, state);
    return; // Candidate extraction failed before any service mutation.
  }
  const current = fs.realpathSync(p.current);
  if (options.acceptedRollback) requireValue(current === p.releaseDir, "The exact candidate must still be current for accepted rollback");
  requireValue(current === p.releaseDir || current === state.previousRelease, "Another release is current; refusing to overwrite it");
  requireValue(fs.existsSync(path.join(p.backup, "previous.service")), "Previous service backup is missing");
  if (!fs.existsSync(state.previousRelease)) {
    checkArchive(path.join(p.backup, "previous-release.tar.gz"));
    fs.mkdirSync(state.previousRelease, { mode: 0o755 });
    execFileSync("tar", ["-xzf", path.join(p.backup, "previous-release.tar.gz"), "-C", state.previousRelease, "--same-permissions"]);
  }
  // Explicit authorization has passed. Persist recovery intent before touching
  // the service so an interrupted restoration can resume with normal rollback.
  state.phase = "rolling-back"; saveMetadata(p.metadata, state);
  if (state.tline?.unitsInstalled) await stopSync(options, state);
  if (state.webMutated || !state.tline) {
    fs.copyFileSync(path.join(p.backup, "previous.service"), options.unitFile);
    fs.chmodSync(options.unitFile, state.previousUnitMode);
    replaceCurrent(p.current, state.previousRelease);
    await options.service("daemon-reload");
    await options.service(state.previousActive === "active" ? "restart" : "stop");
    if (state.previousActive === "active") await requireHealth(options, state.previousVersion);
  }
  if (state.tline) await restoreSync(options, state, p.backup);
  state.phase = "rolled-back"; saveMetadata(p.metadata, state);
}

export async function finalize(options) {
  requireValue(options.accepted === true, "External acceptance must succeed before finalize");
  const p = paths(options, options.releaseId);
  const state = JSON.parse(fs.readFileSync(p.metadata, "utf8"));
  requireValue(state.phase === "awaiting-acceptance", "Release is not awaiting acceptance");
  const current = fs.realpathSync(p.current);
  requireValue(current === p.releaseDir, "Another release is current; refusing cleanup");
  await requireHealth(options, state.sha);
  if (state.tline) await checkSync(options, state);
  state.phase = "accepted"; saveMetadata(p.metadata, state);
  for (const entry of fs.readdirSync(p.releasesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !releasePattern.test(entry.name)) continue;
    const candidate = path.join(p.releasesRoot, entry.name);
    if (candidate === current || candidate === state.previousRelease) continue;
    if (fs.statSync(candidate).mtimeMs < Date.now() - 14 * 86400_000) fs.rmSync(candidate, { recursive: true });
  }
  // Backup and rollback metadata are intentionally retained; no env or gateway cleanup.
}

async function main() {
  const [command, sha, runId, runAttempt, argument5, argument6, baseSha] = process.argv.slice(2);
  if (command === "rollback-accepted") requireValue(argument5 === "--confirm-previous-version", "Explicit previous SHA confirmation flag is required");
  const deployUser = command === "activate" ? argument5 : undefined;
  const archive = command === "activate" ? argument6 : undefined;
  const tlineApiKey = command === "activate" ? fs.readFileSync(0, "utf8").trim() : undefined;
  if (command === "activate") requireValue(/^tli_[A-Za-z0-9_-]{20,200}$/.test(tlineApiKey), "Tline credential is required on activation stdin");
  const options = {
    sha, runId, runAttempt, deployUser, archive, baseSha, tlineApiKey,
    confirmedPreviousVersion: command === "rollback-accepted" ? argument6 : undefined,
    releaseId: `${sha}-${runId}-${runAttempt}`, accepted: command === "finalize",
    applicationRoot: "/srv/wavekb-next-preview",
    backupRoot: "/var/backups/wavekb-next-production",
    unitFile: "/etc/systemd/system/wavekb-next-preview.service",
    environmentFile: "/etc/wavekb/next-preview.env",
    tline: true,
    syncUnitFile: "/etc/systemd/system/wavekb-tline-sync.service",
    timerUnitFile: "/etc/systemd/system/wavekb-tline-sync.timer",
    ...productionResearchAdapter(),
    ownCache: async (directory, user) => {
      const uid = Number(execFileSync("id", ["-u", user], { encoding: "utf8" }).trim());
      const gid = Number(execFileSync("id", ["-g", user], { encoding: "utf8" }).trim());
      requireValue(Number.isInteger(uid) && Number.isInteger(gid), "Service cache owner could not be resolved");
      fs.chownSync(directory, uid, gid);
    },
    service: async (action) => {
      const args = action === "daemon-reload" ? [action] : [action, serviceName];
      return execFileSync("systemctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    },
    health: async (expectedVersion) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const response = await fetch("http://127.0.0.1:3100/api/health", { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const health = await response.json();
            if (health.ok === true && health.deployment === expectedVersion) return health;
          }
        } catch { /* Startup can temporarily refuse connections; never print payloads. */ }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("Local health endpoint did not become available");
    },
  };
  requireValue(["activate", "rollback", "rollback-accepted", "finalize"].includes(command), "Expected activate, rollback, rollback-accepted or finalize");
  await ({ activate, rollback, "rollback-accepted": rollbackAccepted, finalize }[command])(options);
  console.log(`Release ${command} completed.`);
}

// Injectable command/time boundary lets fixtures exercise permission and timeout
// decisions without calling systemd, changing users or contacting upstream.
export function productionResearchAdapter({ execute = execFileSync, now = Date.now, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const run = (command, args, options = {}) => execute(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, ...options }).trim();
  const show = (unit, properties) => {
    let output;
    try { output = run("systemctl", ["show", unit, ...properties.flatMap((property) => ["-p", property])]); }
    catch (error) {
      const absent = String(error.stdout ?? "");
      if (error.status !== 1 || !/^LoadState=not-found$/m.test(absent) || !/^ActiveState=inactive$/m.test(absent) || !/^FragmentPath=$/m.test(absent)) throw error;
      output = absent;
    }
    return Object.fromEntries(output.split("\n").map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
  };
  const state = (name) => {
    const unit = `wavekb-tline-sync.${name}`;
    const value = show(unit, ["LoadState", "ActiveState", "UnitFileState", "FragmentPath", "DropInPaths"]);
    if (value.LoadState === "not-found") return { exists: false, active: "inactive", enabled: "disabled" };
    requireValue(value.LoadState === "loaded" && value.FragmentPath === `/etc/systemd/system/${unit}` && !value.DropInPaths, "Unmanaged or invalid sync unit");
    return { exists: true, active: value.ActiveState, enabled: value.UnitFileState };
  };
  return {
    probe: async () => {
      run("/usr/bin/node", ["--input-type=module", "-e", 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<18)) throw Error("Node 22.18 required"); const {DatabaseSync}=await import("node:sqlite"); const db=new DatabaseSync(":memory:"); db.exec("CREATE TABLE probe (n INTEGER); INSERT INTO probe VALUES (1)"); if(db.prepare("SELECT n FROM probe").get().n!==1) throw Error("SQLite unavailable"); db.close();']);
    },
    syncService: async (action, name) => {
      requireValue(["service", "timer"].includes(name), "Invalid research unit");
      const unit = `wavekb-tline-sync.${name}`;
      if (action === "state") return state(name);
      if (action === "wait-idle") {
        const deadline = now() + 540_000;
        while (true) {
          const current = state(name);
          if (!current.exists || ["inactive", "failed"].includes(current.active)) return;
          requireValue(["active", "activating", "deactivating"].includes(current.active), "Unknown writer state");
          requireValue(now() < deadline, "Timed out waiting for research writer; do not kill or clear its lease");
          await pause(1_000);
        }
      }
      if (action === "check") {
        const timer = state("timer");
        const next = show(unit, ["NextElapseUSecRealtime"]).NextElapseUSecRealtime;
        const result = show("wavekb-tline-sync.service", ["Result"]).Result;
        requireValue(timer.active === "active" && timer.enabled === "enabled" && next && next !== "n/a", "Research timer has no next schedule");
        return { next, result };
      }
      requireValue(["enable", "disable", "start", "stop", "reset-failed"].includes(action), "Invalid research service action");
      // Restore a prior active writer through systemd's serialized job queue.
      return run("systemctl", [action, ...(action === "start" && name === "service" ? ["--no-block"] : []), unit]);
    },
    worker: async ({ command, worker, file, output, user, environmentFiles = [], releaseId }) => {
      let result;
      if (command === "sync") {
        requireValue(releasePattern.test(releaseId) && environmentFiles.length > 0, "Missing warmup identity/environment");
        // Worker needs only TLINE_API_KEY, from the supplemental protected file.
        // systemd reads it as root; neither runuser nor the worker reads that file.
        result = run("systemd-run", ["--quiet", "--wait", "--pipe", "--collect", `--unit=wavekb-tline-warmup-${releaseId}`, `--uid=${user}`,
          "--property=Type=oneshot", "--property=TimeoutStartSec=540", "--property=TimeoutStopSec=20", "--property=NoNewPrivileges=true", "--property=PrivateTmp=true", "--property=ProtectSystem=strict", "--property=ProtectHome=true", "--property=UMask=0077", `--property=ReadWritePaths=${path.dirname(file)}`,
          `--property=EnvironmentFile=${environmentFiles.at(-1)}`, "--", "/usr/bin/env", `TLINE_RESEARCH_DB_PATH=${file}`, "/usr/bin/node", worker, "sync"], { timeout: 570_000 });
      } else {
        requireValue(["status", "backup"].includes(command), "Invalid research worker operation");
        result = run("runuser", ["-u", user, "--", "/usr/bin/env", "-i", `TLINE_RESEARCH_DB_PATH=${file}`, "/usr/bin/node", worker, command, ...(output ? [output] : [])], { timeout: 120_000 });
      }
      return JSON.parse(result);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Release transaction failed; retained backup metadata requires review. No environment values are logged."); process.exitCode = 1; });
}
