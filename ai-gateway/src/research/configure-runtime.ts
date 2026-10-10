import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { ResearchPrivateRepository } from "./private-repository.ts";
import { loadPrivateTheorySnapshot, type ResearchPrivateRepositoryPort } from "./private-theory.ts";

const DEEPSEEK_HOST = "api.deepseek.com";
const MAX_ENV_BYTES = 1024 * 1024;
type FailureCode = "invalid_arguments" | "unsafe_env_file" | "unsafe_backup_file" | "runtime_configuration_busy"
  | "unsupported_env_format" | "invalid_runtime_configuration" | "private_theory_validation_failed"
  | "environment_changed" | "runtime_write_failed";
export class RuntimeConfigurationError extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) { super(code); this.name = "RuntimeConfigurationError"; this.code = code; }
}
function fail(code: FailureCode): never { throw new RuntimeConfigurationError(code); }
export type RuntimeConfigurationOptions = { envFile: string; backupFile: string; enablePrivate: boolean };
export type RuntimeConfigurationResult = {
  ok: true; privateResearchEnabled: boolean; deepseekHostAllowed: true; artifactValidated: boolean;
};
type Dependencies = {
  createRepository?: (database: SupabaseRest) => Pick<ResearchPrivateRepositoryPort, "loadActiveArtifact">;
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
function transformedBytes(lines: EnvLine[], env: Record<string, string>, enabled: boolean): Buffer {
  const existing = env.ALLOWED_PROVIDER_HOSTS ?? "";
  const hosts = existing.split(",").map((host) => host.trim());
  const desired = existing && !hosts.includes(DEEPSEEK_HOST) ? `${existing},${DEEPSEEK_HOST}` : existing || DEEPSEEK_HOST;
  const values: Record<string, string> = { ALLOWED_PROVIDER_HOSTS: desired, HERMES_PRIVATE_RESEARCH_ENABLED: String(enabled) };
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

/** Changes exactly two keys, with a new byte-for-byte backup and atomic replacement. */
export async function configureResearchRuntime(options: RuntimeConfigurationOptions, dependencies: Dependencies = {}): Promise<RuntimeConfigurationResult> {
  if (!options || typeof options.envFile !== "string" || typeof options.backupFile !== "string"
    || typeof options.enablePrivate !== "boolean" || options.envFile === options.backupFile) fail("invalid_arguments");
  safeParent(options.envFile, "unsafe_env_file"); requireNewBackup(options.backupFile);
  const lockPath = path.join(path.dirname(options.envFile), `.${path.basename(options.envFile)}.wavekb-runtime.lock`);
  let lockFd: number | undefined, temporaryDirectory: string | undefined;
  try {
    try {
      lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      safeRegular(fs.fstatSync(lockFd), "unsafe_env_file");
    } catch { fail("runtime_configuration_busy"); }
    const original = readOwnedFile(options.envFile), { lines, env } = parseEnvironment(original);
    if (options.enablePrivate) {
      let config;
      try {
        config = loadConfig(env);
        const url = new URL(config.SUPABASE_URL);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/"
          || !/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname)) fail("invalid_runtime_configuration");
      } catch { fail("invalid_runtime_configuration"); }
      try {
        const database = new SupabaseRest(config);
        const repository = dependencies.createRepository?.(database) ?? new ResearchPrivateRepository(database);
        const active = await repository.loadActiveArtifact();
        if (!active) fail("private_theory_validation_failed");
        loadPrivateTheorySnapshot(active.artifact, active.expectedSha256);
      } catch { fail("private_theory_validation_failed"); }
    }
    const next = transformedBytes(lines, env, options.enablePrivate);
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
    return { ok: true, privateResearchEnabled: options.enablePrivate, deepseekHostAllowed: true, artifactValidated: options.enablePrivate };
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
  const allowed = new Set(["--env-file", "--backup-file", "--enable-private"]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.has(key) || values.has(key) || !value || value.startsWith("--")) fail("invalid_arguments");
    values.set(key, value);
  }
  const enabled = values.get("--enable-private"), envFile = values.get("--env-file"), backupFile = values.get("--backup-file");
  if (values.size !== 3 || !envFile || !backupFile || (enabled !== "true" && enabled !== "false")) fail("invalid_arguments");
  return { envFile, backupFile, enablePrivate: enabled === "true" };
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
