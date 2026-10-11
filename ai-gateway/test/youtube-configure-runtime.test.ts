import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  configureYouTubeRuntime, parseYouTubeConfigurationArguments, parseYouTubeConfigurationInput,
  isYouTubeUnitRunning,
  YOUTUBE_CALLBACK, YOUTUBE_CONFIG_INPUT_MAX_BYTES, YouTubeConfigurationError,
  type YouTubeConfigurationOperation, type YouTubeConfigurationServices,
} from "../src/youtube/configure-runtime.ts";

const credentials = { clientId: "0123456789-wavekb.apps.googleusercontent.com", clientSecret: "GOCSPX_fixture-test-only-secret" };
const master = Buffer.alloc(32, 9).toString("base64");
const sha = "a".repeat(40);
const BASE_ENV = [
  "# Fixture values only; unrelated bytes must be preserved",
  "SUPABASE_URL=https://example.supabase.co",
  "SUPABASE_SERVICE_ROLE_KEY=fake-service-role-key-only",
  "MEMBERSHIP_MANAGED_AI_ENABLED=true",
  "HERMES_PRIVATE_RESEARCH_ENABLED=true",
  "TRADING_SYNC_MINUTES=15",
  "AI_SECRET_MASTER_KEY=untouched-ai-key",
  "WEIXIN_FIXTURE='untouched value'",
  "UNRELATED='  exact spacing  '",
  "; retained comment",
  "",
].join("\n");
const CONFIGURED_ENV = BASE_ENV + [
  `YOUTUBE_OAUTH_CLIENT_ID=${credentials.clientId}`,
  `YOUTUBE_OAUTH_CLIENT_SECRET=${credentials.clientSecret}`,
  `YOUTUBE_OAUTH_REDIRECT_URI=${YOUTUBE_CALLBACK}`,
  `YOUTUBE_TOKEN_MASTER_KEY=${master}`,
  "YOUTUBE_SYNC_ENABLED=false",
  "",
].join("\n");
function fixture(t: TestContext, content: string | Buffer = BASE_ENV) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-youtube-configure-test-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, "gateway.env"), backupFile = path.join(directory, "original.env");
  fs.writeFileSync(envFile, content, { mode: 0o600 });
  return { directory, envFile, backupFile };
}
function options(f: ReturnType<typeof fixture>, operation: YouTubeConfigurationOperation = "stage") {
  return { envFile: f.envFile, backupFile: f.backupFile, operation };
}
const safeError = (code: string) => (error: unknown): boolean => error instanceof YouTubeConfigurationError && error.code === code && error.message === code;
function unchanged(f: ReturnType<typeof fixture>, content: string | Buffer = BASE_ENV): void {
  assert.deepEqual(fs.readFileSync(f.envFile), Buffer.from(content));
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env"]);
}
function serviceFixture(workerActive = true): { port: YouTubeConfigurationServices; restarts: string[]; state: { gatewayActive: boolean; workerActive: boolean } } {
  const restarts: string[] = [], state = { gatewayActive: true, workerActive };
  return {
    restarts, state,
    port: { inspect: async () => ({ ...state }), restart: async (service) => { restarts.push(service); }, health: async (expected) => { assert.equal(expected, sha); return true; } },
  };
}

