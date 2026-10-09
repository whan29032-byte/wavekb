import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";

// This runner has no host/path/credential override. Its only write target is
// the exact vhost audited in read-only Actions run 37887955912.
const enabledFile = "/etc/nginx/sites-enabled/elliott-wave";
const allowedFiles = [enabledFile, "/etc/nginx/sites-available/elliott-wave"];
const current = "/srv/wavekb-next-preview/current";
const publicRoot = `${current}/apps/web/public`;
const stateRoot = "/var/lib/wavekb-knowledge-static-delivery";
const idPattern = /^[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
class ControlledFailure extends Error {}
const requireValue = (condition, message) => { if (!condition) throw new ControlledFailure(message); };
const failureDetail = (error) => error instanceof ControlledFailure ? error.message
  : ["EACCES", "EPERM", "ENOENT", "EEXIST", "EINVAL", "EIO", "ENOSPC", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET"].includes(error?.code)
    ? error.code : "failed; underlying values omitted";
async function atStage(stage, action) {
  try { return await action(); }
  catch (error) { throw new ControlledFailure(`${stage}: ${failureDetail(error)}`); }
}
const begin = "# BEGIN WAVEKB KNOWLEDGE STATIC DELIVERY v1";
const end = "# END WAVEKB KNOWLEDGE STATIC DELIVERY v1";
const security = `        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;`;

export function staticLocations(root = publicRoot) {
  requireValue(/^\/[A-Za-z0-9_./-]+$/.test(root) && !root.split("/").includes(".."), "Unsupported static root");
  const delivery = `        root ${root};
        try_files $uri =404;
        disable_symlinks on from=${root};
        sendfile on;
        sendfile_max_chunk 256k;
        tcp_nopush on;
        types { image/png png; application/pdf pdf; image/webp webp; }
        default_type application/octet-stream;
        gzip on;
        gzip_vary on;
        gzip_min_length 1024;
        gzip_comp_level 6;
        gzip_types application/pdf image/png;
        if ($http_range != "") { gzip off; }
${security}`;
  return String.raw`
    ${begin}
    location ~ "^/assets/reading-images/[a-f0-9]{64}\.webp$" {
${delivery}
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location ~ "^/assets/(?:books|source-pages|figures|figures-v10|reading-images)/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|pdf|webp)$" {
${delivery}
        add_header Cache-Control "public, max-age=0";
    }
    ${end}
`;
}

const audited = `server {
listen [::]:443 ssl ipv6only=on; listen 443 ssl; server_name wavekb.com www.wavekb.com;
if ($host = www.wavekb.com) { return 301 https://wavekb.com$request_uri; }
ssl_certificate /etc/letsencrypt/live/wavekb.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/wavekb.com/privkey.pem;
include /etc/letsencrypt/options-ssl-nginx.conf; ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
charset utf-8; server_tokens off; client_max_body_size 20m;
gzip on; gzip_vary on; gzip_min_length 1024;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
location /v1/ {
client_max_body_size 12m; proxy_pass http://127.0.0.1:8787; proxy_http_version 1.1;
proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 5s; proxy_read_timeout 120s; proxy_send_timeout 120s;
proxy_buffering off; add_header Cache-Control "no-store" always;
}
location / {
proxy_pass http://127.0.0.1:3100; proxy_http_version 1.1;
proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $connection_upgrade;
proxy_connect_timeout 5s; proxy_read_timeout 120s; proxy_send_timeout 120s; proxy_buffering off;
}
}
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
if ($host = www.wavekb.com) { return 301 https://wavekb.com$request_uri; }
if ($host = wavekb.com) { return 301 https://wavekb.com$request_uri; }
listen 80 default_server; listen [::]:80 default_server;
server_name wavekb.com www.wavekb.com; return 404;
}`;

function tokens(text) {
  return [...text.matchAll(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};#]+/g)].filter((match) => !match[0].startsWith("#"));
}
function normalized(text) { return tokens(text).map((token) => token[0]).join(" "); }

export function buildCandidate(input) {
  requireValue(Buffer.isBuffer(input) && input.length > 0 && input.length < 128 * 1024, "Unsupported vhost bytes");
  const text = input.toString("utf8");
  requireValue(Buffer.from(text).equals(input), "Unsupported vhost encoding");
  const managed = text.includes(begin) || text.includes(end);
  let original = text;
  if (managed) {
    requireValue(text.split(begin).length === 2 && text.split(end).length === 2 && text.includes(staticLocations()), "Changed managed static shape");
    original = text.replace(staticLocations(), "");
  }
  requireValue(normalized(original) === normalized(audited), "Unsupported production vhost shape; stop before writes");
  const parts = tokens(original); let depth = 0, closing;
  for (const token of parts) {
    if (token[0] === "{") depth++;
    if (token[0] === "}" && --depth === 0) { closing = token.index; break; }
  }
  requireValue(Number.isInteger(closing), "Unsupported HTTPS server shape");
  const candidate = Buffer.from(original.slice(0, closing) + staticLocations() + original.slice(closing));
  if (managed) requireValue(candidate.equals(input), "Changed managed bytes require operator review");
  return { bytes: candidate, original: Buffer.from(original), managed };
}

export function validateVersion(output) {
  const version = /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(output);
  requireValue(version && (Number(version[1]) > 1 || Number(version[1]) === 1 && Number(version[2]) >= 18), "Unsupported Nginx version");
  return version.slice(1).join(".");
}

function validateState(saved, id) {
  requireValue(saved?.state?.schema === 1 && saved.state.id === id && allowedFiles.includes(saved.state.realFile)
    && /^(prepared|installing|applied|rolling_back|rolled_back|rollback_failed)$/.test(saved.state.phase)
    && /^[a-f0-9]{40}$/.test(saved.state.deployment)
    && Number.isInteger(saved.state.mode) && saved.state.mode >= 0 && saved.state.mode <= 0o777 && (saved.state.mode & 0o022) === 0
    && saved.state.uid === 0 && Number.isInteger(saved.state.gid) && saved.state.gid >= 0
    && sha(saved.backup) === saved.state.originalHash && buildCandidate(saved.backup).managed === false
    && sha(buildCandidate(saved.backup).bytes) === saved.state.candidateHash, "Invalid exact rollback state");
}

export async function runTransaction({ mode = "audit", id } = {}, runtime) {
  requireValue(["audit", "apply", "rollback"].includes(mode), "Unsupported mode");
  if (mode !== "audit") requireValue(idPattern.test(id || ""), "Invalid transaction identity");
  // Restoration must not depend on the candidate route still being healthy:
  // inspect(rollback) reads the fixed target/identity only, without nginx -T,
  // successful health or public responses as prerequisites.
  const context = await runtime.inspect(mode);
  if (mode === "audit") {
    const candidate = buildCandidate(context.bytes);
    await runtime.verify(context); return { mode, managed: candidate.managed, deployment: context.deployment };
  }
  const saved = await runtime.readState(id);
  if (saved) validateState(saved, id);
  if (mode === "apply" && saved) {
    requireValue(saved.state.phase === "applied" && sha(context.bytes) === saved.state.candidateHash
      && context.realFile === saved.state.realFile && context.deployment === saved.state.deployment, "Existing transaction phase or target changed");
    await runtime.verify(context); return { mode, phase: "applied", id, deployment: context.deployment, idempotent: true };
  }
  if (mode === "rollback") {
    requireValue(saved, "Rollback state is missing");
    const state = saved.state;
    requireValue(context.realFile === state.realFile && context.mode === state.mode && context.uid === state.uid && context.gid === state.gid, "Rollback target or permissions changed");
    const presentHash = sha(context.bytes);
    requireValue(presentHash === state.candidateHash || presentHash === state.originalHash, "Foreign configuration changed; refuse overwrite");
    const alreadyVerified = state.phase === "rolled_back" && presentHash === state.originalHash;
    let restored = presentHash === state.originalHash;
    try {
      if (!alreadyVerified) {
        state.phase = "rolling_back"; await atStage("rollback_save", () => runtime.save(id, state));
        if (!restored) { await atStage("rollback_install", () => runtime.install(saved.backup, state.candidateHash)); restored = true; }
      }
      await atStage("rollback_nginx_test", () => runtime.test());
      if (!alreadyVerified) await atStage("rollback_reload", () => runtime.reload());
      await atStage("rollback_public_proof", () => runtime.verify(context));
      if (!alreadyVerified) { state.phase = "rolled_back"; await runtime.save(id, state); }
      return { mode, phase: "rolled_back", id, deployment: context.deployment, idempotent: alreadyVerified };
    } catch (error) {
      state.phase = "rollback_failed"; await runtime.save(id, state);
      throw new ControlledFailure(`${restored ? "Exact vhost bytes restored; Nginx recovery verification failed, rollback may be retried" : "Exact rollback installation failed; operator review is required"} (${failureDetail(error)})`);
    }
  }
  const candidate = buildCandidate(context.bytes);
  requireValue(!candidate.managed, "Existing managed delivery belongs to another transaction");
  // Audit every existing route/body before creating a durable write transaction.
  // The same verification runs after reload and after any restoration.
  await runtime.verify(context);
  const state = { schema: 1, id, phase: "prepared", realFile: context.realFile, deployment: context.deployment,
    originalHash: sha(context.bytes), candidateHash: sha(candidate.bytes), mode: context.mode, uid: context.uid, gid: context.gid };
  await runtime.prepare(id, state, context.bytes);
  try {
    state.phase = "installing"; await atStage("apply_save", () => runtime.save(id, state));
    await atStage("apply_install", () => runtime.install(candidate.bytes, state.originalHash));
    await atStage("apply_nginx_test", () => runtime.test());
    await atStage("apply_reload", () => runtime.reload());
    await atStage("apply_public_proof", () => runtime.verify(context));
    state.phase = "applied"; await runtime.save(id, state);
    return { mode, phase: state.phase, id, deployment: context.deployment };
  } catch (error) {
    try {
      await atStage("recovery_install", () => runtime.install(context.bytes, state.candidateHash));
      await atStage("recovery_nginx_test", () => runtime.test());
      await atStage("recovery_reload", () => runtime.reload());
      await atStage("recovery_public_proof", () => runtime.verify(context));
      state.phase = "rolled_back"; await runtime.save(id, state);
    } catch (recoveryError) {
      state.phase = "rollback_failed"; await runtime.save(id, state);
      throw new ControlledFailure(`Static delivery failed (${failureDetail(error)}); exact rollback needs operator review (${failureDetail(recoveryError)})`);
    }
    throw new ControlledFailure(`Static delivery failed; exact rollback verified (${failureDetail(error)})`);
  }
}

// Explicit loopback transport ignores all proxy environment variables. TLS
// still verifies the canonical host certificate, not a user-supplied endpoint.
export async function requestSnapshot(url, options = {}) {
  // Only repeat idempotent read-only probes after a transport reset/refusal.
  // Each attempt starts new bytes/digest and a fresh connection; assertions
  // about HTTP status, source bytes and permissions are never retried here.
  const deadline = Date.now() + 120000;
  for (let attempt = 0; attempt < 3; attempt++) {
    requireValue(Date.now() < deadline, "Public probe budget exceeded");
    try { return await requestSnapshotOnce(url, options, deadline); }
    catch (error) {
      const retryable = ["ECONNRESET", "ECONNREFUSED"].includes(error?.code);
      if (retryable) requireValue(Date.now() < deadline, "Public probe budget exceeded");
      if (attempt === 2 || !retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (attempt + 1), Math.max(0, deadline - Date.now()))));
    }
  }
}

function requestSnapshotOnce(url, { port = 443, tls = true, headers = {} } = {}, deadline) {
  requireValue(typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !/[\r\n]/.test(url), "Invalid probe path");
  requireValue(Date.now() < deadline, "Public probe budget exceeded");
  return new Promise((resolve, reject) => {
    const transport = tls ? https : http;
    // Nginx graceful reload retires old idle sockets. Never reuse a global
    // agent connection from before reload, including the prior proof request.
    const request = transport.request({ hostname: "127.0.0.1", servername: "wavekb.com", port, path: url, method: "GET", agent: false, headers: { Host: "wavekb.com", ...headers, Connection: "close" } });
    const timer = setTimeout(() => request.destroy(new ControlledFailure("Public probe budget exceeded")), Math.max(1, deadline - Date.now()));
    request.on("error", (error) => { clearTimeout(timer); reject(error); });
    request.on("response", (response) => {
      let size = 0, wireSize = 0, sample = Buffer.alloc(0); const digest = createHash("sha256");
      const decoded = response.headers["content-encoding"] === "gzip" ? response.pipe(createGunzip()) : response;
      response.on("data", (chunk) => { wireSize += chunk.length; if (wireSize > 64 * 1024 * 1024) request.destroy(new Error("Probe wire limit exceeded")); });
      response.on("error", (error) => { clearTimeout(timer); request.destroy(); reject(error); });
      decoded.on("error", (error) => { clearTimeout(timer); request.destroy(); reject(error); });
      decoded.on("data", (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) { request.destroy(new Error("Probe decoded limit exceeded")); return; }
        digest.update(chunk); if (sample.length < 65536) sample = Buffer.concat([sample, chunk.subarray(0, 65536 - sample.length)]);
      });
      decoded.on("end", () => { clearTimeout(timer); resolve({ status: response.statusCode, headers: response.headers, size, wireSize, sample, sha256: digest.digest("hex") }); });
    });
    request.end();
  });
}

