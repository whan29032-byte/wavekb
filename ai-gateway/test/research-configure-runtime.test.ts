import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import { configureResearchRuntime, parseRuntimeArguments, RuntimeConfigurationError } from "../src/research/configure-runtime.ts";
import { privateTheoryDigest } from "../src/research/private-theory.ts";

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
function artifactFixture() {
  const names = ["source-pages-001-070", "source-pages-071-140", "source-pages-141-210", "source-pages-211-280", "updated-rules-and-examples", "practical-courses-01-17-distilled", "chanlun-trading-system", "cross-market-sync", "wave-chanlun-integration"];
  const labels = ["book-distillation-001", "book-distillation-002", "book-distillation-003", "book-distillation-004", "rule-supplement", "course-distillation", "structure-context", "market-context", "integration-context"];
  const chunks: Record<string, unknown>[] = [];
  const sources = names.map((name, index) => {
    const relativePath = `references/${name}.md`, originalSha256 = hash(`original-${index}`), text = `本段为补充理论资料；不得覆盖网站第十一版原书规则。未载入的图片不构成已验证证据。\n\n补充结构研究 ${index}：候选计数必须分别核对，不能承诺收益。`, curatedSha256 = hash(text);
    const id = `s_${hash(`${relativePath}\0${originalSha256}`).slice(0, 32)}`;
    const receipt = { schemaVersion: "hermes-theory-curation-receipt-v1", originalSha256, curatedSha256,
      counts: { imagesOmitted: 0, referenceLinesOmitted: 0, referenceMentionsReplaced: 0, titleMentionsReplaced: 0, newlinesNormalized: 0, noticeAdded: 1 } };
    chunks.push({ id: `h_${hash(`${id}\0${0}\0${text}`).slice(0, 32)}`, sourceId: id, index: 0, text, sha256: curatedSha256, authority: "supplement" });
    return { id, relativePath, sourceLabel: labels[index], authority: "supplement", original: { sha256: originalSha256, bytes: 20, version: `sha256:${originalSha256}` },
      curated: { sha256: curatedSha256, bytes: Buffer.byteLength(text), version: "hermes-theory-curation-v1" }, receipt: { ...receipt, transformSha256: privateTheoryDigest(receipt) } };
  });
  const payload = { schemaVersion: "hermes-private-theory-v2", classification: "server-private", authority: "supplement", curationVersion: "hermes-theory-curation-v1", privateSourceTerms: ["机密原书标题"], sources, chunks };
  const artifactSha256 = privateTheoryDigest(payload);
  return { artifact: { ...payload, artifactSha256 }, expectedSha256: artifactSha256 };
}
const BASE_ENV = [
  "# Existing runtime; do not reveal these fixture values",
  "SUPABASE_URL=https://example.supabase.co",
  "SUPABASE_SERVICE_ROLE_KEY=fake-service-role-key-longer-than-twenty",
  "SUPABASE_PUBLISHABLE_KEY=fake-publishable-key-longer-than-twenty",
  `AI_SECRET_MASTER_KEY=${Buffer.alloc(32, 7).toString("base64")}`,
  "AUTH_SITE_URL=https://knowledge.example.com/",
  "ALLOWED_PROVIDER_HOSTS=api.openai.com",
  "HERMES_PRIVATE_RESEARCH_ENABLED=false",
  "MEMBERSHIP_MANAGED_AI_ENABLED=false",
  "TRADING_SYNC_MINUTES=15",
  "TRADING_FIXTURE=unchanged#literal",
  "WEIXIN_FIXTURE='unchanged fixture'",
  "UNRELATED='  exact spacing  '",
  "; Existing comment retained",
  "",
].join("\n");
function fixture(t: TestContext, input: string | Buffer = BASE_ENV) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-configure-test-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, "gateway.env"), backupFile = path.join(directory, "original.env");
  fs.writeFileSync(envFile, input, { mode: 0o600 });
  return { directory, envFile, backupFile, enablePrivate: true };
}
const safeError = (code: string) => (error: unknown): boolean => error instanceof RuntimeConfigurationError && error.code === code && error.message === code;
const validRepository = () => ({ loadActiveArtifact: async () => artifactFixture() });
function assertUnchanged(f: ReturnType<typeof fixture>, expected: string | Buffer = BASE_ENV): void {
  assert.deepEqual(fs.readFileSync(f.envFile), Buffer.from(expected));
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env"]);
}

