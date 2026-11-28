import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = new URL("../apps/web/scripts/check-knowledge-assets.mjs", import.meta.url);
const sample = "/assets/books/chan-theory-complete-cover.png";

function runProbe(mode) {
  const source = `
    const target = ${JSON.stringify(sample)};
    const mode = ${JSON.stringify(mode)};
    const signals = new Set();
    let attempts = 0;
    let canceled = 0;
    let afterFailure = 0;
    let total = 0;
    let now = Date.now();
    if (mode === "deadline") Date.now = () => now;
    globalThis.fetch = async (url, request) => {
      total++;
      const path = new URL(url).pathname;
      if (request.headers.range !== "bytes=0-31") throw new Error("missing range");
      if (mode === "deadline") now += 91_000;
      if (path !== target && mode === "offline" && attempts === 3) afterFailure++;
      if (path === target) {
        attempts++;
        signals.add(request.signal);
        if (mode === "offline" || (mode === "recover" && attempts < 3)) {
          throw new TypeError("fetch failed", { cause: Object.assign(new Error("disconnected"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
        }
      }
      const mime = path === target && mode === "wrong-mime" ? "text/html"
        : path.endsWith(".pdf") ? "application/pdf" : "image/png";
      const status = path === target && mode === "not-found" ? 404 : 206;
      const body = new ReadableStream({ cancel() { if (path === target) canceled++; } });
      return new Response(body, { status, headers: { "content-type": mime } });
    };
    process.on("exit", () => console.log("sample:", attempts, signals.size, canceled));
    process.on("exit", () => console.log("later:", afterFailure, "total:", total));
    await import(${JSON.stringify(script.href)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, KNOWLEDGE_ASSET_CHECK_ORIGIN: "https://assets.example.invalid" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
}

test("production sampling retries a transient connection failure and releases the validated range body", () => {
  const result = runProbe("recover");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sample: 3 3 1/);
});

test("production sampling still fails if its bounded network retries cannot reach the image", () => {
  const result = runProbe("offline");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /sample: 3 3 0/);
  assert.match(result.stdout, /later: 0/);
  assert.match(result.stderr, /chan-theory-complete-cover\.png: HTTP 0, missing MIME.*UND_ERR_CONNECT_TIMEOUT/);
});

test("the whole sampling deadline leaves time for rollback even when requests individually succeed", () => {
  const result = runProbe("deadline");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /total: 1\b/);
  assert.match(result.stderr, /PROBE_DEADLINE/);
});

test("a real HTTP error or unexpected MIME fails without transport retries", () => {
  for (const [mode, diagnostic] of [["wrong-mime", /HTTP 206, text\/html/], ["not-found", /HTTP 404, image\/png/]]) {
    const result = runProbe(mode);
    assert.equal(result.status, 1, mode);
    assert.match(result.stdout, /sample: 1 1 1/);
    assert.match(result.stderr, diagnostic);
  }
});