function command(binary, args, timeout = 30000) {
  try { return execFileSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new ControlledFailure(`Production ${path.basename(binary)} ${args[0]} command failed (exit ${Number.isInteger(error.status) ? error.status : "unknown"}); output values omitted`); }
}

export function nginxWorkerIds(output) {
  const ids = output.split("\n").flatMap((line) => {
    const match = /^\s*([1-9][0-9]*)\s+nginx: worker process(?: \(nginx\))?\s*$/.exec(line);
    return match ? [Number(match[1])] : [];
  });
  requireValue(ids.every(Number.isSafeInteger) && new Set(ids).size === ids.length, "Unknown Nginx worker identity");
  return ids.sort((a, b) => a - b);
}

export async function waitForNginxGeneration(before, readSnapshot) {
  requireValue(before && Number.isSafeInteger(before.master) && before.master > 0 && Array.isArray(before.workers) && before.workers.length > 0
    && before.workers.every((pid) => Number.isSafeInteger(pid) && pid > 0)
    && new Set(before.workers).size === before.workers.length, "Unknown original Nginx generation");
  const deadline = Date.now() + 2000;
  let ready = null;
  while (Date.now() < deadline) {
    const next = await readSnapshot(deadline - Date.now());
    requireValue(next && next.master === before.master, "Nginx master changed during reload");
    requireValue(Array.isArray(next.workers) && next.workers.every((pid) => Number.isSafeInteger(pid) && pid > 0)
      && new Set(next.workers).size === next.workers.length, "Unknown new Nginx generation");
    const replaced = next.workers.length === before.workers.length
      && next.workers.every((pid) => !before.workers.includes(pid));
    const identity = [...next.workers].sort((a, b) => a - b).join(",");
    if (Date.now() < deadline && replaced && ready === identity) return;
    ready = replaced ? identity : null;
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
  }
  throw new ControlledFailure("Nginx new worker generation was not ready within the fixed reload budget");
}

