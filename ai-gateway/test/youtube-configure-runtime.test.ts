import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseYouTubeConfigurationArguments,
  parseYouTubeConfigurationInput,
  YOUTUBE_CONFIG_INPUT_MAX_BYTES,
  YouTubeConfigurationError,
} from "../src/youtube/configure-runtime.ts";

const credentials = { clientId: "0123456789-wavekb.apps.googleusercontent.com", clientSecret: "GOCSPX_fixture-test-only-secret" };
const master = Buffer.alloc(32, 9).toString("base64");
const sha = "a".repeat(40);
const safeError = (code: string) => (error: unknown): boolean =>
  error instanceof YouTubeConfigurationError && error.code === code && error.message === code;

function portableFixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-youtube-import-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, "gateway.env");
  const backupFile = path.join(directory, "original.env");
  const content = "UNCHANGED=portable-import-contract\n";
  fs.writeFileSync(envFile, content);
  return { directory, envFile, backupFile, content };
}

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

test("arguments never accept secrets or arbitrary service commands", () => {
  assert.deepEqual(parseYouTubeConfigurationArguments(["--env-file", "/etc/service/gateway.env", "--backup-file", "/var/backups/youtube.env", "--operation", "stage"]), { envFile: "/etc/service/gateway.env", backupFile: "/var/backups/youtube.env", operation: "stage" });
  for (const args of [[], ["--operation", "stage"], ["--client-secret", credentials.clientSecret], ["--service", "other.service"], ["--operation", "stage", "--operation", "enable"], ["--env-file", "/e", "--backup-file", "/b", "--operation", "stage", "--verify-services", "false"], ["--env-file", "/e", "--backup-file", "/b", "--operation", "stage", "--expected-sha", sha]]) {
    assert.throws(() => parseYouTubeConfigurationArguments(args), safeError("invalid_arguments"));
  }
});

test("importing configuration does not read stdin, invoke services, write env or emit a CLI receipt", (t) => {
  const f = portableFixture(t), module = fileURLToPath(new URL("../src/youtube/configure-runtime.ts", import.meta.url));
  const code = `import { pathToFileURL } from 'node:url';
    process.argv = [process.execPath, '/nonexistent-importing-program', '--env-file', ${JSON.stringify(f.envFile)}, '--backup-file', ${JSON.stringify(f.backupFile)}, '--operation', 'stage'];
    globalThis.fetch = () => { throw new Error('must not request'); };
    await import(pathToFileURL(${JSON.stringify(module)}).href);
    console.log('imported_without_configuration');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { input: JSON.stringify(credentials), encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "imported_without_configuration\n");
  assert.equal(result.stderr, "");
  assert.equal(fs.readFileSync(f.envFile, "utf8"), f.content);
  assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env"]);
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
