/* WaveKB service worker: public, account-free caches only. */
importScripts("/sw-policy.js", "/sw-reading-images.js");

var CACHE_VERSION = "v2";
var SHELL_CACHE = "wavekb-shell-" + CACHE_VERSION;
var ASSET_CACHE = "wavekb-assets-" + CACHE_VERSION;
var OFFLINE_URL = "/offline.html";

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(SHELL_CACHE).then(function (cache) { return cache.addAll([OFFLINE_URL]); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key.indexOf("wavekb-") === 0 && key !== SHELL_CACHE && key !== ASSET_CACHE; }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "wavekb-reading-delivery-ready") return;
  var port = event.ports && event.ports[0];
  var reading = self.WaveKBReadingImages;
  if (!port || typeof port.postMessage !== "function" || !reading
      || typeof reading.canHandle !== "function" || typeof reading.fetch !== "function") return;
  // A public capability acknowledgement only: no identity, credentials,
  // requests or cache mutation. Old same-URL controllers cannot emit this.
  port.postMessage({ version: 2 });
});

function cacheable(response, verified) {
  if (!response || !response.ok || response.status !== 200) return false;
  // Only the reading helper's fully hashed native bytes can authorize caching
  // a constructed Response. Arbitrary/default/opaque responses remain excluded.
  var verifiedBody = verified === true && response.type === "default";
  if (response.type !== "basic" && !verifiedBody) return false;
  var cacheControl = response.headers && response.headers.get ? response.headers.get("cache-control") || "" : "";
  var setCookie = response.headers && response.headers.get ? response.headers.get("set-cookie") : null;
  return !setCookie && !/(?:private|no-store)/i.test(cacheControl)
    && (!verifiedBody || /(?:^|,)\s*public\s*(?:,|$)/i.test(cacheControl));
}

async function navigationWithOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return await caches.match(OFFLINE_URL);
  }
}

function cacheFirst(event) {
  var cacheWrite = Promise.resolve();
  var responsePromise = (async function () {
    var cached = await caches.match(event.request);
    if (cached) return cached;
    var delivery = await self.WaveKBReadingImages.fetch(event.request);
    var response = delivery.response;
    if (cacheable(response, delivery.verified)) {
      // Clone before returning the live body, but never make reading wait for
      // its full consumption and persistence. Cache quota/storage failures
      // must not turn a successful download into an image failure.
      var copy = response.clone();
      cacheWrite = Promise.resolve().then(function () { return caches.open(ASSET_CACHE); })
        .then(function (cache) { return cache.put(event.request, copy); })
        .catch(function () { /* Caching is optional; preserve the network response. */ });
    }
    return response;
  })();
  // Register lifetime extension synchronously while the fetch event is active;
  // keep the optional write alive without delaying respondWith's response.
  event.waitUntil(responsePromise.then(function () { return cacheWrite; }, function () {}));
  return responsePromise;
}

self.addEventListener("fetch", function (event) {
  var strategy = self.WaveKBSW.classify(event.request);
  if (strategy === "navigation") event.respondWith(navigationWithOffline(event.request));
  else if (strategy === "asset") event.respondWith(cacheFirst(event));
});