function nginxGeneration(budget = 1000) {
  requireValue(budget > 0, "Nginx generation metadata budget exceeded");
  const deadline = Date.now() + Math.min(1000, budget);
  const timeout = () => {
    const remaining = deadline - Date.now();
    requireValue(remaining > 0, "Nginx generation metadata budget exceeded");
    return Math.max(1, Math.min(500, remaining));
  };
  const master = command("/usr/bin/systemctl", ["show", "nginx", "-p", "MainPID", "--value"], timeout()).trim();
  requireValue(/^[1-9][0-9]*$/.test(master) && Number.isSafeInteger(Number(master)), "Unknown Nginx master identity");
  const workers = nginxWorkerIds(command("/usr/bin/ps", ["--ppid", master, "-ww", "-o", "pid=,args="], timeout()));
  return { master: Number(master), workers };
}
function secureDirectory(directory) {
  const stat = fs.lstatSync(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(directory) === directory && stat.uid === 0 && (stat.mode & 0o077) === 0, "Unsafe transaction state directory");
}
function durableWrite(file, bytes, mode = 0o600) {
  const fd = fs.openSync(file, "wx", mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(directory) { const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function statePaths(id) {
  requireValue(idPattern.test(id), "Invalid transaction identity");
  const directory = `${stateRoot}/${id}`;
  return { directory, state: `${directory}/state.json`, backup: `${directory}/previous.conf` };
}
function safeStateFile(file) {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0, "Unsafe durable transaction file");
}

export function productionRuntime(transactionId) {
  requireValue(process.getuid?.() === 0, "Production transaction must run as root");
  let inspected;
  const runtime = {
    async inspect(mode) {
      const realFile = fs.realpathSync(enabledFile); requireValue(allowedFiles.includes(realFile), "Unknown resolved vhost file");
      const stat = fs.lstatSync(realFile); requireValue(stat.isFile() && stat.uid === 0 && (stat.mode & 0o022) === 0, "Unsafe production vhost permissions");
      const bytes = fs.readFileSync(realFile);
      requireValue(fs.lstatSync(current).isSymbolicLink(), "Current release is not managed");
      const release = fs.realpathSync(current);
      requireValue(path.dirname(release) === "/srv/wavekb-next-preview/releases" && idPattern.test(path.basename(release)), "Unknown current release path");
      const deployment = fs.readFileSync(`${release}/DEPLOYMENT_VERSION`, "utf8").trim();
      requireValue(/^[a-f0-9]{40}$/.test(deployment) && path.basename(release).startsWith(`${deployment}-`), "Unknown current deployment identity");
      inspected = { bytes, realFile, mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid, deployment, publicRoot, release };
      if (mode === "rollback") return inspected;
      buildCandidate(bytes);
      const dump = command("/usr/sbin/nginx", ["-T"]);
      const sections = [...dump.matchAll(/^# configuration file ([^\n]+):\n([\s\S]*?)(?=^# configuration file |$(?![\s\S]))/gm)];
      const matches = sections.filter((section) => /\bserver_name\s+wavekb\.com(?:\s|;)/.test(section[2]));
      requireValue(matches.length === 1 && matches[0][1] === enabledFile, "Ambiguous or unknown production vhost file");
      // nginx -V writes successful version/module output to stderr.
      const versionRun = spawnSync("/usr/sbin/nginx", ["-V"], { encoding: "utf8", timeout: 30000 });
      requireValue(versionRun.status === 0, "Nginx version command failed");
      const versionOutput = versionRun.stdout + versionRun.stderr;
      validateVersion(versionOutput);
      requireValue(!/--without-http(?:_gzip|_rewrite|_headers|_charset)?(?:_module)?(?:\s|$)/.test(versionOutput), "Missing required Nginx capability");
      requireValue(command("/usr/bin/systemctl", ["is-active", "nginx"]).trim() === "active"
        && command("/usr/bin/systemctl", ["is-active", "wavekb-next-preview.service"]).trim() === "active", "Production services must already be active");
      requireValue(command("/usr/bin/systemctl", ["show", "wavekb-next-preview.service", "-p", "WorkingDirectory", "--value"]).trim() === current, "Unexpected Next working directory");
      const health = await requestSnapshot("/api/health", { tls: false, port: 3100 });
      requireValue(health.status === 200 && JSON.parse(health.sample).ok === true && JSON.parse(health.sample).deployment === deployment, "Current health/version mismatch");
      const users = [...dump.matchAll(/^\s*user\s+([a-z_][a-z0-9_-]*)(?:\s+[a-z_][a-z0-9_-]*)?;\s*$/gm)];
      requireValue(users.length === 1 && users[0][1] !== "root", "Unknown Nginx worker identity");
      for (const url of ["/assets/figures-v10/page-043.png", "/assets/books/elliott-wave-natural-law-distilled.pdf",
        "/assets/reading-images/303539f45fd2b726af26648a753b932e369a3a1abf39e8d182ea24c9915f9251.webp"]) {
        const file = path.join(release, "apps/web/public", url);
        await fileIdentity(`${release}/apps/web/public`, url);
        command("/usr/sbin/runuser", ["-u", users[0][1], "--", "/usr/bin/test", "-r", file]);
      }
      return inspected;
    },
    async readState(id) {
      const p = statePaths(id);
      if (!fs.existsSync(stateRoot)) return null;
      secureDirectory(stateRoot); if (!fs.existsSync(p.directory)) return null;
      secureDirectory(p.directory); safeStateFile(p.state); safeStateFile(p.backup);
      return { state: JSON.parse(fs.readFileSync(p.state, "utf8")), backup: fs.readFileSync(p.backup) };
    },
    async prepare(id, state, bytes) {
      if (!fs.existsSync(stateRoot)) fs.mkdirSync(stateRoot, { mode: 0o700 });
      secureDirectory(stateRoot); const p = statePaths(id);
      fs.mkdirSync(p.directory, { mode: 0o700 }); secureDirectory(p.directory);
      durableWrite(p.backup, bytes); durableWrite(p.state, JSON.stringify(state) + "\n"); syncDirectory(p.directory); syncDirectory(stateRoot);
    },
    async save(id, state) {
      const p = statePaths(id); secureDirectory(p.directory); safeStateFile(p.state);
      // A killed pre-rename writer must not make recovery impossible because
      // its old .new file exists. Never overwrite or trust that orphan.
      const temporary = `${p.state}.${randomBytes(8).toString("hex")}.new`;
      durableWrite(temporary, JSON.stringify(state) + "\n"); fs.renameSync(temporary, p.state); syncDirectory(p.directory);
    },
    async install(bytes, expected) {
      requireValue(inspected && allowedFiles.includes(inspected.realFile) && fs.realpathSync(enabledFile) === inspected.realFile, "Production config target changed");
      const present = fs.readFileSync(inspected.realFile);
      if (sha(present) === sha(bytes)) return;
      requireValue(sha(present) === expected, "Foreign config changed; refuse overwrite");
      const temporary = `${inspected.realFile}.knowledge-${transactionId}-${randomBytes(8).toString("hex")}.new`;
      durableWrite(temporary, bytes, inspected.mode); fs.chownSync(temporary, inspected.uid, inspected.gid); fs.chmodSync(temporary, inspected.mode);
      fs.renameSync(temporary, inspected.realFile); syncDirectory(path.dirname(inspected.realFile));
    },
    async test() { command("/usr/sbin/nginx", ["-t"]); },
    async reload() {
      const before = nginxGeneration();
      requireValue(before.workers.length > 0, "No current Nginx workers were detected before reload");
      command("/usr/bin/systemctl", ["reload", "nginx"]);
      await waitForNginxGeneration(before, nginxGeneration);
    },
    async verify(context) { await verifyPublicDelivery(context); },
  };
  return runtime;
}

async function fileIdentity(root, url) {
  const file = path.join(root, url);
  requireValue(fs.realpathSync(file) === file && fs.lstatSync(file).isFile(), "Public source must be an existing regular non-symlink file");
  fs.accessSync(file, fs.constants.R_OK);
  const data = fs.readFileSync(file); return { size: data.length, sha256: sha(data), partial: data.subarray(17, 81) };
}

async function verifyPublicDelivery(context) {
  requireValue(fs.realpathSync(current) === context.release, "Current release changed during static transaction");
  const health = await requestSnapshot("/api/health");
  requireValue(health.status === 200 && JSON.parse(health.sample).deployment === context.deployment, "Canonical health/version mismatch");
  const assets = [["/assets/figures-v10/page-043.png", "image/png", false],
    ["/assets/books/elliott-wave-natural-law-distilled.pdf", "application/pdf", false],
    ["/assets/reading-images/303539f45fd2b726af26648a753b932e369a3a1abf39e8d182ea24c9915f9251.webp", "image/webp", true]];
  const realizedRoot = `${context.release}/apps/web/public`;
  const managed = buildCandidate(fs.readFileSync(context.realFile)).managed;
  for (const [url, mime, immutable] of assets) {
    const source = await fileIdentity(realizedRoot, url);
    context.sourceProof ||= {};
    const previous = context.sourceProof[url];
    requireValue(!previous || previous.size === source.size && previous.sha256 === source.sha256, "Public source changed during static transaction");
    context.sourceProof[url] = { size: source.size, sha256: source.sha256 };
    for (const encoding of ["identity", "gzip"]) {
      const full = await requestSnapshot(url, { headers: { "Accept-Encoding": encoding } });
      requireValue(full.status === 200 && full.size === source.size && full.sha256 === source.sha256
        && full.headers["content-type"]?.startsWith(mime), "Full public source byte/MIME proof failed");
      if (managed && encoding === "gzip" && mime !== "image/webp") {
        const compressed = full.headers["content-encoding"] === "gzip";
        const receivedEncoding = !full.headers["content-encoding"] ? "none"
          : ["gzip", "identity"].includes(full.headers["content-encoding"]) ? full.headers["content-encoding"] : "other";
        requireValue(compressed && full.wireSize < source.size,
          `Transparent source gzip proof failed (${mime}; encoding=${receivedEncoding}; wire=${full.wireSize}; decoded=${full.size}; source=${source.size})`);
      }
      requireValue(full.headers["cache-control"] === (immutable ? "public, max-age=31536000, immutable" : "public, max-age=0"), "Public source cache policy changed");
      for (const [header, value] of [["x-content-type-options", "nosniff"], ["referrer-policy", "strict-origin-when-cross-origin"],
        ["x-frame-options", "SAMEORIGIN"], ["permissions-policy", "camera=(), microphone=(), geolocation=()"]]) {
        requireValue(full.headers[header] === value, "Public security header changed");
      }
      const partial = await requestSnapshot(url, { headers: { Range: "bytes=17-80", "Accept-Encoding": encoding } });
      requireValue(partial.status === 206 && partial.headers["content-range"] === `bytes 17-80/${source.size}`
        && partial.headers["content-type"]?.startsWith(mime) && partial.headers["content-length"] === "64"
        && !partial.headers["content-encoding"] && partial.size === 64 && partial.sample.equals(source.partial), "Public 206 original byte proof failed");
    }
  }
  const missing = await requestSnapshot(`/assets/reading-images/${randomBytes(32).toString("hex")}.webp`);
  requireValue(missing.status === 404 && !/immutable/.test(missing.headers["cache-control"] || "") && missing.headers["x-content-type-options"] === "nosniff", "Missing content-addressed image must not be immutable");
  const privateRoute = await requestSnapshot("/api/member/friends");
  requireValue(privateRoute.status === 401 && privateRoute.headers["cache-control"] === "no-store", "Anonymous private API protection changed");
  const html = await requestSnapshot("/knowledge/books");
  requireValue(html.status === 200 && html.headers["content-type"]?.startsWith("text/html") && !/immutable/.test(html.headers["cache-control"] || ""), "Public HTML routing changed");
}

if (process.argv[1] === "-" || process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || "audit", id = process.argv[3];
  try {
    requireValue(process.argv.length <= 4, "No host/file/path overrides are allowed");
    const result = await runTransaction({ mode, id }, productionRuntime(id));
    console.log(JSON.stringify(result));
  } catch (error) { console.error(failureDetail(error)); process.exitCode = 1; }
}
