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
const neighborBytes = await sharp(fs.readFileSync(path.join(root, "assets/books/elliott-wave-natural-law/figure-p005.png"))).webp({ lossless: true, effort: 6 }).toBuffer();
const neighborDigest = createHash("sha256").update(neighborBytes).digest("hex");
const neighborUrl = `${origin}/assets/reading-images/${neighborDigest}.webp`;
const script = fs.readFileSync(path.join(root, "apps/web/public/sw-reading-images.js"), "utf8");
const sizeHints = Object.freeze({ [digest]: bytes.length, [neighborDigest]: neighborBytes.length });

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

function concurrentImageServer({ failFirstImage = false, slowFirstProbe = false } = {}) {
  const data = new Map([[imageUrl, bytes], [neighborUrl, neighborBytes]]);
  const calls = [];
  let active = 0, maximum = 0;
  const fetcher = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const range = new Headers(init.headers).get("Range");
    const original = data.get(url);
    calls.push({ url, range, signal: init.signal });
    if (!range) return streamedResponse(original, { "Content-Type": "image/webp", "Content-Length": String(original.length) }, 200, init.signal);
    if (init.signal.aborted) throw init.signal.reason;
    const [, low, high] = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(low), end = Number(high), isProbe = start === 0 && end === 0;
    const body = original.subarray(start, end + 1);
    let sent = false, finished = false;
    active++; maximum = Math.max(active, maximum);
    const finish = () => { if (!finished) { finished = true; active--; } };
    const stream = new ReadableStream({
      start(controller) {
        init.signal.addEventListener("abort", () => { if (!finished) { finish(); controller.error(init.signal.reason); } }, { once: true });
      },
      async pull(controller) {
        // Headers are immediate, while each complete body takes two pulls. The
        // counter therefore exposes any premature slot release at headers.
        const probeDelay = slowFirstProbe ? (url === imageUrl ? 7 : 1) : (url === imageUrl ? 2 : 5);
        await new Promise((resolve) => setTimeout(resolve, isProbe ? probeDelay : 8));
        if (finished) return;
        if (sent) { finish(); controller.close(); } else { sent = true; controller.enqueue(body); }
      },
      cancel() { finish(); },
    });
    const wrong = failFirstImage && url === imageUrl && !isProbe && start === 0;
    return new Response(stream, { status: 206, headers: { "Content-Type": "image/webp", "Content-Length": String(body.length),
      "Content-Range": `bytes ${wrong ? start + 1 : start}-${end}/${original.length}` } });
  };
  return { fetcher, calls, get maximum() { return maximum; }, get active() { return active; } };
}

test("two different real images share four FIFO slots through full body reads and preserve both SHA values", async () => {
  const backend = concurrentImageServer(); const helper = load(backend.fetcher);
  const [first, neighbor] = await Promise.all([helper.fetch(imageRequest()), helper.fetch(imageRequest(neighborUrl))]);
  assert.equal(first.verified, true); assert.equal(neighbor.verified, true);
  assert.deepEqual(Buffer.from(await first.response.arrayBuffer()), bytes);
  assert.deepEqual(Buffer.from(await neighbor.response.arrayBuffer()), neighborBytes);
  assert.equal(backend.maximum, 4); assert.equal(backend.active, 0);
  const parts = backend.calls.filter((call) => call.range && call.range !== "bytes=0-0");
  assert.deepEqual(parts.slice(0, 4).map((call) => call.url), Array(4).fill(imageUrl));
  assert.deepEqual(parts.slice(4).map((call) => call.url), Array(4).fill(neighborUrl));
});

function heldProbeServer() {
  const backend = server(); const calls = [];
  const fetcher = async (input, init = {}) => {
    const range = new Headers(init.headers).get("Range");
    calls.push({ input, init, range });
    if (range && calls.filter((call) => call.range).length <= 1) {
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(Uint8Array.of(bytes[0]));
        init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
      } }), { status: 206, headers: { "Content-Type": "image/webp", "Content-Length": "1", "Content-Range": `bytes 0-0/${bytes.length}` } });
    }
    return backend.fetcher(input, init);
  };
  return { fetcher, calls };
}

