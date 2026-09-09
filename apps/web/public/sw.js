/* WaveKB service worker: public, account-free caches only. */
importScripts("/sw-policy.js");

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

function cacheable(response) {
  if (!response || !response.ok || response.status !== 200 || response.type !== "basic") return false;
  var cacheControl = response.headers && response.headers.get ? response.headers.get("cache-control") || "" : "";
  var setCookie = response.headers && response.headers.get ? response.headers.get("set-cookie") : null;
  return !setCookie && !/(?:private|no-store)/i.test(cacheControl);
}

async function navigationWithOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return await caches.match(OFFLINE_URL);
  }
}

async function cacheFirst(request) {
  var cached = await caches.match(request);
  if (cached) return cached;
  var response = await fetch(request);
  if (cacheable(response)) {
    var cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", function (event) {
  var strategy = self.WaveKBSW.classify(event.request);
  if (strategy === "navigation") event.respondWith(navigationWithOffline(event.request));
  else if (strategy === "asset") event.respondWith(cacheFirst(event.request));
});
