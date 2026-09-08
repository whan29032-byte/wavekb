import fs from "node:fs";
import path from "node:path";

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

// Only emit allow-listed operational state. Never print environment files,
// commands, journal text, API payloads, or credential-bearing exceptions.
console.log(JSON.stringify({
  releaseId,
  phase: typeof state.phase === "string" ? state.phase : "unknown",
  webMutated: state.webMutated === true,
  previousVersionMatchesShape: /^[0-9a-f]{40}$/.test(state.previousVersion ?? ""),
  tline: state.tline ? {
    backupComplete: state.tline.backupComplete === true,
    preheatComplete: state.tline.preheatComplete === true,
    hasLastSuccess: typeof state.tline.lastSuccess === "string" && Number.isFinite(Date.parse(state.tline.lastSuccess)),
    unitsInstalled: state.tline.unitsInstalled === true,
  } : null,
  candidate: {
    root: fileState(candidate),
    server: fileState(path.join(candidate, "apps/web/server.js")),
    static: fileState(path.join(candidate, "apps/web/.next/static")),
    cache: fileState(path.join(candidate, "apps/web/.next/cache")),
    launcher: fileState(path.join(candidate, "start-release.sh")),
  },
}));
