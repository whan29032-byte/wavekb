import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type GatewayConfig } from "../config.ts";
import { ManagedConnectionResolver } from "../secrets/managed-connection.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { ResearchPrivateRepository } from "./private-repository.ts";
import { loadPrivateTheorySnapshot, type ResearchPrivateRepositoryPort } from "./private-theory.ts";

const DEEPSEEK_HOST = "api.deepseek.com";
const MAX_ENV_BYTES = 1024 * 1024;
// Conservative peak, cache-miss USD/1M, verified 2026-10-11 against the official
// pricing page. This activation check is not a monthly spending hard limit.
const DEEPSEEK_FLASH_INPUT_COST = 0.3;
const DEEPSEEK_FLASH_OUTPUT_COST = 1.2;
type FailureCode = "invalid_arguments" | "unsafe_env_file" | "unsafe_backup_file" | "runtime_configuration_busy"
  | "unsupported_env_format" | "invalid_runtime_configuration" | "private_theory_validation_failed"
  | "managed_ai_validation_failed" | "managed_ai_cost_configuration_required"
  | "environment_changed" | "runtime_write_failed";
export class RuntimeConfigurationError extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) { super(code); this.name = "RuntimeConfigurationError"; this.code = code; }
}
function fail(code: FailureCode): never { throw new RuntimeConfigurationError(code); }
export type RuntimeToggle = "preserve" | "enable" | "disable";
export type RuntimeConfigurationOptions = {
  envFile: string; backupFile: string; enablePrivate?: boolean; managedAi?: RuntimeToggle;
};
export type RuntimeConfigurationResult = {
  ok: true; privateResearchEnabled: boolean; deepseekHostAllowed: boolean; artifactValidated: boolean;
  managedAiEnabled?: boolean; managedAiValidated?: boolean;
};
type Database = Pick<SupabaseRest, "request">;
type Dependencies = {
  createDatabase?: (config: GatewayConfig) => Database;
  createRepository?: (database: Database) => Pick<ResearchPrivateRepositoryPort, "loadActiveArtifact">;
};
type EnvLine = { raw: string; ending: string; key?: string; prefix?: string; value?: string; quote?: string; suffix?: string };

function currentUid(): number {
  if (!process.getuid) fail("unsafe_env_file");
  return process.getuid();
}
function safeParent(filename: string, code: FailureCode): void {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename || filename.includes("\0")) fail(code);
  const parent = path.dirname(filename);
  try {
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid() || (stat.mode & 0o022) !== 0
      || fs.realpathSync(parent) !== parent) fail(code);
  } catch { fail(code); }
}
function safeRegular(stat: fs.Stats, code: FailureCode): void {
  if (!stat.isFile() || stat.uid !== currentUid() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1) fail(code);
}
function readOwnedFile(filename: string): Buffer {
  safeParent(filename, "unsafe_env_file");
  let fd: number | undefined;
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) fail("unsafe_env_file");
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd); safeRegular(before, "unsafe_env_file");
    if (before.size > MAX_ENV_BYTES) fail("unsafe_env_file");
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    safeRegular(after, "unsafe_env_file");
    if (before.size !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs) fail("environment_changed");
    return bytes;
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    return fail("unsafe_env_file");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Deliberately supports the shared, unambiguous single-line EnvironmentFile
// subset only. No dotenv expansion, shell evaluation, escaping or multiline
// parsing can turn a secret's continuation line into a configuration edit.
function parseEnvironment(bytes: Buffer): { lines: EnvLine[]; env: Record<string, string> } {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail("unsupported_env_format");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("unsupported_env_format"); }
  if (text.includes("\0") || text.startsWith("\ufeff")) fail("unsupported_env_format");
  const env: Record<string, string> = Object.create(null);
  const lines: EnvLine[] = [];
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
    env[key] = value;
    lines.push({ raw, ending, key, prefix, value, quote, suffix });
  }
  if (text.replaceAll("\r\n", "").includes("\r")) fail("unsupported_env_format");
  return { lines, env };
}
function transformedBytes(lines: EnvLine[], env: Record<string, string>, options: RuntimeConfigurationOptions): Buffer {
  const existing = env.ALLOWED_PROVIDER_HOSTS ?? "";
  const hosts = existing.split(",").map((host) => host.trim());
  const desired = existing && !hosts.includes(DEEPSEEK_HOST) ? `${existing},${DEEPSEEK_HOST}` : existing || DEEPSEEK_HOST;
  const values: Record<string, string> = {};
  // Preserve the existing private-research operation exactly. Managed-only
  // changes do not broaden the allowlist or rewrite the private flag.
  if (options.enablePrivate !== undefined) {
    values.ALLOWED_PROVIDER_HOSTS = desired;
    values.HERMES_PRIVATE_RESEARCH_ENABLED = String(options.enablePrivate);
  }
  if (options.managedAi && options.managedAi !== "preserve") values.MEMBERSHIP_MANAGED_AI_ENABLED = String(options.managedAi === "enable");
  const remaining = new Set(Object.keys(values));
  const newline = lines.find((line) => line.ending)?.ending ?? "\n";
  let output = lines.map((line) => {
    if (line.key && remaining.delete(line.key)) return `${line.prefix}${line.quote}${values[line.key]}${line.quote}${line.suffix}${line.ending}`;
    return `${line.raw}${line.ending}`;
  }).join("");
  for (const key of remaining) {
    if (output && !output.endsWith("\n")) output += newline;
    output += `${key}=${values[key]}${newline}`;
  }
  return Buffer.from(output, "utf8");
}

