import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 4096;
const fields = ["ok", "operation", "enabled", "workerRunning", "ethereumReady", "baseReady", "tronReady", "changed"];
const fail = () => { throw new Error("wallet_configuration_receipt_invalid"); };

export function projectWalletConfigurationReceipt(bytes, operation) {
  if (!["enable", "probe"].includes(operation) || !(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) fail();
  let text, result;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); result = JSON.parse(text); }
  catch { fail(); }
  if (!result || typeof result !== "object" || Array.isArray(result) || text !== JSON.stringify(result)
    || Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key))
    || result.ok !== true || result.operation !== operation || typeof result.enabled !== "boolean" || typeof result.changed !== "boolean"
    || ["workerRunning", "ethereumReady", "baseReady", "tronReady"].some(key => result[key] !== true)
    || operation === "enable" && result.enabled !== true || operation === "probe" && result.changed !== false) fail();
  return result;
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1])); }
  catch { return false; }
}
if (isMain()) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--operation") fail();
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_BYTES) { process.stdin.destroy(); fail(); }
      chunks.push(chunk);
    }
    process.stdout.write(`${JSON.stringify(projectWalletConfigurationReceipt(Buffer.concat(chunks), process.argv[3]))}\n`);
  } catch { process.stderr.write("wallet_configuration_receipt_invalid\n"); process.exitCode = 1; }
}
