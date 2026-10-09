/* A bounded, byte-verifiable fast path for public content-addressed images.
 * Original PNGs, private requests and ordinary browser fetches stay untouched. */
(function installReadingImages(scope) {
  "use strict";

  var MIN_SIZE = 128 * 1024;
  var MAX_SIZE = 2 * 1024 * 1024;
  var MAX_CHUNKS = 4;
  var RANGE_BUDGET_MS = 12000;
  var PATH = /^\/assets\/reading-images\/([a-f0-9]{64})\.webp$/;
  // Keep image operations in request order, not probe-completion order: a
  // cached neighbor's quick probe must not overtake the first requested image.
  // The second pool still bounds every Range through its complete 206 body.
  var imagePool = fifoPool(1);
  var rangePool = fifoPool(MAX_CHUNKS);

  function fifoPool(limit) {
    var active = 0;
    var queue = [];
    function drain() {
      while (active < limit && queue.length) {
        var entry = queue.shift();
        entry.signal.removeEventListener("abort", entry.onAbort);
        if (entry.signal.aborted) { entry.reject(abortReason(entry.signal)); continue; }
        active++;
        entry.resolve(makeRelease());
      }
    }
    function makeRelease() {
      var released = false;
      return function () {
        if (released) return;
        released = true;
        active--;
        drain();
      };
    }
    return { acquire: function (signal) {
      return new Promise(function (resolve, reject) {
        if (signal.aborted) { reject(abortReason(signal)); return; }
        var entry = { signal: signal, resolve: resolve, reject: reject, onAbort: null };
        entry.onAbort = function () {
          var index = queue.indexOf(entry);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
        queue.push(entry);
        drain();
      });
    } };
  }

  async function rangeTask(operation, task) {
    var release = await rangePool.acquire(operation.signal);
    try {
      if (operation.signal.aborted) throw abortReason(operation.signal);
      return await task();
    } catch (error) {
      // Abort only this image before releasing, so failed siblings cannot take
      // queued slots ahead of another image. Other image operations survive.
      operation.abort();
      throw error;
    } finally { release(); }
  }

  function eligibleUrl(request) {
    try {
      var url = new URL(request.url);
      if (request.method !== "GET" || request.destination !== "image" || url.origin !== scope.location.origin
        || url.search || url.hash || url.username || url.password || !PATH.test(url.pathname)
        || request.headers.has("Range") || request.headers.has("Authorization") || request.headers.has("Proxy-Authorization") || request.headers.has("Cookie")) return null;
      return url;
    } catch { return null; }
  }

  function publicOptions(signal, range) {
    return { method: "GET", mode: "same-origin", credentials: "omit", redirect: "error", cache: range ? "no-store" : "default",
      headers: range ? { Range: range } : {}, signal: signal };
  }

  function abortReason(signal) {
    return signal.reason || new DOMException("The image request was aborted", "AbortError");
  }

  function rangeOperation(originalSignal) {
    var controller = new AbortController();
    var onAbort = function () { controller.abort(abortReason(originalSignal)); };
    if (originalSignal.aborted) onAbort();
    else originalSignal.addEventListener("abort", onAbort, { once: true });
    var timer = setTimeout(function () { controller.abort(new DOMException("Reading image range budget exceeded", "TimeoutError")); }, RANGE_BUDGET_MS);
    return { signal: controller.signal,
      abort: function () { controller.abort(); },
      clearDeadline: function () { clearTimeout(timer); },
      dispose: function () { clearTimeout(timer); originalSignal.removeEventListener("abort", onAbort); } };
  }

  function validateRange(response, url, start, end, total) {
    if (response.status !== 206 || response.redirected || (response.url && response.url !== url.href)
      || !/^image\/webp(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "")
      || /(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(response.headers.get("Cache-Control") || "")
      || response.headers.has("Set-Cookie")) throw new Error("Invalid public reading image partial response");
    var match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") || "");
    if (!match || Number(match[1]) !== start || Number(match[2]) !== end
      || (total !== undefined && Number(match[3]) !== total) || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= end) {
      throw new Error("Reading image Content-Range mismatch");
    }
    var contentLength = response.headers.get("Content-Length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== end - start + 1)) throw new Error("Reading image partial length mismatch");
    return Number(match[3]);
  }

  async function readExact(response, length) {
    if (!response.body) throw new Error("Missing reading image partial body");
    var reader = response.body.getReader();
    var bytes = new Uint8Array(length);
    var offset = 0;
    try {
      while (true) {
        var item = await reader.read();
        if (item.done) break;
        if (!item.value || offset + item.value.byteLength > length) throw new Error("Oversized reading image partial body");
        bytes.set(item.value, offset);
        offset += item.value.byteLength;
      }
      if (offset !== length) throw new Error("Truncated reading image partial body");
      return bytes;
    } catch (error) {
      // Cancellation must not create a second unbounded wait before fallback.
      reader.cancel().catch(function () { /* Abort already canceled it. */ });
      throw error;
    } finally { reader.releaseLock(); }
  }

  async function download(request) {
    var url = eligibleUrl(request);
    if (!url || !scope.crypto || !scope.crypto.subtle || typeof scope.crypto.subtle.digest !== "function") {
      return { response: await fetch(request), verified: false };
    }
    var operation = rangeOperation(request.signal);
    var releaseImage = null;
    var forwarded = false;
    try {
      releaseImage = await imagePool.acquire(operation.signal);
      if (operation.signal.aborted) throw abortReason(operation.signal);
      var probeResult = await rangeTask(operation, async function () {
        var probe = await fetch(url.href, publicOptions(operation.signal, "bytes=0-0"));
        if (probe.status === 200 && !probe.redirected && (!probe.url || probe.url === url.href)) {
          // Do not time out a legitimate, forwarded full body after its headers.
          // Keep original cancellation linked until the real fetch is collected.
          operation.clearDeadline();
          forwarded = true;
          return { response: probe };
        }
        var size = validateRange(probe, url, 0, 0);
        if (size < MIN_SIZE || size > MAX_SIZE) throw new Error("Reading image outside bounded range size");
        await readExact(probe, 1);
        return { size: size };
      });
      if (probeResult.response) return { response: probeResult.response, verified: false };
      var size = probeResult.size;
      var chunkSize = Math.ceil(size / MAX_CHUNKS);
      var chunks = await Promise.all(Array.from({ length: MAX_CHUNKS }, async function (_, index) {
        var start = index * chunkSize;
        var end = Math.min(size - 1, start + chunkSize - 1);
        return rangeTask(operation, async function () {
          var response = await fetch(url.href, publicOptions(operation.signal, "bytes=" + start + "-" + end));
          validateRange(response, url, start, end, size);
          return { start: start, bytes: await readExact(response, end - start + 1) };
        });
      }));
      var complete = new Uint8Array(size);
      chunks.forEach(function (chunk) { complete.set(chunk.bytes, chunk.start); });
      if (operation.signal.aborted) throw abortReason(operation.signal);
      var digest = new Uint8Array(await scope.crypto.subtle.digest("SHA-256", complete));
      var hex = Array.from(digest, function (value) { return value.toString(16).padStart(2, "0"); }).join("");
      if (hex !== PATH.exec(url.pathname)[1]) throw new Error("Reading image full SHA-256 mismatch");
      if (operation.signal.aborted) throw abortReason(operation.signal);
      return { response: new Response(complete, { status: 200, headers: {
        "Content-Type": "image/webp", "Content-Length": String(size), "Cache-Control": "public, max-age=31536000, immutable",
      } }), verified: true };
    } catch {
      operation.abort(); // Cancel every outstanding chunk before one full fetch.
      operation.dispose();
      if (releaseImage) { releaseImage(); releaseImage = null; }
      if (request.signal.aborted) throw abortReason(request.signal);
      return { response: await fetch(url.href, publicOptions(request.signal)), verified: false };
    } finally {
      if (releaseImage) releaseImage();
      if (!forwarded) operation.dispose();
    }
  }

  scope.WaveKBReadingImages = Object.freeze({ canHandle: function (request) { return Boolean(eligibleUrl(request)); }, fetch: download });
})(self);