test("a queued owner cancellation removes its task immediately without starting fetch or leaking the next slot", async () => {
  const backend = heldProbeServer(); const helper = load(backend.fetcher);
  const owners = Array.from({ length: 1 }, () => new AbortController());
  const blocking = owners.map((owner) => helper.fetch(imageRequest(imageUrl, { signal: owner.signal })));
  const settled = Promise.allSettled(blocking);
  const canceled = new AbortController();
  const queued = helper.fetch(imageRequest(imageUrl, { signal: canceled.signal }));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(backend.calls.length, 1, "the first image probe body, not just headers, must retain its image lease");
    canceled.abort(new DOMException("Queued request canceled", "AbortError"));
    await assert.rejects(queued, { name: "AbortError" });
    assert.equal(backend.calls.length, 1);
    const survivor = helper.fetch(imageRequest());
    owners.forEach((owner) => owner.abort());
    await settled;
    const result = await survivor;
    assert.equal(result.verified, true); assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
    assert.equal(backend.calls.filter((call) => !call.range).length, 0);
  } finally { owners.forEach((owner) => owner.abort()); await settled; }
});

test("the unchanged twelve-second budget includes FIFO waiting and expires only its own task", async () => {
  const backend = heldProbeServer(); const budgets = [];
  const helper = load(backend.fetcher, {}, { setTimeout(fn, duration) { assert.equal(duration, 12000); budgets.push(fn); return budgets.length; }, clearTimeout() {} });
  const owners = Array.from({ length: 1 }, () => new AbortController());
  const blocking = owners.map((owner) => helper.fetch(imageRequest(imageUrl, { signal: owner.signal })));
  const settled = Promise.allSettled(blocking);
  const queued = helper.fetch(imageRequest());
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(backend.calls.length, 1);
    budgets[1]();
    const result = await queued;
    assert.equal(result.verified, false); assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
    assert.equal(backend.calls.filter((call) => !call.range).length, 1);
    assert.equal(backend.calls.slice(0, 1).every((call) => !call.init.signal.aborted), true);
    const survivor = helper.fetch(imageRequest());
    owners.forEach((owner) => owner.abort()); await settled;
    assert.equal((await survivor).verified, true);
  } finally { owners.forEach((owner) => owner.abort()); await settled; }
});

test("a failed image releases and cancels only its own slots while the neighboring real image verifies normally", async () => {
  const backend = concurrentImageServer({ failFirstImage: true }); const helper = load(backend.fetcher);
  const [failed, survivor] = await Promise.all([helper.fetch(imageRequest()), helper.fetch(imageRequest(neighborUrl))]);
  assert.equal(failed.verified, false); assert.equal(survivor.verified, true);
  assert.deepEqual(Buffer.from(await failed.response.arrayBuffer()), bytes);
  assert.deepEqual(Buffer.from(await survivor.response.arrayBuffer()), neighborBytes);
  assert.equal(backend.maximum <= 4, true); assert.equal(backend.active, 0);
  assert.equal(backend.calls.filter((call) => !call.range).length, 1);
  assert.equal(backend.calls.filter((call) => call.url === neighborUrl).every((call) => !call.signal.aborted), true);
  // No leaked slot may prevent a subsequent valid first-image request.
  assert.equal((await helper.fetch(imageRequest(neighborUrl))).verified, true);
});

test("ignored-Range real 200 releases its FIFO slot at headers without truncating the still-open body", async () => {
  let activeHeaders = 0, maximum = 0, calls = 0;
  const owners = Array.from({ length: 5 }, () => new AbortController());
  const helper = load(async (_input, init) => {
    calls++; activeHeaders++; maximum = Math.max(maximum, activeHeaders);
    await new Promise((resolve) => setTimeout(resolve, 3)); activeHeaders--;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(bytes[0]));
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
      // The legitimate forwarded body remains open after its headers.
    } }), { status: 200, headers: { "Content-Type": "image/webp" } });
  });
  try {
    const results = await Promise.all(owners.map((owner) => helper.fetch(imageRequest(imageUrl, { signal: owner.signal }))));
    assert.equal(calls, 5); assert.equal(maximum, 1);
    assert.equal(results.every((result) => result.verified === false && result.response.status === 200), true);
    assert.equal(owners.every((owner) => !owner.signal.aborted), true);
    owners.forEach((owner) => owner.abort());
    await Promise.all(results.map((result) => assert.rejects(result.response.arrayBuffer(), { name: "AbortError" })));
  } finally { owners.forEach((owner) => owner.abort()); }
});

