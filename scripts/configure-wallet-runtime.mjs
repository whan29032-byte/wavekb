import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const WALLET_ENDPOINTS = Object.freeze({ ethereum: "https://ethereum-rpc.publicnode.com", base: "https://base-rpc.publicnode.com" });
export const WALLET_ALLOWED_HOSTS = "ethereum-rpc.publicnode.com,base-rpc.publicnode.com";
export const WALLET_TIMEOUT_MS = 8000;
export const WALLET_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const WALLET_FINALIZED_MAX_AGE_MS = 30 * 60 * 1000;
export const WALLET_TRON_MAX_AGE_MS = 5 * 60 * 1000;
const ENV_MAX_BYTES = 1024 * 1024;
const UNIT = "elliott-wave-ai-worker.service";
const CURRENT = "/opt/elliott-wave-gateway/current";
const fields = Object.freeze({ MEMBERSHIP_WALLET_ENABLED: "true", MEMBERSHIP_WALLET_ETHEREUM_RPC_URL: WALLET_ENDPOINTS.ethereum,
  MEMBERSHIP_WALLET_BASE_RPC_URL: WALLET_ENDPOINTS.base, MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS: WALLET_ALLOWED_HOSTS });
const codes = new Set(["invalid_arguments", "unsafe_env_file", "unsafe_backup_file", "unsupported_env_format", "runtime_configuration_busy",
  "wallet_configuration_invalid", "runtime_revision_mismatch", "worker_inactive", "worker_verification_failed", "worker_restart_failed",
  "ethereum_preflight_failed", "base_preflight_failed", "tron_preflight_failed", "environment_changed", "runtime_write_failed",
  "rollback_conflict", "runtime_rollback_failed"]);
