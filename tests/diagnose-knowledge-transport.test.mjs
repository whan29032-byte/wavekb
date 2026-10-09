import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { PUBLIC_ASSETS, PROBE_BUDGET_MS, inspectOrigin, nginxProjection, probeAlpn, probeAsset, diagnoseKnowledgeTransport } from "../scripts/diagnose-knowledge-transport.mjs";
import { deriveReadingImage } from "../apps/web/scripts/lib/reading-images.mjs";

const sentinel = "SECRET_NO_STDOUT_credential-header-owner";
const sha = "a".repeat(40), releaseId = `${sha}-37936509896-2`;
const digest = (body) => createHash("sha256").update(body).digest("hex");
const assetFor = (body, mime = "image/webp") => ({ ...PUBLIC_ASSETS.find((asset) => asset.mime === mime), bytes: body.length, sha256: digest(body) });
const script = fileURLToPath(new URL("../scripts/diagnose-knowledge-transport.mjs", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
// No generated/build output dependency in a fresh checkout. Use tracked
// originals and the existing pinned lossless encoder, entirely in memory.
const derived = await deriveReadingImage({ source_path: "assets/figures-v10/page-043.png" }, fs.readFileSync(path.join(projectRoot, "assets/figures-v10/page-043.png")));
const publicBodies = new Map(PUBLIC_ASSETS.map((asset) => [asset.id, asset.mime === "image/webp" ? derived.bytes : fs.readFileSync(path.join(projectRoot, asset.url))]));

async function fixture(t, handler) {
  let requests = 0; const sockets = new Set();
  const server = http.createServer((request, response) => { requests++; handler(request, response); });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  const options = [];
  const request = (input, callback) => {
    options.push(input);
    return http.request({ ...input, hostname: "127.0.0.1", port: server.address().port }, callback);
  };
  return { request, options, requests: () => requests, sockets };
}

function originFixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-transport-")));
  const root = path.join(directory, "application"), release = path.join(root, "releases", releaseId);
  fs.mkdirSync(path.join(release, "apps/web/public"), { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(release, "DEPLOYMENT_VERSION"), sha + "\n", { mode: 0o644 });
  fs.symlinkSync(release, path.join(root, "current"));
  for (const asset of PUBLIC_ASSETS) {
    const file = path.join(release, "apps/web/public", asset.url);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
    fs.writeFileSync(file, publicBodies.get(asset.id), { mode: 0o644 });
  }
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { root, release, directory, uid: process.getuid() };
}

test("frozen four public asset identities match real local originals, including the content address", () => {
  assert.equal(PUBLIC_ASSETS.length, 4); assert.equal(PUBLIC_ASSETS[0].bytes, 404664);
  for (const asset of PUBLIC_ASSETS) {
    const body = publicBodies.get(asset.id);
    assert.equal(body.length, asset.bytes); assert.equal(digest(body), asset.sha256);
    if (asset.mime === "image/webp") assert.equal(path.basename(asset.url, ".webp"), asset.sha256);
    assert.equal(Object.isFrozen(asset), true);
  }
});

test("real loopback full EOF verifies SHA while fixed target/headers/protocol ignore environment", async (t) => {
  const body = Buffer.from(sentinel), asset = assetFor(body);
  const f = await fixture(t, (request, response) => { response.writeHead(200, { "Content-Type": asset.mime, "Content-Length": body.length }); response.end(body); });
  const result = await probeAsset("origin", asset, { request: f.request });
  assert.equal(result.state, "complete"); assert.equal(result.verified, true); assert.equal(result.decodedSha256, asset.sha256);
  assert.equal(result.wireBytes, body.length); assert.equal(result.decodedBytes, body.length); assert.equal(result.httpVersion, "1.1");
  assert.equal(f.requests(), 1); assert.equal(f.options[0].hostname, "127.0.0.1"); assert.equal(f.options[0].servername, "wavekb.com");
  assert.equal(f.options[0].port, 443); assert.equal(f.options[0].path, PUBLIC_ASSETS[0].url); assert.equal(f.options[0].agent, false);
  assert.deepEqual(f.options[0].ALPNProtocols, ["http/1.1"]);
  assert.deepEqual(f.options[0].headers, { Host: "wavekb.com", "Accept-Encoding": "identity", Connection: "close" });
  for (const key of ["ttfbMs", "bodyMs", "totalMs", "maxPositiveChunkGapMs", "bodyIdleMs"]) assert.ok(Number.isFinite(result[key]) && result[key] >= 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_NO_STDOUT|credential|header-owner/);
});

test("real compressed PNG decodes and verifies original SHA, with distinct encoded/decoded lengths", async (t) => {
  const body = Buffer.from("original PNG bytes".repeat(200)), encoded = gzipSync(body), asset = assetFor(body, "image/png");
  const f = await fixture(t, (request, response) => { assert.equal(request.headers["accept-encoding"], "gzip"); response.writeHead(200, { "Content-Type": "image/png", "Content-Encoding": "gzip", "Content-Length": encoded.length }); response.end(encoded); });
  const result = await probeAsset("public", asset, { request: f.request });
  assert.equal(result.verified, true); assert.equal(result.encoding, "gzip"); assert.equal(result.contentLength, encoded.length);
  assert.equal(result.wireBytes, encoded.length); assert.equal(result.decodedBytes, body.length); assert.equal(result.decodedSha256, asset.sha256);
  assert.equal(f.options[0].hostname, "wavekb.com");
});

test("real positive body gaps are recorded, including chunked responses without Content-Length", async (t) => {
  const body = Buffer.from("abcdef"), asset = assetFor(body);
  const f = await fixture(t, (request, response) => {
    response.writeHead(200, { "Content-Type": "image/webp" }); response.write(body.subarray(0, 2));
    setTimeout(() => response.write(body.subarray(2, 4)), 35); setTimeout(() => response.end(body.subarray(4)), 70);
  });
  const result = await probeAsset("public", asset, { request: f.request });
  assert.equal(result.verified, true); assert.equal(result.contentLength, null); assert.ok(result.maxPositiveChunkGapMs >= 20); assert.ok(result.bodyMs >= 50);
});

test("one absolute 12000ms deadline aborts a progressing real body without resetting or retrying", async (t) => {
  const body = Buffer.alloc(1000, 65), asset = assetFor(body);
  const f = await fixture(t, (request, response) => {
    response.writeHead(200, { "Content-Type": "image/webp", "Content-Length": body.length }); response.write(body.subarray(0, 1));
    const interval = setInterval(() => response.write(body.subarray(0, 1)), 5); response.once("close", () => clearInterval(interval));
  });
  const budgets = [];
  const result = await probeAsset("public", asset, { request: f.request, setTimer: (callback, budget) => { budgets.push(budget); return setTimeout(callback, 50); } });
  assert.deepEqual(budgets, [12000]); assert.equal(PROBE_BUDGET_MS, 12000); assert.equal(f.requests(), 1);
  assert.equal(result.state, "deadline_exceeded"); assert.equal(result.verified, false); assert.equal(result.decodedSha256, null);
  assert.ok(result.wireBytes > 0 && result.wireBytes < body.length);
  await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(f.sockets.size, 0);
});

test("the same absolute budget covers pre-header delays, without a second request", async (t) => {
  const f = await fixture(t, () => {}), budgets = [];
  const result = await probeAsset("origin", PUBLIC_ASSETS[0], { request: f.request, setTimer: (callback, budget) => { budgets.push(budget); return setTimeout(callback, 30); } });
  assert.equal(result.state, "deadline_exceeded"); assert.equal(result.ttfbMs, null); assert.equal(result.bodyMs, null);
  assert.equal(result.status, null); assert.equal(result.decodedSha256, null); assert.equal(f.requests(), 1); assert.deepEqual(budgets, [12000]);
});

test("a real full body cannot verify after the absolute deadline even when its timer has not fired", async (t) => {
  const body = Buffer.from("complete bytes after a delayed timer"), asset = assetFor(body);
  for (const elapsed of [12000, 12001]) {
    let now = 0; const budgets = [];
    const f = await fixture(t, (request, response) => {
      response.writeHead(200, { "Content-Type": "image/webp", "Content-Length": body.length }); response.flushHeaders();
      setTimeout(() => { now = elapsed; response.end(body); }, 5);
    });
    const result = await probeAsset("public", asset, { request: f.request, clock: () => now,
      setTimer: (callback, budget) => { budgets.push(budget); return setTimeout(callback, budget); } });
    assert.deepEqual(budgets, [12000]); assert.equal(f.requests(), 1); assert.equal(result.wireBytes, body.length);
    assert.equal(result.decodedBytes, body.length); assert.equal(result.state, "deadline_exceeded");
    assert.equal(result.verified, false); assert.equal(result.decodedSha256, null); assert.equal(result.totalMs, elapsed);
  }
});

test("headers-to-first body delay and final timeout tails remain visible in the maximum gap", async (t) => {
  const body = Buffer.from("abcdef"), asset = assetFor(body);
  const delayed = await fixture(t, (request, response) => {
    response.writeHead(200, { "Content-Type": "image/webp", "Content-Length": body.length }); response.flushHeaders();
    setTimeout(() => response.end(body), 40);
  });
  const complete = await probeAsset("public", asset, { request: delayed.request });
  assert.equal(complete.verified, true); assert.ok(complete.maxPositiveChunkGapMs >= 25);
  for (const prefix of [false, true]) {
    const stalled = await fixture(t, (request, response) => {
      response.writeHead(200, { "Content-Type": "image/webp", "Content-Length": body.length }); response.flushHeaders();
      if (prefix) response.write(body.subarray(0, 1));
    });
    const partial = await probeAsset("public", asset, { request: stalled.request, setTimer: (callback, budget) => { assert.equal(budget, 12000); return setTimeout(callback, 50); } });
    assert.equal(partial.state, "deadline_exceeded"); assert.equal(partial.decodedSha256, null); assert.ok(partial.maxPositiveChunkGapMs >= 30); assert.ok(partial.bodyIdleMs >= 30);
  }
});

test("redirects, private/unknown headers, compression and non-200 statuses are never exposed or retried", async (t) => {
  const variants = [
    [301, { Location: sentinel }, "invalid_status"],
    [403, { "Content-Type": sentinel }, "invalid_status"],
    [200, { "Content-Type": sentinel }, "invalid_headers"],
    [200, { "Content-Type": "image/webp", "Set-Cookie": sentinel }, "invalid_headers"],
    [200, { "Content-Type": "image/webp", "Content-Range": sentinel }, "invalid_headers"],
    [200, { "Content-Type": "image/webp", "Content-Encoding": sentinel }, "invalid_encoding"],
    [200, { "Content-Type": "image/webp", "Content-Length": 67108865 }, "invalid_headers"],
  ];
  for (const [status, headers, state] of variants) {
    const f = await fixture(t, (request, response) => { response.writeHead(status, headers); response.end(sentinel); });
    const result = await probeAsset("public", PUBLIC_ASSETS[0], { request: f.request });
    assert.equal(result.state, state); assert.equal(result.verified, false); assert.equal(result.decodedSha256, null); assert.equal(f.requests(), 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_NO_STDOUT|Location|Set-Cookie/);
  }
});

test("wrong complete bytes, premature EOF and invalid gzip cannot produce a complete source hash", async (t) => {
  const body = Buffer.from("correct"), asset = assetFor(body);
  const wrong = await fixture(t, (request, response) => { response.writeHead(200, { "Content-Type": "image/webp" }); response.end("incorrect"); });
  const mismatch = await probeAsset("public", asset, { request: wrong.request });
  assert.equal(mismatch.state, "source_mismatch"); assert.equal(mismatch.decodedSha256, null);
  const truncated = await fixture(t, (request, response) => { response.writeHead(200, { "Content-Type": "image/webp", "Content-Length": 100 }); response.end("partial"); });
  const partial = await probeAsset("public", asset, { request: truncated.request });
  assert.equal(partial.state, "invalid_body"); assert.equal(partial.verified, false); assert.equal(partial.decodedSha256, null);
  const bad = await fixture(t, (request, response) => { response.writeHead(200, { "Content-Type": "image/png", "Content-Encoding": "gzip" }); response.end(sentinel); });
  const corrupt = await probeAsset("public", assetFor(body, "image/png"), { request: bad.request });
  assert.equal(corrupt.state, "invalid_body"); assert.equal(corrupt.decodedSha256, null); assert.doesNotMatch(JSON.stringify(corrupt), /SECRET_NO_STDOUT/);
});

test("origin identity and public source trees are protected and read without changes", (t) => {
  const f = originFixture(t), before = fs.readFileSync(path.join(f.release, "DEPLOYMENT_VERSION"));
  const result = inspectOrigin(releaseId, f);
  assert.equal(result.deployment, sha); assert.deepEqual(result.assets, PUBLIC_ASSETS); assert.deepEqual(fs.readFileSync(path.join(f.release, "DEPLOYMENT_VERSION")), before);
  assert.throws(() => inspectOrigin(`${"b".repeat(40)}-1-1`, f));
  fs.writeFileSync(path.join(f.release, "DEPLOYMENT_VERSION"), "b".repeat(40) + "\n"); assert.throws(() => inspectOrigin(releaseId, f));
});

test("origin refuses traversal, writable files/directories and symlink assets before requests", (t) => {
  const f = originFixture(t), target = path.join(f.release, "apps/web/public", PUBLIC_ASSETS[1].url);
  for (const id of ["../outside", `${sha}-1-0`, `${releaseId}'`]) assert.throws(() => inspectOrigin(id, f));
  fs.chmodSync(target, 0o666); assert.throws(() => inspectOrigin(releaseId, f)); fs.chmodSync(target, 0o644);
  fs.chmodSync(path.dirname(target), 0o777); assert.throws(() => inspectOrigin(releaseId, f)); fs.chmodSync(path.dirname(target), 0o755);
  const outside = path.join(f.directory, "outside"); fs.writeFileSync(outside, sentinel); fs.unlinkSync(target); fs.symlinkSync(outside, target);
  assert.throws(() => inspectOrigin(releaseId, f)); assert.equal(fs.readFileSync(outside, "utf8"), sentinel);
});

test("safe fixed-vhost projection omits raw configuration, version errors and unsupported listener values", () => {
  let calls = 0;
  const options = {
    execute(command, args, opts) { calls++; assert.equal(command, "/usr/sbin/nginx"); assert.deepEqual(args, ["-V"]); assert.equal(opts.timeout, 10000); return { status: 0, stdout: sentinel, stderr: "nginx version: nginx/1.24.0\nconfigure arguments: --with-http_v2_module " + sentinel }; },
    readVhost: () => Buffer.from(`server_name wavekb.com www.wavekb.com;\nlisten 443 ssl;\nlisten [::]:443 ssl http2 ipv6only=on;\n# ${sentinel}`),
  };
  const result = nginxProjection(options);
  assert.equal(calls, 1); assert.equal(result.version, "1.24.0"); assert.equal(result.hasHttpV2Module, true); assert.equal(result.scope, "fixed_vhost_only");
  assert.deepEqual(result.listeners, [{ family: "ipv4", ssl: true, http2: false }, { family: "ipv6", ssl: true, http2: true }]); assert.doesNotMatch(JSON.stringify(result), /SECRET_NO_STDOUT/);
  const invalid = nginxProjection({ execute: () => { throw new Error(sentinel); }, readVhost: () => Buffer.from(sentinel) });
  assert.equal(invalid.version, null); assert.equal(invalid.configurationState, "unavailable"); assert.deepEqual(invalid.listeners, []);
});

test("actual TLS ALPN is a handshake only, with certificate validation and no h2 request frames", async (t) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-alpn-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = path.join(directory, "key.pem"), cert = path.join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=wavekb.com"], { stdio: "ignore" });
  let frames = 0; const sockets = new Set();
  const server = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert), ALPNProtocols: ["h2", "http/1.1"] }, (socket) => { socket.on("data", (chunk) => { frames += chunk.length; }); });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  const result = await probeAlpn({ connect(options) {
    assert.equal(options.host, "127.0.0.1"); assert.equal(options.port, 443); assert.equal(options.servername, "wavekb.com"); assert.equal(options.rejectUnauthorized, true);
    assert.deepEqual(options.ALPNProtocols, ["h2", "http/1.1"]);
    return tls.connect({ ...options, port: server.address().port, ca: fs.readFileSync(cert) });
  } });
  assert.deepEqual(result, { state: "read", selected: "h2" }); assert.equal(frames, 0);
  let now = 0;
  const late = await probeAlpn({ clock: () => now, connect(options) {
    const socket = tls.connect({ ...options, port: server.address().port, ca: fs.readFileSync(cert) });
    // Installed before the helper's listener: emulate secureConnect queued
    // ahead of an overdue timer, without waiting 12 actual seconds.
    socket.once("secureConnect", () => { now = 12000; }); return socket;
  } });
  assert.deepEqual(late, { state: "deadline_exceeded", selected: "none_or_unknown" }); assert.equal(frames, 0);
});

