import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { buildCandidate, runTransaction, validateVersion, staticLocations, requestSnapshot, nginxWorkerIds, waitForNginxGeneration } from "../scripts/knowledge-static-delivery.mjs";

// Independently transcribed from read-only production routing run 37887955912.
const site = `server {
    listen [::]:443 ssl ipv6only=on;
    listen 443 ssl;
    server_name wavekb.com www.wavekb.com;
    if ($host = www.wavekb.com) { return 301 https://wavekb.com$request_uri; }
    ssl_certificate /etc/letsencrypt/live/wavekb.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wavekb.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    charset utf-8;
    server_tokens off;
    client_max_body_size 20m;
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    location /v1/ {
        client_max_body_size 12m;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
        add_header Cache-Control "no-store" always;
    }
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
}
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
    if ($host = www.wavekb.com) { return 301 https://wavekb.com$request_uri; }
    if ($host = wavekb.com) { return 301 https://wavekb.com$request_uri; }
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name wavekb.com www.wavekb.com;
    return 404;
}
`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const id = "a".repeat(40) + "-123-1";

function fixture({ fail, preflightFailure = false } = {}) {
  let bytes = Buffer.from(site), state = null, backup = null;
  const events = [], inspections = [];
  const context = () => ({ bytes, realFile: "/etc/nginx/sites-available/elliott-wave", mode: 0o644, uid: 0, gid: 0,
    deployment: "b".repeat(40), publicRoot: "/srv/wavekb-next-preview/current/apps/web/public", version: "nginx/1.24.0" });
  const runtime = {
    async inspect(mode) {
      events.push("inspect"); inspections.push(mode);
      // Candidate delivery, nginx -T, health or active services may be broken.
      // Rollback has only fixed-target/read-only identity prerequisites.
      if (preflightFailure && mode !== "rollback") throw new Error("fixture current delivery is unhealthy");
      return context();
    },
    async readState() { return state ? { state: structuredClone(state), backup } : null; },
    async prepare(_id, value, original) { assert.equal(state, null); state = structuredClone(value); backup = Buffer.from(original); events.push("backup"); },
    async save(_id, value) { state = structuredClone(value); events.push(`phase:${state.phase}`); },
    async install(next, expected) { assert.equal(hash(bytes), expected); bytes = Buffer.from(next); events.push("install"); },
    async test() { events.push("nginx-t"); if (fail === "test" && events.filter((e) => e === "nginx-t").length === 1) throw new Error("fixture syntax failure"); },
    async reload() { events.push("reload"); if (fail === "reload" && events.filter((e) => e === "reload").length === 1) throw new Error("fixture reload failure"); },
    async verify() { events.push("verify"); if (fail === "verify" && events.filter((e) => e === "verify").length === 2) throw new Error("fixture acceptance failure"); },
  };
  return { runtime, events, inspections, get bytes() { return bytes; }, set bytes(value) { bytes = Buffer.from(value); },
    set preflightFailure(value) { preflightFailure = value; }, get state() { return state; }, get backup() { return backup; } };
}

test("only the audited exact routing shape gains two bounded asset locations; every original byte is recoverable", () => {
  const candidate = buildCandidate(Buffer.from(site));
  assert.equal(candidate.managed, false);
  assert.equal(candidate.original.toString(), site);
  assert.equal(candidate.bytes.toString().replace(staticLocations(), ""), site);
  const repeated = buildCandidate(candidate.bytes);
  assert.equal(repeated.managed, true); assert.deepEqual(repeated.bytes, candidate.bytes);
  assert.match(staticLocations(), /try_files \$uri =404/);
  assert.match(staticLocations(), /sendfile on/);
  assert.match(staticLocations(), /if \(\$http_range != ""\) \{ gzip off; \}/);
  assert.equal((staticLocations().match(/X-Content-Type-Options/g) || []).length, 2);
  assert.match(staticLocations(), /immutable";/); assert.doesNotMatch(staticLocations(), /immutable" always/);
});

