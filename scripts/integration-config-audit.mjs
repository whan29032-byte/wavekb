import fs from "node:fs";
import { fileURLToPath } from "node:url";

const allowed = ["MENTOR_EMAIL_API_KEY", "MENTOR_EMAIL_FROM", "MENTOR_EMAIL_ENABLED", "YOUTUBE_SYNC_ENABLED", "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_OAUTH_REDIRECT_URI", "YOUTUBE_TOKEN_MASTER_KEY"];

export function integrationConfigPresence(source) {
  const presence = Object.fromEntries(allowed.map((key) => [key, false]));
  const seen = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !allowed.includes(match[1])) continue;
    if (seen.has(match[1])) throw new Error("duplicate_integration_setting");
    seen.add(match[1]);
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    presence[match[1]] = Boolean(value.trim());
  }
  return { inspected_at: new Date().toISOString(), configuration_presence: presence };
}

if (process.argv[1] === "-" || process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.info(JSON.stringify(integrationConfigPresence(fs.readFileSync("/etc/elliott-wave/gateway.env", "utf8")))); }
  catch { console.error("integration_configuration_probe_failed"); process.exitCode = 1; }
}
