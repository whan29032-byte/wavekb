import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import tls from "node:tls";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const ROOT = "/srv/wavekb-next-preview";
const VHOSTS = ["/etc/nginx/sites-enabled/elliott-wave", "/etc/nginx/sites-available/elliott-wave"];
const RELEASE_ID = /^[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/;
export const PROBE_BUDGET_MS = 12000;
const LIMIT = 64 * 1024 * 1024;
// Frozen from the original/public bytes in 05af67a5. No runtime discovery,
// environment, URL, body, header, proxy, credential or path overrides in CLI.
export const PUBLIC_ASSETS = Object.freeze([
  { id: "core43_webp", url: "/assets/reading-images/303539f45fd2b726af26648a753b932e369a3a1abf39e8d182ea24c9915f9251.webp", mime: "image/webp", bytes: 404664, sha256: "303539f45fd2b726af26648a753b932e369a3a1abf39e8d182ea24c9915f9251" },
  { id: "natural_p007_png", url: "/assets/books/elliott-wave-natural-law/figure-p007.png", mime: "image/png", bytes: 307214, sha256: "7045761dd02c3239a010ee69162bdc2e0420d2ce30733e10a6ed08878a5e64ef" },
  { id: "source_page057_png", url: "/assets/source-pages/page-057.png", mime: "image/png", bytes: 224086, sha256: "9c13ff5bff6c0cd90c8e71e1ac44e7298f6274909731c08fe6dce8c810a6d7ef" },
  { id: "natural_pdf", url: "/assets/books/elliott-wave-natural-law-distilled.pdf", mime: "application/pdf", bytes: 2565992, sha256: "1f82195dec1e89f9b5012776cc3913daf001bf04f9c077a885618a856b9b226a" },
].map(Object.freeze));
const check = (condition) => { if (!condition) throw new Error("Diagnostic input or source rejected"); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ms = (value) => Number.isFinite(value) ? Math.round(Math.max(0, value) * 100) / 100 : null;
const protocol = (value) => value === "h2" || value === "http/1.1" ? value : "none_or_unknown";

function protectedObject(file, directory, uid) {
  const stat = fs.lstatSync(file);
  check((directory ? stat.isDirectory() : stat.isFile()) && !stat.isSymbolicLink()
    && stat.uid === uid && (stat.mode & 0o022) === 0 && fs.realpathSync(file) === file);
  return stat;
}
function protectedTree(file, root, uid) {
  check(file.startsWith(root + "/"));
  protectedObject(path.dirname(root), true, uid);
  protectedObject(root, true, uid);
  let parent = path.dirname(file);
  while (parent !== root) { protectedObject(parent, true, uid); parent = path.dirname(parent); }
  return protectedObject(file, false, uid);
}
/** Fixture roots/uid are library-only; the CLI uses only the fixed root. */
export function inspectOrigin(releaseId, { root = ROOT, uid = 0 } = {}) {
  check(RELEASE_ID.test(releaseId || ""));
  protectedObject(path.dirname(root), true, uid); protectedObject(root, true, uid);
  const current = path.join(root, "current");
  const link = fs.lstatSync(current); check(link.isSymbolicLink() && link.uid === uid);
  const release = fs.realpathSync(current);
  check(release === path.join(root, "releases", releaseId));
  protectedTree(path.join(release, "DEPLOYMENT_VERSION"), root, uid);
  const version = fs.readFileSync(path.join(release, "DEPLOYMENT_VERSION"), "utf8");
  check(version === releaseId.slice(0, 40) + "\n");
  const assets = PUBLIC_ASSETS.map((asset) => {
    const file = path.join(release, "apps/web/public", asset.url);
    const stat = protectedTree(file, root, uid); check(stat.size > 0 && stat.size <= LIMIT);
    const bytes = fs.readFileSync(file); const sha256 = hash(bytes);
    if (asset.mime === "image/webp") check(sha256 === path.basename(asset.url, ".webp"));
    return { ...asset, bytes: bytes.length, sha256 };
  });
  return { deployment: releaseId.slice(0, 40), assets };
}

/** Safe projection of the fixed vhost only, not a claim about all includes. */
export function nginxProjection({ execute = spawnSync, readVhost } = {}) {
  let version = null, hasHttpV2Module = null, configurationState = "unavailable", listeners = [];
  try {
    const result = execute("/usr/sbin/nginx", ["-V"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000, maxBuffer: 128 * 1024 });
    if (result.status === 0) {
      const text = String(result.stdout) + String(result.stderr);
      version = /nginx version: nginx\/(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\s|$)/.exec(text)?.[1] ?? null;
      hasHttpV2Module = /(?:^|\s)--with-http_v2_module(?:\s|$)/.test(text);
    }
  } catch { /* Never relay command stdout/stderr/errors. */ }
  try {
    let bytes;
    if (readVhost) bytes = readVhost();
    else {
      const file = fs.realpathSync(VHOSTS[0]); check(VHOSTS.includes(file));
      protectedObject(path.dirname(file), true, 0);
      const stat = protectedObject(file, false, 0); check(stat.size < 128 * 1024);
      bytes = fs.readFileSync(file);
    }
    check(Buffer.isBuffer(bytes) && bytes.length < 128 * 1024);
    const text = bytes.toString("utf8"); check(Buffer.from(text).equals(bytes));
    const clean = text.replace(/#[^\n]*/g, "");
    check(/\bserver_name\s+wavekb\.com\s+www\.wavekb\.com\s*;/.test(clean));
    const matches = [...clean.matchAll(/^\s*listen\s+(443|\[::\]:443)\s+([^;\r\n]*);\s*$/gm)];
    check(matches.length === 2 && new Set(matches.map((match) => match[1])).size === 2);
    listeners = matches.map((match) => ({ family: match[1] === "443" ? "ipv4" : "ipv6", ssl: match[2].split(/\s+/).includes("ssl"), http2: match[2].split(/\s+/).includes("http2") })).sort((a, b) => a.family.localeCompare(b.family));
    configurationState = "read";
  } catch { configurationState = "unavailable"; }
  return { version, hasHttpV2Module, configurationState, scope: "fixed_vhost_only", listeners };
}

export function probeAlpn({ connect = tls.connect, setTimer = setTimeout, clearTimer = clearTimeout, clock = () => performance.now() } = {}) {
  const started = clock();
  return new Promise((resolve) => {
    let socket, done = false;
    const finish = (state, selected = "none_or_unknown") => {
      if (done) return; done = true;
      // Timer delivery may be delayed by the event loop; elapsed time still
      // prevents a late secureConnect from becoming a successful observation.
      if (clock() - started >= PROBE_BUDGET_MS) { state = "deadline_exceeded"; selected = "none_or_unknown"; }
      clearTimer(timer); socket?.destroy(); resolve({ state, selected });
    };
    const timer = setTimer(() => finish("deadline_exceeded"), PROBE_BUDGET_MS);
    try {
      // A handshake only: no h2 HTTP frames or asset request on this socket.
      socket = connect({ host: "127.0.0.1", port: 443, servername: "wavekb.com", rejectUnauthorized: true, ALPNProtocols: ["h2", "http/1.1"] });
      socket.once("error", () => finish("tls_error"));
      socket.once("secureConnect", () => finish(socket.authorized ? "read" : "tls_error", socket.authorized ? protocol(socket.alpnProtocol) : "none_or_unknown"));
    } catch { finish("tls_error"); }
  });
}

/** Injected request/timers are test seams only, never CLI inputs. */
export function probeAsset(mode, asset, { request = https.request, setTimer = setTimeout, clearTimer = clearTimeout, clock = () => performance.now() } = {}) {
  check(mode === "origin" || mode === "public");
  check(PUBLIC_ASSETS.some((fixed) => fixed.id === asset.id && fixed.url === asset.url && fixed.mime === asset.mime)
    && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= LIMIT && /^[a-f0-9]{64}$/.test(asset.sha256));
  const started = clock();
  return new Promise((resolve) => {
    let req, response, decoded, done = false, headersAt = null, lastPositive = null, maxGap = 0;
    let status = null, mime = "unknown", encoding = "unknown", contentLength = null, wireBytes = 0, decodedBytes = 0, httpVersion = "unknown", alpn = "none_or_unknown";
    const digest = createHash("sha256");
    const finish = (state, verified = false) => {
      if (done) return; done = true; clearTimer(timer);
      const ended = clock();
      // A completed body can beat an overdue timer callback after an event-loop
      // stall. The same absolute elapsed budget is authoritative at completion.
      if (ended - started >= PROBE_BUDGET_MS) { state = "deadline_exceeded"; verified = false; }
      // Include headers-to-first-positive-byte and the final/timeout idle tail,
      // not just gaps followed by another positive chunk.
      if (headersAt !== null) maxGap = Math.max(maxGap, ended - (lastPositive ?? headersAt));
      req?.destroy(); response?.destroy(); if (decoded !== response) decoded?.destroy();
      resolve({ id: asset.id, state, verified, status, mime, encoding, contentLength, httpVersion, alpn,
        wireBytes, decodedBytes, decodedSha256: verified ? asset.sha256 : null,
        ttfbMs: headersAt === null ? null : ms(headersAt - started), bodyMs: headersAt === null ? null : ms(ended - headersAt),
        totalMs: ms(ended - started), maxPositiveChunkGapMs: ms(maxGap), bodyIdleMs: headersAt === null ? null : ms(ended - (lastPositive ?? headersAt)) });
    };
    // One absolute timer covers DNS/connect/TLS/headers/full body. Never reset,
    // retry, follow redirects, return partial success, or cache the response.
    const timer = setTimer(() => finish("deadline_exceeded"), PROBE_BUDGET_MS);
    try {
      req = request({ hostname: mode === "origin" ? "127.0.0.1" : "wavekb.com", servername: "wavekb.com", port: 443,
        path: asset.url, method: "GET", agent: false, rejectUnauthorized: true, ALPNProtocols: ["http/1.1"],
        headers: { Host: "wavekb.com", "Accept-Encoding": asset.mime === "image/webp" ? "identity" : "gzip", Connection: "close" } }, (incoming) => {
        response = incoming;
        response.once("error", () => finish("invalid_body")); response.once("aborted", () => finish("invalid_body"));
        if (done) { response.destroy(); return; }
        headersAt = clock();
        status = Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null;
        httpVersion = ["1.0", "1.1"].includes(response.httpVersion) ? response.httpVersion : "unknown";
        alpn = protocol(response.socket?.alpnProtocol);
        if (status !== 200) { finish("invalid_status"); return; }
        const type = response.headers["content-type"];
        if (typeof type !== "string" || type.split(";", 1)[0].trim().toLowerCase() !== asset.mime || response.headers["set-cookie"] || response.headers["content-range"]) { finish("invalid_headers"); return; }
        mime = asset.mime;
        const length = response.headers["content-length"];
        if (length !== undefined) {
          if (typeof length !== "string" || !/^\d{1,10}$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > LIMIT) { finish("invalid_headers"); return; }
          contentLength = Number(length);
        }
        const compressed = response.headers["content-encoding"];
        encoding = compressed === undefined || compressed === "identity" ? "identity" : compressed === "gzip" ? "gzip" : "unknown";
        if (encoding === "unknown" || asset.mime === "image/webp" && encoding !== "identity") { finish("invalid_encoding"); return; }
        response.on("data", (chunk) => {
          if (done || !chunk.length) return;
          const at = clock(); maxGap = Math.max(maxGap, at - (lastPositive ?? headersAt)); lastPositive = at;
          wireBytes += chunk.length; if (wireBytes > LIMIT) finish("body_limit_exceeded");
        });
        decoded = encoding === "gzip" ? createGunzip() : response;
        decoded.on("error", () => finish("invalid_body"));
        decoded.on("data", (chunk) => {
          if (done || !chunk.length) return;
          decodedBytes += chunk.length; if (decodedBytes > LIMIT) { finish("body_limit_exceeded"); return; } digest.update(chunk);
        });
        decoded.once("end", () => {
          if (done) return;
          if (!response.complete || contentLength !== null && wireBytes !== contentLength) { finish("invalid_body"); return; }
          const valid = decodedBytes === asset.bytes && digest.digest("hex") === asset.sha256;
          finish(valid ? "complete" : "source_mismatch", valid);
        });
        if (decoded !== response) response.pipe(decoded);
      });
      req.once("error", () => finish("network_error")); req.end();
    } catch { finish("network_error"); }
  });
}

export async function diagnoseKnowledgeTransport(args, { originReader = inspectOrigin, nginxReader = nginxProjection, alpnReader = probeAlpn, assetReader = probeAsset, uid = process.getuid?.() } = {}) {
  const [mode, releaseId] = args;
  check(mode === "public" && args.length === 1 || mode === "origin" && args.length === 2 && RELEASE_ID.test(releaseId));
  let assets = PUBLIC_ASSETS, origin;
  if (mode === "origin") {
    check(uid === 0); origin = originReader(releaseId); assets = origin.assets;
  }
  const result = { mode, probeProtocol: "http/1.1", ...(origin ? { deployment: origin.deployment, nginx: nginxReader(), alpn: await alpnReader() } : {}) };
  result.assets = [];
  for (const asset of assets) result.assets.push(await assetReader(mode, asset));
  if (origin) {
    const final = originReader(releaseId);
    check(final.deployment === origin.deployment && final.assets.length === assets.length
      && final.assets.every((asset, index) => asset.url === assets[index].url && asset.bytes === assets[index].bytes && asset.sha256 === assets[index].sha256));
  }
  result.allAssetsVerified = result.assets.length === 4 && result.assets.every((asset) => asset.verified === true);
  return result;
}

if (process.argv[1] === "-" || process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await diagnoseKnowledgeTransport(process.argv.slice(2)))); }
  catch { console.error("Knowledge transport diagnostic rejected invalid input or unsafe origin state."); process.exitCode = 1; }
}