test("unknown host, competing asset location, proxy target, headers, TLS, includes and malformed/managed shapes fail closed", () => {
  for (const changed of [site.replace("127.0.0.1:3100", "127.0.0.1:8080"), site.replace("wavekb.com www.wavekb.com", "other.test"),
    site.replace("location / {", "location /assets/ {"), site.replace("nosniff", "unsafe"), site.replace("listen 443 ssl;", "listen 443 ssl http2;"),
    site.replace("location / {", "include /unknown.conf; location / {"), site + "server { listen 443 ssl; server_name wavekb.com; }",
    site.replace("gzip_vary on;", "gzip_vary off;"), buildCandidate(Buffer.from(site)).bytes.toString().replace("sendfile on;", "sendfile off;")]) {
    assert.throws(() => buildCandidate(Buffer.from(changed)), /shape|managed|unsupported/i);
  }
});

test("supported Nginx version is checked without enabling TLS/http2 or optional modules", () => {
  assert.equal(validateVersion("nginx version: nginx/1.24.0"), "1.24.0");
  for (const version of ["nginx/1.16.1", "unknown", "nginx/0.8.0"]) assert.throws(() => validateVersion(version), /version/);
});

test("Nginx worker parsing accepts only complete active worker titles and returns sorted safe PID identities", () => {
  assert.deepEqual(nginxWorkerIds(`
    312 nginx: worker process
    301 nginx: worker process (nginx)
    298 nginx: worker process is shutting down
    299 nginx: cache manager process
    300 nginx: master process /usr/sbin/nginx
    304 unrelated: worker process
  `), [301, 312]);
  for (const text of ["", " ", "0 nginx: worker process", "-1 nginx: worker process", "01 nginx: worker process",
    "1.5 nginx: worker process", "1e3 nginx: worker process", "NaN nginx: worker process", "Infinity nginx: worker process",
    "101 nginx: worker process extra", "101 nginx: worker process (other)", "101 nginx: worker process is shutting down (nginx)",
    "101 prefix nginx: worker process", "prefix 101 nginx: worker process", "101 nginx: worker process;", "101 nginx: worker process\rjunk"]) {
    assert.deepEqual(nginxWorkerIds(text), [], text);
  }
});

test("Nginx worker parsing rejects duplicate active PIDs and unsafe numeric identities instead of merging them", () => {
  for (const text of ["101 nginx: worker process\n101 nginx: worker process (nginx)",
    "9007199254740992 nginx: worker process", "999999999999999999999999999 nginx: worker process"]) {
    assert.throws(() => nginxWorkerIds(text), /worker identity/);
  }
});

test("Nginx generation requires two consecutive observations of the same complete new PID set, independent of order", async () => {
  const snapshots = [{ master: 100, workers: [212, 211] }, { master: 100, workers: [211, 212] }];
  let reads = 0;
  await waitForNginxGeneration({ master: 100, workers: [101, 102] }, async (budget) => {
    assert.equal(budget > 0 && budget <= 2000, true);
    assert.equal(reads < snapshots.length, true); return snapshots[reads++];
  });
  assert.equal(reads, 2);
});

test("coexisting old/new or partially replaced Nginx workers cannot pass the generation barrier", async () => {
  const snapshots = [[101, 102, 211, 212], [101, 211], [211, 212], [212, 211]];
  let reads = 0;
  await waitForNginxGeneration({ master: 100, workers: [101, 102] }, async () => {
    assert.equal(reads < snapshots.length, true); return { master: 100, workers: snapshots[reads++] };
  });
  assert.equal(reads, 4);
});

test("a changed new PID set or reappearance of the old generation resets Nginx readiness stability", async () => {
  const snapshots = [[211, 212], [311, 312], [101, 102], [311, 312], [312, 311]];
  let reads = 0;
  await waitForNginxGeneration({ master: 100, workers: [101, 102] }, async () => {
    assert.equal(reads < snapshots.length, true); return { master: 100, workers: snapshots[reads++] };
  });
  assert.equal(reads, 5);
});

test("retiring Nginx worker titles are excluded while a stable active replacement generation is verified", async () => {
  let reads = 0;
  await waitForNginxGeneration({ master: 100, workers: [101, 102] }, async () => {
    reads++;
    return { master: 100, workers: nginxWorkerIds("101 nginx: worker process is shutting down\n102 nginx: worker process is shutting down\n211 nginx: worker process\n212 nginx: worker process (nginx)") };
  });
  assert.equal(reads, 2);
});

