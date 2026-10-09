import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const appRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const sharp = appRequire("sharp");
const bytes = await sharp(fs.readFileSync(path.join(root, "assets/figures-v10/page-043.png"))).webp({ lossless: true, effort: 6 }).toBuffer();
const digest = createHash("sha256").update(bytes).digest("hex");
const origin = "https://wavekb.test";
const imageUrl = `${origin}/assets/reading-images/${digest}.webp`;
const script = fs.readFileSync(path.join(root, "apps/web/public/sw-reading-images.js"), "utf8");

function imageRequest(url = imageUrl, init) {
  const request = new Request(url, init);
  Object.defineProperty(request, "destination", { value: "image" });
  return request;
}

function load(fetcher, overrides = {}, timers = {}) {
  const scope = { location: { origin }, crypto: webcrypto, ...overrides };
  vm.runInNewContext(script, { self: scope, fetch: fetcher, URL, Response, Request, Headers, AbortController, DOMException,
    Uint8Array, ArrayBuffer, setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout }, { filename: "sw-reading-images.js" });
  return scope.WaveKBReadingImages;
}

function streamedResponse(body, headers, status = 206, signal) {
  let position = 0;
  const stream = new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () => { try { controller.error(signal.reason || new DOMException("Aborted", "AbortError")); } catch {} }, { once: true });
    },
    pull(controller) {
      if (position >= body.length) { controller.close(); return; }
      const end = Math.min(position + 8191, body.length);
      controller.enqueue(body.subarray(position, end)); position = end;
    },
  });
  return new Response(stream, { status, headers });
}

function server(options = {}) {
  const calls = [];
  let active = 0, maximum = 0;
  const fetcher = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const range = new Headers(init.headers).get("Range");
    calls.push({ input, init, url, range });
    if (init.signal?.aborted) throw init.signal.reason;
    if (!range) return streamedResponse(bytes, { "Content-Type": "image/webp", "Cache-Control": "public", "Content-Length": String(bytes.length) }, 200, init.signal || input.signal);
    if (options.ignoreRange) return streamedResponse(bytes, { "Content-Type": "image/webp", "Content-Length": String(bytes.length) }, 200, init.signal);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(match[1]), end = Number(match[2]);
    const total = options.size ?? bytes.length;
    const isProbe = start === 0 && end === 0;
    let body = bytes.subarray(start, end + 1);
    let contentRange = `bytes ${start}-${end}/${total}`;
    if (!isProbe && options.corrupt) { body = Buffer.from(body); body[0] ^= 1; }
    if (!isProbe && options.truncate) body = body.subarray(0, body.length - 1);
    if (!isProbe && options.oversize) body = Buffer.concat([body, Buffer.from([0])]);
    if (!isProbe && options.wrongRange) contentRange = `bytes ${start + 1}-${end}/${total}`;
    if (!isProbe && options.wrongTotal) contentRange = `bytes ${start}-${end}/${total + 1}`;
    if (isProbe && options.badProbe) contentRange = "bytes 0-0/*";
    if (!isProbe && options.rejectChunk) throw new TypeError("Network failed");
    if (!isProbe) {
      active++; maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
    }
    const response = streamedResponse(body, { "Content-Type": options.wrongMime ? "text/html" : "image/webp", "Content-Range": contentRange,
      "Content-Length": String(end - start + 1 + (options.wrongLength ? 1 : 0)),
      "Cache-Control": options.private ? "private, no-store" : "public, max-age=31536000, immutable", ETag: '"partial-etag"',
      ...(options.cookie ? { "Set-Cookie": "not-cacheable=1" } : {}) }, 206, init.signal);
    if (options.redirected) Object.defineProperty(response, "redirected", { value: true });
    return response;
  };
  return { fetcher, calls, get maximum() { return maximum; } };
}

test("four real streamed ranges assemble the exact native WebP and real SHA-256 before verified 200", async () => {
  const backend = server();
  const request = imageRequest();
  const before = { url: request.url, mode: request.mode, credentials: request.credentials, headers: [...request.headers] };
  const result = await load(backend.fetcher).fetch(request);
  assert.equal(result.verified, true);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.type, "default");
  assert.equal(result.response.headers.get("Content-Length"), String(bytes.length));
  assert.equal(result.response.headers.get("Content-Type"), "image/webp");
  assert.equal(result.response.headers.get("Content-Range"), null);
  assert.equal(result.response.headers.get("ETag"), null);
  assert.equal(result.response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  const complete = Buffer.from(await result.response.arrayBuffer());
  assert.deepEqual(complete, bytes);
  assert.equal(createHash("sha256").update(complete).digest("hex"), digest);
  assert.deepEqual((await sharp(complete).metadata()).width, 1191);
  assert.equal((await sharp(complete).metadata()).height, 1755);
  assert.equal(backend.calls.length, 5);
  assert.equal(backend.calls[0].range, "bytes=0-0");
  assert.equal(backend.maximum, 4);
  for (const call of backend.calls) {
    assert.equal(call.url, imageUrl); assert.equal(call.init.mode, "same-origin"); assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "error"); assert.equal(call.init.cache, "no-store");
    assert.deepEqual([...new Headers(call.init.headers).keys()], ["range"]);
  }
  assert.deepEqual({ url: request.url, mode: request.mode, credentials: request.credentials, headers: [...request.headers] }, before);
});

