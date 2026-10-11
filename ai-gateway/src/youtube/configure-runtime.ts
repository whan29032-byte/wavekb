import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadYouTubeSyncConfig } from "./config.ts";

export const YOUTUBE_CALLBACK = "https://wavekb.com/api/youtube/callback";
export const YOUTUBE_CONFIG_INPUT_MAX_BYTES = 8192;
const MAX_ENV_BYTES = 1024 * 1024;
const operations = new Set(["stage", "enable", "disable"]);
const mutableKeys = new Set(["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_OAUTH_REDIRECT_URI", "YOUTUBE_TOKEN_MASTER_KEY", "YOUTUBE_SYNC_ENABLED"]);
type Code = "invalid_arguments" | "invalid_configuration_input" | "unsafe_env_file" | "unsafe_backup_file"
  | "unsupported_env_format" | "runtime_configuration_busy" | "youtube_configuration_invalid"
  | "youtube_credentials_missing" | "youtube_credentials_already_configured" | "stage_requires_disabled"
  | "youtube_master_key_missing"
  | "youtube_gateway_inactive" | "youtube_worker_inactive" | "environment_changed"
  | "runtime_write_failed" | "service_verification_failed" | "rollback_conflict" | "runtime_rollback_failed";
export class YouTubeConfigurationError extends Error {
  readonly code: Code;
  constructor(code: Code) { super(code); this.name = "YouTubeConfigurationError"; this.code = code; }
}
function fail(code: Code): never { throw new YouTubeConfigurationError(code); }
export type YouTubeConfigurationOperation = "stage" | "enable" | "disable";
export type YouTubeConfigurationOptions = { envFile: string; backupFile: string; operation: YouTubeConfigurationOperation; verifyServices?: boolean; expectedSha?: string };
export type YouTubeConfigurationInput = { clientId: string; clientSecret: string } | Record<string, never>;
export type YouTubeServiceState = { gatewayActive: boolean; workerActive: boolean };
export type YouTubeConfigurationServices = {
  inspect(): Promise<YouTubeServiceState>;
  restart(service: "gateway" | "youtube"): Promise<void>;
  health(expectedSha: string): Promise<boolean>;
};
type Dependencies = { services?: YouTubeConfigurationServices };
type ResultMetadata = { configured: true | null; enabled: boolean; generatedMasterKey: boolean; changed: boolean; appliedToRunningServices: boolean; workerActive: boolean | null };
export type YouTubeConfigurationResult = ResultMetadata & ({ ok: true } | { ok: false; code: "youtube_disable_not_verified"; enabled: false });

function normalizeInput(value: unknown, operation: YouTubeConfigurationOperation): YouTubeConfigurationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("invalid_configuration_input");
  const input = value as Record<string, unknown>, keys = Object.keys(input);
  if (operation !== "stage") { if (keys.length) fail("invalid_configuration_input"); return {}; }
  if (keys.length !== 2 || !keys.includes("clientId") || !keys.includes("clientSecret")) fail("invalid_configuration_input");
  if (typeof input.clientId !== "string" || typeof input.clientSecret !== "string"
    || !/^[A-Za-z0-9._-]{1,200}\.apps\.googleusercontent\.com$/.test(input.clientId)
    || !/^[A-Za-z0-9._~+/-]{8,4096}$/.test(input.clientSecret)) fail("invalid_configuration_input");
  return { clientId: input.clientId, clientSecret: input.clientSecret };
}

/** Compact canonical JSON is required: duplicate fields and alternate escaped keys cannot be silently interpreted. */
export function parseYouTubeConfigurationInput(bytes: Uint8Array, operation: YouTubeConfigurationOperation): YouTubeConfigurationInput {
  if (!operations.has(operation) || bytes.byteLength > YOUTUBE_CONFIG_INPUT_MAX_BYTES) fail("invalid_configuration_input");
  let text: string, value: unknown;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); value = JSON.parse(text); }
  catch { return fail("invalid_configuration_input"); }
  if (text !== JSON.stringify(value)) fail("invalid_configuration_input");
  return normalizeInput(value, operation);
}