test("first image operation completes before a neighboring image even when its probe is much slower", async () => {
  const backend = concurrentImageServer({ slowFirstProbe: true }); const helper = load(backend.fetcher);
  const completed = [];
  const [first, neighbor] = await Promise.all([
    helper.fetch(imageRequest()).then((result) => { completed.push("first"); return result; }),
    helper.fetch(imageRequest(neighborUrl)).then((result) => { completed.push("neighbor"); return result; }),
  ]);
  assert.deepEqual(completed, ["first", "neighbor"]);
  assert.equal(first.verified, true); assert.equal(neighbor.verified, true);
  assert.deepEqual(Buffer.from(await first.response.arrayBuffer()), bytes);
  assert.deepEqual(Buffer.from(await neighbor.response.arrayBuffer()), neighborBytes);
  assert.deepEqual(backend.calls.slice(0, 5).map((call) => call.url), Array(5).fill(imageUrl));
  assert.deepEqual(backend.calls.slice(5).map((call) => call.url), Array(5).fill(neighborUrl));
  assert.equal(backend.maximum, 4); assert.equal(backend.active, 0);
});

test("trusted frozen build sizes skip the probe and verify all four real ranges with native dimensions", async () => {
  const backend = server(); const helper = load(backend.fetcher, { WaveKBReadingImageSizes: sizeHints });
  const result = await helper.fetch(imageRequest(), "tab-a");
  assert.equal(result.verified, true); assert.equal(backend.calls.length, 4);
  assert.equal(backend.calls.some((call) => call.range === "bytes=0-0"), false);
  assert.equal(backend.maximum, 4);
  const complete = Buffer.from(await result.response.arrayBuffer());
  assert.deepEqual(complete, bytes);
  assert.equal(createHash("sha256").update(complete).digest("hex"), digest);
  const metadata = await sharp(complete).metadata();
  assert.equal(metadata.width, 1191); assert.equal(metadata.height, 1755);
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 0, "completed operations must not leak into the cancellation registry");
});

test("known small or oversized public images bypass both shared pools and preserve the original real request", async () => {
  for (const size of [1024, 2 * 1024 * 1024 + 1]) {
    const backend = server(); const request = imageRequest();
    const helper = load(backend.fetcher, { WaveKBReadingImageSizes: Object.freeze({ [digest]: size }) });
    const result = await helper.fetch(request, "tab-a");
    assert.equal(result.verified, false); assert.equal(backend.calls.length, 1);
    assert.equal(backend.calls[0].input, request); assert.deepEqual(backend.calls[0].init, {});
    assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
  }
});

test("mutable, inherited, missing or invalid size hints cannot suppress the real bounded probe", async () => {
  for (const hints of [{ [digest]: bytes.length }, Object.freeze(Object.create({ [digest]: bytes.length })),
    Object.freeze({}), Object.freeze({ [digest]: String(bytes.length) }), Object.freeze({ [digest]: 1.5 }), Object.freeze({ [digest]: -1 })]) {
    const backend = server(); const result = await load(backend.fetcher, { WaveKBReadingImageSizes: hints }).fetch(imageRequest());
    assert.equal(result.verified, true); assert.equal(backend.calls.length, 5);
    assert.equal(backend.calls[0].range, "bytes=0-0");
    assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
  }
});

for (const options of [{ wrongTotal: true }, { wrongRange: true }, { wrongLength: true }, { corrupt: true }, { truncate: true }, { oversize: true }]) {
  test(`known build size never relaxes partial/real SHA validation ${JSON.stringify(options)}`, async () => {
    const backend = server(options); const helper = load(backend.fetcher, { WaveKBReadingImageSizes: sizeHints });
    const result = await helper.fetch(imageRequest());
    assert.equal(result.verified, false);
    assert.equal(backend.calls.filter((call) => !call.range).length, 1);
    assert.equal(backend.calls.filter((call) => call.range).length <= 4, true);
    assert.equal(backend.calls.filter((call) => call.range).every((call) => call.init.signal.aborted), true);
    assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
  });
}