test("scope excludes originals, cross-origin, queries, non-image, private and preexisting Range requests without changing their fetch", async () => {
  const requests = [imageRequest(`${origin}/assets/figures-v10/page-043.png`), imageRequest(imageUrl.replace(origin, "https://elsewhere.test")),
    imageRequest(`${imageUrl}?token=hidden`), imageRequest(imageUrl.replace(digest, digest.toUpperCase())),
    imageRequest(imageUrl, { headers: { Range: "bytes=0-1" } }), imageRequest(imageUrl, { headers: { Authorization: "Bearer not-for-public-assets" } }),
    imageRequest(imageUrl, { headers: { Cookie: "private=1" } }), imageRequest(imageUrl, { headers: { "Proxy-Authorization": "private" } }),
    imageRequest(imageUrl, { method: "POST" }), new Request(imageUrl)];
  for (const request of requests) {
    const backend = server(); const helper = load(backend.fetcher);
    assert.equal(helper.canHandle(request), false);
    const result = await helper.fetch(request);
    assert.equal(result.verified, false); assert.equal(backend.calls.length, 1); assert.equal(backend.calls[0].input, request);
    assert.deepEqual(backend.calls[0].init, {});
  }
});

test("missing digest capability forwards the original real request once", async () => {
  const request = imageRequest(); const backend = server();
  const result = await load(backend.fetcher, { crypto: undefined }).fetch(request);
  assert.equal(result.verified, false); assert.equal(backend.calls.length, 1); assert.equal(backend.calls[0].input, request);
});

test("ignored Range forwards the real 200 body without waiting, reconstruction or fallback", async () => {
  const backend = server({ ignoreRange: true }); const result = await load(backend.fetcher).fetch(imageRequest());
  assert.equal(result.verified, false); assert.equal(result.response.status, 200); assert.equal(backend.calls.length, 1);
  assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
  assert.equal(backend.calls[0].init.signal.aborted, false);
});

for (const options of [{ size: 1024 }, { size: 2 * 1024 * 1024 + 1 }, { badProbe: true }, { wrongRange: true },
  { truncate: true }, { oversize: true }, { corrupt: true }, { rejectChunk: true }, { private: true }, { wrongTotal: true },
  { wrongLength: true }, { wrongMime: true }, { cookie: true }, { redirected: true }]) {
  test(`invalid/unsafe partial ${JSON.stringify(options)} aborts all chunks and falls back to one real full fetch`, async () => {
    const backend = server(options); const result = await load(backend.fetcher).fetch(imageRequest());
    assert.equal(result.verified, false); assert.equal(result.response.status, 200);
    assert.equal(backend.calls.filter((call) => !call.range).length, 1);
    assert.equal(backend.calls.filter((call) => call.range && call.range !== "bytes=0-0").length <= 4, true);
    assert.equal(backend.calls[0].init.signal.aborted, true);
    assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
  });
}

test("request cancellation while a chunk body is being read aborts all ranges with no fallback", async () => {
  const controller = new AbortController(); const calls = [];
  const backend = server();
  const fetcher = async (input, init) => {
    calls.push(init);
    if (init.headers.Range === "bytes=0-0") return backend.fetcher(input, init);
    return new Response(new ReadableStream({ start(stream) {
      init.signal.addEventListener("abort", () => stream.error(init.signal.reason), { once: true });
      setTimeout(() => controller.abort(new DOMException("User canceled", "AbortError")), 1);
    } }), { status: 206, headers: { "Content-Type": "image/webp", "Content-Range": init.headers.Range.replace("=", " ") + `/${bytes.length}` } });
  };
  await assert.rejects(load(fetcher).fetch(imageRequest(imageUrl, { signal: controller.signal })), { name: "AbortError" });
  assert.equal(calls.length, 5); assert.equal(calls.every((call) => call.signal.aborted), true);
});

test("range budget covers a probe body after successful headers and then uses only one normal fallback", async () => {
  const backend = server(); let scheduledBudget, rangeSignal, fullFetches = 0;
  const fetcher = async (input, init) => {
    if (!new Headers(init.headers).has("Range")) { fullFetches++; return backend.fetcher(input, init); }
    rangeSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(bytes[0]));
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
      // Headers and one byte arrived, but the body deliberately never closes.
    } }), { status: 206, headers: { "Content-Type": "image/webp", "Content-Range": `bytes 0-0/${bytes.length}`, "Content-Length": "1" } });
  };
  const helper = load(fetcher, {}, { setTimeout(fn, duration) { scheduledBudget = duration; return setTimeout(fn, 3); } });
  const result = await helper.fetch(imageRequest());
  assert.equal(scheduledBudget, 12000); assert.equal(rangeSignal.aborted, true);
  assert.equal(result.verified, false); assert.equal(fullFetches, 1);
  assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
});

test("ignored-Range full response clears its budget and still honors later original cancellation", async () => {
  const backend = server({ ignoreRange: true }); const owner = new AbortController();
  let scheduled = 0, cleared = 0;
  const helper = load(backend.fetcher, {}, { setTimeout() { scheduled++; return 123; }, clearTimeout(handle) { assert.equal(handle, 123); cleared++; } });
  const result = await helper.fetch(imageRequest(imageUrl, { signal: owner.signal }));
  assert.equal(scheduled, 1); assert.equal(cleared, 1); assert.equal(result.verified, false);
  owner.abort(new DOMException("Owner canceled later", "AbortError"));
  assert.equal(backend.calls[0].init.signal.aborted, true);
  await assert.rejects(result.response.arrayBuffer(), { name: "AbortError" });
  assert.equal(backend.calls.length, 1);
});

test("fallback does not manufacture success when the real full fetch also fails", async () => {
  let count = 0;
  const helper = load(async (_input, init) => { count++; if (init.headers.Range) return new Response(null, { status: 503 }); throw new TypeError("Full fetch unavailable"); });
  await assert.rejects(helper.fetch(imageRequest()), /Full fetch unavailable/);
  assert.equal(count, 2);
});
