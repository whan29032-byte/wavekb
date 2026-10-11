import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectTronSolidifiedHead, probeTronReadiness, projectTronReadiness, TRON_READINESS_TIMEOUT_MS,
  TRON_READINESS_MAX_BYTES, TRON_READINESS_MAX_AGE_MS, TRON_READINESS_FUTURE_SKEW_MS } from "../scripts/tron-readiness-probe.mjs";

const now = 1791738000000;
const head = (number = 90000000, timestamp = now - 60000) => ({ blockID: BigInt(Number.isInteger(number) ? number : 1).toString(16).padStart(16, "0") + "a".repeat(48), block_header: { raw_data: { number, timestamp } } });
const expected = (reason) => ({ tron_readiness: { ready: reason === "ready", reason, authConfigured: false,
  authentication: "unauthenticated", rateLimitRisk: true, scope: "fixed_solidified_head_only" } });
const reply = (body = head(), options = {}) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...options });

test("one fixed unauthenticated POST validates a fresh solidified head and projects no response data", async () => {
  const calls = [];
  const result = await probeTronReadiness({ now: () => now, fetch: async (url, init) => {
    calls.push({ url, init }); return reply({ ...head(), privateMetadata: "never-print-body-or-wallet" });
  } });
  assert.deepEqual(result, expected("ready")); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.trongrid.io/walletsolidity/getnowblock");
  assert.equal(calls[0].init.method, "POST"); assert.equal(calls[0].init.body, "{}"); assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.credentials, "omit"); assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { accept: "application/json", "content-type": "application/json", "accept-encoding": "identity" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.doesNotMatch(JSON.stringify(result), /never-print|blockID|timestamp|90000000|wallet|https/);
});

test("block height, matching block ID, millisecond time and object shape are strict", () => {
  for (const value of [null, [], {}, { block_header: [] }, { block_header: { raw_data: [] } },
    head(0), head(1.5), head(Number.MAX_SAFE_INTEGER + 1), head(1, 0), head(1, now + 0.5),
    { ...head(), blockID: "a".repeat(64) }, { ...head(), blockID: "not-a-hash" },
    { blockID: head().blockID, block_header: { raw_data: { number: "90000000", timestamp: now } } }]) {
    assert.equal(inspectTronSolidifiedHead(value, now), "invalid_solidified_head");
  }
  assert.equal(inspectTronSolidifiedHead(head(), Number.NaN), "invalid_solidified_head");
});

test("freshness has explicit five minute age and one minute future-clock boundaries", async () => {
  assert.equal(TRON_READINESS_MAX_AGE_MS, 300000); assert.equal(TRON_READINESS_FUTURE_SKEW_MS, 60000);
  for (const [timestamp, reason] of [[now - 300000, "ready"], [now - 300001, "stale_solidified_head"],
    [now + 60000, "ready"], [now + 60001, "future_solidified_head"]]) {
    assert.deepEqual(await probeTronReadiness({ now: () => now, fetch: async () => reply(head(90000000, timestamp)) }), expected(reason));
  }
});

test("HTTP rate limits, unauthenticated rejections and failures have fixed reasons without retries or body leaks", async () => {
  for (const [status, reason] of [[429, "rate_limited"], [401, "unauthenticated_rejected"], [403, "unauthenticated_rejected"],
    [503, "http_unavailable"], [302, "http_unavailable"], [201, "http_unavailable"]]) {
    let calls = 0, canceled = false;
    const body = new ReadableStream({ cancel() { canceled = true; } });
    const result = await probeTronReadiness({ fetch: async () => { ++calls; return new Response(body, { status, headers: { "retry-after": "private-provider-value", location: "https://not-used.invalid/private" } }); } });
    assert.deepEqual(result, expected(reason)); assert.equal(calls, 1); assert.equal(canceled, true);
    assert.doesNotMatch(JSON.stringify(result), /private|not-used/);
  }
  assert.deepEqual(await probeTronReadiness({ fetch: async () => { throw new Error("private-key URL transport diagnostics"); } }), expected("network_unavailable"));
});