test("CLI argument and asset override attempts reject before any command or network", async () => {
  for (const args of [[], ["public", sentinel], ["public", "--host=other"], ["origin"], ["origin", "../outside"], ["origin", releaseId, "--header=secret"], ["other"]]) {
    await assert.rejects(diagnoseKnowledgeTransport(args, { originReader: () => assert.fail("No source read"), nginxReader: () => assert.fail("No command"), assetReader: () => assert.fail("No network") }));
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 1000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.doesNotMatch(result.stderr, /SECRET_NO_STDOUT|other|outside|--host/);
  }
  assert.throws(() => probeAsset("public", { ...PUBLIC_ASSETS[0], url: "https://other/secret" }));
  await assert.rejects(diagnoseKnowledgeTransport(["origin", releaseId], { uid: 501, originReader: () => assert.fail("Non-root must not read origin") }));
});

test("public diagnostics probe all four sequentially, with no origin/file/command or retry calls", async () => {
  let active = 0, calls = 0;
  const result = await diagnoseKnowledgeTransport(["public"], {
    originReader: () => assert.fail("Public does not read origin"), nginxReader: () => assert.fail("Public does not read configuration"), alpnReader: () => assert.fail("No extra public handshake"),
    async assetReader(mode, asset) { assert.equal(mode, "public"); assert.equal(active++, 0); assert.equal(asset, PUBLIC_ASSETS[calls++]); await new Promise((resolve) => setTimeout(resolve, 1)); active--; return { id: asset.id, verified: false, state: "network_error", decodedSha256: null }; },
  });
  assert.equal(calls, 4); assert.equal(result.allAssetsVerified, false); assert.equal(result.probeProtocol, "http/1.1"); assert.equal(result.deployment, undefined);
});