test("known-size ignored Range selects one genuine long 200, aborts siblings and never starts a fallback", async () => {
  const owner = new AbortController(); const calls = [], timers = [];
  let cleared = 0;
  const helper = load(async (_input, init) => {
    const call = { init, canceled: false }; calls.push(call);
    call.response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(bytes[0]));
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
    }, cancel() { call.canceled = true; } }), { status: 200, headers: { "Content-Type": "image/webp", "Content-Length": String(bytes.length) } });
    return call.response;
  }, { WaveKBReadingImageSizes: sizeHints }, { setTimeout(fn, ms) { assert.equal(ms, 12000); timers.push(fn); return timers.length; }, clearTimeout() { cleared++; } });
  const result = await helper.fetch(imageRequest(imageUrl, { signal: owner.signal }), "tab-a");
  assert.equal(result.verified, false); assert.equal(result.response, calls[0].response);
  assert.equal(calls.length, 4); assert.equal(cleared, 1);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(calls.slice(1).every((call) => call.init.signal.aborted), true);
  assert.equal(calls.every((call) => new Headers(call.init.headers).has("Range")), true);
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 0);
  owner.abort(new DOMException("Owner canceled the real forwarded body", "AbortError"));
  assert.equal(calls[0].init.signal.aborted, true);
  await assert.rejects(result.response.arrayBuffer(), { name: "AbortError" });
});

test("known-size ignored Range forwards exact real 200 bytes and releases the next image lease", async () => {
  const backend = concurrentImageServer(); const ignored = server({ ignoreRange: true });
  const fetcher = (input, init) => (input === imageUrl ? ignored.fetcher(input, init) : backend.fetcher(input, init));
  const helper = load(fetcher, { WaveKBReadingImageSizes: sizeHints });
  const [first, neighbor] = await Promise.all([helper.fetch(imageRequest()), helper.fetch(imageRequest(neighborUrl))]);
  assert.equal(first.verified, false); assert.equal(neighbor.verified, true);
  assert.deepEqual(Buffer.from(await first.response.arrayBuffer()), bytes);
  assert.deepEqual(Buffer.from(await neighbor.response.arrayBuffer()), neighborBytes);
  assert.equal(ignored.calls.length, 4); assert.equal(ignored.calls.filter((call) => !call.range).length, 0);
  assert.equal(backend.calls.length, 4); assert.equal(backend.maximum, 4); assert.equal(backend.active, 0);
});

for (const unsafe of [{ "Content-Type": "text/html" }, { "Cache-Control": "private" }, { "Set-Cookie": "not-public=1" },
  { "Content-Range": `bytes 0-101165/${bytes.length}` }, { "Content-Length": String(bytes.length - 1) }]) {
  test(`known-size ignored Range cannot forward an unsafe or partial-looking 200 ${JSON.stringify(unsafe)}`, async () => {
    const backend = server(); const calls = [];
    const helper = load(async (input, init) => {
      calls.push(init);
      if (!new Headers(init.headers).has("Range")) return backend.fetcher(input, init);
      return streamedResponse(bytes, { "Content-Type": "image/webp", "Content-Length": String(bytes.length), ...unsafe }, 200, init.signal);
    }, { WaveKBReadingImageSizes: sizeHints });
    const result = await helper.fetch(imageRequest());
    assert.equal(result.verified, false); assert.equal(calls.filter((init) => !new Headers(init.headers).has("Range")).length, 1);
    assert.equal(calls.filter((init) => new Headers(init.headers).has("Range")).every((init) => init.signal.aborted), true);
    assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
  });
}

test("known-size four body reads still share the unchanged twelve-second queue/body deadline", async () => {
  const backend = server(); const calls = []; let deadline;
  const helper = load(async (input, init) => {
    calls.push(init);
    const range = new Headers(init.headers).get("Range");
    if (!range) return backend.fetcher(input, init);
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range);
    return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
    } }), { status: 206, headers: { "Content-Type": "image/webp", "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
  }, { WaveKBReadingImageSizes: sizeHints }, { setTimeout(fn, ms) { assert.equal(ms, 12000); deadline = fn; return 1; }, clearTimeout() {} });
  const pending = helper.fetch(imageRequest());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 4); deadline();
  const result = await pending;
  assert.equal(result.verified, false); assert.equal(calls.length, 5);
  assert.equal(calls.slice(0, 4).every((init) => init.signal.aborted), true);
  assert.deepEqual(Buffer.from(await result.response.arrayBuffer()), bytes);
});

