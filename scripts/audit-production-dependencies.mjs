import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const severityLevels = ["info", "low", "moderate", "high", "critical"];

// A registry outage, malformed response or unexpected pnpm exit is a failed
// verification. No severity threshold or advisory allowlist bypasses this gate.
export function verifyProductionAudit({ stdout, status, signal, error }) {
  if (error || signal || !Number.isInteger(status)) throw new Error("Production dependency audit did not complete");
  let report;
  try { report = JSON.parse(stdout); }
  catch { throw new Error("Production dependency audit returned invalid JSON"); }
  if (report?.error || report?.errors) throw new Error("Production dependency audit registry reported an error");
  const counts = report?.metadata?.vulnerabilities;
  const advisories = report?.advisories;
  if (!counts || !advisories || Array.isArray(advisories) || typeof advisories !== "object"
    || severityLevels.some((level) => !Number.isSafeInteger(counts[level]) || counts[level] < 0)) {
    throw new Error("Production dependency audit response is incomplete");
  }
  const total = severityLevels.reduce((sum, level) => sum + counts[level], 0);
  if (total > 0 || Object.keys(advisories).length > 0) {
    const summary = severityLevels.filter((level) => counts[level] > 0).map((level) => `${counts[level]} ${level}`).join(", ");
    throw new Error(`Production dependency vulnerabilities must be repaired: ${summary || "advisory records present"}`);
  }
  if (status !== 0) throw new Error("Production dependency audit failed without a valid clean result");
  return "Production dependency audit passed: zero vulnerability records";
}

export function auditProductionDependencies(run = spawnSync) {
  const result = run("pnpm", ["audit", "--prod", "--json", "--registry=https://registry.npmjs.org"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
  });
  return verifyProductionAudit(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(auditProductionDependencies()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
