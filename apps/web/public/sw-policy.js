(function (scope) {
  "use strict";
  var privatePrefixes = [
    "/api", "/admin", "/account", "/activate-uid", "/friends", "/login", "/member", "/messages",
    "/mentor", "/mentors", "/payment", "/profile", "/recover", "/register", "/rewards", "/tutoring", "/workbench",
  ];
  var assetPrefixes = ["/_next/static/", "/assets/", "/books/", "/figures/", "/figures-v10/", "/source-pages/"];

  function hasPrefix(pathname, prefix) { return pathname === prefix || pathname.indexOf(prefix + "/") === 0; }
  function isPrivate(pathname) { return privatePrefixes.some(function (prefix) { return hasPrefix(pathname, prefix); }); }
  function isPublicNavigation(pathname) { return pathname === "/" || hasPrefix(pathname, "/knowledge"); }
  function isImmutableAsset(pathname) { return assetPrefixes.some(function (prefix) { return pathname.indexOf(prefix) === 0; }); }
  function classify(request) {
    if (!request || request.method !== "GET") return null;
    var url = new URL(request.url);
    if (url.origin !== scope.location.origin || url.search || isPrivate(url.pathname)) return null;
    if (request.mode === "navigate" && isPublicNavigation(url.pathname)) return "navigation";
    if (isImmutableAsset(url.pathname)) return "asset";
    return null;
  }

  scope.WaveKBSW = Object.freeze({ classify: classify });
})(self);