function currentSwitch(env: Record<string, string>, key: string): boolean {
  const value = env[key];
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return fail("invalid_runtime_configuration");
}
function runtimeConfig(env: Record<string, string>): GatewayConfig {
  try {
    const config = loadConfig(env), url = new URL(config.SUPABASE_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/"
      || !/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname)) fail("invalid_runtime_configuration");
    return config;
  } catch { return fail("invalid_runtime_configuration"); }
}
async function validateManagedAi(config: GatewayConfig, database: Database): Promise<void> {
  let model;
  try {
    // The candidate flag is enabled only in memory. inspect reads secret IDs,
    // never ciphertext, decryptSecret or a provider/model API.
    model = await new ManagedConnectionResolver(config, database).inspect("wave_analysis");
    const url = new URL(model.provider.base_url);
    if (model.name !== "deepseek-flash" || model.provider.adapter !== "openai_compatible"
      || url.protocol !== "https:" || url.hostname !== DEEPSEEK_HOST || url.port || url.username || url.password || url.search || url.hash
      || !["/", "/v1", "/v1/"].includes(url.pathname)) fail("managed_ai_validation_failed");
  } catch { fail("managed_ai_validation_failed"); }
  try {
    const rows = await database.request(`/rest/v1/ai_models?id=eq.${encodeURIComponent(model.id)}&enabled=eq.true&select=id,provider_id,name,input_cost_per_million,output_cost_per_million&limit=1`);
    const row = rows?.[0], input = Number(row?.input_cost_per_million), output = Number(row?.output_cost_per_million);
    if (!row || rows.length !== 1 || row.id !== model.id || row.provider_id !== model.provider_id || row.name !== "deepseek-flash"
      || !Number.isFinite(input) || !Number.isFinite(output) || input < DEEPSEEK_FLASH_INPUT_COST || output < DEEPSEEK_FLASH_OUTPUT_COST
      || input > 1_000_000 || output > 1_000_000) fail("managed_ai_cost_configuration_required");
  } catch { fail("managed_ai_cost_configuration_required"); }
}

function requireNewBackup(filename: string): void {
  safeParent(filename, "unsafe_backup_file");
  try { fs.lstatSync(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; fail("unsafe_backup_file"); }
  fail("unsafe_backup_file");
}
function syncParent(filename: string): void {
  const fd = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeBackup(filename: string, original: Buffer): void {
  let fd: number | undefined, created = false, complete = false;
  try {
    fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = true; safeRegular(fs.fstatSync(fd), "unsafe_backup_file");
    fs.writeFileSync(fd, original); fs.fsyncSync(fd); complete = true;
  } catch { fail("runtime_write_failed"); }
  finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created && !complete) { try { fs.unlinkSync(filename); } catch { /* No secret or path in diagnostics. */ } }
  }
}

