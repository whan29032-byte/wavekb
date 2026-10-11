import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const YOUTUBE_RECEIPT_MAX_BYTES = 4096;
const operations = new Set(["stage", "enable", "disable"]);
const fields = ["ok", "configured", "enabled", "generatedMasterKey", "changed", "appliedToRunningServices", "workerActive"];
const fail = () => { throw new Error("youtube_configuration_receipt_invalid"); };

/** Only a complete, operation-bound service receipt can pass the deployment gate. */
export function projectYouTubeConfigurationReceipt(bytes, operation) {
  if (!operations.has(operation) || !(bytes instanceof Uint8Array) || bytes.byteLength > YOUTUBE_RECEIPT_MAX_BYTES) fail();
  let text, result;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); result = JSON.parse(text); }
  catch { fail(); }
  if (!result || typeof result !== "object" || Array.isArray(result) || text !== JSON.stringify(result)
    || Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key))
    || result.ok !== true || typeof result.generatedMasterKey !== "boolean" || typeof result.changed !== "boolean"
    || result.appliedToRunningServices !== true || typeof result.workerActive !== "boolean"
    || result.enabled !== (operation === "enable") || result.configured !== (operation === "disable" ? null : true)
    || operation !== "stage" && result.generatedMasterKey !== false || operation === "enable" && result.workerActive !== true) fail();
  return { ok: true, operation, enabled: result.enabled,
    readiness: operation === "stage" ? "staged_not_enabled" : operation === "enable" ? "enabled_services_verified" : "disabled_services_verified" };
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1])); }
  catch { return false; }
}
if (isMain()) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--operation") fail();
    const chunks = []; let length = 0;
    for await (const raw of process.stdin) {
      const chunk = Buffer.from(raw); length += chunk.length;
      if (length > YOUTUBE_RECEIPT_MAX_BYTES) { process.stdin.destroy(); fail(); }
      chunks.push(chunk);
    }
    const result = projectYouTubeConfigurationReceipt(Buffer.concat(chunks), process.argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { process.stderr.write("youtube_configuration_receipt_invalid\n"); process.exitCode = 1; }
}
