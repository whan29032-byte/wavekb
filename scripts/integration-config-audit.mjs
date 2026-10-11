import fs from "node:fs";
import { fileURLToPath } from "node:url";

const allowed = ["MENTOR_EMAIL_API_KEY", "MENTOR_EMAIL_FROM", "MENTOR_EMAIL_ENABLED", "YOUTUBE_SYNC_ENABLED", "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_OAUTH_REDIRECT_URI", "YOUTUBE_TOKEN_MASTER_KEY",
  "MEMBERSHIP_WALLET_ENABLED", "MEMBERSHIP_WALLET_ETHEREUM_RPC_URL", "MEMBERSHIP_WALLET_BASE_RPC_URL", "MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS", "MEMBERSHIP_WALLET_TRONGRID_API_KEY", "MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE"];

export function integrationConfigPresence(source) {
  const presence = Object.fromEntries(allowed.map((key) => [key, false]));
  const seen = new Set();
  let walletSetting = "false";
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !allowed.includes(match[1])) continue;
    if (seen.has(match[1])) throw new Error("duplicate_integration_setting");
    seen.add(match[1]);
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    presence[match[1]] = Boolean(value.trim());
    if (match[1] === "MEMBERSHIP_WALLET_ENABLED") walletSetting = value;
  }
  return { inspected_at: new Date().toISOString(), configuration_presence: presence,
    wallet_flag_valid: walletSetting === "true" || walletSetting === "false", wallet_enabled: walletSetting === "true" };
}

const workerProperties = {
  LoadState: new Set(["loaded", "not-found", "masked", "error", "bad-setting", "merged", "stub"]),
  ActiveState: new Set(["active", "inactive", "activating", "deactivating", "failed", "reloading", "maintenance", "refreshing"]),
  SubState: new Set(["running", "exited", "dead", "failed", "waiting", "elapsed", "start", "start-pre", "start-post", "stop", "stop-sigterm", "stop-sigkill", "stop-post", "auto-restart", "reload", "plugged", "listening"]),
};

// The workflow supplies only the output of one fixed, read-only systemctl show.
// This module never starts a process, imports a worker or relays its raw input.
export function workerServiceState(source) {
  const result = { worker: { service: "elliott-wave-ai-worker.service", probe_succeeded: false, loaded: false, active: false, running: false } };
  if (typeof source !== "string" || source.length > 4096) return result;
  const fields = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line) continue;
    const match = line.match(/^(LoadState|ActiveState|SubState)=([a-z-]+)$/);
    if (!match || fields.has(match[1]) || !workerProperties[match[1]].has(match[2])) return result;
    fields.set(match[1], match[2]);
  }
  if (fields.size !== 3) return result;
  result.worker.probe_succeeded = true;
  result.worker.loaded = fields.get("LoadState") === "loaded";
  result.worker.active = result.worker.loaded && fields.get("ActiveState") === "active";
  result.worker.running = result.worker.active && fields.get("SubState") === "running";
  return result;
}

if (process.argv[1] === "-" || process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--worker-state") console.info(JSON.stringify(workerServiceState(fs.readFileSync(0, "utf8"))));
    else if (process.argv.length === 2) console.info(JSON.stringify(integrationConfigPresence(fs.readFileSync("/etc/elliott-wave/gateway.env", "utf8"))));
    else throw new Error("invalid_probe_arguments");
  }
  catch { console.error("integration_configuration_probe_failed"); process.exitCode = 1; }
}