export class WalletRuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
function fail(code) { throw new WalletRuntimeError(code); }
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function currentUid() { if (!process.getuid) fail("unsafe_env_file"); return process.getuid(); }
function safeParent(filename, code) {
  if (typeof filename !== "string" || filename.length > 4096 || !path.isAbsolute(filename) || path.resolve(filename) !== filename || filename.includes("\0")) fail(code);
  try {
    const parent = path.dirname(filename), stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid() || (stat.mode & 0o022) !== 0 || fs.realpathSync(parent) !== parent) fail(code);
  } catch { fail(code); }
}
function safeRegular(stat, code) {
  if (!stat.isFile() || stat.uid !== currentUid() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1) fail(code);
}
function readOwned(filename, code = "unsafe_env_file") {
  safeParent(filename, code); let fd;
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) fail(code);
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd); safeRegular(before, code);
    if (before.size > ENV_MAX_BYTES) fail(code);
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd); safeRegular(after, code);
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("environment_changed");
    return bytes;
  } catch (error) { if (error instanceof WalletRuntimeError) throw error; fail(code); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function requireNewBackup(filename) {
  safeParent(filename, "unsafe_backup_file");
  try { fs.lstatSync(filename); } catch (error) { if (error.code === "ENOENT") return; fail("unsafe_backup_file"); }
  fail("unsafe_backup_file");
}
function parseEnvironment(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("unsupported_env_format"); }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || text.includes("\0") || text.replaceAll("\r\n", "").includes("\r")) fail("unsupported_env_format");
  const env = Object.create(null), lines = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|$)/gu)) {
    const raw = match[1], ending = match[2];
    if (!raw && !ending && match.index === text.length) continue;
    if (/^\s*(?:[#;].*)?$/u.test(raw)) { lines.push({ raw, ending }); continue; }
    const assignment = /^([ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*)(.*?)([ \t]*)$/u.exec(raw);
    if (!assignment || Object.hasOwn(env, assignment[2])) fail("unsupported_env_format");
    const [, prefix, key, encoded, suffix] = assignment;
    let value = encoded, quote = "";
    if (encoded.startsWith("'") || encoded.startsWith('"')) {
      quote = encoded[0];
      if (encoded.length < 2 || !encoded.endsWith(quote)) fail("unsupported_env_format");
      value = encoded.slice(1, -1);
      if (value.includes(quote) || quote === '"' && value.includes("\\")) fail("unsupported_env_format");
    } else if (/[\\'"]/u.test(value)) fail("unsupported_env_format");
    env[key] = value; lines.push({ raw, ending, prefix, key, quote, suffix });
  }
  return { env, lines };
}
function candidateEnvironment(parsed) {
  const env = parsed.env;
  if (![undefined, "", "true", "false"].includes(env.MEMBERSHIP_WALLET_ENABLED)) fail("wallet_configuration_invalid");
  for (const key of ["MEMBERSHIP_WALLET_ETHEREUM_RPC_URL", "MEMBERSHIP_WALLET_BASE_RPC_URL"]) {
    if (env[key] && env[key] !== fields[key]) fail("wallet_configuration_invalid");
  }
  if (env.MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS) {
    const hosts = env.MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS.split(",").map(value => value.trim());
    if (hosts.length !== 2 || new Set(hosts).size !== 2 || !hosts.every(host => WALLET_ALLOWED_HOSTS.split(",").includes(host))) fail("wallet_configuration_invalid");
  }
  const key = env.MEMBERSHIP_WALLET_TRONGRID_API_KEY;
  if (key && (key.length > 512 || /\s/.test(key))) fail("wallet_configuration_invalid");
  const batch = env.MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE;
  if (batch && (!/^(?:[1-9]|10)$/.test(batch))) fail("wallet_configuration_invalid");
  const values = Object.fromEntries(Object.entries(fields).map(([name, fallback]) => [name, name === "MEMBERSHIP_WALLET_ENABLED" ? "true" : env[name] || fallback]));
  const remaining = new Set(Object.keys(values)), newline = parsed.lines.find(line => line.ending)?.ending ?? "\n";
  let output = parsed.lines.map(line => line.key && remaining.delete(line.key)
    ? `${line.prefix}${line.quote}${values[line.key]}${line.quote}${line.suffix}${line.ending}` : `${line.raw}${line.ending}`).join("");
  for (const name of remaining) { if (output && !output.endsWith("\n")) output += newline; output += `${name}=${values[name]}${newline}`; }
  return Buffer.from(output);
}
function writeNew(filename, bytes) {
  let fd, created = false, complete = false;
  try {
    fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = true; safeRegular(fs.fstatSync(fd), "unsafe_backup_file"); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); complete = true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created && !complete) { try { fs.unlinkSync(filename); } catch { /* Static diagnostics only. */ } }
  }
}
function syncParent(filename) { const fd = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomicReplace(filename, bytes, expected, conflict) {
  const directory = fs.mkdtempSync(path.join(path.dirname(filename), ".wavekb-wallet-runtime-")); fs.chmodSync(directory, 0o700);
  const staged = path.join(directory, "gateway.env");
  try {
    writeNew(staged, bytes); if (!readOwned(filename).equals(expected)) fail(conflict);
    fs.renameSync(staged, filename); syncParent(filename);
  } finally { try { fs.unlinkSync(staged); } catch { /* Already moved. */ } try { fs.rmdirSync(directory); } catch { /* Preserve unexpected files. */ } }
}

export function inspectWalletWorker(value) {
  if (typeof value !== "string" || value.length > 4096) return { running: false, pid: 0 };
  const entries = new Map();
  for (const line of value.trim().split("\n")) {
    const pair = /^(LoadState|ActiveState|SubState|MainPID)=([^\r\n=]*)$/u.exec(line);
    if (!pair || entries.has(pair[1])) return { running: false, pid: 0 };
    entries.set(pair[1], pair[2]);
  }
  const pid = entries.get("MainPID") ?? "";
  const running = entries.size === 4 && entries.get("LoadState") === "loaded" && entries.get("ActiveState") === "active"
    && entries.get("SubState") === "running" && /^[1-9][0-9]{0,9}$/.test(pid) && Number(pid) <= 2147483647;
  return { running, pid: running ? Number(pid) : 0 };
}
function boundedFile(filename, max) {
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(fd).isFile()) return null;
    const chunks = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(16384, max + 1 - size)), read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!read) return Buffer.concat(chunks);
      size += read; if (size > max) return null; chunks.push(chunk.subarray(0, read));
    }
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function productionServices() {
  function revision(expected) {
    try {
      const release = fs.realpathSync(CURRENT), filename = path.join(release, "DEPLOYMENT_VERSION"); safeParent(filename, "runtime_revision_mismatch");
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== currentUid() || (stat.mode & 0o022) !== 0 || stat.nlink !== 1) return false;
      const bytes = boundedFile(filename, 128); return bytes !== null && bytes.toString("utf8").trim() === expected;
    } catch { return false; }
  }
  return {
    revision: async expected => revision(expected),
    inspect: async () => {
      try { return inspectWalletWorker(execFileSync("/usr/bin/systemctl", ["show", UNIT, "--property=LoadState,ActiveState,SubState,MainPID"], { encoding: "utf8", timeout: 10000, maxBuffer: 4096, stdio: ["ignore", "pipe", "ignore"] })); }
      catch { return { running: false, pid: 0 }; }
    },
    restart: async () => { execFileSync("/usr/bin/systemctl", ["restart", UNIT], { timeout: 20000, stdio: "ignore" }); },
    matches: async (pid, env, expected) => {
      try {
        if (!Number.isSafeInteger(pid) || pid < 1 || !revision(expected) || fs.realpathSync(`/proc/${pid}/cwd`) !== fs.realpathSync(CURRENT)) return false;
        const cmdline = boundedFile(`/proc/${pid}/cmdline`, 4096), bytes = boundedFile(`/proc/${pid}/environ`, ENV_MAX_BYTES);
        if (!cmdline || !bytes) return false;
        const args = cmdline.toString("utf8").split("\0").filter(Boolean);
        if (args.length !== 2 || path.basename(args[0]) !== "node" || args[1] !== "src/worker-main.ts") return false;
        const running = Object.create(null);
        for (const pair of new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0").filter(Boolean)) {
          const separator = pair.indexOf("="); if (separator < 1) return false;
          const name = pair.slice(0, separator); if (Object.hasOwn(running, name)) return false; running[name] = pair.slice(separator + 1);
        }
        return [...Object.keys(fields), "MEMBERSHIP_WALLET_TRONGRID_API_KEY", "MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE"]
          .every(name => Object.hasOwn(env, name) === Object.hasOwn(running, name)
            && (!Object.hasOwn(env, name) || env[name] === running[name]));
      } catch { return false; }
    },
  };
}