test("hidden-image cancellation aborts only this client's active and queued identical path, without fallback or leaked slots", async () => {
  const backend = concurrentImageServer(); const helper = load(backend.fetcher, { WaveKBReadingImageSizes: sizeHints });
  const active = helper.fetch(imageRequest(), "tab-a");
  const queued = helper.fetch(imageRequest(), "tab-a");
  const otherTab = helper.fetch(imageRequest(), "tab-b");
  const otherImage = helper.fetch(imageRequest(neighborUrl), "tab-a");
  const canceled = Promise.allSettled([active, queued]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backend.calls.length, 4);
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 2);
  const outcomes = await canceled;
  assert.equal(outcomes.every((outcome) => outcome.status === "rejected" && outcome.reason.name === "AbortError"), true);
  const [survivor, neighbor] = await Promise.all([otherTab, otherImage]);
  assert.equal(survivor.verified, true); assert.equal(neighbor.verified, true);
  assert.deepEqual(Buffer.from(await survivor.response.arrayBuffer()), bytes);
  assert.deepEqual(Buffer.from(await neighbor.response.arrayBuffer()), neighborBytes);
  assert.equal(backend.calls.filter((call) => !call.range).length, 0);
  assert.equal(backend.calls.length, 12); assert.equal(backend.maximum, 4); assert.equal(backend.active, 0);
  assert.equal(backend.calls.slice(0, 4).every((call) => call.signal.aborted), true);
  assert.equal(backend.calls.slice(4).every((call) => !call.signal.aborted), true);
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 0);
});

test("cancel rejects absent clients, other tabs, other paths, full URLs, query strings and malformed hashes", async () => {
  const backend = concurrentImageServer(); const helper = load(backend.fetcher, { WaveKBReadingImageSizes: sizeHints });
  const pending = helper.fetch(imageRequest(), "tab-a");
  await new Promise((resolve) => setImmediate(resolve));
  for (const [client, pathname] of [["", new URL(imageUrl).pathname], [undefined, new URL(imageUrl).pathname], ["tab-b", new URL(imageUrl).pathname],
    ["tab-a", new URL(neighborUrl).pathname], ["tab-a", imageUrl], ["tab-a", new URL(imageUrl).pathname + "?x=1"], ["tab-a", "/assets/reading-images/nohash.webp"]]) {
    assert.equal(helper.cancel(client, pathname), 0);
  }
  assert.equal((await pending).verified, true); assert.equal(backend.calls.length, 4);
  assert.equal(backend.calls.every((call) => !call.signal.aborted), true);
});

test("unknown-size queued hidden-image cancellation makes no probe or fallback and leaves the other client untouched", async () => {
  const backend = heldProbeServer(); const owner = new AbortController(); const helper = load(backend.fetcher);
  const blocker = helper.fetch(imageRequest(imageUrl, { signal: owner.signal }), "tab-b");
  const blockerDone = Promise.allSettled([blocker]);
  const queued = helper.fetch(imageRequest(), "tab-a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 1);
  await assert.rejects(queued, { name: "AbortError" });
  assert.equal(backend.calls.length, 1); assert.equal(owner.signal.aborted, false);
  owner.abort(); await blockerDone;
  const survivor = await helper.fetch(imageRequest(), "tab-a");
  assert.equal(survivor.verified, true); assert.deepEqual(Buffer.from(await survivor.response.arrayBuffer()), bytes);
  assert.equal(backend.calls.filter((call) => !call.range).length, 0);
});

test("a view cancellation during the single real fallback's pending headers aborts it rather than retrying", async () => {
  let fallbackStarted; const began = new Promise((resolve) => { fallbackStarted = resolve; }); const calls = [];
  const helper = load(async (_input, init) => {
    calls.push(init);
    if (new Headers(init.headers).has("Range")) return new Response(null, { status: 503 });
    fallbackStarted();
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) { reject(init.signal.reason); return; }
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  }, { WaveKBReadingImageSizes: sizeHints });
  const pending = helper.fetch(imageRequest(), "tab-a");
  await began;
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 1);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls.filter((init) => !new Headers(init.headers).has("Range")).length, 1);
  assert.equal(calls.every((init) => init.signal.aborted), true);
  assert.equal(helper.cancel("tab-a", new URL(imageUrl).pathname), 0);
});