test("stage generates a fresh server master key, remains disabled, and backs up exact original bytes", async (t) => {
  const f = fixture(t), result = await configureYouTubeRuntime(options(f), credentials);
  assert.deepEqual(result, { ok: true, configured: true, enabled: false, generatedMasterKey: true, changed: true, appliedToRunningServices: false, workerActive: null });
  const output = fs.readFileSync(f.envFile, "utf8");
  assert.ok(output.startsWith(BASE_ENV));
  assert.ok(output.includes(`YOUTUBE_OAUTH_CLIENT_ID=${credentials.clientId}\n`));
  assert.ok(output.includes(`YOUTUBE_OAUTH_CLIENT_SECRET=${credentials.clientSecret}\n`));
  assert.ok(output.includes(`YOUTUBE_OAUTH_REDIRECT_URI=${YOUTUBE_CALLBACK}\n`));
  assert.ok(output.includes("YOUTUBE_SYNC_ENABLED=false\n"));
  const key = /YOUTUBE_TOKEN_MASTER_KEY=(.*)\n/u.exec(output)![1]!;
  assert.equal(Buffer.from(key, "base64").length, 32);
  assert.equal(Buffer.from(key, "base64").toString("base64"), key);
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), BASE_ENV);
  for (const filename of [f.envFile, f.backupFile]) {
    const stat = fs.lstatSync(filename);
    assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.uid, process.getuid!()); assert.equal(stat.nlink, 1);
  }
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env", "original.env"]);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(result).includes(credentials.clientSecret), false);
});
test("existing valid master key is never rotated; identical stage is a no-op", async (t) => {
  const f = fixture(t, CONFIGURED_ENV), result = await configureYouTubeRuntime(options(f), credentials);
  assert.equal(result.generatedMasterKey, false); assert.equal(result.changed, false);
  unchanged(f, CONFIGURED_ENV);
});
test("enable and disable change only the YouTube flag, preserving every unrelated key and the master key", async (t) => {
  const f = fixture(t, CONFIGURED_ENV);
  const enabled = await configureYouTubeRuntime(options(f, "enable"), {});
  assert.equal(enabled.enabled, true);
  const running = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true");
  assert.equal(fs.readFileSync(f.envFile, "utf8"), running);
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), CONFIGURED_ENV);
  const disabledBackup = path.join(f.directory, "disabled-original.env");
  const disabled = await configureYouTubeRuntime({ ...options(f, "disable"), backupFile: disabledBackup }, {});
  assert.equal(disabled.enabled, false); assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV);
  assert.equal(fs.readFileSync(disabledBackup, "utf8"), running);
});
test("stage refuses enabled state and implicit credential rotation before any write", async (t) => {
  const running = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true"), f = fixture(t, running);
  await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("stage_requires_disabled")); unchanged(f, running);
  for (const changed of [{ ...credentials, clientId: "other.apps.googleusercontent.com" }, { ...credentials, clientSecret: "GOCSPX_other-fixture-secret" }]) {
    const configured = fixture(t, CONFIGURED_ENV);
    await assert.rejects(configureYouTubeRuntime(options(configured), changed), safeError("youtube_credentials_already_configured")); unchanged(configured, CONFIGURED_ENV);
  }
});
test("preserves CRLF, quotes, spacing and unrelated unterminated final line", async (t) => {
  const input = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", ' YOUTUBE_SYNC_ENABLED = "false" ').replaceAll("\n", "\r\n").replace(/\r\n$/u, ""), f = fixture(t, input);
  await configureYouTubeRuntime(options(f, "enable"), {});
  assert.equal(fs.readFileSync(f.envFile, "utf8"), input.replace('"false" ', '"true" '));
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), input);
  const initial = fixture(t, BASE_ENV.trimEnd());
  await configureYouTubeRuntime(options(initial), credentials);
  assert.ok(fs.readFileSync(initial.envFile, "utf8").startsWith(BASE_ENV.trimEnd() + "\n"));
});
test("stage candidate is fully validated as enabled even though it remains disabled", async (t) => {
  for (const suffix of ["YOUTUBE_SYNC_POLL_SECONDS=1\n", "YOUTUBE_SYNC_MAX_CALLS_PER_POLL=4\n", "YOUTUBE_SYNC_BATCH_SIZE=0\n", "YOUTUBE_TOKEN_MASTER_KEY=invalid\n"]) {
    const content = BASE_ENV + suffix, f = fixture(t, content);
    await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("youtube_configuration_invalid")); unchanged(f, content);
  }
  for (const content of [BASE_ENV.replace("SUPABASE_URL=https://example.supabase.co\n", ""), BASE_ENV.replace("https://example.supabase.co", "http://example.supabase.co"), BASE_ENV.replace("fake-service-role-key-only", "invalid whitespace")]) {
    const f = fixture(t, content);
    await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("youtube_configuration_invalid")); unchanged(f, content);
  }
  const broken = CONFIGURED_ENV.replace(YOUTUBE_CALLBACK, "https://evil.invalid/callback"), f = fixture(t, broken);
  await assert.rejects(configureYouTubeRuntime(options(f, "enable"), {}), safeError("youtube_configuration_invalid")); unchanged(f, broken);
});
test("missing credentials or master key cannot enable; existing OAuth without master cannot silently regenerate it", async (t) => {
  const missing = fixture(t);
  await assert.rejects(configureYouTubeRuntime(options(missing, "enable"), {}), safeError("youtube_credentials_missing")); unchanged(missing);
  for (const old of [`YOUTUBE_OAUTH_CLIENT_ID=${credentials.clientId}\n`, `YOUTUBE_OAUTH_CLIENT_SECRET=${credentials.clientSecret}\n`, CONFIGURED_ENV.replace(`YOUTUBE_TOKEN_MASTER_KEY=${master}\n`, "").slice(BASE_ENV.length)]) {
    const content = BASE_ENV + old, f = fixture(t, content);
    await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("youtube_master_key_missing")); unchanged(f, content);
  }
});
test("emergency disable needs no valid credentials, callback, key, database or enabled-candidate configuration", async (t) => {
  for (const content of [BASE_ENV, "YOUTUBE_SYNC_ENABLED=true\n", CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true").replace(master, "broken-but-preserved").replace(YOUTUBE_CALLBACK, "https://other.invalid/callback") + "YOUTUBE_SYNC_BATCH_SIZE=0\n"]) {
    const f = fixture(t, content), result = await configureYouTubeRuntime(options(f, "disable"), {});
    assert.equal(result.ok, true); assert.equal(result.configured, null); assert.equal(result.enabled, false); assert.equal(result.generatedMasterKey, false);
    assert.equal(fs.readFileSync(f.envFile, "utf8"), content.includes("YOUTUBE_SYNC_ENABLED=true") ? content.replace("YOUTUBE_SYNC_ENABLED=true", "YOUTUBE_SYNC_ENABLED=false") : content + "YOUTUBE_SYNC_ENABLED=false\n");
    assert.equal(fs.readFileSync(f.backupFile, "utf8"), content);
  }
  const unsafe = "YOUTUBE_SYNC_ENABLED=unsafe\n", f = fixture(t, unsafe);
  await assert.rejects(configureYouTubeRuntime(options(f, "disable"), {}), safeError("youtube_configuration_invalid")); unchanged(f, unsafe);
});
test("stdin accepts only canonical bounded JSON and operation-specific exact fields", () => {
  assert.deepEqual(parseYouTubeConfigurationInput(Buffer.from(JSON.stringify(credentials)), "stage"), credentials);
  assert.deepEqual(parseYouTubeConfigurationInput(Buffer.from("{}\n"), "enable"), {});
  for (const input of ["", "null", "[]", "{}", JSON.stringify({ ...credentials, tokenMasterKey: master }), JSON.stringify({ ...credentials, clientId: "https://evil.invalid" }), JSON.stringify({ ...credentials, clientSecret: "has whitespace" }), '{"clientId":"a.apps.googleusercontent.com","clientId":"b.apps.googleusercontent.com","clientSecret":"fixture123"}', JSON.stringify(credentials, null, 2), JSON.stringify(credentials).replace("clientId", "client\\u0049d")]) {
    assert.throws(() => parseYouTubeConfigurationInput(Buffer.from(input), "stage"), safeError("invalid_configuration_input"));
  }
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(YOUTUBE_CONFIG_INPUT_MAX_BYTES + 1, 32)]) {
    assert.throws(() => parseYouTubeConfigurationInput(bytes, "stage"), safeError("invalid_configuration_input"));
  }
  for (const operation of ["enable", "disable"] as const) assert.throws(() => parseYouTubeConfigurationInput(Buffer.from(JSON.stringify(credentials)), operation), safeError("invalid_configuration_input"));
});
test("unsupported environment syntax, duplicate keys, BOM, NUL and invalid UTF8 fail without write", async (t) => {
  for (const suffix of ["SUPABASE_URL=https://other.invalid\n", "UNRELATED='multiline\nvalue'\n", "export NEW=value\n", "NEW=escaped\\value\n", 'NEW="unclosed\n', "broken line\n", "NEW=x\rOTHER=y\n", "NEW=x\0y\n"]) {
    const content = BASE_ENV + suffix, f = fixture(t, content);
    await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("unsupported_env_format")); unchanged(f, content);
  }
  for (const content of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BASE_ENV)]), Buffer.from([0xff, 0xfe])]) {
    const f = fixture(t, content);
    await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("unsupported_env_format")); unchanged(f, content);
  }
});
test("unsafe env mode, hardlink, symlink, parent and oversized input are rejected", async (t) => {
  for (const mode of [0o400, 0o640, 0o644, 0o1600]) {
    const f = fixture(t); fs.chmodSync(f.envFile, mode);
    await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("unsafe_env_file")); unchanged(f);
  }
  const linked = fixture(t); fs.linkSync(linked.envFile, path.join(linked.directory, "hardlink.env"));
  await assert.rejects(configureYouTubeRuntime(options(linked), credentials), safeError("unsafe_env_file"));
  const symbolic = fixture(t); fs.renameSync(symbolic.envFile, path.join(symbolic.directory, "target.env")); fs.symlinkSync("target.env", symbolic.envFile);
  await assert.rejects(configureYouTubeRuntime(options(symbolic), credentials), safeError("unsafe_env_file"));
  const parent = fixture(t); fs.chmodSync(parent.directory, 0o770);
  await assert.rejects(configureYouTubeRuntime(options(parent), credentials), safeError("unsafe_env_file")); unchanged(parent);
  const large = fixture(t, Buffer.alloc(1024 * 1024 + 1, 32));
  await assert.rejects(configureYouTubeRuntime(options(large), credentials), safeError("unsafe_env_file")); unchanged(large, Buffer.alloc(1024 * 1024 + 1, 32));
});
test("existing backup or alias path cannot overwrite old credentials", async (t) => {
  const f = fixture(t); fs.writeFileSync(f.backupFile, "prior backup fixture", { mode: 0o600 });
  await assert.rejects(configureYouTubeRuntime(options(f), credentials), safeError("unsafe_backup_file"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), BASE_ENV); assert.equal(fs.readFileSync(f.backupFile, "utf8"), "prior backup fixture");
  const alias = fixture(t);
  await assert.rejects(configureYouTubeRuntime({ ...options(alias), backupFile: alias.envFile }, credentials), safeError("invalid_arguments")); unchanged(alias);
});
test("shared environment lock prevents concurrent writer and is retained through service verification", async (t) => {
  const f = fixture(t, CONFIGURED_ENV), lock = path.join(f.directory, ".gateway.env.wavekb-runtime.lock"), service = serviceFixture(); let checks = 0;
  service.port.health = async () => {
    checks++; assert.equal(fs.lstatSync(lock).mode & 0o7777, 0o600);
    await assert.rejects(configureYouTubeRuntime({ ...options(f, "disable"), backupFile: path.join(f.directory, "other.env") }, {}), safeError("runtime_configuration_busy"));
    return true;
  };
  await configureYouTubeRuntime({ ...options(f, "enable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port });
  assert.equal(checks, 2); assert.equal(fs.existsSync(lock), false);
  const busy = fixture(t); fs.writeFileSync(path.join(busy.directory, ".gateway.env.wavekb-runtime.lock"), "other owner operation", { mode: 0o600 });
  await assert.rejects(configureYouTubeRuntime(options(busy), credentials), safeError("runtime_configuration_busy"));
  assert.equal(fs.existsSync(path.join(busy.directory, ".gateway.env.wavekb-runtime.lock")), true);
});
test("stage and disable restart only already-active services, never start/enable inactive worker", async (t) => {
  const staged = fixture(t), service = serviceFixture(false);
  const result = await configureYouTubeRuntime({ ...options(staged), verifyServices: true, expectedSha: sha }, credentials, { services: service.port });
  assert.equal(result.appliedToRunningServices, true); assert.equal(result.enabled, false); assert.equal(result.workerActive, false);
  assert.deepEqual(service.restarts, ["gateway"]);
  const content = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true"), disabled = fixture(t, content), inactive = serviceFixture(false);
  await configureYouTubeRuntime({ ...options(disabled, "disable"), verifyServices: true, expectedSha: sha }, {}, { services: inactive.port });
  assert.deepEqual(inactive.restarts, ["gateway"]); assert.equal(inactive.state.workerActive, false);
});
test("enable requires current exact revision, active Gateway and previously-active worker before backup/write", async (t) => {
  for (const kind of ["gateway", "worker", "health"] as const) {
    const f = fixture(t, CONFIGURED_ENV), service = serviceFixture(kind !== "worker");
    if (kind === "gateway") service.state.gatewayActive = false;
    if (kind === "health") service.port.health = async () => false;
    await assert.rejects(configureYouTubeRuntime({ ...options(f, "enable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port }), safeError(kind === "gateway" ? "youtube_gateway_inactive" : kind === "worker" ? "youtube_worker_inactive" : "service_verification_failed"));
    unchanged(f, CONFIGURED_ENV); assert.deepEqual(service.restarts, []);
  }
});
test("systemd readiness requires loaded/active/running and a positive real MainPID", () => {
  const valid = "MainPID=12345\nLoadState=loaded\nActiveState=active\nSubState=running\n";
  assert.equal(isYouTubeUnitRunning(valid), true);
  for (const value of [null, "active", valid.replace("loaded", "not-found"), valid.replace("active", "activating"), valid.replace("running", "exited"), valid.replace("12345", "0"), valid.replace("12345", "-1"), valid.replace("12345", "012"), valid.replace("12345", "2147483648"), valid.replace("12345", "secret-value"), valid.replace("LoadState=loaded\n", ""), valid + "MainPID=999\n", valid + "UNRELATED=ignored\n", " ".repeat(4097)]) assert.equal(isYouTubeUnitRunning(value), false);
});
test("service verification rechecks running state after a successful health response", async (t) => {
  for (const failAt of [1, 2]) {
    const f = fixture(t, CONFIGURED_ENV), service = serviceFixture(); let healthy = 0;
    service.port.health = async () => { if (++healthy === failAt) service.state.workerActive = false; return true; };
    service.port.restart = async (name) => { service.restarts.push(name); if (name === "youtube") service.state.workerActive = true; };
    await assert.rejects(configureYouTubeRuntime({ ...options(f, "enable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port }), safeError("service_verification_failed"));
    assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV);
    if (failAt === 1) unchanged(f, CONFIGURED_ENV);
    else assert.deepEqual(service.restarts, ["gateway", "youtube", "gateway", "youtube"]);
  }
});
test("emergency disable persists false despite broken pre-health or inactive Gateway, without starting it", async (t) => {
  const running = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true"), f = fixture(t, running), service = serviceFixture();
  service.state.gatewayActive = false; let checks = 0;
  service.port.health = async () => { checks++; return false; };
  const result = await configureYouTubeRuntime({ ...options(f, "disable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port });
  assert.deepEqual(result, { ok: false, code: "youtube_disable_not_verified", configured: null, enabled: false, generatedMasterKey: false, changed: true, appliedToRunningServices: false, workerActive: null });
  assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV); assert.equal(fs.readFileSync(f.backupFile, "utf8"), running);
  assert.deepEqual(service.restarts, ["youtube"]); assert.equal(checks, 1, "no pre-health prerequisite for emergency disable");
});
test("disable attempts both originally-active restarts; failure never restores true or retries opening", async (t) => {
  const running = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true"), f = fixture(t, running), service = serviceFixture();
  service.port.restart = async (name) => { service.restarts.push(name); if (name === "gateway") throw new Error("private process stderr"); };
  const result = await configureYouTubeRuntime({ ...options(f, "disable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port });
  assert.equal(result.ok, false); assert.equal(result.enabled, false); assert.equal(result.appliedToRunningServices, false);
  assert.deepEqual(service.restarts, ["gateway", "youtube"]); assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV); assert.equal(fs.readFileSync(f.backupFile, "utf8"), running);
});
test("disable still closes when service inspection fails, but reports unverified running services", async (t) => {
  const running = "YOUTUBE_SYNC_ENABLED=true\n", f = fixture(t, running), service = serviceFixture();
  service.port.inspect = async () => { throw new Error("private unit detail"); };
  service.port.health = async () => { throw new Error("must not assume which services to restart"); };
  const result = await configureYouTubeRuntime({ ...options(f, "disable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port });
  assert.equal(result.ok, false); assert.equal(result.workerActive, null); assert.equal(result.enabled, false); assert.deepEqual(service.restarts, []);
  assert.equal(fs.readFileSync(f.envFile, "utf8"), "YOUTUBE_SYNC_ENABLED=false\n");
});
test("disable with post-rename fsync uncertainty never restores an old true flag", async (t) => {
  const running = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true"), f = fixture(t, running), originalSync = fs.fsyncSync; let calls = 0;
  t.mock.method(fs, "fsyncSync", (fd: number) => { if (++calls === 4) throw new Error("fixture post-rename fsync failed"); originalSync(fd); });
  const result = await configureYouTubeRuntime(options(f, "disable"), {});
  assert.equal(result.ok, false); assert.equal(result.enabled, false); assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV);
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), running); assert.equal(calls, 4);
});
test("disable cannot overwrite or report success for a later writer's configuration", async (t) => {
  const running = "YOUTUBE_SYNC_ENABLED=true\n", f = fixture(t, running), service = serviceFixture(), later = running + "LATER_WRITER=preserved\n";
  service.port.restart = async () => { fs.writeFileSync(f.envFile, later, { mode: 0o600 }); };
  await assert.rejects(configureYouTubeRuntime({ ...options(f, "disable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port }), safeError("environment_changed"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), later); assert.equal(fs.readFileSync(f.backupFile, "utf8"), running);
});
test("post-write service failure rolls back exact bytes and restores original active state under same lock", async (t) => {
  const f = fixture(t, CONFIGURED_ENV), service = serviceFixture(); let healthy = 0;
  service.port.health = async () => ++healthy !== 2;
  await assert.rejects(configureYouTubeRuntime({ ...options(f, "enable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port }), safeError("service_verification_failed"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV);
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), CONFIGURED_ENV);
  assert.deepEqual(service.restarts, ["gateway", "youtube", "gateway", "youtube"]);
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env", "original.env"]);
});
test("rollback uses CAS and never overwrites later configuration bytes", async (t) => {
  const f = fixture(t, CONFIGURED_ENV), service = serviceFixture(), later = CONFIGURED_ENV + "UNRELATED_LATER=preserved\n";
  service.port.restart = async () => { fs.writeFileSync(f.envFile, later, { mode: 0o600 }); throw new Error("secret backend detail must not leak"); };
  await assert.rejects(configureYouTubeRuntime({ ...options(f, "enable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port }), safeError("rollback_conflict"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), later); assert.equal(fs.readFileSync(f.backupFile, "utf8"), CONFIGURED_ENV);
});
test("fsync error after candidate rename rolls back while retaining original 0600 backup", async (t) => {
  const f = fixture(t, CONFIGURED_ENV), originalSync = fs.fsyncSync; let calls = 0;
  t.mock.method(fs, "fsyncSync", (fd: number) => { if (++calls === 4) throw new Error("fixture post-rename fsync failed"); originalSync(fd); });
  await assert.rejects(configureYouTubeRuntime(options(f, "enable"), {}), safeError("runtime_write_failed"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV); assert.equal(fs.readFileSync(f.backupFile, "utf8"), CONFIGURED_ENV);
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env", "original.env"]);
});
test("failed rollback service verification reports only static code and preserves restored file", async (t) => {
  const f = fixture(t, CONFIGURED_ENV), service = serviceFixture();
  service.port.restart = async () => { throw new Error("private service stderr"); };
  await assert.rejects(configureYouTubeRuntime({ ...options(f, "enable"), verifyServices: true, expectedSha: sha }, {}, { services: service.port }), safeError("runtime_rollback_failed"));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV);
});
test("arguments never accept secrets or arbitrary service commands", () => {
  assert.deepEqual(parseYouTubeConfigurationArguments(["--env-file", "/etc/service/gateway.env", "--backup-file", "/var/backups/youtube.env", "--operation", "stage"]), { envFile: "/etc/service/gateway.env", backupFile: "/var/backups/youtube.env", operation: "stage" });
  for (const args of [[], ["--operation", "stage"], ["--client-secret", credentials.clientSecret], ["--service", "other.service"], ["--operation", "stage", "--operation", "enable"], ["--env-file", "/e", "--backup-file", "/b", "--operation", "stage", "--verify-services", "false"], ["--env-file", "/e", "--backup-file", "/b", "--operation", "stage", "--expected-sha", sha]]) {
    assert.throws(() => parseYouTubeConfigurationArguments(args), safeError("invalid_arguments"));
  }
});
test("CLI stdin configures without exposing credentials in safe result or static failure", (t) => {
  const script = fileURLToPath(new URL("../src/youtube/configure-runtime.ts", import.meta.url)), f = fixture(t);
  const args = [script, "--env-file", f.envFile, "--backup-file", f.backupFile, "--operation", "stage"];
  const result = spawnSync(process.execPath, args, { input: JSON.stringify(credentials), encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).enabled, false); assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes(credentials.clientId), false); assert.equal(result.stdout.includes(credentials.clientSecret), false);
  const bad = fixture(t), invalid = spawnSync(process.execPath, [script, "--env-file", bad.envFile, "--backup-file", bad.backupFile, "--operation", "stage"], { input: JSON.stringify({ ...credentials, clientSecret: "private secret text" }), encoding: "utf8", timeout: 10_000 });
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ""); assert.deepEqual(JSON.parse(invalid.stderr), { ok: false, code: "invalid_configuration_input" }); unchanged(bad);
  const oversized = spawnSync(process.execPath, [script, "--env-file", bad.envFile, "--backup-file", bad.backupFile, "--operation", "stage"], { input: Buffer.alloc(YOUTUBE_CONFIG_INPUT_MAX_BYTES + 1), encoding: "utf8", timeout: 10_000 });
  assert.equal(oversized.status, 1); assert.deepEqual(JSON.parse(oversized.stderr), { ok: false, code: "invalid_configuration_input" }); unchanged(bad);
});
test("direct and current-symlink CLI entrypoints both run and cannot silently succeed without a receipt", (t) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const symbolic of [false, true]) {
    const f = fixture(t);
    const current = path.join(f.directory, "current");
    if (symbolic) fs.symlinkSync(root, current);
    const script = symbolic ? path.join(current, "src/youtube/configure-runtime.ts") : path.join(root, "src/youtube/configure-runtime.ts");
    const invalid = spawnSync(process.execPath, ["--", script], { input: "{}", encoding: "utf8", timeout: 10_000 });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.deepEqual(JSON.parse(invalid.stderr), { ok: false, code: "invalid_arguments" });
    const result = spawnSync(process.execPath, ["--", script, "--env-file", f.envFile, "--backup-file", f.backupFile, "--operation", "stage"],
      { input: JSON.stringify(credentials), encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0); assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).configured, true);
    assert.equal(JSON.parse(result.stdout).enabled, false);
    assert.ok(fs.existsSync(f.backupFile));
    assert.equal(result.stdout.includes(credentials.clientSecret), false);
  }
});
test("importing configuration does not read stdin, invoke services, write env or emit a CLI receipt", (t) => {
  const f = fixture(t), module = fileURLToPath(new URL("../src/youtube/configure-runtime.ts", import.meta.url));
  const code = `import { pathToFileURL } from 'node:url';
    process.argv = [process.execPath, '/nonexistent-importing-program', '--env-file', ${JSON.stringify(f.envFile)}, '--backup-file', ${JSON.stringify(f.backupFile)}, '--operation', 'stage'];
    globalThis.fetch = () => { throw new Error('must not request'); };
    await import(pathToFileURL(${JSON.stringify(module)}).href);
    console.log('imported_without_configuration');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { input: JSON.stringify(credentials), encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, "imported_without_configuration\n"); assert.equal(result.stderr, "");
  unchanged(f);
});
test("CLI emergency disable uncertainty is nonzero and reports closed-but-unverified without any secret values", (t) => {
  const script = fileURLToPath(new URL("../src/youtube/configure-runtime.ts", import.meta.url)), running = CONFIGURED_ENV.replace("YOUTUBE_SYNC_ENABLED=false", "YOUTUBE_SYNC_ENABLED=true"), f = fixture(t, running);
  const program = `
    import fs from "node:fs"; import { pathToFileURL } from "node:url";
    const [script, envFile, backupFile] = process.argv.slice(1), originalSync = fs.fsyncSync;
    let calls = 0; fs.fsyncSync = (fd) => { if (++calls === 4) throw new Error("private mock stderr"); originalSync(fd); };
    process.argv = [process.execPath, script, "--env-file", envFile, "--backup-file", backupFile, "--operation", "disable"];
    await import(pathToFileURL(script).href);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program, "--", script, f.envFile, f.backupFile], { input: "{}", encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.ok, false); assert.equal(receipt.code, "youtube_disable_not_verified"); assert.equal(receipt.enabled, false); assert.equal(receipt.appliedToRunningServices, false);
  for (const secret of [credentials.clientId, credentials.clientSecret, master, "private mock stderr"]) assert.equal(result.stderr.includes(secret), false);
  assert.equal(fs.readFileSync(f.envFile, "utf8"), CONFIGURED_ENV); assert.equal(fs.readFileSync(f.backupFile, "utf8"), running);
});

// Reuse the existing ESLint YAML parser rather than adding a deployment/runtime dependency.
const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml") as { load(text: string): any };
const workflow = yaml.load(fs.readFileSync(new URL("../../.github/workflows/configure-youtube-production.yml", import.meta.url), "utf8"));
const configurationSteps = workflow.jobs["configure-youtube"].steps as Array<{ name: string; run?: string; env?: Record<string, string>; if?: string; uses?: string }>;
const contractSteps = workflow.jobs["verify-configuration-contract"].steps as typeof configurationSteps;
test("workflow is explicit production/main only, serializes with backend and defaults to stage", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ["confirmation", "operation"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, "stage");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.operation.options, ["stage", "enable", "disable"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.concurrency, { group: "wavekb-backend-production", "cancel-in-progress": false });
  assert.equal(workflow.jobs["configure-youtube"].environment, "production");
  assert.equal(workflow.jobs["configure-youtube"].needs, "verify-configuration-contract");
  for (const steps of [configurationSteps, contractSteps]) {
    assert.match(steps[0]!.run!, /test "\$GITHUB_REF" = refs\/heads\/main/);
    assert.match(steps[0]!.run!, /test "\$CONFIRMATION" = CONFIGURE_WAVEKB_YOUTUBE/);
    assert.match(steps[0]!.run!, /case "\$OPERATION" in stage\|enable\|disable/);
  }
  assert.doesNotMatch(JSON.stringify(contractSteps), /secrets\./);
  assert.match(contractSteps.find((step) => /local safe configuration/.test(step.name))!.run!, /typecheck[\s\S]*youtube-configure-runtime\.test\.ts/);
});
test("workflow verifies installed same SHA before sending credentials and never uploads executable code", () => {
  const installed = configurationSteps.findIndex((step) => /installed immutable/.test(step.name)), apply = configurationSteps.findIndex((step) => /Apply bounded stdin/.test(step.name));
  assert.ok(installed > 0 && apply > installed);
  assert.match(configurationSteps[installed]!.run!, /\/current\/DEPLOYMENT_VERSION/);
  assert.match(configurationSteps[installed]!.run!, /version !== expected/);
  assert.match(configurationSteps[installed]!.run!, /body\.deployment !== expected/);
  assert.match(configurationSteps[installed]!.run!, /current\/src\/youtube\/configure-runtime\.ts/);
  assert.equal(configurationSteps[installed]!.env!.OPERATION, "${{ inputs.operation }}");
  assert.match(configurationSteps[installed]!.run!, /if \(process\.argv\[3\] !== 'disable'\) \{[\s\S]*fetch\('http:\/\/127\.0\.0\.1:8787\/health'/);
  assert.match(configurationSteps.find((step) => /current main revision/.test(step.name))!.run!, /git ls-remote origin refs\/heads\/main[\s\S]*test "\$current_main" = "\$GITHUB_SHA"/);
  const body = configurationSteps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(body, /scp |sftp |rsync |tar |upload-artifact|download-artifact|sudo.*systemctl|systemctl (?:enable|start|stop|disable)/);
  assert.doesNotMatch(body, /membership|trading|weixin|research\/configure-runtime|ai_provider|YOUTUBE_TOKEN_MASTER_KEY|\bpsql\b/);
});
test("workflow bounds stage secret presence before SSH; secrets travel only in pipe stdin with pinned host", () => {
  const validate = configurationSteps.findIndex((step) => /credential presence/.test(step.name)), pinned = configurationSteps.findIndex((step) => /pinned SSH/.test(step.name));
  assert.ok(validate > 0 && pinned > validate);
  const ssh = configurationSteps[pinned]!, apply = configurationSteps.find((step) => /Apply bounded stdin/.test(step.name))!;
  assert.equal(ssh.env!.DEPLOY_HOST_FINGERPRINT, "SHA256:VDPcrNGSByDvXoaFy8GUJaqSNWS9tfyekTMi8zPXeE8");
  assert.match(ssh.run!, /test "\$actual_fingerprint" = "\$DEPLOY_HOST_FINGERPRINT"/);
  assert.match(apply.run!, /process\.stdout\.write\(text\);[\s\S]*' \| ssh /);
  assert.match(apply.run!, /StrictHostKeyChecking=yes/);
  assert.match(apply.run!, /"\$remote_command" 2>\/dev\/null[\s\S]*\| node scripts\/project-youtube-configuration\.mjs --operation "\$OPERATION"/);
  assert.match(apply.run!, /--verify-services true --expected-sha \$\{GITHUB_SHA\}/);
  assert.match(apply.run!, /--backup-file \/var\/backups\/elliott-wave-gateway\/youtube-config-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}\.env/);
  const remoteCommand = apply.run!.split("\n").find((line) => line.trimStart().startsWith("remote_command="))!;
  assert.doesNotMatch(remoteCommand, /CLIENT_ID|CLIENT_SECRET|MASTER_KEY|credential|secret/i);
  for (const step of configurationSteps) {
    assert.doesNotMatch(step.run ?? "", /set -[^\n]*x|echo.*CLIENT_SECRET|printf.*CLIENT_SECRET|console\.(?:log|error)\(input|writeFile|tee |env >|printenv/);
    assert.ok(!step.uses?.includes("artifact"));
  }
  assert.equal(configurationSteps.at(-1)!.if, "always()");
});
test("every configuration workflow shell program parses and actual input validation rejects missing credentials", () => {
  for (const step of [...configurationSteps, ...contractSteps].filter((item) => item.run)) {
    const syntax = spawnSync("bash", ["-n"], { input: step.run!, encoding: "utf8" });
    assert.equal(syntax.status, 0, `${step.name}: ${syntax.stderr}`);
  }
  const validate = configurationSteps.find((step) => /credential presence/.test(step.name))!;
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  for (const operation of ["stage", "enable", "disable"] as const) {
    for (const present of [false, true]) {
      const result = spawnSync("bash", ["-c", validate.run!], { cwd, env: { PATH: process.env.PATH, OPERATION: operation, ...(present ? { YOUTUBE_OAUTH_CLIENT_ID: credentials.clientId, YOUTUBE_OAUTH_CLIENT_SECRET: credentials.clientSecret } : {}) }, encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, operation === "stage" && !present ? 1 : 0); assert.equal(result.stdout, "");
      assert.equal(result.stderr.includes(credentials.clientSecret), false);
    }
  }
});
test("actual workflow relay sends exact bounded operation JSON through stdin, never credential argv or secret result", () => {
  const apply = configurationSteps.find((step) => /Apply bounded stdin/.test(step.name))!, cwd = fileURLToPath(new URL("../..", import.meta.url));
  const mockSsh = `ssh() {
    for value in "$@"; do
      case "$value" in *"$YOUTUBE_OAUTH_CLIENT_SECRET"*|*"$YOUTUBE_OAUTH_CLIENT_ID"*) return 70 ;; esac
    done
    node --input-type=module -e '
      import { parseYouTubeConfigurationInput } from "./ai-gateway/src/youtube/configure-runtime.ts";
      const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
      const input = parseYouTubeConfigurationInput(Buffer.concat(chunks), process.env.OPERATION);
      if (Object.keys(input).length !== (process.env.OPERATION === "stage" ? 2 : 0)) throw new Error("invalid fixture input");
      console.log(JSON.stringify({ ok: true, configured: process.env.OPERATION === "disable" ? null : true,
        enabled: process.env.OPERATION === "enable", generatedMasterKey: process.env.OPERATION === "stage",
        changed: true, appliedToRunningServices: true, workerActive: true }));
    '
  }
`;
  for (const operation of ["stage", "enable", "disable"] as const) {
    const result = spawnSync("bash", ["-c", mockSsh + apply.run!], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, OPERATION: operation, GITHUB_SHA: sha, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", DEPLOY_USER: "fixture", DEPLOY_HOST: "example.invalid", YOUTUBE_OAUTH_CLIENT_ID: credentials.clientId, YOUTUBE_OAUTH_CLIENT_SECRET: credentials.clientSecret }, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { ok: true, operation, enabled: operation === "enable",
      readiness: operation === "stage" ? "staged_not_enabled" : operation === "enable" ? "enabled_services_verified" : "disabled_services_verified" });
    assert.equal(result.stdout.includes(credentials.clientSecret), false);
  }
});
test("actual workflow rejects an exit-zero remote no-op and never echoes raw remote output or stderr", () => {
  const apply = configurationSteps.find((step) => /Apply bounded stdin/.test(step.name))!, cwd = fileURLToPath(new URL("../..", import.meta.url));
  for (const output of ["", "private upstream secret text", '{"ok":true}', '{"ok":false,"code":"private-upstream-error"}']) {
    const mockSsh = `ssh() { cat >/dev/null; printf '%s' "$WAVEKB_TEST_REMOTE_OUTPUT"; printf '%s' 'private remote stderr' >&2; return 0; }\n`;
    const result = spawnSync("bash", ["-c", mockSsh + apply.run!], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME,
      OPERATION: "stage", GITHUB_SHA: sha, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", DEPLOY_USER: "fixture", DEPLOY_HOST: "example.invalid",
      YOUTUBE_OAUTH_CLIENT_ID: credentials.clientId, YOUTUBE_OAUTH_CLIENT_SECRET: credentials.clientSecret, WAVEKB_TEST_REMOTE_OUTPUT: output }, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "youtube_configuration_receipt_invalid\n");
  }
});
