import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const moduleUrl = new URL("../scripts/configure-discord-runtime.mjs", import.meta.url);
const workflowUrl = new URL("../.github/workflows/configure-discord-production.yml", import.meta.url);
const transactionUrl = new URL("../scripts/configure-discord-production.sh", import.meta.url);
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml");

async function loadRuntime() {
  assert.equal(existsSync(moduleUrl), true, "reviewed Discord runtime configurator must exist");
  return import(`${moduleUrl.href}?test=${Date.now()}-${Math.random()}`);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wavekb-discord-runtime-"));
  const gatewayEnv = path.join(root, "gateway.env");
  const nextEnv = path.join(root, "next.env");
  const backup = path.join(root, "next.env.backup");
  await writeFile(gatewayEnv, "SUPABASE_SERVICE_ROLE_KEY=server-only-service-key\nOTHER_GATEWAY=value\n", { mode: 0o600 });
  await writeFile(nextEnv, "EXISTING=value\nDISCORD_BOT_API_SECRET=old-secret-value-that-is-long-enough-000\n", { mode: 0o600 });
  return { root, gatewayEnv, nextEnv, backup };
}

test("Discord runtime configuration preserves unrelated values and atomically installs only bounded server settings", async () => {
  const api = await loadRuntime();
  const files = await fixture();
  const secret = "a".repeat(64);
  const receipt = await api.configureDiscordRuntime({
    gatewayEnvPath: files.gatewayEnv,
    nextEnvPath: files.nextEnv,
    backupPath: files.backup,
    input: Buffer.from(JSON.stringify({ apiSecret: secret })),
  });

  const configured = await readFile(files.nextEnv, "utf8");
  assert.match(configured, /^EXISTING=value$/m);
  assert.match(configured, /^SUPABASE_SERVICE_ROLE_KEY=server-only-service-key$/m);
  assert.match(configured, new RegExp(`^DISCORD_BOT_API_SECRET=${secret}$`, "m"));
  assert.match(configured, /^DISCORD_BOT_GUILD_ID=1545731927733047306$/m);
  assert.match(configured, /^DISCORD_LINK_PUBLIC_ORIGIN=https:\/\/wavekb\.com$/m);
  assert.equal((configured.match(/^DISCORD_BOT_API_SECRET=/gm) ?? []).length, 1);
  assert.equal(await readFile(files.backup, "utf8"), "EXISTING=value\nDISCORD_BOT_API_SECRET=old-secret-value-that-is-long-enough-000\n");
  assert.match(receipt.newHash, /^[0-9a-f]{64}$/);
  if (process.platform !== "win32") assert.equal((await stat(files.nextEnv)).mode & 0o777, 0o600);
});

test("Discord runtime configuration rejects unsafe input without changing or backing up production", async () => {
  const api = await loadRuntime();
  for (const input of [
    Buffer.from(JSON.stringify({ apiSecret: "short" })),
    Buffer.from(JSON.stringify({ apiSecret: `${"a".repeat(32)}\nINJECTED=yes` })),
    Buffer.from("not-json"),
  ]) {
    const files = await fixture();
    const before = await readFile(files.nextEnv, "utf8");
    await assert.rejects(api.configureDiscordRuntime({
      gatewayEnvPath: files.gatewayEnv,
      nextEnvPath: files.nextEnv,
      backupPath: files.backup,
      input,
    }), /discord_configuration_input_invalid/);
    assert.equal(await readFile(files.nextEnv, "utf8"), before);
    assert.equal(existsSync(files.backup), false);
  }
});

test("Discord runtime rollback is compare-and-swap and never overwrites a concurrent environment edit", async () => {
  const api = await loadRuntime();
  const files = await fixture();
  const receipt = await api.configureDiscordRuntime({
    gatewayEnvPath: files.gatewayEnv,
    nextEnvPath: files.nextEnv,
    backupPath: files.backup,
    input: Buffer.from(JSON.stringify({ apiSecret: "b".repeat(64) })),
  });
  await writeFile(files.nextEnv, `${await readFile(files.nextEnv, "utf8")}CONCURRENT=value\n`, { mode: 0o600 });
  await assert.rejects(api.rollbackDiscordRuntime({
    nextEnvPath: files.nextEnv,
    backupPath: files.backup,
    expectedHash: receipt.newHash,
  }), /discord_configuration_changed/);
  assert.match(await readFile(files.nextEnv, "utf8"), /CONCURRENT=value/);
});

test("production workflow transports the secret only through stdin and rolls configuration back on failed restart", () => {
  assert.equal(existsSync(workflowUrl), true, "reviewed Discord configuration workflow must exist");
  const workflow = yaml.load(readFileSync(workflowUrl, "utf8"));
  const triggers = workflow.on ?? workflow.true;
  assert.ok(triggers.workflow_dispatch);
  const job = workflow.jobs["configure-discord"];
  assert.equal(job.environment, "production");
  const serialized = JSON.stringify(job);
  const transaction = readFileSync(transactionUrl, "utf8");
  const reviewed = `${serialized}\n${transaction}`;
  assert.match(reviewed, /DISCORD_BOT_API_SECRET/);
  assert.match(reviewed, /configure-discord-runtime\.mjs/);
  assert.match(reviewed, /rollback/);
  assert.match(reviewed, /wavekb-next-preview\.service/);
  assert.doesNotMatch(reviewed, /echo[^\n]*DISCORD_BOT_API_SECRET|--api-secret/);
  const syntax = spawnSync("bash", ["-n"], { input: transaction, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});