function uid(): number { if (!process.getuid) fail("unsafe_env_file"); return process.getuid(); }
function safeParent(filename: string, code: Code): void {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename || filename.includes("\0")) fail(code);
  try {
    const parent = path.dirname(filename), stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid() || (stat.mode & 0o022) !== 0 || fs.realpathSync(parent) !== parent) fail(code);
  } catch { fail(code); }
}
function safeRegular(stat: fs.Stats, code: Code): void {
  if (!stat.isFile() || stat.uid !== uid() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1) fail(code);
}
function readOwned(filename: string, code: Code = "unsafe_env_file"): Buffer {
  safeParent(filename, code);
  let fd: number | undefined;
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) fail(code);
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd); safeRegular(before, code);
    if (before.size > MAX_ENV_BYTES) fail(code);
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd); safeRegular(after, code);
    if (before.size !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("environment_changed");
    return bytes;
  } catch (error) { if (error instanceof YouTubeConfigurationError) throw error; return fail(code); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function requireNewBackup(filename: string): void {
  safeParent(filename, "unsafe_backup_file");
  try { fs.lstatSync(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; fail("unsafe_backup_file"); }
  fail("unsafe_backup_file");
}
type Line = { raw: string; ending: string; key?: string; prefix?: string; quote?: string; suffix?: string };
function parseEnvironment(bytes: Buffer): { lines: Line[]; env: Record<string, string> } {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("unsupported_env_format"); }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || text.includes("\0") || text.replaceAll("\r\n", "").includes("\r")) fail("unsupported_env_format");
  const env: Record<string, string> = Object.create(null), lines: Line[] = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|$)/gu)) {
    const raw = match[1]!, ending = match[2]!;
    if (!raw && !ending && match.index === text.length) continue;
    if (/^\s*(?:[#;].*)?$/u.test(raw)) { lines.push({ raw, ending }); continue; }
    const assignment = /^([ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*)(.*?)([ \t]*)$/u.exec(raw);
    if (!assignment || Object.hasOwn(env, assignment[2]!)) fail("unsupported_env_format");
    const key = assignment[2]!, prefix = assignment[1]!, encoded = assignment[3]!, suffix = assignment[4]!;
    let value = encoded, quote = "";
    if (encoded.startsWith("'") || encoded.startsWith('"')) {
      quote = encoded[0]!;
      if (encoded.length < 2 || !encoded.endsWith(quote)) fail("unsupported_env_format");
      value = encoded.slice(1, -1);
      if (value.includes(quote) || (quote === '"' && value.includes("\\"))) fail("unsupported_env_format");
    } else if (/[\\'"]/u.test(value)) fail("unsupported_env_format");
    env[key] = value; lines.push({ raw, ending, key, prefix, quote, suffix });
  }
  return { lines, env };
}
function transform(lines: Line[], values: Record<string, string>): Buffer {
  const remaining = new Set(Object.keys(values)), newline = lines.find((line) => line.ending)?.ending ?? "\n";
  let output = lines.map((line) => line.key && remaining.delete(line.key)
    ? `${line.prefix}${line.quote}${values[line.key]}${line.quote}${line.suffix}${line.ending}` : `${line.raw}${line.ending}`).join("");
  for (const key of remaining) {
    if (!mutableKeys.has(key)) fail("invalid_arguments");
    if (output && !output.endsWith("\n")) output += newline;
    output += `${key}=${values[key]}${newline}`;
  }
  return Buffer.from(output);
}
function syncParent(filename: string): void {
  const fd = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeNew(filename: string, bytes: Buffer): void {
  let fd: number | undefined, created = false, complete = false;
  try {
    fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = true; safeRegular(fs.fstatSync(fd), "unsafe_backup_file");
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); complete = true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created && !complete) { try { fs.unlinkSync(filename); } catch { /* Keep diagnostics static. */ } }
  }
}
function atomicReplace(filename: string, bytes: Buffer, expected: Buffer, conflict: Code): void {
  const directory = fs.mkdtempSync(path.join(path.dirname(filename), ".wavekb-youtube-runtime-"));
  fs.chmodSync(directory, 0o700);
  const staged = path.join(directory, "gateway.env");
  try {
    writeNew(staged, bytes);
    if (!readOwned(filename).equals(expected)) fail(conflict);
    fs.renameSync(staged, filename); syncParent(filename);
  } finally {
    try { fs.unlinkSync(staged); } catch { /* Already atomically moved. */ }
    try { fs.rmdirSync(directory); } catch { /* Never remove unexpected files. */ }
  }
}
/** A unit must be loaded and have an actual running process; "active (exited)" is not ready. */
export function isYouTubeUnitRunning(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 4096) return false;
  const fields = new Map<string, string>();
  for (const line of value.trim().split("\n")) {
    const pair = /^(LoadState|ActiveState|SubState|MainPID)=([^\r\n=]*)$/u.exec(line);
    if (!pair || fields.has(pair[1]!)) return false;
    fields.set(pair[1]!, pair[2]!);
  }
  const pid = fields.get("MainPID") ?? "";
  return fields.size === 4 && fields.get("LoadState") === "loaded" && fields.get("ActiveState") === "active"
    && fields.get("SubState") === "running" && /^[1-9][0-9]{0,9}$/u.test(pid) && Number(pid) <= 2147483647;
}
function productionServices(): YouTubeConfigurationServices {
  const units = { gateway: "elliott-wave-gateway.service", youtube: "elliott-wave-youtube-sync.service" };
  const active = (service: "gateway" | "youtube") => {
    try { return isYouTubeUnitRunning(execFileSync("/usr/bin/systemctl", ["show", units[service], "--property=LoadState,ActiveState,SubState,MainPID"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] })); }
    catch { return false; }
  };
  return {
    inspect: async () => ({ gatewayActive: active("gateway"), workerActive: active("youtube") }),
    restart: async (service) => { execFileSync("/usr/bin/systemctl", ["restart", units[service]], { timeout: 20_000, stdio: "ignore" }); },
    health: async (expectedSha) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const response = await fetch("http://127.0.0.1:8787/health", { redirect: "error", signal: AbortSignal.timeout(3000), cache: "no-store" });
          const text = await response.text();
          if (response.ok && text.length <= 4096) {
            const body = JSON.parse(text);
            if (body.ok === true && body.deployment === expectedSha) return true;
          }
        } catch { /* Do not expose provider/environment/body information. */ }
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    },
  };
}
async function restartExisting(services: YouTubeConfigurationServices, state: YouTubeServiceState): Promise<void> {
  if (state.gatewayActive) await services.restart("gateway");
  if (state.workerActive) await services.restart("youtube");
}
async function restartForDisable(services: YouTubeConfigurationServices, state: YouTubeServiceState): Promise<boolean> {
  let succeeded = true;
  // A failed Gateway restart must not prevent the existing worker from loading
  // false. Never start an originally inactive service and never restore true.
  for (const service of ["gateway", "youtube"] as const) {
    if (service === "gateway" ? !state.gatewayActive : !state.workerActive) continue;
    try { await services.restart(service); } catch { succeeded = false; }
  }
  return succeeded;
}
async function verify(services: YouTubeConfigurationServices, state: YouTubeServiceState, sha: string): Promise<void> {
  if (!await services.health(sha)) fail("service_verification_failed");
  // Recheck after health: an early active state must not hide a process which
  // exited while the HTTP health request was still completing.
  const current = await services.inspect();
  if (current.gatewayActive !== state.gatewayActive || current.workerActive !== state.workerActive) fail("service_verification_failed");
}