/** Only explicitly selected configuration keys change; all use one exact backup and atomic replacement. */
export async function configureResearchRuntime(options: RuntimeConfigurationOptions, dependencies: Dependencies = {}): Promise<RuntimeConfigurationResult> {
  if (!options || typeof options.envFile !== "string" || typeof options.backupFile !== "string"
    || (options.enablePrivate !== undefined && typeof options.enablePrivate !== "boolean")
    || (options.managedAi !== undefined && !["preserve", "enable", "disable"].includes(options.managedAi))
    || options.envFile === options.backupFile) fail("invalid_arguments");
  safeParent(options.envFile, "unsafe_env_file"); requireNewBackup(options.backupFile);
  const lockPath = path.join(path.dirname(options.envFile), `.${path.basename(options.envFile)}.wavekb-runtime.lock`);
  let lockFd: number | undefined, temporaryDirectory: string | undefined;
  try {
    try {
      lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      safeRegular(fs.fstatSync(lockFd), "unsafe_env_file");
    } catch { fail("runtime_configuration_busy"); }
    const original = readOwnedFile(options.envFile), { lines, env } = parseEnvironment(original);
    const next = transformedBytes(lines, env, options), candidate = parseEnvironment(next).env;
    const privateEnabled = options.enablePrivate ?? currentSwitch(env, "HERMES_PRIVATE_RESEARCH_ENABLED");
    const managedRequested = options.managedAi !== undefined && options.managedAi !== "preserve";
    const result: RuntimeConfigurationResult = {
      ok: true, privateResearchEnabled: privateEnabled,
      deepseekHostAllowed: (candidate.ALLOWED_PROVIDER_HOSTS ?? "").split(",").some((host) => host.trim().toLowerCase() === DEEPSEEK_HOST),
      artifactValidated: false,
      ...(managedRequested ? { managedAiEnabled: options.managedAi === "enable", managedAiValidated: false } : {}),
    };
    // Default preserve performs no database reads, backup or replacement.
    if (options.enablePrivate === undefined && !managedRequested) return result;
    const validatePrivate = options.enablePrivate === true || (options.managedAi === "enable" && privateEnabled);
    if (validatePrivate || options.managedAi === "enable") {
      const config = runtimeConfig(candidate);
      const database = dependencies.createDatabase?.(config) ?? new SupabaseRest(config);
      if (options.managedAi === "enable") {
        await validateManagedAi(config, database);
        result.managedAiValidated = true;
      }
      if (validatePrivate) {
        try {
          const repository = dependencies.createRepository?.(database) ?? new ResearchPrivateRepository(database);
          const active = await repository.loadActiveArtifact();
          if (!active) fail("private_theory_validation_failed");
          loadPrivateTheorySnapshot(active.artifact, active.expectedSha256);
        } catch { fail("private_theory_validation_failed"); }
        result.artifactValidated = true;
      }
    }
    temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(options.envFile), ".wavekb-runtime-"));
    fs.chmodSync(temporaryDirectory, 0o700);
    const stagedFile = path.join(temporaryDirectory, "gateway.env");
    const stagedFd = fs.openSync(stagedFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { safeRegular(fs.fstatSync(stagedFd), "unsafe_env_file"); fs.writeFileSync(stagedFd, next); fs.fsyncSync(stagedFd); }
    finally { fs.closeSync(stagedFd); }
    requireNewBackup(options.backupFile);
    writeBackup(options.backupFile, original);
    syncParent(options.backupFile);
    if (!readOwnedFile(options.envFile).equals(original)) fail("environment_changed");
    fs.renameSync(stagedFile, options.envFile);
    syncParent(options.envFile);
    return result;
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    return fail("runtime_write_failed");
  } finally {
    if (temporaryDirectory) {
      try { fs.unlinkSync(path.join(temporaryDirectory, "gateway.env")); } catch { /* Already atomically moved or unavailable. */ }
      try { fs.rmdirSync(temporaryDirectory); } catch { /* Preserve recovery files if unexpectedly changed. */ }
    }
    if (lockFd !== undefined) {
      try {
        const held = fs.fstatSync(lockFd), current = fs.lstatSync(lockPath);
        if (current.isFile() && current.dev === held.dev && current.ino === held.ino) fs.unlinkSync(lockPath);
      } catch { /* Do not delete another process's replacement lock. */ }
      fs.closeSync(lockFd);
    }
  }
}

export function parseRuntimeArguments(args: readonly string[]): RuntimeConfigurationOptions {
  const allowed = new Set(["--env-file", "--backup-file", "--enable-private", "--managed-ai"]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.has(key) || values.has(key) || !value || value.startsWith("--")) fail("invalid_arguments");
    values.set(key, value);
  }
  const enabled = values.get("--enable-private"), envFile = values.get("--env-file"), backupFile = values.get("--backup-file");
  const managedAi = values.get("--managed-ai");
  if (!envFile || !backupFile || (enabled === undefined && managedAi === undefined)
    || (enabled !== undefined && enabled !== "true" && enabled !== "false")
    || (managedAi !== undefined && !["preserve", "enable", "disable"].includes(managedAi))) fail("invalid_arguments");
  return { envFile, backupFile, ...(enabled !== undefined ? { enablePrivate: enabled === "true" } : {}), ...(managedAi !== undefined ? { managedAi: managedAi as RuntimeToggle } : {}) };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await configureResearchRuntime(parseRuntimeArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof RuntimeConfigurationError ? error.code : "runtime_write_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`); process.exitCode = 1;
  }
}