test("declared and actual streaming response sizes are bounded independently", async () => {
  assert.equal(TRON_READINESS_MAX_BYTES, 2097152);
  let canceled = false;
  const declared = new ReadableStream({ cancel() { canceled = true; } });
  assert.deepEqual(await probeTronReadiness({ fetch: async () => new Response(declared, { headers: { "content-type": "application/json", "content-length": String(TRON_READINESS_MAX_BYTES + 1) } }) }), expected("response_too_large"));
  assert.equal(canceled, true);
  for (const sizeHeader of [undefined, "1"]) {
    canceled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(TRON_READINESS_MAX_BYTES + 1)); }, cancel() { canceled = true; } });
    const headers = { "content-type": "application/json", ...(sizeHeader ? { "content-length": sizeHeader } : {}) };
    assert.deepEqual(await probeTronReadiness({ fetch: async () => new Response(stream, { headers }) }), expected("response_too_large"));
    assert.equal(canceled, true);
  }
});

test("empty, mismatched EOF, bad UTF8, malformed JSON, wrong MIME and encoded bodies fail closed", async () => {
  for (const response of [new Response(null, { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "3" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "-1" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response("private provider message", { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-encoding": "gzip" } })]) {
    assert.deepEqual(await probeTronReadiness({ fetch: async () => response }), expected("invalid_response"));
  }
  assert.deepEqual(await probeTronReadiness({ now: () => now, fetch: async () => reply({}) }), expected("invalid_solidified_head"));
});

test("one absolute deadline bounds a fetch that ignores abort and cancels a late body", async () => {
  let release, canceled = false, calls = 0;
  const budgets = [];
  const result = await probeTronReadiness({ fetch: () => { ++calls; return new Promise((resolve) => { release = resolve; }); },
    setTimer: (callback, budget) => { budgets.push(budget); return setTimeout(callback, 10); } });
  assert.deepEqual(result, expected("timeout")); assert.equal(calls, 1); assert.deepEqual(budgets, [8000]);
  const body = new ReadableStream({ cancel() { canceled = true; } });
  release(new Response(body, { headers: { "content-type": "application/json" } }));
  await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(canceled, true);
});

test("the same deadline bounds a stalled body and elapsed time rejects a late successful response", async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { canceled = true; } });
  const result = await probeTronReadiness({ fetch: async () => new Response(stream, { headers: { "content-type": "application/json" } }),
    setTimer: (callback) => setTimeout(callback, 10) });
  assert.deepEqual(result, expected("timeout")); assert.equal(canceled, true);
  let elapsed = 0;
  assert.deepEqual(await probeTronReadiness({ clock: () => elapsed, fetch: async () => { elapsed = TRON_READINESS_TIMEOUT_MS; return reply(); } }), expected("timeout"));
});

test("actual loopback streaming transport validates EOF without contacting the fixed public host", async (t) => {
  let calls = 0;
  const server = http.createServer((request, response) => {
    ++calls; assert.equal(request.method, "POST"); assert.equal(request.headers.authorization, undefined); assert.equal(request.headers["tron-pro-api-key"], undefined);
    let body = ""; request.on("data", (chunk) => { body += chunk; }); request.on("end", () => {
      assert.equal(body, "{}"); response.writeHead(200, { "content-type": "application/json" });
      const bytes = JSON.stringify(head()); response.write(bytes.slice(0, 20)); response.end(bytes.slice(20));
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await probeTronReadiness({ now: () => now, fetch: (url, options) => {
    assert.equal(url, "https://api.trongrid.io/walletsolidity/getnowblock");
    return fetch(`http://127.0.0.1:${server.address().port}/fixture`, options);
  } });
  assert.deepEqual(result, expected("ready")); assert.equal(calls, 1);
});

test("projection rejects arbitrary SSH stdout, private extras and claims of configured authentication", () => {
  assert.deepEqual(projectTronReadiness(JSON.stringify(expected("ready"))), expected("ready"));
  for (const source of ["", "private-ssh-stdout", "x".repeat(1025), JSON.stringify({ ...expected("ready"), environment: "private-env" }),
    JSON.stringify({ tron_readiness: { ...expected("ready").tron_readiness, secret: "private-key" } }),
    JSON.stringify({ tron_readiness: { ...expected("ready").tron_readiness, authConfigured: true } }),
    JSON.stringify({ tron_readiness: { ...expected("ready").tron_readiness, reason: "private-error" } }),
    JSON.stringify({ tron_readiness: { ...expected("timeout").tron_readiness, ready: true } })]) {
    assert.deepEqual(projectTronReadiness(source), expected("server_probe_unavailable"));
  }
});

test("CLI projection reads stdin only, ignores private environment and rejects URL/key arguments", () => {
  const script = fileURLToPath(new URL("../scripts/tron-readiness-probe.mjs", import.meta.url));
  const command = spawnSync(process.execPath, [script, "--project-result"], { input: JSON.stringify(expected("ready")), encoding: "utf8",
    env: { PRIVATE_SENTINEL: "private-env", MEMBERSHIP_WALLET_TRONGRID_API_KEY: "private-key", HTTP_PROXY: "https://never-used.invalid" } });
  assert.equal(command.status, 0); assert.equal(command.stderr, ""); assert.deepEqual(JSON.parse(command.stdout), expected("ready"));
  for (const args of [["https://untrusted.invalid"], ["--project-result", "private-key"]]) {
    const rejected = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(rejected.status, 1); assert.equal(rejected.stdout, ""); assert.equal(rejected.stderr, "tron_readiness_probe_failed\n");
  }
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source, /process\.env|gateway\.env|TRON-PRO-API-KEY|Authorization|writeFile|unlink|exec|spawn|import.+membership-wallet|runMembershipWalletVerificationCycle|claim_membership|settle_membership/);
  assert.equal((source.match(/https:\/\//g) || []).length, 1);
});

function workflowStep() {
  const source = readFileSync(new URL("../.github/workflows/diagnose-next-production.yml", import.meta.url), "utf8");
  const start = source.indexOf("      - name: Probe the fixed unauthenticated TRON solidified head from the server");
  return { source, step: source.slice(start, source.indexOf("\n      - name:", start + 1)) };
}

test("workflow uses an independent opt-in operation and no lease/config/service mutations", () => {
  const { source, step } = workflowStep();
  assert.match(source, /options: \[[^\]]*integration-config, tron-readiness\]/);
  assert.match(step, /if: inputs\.operation == 'tron-readiness'/);
  assert.match(source, /main-only read-only TRON readiness \(no orders\)/);
  assert.match(step, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.ok(step.indexOf('test "$GITHUB_REF" = "refs/heads/main"') < step.indexOf("tron_state=$(ssh"));
  assert.match(step, /sudo -n \/usr\/bin\/node --input-type=module -/);
  assert.match(step, /< scripts\/tron-readiness-probe\.mjs 2>\/dev\/null/);
  assert.match(step, /printf '%s\\n' "\$tron_state" \| node scripts\/tron-readiness-probe\.mjs --project-result/);
  assert.doesNotMatch(step, /gateway\.env|TRONGRID|runMembership|claim_|settle_|apply_verified|systemctl|\bdeploy\b|restart|SUPABASE/);
  const presence = readFileSync(new URL("../scripts/integration-config-audit.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(presence, /\bfetch\(|tron-readiness|https:\/\//);
});

test("actual workflow shell safely projects simulated SSH success, malformed stdout and failure", () => {
  const { step } = workflowStep();
  const run = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map((line) => line.slice(10)).join("\n");
  for (const [stdout, code, reason] of [[JSON.stringify(expected("ready")), 0, "ready"], ["private-ssh-stdout", 0, "server_probe_unavailable"],
    ["private-ssh-stdout", 1, "server_probe_unavailable"]]) {
    const fake = `ssh() { printf '%s' '${stdout}'; printf '%s' 'private-ssh-stderr' >&2; return ${code}; }`;
    const command = spawnSync("/bin/bash", ["-c", `${fake}\n${run}`], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8",
      env: { ...process.env, GITHUB_REF: "refs/heads/main", DEPLOY_USER: "fixture-deployer", DEPLOY_HOST: "not-used.invalid" } });
    assert.equal(command.status, 0); assert.equal(command.stderr, ""); assert.doesNotMatch(command.stdout, /private-ssh/);
    assert.deepEqual(JSON.parse(command.stdout), expected(reason));
  }
});

test("actual workflow shell rejects non-main refs before sending probe source to the server", () => {
  const { step } = workflowStep();
  const run = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map((line) => line.slice(10)).join("\n");
  for (const ref of ["refs/heads/codex/fixture", "refs/pull/123/merge", "refs/tags/release", ""]) {
    const command = spawnSync("/bin/bash", ["-c", `ssh() { printf 'unexpected-server-call'; return 0; }\n${run}`], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8",
      env: { ...process.env, GITHUB_REF: ref, DEPLOY_USER: "fixture-deployer", DEPLOY_HOST: "not-used.invalid" }
    });
    assert.notEqual(command.status, 0); assert.equal(command.stdout, ""); assert.equal(command.stderr, "");
  }
});
