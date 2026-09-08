import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const releaseId = process.argv[2] ?? "";
const releasePattern = /^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$/;
if (!releasePattern.test(releaseId)) throw new Error("Invalid release identity");

const applicationRoot = "/srv/wavekb-next-preview";
const backupRoot = "/var/backups/wavekb-next-production";
const backup = path.join(backupRoot, releaseId);
const metadataFile = path.join(backup, "rollback.json");
if (!fs.existsSync(metadataFile)) throw new Error("Rollback metadata is missing");

const state = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
if (state.releaseId !== releaseId) throw new Error("Rollback metadata identity mismatch");

const candidate = path.join(applicationRoot, "releases", releaseId);
const fileState = (file) => {
  try {
    const value = fs.lstatSync(file);
    return { exists: true, mode: (value.mode & 0o777).toString(8), kind: value.isDirectory() ? "directory" : value.isFile() ? "file" : value.isSymbolicLink() ? "symlink" : "other" };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
};

const [, sha, runId, attempt] = releaseId.match(/^([0-9a-f]{40})-([1-9][0-9]*)-([1-9][0-9]*)$/) ?? [];
const serviceUser = state.tline?.user;
if (!/^[a-z_][a-z0-9_-]*$/.test(serviceUser ?? "")) throw new Error("Invalid retained service user");
const unit = `wavekb-next-diagnostic-${runId}-${attempt}.service`;
const port = 39000 + (Number(runId) % 1000);
const properties = ["LoadState", "ActiveState", "SubState", "Result", "ExecMainCode", "ExecMainStatus"];
let probe = { healthy: false, status: "not-started" };
try {
  execFileSync("systemd-run", ["--quiet", "--collect", `--unit=${unit}`, `--uid=${serviceUser}`, `--working-directory=${candidate}`,
    "--property=Type=simple", "--property=NoNewPrivileges=true", "--property=PrivateTmp=true", "--property=ProtectSystem=strict", "--property=ProtectHome=true",
    `--property=ReadWritePaths=${applicationRoot}`, "--property=UMask=0027", "--property=EnvironmentFile=/etc/wavekb/next-preview.env", "--property=UnsetEnvironment=TLINE_API_KEY",
    "/usr/bin/env", `PORT=${port}`, "HOSTNAME=127.0.0.1", path.join(candidate, "start-release.sh")],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  for (let index = 0; index < 20; index++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      const health = response.ok ? await response.json() : null;
      if (health?.ok === true && health.deployment === sha) { probe = { healthy: true, status: "version-matched" }; break; }
    } catch { /* The isolated candidate can refuse connections while starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!probe.healthy) {
    const output = execFileSync("systemctl", ["show", unit, ...properties.flatMap((property) => ["-p", property])], { encoding: "utf8" });
    probe = { healthy: false, status: "health-unavailable", unit: Object.fromEntries(output.trim().split("\n").map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; })) };
  }
} finally {
  try { execFileSync("systemctl", ["stop", unit], { stdio: "ignore", timeout: 30_000 }); } catch { /* A completed transient unit needs no stop. */ }
  try { execFileSync("systemctl", ["reset-failed", unit], { stdio: "ignore", timeout: 30_000 }); } catch { /* --collect may already have removed it. */ }
}

// Only emit allow-listed operational state. The isolated probe receives no
// environment file or credential, and journal/application text is never read.
console.log(JSON.stringify({
  releaseId,
  phase: typeof state.phase === "string" ? state.phase : "unknown",
  diagnosticStage: typeof state.diagnosticStage === "string" ? state.diagnosticStage : "unrecorded",
  webMutated: state.webMutated === true,
  previousVersionMatchesShape: /^[0-9a-f]{40}$/.test(state.previousVersion ?? ""),
  tline: state.tline ? {
    backupComplete: state.tline.backupComplete === true,
    preheatComplete: state.tline.preheatComplete === true,
    hasLastSuccess: typeof state.tline.lastSuccess === "string" && Number.isFinite(Date.parse(state.tline.lastSuccess)),
    unitsInstalled: state.tline.unitsInstalled === true,
    previousUnits: Object.fromEntries(Object.entries(state.tline.units ?? {}).map(([name, value]) => [name, {
      exists: value?.exists === true,
      active: ["active", "activating", "inactive", "failed"].includes(value?.active) ? value.active : "unknown",
      enabled: ["enabled", "disabled", "static"].includes(value?.enabled) ? value.enabled : "unknown",
    }])),
  } : null,
  candidate: {
    root: fileState(candidate),
    server: fileState(path.join(candidate, "apps/web/server.js")),
    static: fileState(path.join(candidate, "apps/web/.next/static")),
    cache: fileState(path.join(candidate, "apps/web/.next/cache")),
    launcher: fileState(path.join(candidate, "start-release.sh")),
  },
  probe,
}));
