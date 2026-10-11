import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { integrationConfigPresence, workerServiceState } from "../scripts/integration-config-audit.mjs";

test("integration audit projects booleans only and ignores unrelated credentials", () => {
  const result = integrationConfigPresence('MENTOR_EMAIL_API_KEY="private-mail-key"\nMENTOR_EMAIL_FROM=mail@example.com\nYOUTUBE_OAUTH_CLIENT_SECRET=private-google-secret\nSUPABASE_SERVICE_ROLE_KEY=private-db-key\nBITGET_SECRET=never-read\nMENTOR_EMAIL_ENABLED=');
  assert.equal(result.configuration_presence.MENTOR_EMAIL_API_KEY, true);
  assert.equal(result.configuration_presence.MENTOR_EMAIL_ENABLED, false);
  assert.equal(result.configuration_presence.YOUTUBE_OAUTH_CLIENT_SECRET, true);
  for (const text of ["private-mail-key", "private-google-secret", "private-db-key", "BITGET", "mail@example.com"]) assert.equal(JSON.stringify(result).includes(text), false);
});
test("probe fails closed for ambiguous duplicates and has no network or write operations", () => {
  assert.throws(() => integrationConfigPresence("MENTOR_EMAIL_FROM=a\nMENTOR_EMAIL_FROM=b"), /duplicate_integration_setting/);
  const source = readFileSync(new URL("../scripts/integration-config-audit.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\(|writeFile|unlink|exec|spawn/);
  assert.match(source, /readFileSync\("\/etc\/elliott-wave\/gateway\.env"/);
});

test("wallet presence includes exactly six settings without leaking any configured value", () => {
  const result = integrationConfigPresence(`MEMBERSHIP_WALLET_ENABLED="false"
MEMBERSHIP_WALLET_ETHEREUM_RPC_URL=https://eth.private.example/v1/private-key
MEMBERSHIP_WALLET_BASE_RPC_URL='https://base.private.example/private-rpc-key'
MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS=eth.private.example,base.private.example
MEMBERSHIP_WALLET_TRONGRID_API_KEY=private-trongrid-key
MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE=2
MEMBERSHIP_WALLET_RECIPIENT=private-recipient
SUPABASE_SERVICE_ROLE_KEY=private-service-role`);
  const wallet = Object.entries(result.configuration_presence).filter(([key]) => key.startsWith("MEMBERSHIP_WALLET_"));
  assert.equal(wallet.length, 6);
  assert.ok(wallet.every(([, present]) => present === true));
  assert.equal(result.wallet_flag_valid, true);
  assert.equal(result.wallet_enabled, false);
  for (const text of ["https:", "private.example", "private-key", "private-rpc-key", "private-trongrid-key", "private-recipient", "private-service-role", "MEMBERSHIP_WALLET_RECIPIENT"]) {
    assert.equal(JSON.stringify(result).includes(text), false);
  }
});

test("wallet enable flag is strict, missing defaults disabled, and duplicates fail closed", () => {
  const absent = integrationConfigPresence("");
  assert.equal(absent.configuration_presence.MEMBERSHIP_WALLET_ENABLED, false);
  assert.equal(absent.wallet_flag_valid, true);
  assert.equal(absent.wallet_enabled, false);
  for (const [setting, valid, enabled] of [['"true"', true, true], ["'false'", true, false], ["TRUE", false, false], ["1", false, false], ['" true "', false, false], ["", false, false]]) {
    const result = integrationConfigPresence(`MEMBERSHIP_WALLET_ENABLED=${setting}`);
    assert.equal(result.wallet_flag_valid, valid, setting);
    assert.equal(result.wallet_enabled, enabled, setting);
  }
  assert.throws(() => integrationConfigPresence("MEMBERSHIP_WALLET_ENABLED=true\nMEMBERSHIP_WALLET_ENABLED=false"), /duplicate_integration_setting/);
  assert.throws(() => integrationConfigPresence("MEMBERSHIP_WALLET_BASE_RPC_URL=a\nMEMBERSHIP_WALLET_BASE_RPC_URL=b"), /duplicate_integration_setting/);
});

test("fixed worker service projection emits only a service name and booleans", () => {
  const result = workerServiceState("SubState=running\nLoadState=loaded\nActiveState=active\n");
  assert.deepEqual(result, { worker: { service: "elliott-wave-ai-worker.service", probe_succeeded: true, loaded: true, active: true, running: true } });
  for (const [input, loaded, active, running] of [
    ["LoadState=loaded\nActiveState=inactive\nSubState=dead", true, false, false],
    ["LoadState=loaded\nActiveState=activating\nSubState=start", true, false, false],
    ["LoadState=not-found\nActiveState=inactive\nSubState=dead", false, false, false],
    ["LoadState=loaded\nActiveState=active\nSubState=exited", true, true, false],
  ]) {
    assert.deepEqual(workerServiceState(input).worker, { service: "elliott-wave-ai-worker.service", probe_succeeded: true, loaded, active, running });
  }
});

test("failed or malformed worker probes fail closed and never relay untrusted stdout", () => {
  const safe = { worker: { service: "elliott-wave-ai-worker.service", probe_succeeded: false, loaded: false, active: false, running: false } };
  for (const input of ["", null, "LoadState=loaded", "LoadState=loaded\nActiveState=active\nSubState=running\nSubState=running",
    "LoadState=loaded\nActiveState=private-secret\nSubState=running", "LoadState=loaded\nActiveState=active\nSubState=running\nEnvironment=private-secret",
    "LoadState=loaded\nActiveState=active\nSubState=running\n" + "private-secret".repeat(400)]) {
    assert.deepEqual(workerServiceState(input), safe);
    assert.equal(JSON.stringify(workerServiceState(input)).includes("private-secret"), false);
  }
});

test("worker-state CLI reads stdin only and projects without an environment-file read", () => {
  const script = fileURLToPath(new URL("../scripts/integration-config-audit.mjs", import.meta.url));
  const probe = spawnSync(process.execPath, [script, "--worker-state"], {
    input: "LoadState=loaded\nActiveState=active\nSubState=running\n", encoding: "utf8",
    env: { PRIVATE_SENTINEL: "private-process-env" },
  });
  assert.equal(probe.status, 0);
  assert.equal(probe.stderr, "");
  assert.deepEqual(JSON.parse(probe.stdout), workerServiceState("LoadState=loaded\nActiveState=active\nSubState=running\n"));
  assert.equal(probe.stdout.includes("private-process-env"), false);
  const rejected = spawnSync(process.execPath, [script, "--worker-state", "private-argument"], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "integration_configuration_probe_failed\n");
});

test("integration workflow queries one fixed read-only worker target then safely projects stdout", () => {
  const source = readFileSync(new URL("../.github/workflows/diagnose-next-production.yml", import.meta.url), "utf8");
  const step = source.slice(source.indexOf("      - name: Read only fixed AI worker service state"));
  assert.match(step, /if: inputs\.operation == 'integration-config'/);
  assert.match(step, /sudo -n \/usr\/bin\/systemctl show elliott-wave-ai-worker\.service --property=LoadState --property=ActiveState --property=SubState/);
  assert.equal((step.match(/\bsystemctl\b/g) ?? []).length, 1);
  assert.match(step, /2>\/dev\/null/);
  assert.match(step, /printf '%s\\n' "\$service_state" \| node scripts\/integration-config-audit\.mjs --worker-state/);
  assert.match(step, /printf '' \| node scripts\/integration-config-audit\.mjs --worker-state/);
  assert.doesNotMatch(step, /\b(?:restart|start|stop|enable|disable|daemon-reload|set-environment|journalctl|cat)\b|--property=(?:Environment|EnvironmentFiles|ExecStart)|runMembershipWalletVerificationCycle|claim_membership|settle_membership/);
  assert.match(source, /- name: Use pinned Node for safe integration status projection\n\s+if: inputs\.operation == 'integration-config'\n\s+uses: actions\/setup-node@v4\n\s+with:\n\s+node-version: 22/);
});

test("actual workflow shell keeps simulated SSH stdout and stderr private on success and failure", () => {
  const source = readFileSync(new URL("../.github/workflows/diagnose-next-production.yml", import.meta.url), "utf8");
  const step = source.slice(source.indexOf("      - name: Read only fixed AI worker service state"));
  const run = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map(line => line.slice(10)).join("\n");
  for (const failure of [false, true]) {
    // Replace SSH with an in-process shell function: no sockets, files or units
    // are accessed. Run the real workflow branch and the real pure projection.
    const output = failure ? "private-ssh-stdout" : "LoadState=loaded\nActiveState=active\nSubState=running\n";
    const fakeSsh = `ssh() { printf '%s' '${output}'; printf '%s' 'private-ssh-stderr' >&2; return ${failure ? 1 : 0}; }`;
    const probe = spawnSync("/bin/bash", ["-c", `${fakeSsh}\n${run}`], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8",
      env: { ...process.env, DEPLOY_USER: "fixture-deployer", DEPLOY_HOST: "not-used.invalid" },
    });
    assert.equal(probe.status, 0);
    assert.equal(probe.stderr, "");
    assert.equal(probe.stdout.includes("private-ssh"), false);
    assert.deepEqual(JSON.parse(probe.stdout), workerServiceState(failure ? "" : output));
  }
});