test("a changed or missing Nginx master identity fails immediately even when the new workers look complete", async () => {
  for (const master of [200, undefined, null, "100", 0, -1, Number.NaN]) {
    let reads = 0;
    await assert.rejects(waitForNginxGeneration({ master: 100, workers: [101, 102] }, async () => {
      reads++; return { master, workers: [211, 212] };
    }), /master changed/);
    assert.equal(reads, 1);
  }
});

test("missing or malformed original Nginx generation metadata is rejected before reading any new snapshot", async () => {
  for (const before of [null, undefined, {}, { master: 100 }, { master: 100, workers: null }, { master: 100, workers: "101" },
    { master: 100, workers: [] }, { master: 0, workers: [101] }, { master: "100", workers: [101] },
    { master: 100, workers: [0] }, { master: 100, workers: [-1] }, { master: 100, workers: [101, 101] },
    { master: 100, workers: [Number.MAX_SAFE_INTEGER + 1] }, { master: 100, workers: [Number.NaN] }]) {
    let reads = 0;
    await assert.rejects(waitForNginxGeneration(before, async () => { reads++; return { master: 100, workers: [211] }; }), /original Nginx generation/);
    assert.equal(reads, 0);
  }
});

test("missing or malformed replacement Nginx metadata is rejected rather than interpreted as a ready generation", async () => {
  for (const next of [null, undefined, {}, { master: 100 }, { master: 100, workers: null }, { master: 100, workers: "211" },
    { master: 100, workers: [0] }, { master: 100, workers: [-1] }, { master: 100, workers: [1.5] },
    { master: 100, workers: [211, 211] }, { master: 100, workers: [Number.NaN] },
    { master: 100, workers: [Number.POSITIVE_INFINITY] }, { master: 100, workers: [Number.MAX_SAFE_INTEGER + 1] }]) {
    let reads = 0;
    await assert.rejects(waitForNginxGeneration({ master: 100, workers: [101] }, async () => { reads++; return next; }), /new Nginx generation|master changed/);
    assert.equal(reads, 1);
  }
});

test("no active Nginx worker metadata cannot satisfy the fixed generation deadline", async () => {
  const realNow = Date.now, initial = realNow();
  let clockNow = initial, reads = 0;
  try {
    Date.now = () => clockNow;
    await assert.rejects(waitForNginxGeneration({ master: 100, workers: [101] }, async (budget) => {
      assert.equal(budget, 2000); reads++; clockNow = initial + 2000;
      return { master: 100, workers: nginxWorkerIds("101 nginx: worker process is shutting down\n200 nginx: cache manager process") };
    }), /fixed reload budget/);
    assert.equal(reads, 1);
  } finally { Date.now = realNow; }
});

test("the real two-second generation budget expires if Nginx never replaces its active old workers", async () => {
  const budgets = [], started = Date.now();
  await assert.rejects(waitForNginxGeneration({ master: 100, workers: [101] }, async (budget) => {
    budgets.push(budget); return { master: 100, workers: [101] };
  }), /fixed reload budget/);
  assert.equal(Date.now() - started >= 2000, true);
  assert.equal(budgets.length > 1, true);
  assert.equal(budgets.every((budget) => budget > 0 && budget <= 2000), true);
  assert.equal(budgets.every((budget, index) => index === 0 || budget <= budgets[index - 1]), true);
});

test("a replacement observation arriving after the two-second absolute deadline is never accepted", async () => {
  const realNow = Date.now, initial = realNow();
  let clockNow = initial, reads = 0;
  try {
    Date.now = () => clockNow;
    await assert.rejects(waitForNginxGeneration({ master: 100, workers: [101] }, async (budget) => {
      assert.equal(budget > 0 && budget <= 2000, true);
      reads++; clockNow = initial + (reads === 1 ? 1999 : 2001);
      return { master: 100, workers: [211] };
    }), /fixed reload budget/);
    assert.equal(reads, 2);
  } finally { Date.now = realNow; }
});

test("default mode is read-only audit with no backup, config write, reload or state update", async () => {
  const f = fixture(); const result = await runTransaction({}, f.runtime);
  assert.equal(result.mode, "audit"); assert.deepEqual(f.events, ["inspect", "verify"]);
  assert.equal(f.state, null); assert.equal(f.backup, null); assert.equal(f.bytes.toString(), site);
});