/** The shared env lock is held across configuration, service verification and CAS rollback. No Google API is called. */
export async function configureYouTubeRuntime(options: YouTubeConfigurationOptions, value: unknown, dependencies: Dependencies = {}): Promise<YouTubeConfigurationResult> {
  if (!options || Object.keys(options).some((key) => !["envFile", "backupFile", "operation", "verifyServices", "expectedSha"].includes(key))
    || typeof options.envFile !== "string" || typeof options.backupFile !== "string" || options.envFile === options.backupFile || !operations.has(options.operation)
    || options.verifyServices !== undefined && typeof options.verifyServices !== "boolean"
    || options.verifyServices && !/^[0-9a-f]{40}$/.test(options.expectedSha ?? "")) fail("invalid_arguments");
  const input = normalizeInput(value, options.operation);
  safeParent(options.envFile, "unsafe_env_file"); requireNewBackup(options.backupFile);
  const lockPath = path.join(path.dirname(options.envFile), `.${path.basename(options.envFile)}.wavekb-runtime.lock`);
  let lockFd: number | undefined;
  try {
    try { lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); safeRegular(fs.fstatSync(lockFd), "unsafe_env_file"); }
    catch { fail("runtime_configuration_busy"); }
    const original = readOwned(options.envFile), { lines, env } = parseEnvironment(original);
    if (!([undefined, "", "false", "true"] as unknown[]).includes(env.YOUTUBE_SYNC_ENABLED)) fail("youtube_configuration_invalid");
    if (options.operation === "stage" && env.YOUTUBE_SYNC_ENABLED === "true") fail("stage_requires_disabled");
    const values: Record<string, string> = { YOUTUBE_SYNC_ENABLED: String(options.operation === "enable") };
    let generatedMasterKey = false;
    if (options.operation === "stage") {
      const credentials = input as { clientId: string; clientSecret: string };
      for (const [key, incoming] of [["YOUTUBE_OAUTH_CLIENT_ID", credentials.clientId], ["YOUTUBE_OAUTH_CLIENT_SECRET", credentials.clientSecret]] as const) {
        if (env[key] && env[key] !== incoming) fail("youtube_credentials_already_configured");
        values[key] = incoming;
      }
      values.YOUTUBE_OAUTH_REDIRECT_URI = YOUTUBE_CALLBACK;
      if (!env.YOUTUBE_TOKEN_MASTER_KEY) {
        if (env.YOUTUBE_OAUTH_CLIENT_ID || env.YOUTUBE_OAUTH_CLIENT_SECRET) fail("youtube_master_key_missing");
        values.YOUTUBE_TOKEN_MASTER_KEY = randomBytes(32).toString("base64"); generatedMasterKey = true;
      }
    }
    const next = transform(lines, values), candidate = parseEnvironment(next).env;
    if (options.operation !== "disable") {
      if (!candidate.YOUTUBE_OAUTH_CLIENT_ID || !candidate.YOUTUBE_OAUTH_CLIENT_SECRET || !candidate.YOUTUBE_TOKEN_MASTER_KEY) fail("youtube_credentials_missing");
      try {
        if (candidate.YOUTUBE_OAUTH_REDIRECT_URI !== YOUTUBE_CALLBACK || loadYouTubeSyncConfig({ ...candidate, YOUTUBE_SYNC_ENABLED: "true" }).readiness !== "ready") fail("youtube_configuration_invalid");
      } catch { fail("youtube_configuration_invalid"); }
    }
    const services = options.verifyServices ? dependencies.services ?? productionServices() : null;
    let state: YouTubeServiceState | null = null, disableUnverified = false;
    if (services) {
      try { state = await services.inspect(); }
      catch { if (options.operation === "disable") disableUnverified = true; else fail("service_verification_failed"); }
      if (options.operation !== "disable") {
        if (!state?.gatewayActive) fail("youtube_gateway_inactive");
        if (options.operation === "enable" && !state.workerActive) fail("youtube_worker_inactive");
        await verify(services, state, options.expectedSha!);
      }
    }
    const changed = !next.equals(original);
    if (changed) {
      requireNewBackup(options.backupFile); writeNew(options.backupFile, original); syncParent(options.backupFile);
      try { atomicReplace(options.envFile, next, original, "environment_changed"); }
      catch (error) {
        // A directory fsync can fail after rename. Restore only this operation's
        // exact candidate, never a configuration written by somebody else.
        const current = readOwned(options.envFile);
        if (options.operation === "disable" && current.equals(next)) {
          // Emergency closing must never restore an old true flag merely
          // because fsync/verification failed. Report uncertain completion.
          disableUnverified = true;
        } else {
          if (current.equals(next)) {
            try { atomicReplace(options.envFile, original, next, "rollback_conflict"); }
            catch (rollbackError) { if (rollbackError instanceof YouTubeConfigurationError && rollbackError.code === "rollback_conflict") throw rollbackError; fail("runtime_rollback_failed"); }
          } else if (!current.equals(original)) fail("rollback_conflict");
          if (error instanceof YouTubeConfigurationError) throw error;
          fail("runtime_write_failed");
        }
      }
    }
    if (services && state) {
      try {
        if (options.operation === "disable") {
          if (!await restartForDisable(services, state)) disableUnverified = true;
        } else await restartExisting(services, state);
        await verify(services, state, options.expectedSha!);
      }
      catch {
        if (options.operation === "disable") {
          if (!readOwned(options.envFile).equals(next)) fail("environment_changed");
          disableUnverified = true;
        } else {
          if (changed) {
            // Never overwrite a later writer's bytes, even when it ignores our advisory lock.
            if (!readOwned(options.envFile).equals(next)) fail("rollback_conflict");
            try { atomicReplace(options.envFile, original, next, "rollback_conflict"); }
            catch (error) { if (error instanceof YouTubeConfigurationError && error.code === "rollback_conflict") throw error; fail("runtime_rollback_failed"); }
          }
          try { await restartExisting(services, state); await verify(services, state, options.expectedSha!); }
          catch { fail("runtime_rollback_failed"); }
          fail("service_verification_failed");
        }
      }
    }
    if (options.operation === "disable" && !readOwned(options.envFile).equals(next)) fail("environment_changed");
    if (disableUnverified) return { ok: false, code: "youtube_disable_not_verified", configured: null, enabled: false, generatedMasterKey: false, changed, appliedToRunningServices: false, workerActive: null };
    return { ok: true, configured: options.operation === "disable" ? null : true, enabled: options.operation === "enable", generatedMasterKey, changed, appliedToRunningServices: Boolean(services), workerActive: state?.workerActive ?? null };
  } catch (error) { if (error instanceof YouTubeConfigurationError) throw error; return fail("runtime_write_failed"); }
  finally {
    if (lockFd !== undefined) {
      try { const held = fs.fstatSync(lockFd), current = fs.lstatSync(lockPath); if (current.isFile() && current.dev === held.dev && current.ino === held.ino) fs.unlinkSync(lockPath); }
      catch { /* Preserve another writer's replacement lock. */ }
      fs.closeSync(lockFd);
    }
  }
}

