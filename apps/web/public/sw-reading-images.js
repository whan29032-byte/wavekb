/* A bounded, byte-verifiable fast path for public content-addressed images.
 * Original PNGs, private requests and ordinary browser fetches stay untouched. */
(function installReadingImages(scope) {
  "use strict";

  var MIN_SIZE = 128 * 1024;
  var MAX_SIZE = 2 * 1024 * 1024;
  var MAX_CHUNKS = 4;
  var RANGE_BUDGET_MS = 12000;
  var STRAGGLER_IDLE_MS = 750;
  var PATH = /^\/assets\/reading-images\/([a-f0-9]{64})\.webp$/;
  // Keep image operations in request order, not probe-completion order: a
  // cached neighbor's quick probe must not overtake the first requested image.
  // The second pool still bounds every Range through its complete 206 body.
  var imagePool = fifoPool(1);
  var rangePool = fifoPool(MAX_CHUNKS);
  var operations = new Set();

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

  async function rangeTask(operation, task, signal, attempt) {
    signal = signal || operation.signal;
    var release = await rangePool.acquire(signal);
    try {
      if (signal.aborted) throw abortReason(signal);
      return await task();
    } catch (error) {
      // Abort only this image before releasing, so failed siblings cannot take
      // queued slots ahead of another image. Other image operations survive.
      var recovering = attempt && attempt.recoveryReason && error === attempt.recoveryReason
        && signal.reason === attempt.recoveryReason && !operation.signal.aborted;
      if (!operation.forwarded && !recovering) operation.abort();
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

  function rangeOperation(originalSignal, budget) {
    var controller = new AbortController();
    var onAbort = function () { controller.abort(abortReason(originalSignal)); };
    if (originalSignal.aborted) onAbort();
    else originalSignal.addEventListener("abort", onAbort, { once: true });
    var timer = budget === false ? null : setTimeout(function () { controller.abort(new DOMException("Reading image range budget exceeded", "TimeoutError")); }, RANGE_BUDGET_MS);
    return { signal: controller.signal, forwarded: false, viewCanceled: false,
      abort: function (reason) { controller.abort(reason); },
      clearDeadline: function () { if (timer !== null) clearTimeout(timer); },
      dispose: function () { if (timer !== null) clearTimeout(timer); originalSignal.removeEventListener("abort", onAbort); } };
  }

  function childAttempt(operation) {
    var controller = new AbortController();
    var onAbort = function () { controller.abort(abortReason(operation.signal)); };
    if (operation.signal.aborted) onAbort();
    else operation.signal.addEventListener("abort", onAbort, { once: true });
    return { controller: controller, recoveryReason: null, valid: false, lastProgress: 0,
      dispose: function () { operation.signal.removeEventListener("abort", onAbort); } };
  }

  function stragglerRecovery(operation, parts) {
    var timer = null, spent = false, stopped = false;
    function now() { return scope.performance && typeof scope.performance.now === "function" ? scope.performance.now() : Date.now(); }
    function clear() { if (timer !== null) { clearTimeout(timer); timer = null; } }
    function schedule() {
      clear();
      if (stopped || spent || operation.signal.aborted || operation.forwarded
        || parts.filter(function (part) { return part.complete; }).length !== MAX_CHUNKS - 1) return;
      var part = parts.find(function (entry) { return !entry.complete; });
      var attempt = part.attempt;
      if (!attempt.valid || attempt.controller.signal.aborted) return;
      timer = setTimeout(function () {
        timer = null;
        if (stopped || spent || operation.signal.aborted || operation.forwarded || part.complete || part.attempt !== attempt) return;
        if (now() - attempt.lastProgress < STRAGGLER_IDLE_MS) { schedule(); return; }
        spent = true;
        // Only this private identity may bypass rangeTask's fatal error path.
        attempt.recoveryReason = new DOMException("Recovering one stalled reading image range", "AbortError");
        attempt.controller.abort(attempt.recoveryReason);
      }, Math.max(0, STRAGGLER_IDLE_MS - (now() - attempt.lastProgress)));
    }
    function stop() { stopped = true; clear(); operation.signal.removeEventListener("abort", stop); }
    operation.signal.addEventListener("abort", stop, { once: true });
    return { progress: function (part, attempt) {
      if (part.attempt !== attempt || stopped) return;
      attempt.valid = true; attempt.lastProgress = now(); schedule();
    }, complete: function (part, attempt) {
      if (part.attempt !== attempt || stopped) return;
      part.complete = true; schedule();
    }, stop: stop };
  }

  function trustedSize(url) {
    var sizes = scope.WaveKBReadingImageSizes;
    var hash = PATH.exec(url.pathname)[1];
    if (!sizes || !Object.isFrozen(sizes) || !Object.prototype.hasOwnProperty.call(sizes, hash)) return undefined;
    var size = sizes[hash];
    return Number.isSafeInteger(size) && size > 0 ? size : undefined;
  }

  function publicImage(response, url) {
    return !response.redirected && (!response.url || response.url === url.href)
      && /^image\/webp(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "")
      && !/(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(response.headers.get("Cache-Control") || "")
      && !response.headers.has("Set-Cookie");
  }

  function fullImage(response, url, size) {
    if (response.status !== 200 || !publicImage(response, url) || response.headers.has("Content-Range")) return false;
    var length = response.headers.get("Content-Length");
    return length === null || (/^\d+$/.test(length) && (size === undefined || Number(length) === size));
  }

  function validateRange(response, url, start, end, total) {
    if (response.status !== 206 || !publicImage(response, url)) throw new Error("Invalid public reading image partial response");
    var match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") || "");
    if (!match || Number(match[1]) !== start || Number(match[2]) !== end
      || (total !== undefined && Number(match[3]) !== total) || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= end) {
      throw new Error("Reading image Content-Range mismatch");
    }
    var contentLength = response.headers.get("Content-Length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== end - start + 1)) throw new Error("Reading image partial length mismatch");
    return Number(match[3]);
  }

  async function readExact(response, length, attempt, operation, onProgress) {
    if (!response.body) throw new Error("Missing reading image partial body");
    var reader = response.body.getReader();
    var bytes = new Uint8Array(length);
    var offset = 0;
    var cancelRead = function () { reader.cancel().catch(function () { /* The pending read must settle before its slot releases. */ }); };
    if (attempt) {
      attempt.controller.signal.addEventListener("abort", cancelRead, { once: true });
      operation.signal.addEventListener("abort", cancelRead, { once: true });
    }
    try {
      while (true) {
        var item = await reader.read();
        if (operation && operation.signal.aborted) throw abortReason(operation.signal);
        if (attempt && attempt.controller.signal.aborted) throw abortReason(attempt.controller.signal);
        if (item.done) break;
        if (!item.value || offset + item.value.byteLength > length) throw new Error("Oversized reading image partial body");
        bytes.set(item.value, offset);
        offset += item.value.byteLength;
        if (item.value.byteLength && onProgress) onProgress();
      }
      if (offset !== length) throw new Error("Truncated reading image partial body");
      return bytes;
    } catch (error) {
      // Cancellation must not create a second unbounded wait before fallback.
      reader.cancel().catch(function () { /* Abort already canceled it. */ });
      if (operation && operation.signal.aborted) throw abortReason(operation.signal);
      if (attempt && attempt.recoveryReason && attempt.controller.signal.reason === attempt.recoveryReason) throw attempt.recoveryReason;
      throw error;
    } finally {
      if (attempt) {
        attempt.controller.signal.removeEventListener("abort", cancelRead);
        operation.signal.removeEventListener("abort", cancelRead);
      }
      reader.releaseLock();
    }
  }

  async function download(request, clientId) {
    var url = eligibleUrl(request);
    if (!url || !scope.crypto || !scope.crypto.subtle || typeof scope.crypto.subtle.digest !== "function") {
      return { response: await fetch(request), verified: false };
    }
    var size = trustedSize(url);
    // The build-verified size map is the only hint source. Small/public images
    // need no probe or shared image lease; preserve their ordinary real fetch.
    if (size !== undefined && (size < MIN_SIZE || size > MAX_SIZE)) {
      return { response: await fetch(request), verified: false };
    }
    var operation = rangeOperation(request.signal);
    operation.clientId = typeof clientId === "string" ? clientId : null;
    operation.path = url.pathname;
    operations.add(operation);
    var releaseImage = null;
    var forwarded = false;
    try {
      releaseImage = await imagePool.acquire(operation.signal);
      if (operation.signal.aborted) throw abortReason(operation.signal);
      if (size === undefined) {
        var probeResult = await rangeTask(operation, async function () {
          var probe = await fetch(url.href, publicOptions(operation.signal, "bytes=0-0"));
          if (operation.signal.aborted) {
            if (probe.body) probe.body.cancel().catch(function () {});
            throw abortReason(operation.signal);
          }
          if (fullImage(probe, url)) {
            // Do not time out a legitimate, forwarded full body after its headers.
            // Keep original cancellation linked until the real fetch is collected.
            operation.clearDeadline();
            operation.forwarded = true;
            forwarded = true;
            return { response: probe };
          }
          var probedSize = validateRange(probe, url, 0, 0);
          if (probedSize < MIN_SIZE || probedSize > MAX_SIZE) throw new Error("Reading image outside bounded range size");
          await readExact(probe, 1);
          return { size: probedSize };
        });
        if (operation.signal.aborted) throw abortReason(operation.signal);
        if (probeResult.response) return { response: probeResult.response, verified: false };
        size = probeResult.size;
      }
      var chunkSize = Math.ceil(size / MAX_CHUNKS);
      var parts = Array.from({ length: MAX_CHUNKS }, function () {
        return { attempt: childAttempt(operation), complete: false };
      });
      var recovery = stragglerRecovery(operation, parts);
      var forwardResponse;
      var forwardedResponse = new Promise(function (resolve) { forwardResponse = resolve; });
      var chunksPromise = Promise.all(parts.map(async function (part, index) {
        var start = index * chunkSize;
        var end = Math.min(size - 1, start + chunkSize - 1);
        while (true) {
          var attempt = part.attempt;
          try {
            var chunk = await rangeTask(operation, async function () {
              var response = await fetch(url.href, publicOptions(attempt.controller.signal, "bytes=" + start + "-" + end));
              if (attempt.controller.signal.aborted) {
                if (response.body) response.body.cancel().catch(function () {});
                throw abortReason(attempt.controller.signal);
              }
              if (fullImage(response, url, size)) {
                if (!operation.forwarded) {
                  operation.forwarded = true;
                  operation.clearDeadline();
                  recovery.stop();
                  parts.forEach(function (sibling) {
                    if (sibling !== part) { sibling.attempt.controller.abort(); sibling.attempt.dispose(); }
                  });
                  forwardResponse({ response: response });
                } else if (response.body) {
                  response.body.cancel().catch(function () { /* Superseded fetch was already aborted. */ });
                }
                return null;
              }
              validateRange(response, url, start, end, size);
              recovery.progress(part, attempt); // Valid headers start body-idle timing.
              return { start: start, bytes: await readExact(response, end - start + 1, attempt, operation, function () { recovery.progress(part, attempt); }) };
            }, attempt.controller.signal, attempt);
            if (chunk) recovery.complete(part, attempt);
            return chunk;
          } catch (error) {
            if (!attempt.recoveryReason || error !== attempt.recoveryReason || operation.signal.aborted || operation.forwarded) throw error;
            // Awaited rangeTask has settled the old read and released its slot.
            // Keep the image lease and absolute operation deadline unchanged.
            attempt.dispose();
            part.attempt = childAttempt(operation);
          } finally {
            // A forwarded real 200 retains its original cancellation link.
            if (attempt.controller.signal.aborted) attempt.dispose();
          }
        }
      }));
      var outcome = await Promise.race([chunksPromise, forwardedResponse]);
      if (operation.signal.aborted) throw abortReason(operation.signal);
      if (outcome.response) {
        forwarded = true;
        return { response: outcome.response, verified: false };
      }
      var chunks = outcome;
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
      if (operation.viewCanceled) throw abortReason(operation.signal);
      if (request.signal.aborted) throw abortReason(request.signal);
      // Keep the one ordinary fallback cancelable while its headers are still
      // pending, without imposing a range deadline on its legitimate full body.
      operations.delete(operation);
      operation = rangeOperation(request.signal, false);
      operation.clientId = typeof clientId === "string" ? clientId : null;
      operation.path = url.pathname;
      operations.add(operation);
      var fallback = await fetch(url.href, publicOptions(operation.signal));
      forwarded = true;
      return { response: fallback, verified: false };
    } finally {
      operations.delete(operation);
      if (recovery) recovery.stop();
      if (parts) parts.forEach(function (part) {
        if (!forwarded || part.attempt.controller.signal.aborted) part.attempt.dispose();
      });
      if (releaseImage) releaseImage();
      if (!forwarded) operation.dispose();
    }
  }

  function cancel(clientId, path) {
    if (typeof clientId !== "string" || !clientId || typeof path !== "string" || !PATH.test(path)) return 0;
    var canceled = 0;
    operations.forEach(function (operation) {
      if (operation.clientId !== clientId || operation.path !== path || operation.viewCanceled) return;
      operation.viewCanceled = true;
      operation.abort(new DOMException("Reading image left this client's viewport", "AbortError"));
      canceled++;
    });
    return canceled;
  }

  scope.WaveKBReadingImages = Object.freeze({ canHandle: function (request) { return Boolean(eligibleUrl(request)); }, fetch: download, cancel: cancel });
})(self);