test("apply durably backs up before installation, tests and reloads only nginx, and is idempotent without overwriting backup", async () => {
  const f = fixture(); const result = await runTransaction({ mode: "apply", id }, f.runtime);
  assert.equal(result.phase, "applied"); assert.equal(f.backup.toString(), site);
  assert.equal(result.deployment, "b".repeat(40)); assert.notEqual(result.deployment, id.slice(0, 40));
  assert.deepEqual(f.events, ["inspect", "verify", "backup", "phase:installing", "install", "nginx-t", "reload", "verify", "phase:applied"]);
  const backup = f.backup;
  await runTransaction({ mode: "apply", id }, f.runtime);
  assert.equal(f.backup, backup); assert.equal(f.events.filter((e) => e === "backup").length, 1);
  assert.equal(f.events.filter((e) => e === "reload").length, 1);
});

for (const fail of ["test", "reload", "verify"]) {
  test(`failed ${fail} restores exact bytes and then tests/reloads the restored config`, async () => {
    const f = fixture({ fail });
    await assert.rejects(runTransaction({ mode: "apply", id }, f.runtime), /rollback verified/);
    assert.equal(f.bytes.toString(), site); assert.equal(f.state.phase, "rolled_back");
    assert.deepEqual(f.events.slice(-5), ["install", "nginx-t", "reload", "verify", "phase:rolled_back"]);
    assert.equal(f.backup.toString(), site);
    await assert.rejects(runTransaction({ mode: "apply", id }, f.runtime), /existing|phase/);
  });
}

test("post-install and recovery failures expose exact safe stages without arbitrary underlying values", async () => {
  const f = fixture();
  f.runtime.test = async () => { throw Object.assign(new Error("secret-value-must-not-be-logged"), { code: "SENTINEL_SENSITIVE_CODE" }); };
  await assert.rejects(runTransaction({ mode: "apply", id }, f.runtime), (error) => {
    assert.match(error.message, /apply_nginx_test/);
    assert.match(error.message, /recovery_nginx_test/);
    assert.doesNotMatch(error.message, /secret-value/);
    assert.doesNotMatch(error.message, /SENTINEL_SENSITIVE_CODE/);
    return true;
  });
  assert.equal(f.bytes.toString(), site);
  assert.equal(f.state.phase, "rollback_failed");
  await assert.rejects(runTransaction({ mode: "rollback", id }, f.runtime), /rollback_nginx_test/);
});

test("rollback needs durable matching state, is byte-exact and refuses foreign config instead of overwriting it", async () => {
  const f = fixture(); await assert.rejects(runTransaction({ mode: "rollback", id }, f.runtime), /missing/);
  await runTransaction({ mode: "apply", id }, f.runtime);
  const foreign = Buffer.from(f.bytes.toString() + "# foreign edit\n"); f.bytes = foreign;
  await assert.rejects(runTransaction({ mode: "rollback", id }, f.runtime), /changed|foreign/);
  assert.deepEqual(f.bytes, foreign);
  f.bytes = buildCandidate(Buffer.from(site)).bytes;
  await runTransaction({ mode: "rollback", id }, f.runtime);
  assert.equal(f.bytes.toString(), site); assert.equal(f.state.phase, "rolled_back");
  const reloads = f.events.filter((e) => e === "reload").length;
  await runTransaction({ mode: "rollback", id }, f.runtime);
  assert.equal(f.events.filter((e) => e === "reload").length, reloads);
});

test("invalid modes/identities and pre-existing unknown configuration never arm a transaction", async () => {
  for (const options of [{ mode: "restart", id }, { mode: "apply" }, { mode: "apply", id: "../escape" }, { mode: "rollback", id: "/" }]) {
    const f = fixture(); await assert.rejects(runTransaction(options, f.runtime)); assert.equal(f.state, null); assert.equal(f.events.includes("install"), false);
  }
  const f = fixture(); f.bytes = Buffer.from(site.replace("127.0.0.1:3100", "127.0.0.1:8080"));
  await assert.rejects(runTransaction({ mode: "apply", id }, f.runtime), /shape/); assert.equal(f.state, null);
});