test("enable validates canonical v2 artifact, edits exactly two keys and backs up all original bytes", async (t) => {
  const f = fixture(t); let reads = 0;
  const result = await configureResearchRuntime(f, { createRepository: () => ({ loadActiveArtifact: async () => { reads++; return artifactFixture(); } }) });
  assert.deepEqual(result, { ok: true, privateResearchEnabled: true, deepseekHostAllowed: true, artifactValidated: true });
  assert.equal(reads, 1);
  assert.equal(fs.readFileSync(f.envFile, "utf8"), BASE_ENV.replace("ALLOWED_PROVIDER_HOSTS=api.openai.com", "ALLOWED_PROVIDER_HOSTS=api.openai.com,api.deepseek.com").replace("HERMES_PRIVATE_RESEARCH_ENABLED=false", "HERMES_PRIVATE_RESEARCH_ENABLED=true"));
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), BASE_ENV);
  for (const filename of [f.envFile, f.backupFile]) {
    const stat = fs.lstatSync(filename);
    assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.uid, process.getuid!()); assert.equal(stat.isSymbolicLink(), false);
  }
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env", "original.env"]);
  assert.equal(JSON.stringify(result).includes("fixture"), false);
});
test("disable does not load config, visit database, change managed AI, trading, Weixin or master key", async (t) => {
  const input = "UNKNOWN=kept\nHERMES_PRIVATE_RESEARCH_ENABLED=true\nMEMBERSHIP_MANAGED_AI_ENABLED=true\nAI_SECRET_MASTER_KEY=not-parsed-when-disabling\n";
  const f = fixture(t, input);
  const result = await configureResearchRuntime({ ...f, enablePrivate: false }, { createRepository: () => { throw new Error("must not access DB"); } });
  assert.deepEqual(result, { ok: true, privateResearchEnabled: false, deepseekHostAllowed: true, artifactValidated: false });
  assert.equal(fs.readFileSync(f.envFile, "utf8"), input.replace("HERMES_PRIVATE_RESEARCH_ENABLED=true", "HERMES_PRIVATE_RESEARCH_ENABLED=false") + "ALLOWED_PROVIDER_HOSTS=api.deepseek.com\n");
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), input);
});
test("preserves CRLF, quotes, spacing and absent terminal newline without normalizing unrelated values", async (t) => {
  const input = BASE_ENV.replace("ALLOWED_PROVIDER_HOSTS=api.openai.com", "  ALLOWED_PROVIDER_HOSTS = 'api.openai.com, api.anthropic.com'  ").replace("HERMES_PRIVATE_RESEARCH_ENABLED=false", ' HERMES_PRIVATE_RESEARCH_ENABLED = "false" ').replaceAll("\n", "\r\n").replace(/\r\n$/u, "");
  const f = fixture(t, input);
  await configureResearchRuntime(f, { createRepository: validRepository });
  assert.equal(fs.readFileSync(f.envFile, "utf8"), input.replace("api.openai.com, api.anthropic.com", "api.openai.com, api.anthropic.com,api.deepseek.com").replace('"false" ', '"true" '));
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), input);
});
test("does not duplicate the exact DeepSeek host and never mistakes a lookalike for it", async (t) => {
  const exact = fixture(t, BASE_ENV.replace("api.openai.com", "api.deepseek.com"));
  await configureResearchRuntime(exact, { createRepository: validRepository });
  assert.equal((fs.readFileSync(exact.envFile, "utf8").match(/api\.deepseek\.com/gu) ?? []).length, 1);
  const lookalike = fixture(t, BASE_ENV.replace("api.openai.com", "api.deepseek.com.evil.invalid"));
  await configureResearchRuntime(lookalike, { createRepository: validRepository });
  assert.ok(fs.readFileSync(lookalike.envFile, "utf8").includes("api.deepseek.com.evil.invalid,api.deepseek.com\n"));
});
test("adds both missing keys and treats an empty host list safely", async (t) => {
  for (const input of ["OTHER=value", "ALLOWED_PROVIDER_HOSTS=''\nOTHER=value\n"]) {
    const f = fixture(t, input);
    await configureResearchRuntime({ ...f, enablePrivate: false });
    const output = fs.readFileSync(f.envFile, "utf8");
    assert.ok(output.includes("api.deepseek.com")); assert.ok(output.includes("HERMES_PRIVATE_RESEARCH_ENABLED=false\n"));
    assert.equal(fs.readFileSync(f.backupFile, "utf8"), input);
  }
});
test("refuses missing, tampered, private-text-unsafe or mismatched digest artifacts without touching files", async (t) => {
  for (const kind of ["missing", "tampered", "digest", "pretty-file-digest", "unsafe"] as const) {
    const f = fixture(t); const active = artifactFixture();
    if (kind === "tampered") active.artifact.chunks[0]!.text = "edited content";
    if (kind === "digest") active.expectedSha256 = "a".repeat(64);
    if (kind === "pretty-file-digest") active.expectedSha256 = hash(JSON.stringify(active.artifact, null, 2));
    if (kind === "unsafe") active.artifact.chunks[0]!.text = "api_key=never-reveal-this-fixture";
    await assert.rejects(configureResearchRuntime(f, { createRepository: () => ({ loadActiveArtifact: async () => kind === "missing" ? null : active }) }), safeError("private_theory_validation_failed"));
    assertUnchanged(f);
  }
});
test("database and loadConfig error text never leaves the fixed failure code", async (t) => {
  const f = fixture(t);
  await assert.rejects(configureResearchRuntime(f, { createRepository: () => ({ loadActiveArtifact: async () => { throw new Error("private db credential from host 192.0.2.3"); } }) }), safeError("private_theory_validation_failed"));
  assertUnchanged(f);
  const invalid = fixture(t, BASE_ENV.replace("TRADING_SYNC_MINUTES=15", "TRADING_SYNC_MINUTES=private-secret-value"));
  await assert.rejects(configureResearchRuntime(invalid, { createRepository: validRepository }), safeError("invalid_runtime_configuration"));
  assertUnchanged(invalid, BASE_ENV.replace("TRADING_SYNC_MINUTES=15", "TRADING_SYNC_MINUTES=private-secret-value"));
});
test("enable only sends existing service credentials to a canonical HTTPS Supabase origin", async (t) => {
  for (const url of ["http://example.supabase.co", "https://example.supabase.co.evil.invalid", "https://user:password@example.supabase.co", "https://example.supabase.co/path", "https://example.supabase.co?secret=x"]) {
    const input = BASE_ENV.replace("https://example.supabase.co", url), f = fixture(t, input);
    await assert.rejects(configureResearchRuntime(f, { createRepository: () => { throw new Error("must not visit unsafe database"); } }), safeError("invalid_runtime_configuration"));
    assertUnchanged(f, input);
  }
});
test("rejects duplicate keys, multiline, escape syntax, malformed values, BOM, bare CR and invalid UTF-8", async (t) => {
  for (const suffix of ["ALLOWED_PROVIDER_HOSTS=another.host\n", "UNKNOWN='multi\nHERMES_PRIVATE_RESEARCH_ENABLED=true\nline'\n", "UNKNOWN=escaped\\value\n", "UNKNOWN=\"unclosed\n", "export UNKNOWN=value\n", "malformed line\n", "UNKNOWN=x\rOTHER=y\n"]) {
    const input = BASE_ENV + suffix, f = fixture(t, input);
    await assert.rejects(configureResearchRuntime({ ...f, enablePrivate: false }), safeError("unsupported_env_format")); assertUnchanged(f, input);
  }
  for (const input of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BASE_ENV)]), Buffer.from([0xff, 0xfe]), Buffer.from("KEY=has\0nul\n")]) {
    const f = fixture(t, input);
    await assert.rejects(configureResearchRuntime({ ...f, enablePrivate: false }), safeError("unsupported_env_format")); assertUnchanged(f, input);
  }
});
test("unsafe mode, symlink, hardlink and non-regular env paths are rejected before DB reads", async (t) => {
  for (const mode of [0o400, 0o640, 0o644, 0o660, 0o1600]) {
    const f = fixture(t); fs.chmodSync(f.envFile, mode);
    await assert.rejects(configureResearchRuntime(f, { createRepository: () => { throw new Error("must not read database"); } }), safeError("unsafe_env_file")); assertUnchanged(f);
  }
  for (const kind of ["symlink", "hardlink", "directory"] as const) {
    const f = fixture(t), other = path.join(f.directory, "other.env");
    if (kind === "hardlink") fs.linkSync(f.envFile, other);
    else { fs.renameSync(f.envFile, other); if (kind === "symlink") fs.symlinkSync(other, f.envFile); else fs.mkdirSync(f.envFile); }
    await assert.rejects(configureResearchRuntime(f), safeError("unsafe_env_file"));
    assert.equal(fs.existsSync(f.backupFile), false);
    assert.equal(fs.readFileSync(kind === "hardlink" ? f.envFile : other, "utf8"), BASE_ENV);
  }
});
test("an opened regular file owned by another UID is rejected before parsing or network access", async (t) => {
  const f = fixture(t), originalStat = fs.fstatSync;
  let calls = 0;
  t.mock.method(fs, "fstatSync", ((fd: number) => {
    const stat = originalStat(fd); calls++;
    if (calls === 2) return Object.assign(Object.create(stat) as fs.Stats, { uid: process.getuid!() + 1 });
    return stat;
  }) as typeof fs.fstatSync);
  await assert.rejects(configureResearchRuntime(f, { createRepository: () => { throw new Error("must not access network"); } }), safeError("unsafe_env_file"));
  assertUnchanged(f);
});
test("backup must be a fresh explicit path: no replacement, symlink, directory or shared env target", async (t) => {
  for (const kind of ["existing", "symlink", "directory"] as const) {
    const f = fixture(t);
    if (kind === "existing") fs.writeFileSync(f.backupFile, "original backup retained", { mode: 0o600 });
    if (kind === "symlink") fs.symlinkSync(f.envFile, f.backupFile);
    if (kind === "directory") fs.mkdirSync(f.backupFile);
    await assert.rejects(configureResearchRuntime(f), safeError("unsafe_backup_file"));
    assert.equal(fs.readFileSync(f.envFile, "utf8"), BASE_ENV);
    if (kind === "existing") assert.equal(fs.readFileSync(f.backupFile, "utf8"), "original backup retained");
  }
  const f = fixture(t);
  await assert.rejects(configureResearchRuntime({ ...f, backupFile: f.envFile }), safeError("invalid_arguments")); assertUnchanged(f);
});
test("refuses noncanonical and symlink parent paths and writable parent directories", async (t) => {
  const f = fixture(t), alias = `${f.directory}-alias`;
  fs.symlinkSync(f.directory, alias); t.after(() => fs.unlinkSync(alias));
  await assert.rejects(configureResearchRuntime({ ...f, envFile: path.join(alias, "gateway.env") }), safeError("unsafe_env_file"));
  await assert.rejects(configureResearchRuntime({ ...f, backupFile: path.join(alias, "original.env") }), safeError("unsafe_backup_file"));
  await assert.rejects(configureResearchRuntime({ ...f, envFile: `${f.directory}/./gateway.env` }), safeError("unsafe_env_file"));
  await assert.rejects(configureResearchRuntime({ ...f, envFile: "relative.env" }), safeError("unsafe_env_file"));
  fs.chmodSync(f.directory, 0o777);
  await assert.rejects(configureResearchRuntime(f), safeError("unsafe_env_file"));
  fs.chmodSync(f.directory, 0o700); assertUnchanged(f);
});
test("refuses concurrent execution and never removes someone else's preexisting lock", async (t) => {
  const f = fixture(t), lock = path.join(f.directory, ".gateway.env.wavekb-runtime.lock");
  fs.writeFileSync(lock, "other process lock", { mode: 0o600 });
  await assert.rejects(configureResearchRuntime(f), safeError("runtime_configuration_busy"));
  assert.equal(fs.readFileSync(lock, "utf8"), "other process lock"); assert.equal(fs.existsSync(f.backupFile), false);
});
test("concurrent environment change is preserved and fails before replacement; full original backup remains", async (t) => {
  const f = fixture(t), changed = BASE_ENV + "EXTERNAL_SETTING=changed\n";
  await assert.rejects(configureResearchRuntime(f, { createRepository: () => ({ loadActiveArtifact: async () => { fs.writeFileSync(f.envFile, changed); return artifactFixture(); } }) }), safeError("environment_changed"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), changed); assert.equal(fs.readFileSync(f.backupFile, "utf8"), BASE_ENV);
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env", "original.env"]);
});
test("failed backup write leaves original untouched and removes only this attempt's incomplete backup", async (t) => {
  const f = fixture(t), originalWrite = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", ((filename: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (typeof filename === "number" && Buffer.isBuffer(data) && data.equals(Buffer.from(BASE_ENV))) throw new Error("fixture private disk error");
    return originalWrite(filename, data, options);
  }) as typeof fs.writeFileSync);
  await assert.rejects(configureResearchRuntime(f, { createRepository: validRepository }), safeError("runtime_write_failed"));
  assertUnchanged(f);
});
test("failed atomic replacement never partially modifies configuration and retains complete rollback backup", async (t) => {
  const f = fixture(t);
  t.mock.method(fs, "renameSync", () => { throw new Error("fixture private rename failure"); });
  await assert.rejects(configureResearchRuntime(f, { createRepository: validRepository }), safeError("runtime_write_failed"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), BASE_ENV); assert.equal(fs.readFileSync(f.backupFile, "utf8"), BASE_ENV);
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env", "original.env"]);
});
test("real Supabase adapter and repository perform exactly one service-only read RPC, no model/metadata writes", async (t) => {
  const f = fixture(t), calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    const active = artifactFixture();
    return new Response(JSON.stringify({ artifact: active.artifact, expected_sha256: active.expectedSha256 }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await configureResearchRuntime(f);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://example.supabase.co/rest/v1/rpc/hermes_research_load_active_artifact");
  assert.ok(!calls[0]!.url.includes("deepseek"));
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer fake-service-role-key-longer-than-twenty");
  assert.equal(calls[0]!.init?.body, "{}");
});
test("CLI argument contract rejects duplicates, omissions, extra flags and ambiguous booleans", () => {
  const valid = ["--env-file", "/safe/gateway.env", "--backup-file", "/safe/original.env", "--enable-private", "true"];
  assert.deepEqual(parseRuntimeArguments(valid), { envFile: "/safe/gateway.env", backupFile: "/safe/original.env", enablePrivate: true });
  assert.equal(parseRuntimeArguments([...valid.slice(0, -1), "false"]).enablePrivate, false);
  for (const invalid of [[], valid.slice(0, -1), [...valid, "--private-key", "never-print"], [...valid, "--env-file", "/other"], [...valid.slice(0, -1), "1"], [...valid.slice(0, -1), "TRUE"]]) {
    assert.throws(() => parseRuntimeArguments(invalid), safeError("invalid_arguments"));
  }
});
test("real CLI emits only safe success JSON or fixed failure JSON, never env/path/secret values", (t) => {
  const f = fixture(t), filename = path.resolve(import.meta.dirname, "../src/research/configure-runtime.ts");
  // Terminate Node's own flag parser: --env-file is also a Node flag.
  const result = spawnSync(process.execPath, ["--", filename, "--env-file", f.envFile, "--backup-file", f.backupFile, "--enable-private", "false"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, privateResearchEnabled: false, deepseekHostAllowed: true, artifactValidated: false });
  const failed = spawnSync(process.execPath, ["--", filename, "--env-file", "never-print-this-private-path"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(failed.status, 1); assert.equal(failed.stdout, ""); assert.deepEqual(JSON.parse(failed.stderr), { ok: false, code: "invalid_arguments" });
  assert.ok(!failed.stderr.includes("never-print-this")); assert.ok(!result.stdout.includes(f.directory));
});