test("origin rechecks the exact current identity and source proof after all body reads", async () => {
  let reads = 0;
  const result = await diagnoseKnowledgeTransport(["origin", releaseId], { uid: 0,
    originReader: () => { reads++; return { deployment: sha, assets: PUBLIC_ASSETS }; }, nginxReader: () => ({ configurationState: "read" }), alpnReader: async () => ({ state: "read", selected: "h2" }),
    assetReader: async (mode, asset) => ({ id: asset.id, verified: true, state: "complete", decodedSha256: asset.sha256 }),
  });
  assert.equal(reads, 2); assert.equal(result.allAssetsVerified, true); assert.equal(result.probeProtocol, "http/1.1"); assert.equal(result.alpn.selected, "h2");
  reads = 0;
  await assert.rejects(diagnoseKnowledgeTransport(["origin", releaseId], { uid: 0,
    originReader: () => ({ deployment: reads++ ? "b".repeat(40) : sha, assets: PUBLIC_ASSETS }), nginxReader: () => ({}), alpnReader: async () => ({}), assetReader: async () => ({ verified: true }),
  }));
});

test("stdin CLI remains self-contained, read-only and has no environment/host/path override branch", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.doesNotMatch(source, /process\.env|\.writeFile|\.appendFile|\.chmod|\.chown|\.rename|\.unlink|systemctl|journalctl|DatabaseSync|sqlite|EnvironmentFile|import .* from ["']\.\.?\//);
  assert.match(source, /const ROOT = "\/srv\/wavekb-next-preview"/);
  assert.match(source, /request\(\{ hostname: mode === "origin" \? "127\.0\.0\.1" : "wavekb\.com"/);
  assert.match(source, /PROBE_BUDGET_MS = 12000/); assert.doesNotMatch(source, /for \(let attempt/);
});