test("failed current delivery is a write precondition for apply, but never blocks exact manual rollback", async () => {
  const unarmed = fixture({ preflightFailure: true });
  await assert.rejects(runTransaction({ mode: "apply", id }, unarmed.runtime), /unhealthy/);
  assert.equal(unarmed.state, null); assert.equal(unarmed.events.includes("install"), false);
  const f = fixture(); await runTransaction({ mode: "apply", id }, f.runtime); f.preflightFailure = true;
  await assert.rejects(runTransaction({ mode: "audit" }, f.runtime), /unhealthy/);
  await runTransaction({ mode: "rollback", id }, f.runtime);
  assert.equal(f.bytes.toString(), site); assert.equal(f.state.phase, "rolled_back");
  assert.equal(f.inspections.at(-1), "rollback");
});

test("a pre-write public proof failure does not create state, backup, or mutate the vhost", async () => {
  const f = fixture(); f.runtime.verify = async () => { throw new Error("untrusted public bytes"); };
  await assert.rejects(runTransaction({ mode: "apply", id }, f.runtime), /untrusted/);
  assert.equal(f.state, null); assert.equal(f.backup, null); assert.equal(f.bytes.toString(), site);
});

test("manual rollback failure after restoring bytes is durable and can resume without treating its backup as foreign", async () => {
  const f = fixture(); await runTransaction({ mode: "apply", id }, f.runtime);
  const verify = f.runtime.verify; f.runtime.verify = async () => { throw new Error("temporary restored delivery outage"); };
  await assert.rejects(runTransaction({ mode: "rollback", id }, f.runtime), /bytes restored.*retried/);
  assert.equal(f.bytes.toString(), site); assert.equal(f.state.phase, "rollback_failed");
  f.runtime.verify = verify;
  const installs = f.events.filter((e) => e === "install").length;
  await runTransaction({ mode: "rollback", id }, f.runtime);
  assert.equal(f.state.phase, "rolled_back"); assert.equal(f.events.filter((e) => e === "install").length, installs);
  assert.deepEqual(f.events.slice(-4), ["nginx-t", "reload", "verify", "phase:rolled_back"]);
});

test("interrupted prepared/installing/rolling_back transactions with exact original bytes can finish restoration", async () => {
  for (const phase of ["prepared", "installing", "rolling_back"]) {
    const f = fixture(); await runTransaction({ mode: "apply", id }, f.runtime);
    f.state.phase = phase; f.bytes = f.backup;
    await runTransaction({ mode: "rollback", id }, f.runtime);
    assert.equal(f.state.phase, "rolled_back"); assert.equal(f.bytes.toString(), site);
  }
});

test("manual rollback never overwrites a changed target identity or unsafe/malformed durable metadata", async () => {
  for (const mutate of [(state) => { state.realFile = "/etc/nginx/nginx.conf"; }, (state) => { state.mode = 0o666; },
    (state) => { state.uid = 1000; }, (state) => { state.deployment = id; }]) {
    const f = fixture(); await runTransaction({ mode: "apply", id }, f.runtime);
    mutate(f.state); const original = f.bytes;
    await assert.rejects(runTransaction({ mode: "rollback", id }, f.runtime), /state|target/);
    assert.deepEqual(f.bytes, original);
  }
});

// These fixtures use actual loopback TCP/HTTP, real source bytes and the real
// requestSnapshot implementation. The six transport cases replace neither
// sockets, SHA nor time; the separate budget case advances only Date.now.
// No listener or active connection survives an individual test.
const socketProofBytes = fs.readFileSync(new URL("../assets/figures-v10/page-043.png", import.meta.url));