async function jsonRequest(url, payload, headers, deps) {
  const controller = new AbortController(); let reader, timer;
  const cancel = body => { try { Promise.resolve(reader ? reader.cancel() : body?.cancel()).catch(() => undefined); } catch { /* Static failure only. */ } };
  const deadline = new Promise((_, reject) => { timer = deps.setTimer(() => { controller.abort(); cancel(); reject(new Error()); }, WALLET_TIMEOUT_MS); });
  const request = (async () => {
    const response = await deps.fetch(url, { method: "POST", body: JSON.stringify(payload), redirect: "error", credentials: "omit", cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", "accept-encoding": "identity", ...headers }, signal: controller.signal });
    if (controller.signal.aborted) { cancel(response.body); throw new Error(); }
    if (response.status !== 200 || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")
      || !response.body || ![null, "identity"].includes(response.headers.get("content-encoding"))) { cancel(response.body); throw new Error(); }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/.test(declared) || BigInt(declared) > BigInt(WALLET_RESPONSE_MAX_BYTES))) { cancel(response.body); throw new Error(); }
    reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (controller.signal.aborted) throw new Error(); if (next.done) break;
      size += next.value.byteLength; if (size > WALLET_RESPONSE_MAX_BYTES) { cancel(); throw new Error(); } chunks.push(next.value);
    }
    if (declared !== null && BigInt(declared) !== BigInt(size)) throw new Error();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  })();
  try { return await Promise.race([request, deadline]); }
  finally { deps.clearTimer(timer); controller.abort(); try { reader?.releaseLock(); } catch { /* Pending cancellation. */ } }
}
function quantity(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || value.length > 66) throw new Error();
  return BigInt(value);
}
function fresh(timestamp, now, maxAge) { return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= now + 60000 && now - timestamp <= maxAge; }
async function preflight(env, deps) {
  for (const [chain, id] of [["ethereum", 1n], ["base", 8453n]]) {
    try {
      const endpoint = WALLET_ENDPOINTS[chain];
      const chainReply = await jsonRequest(endpoint, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }, {}, deps);
      if (!object(chainReply) || chainReply.jsonrpc !== "2.0" || chainReply.id !== 1 || Object.hasOwn(chainReply, "error") || quantity(chainReply.result) !== id) throw new Error();
      const blockReply = await jsonRequest(endpoint, { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["finalized", false] }, {}, deps);
      if (!object(blockReply) || blockReply.jsonrpc !== "2.0" || blockReply.id !== 2 || Object.hasOwn(blockReply, "error") || !object(blockReply.result)) throw new Error();
      const block = blockReply.result, number = quantity(block.number), timestamp = quantity(block.timestamp);
      if (number < 1n || number > BigInt(Number.MAX_SAFE_INTEGER) || typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(block.hash) || /^0x0{64}$/i.test(block.hash)
        || timestamp > BigInt(Number.MAX_SAFE_INTEGER) / 1000n || !fresh(Number(timestamp) * 1000, deps.now(), WALLET_FINALIZED_MAX_AGE_MS)) throw new Error();
    } catch { fail(`${chain}_preflight_failed`); }
  }
  try {
    const key = env.MEMBERSHIP_WALLET_TRONGRID_API_KEY;
    const value = await jsonRequest("https://api.trongrid.io/walletsolidity/getnowblock", {}, key ? { "TRON-PRO-API-KEY": key } : {}, deps);
    if (!object(value) || !object(value.block_header) || !object(value.block_header.raw_data)) throw new Error();
    const { number, timestamp } = value.block_header.raw_data;
    if (!Number.isSafeInteger(number) || number < 1 || typeof value.blockID !== "string" || !/^[0-9a-f]{64}$/i.test(value.blockID)
      || BigInt(`0x${value.blockID.slice(0, 16)}`) !== BigInt(number) || !fresh(timestamp, deps.now(), WALLET_TRON_MAX_AGE_MS)) throw new Error();
  } catch { fail("tron_preflight_failed"); }
}
async function checkedWorker(services, env, sha, differentPid, stableWait) {
  const state = await services.inspect();
  if (!state?.running || !Number.isSafeInteger(state.pid) || state.pid < 1) fail("worker_inactive");
  if (state.pid === differentPid || !await services.revision(sha) || !await services.matches(state.pid, env, sha)) fail("worker_verification_failed");
  const after = await services.inspect();
  if (!after?.running || after.pid !== state.pid) fail("worker_verification_failed");
  if (stableWait) {
    await stableWait(1000);
    const stable = await checkedWorker(services, env, sha);
    if (stable.pid !== state.pid) fail("worker_verification_failed");
  }
  return state;
}
function validateOptions(options) {
  if (!object(options) || Object.keys(options).some(name => !["envFile", "backupFile", "operation", "expectedRuntimeSha"].includes(name))
    || !["enable", "probe"].includes(options.operation) || !/^[a-f0-9]{40}$/.test(options.expectedRuntimeSha ?? "")
    || typeof options.envFile !== "string" || options.operation === "enable" && (typeof options.backupFile !== "string" || options.envFile === options.backupFile)
    || options.operation === "probe" && options.backupFile !== undefined) fail("invalid_arguments");
}
/** Only four wallet settings can change; no database, Edge, orders, keys or other integration is touched. */
export async function configureWalletRuntime(options, dependencies = {}) {
  validateOptions(options);
  const deps = { fetch: globalThis.fetch, now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), ...dependencies };
  const services = dependencies.services ?? productionServices(); let lockFd;
  const lockPath = path.join(path.dirname(options.envFile), `.${path.basename(options.envFile)}.wavekb-runtime.lock`);
  try {
    safeParent(options.envFile, "unsafe_env_file");
    if (options.operation === "enable") {
      requireNewBackup(options.backupFile);
      try { lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); safeRegular(fs.fstatSync(lockFd), "unsafe_env_file"); }
      catch { fail("runtime_configuration_busy"); }
    }
    const original = readOwned(options.envFile), parsed = parseEnvironment(original), next = candidateEnvironment(parsed), candidate = parseEnvironment(next).env;
    if (!await services.revision(options.expectedRuntimeSha)) fail("runtime_revision_mismatch");
    const before = await checkedWorker(services, parsed.env, options.expectedRuntimeSha);
    await preflight(candidate, deps);
    if (!readOwned(options.envFile).equals(original)) fail("environment_changed");
    if (options.operation === "probe") {
      await checkedWorker(services, parsed.env, options.expectedRuntimeSha);
      if (!readOwned(options.envFile).equals(original)) fail("environment_changed");
      return { ok: true, operation: "probe", enabled: parsed.env.MEMBERSHIP_WALLET_ENABLED === "true", workerRunning: true,
        ethereumReady: true, baseReady: true, tronReady: true, changed: false };
    }
    requireNewBackup(options.backupFile); writeNew(options.backupFile, original); syncParent(options.backupFile);
    const changed = !next.equals(original);
    try {
      if (changed) atomicReplace(options.envFile, next, original, "environment_changed");
      try { await services.restart(); } catch { fail("worker_restart_failed"); }
      await checkedWorker(services, candidate, options.expectedRuntimeSha, before.pid, deps.wait);
      if (!readOwned(options.envFile).equals(next)) fail("environment_changed");
    } catch (error) {
      const current = readOwned(options.envFile);
      if (!current.equals(next) && !current.equals(original)) fail("rollback_conflict");
      try {
        if (changed && current.equals(next)) atomicReplace(options.envFile, original, next, "rollback_conflict");
        await services.restart(); await checkedWorker(services, parsed.env, options.expectedRuntimeSha, before.pid, deps.wait);
      } catch (rollbackError) { if (rollbackError instanceof WalletRuntimeError && rollbackError.code === "rollback_conflict") throw rollbackError; fail("runtime_rollback_failed"); }
      if (error instanceof WalletRuntimeError) throw error;
      fail("runtime_write_failed");
    }
    return { ok: true, operation: "enable", enabled: true, workerRunning: true, ethereumReady: true, baseReady: true, tronReady: true, changed };
  } catch (error) { if (error instanceof WalletRuntimeError) throw error; fail("runtime_write_failed"); }
  finally {
    if (lockFd !== undefined) {
      try { const held = fs.fstatSync(lockFd), current = fs.lstatSync(lockPath); if (current.isFile() && current.dev === held.dev && current.ino === held.ino) fs.unlinkSync(lockPath); } catch { /* Preserve replacement locks. */ }
      fs.closeSync(lockFd);
    }
  }
}
export function parseWalletRuntimeArguments(args) {
  const allowed = new Set(["--env-file", "--backup-file", "--operation", "--expected-runtime-sha"]), values = new Map();
  if (!Array.isArray(args) || args.length > 8) fail("invalid_arguments");
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.has(key) || values.has(key) || typeof value !== "string" || !value || value.length > 4096 || value.startsWith("--")) fail("invalid_arguments");
    values.set(key, value);
  }
  const options = { envFile: values.get("--env-file"), operation: values.get("--operation"), expectedRuntimeSha: values.get("--expected-runtime-sha"),
    ...(values.has("--backup-file") ? { backupFile: values.get("--backup-file") } : {}) };
  validateOptions(options); return options;
}
function isMain() {
  if (process.argv[1] === "-") return path.basename(fileURLToPath(import.meta.url)) === "[eval1]";
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1])); } catch { return false; }
}
if (isMain()) {
  try { process.stdout.write(`${JSON.stringify(await configureWalletRuntime(parseWalletRuntimeArguments(process.argv.slice(2))))}\n`); }
  catch (error) { const code = error instanceof WalletRuntimeError && codes.has(error.code) ? error.code : "runtime_write_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`); process.exitCode = 1; }
}
