import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configureWalletRuntime, parseWalletRuntimeArguments, inspectWalletWorker, WALLET_ENDPOINTS, WALLET_ALLOWED_HOSTS,
  WALLET_RESPONSE_MAX_BYTES, WALLET_FINALIZED_MAX_AGE_MS, WALLET_TRON_MAX_AGE_MS, WALLET_TIMEOUT_MS } from "../scripts/configure-wallet-runtime.mjs";

const sha = "f".repeat(40), now = 1791766800000;
const script = fileURLToPath(new URL("../scripts/configure-wallet-runtime.mjs", import.meta.url));
const source = fs.readFileSync(script, "utf8");
const initial = "# preserve every other setting\nSUPABASE_URL=https://not-requested.invalid\nSUPABASE_SERVICE_ROLE_KEY=private-service-value\nYOUTUBE_SYNC_ENABLED=true\nAI_PRIVATE_KEY=private-key-sentinel\n";
const readyEnv = `MEMBERSHIP_WALLET_ENABLED=true\nMEMBERSHIP_WALLET_ETHEREUM_RPC_URL=${WALLET_ENDPOINTS.ethereum}\nMEMBERSHIP_WALLET_BASE_RPC_URL=${WALLET_ENDPOINTS.base}\nMEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS=${WALLET_ALLOWED_HOSTS}\n`;
function parseFixtureEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(raw); if (!match) continue;
    let value = match[2]; if (["'", '"'].includes(value[0]) && value.endsWith(value[0])) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}