async function withHttpSocketFixture(handler, exercise) {
  const requests = [], connections = [], active = new Set();
  const server = createHttpServer((request, response) => {
    requests.push({ socket: request.socket, method: request.method, url: request.url, headers: { ...request.headers } });
    handler(request, response, requests.length);
  });
  server.on("connection", (socket) => {
    connections.push(socket);
    active.add(socket); socket.on("close", () => active.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { return await exercise({ port: server.address().port, requests, connections }); }
  finally {
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    for (const socket of active) socket.destroy();
    await closed;
  }
}

function sendSocketProof(response) {
  response.writeHead(200, { "Content-Type": "image/png", "Content-Length": socketProofBytes.length });
  response.end(socketProofBytes);
}

function assertSocketProof(snapshot) {
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.size, socketProofBytes.length);
  assert.equal(snapshot.wireSize, socketProofBytes.length);
  assert.equal(snapshot.sha256, hash(socketProofBytes));
  assert.deepEqual(snapshot.sample, socketProofBytes.subarray(0, 65536));
}

test("real HTTP proofs always open fresh sockets and force Connection close, even for sequential successful GETs", async () => {
  await withHttpSocketFixture((_request, response) => sendSocketProof(response), async ({ port, requests }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      assertSocketProof(await requestSnapshot("/source.png", { port, tls: false, headers: { Connection: "keep-alive" } }));
    }
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map((request) => request.socket)).size, 3);
    for (const request of requests) {
      assert.equal(request.method, "GET"); assert.equal(request.url, "/source.png");
      assert.equal(request.headers.host, "wavekb.com"); assert.equal(request.headers.connection, "close");
    }
  });
});

test("two actual socket resets are retried with fresh GETs and the third complete source body is verified", async () => {
  await withHttpSocketFixture((request, response, attempt) => {
    if (attempt < 3) request.socket.destroy(); else sendSocketProof(response);
  }, async ({ port, requests }) => {
    assertSocketProof(await requestSnapshot("/source.png", { port, tls: false }));
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map((request) => request.socket)).size, 3);
    assert.equal(requests.every((request) => request.headers.connection === "close"), true);
  });
});

test("partial response bytes from two reset sockets are discarded rather than concatenated into the successful source", async () => {
  const partials = [Buffer.from("discarded-first-partial-body"), Buffer.from("discarded-second-different-partial-body")];
  let sentPartials = 0;
  await withHttpSocketFixture((_request, response, attempt) => {
    if (attempt === 3) { sendSocketProof(response); return; }
    response.writeHead(200, { "Content-Type": "image/png", "Content-Length": socketProofBytes.length });
    response.flushHeaders();
    response.write(partials[attempt - 1], () => {
      sentPartials++;
      // Leave a real data frame available to the client before truncating the
      // declared body. The succeeding attempt must reset digest/size/sample.
      setTimeout(() => response.socket?.destroy(), 10);
    });
  }, async ({ port, requests }) => {
    assertSocketProof(await requestSnapshot("/source.png", { port, tls: false }));
    assert.equal(sentPartials, 2); assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map((request) => request.socket)).size, 3);
  });
});

test("three actual socket resets reject after exactly three GETs without an unbounded retry or invented response", async () => {
  await withHttpSocketFixture((request) => request.socket.destroy(), async ({ port, requests }) => {
    await assert.rejects(requestSnapshot("/source.png", { port, tls: false }), { code: "ECONNRESET" });
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map((request) => request.socket)).size, 3);
  });
});

test("an actual HTTP 500 response is returned once and never retried as a transport reset", async () => {
  const failure = Buffer.from("fixture server failure");
  await withHttpSocketFixture((_request, response) => {
    response.writeHead(500, { "Content-Type": "text/plain", "Content-Length": failure.length }); response.end(failure);
  }, async ({ port, requests }) => {
    const snapshot = await requestSnapshot("/source.png", { port, tls: false });
    assert.equal(snapshot.status, 500); assert.equal(snapshot.sha256, hash(failure));
    assert.deepEqual(snapshot.sample, failure); assert.equal(requests.length, 1);
  });
});

test("an actual invalid gzip body fails its decoder after one GET and is not retried", async () => {
  const invalidGzip = Buffer.from("this is not a gzip stream");
  await withHttpSocketFixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "image/png", "Content-Encoding": "gzip", "Content-Length": invalidGzip.length });
    response.end(invalidGzip);
  }, async ({ port, requests }) => {
    await assert.rejects(requestSnapshot("/source.png", { port, tls: false }), { code: "Z_DATA_ERROR" });
    assert.equal(requests.length, 1);
  });
});