export function parseYouTubeConfigurationArguments(args: readonly string[]): YouTubeConfigurationOptions {
  const allowed = new Set(["--env-file", "--backup-file", "--operation", "--verify-services", "--expected-sha"]), values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key || !allowed.has(key) || values.has(key) || !value || value.startsWith("--")) fail("invalid_arguments");
    values.set(key, value);
  }
  const envFile = values.get("--env-file"), backupFile = values.get("--backup-file"), operation = values.get("--operation"), verification = values.get("--verify-services"), expectedSha = values.get("--expected-sha");
  if (!envFile || !backupFile || !operation || !operations.has(operation) || verification !== undefined && verification !== "true" || Boolean(verification) !== Boolean(expectedSha)) fail("invalid_arguments");
  return { envFile, backupFile, operation: operation as YouTubeConfigurationOperation, ...(verification ? { verifyServices: true, expectedSha: expectedSha! } : {}) };
}
function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    // Node resolves imported module URLs through release symlinks. argv retains
    // /current, so compare filesystem identities rather than path spellings.
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch { return false; }
}
if (isCliEntrypoint()) {
  try {
    const options = parseYouTubeConfigurationArguments(process.argv.slice(2));
    const chunks: Buffer[] = []; let length = 0;
    for await (const raw of process.stdin) { const chunk = Buffer.from(raw); length += chunk.length; if (length > YOUTUBE_CONFIG_INPUT_MAX_BYTES) { process.stdin.destroy(); fail("invalid_configuration_input"); } chunks.push(chunk); }
    const result = await configureYouTubeRuntime(options, parseYouTubeConfigurationInput(Buffer.concat(chunks), options.operation));
    if (result.ok) process.stdout.write(`${JSON.stringify(result)}\n`);
    else { process.stderr.write(`${JSON.stringify(result)}\n`); process.exitCode = 1; }
  } catch (error) {
    const code = error instanceof YouTubeConfigurationError ? error.code : "runtime_write_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`); process.exitCode = 1;
  }
}