function reply(value, options = {}) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" }, ...options }); }
function evmBlock(age = 600000) { return { number: "0x1234", hash: `0x${"a".repeat(64)}`, timestamp: `0x${Math.floor((now - age) / 1000).toString(16)}` }; }
function tronHead(age = 60000) { return { blockID: "00000000055d4a80" + "b".repeat(48), block_header: { raw_data: { number: 90000000, timestamp: now - age } } }; }
async function fixtureFetch(url, init) {
  const body = JSON.parse(init.body);
  if (url === "https://api.trongrid.io/walletsolidity/getnowblock") return reply(tronHead());
  assert.ok(Object.values(WALLET_ENDPOINTS).includes(url));
  return reply({ jsonrpc: "2.0", id: body.id, result: body.method === "eth_chainId" ? url === WALLET_ENDPOINTS.ethereum ? "0x1" : "0x2105" : evmBlock() });
}
function fixture(t, text = initial) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wallet-runtime-"))); fs.chmodSync(directory, 0o700);
  const envFile = path.join(directory, "gateway.env"), backupFile = path.join(directory, "original.env"); fs.writeFileSync(envFile, text, { mode: 0o600 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const state = { pid: 111, running: true, restarts: 0, env: parseFixtureEnv(text), revision: true, matching: true, inspectCalls: 0 };
  const services = {
    revision: async expected => state.revision && expected === sha,
    inspect: async () => { state.inspectCalls++; return { running: state.running, pid: state.running ? state.pid : 0 }; },
    restart: async () => { state.restarts++; state.pid++; state.running = true; state.env = parseFixtureEnv(fs.readFileSync(envFile, "utf8")); },
    matches: async (pid, env, expected) => state.matching && pid === state.pid && expected === sha
      && Object.keys(env).every(name => env[name] === state.env[name]),
  };
  const options = { envFile, backupFile, operation: "enable", expectedRuntimeSha: sha };
  return { directory, envFile, backupFile, state, services, options, deps: { services, fetch: fixtureFetch, now: () => now,
    wait: async milliseconds => { assert.ok([250, 1000].includes(milliseconds)); } } };
}
function result(operation, enabled, changed) { return { ok: true, operation, enabled, workerRunning: true, ethereumReady: true, baseReady: true, tronReady: true, changed }; }
async function rejected(code, callback) { await assert.rejects(callback, error => error.code === code && error.message === code); }

test("enable probes five fixed read requests, preserves all other bytes, backs up and verifies a new running PID", async t => {
  const f = fixture(t), calls = [];
  f.deps.fetch = async (url, init) => { calls.push({ url, init }); return fixtureFetch(url, init); };
  assert.deepEqual(await configureWalletRuntime(f.options, f.deps), result("enable", true, true));
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), initial); assert.equal(fs.statSync(f.backupFile).mode & 0o7777, 0o600);
  assert.equal(fs.readFileSync(f.envFile, "utf8"), initial + readyEnv); assert.equal(fs.statSync(f.envFile).mode & 0o7777, 0o600);
  assert.equal(f.state.restarts, 1); assert.equal(f.state.pid, 112); assert.equal(calls.length, 5);
  assert.deepEqual(calls.map(({ init }) => JSON.parse(init.body).method ?? "tron-head"), ["eth_chainId", "eth_getBlockByNumber", "eth_chainId", "eth_getBlockByNumber", "tron-head"]);
  for (const { init } of calls) { assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.ok(init.signal instanceof AbortSignal); }
  assert.ok(!fs.existsSync(path.join(f.directory, ".gateway.env.wavekb-runtime.lock")));
});
test("probe prepares missing defaults only in memory and never writes, creates a lock, backup or restarts", async t => {
  const f = fixture(t), { backupFile, ...probe } = { ...f.options, operation: "probe" };
  f.deps.wait = () => assert.fail("probe must not add a startup stability wait");
  assert.deepEqual(await configureWalletRuntime(probe, f.deps), result("probe", false, false));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(f.state.restarts, 0); assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env"]);
});
test("already enabled configuration is verified and restarted, but reported changed false without disabling", async t => {
  const f = fixture(t, initial + readyEnv);
  assert.deepEqual(await configureWalletRuntime(f.options, f.deps), result("enable", true, false));
  assert.equal(f.state.restarts, 1); assert.equal(fs.readFileSync(f.backupFile, "utf8"), initial + readyEnv);
});
test("existing approved URLs, reversed host order, quotes, CRLF and unrelated unterminated lines are byte-preserved", async t => {
  const text = `  MEMBERSHIP_WALLET_ENABLED = 'false'  \r\nMEMBERSHIP_WALLET_ETHEREUM_RPC_URL="${WALLET_ENDPOINTS.ethereum}"\r\nMEMBERSHIP_WALLET_BASE_RPC_URL=${WALLET_ENDPOINTS.base}\r\nMEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS='base-rpc.publicnode.com, ethereum-rpc.publicnode.com'\r\nYOUTUBE_SYNC_ENABLED=true`;
  const f = fixture(t, text); await configureWalletRuntime(f.options, f.deps);
  assert.equal(fs.readFileSync(f.envFile, "utf8"), text.replace("'false'", "'true'")); assert.equal(fs.readFileSync(f.backupFile, "utf8"), text);
});
test("existing nonempty mismatched endpoints, hosts, flags, key or batch fail before network or writes", async t => {
  for (const setting of ["MEMBERSHIP_WALLET_ETHEREUM_RPC_URL=https://other.invalid/private-secret", "MEMBERSHIP_WALLET_BASE_RPC_URL=https://base-rpc.publicnode.com/",
    "MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS=*.publicnode.com", `MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS=${WALLET_ALLOWED_HOSTS},private.invalid`,
    "MEMBERSHIP_WALLET_ENABLED=yes", "MEMBERSHIP_WALLET_TRONGRID_API_KEY=bad key", "MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE=0"]) {
    const f = fixture(t, initial + setting + "\n"); f.deps.fetch = () => assert.fail("network must not run");
    await rejected("wallet_configuration_invalid", () => configureWalletRuntime(f.options, f.deps)); assert.equal(f.state.restarts, 0); assert.ok(!fs.existsSync(f.backupFile));
  }
});
test("only the fixed TRON request receives an existing key and no result contains private configuration", async t => {
  const f = fixture(t, initial + "MEMBERSHIP_WALLET_TRONGRID_API_KEY=private-tron-key\nMEMBERSHIP_WALLET_VERIFY_BATCH_SIZE=2\n");
  f.deps.fetch = async (url, init) => { assert.equal(init.headers["TRON-PRO-API-KEY"], url.startsWith("https://api.trongrid.io/") ? "private-tron-key" : undefined); return fixtureFetch(url, init); };
  const output = await configureWalletRuntime(f.options, f.deps);
  assert.deepEqual(Object.keys(output).sort(), ["ok", "operation", "enabled", "workerRunning", "ethereumReady", "baseReady", "tronReady", "changed"].sort());
  assert.doesNotMatch(JSON.stringify(output), /private-|https|SUPABASE|KEY|PID|112/);
});
test("strict arguments reject disable, secrets, omitted revision, duplicates, arbitrary commands and probe backups", () => {
  const args = ["--env-file", "/etc/elliott-wave/gateway.env", "--operation", "probe", "--expected-runtime-sha", sha];
  assert.deepEqual(parseWalletRuntimeArguments(args), { envFile: "/etc/elliott-wave/gateway.env", operation: "probe", expectedRuntimeSha: sha });
  for (const input of [[...args, "--operation", "enable"], [...args, "--secret", "private"], ["--operation", "disable"], args.slice(0, 4),
    [...args, "--backup-file", "/tmp/backup"], [...args.slice(0, -1), "g".repeat(40)], [...args, "--restart", "other-service"], [...args, "extra"]]) {
    assert.throws(() => parseWalletRuntimeArguments(input), error => error.code === "invalid_arguments");
  }
});
test("worker readiness rejects missing/duplicate fields, active exited, zero/invalid PID and untrusted output", () => {
  const valid = "LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=112\n";
  assert.deepEqual(inspectWalletWorker(valid), { running: true, pid: 112 });
  for (const value of [null, "private error", valid.replace("running", "exited"), valid.replace("112", "0"), valid.replace("112", "2147483648"), valid + "MainPID=113\n", valid + "Secret=private\n", valid.replace("loaded", "not-found")]) {
    assert.deepEqual(inspectWalletWorker(value), { running: false, pid: 0 });
  }
});
test("wrong runtime revision, inactive process and mismatched actual environment cannot write or probe network", async t => {
  for (const [field, value, code] of [["revision", false, "runtime_revision_mismatch"], ["running", false, "worker_inactive"], ["matching", false, "worker_verification_failed"]]) {
    const f = fixture(t); f.state[field] = value; f.deps.fetch = () => assert.fail("not reached");
    await rejected(code, () => configureWalletRuntime(f.options, f.deps)); assert.ok(!fs.existsSync(f.backupFile));
  }
});
test("RPC chain identity, exact IDs, nonzero hashes, quantities and finality availability are mandatory", async t => {
  for (const [chain, patch] of [["ethereum", { result: "0x2" }], ["base", { result: "0x1" }], ["ethereum", { id: 9 }], ["base", { error: { message: "private-rpc-error" } }]]) {
    const f = fixture(t); f.deps.fetch = async (url, init) => url === WALLET_ENDPOINTS[chain] ? reply({ jsonrpc: "2.0", id: 1, result: chain === "ethereum" ? "0x1" : "0x2105", ...patch }) : fixtureFetch(url, init);
    await rejected(`${chain}_preflight_failed`, () => configureWalletRuntime(f.options, f.deps)); assert.ok(!fs.existsSync(f.backupFile));
  }
  for (const block of [null, {}, { ...evmBlock(), number: "0x0" }, { ...evmBlock(), number: "0x01" }, { ...evmBlock(), hash: `0x${"0".repeat(64)}` }, { ...evmBlock(), timestamp: "0x0" }, { ...evmBlock(), hash: "bad" }]) {
    const f = fixture(t); f.deps.fetch = async (url, init) => url === WALLET_ENDPOINTS.ethereum && JSON.parse(init.body).method === "eth_getBlockByNumber" ? reply({ jsonrpc: "2.0", id: 2, result: block }) : fixtureFetch(url, init);
    await rejected("ethereum_preflight_failed", () => configureWalletRuntime(f.options, f.deps));
  }
});
test("finalized EVM allows thirty-minute lag but TRON only five minutes, with explicit future skew", async t => {
  assert.equal(WALLET_FINALIZED_MAX_AGE_MS, 1800000); assert.equal(WALLET_TRON_MAX_AGE_MS, 300000);
  for (const [age, accepted] of [[1800000, true], [1801000, false], [-60000, true], [-61000, false]]) {
    const f = fixture(t); f.deps.fetch = async (url, init) => url === WALLET_ENDPOINTS.ethereum && JSON.parse(init.body).method === "eth_getBlockByNumber" ? reply({ jsonrpc: "2.0", id: 2, result: evmBlock(age) }) : fixtureFetch(url, init);
    if (accepted) await configureWalletRuntime(f.options, f.deps); else await rejected("ethereum_preflight_failed", () => configureWalletRuntime(f.options, f.deps));
  }
  for (const [head, accepted] of [[tronHead(300000), true], [tronHead(300001), false], [tronHead(-60000), true], [tronHead(-60001), false], [{ ...tronHead(), blockID: "a".repeat(64) }, false]]) {
    const f = fixture(t); f.deps.fetch = async (url, init) => url.startsWith("https://api.trongrid.io/") ? reply(head) : fixtureFetch(url, init);
    if (accepted) await configureWalletRuntime(f.options, f.deps); else await rejected("tron_preflight_failed", () => configureWalletRuntime(f.options, f.deps));
  }
});
test("HTTP, malformed JSON/UTF8, encodings and bounded streaming failures never expose body or write", async t => {
  for (const response of [reply({}, { status: 429 }), reply({}, { status: 302 }), new Response("private-upstream", { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-encoding": "gzip" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "3" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": String(WALLET_RESPONSE_MAX_BYTES + 1) } }),
    new Response(new Uint8Array(WALLET_RESPONSE_MAX_BYTES + 1), { headers: { "content-type": "application/json" } })]) {
    const f = fixture(t); f.deps.fetch = async () => response;
    await rejected("ethereum_preflight_failed", () => configureWalletRuntime(f.options, f.deps)); assert.ok(!fs.existsSync(f.backupFile));
  }
});
test("absolute deadline bounds an abort-ignoring fetch and stalled response stream", async t => {
  for (const body of [false, true]) {
    const f = fixture(t); const budgets = []; f.deps.setTimer = (cb, budget) => { budgets.push(budget); return setTimeout(cb, 10); };
    f.deps.fetch = async () => body ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }), { headers: { "content-type": "application/json" } }) : new Promise(() => {});
    await rejected("ethereum_preflight_failed", () => configureWalletRuntime(f.options, f.deps)); assert.deepEqual(budgets, [WALLET_TIMEOUT_MS]); assert.ok(!fs.existsSync(f.backupFile));
  }
});
test("network failure or concurrent preflight env change cannot write a candidate or backup", async t => {
  for (const concurrent of [false, true]) {
    const f = fixture(t); f.deps.fetch = async (url, init) => { if (!concurrent) throw new Error("private-network-key"); fs.writeFileSync(f.envFile, initial + "OTHER=later\n"); return fixtureFetch(url, init); };
    await rejected(concurrent ? "environment_changed" : "ethereum_preflight_failed", () => configureWalletRuntime(f.options, f.deps)); assert.ok(!fs.existsSync(f.backupFile)); assert.equal(f.state.restarts, 0);
  }
});
test("restart failure restores exact env and restarts old worker under the lock without leaking diagnostics", async t => {
  const f = fixture(t), normal = f.services.restart;
  f.services.restart = async () => { if (!f.state.restarts) { f.state.restarts++; throw new Error("private-restart-diagnostics"); } await normal(); };
  await rejected("worker_restart_failed", () => configureWalletRuntime(f.options, f.deps)); assert.equal(fs.readFileSync(f.envFile, "utf8"), initial);
  assert.equal(fs.readFileSync(f.backupFile, "utf8"), initial); assert.equal(f.state.restarts, 2); assert.equal(f.state.env.MEMBERSHIP_WALLET_ENABLED, undefined);
});
test("a restart no-op or bad new process environment is rejected and the restored worker must be proven", async t => {
  for (const mismatch of [false, true]) {
    const f = fixture(t), normal = f.services.restart;
    f.services.restart = async () => { if (!f.state.restarts) { f.state.restarts++; if (mismatch) { f.state.pid++; f.state.env = {}; } return; } await normal(); };
    await rejected("worker_verification_failed", () => configureWalletRuntime(f.options, f.deps)); assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(f.state.restarts, 2);
  }
});
test("a startup process that exits or changes PID within the stability window cannot succeed", async t => {
  for (const exit of [true, false]) {
    const f = fixture(t); let waits = 0;
    f.deps.wait = async milliseconds => { assert.ok([250, 1000].includes(milliseconds)); if (milliseconds === 1000) { waits++; if (waits === 1) { if (exit) f.state.running = false; else f.state.pid++; } } };
    await rejected(exit ? "worker_inactive" : "worker_verification_failed", () => configureWalletRuntime(f.options, f.deps));
    assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(f.state.restarts, 2); assert.equal(waits, 2);
  }
});
test("rollback must also survive the same stability window before it can be called restored", async t => {
  const f = fixture(t), normal = f.services.restart; let waits = 0;
  f.services.restart = async () => { if (!f.state.restarts) { f.state.restarts++; throw new Error("synthetic-start-failure"); } await normal(); };
  f.deps.wait = async milliseconds => { assert.ok([250, 1000].includes(milliseconds)); if (milliseconds === 1000) { waits++; f.state.running = false; } };
  await rejected("runtime_rollback_failed", () => configureWalletRuntime(f.options, f.deps));
  assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(waits, 1);
});
test("startup readiness tolerates bounded inactive and not-yet-Node transitions before the same-PID stability proof", async t => {
  const f = fixture(t), restart = f.services.restart; let polls = 0, stableWaits = 0;
  f.services.restart = async () => { await restart(); f.state.running = false; f.state.matching = false; };
  f.deps.wait = async milliseconds => {
    if (milliseconds === 250) { polls++; if (polls === 2) f.state.running = true; if (polls === 3) f.state.matching = true; }
    else { assert.equal(milliseconds, 1000); stableWaits++; assert.equal(polls, 3); }
  };
  assert.deepEqual(await configureWalletRuntime(f.options, f.deps), result("enable", true, true));
  assert.equal(polls, 3); assert.equal(stableWaits, 1); assert.equal(f.state.restarts, 1);
});
test("a permanent startup mismatch gets exactly twenty attempts and rollback has the same bounded transition wait", async t => {
  const f = fixture(t), restart = f.services.restart; let candidatePolls = 0, rollbackPolls = 0, stableWaits = 0;
  f.services.restart = async () => { await restart(); f.state.matching = false; if (f.state.restarts === 2) f.state.running = false; };
  f.deps.wait = async milliseconds => {
    if (milliseconds === 250) {
      if (f.state.restarts === 1) candidatePolls++;
      else { rollbackPolls++; if (rollbackPolls === 2) f.state.running = true; if (rollbackPolls === 3) f.state.matching = true; }
    } else { assert.equal(milliseconds, 1000); stableWaits++; }
  };
  await rejected("worker_verification_failed", () => configureWalletRuntime(f.options, f.deps));
  assert.equal(candidatePolls, 20); assert.equal(rollbackPolls, 3); assert.equal(stableWaits, 1);
  assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(f.state.restarts, 2);
});
test("a permanently inactive startup and rollback both expire without a green receipt", async t => {
  const f = fixture(t), restart = f.services.restart; const polls = [0, 0];
  f.services.restart = async () => { await restart(); f.state.running = false; };
  f.deps.wait = async milliseconds => { assert.equal(milliseconds, 250); polls[f.state.restarts - 1]++; };
  await rejected("runtime_rollback_failed", () => configureWalletRuntime(f.options, f.deps));
  assert.deepEqual(polls, [20, 20]); assert.equal(fs.readFileSync(f.envFile, "utf8"), initial);
});
test("later writer wins CAS and is never overwritten or restarted by rollback", async t => {
  const f = fixture(t); f.services.restart = async () => { f.state.restarts++; fs.writeFileSync(f.envFile, initial + "LATER_WRITER=keep\n"); throw new Error(); };
  await rejected("rollback_conflict", () => configureWalletRuntime(f.options, f.deps)); assert.equal(fs.readFileSync(f.envFile, "utf8"), initial + "LATER_WRITER=keep\n"); assert.equal(f.state.restarts, 1);
});
test("rollback restart or proof failure is never reported as restored or enabled", async t => {
  const f = fixture(t); f.services.restart = async () => { f.state.restarts++; throw new Error("private-always-fail"); };
  await rejected("runtime_rollback_failed", () => configureWalletRuntime(f.options, f.deps)); assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(f.state.restarts, 2);
});
test("owned 0600 regular file, safe parents, new backup and shared runtime lock are required", async t => {
  const badMode = fixture(t); fs.chmodSync(badMode.envFile, 0o644); await rejected("unsafe_env_file", () => configureWalletRuntime(badMode.options, badMode.deps));
  const hardlink = fixture(t); fs.linkSync(hardlink.envFile, path.join(hardlink.directory, "linked")); await rejected("unsafe_env_file", () => configureWalletRuntime(hardlink.options, hardlink.deps));
  const link = fixture(t); fs.renameSync(link.envFile, path.join(link.directory, "real")); fs.symlinkSync(path.join(link.directory, "real"), link.envFile); await rejected("unsafe_env_file", () => configureWalletRuntime(link.options, link.deps));
  const parent = fixture(t); fs.chmodSync(parent.directory, 0o777); await rejected("unsafe_env_file", () => configureWalletRuntime(parent.options, parent.deps));
  const backup = fixture(t); fs.writeFileSync(backup.backupFile, "keep", { mode: 0o600 }); await rejected("unsafe_backup_file", () => configureWalletRuntime(backup.options, backup.deps)); assert.equal(fs.readFileSync(backup.backupFile, "utf8"), "keep");
  const locked = fixture(t); fs.writeFileSync(path.join(locked.directory, ".gateway.env.wavekb-runtime.lock"), "held", { mode: 0o600 }); await rejected("runtime_configuration_busy", () => configureWalletRuntime(locked.options, locked.deps));
});
test("unsupported dotenv syntax, duplicate keys, BOM, NUL and invalid UTF8 fail before writes", async t => {
  for (const text of [initial + "export A=value\n", initial + "A=one\nA=two\n", "\ufeff" + initial, initial + "A=bad\0value\n", initial + "A=bad\rvalue\n", initial + "A=\"bad\\value\"\n", Buffer.from([255])]) {
    const f = fixture(t); fs.writeFileSync(f.envFile, text); await rejected("unsupported_env_format", () => configureWalletRuntime(f.options, f.deps)); assert.ok(!fs.existsSync(f.backupFile));
  }
});
test("the shared lock stays held during network and restart verification and preserves a replacement lock", async t => {
  const f = fixture(t), lock = path.join(f.directory, ".gateway.env.wavekb-runtime.lock");
  f.deps.fetch = async (url, init) => { assert.ok(fs.existsSync(lock)); return fixtureFetch(url, init); };
  const restart = f.services.restart; f.services.restart = async () => { assert.ok(fs.existsSync(lock)); fs.unlinkSync(lock); fs.writeFileSync(lock, "replacement", { mode: 0o600 }); await restart(); };
  await configureWalletRuntime(f.options, f.deps); assert.equal(fs.readFileSync(lock, "utf8"), "replacement");
});
test("post-rename directory fsync failure restores bytes and proves the original worker", async t => {
  const f = fixture(t), originalSync = fs.fsyncSync; let calls = 0;
  fs.fsyncSync = fd => { calls++; if (calls === 4) throw new Error("synthetic-directory-fsync-failure"); return originalSync(fd); };
  try { await rejected("runtime_write_failed", () => configureWalletRuntime(f.options, f.deps)); }
  finally { fs.fsyncSync = originalSync; }
  assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(fs.readFileSync(f.backupFile, "utf8"), initial); assert.equal(f.state.restarts, 1);
});
test("an incomplete backup is removed and cannot alter config or restart the service", async t => {
  const f = fixture(t), originalSync = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error("synthetic-backup-fsync-failure"); };
  try { await rejected("runtime_write_failed", () => configureWalletRuntime(f.options, f.deps)); }
  finally { fs.fsyncSync = originalSync; }
  assert.ok(!fs.existsSync(f.backupFile)); assert.equal(fs.readFileSync(f.envFile, "utf8"), initial); assert.equal(f.state.restarts, 0);
});
test("probe rechecks live runtime and never reports a process that exited during network checks", async t => {
  const f = fixture(t), { backupFile, ...probe } = { ...f.options, operation: "probe" };
  f.deps.fetch = async (url, init) => { const response = await fixtureFetch(url, init); if (url.startsWith("https://api.trongrid.io/")) f.state.running = false; return response; };
  await rejected("worker_inactive", () => configureWalletRuntime(probe, f.deps)); assert.equal(f.state.restarts, 0); assert.deepEqual(fs.readdirSync(f.directory), ["gateway.env"]);
});
test("production adapter checks exactly six wallet keys, ignores unrelated stale config and still proves CLI/runtime identity", t => {
  const walletKeys = ["MEMBERSHIP_WALLET_ENABLED", "MEMBERSHIP_WALLET_ETHEREUM_RPC_URL", "MEMBERSHIP_WALLET_BASE_RPC_URL",
    "MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS", "MEMBERSHIP_WALLET_TRONGRID_API_KEY", "MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE"];
  const configured = initial + readyEnv + "MEMBERSHIP_WALLET_TRONGRID_API_KEY=private-tron-key\nMEMBERSHIP_WALLET_VERIFY_BATCH_SIZE=2\n";
  const cases = ["import-entry", "stdin-source", "unrelated-stale-config"].map(mode => ({ mode, text: initial, valid: true }));
  for (const key of walletKeys) for (const mode of ["different", "missing", "extra"]) cases.push({ mode, key, text: mode === "extra" ? initial : configured, valid: false });
  for (const { mode, key, text, valid } of cases) {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wallet-process-proof-"))); fs.chmodSync(directory, 0o700);
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const envFile = path.join(directory, "gateway.env"), backupFile = path.join(directory, "original.env"), release = path.join(directory, "release");
    fs.mkdirSync(release, { mode: 0o755 }); fs.writeFileSync(path.join(release, "DEPLOYMENT_VERSION"), sha + "\n", { mode: 0o644 }); fs.writeFileSync(envFile, text, { mode: 0o600 });
    const processEnv = path.join(directory, "process-environ"), cmdline = path.join(directory, "process-cmdline");
    const actual = parseFixtureEnv(text);
    if (mode === "unrelated-stale-config") { actual.YOUTUBE_SYNC_ENABLED = "false"; delete actual.AI_PRIVATE_KEY; actual.OLD_AI_SETTING = "old-private-value"; }
    else if (mode === "missing") delete actual[key];
    else if (mode === "different" || mode === "extra") actual[key] = "different-wallet-value";
    fs.writeFileSync(processEnv, Object.entries(actual).map(([name, value]) => `${name}=${value}`).join("\0") + "\0");
    fs.writeFileSync(cmdline, `${process.execPath}\0src/worker-main.ts\0`);
    const args = ["--env-file", envFile, "--backup-file", backupFile, "--operation", "enable", "--expected-runtime-sha", sha];
    const preamble = `import fakeFs from 'node:fs';import fakeCp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const originalReal=fakeFs.realpathSync,originalOpen=fakeFs.openSync;let pid=111;
fakeFs.realpathSync=(name,...args)=>String(name)==='/opt/elliott-wave-gateway/current'||/^\\/proc\\/\\d+\\/cwd$/.test(String(name))?${JSON.stringify(release)}:originalReal(name,...args);
fakeFs.openSync=(name,...args)=>originalOpen(/^\\/proc\\/\\d+\\/environ$/.test(String(name))?${JSON.stringify(processEnv)}:/^\\/proc\\/\\d+\\/cmdline$/.test(String(name))?${JSON.stringify(cmdline)}:name,...args);
fakeCp.execFileSync=(command,args)=>{if(command!=='/usr/bin/systemctl')throw new Error('unexpected-command');if(args[0]==='show')return 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nMainPID='+pid+'\\n';if(args.join(',')!=='restart,elliott-wave-ai-worker.service')throw new Error('unexpected-service');pid++;fakeFs.writeFileSync(${JSON.stringify(processEnv)},fakeFs.readFileSync(${JSON.stringify(envFile)},'utf8').split('\\n').filter(line=>/^[A-Z_]+=/.test(line)).join('\\0')+'\\0');};
syncBuiltinESMExports();
globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);if(url==='https://api.trongrid.io/walletsolidity/getnowblock')return new Response(JSON.stringify({blockID:'00000000055d4a80'+'b'.repeat(48),block_header:{raw_data:{number:90000000,timestamp:Date.now()-60000}}}),{headers:{'content-type':'application/json'}});if(!${JSON.stringify(Object.values(WALLET_ENDPOINTS))}.includes(url))throw new Error('unexpected-host');return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='eth_chainId'?(url===${JSON.stringify(WALLET_ENDPOINTS.ethereum)}?'0x1':'0x2105'):{number:'0x1234',hash:'0x'+'a'.repeat(64),timestamp:'0x'+Math.floor((Date.now()-600000)/1000).toString(16)}}),{headers:{'content-type':'application/json'}});};`;
    const child = mode === "stdin-source"
      ? spawnSync(process.execPath, ["--input-type=module", "-", ...args], { input: preamble + "\n" + source, encoding: "utf8", env: {} })
      : spawnSync(process.execPath, ["--input-type=module", "-e", preamble + `\nprocess.argv=[process.execPath,${JSON.stringify(script)},...${JSON.stringify(args)}];await import(${JSON.stringify(pathToFileURL(script).href)});`], { encoding: "utf8", env: {} });
    if (!valid) {
      assert.equal(child.status, 1); assert.equal(child.stdout, ""); assert.equal(child.stderr, '{"ok":false,"code":"worker_verification_failed"}\n'); assert.ok(!fs.existsSync(backupFile));
    } else {
      assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, ""); assert.deepEqual(JSON.parse(child.stdout), result("enable", true, true));
      assert.equal(fs.readFileSync(envFile, "utf8"), text + readyEnv); assert.equal(fs.readFileSync(backupFile, "utf8"), text);
    }
    assert.doesNotMatch(child.stdout + child.stderr, /private-|SUPABASE|https|key-sentinel/);
  }
});
test("direct, symlink and reviewed stdin CLI entrypoints cannot silently succeed or echo arguments", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-cli-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const link = path.join(directory, "wallet.mjs"); fs.symlinkSync(script, link);
  for (const [args, input] of [[[script], undefined], [[link], undefined], [["--input-type=module", "-"], source]]) {
    const child = spawnSync(process.execPath, args, { input, encoding: "utf8", env: {} }); assert.equal(child.status, 1); assert.equal(child.stdout, "");
    assert.equal(child.stderr, '{"ok":false,"code":"invalid_arguments"}\n');
  }
});
test("importing from ordinary or stdin modules has no CLI, stdin, filesystem, network or service side effects", () => {
  const program = `import fs from 'node:fs';import cp from 'node:child_process';const read=fs.readFileSync;fs.readFileSync=(name,...args)=>{if(String(name).includes('gateway.env'))throw new Error('unexpected-env-read');return read(name,...args)};fs.writeFileSync=()=>{throw new Error('unexpected-write')};cp.execFileSync=()=>{throw new Error('unexpected-service')};globalThis.fetch=()=>{throw new Error('unexpected-network')};await import(${JSON.stringify(pathToFileURL(script).href)});console.log('import_only');`;
  for (const [args, input] of [[["--input-type=module", "-e", program], undefined], [["--input-type=module", "-"], program]]) {
    const child = spawnSync(process.execPath, args, { input, encoding: "utf8", env: {} }); assert.equal(child.status, 0); assert.equal(child.stderr, ""); assert.equal(child.stdout, "import_only\n");
  }
});
test("production runner references only fixed worker commands and no database, Edge, orders or other integration mutations", () => {
  assert.match(source, /\["restart", UNIT\]/); assert.match(source, /const UNIT = "elliott-wave-ai-worker\.service"/);
  assert.doesNotMatch(source, /prepare_membership|apply_verified|\/rest\/v1|functions\.invoke|signOut|write.*YOUTUBE|hermes|systemctl", \["(?:start|stop|enable|disable)"/i);
  assert.match(source, /fs\.realpathSync\(fileURLToPath\(import\.meta\.url\)\)/);
});