test("the fixed total proof deadline stops a new connection when a reset backoff exhausts its remaining budget", async () => {
  const realNow = Date.now, initial = realNow();
  let clockNow = initial, advance;
  try {
    await withHttpSocketFixture((request) => {
      // No 120-second sleep: advance only the budget clock while still using
      // actual sockets and the implementation's normal bounded backoff timer.
      clockNow = initial + 119990;
      advance = setTimeout(() => { clockNow = initial + 120001; }, 5);
      request.socket.destroy();
    }, async ({ port, requests, connections }) => {
      Date.now = () => clockNow;
      await assert.rejects(requestSnapshot("/source.png", { port, tls: false }), /budget exceeded/);
      assert.equal(requests.length, 1); assert.equal(connections.length, 1);
    });
  } finally { Date.now = realNow; clearTimeout(advance); }
});

test("real Nginx fixture: native bytes, gzip decode, identity/gzip ranges, missing hash and unrelated proxy isolation", { skip: !process.env.KNOWLEDGE_NGINX_TEST_BIN }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-nginx-assets-"));
  // Nothing relies on the distribution's /var/log or /var/lib paths. The
  // unprivileged Actions user owns this entire short-lived Nginx prefix.
  for (const name of ["logs", "client-body", "proxy", "fastcgi", "uwsgi", "scgi"]) fs.mkdirSync(path.join(temp, name), { mode: 0o700 });
  const portReservation = createServer();
  await new Promise((resolve, reject) => { portReservation.once("error", reject); portReservation.listen(0, "127.0.0.1", resolve); });
  const port = portReservation.address().port;
  await new Promise((resolve, reject) => portReservation.close((error) => error ? reject(error) : resolve()));
  const root = path.resolve(import.meta.dirname, "..");
  const publicRoot = path.join(temp, "public"); fs.mkdirSync(path.join(publicRoot, "assets/books"), { recursive: true });
  fs.mkdirSync(path.join(publicRoot, "assets/figures-v10"), { recursive: true }); fs.mkdirSync(path.join(publicRoot, "assets/reading-images"), { recursive: true });
  const pdf = fs.readFileSync(path.join(root, "assets/books/elliott-wave-natural-law-distilled.pdf"));
  const png = fs.readFileSync(path.join(root, "assets/figures-v10/page-043.png"));
  fs.copyFileSync(path.join(root, "assets/books/elliott-wave-natural-law-distilled.pdf"), path.join(publicRoot, "assets/books/test.pdf"));
  fs.copyFileSync(path.join(root, "assets/figures-v10/page-043.png"), path.join(publicRoot, "assets/figures-v10/test.png"));
  const appRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const webp = await appRequire("sharp")(png).webp({ lossless: true, effort: 6 }).toBuffer();
  const webpPath = `/assets/reading-images/${hash(webp)}.webp`;
  fs.writeFileSync(path.join(publicRoot, webpPath), webp);
  const config = path.join(temp, "nginx.conf");
  const fixtureConfig = (locations) => `pid ${temp}/nginx.pid; worker_processes 2; error_log ${temp}/logs/error.log; events {} http {
    access_log off;
    client_body_temp_path ${temp}/client-body;
    proxy_temp_path ${temp}/proxy;
    fastcgi_temp_path ${temp}/fastcgi;
    uwsgi_temp_path ${temp}/uwsgi;
    scgi_temp_path ${temp}/scgi;
    server { listen 127.0.0.1:${port}; ${locations} location / { return 418; } }
  }`;
  // Start an actual old generation without the asset locations. The same
  // master must gracefully activate the static candidate before byte proofs.
  fs.writeFileSync(config, fixtureConfig(""));
  const binary = process.env.KNOWLEDGE_NGINX_TEST_BIN;
  const checked = spawnSync(binary, ["-t", "-c", config, "-p", `${temp}/`, "-e", `${temp}/logs/error.log`], { encoding: "utf8", timeout: 5000 });
  assert.equal(checked.status, 0, checked.error?.message || checked.stderr);
  const child = spawn(binary, ["-c", config, "-p", `${temp}/`, "-e", `${temp}/logs/error.log`, "-g", "daemon off;"], { stdio: ["ignore", "ignore", "pipe"] });
  let startError = null, diagnostics = "";
  child.once("error", (error) => { startError = error; });
  child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192); });
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once("exit", () => { exited = true; resolve(); });
    child.once("error", () => { exited = true; resolve(); });
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startError || exited) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) });
        await response.arrayBuffer(); ready = response.status === 418; if (ready) break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(ready, true, startError?.message || diagnostics || fs.readFileSync(`${temp}/logs/error.log`, "utf8"));
    const readGeneration = (budget) => {
      const masterText = fs.readFileSync(`${temp}/nginx.pid`, "utf8").trim();
      assert.match(masterText, /^[1-9][0-9]*$/);
      const master = Number(masterText);
      assert.equal(Number.isSafeInteger(master), true); assert.equal(master, child.pid);
      const workers = spawnSync("/usr/bin/ps", ["--ppid", masterText, "-ww", "-o", "pid=,args="],
        { encoding: "utf8", timeout: Math.max(1, Math.min(500, budget)) });
      assert.equal(workers.status, 0, workers.error?.message || workers.stderr);
      return { master, workers: nginxWorkerIds(workers.stdout) };
    };
    const before = readGeneration(1000);
    assert.equal(before.workers.length, 2);
    fs.writeFileSync(config, fixtureConfig(staticLocations(publicRoot)));
    const reloadChecked = spawnSync(binary, ["-t", "-c", config, "-p", `${temp}/`, "-e", `${temp}/logs/error.log`], { encoding: "utf8", timeout: 5000 });
    assert.equal(reloadChecked.status, 0, reloadChecked.error?.message || reloadChecked.stderr);
    process.kill(before.master, "SIGHUP");
    const generations = [];
    await waitForNginxGeneration(before, async (budget) => {
      const next = readGeneration(budget); generations.push(next); return next;
    });
    const after = generations.at(-1);
    assert.equal(after.master, before.master); assert.equal(after.workers.length, before.workers.length);
    assert.equal(after.workers.every((pid) => !before.workers.includes(pid)), true);
    assert.deepEqual(after.workers, generations.at(-2).workers);
    for (const [url, source, mime] of [["/assets/books/test.pdf", pdf, "application/pdf"], ["/assets/figures-v10/test.png", png, "image/png"], [webpPath, webp, "image/webp"]]) {
      for (const encoding of ["identity", "gzip"]) {
        const full = await requestSnapshot(url, { port, tls: false, headers: { "Accept-Encoding": encoding } });
        assert.equal(full.status, 200); assert.equal(full.sha256, hash(source)); assert.equal(full.size, source.length);
        assert.match(full.headers["content-type"], new RegExp(`^${mime}`));
        assert.equal(full.headers["x-content-type-options"], "nosniff"); assert.equal(full.headers["x-frame-options"], "SAMEORIGIN");
        assert.equal(full.headers["cache-control"], mime === "image/webp" ? "public, max-age=31536000, immutable" : "public, max-age=0");
        if (encoding === "gzip" && mime !== "image/webp") { assert.equal(full.headers["content-encoding"], "gzip"); assert.equal(full.wireSize < source.length, true); }
        const partial = await requestSnapshot(url, { port, tls: false, headers: { Range: "bytes=17-80", "Accept-Encoding": encoding } });
        assert.equal(partial.status, 206); assert.equal(partial.headers["content-range"], `bytes 17-80/${source.length}`);
        assert.equal(partial.headers["content-encoding"], undefined); assert.equal(partial.size, 64);
        assert.deepEqual(partial.sample, source.subarray(17, 81));
      }
    }
    const missing = await requestSnapshot(`/assets/reading-images/${"f".repeat(64)}.webp`, { port, tls: false });
    assert.equal(missing.status, 404); assert.equal(/immutable/.test(missing.headers["cache-control"] || ""), false); assert.equal(missing.headers["x-content-type-options"], "nosniff");
    for (const url of ["/", "/api/health", "/v1/private", "/_next/static/app.js", "/assets/books/secrets.env", "/assets/private/test.png"]) {
      assert.equal((await requestSnapshot(url, { port, tls: false })).status, 418);
    }
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 1500))]);
      if (!exited) { child.kill("SIGKILL"); await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 1500))]); }
    }
    assert.equal(exited, true, "Fixture process did not stop within its bounded shutdown budget");
    // Remove only this test's validated unique temporary directory.
    assert.equal(path.dirname(temp), os.tmpdir()); assert.match(path.basename(temp), /^wavekb-nginx-assets-/);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
