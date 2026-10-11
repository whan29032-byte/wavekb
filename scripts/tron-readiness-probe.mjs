import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

export const TRON_READINESS_TIMEOUT_MS = 8000;
export const TRON_READINESS_MAX_BYTES = 2 * 1024 * 1024;
export const TRON_READINESS_MAX_AGE_MS = 5 * 60 * 1000;
export const TRON_READINESS_FUTURE_SKEW_MS = 60 * 1000;
const ENDPOINT = "https://api.trongrid.io/walletsolidity/getnowblock";
const reasons = new Set(["ready", "timeout", "rate_limited", "unauthenticated_rejected", "http_unavailable", "network_unavailable",
  "invalid_response", "response_too_large", "invalid_solidified_head", "stale_solidified_head", "future_solidified_head", "server_probe_unavailable"]);

function result(reason) {
  return { tron_readiness: { ready: reason === "ready", reason, authConfigured: false,
    authentication: "unauthenticated", rateLimitRisk: true, scope: "fixed_solidified_head_only" } };
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function inspectTronSolidifiedHead(value, now = Date.now()) {
  if (!object(value) || !object(value.block_header) || !object(value.block_header.raw_data)) return "invalid_solidified_head";
  const { number, timestamp } = value.block_header.raw_data;
  if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(timestamp) || timestamp < 1
    || !Number.isSafeInteger(now) || now < 1 || typeof value.blockID !== "string" || !/^[a-f0-9]{64}$/i.test(value.blockID)
    || BigInt(`0x${value.blockID.slice(0, 16)}`) !== BigInt(number)) return "invalid_solidified_head";
  if (timestamp > now + TRON_READINESS_FUTURE_SKEW_MS) return "future_solidified_head";
  if (now - timestamp > TRON_READINESS_MAX_AGE_MS) return "stale_solidified_head";
  return "ready";
}

// One fixed, unauthenticated read. Test seams cannot be supplied by CLI, env,
// workflow inputs, invoices or wallets. This never imports a verification worker.
export async function probeTronReadiness({ fetch: fetcher = globalThis.fetch, now = Date.now,
  clock = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController();
  const started = clock();
  let reader;
  const expired = () => controller.signal.aborted || clock() - started >= TRON_READINESS_TIMEOUT_MS;
  const cancel = (body) => {
    try { Promise.resolve(reader ? reader.cancel() : body?.cancel()).catch(() => undefined); } catch { /* Do not relay transport details. */ }
  };
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimer(() => { controller.abort(); cancel(); resolve(result("timeout")); }, TRON_READINESS_TIMEOUT_MS);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetcher(ENDPOINT, { method: "POST", body: "{}", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json", "accept-encoding": "identity" }, signal: controller.signal });
      if (expired()) { cancel(response.body); return result("timeout"); }
      if (response.status !== 200) {
        cancel(response.body);
        return result(response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "unauthenticated_rejected" : "http_unavailable");
      }
      if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") || "") || !response.body
        || ![null, "identity"].includes(response.headers.get("content-encoding"))) {
        cancel(response.body); return result("invalid_response");
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && !/^(?:0|[1-9][0-9]*)$/.test(declared)) { cancel(response.body); return result("invalid_response"); }
      if (declared !== null && BigInt(declared) > BigInt(TRON_READINESS_MAX_BYTES)) { cancel(response.body); return result("response_too_large"); }
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const next = await reader.read();
        if (expired()) { cancel(); return result("timeout"); }
        if (next.done) break;
        size += next.value.byteLength;
        if (size > TRON_READINESS_MAX_BYTES) { cancel(); return result("response_too_large"); }
        chunks.push(next.value);
      }
      if (declared !== null && BigInt(declared) !== BigInt(size)) return result("invalid_response");
      let parsed;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return result("invalid_response"); }
      if (expired()) return result("timeout");
      return result(inspectTronSolidifiedHead(parsed, now()));
    } catch {
      return result(expired() ? "timeout" : "network_unavailable");
    } finally {
      try { reader?.releaseLock(); } catch { /* A deadline may still be canceling a read. */ }
    }
  })();
  try { return await Promise.race([request, deadline]); }
  finally { clearTimer(timer); controller.abort(); }
}

// SSH stdout is untrusted. Retain only this exact fixed projection, never raw
// JSON, stderr, body, environment contents or unexpected extra metadata.
export function projectTronReadiness(source) {
  try {
    if (typeof source !== "string" || source.length > 1024) return result("server_probe_unavailable");
    const value = JSON.parse(source);
    if (!object(value) || Object.keys(value).join(",") !== "tron_readiness" || !object(value.tron_readiness)) return result("server_probe_unavailable");
    const probe = value.tron_readiness;
    if (Object.keys(probe).sort().join(",") !== "authConfigured,authentication,rateLimitRisk,ready,reason,scope"
      || !reasons.has(probe.reason) || probe.ready !== (probe.reason === "ready") || probe.authConfigured !== false
      || probe.authentication !== "unauthenticated" || probe.rateLimitRisk !== true || probe.scope !== "fixed_solidified_head_only") return result("server_probe_unavailable");
    return result(probe.reason);
  } catch { return result("server_probe_unavailable"); }
}

if (process.argv[1] === "-" || process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length === 2) console.info(JSON.stringify(await probeTronReadiness()));
    else if (process.argv.length === 3 && process.argv[2] === "--project-result") console.info(JSON.stringify(projectTronReadiness(fs.readFileSync(0, "utf8"))));
    else throw new Error("invalid_probe_arguments");
  } catch { console.error("tron_readiness_probe_failed"); process.exitCode = 1; }
}
