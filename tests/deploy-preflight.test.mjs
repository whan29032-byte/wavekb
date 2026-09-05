import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const moduleUrl = new URL("../scripts/deploy-preflight.mjs", import.meta.url);
const api = fs.existsSync(moduleUrl) ? await import(moduleUrl.href) : {};
function fixture(t, changedFile) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-preflight-test-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(cwd, "README.md"), "fixture"); git("add", "."); git("commit", "-qm", "base");
  const baseSha = git("rev-parse", "HEAD");
  fs.mkdirSync(path.dirname(path.join(cwd, changedFile)), { recursive: true }); fs.writeFileSync(path.join(cwd, changedFile), "changed");
  git("add", "."); git("commit", "-qm", "candidate");
  return { cwd, baseSha, sha: git("rev-parse", "HEAD"), schemaVersion: "202608210002", requiredSchema: "202608210002" };
}

test("knowledge-only release skips production posting based on the live base, not event.before", (t) => {
  assert.equal(typeof api.planRelease, "function", "read-only preflight must exist");
  const result = api.planRelease(fixture(t, "packages/knowledge/src/book.ts"));
  assert.equal(result.postingRequired, false);
  assert.equal(result.gatewayChanged, false);
});

test("community repository pagination triggers real posting acceptance", (t) => {
  assert.equal(typeof api.planRelease, "function", "read-only preflight must exist");
  const result = api.planRelease(fixture(t, "apps/web/src/lib/community/server-repository.ts"));
  assert.equal(result.postingRequired, true);
});

test("shared identity and dependency changes cannot silently skip posting", (t) => {
  assert.equal(typeof api.planRelease, "function", "read-only preflight must exist");
  assert.equal(api.planRelease(fixture(t, "packages/ui/src/identity.tsx")).postingRequired, true);
  assert.equal(api.planRelease(fixture(t, "pnpm-lock.yaml")).postingRequired, true);
});

test("unknown base or incompatible schema aborts, without a migration fallback", (t) => {
  assert.equal(typeof api.planRelease, "function", "read-only preflight must exist");
  const input = fixture(t, "README.md");
  assert.throws(() => api.planRelease({ ...input, baseSha: "development" }), /base SHA/);
  assert.throws(() => api.planRelease({ ...input, baseSha: "0".repeat(40) }), /available/);
  assert.throws(() => api.planRelease({ ...input, schemaVersion: "202608140005" }), /schema/);
});

test("gateway source changes require a separately approved deployment", (t) => {
  assert.equal(typeof api.planRelease, "function", "read-only preflight must exist");
  assert.throws(() => api.planRelease(fixture(t, "ai-gateway/src/server.ts")), /gateway.*separate/i);
});

test("moving a community file out of its old path still triggers posting acceptance", (t) => {
  const input = fixture(t, "apps/web/src/lib/community/server-repository.ts");
  input.baseSha = input.sha;
  execFileSync("git", ["mv", "apps/web/src/lib/community/server-repository.ts", "moved-file.txt"], { cwd: input.cwd });
  execFileSync("git", ["commit", "-qm", "move"], { cwd: input.cwd });
  input.sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: input.cwd, encoding: "utf8" }).trim();
  assert.equal(api.planRelease(input).postingRequired, true);
});

test("posting media, timeline, lightbox and shared account identity dependencies trigger acceptance", (t) => {
  for (const filename of ["research-body.tsx", "research-media.tsx", "research-lightbox.tsx", "research-timeline-composer.tsx", "account-navigation.tsx", "nameplate.tsx", "avatar-frame.tsx"]) {
    const result = api.planRelease(fixture(t, `apps/web/src/components/${filename}`));
    assert.equal(result.postingRequired, true, `${filename} is part of the real posting journey`);
  }
});
