import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

// Reuse ESLint's already-installed YAML parser; no new runtime dependency.
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml");
const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-next-production.yml", import.meta.url), "utf8"));
const steps = workflow.jobs["build-and-deploy"].steps;

test("every emitted workflow shell program parses before a runner can execute it", () => {
  for (const step of steps.filter((item) => item.run)) {
    const result = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
    assert.equal(result.status, 0, `${step.name}: ${result.stderr}`);
  }
});

test("build, local browser gates and read-only compatibility precede every remote write", () => {
  const firstWrite = steps.findIndex((step) => /\bscp\b|\bssh -i/.test(step.run ?? ""));
  assert.ok(firstWrite > 0);
  for (const command of [/pnpm test/, /pnpm typecheck/, /@wavekb\/web build/, /playwright test e2e\/navigation/, /playwright\.ui\.config/, /node scripts\/deploy-preflight/]) {
    const index = steps.findIndex((step) => command.test(step.run ?? ""));
    assert.ok(index >= 0 && index < firstWrite, `${command} must gate the first production write`);
  }
  assert.equal(steps.find((step) => step.uses?.startsWith("actions/checkout"))?.with?.["fetch-depth"], 0);
  assert.ok(!steps.some((step) => /\bpsql\b|SUPABASE_DB_URL/.test(JSON.stringify(step))));
});

test("real posting is conditional on live-base preflight and cleanup follows all acceptance", () => {
  const posting = steps.findIndex((step) => /e2e\/posting\.acceptance\.spec/.test(step.run ?? ""));
  assert.equal(steps[posting].if, "steps.preflight.outputs.posting_required == 'true'");
  const finalization = steps.findIndex((step) => /\.mjs finalize /.test(step.run ?? ""));
  assert.ok(finalization > posting);
  const rollback = steps.find((step) => /\.mjs rollback /.test(step.run ?? ""));
  assert.equal(rollback.if, "(failure() || cancelled()) && steps.upload.outcome == 'success'");
});

test("the real workflow package excludes browser-generated cache while preserving code and static files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-package-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const standalone = path.join(directory, "apps/web/.next/standalone/apps/web");
  fs.mkdirSync(path.join(standalone, ".next/cache/images"), { recursive: true });
  fs.mkdirSync(path.join(standalone, ".next/static"));
  fs.writeFileSync(path.join(standalone, "server.js"), "server");
  fs.writeFileSync(path.join(standalone, ".next/cache/images/local.webp"), "local acceptance cache");
  fs.writeFileSync(path.join(standalone, ".next/static/app.js"), "static");
  const packaging = steps.find((step) => /^tar -C apps\/web\/\.next\/standalone/.test(step.run ?? ""));
  const result = spawnSync("bash", ["-c", packaging.run], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const archive = spawnSync("tar", ["-tzf", "wavekb-next-preview.tar.gz"], { cwd: directory, encoding: "utf8" });
  assert.equal(archive.status, 0);
  const entries = archive.stdout.split("\n");
  assert.ok(entries.includes("./apps/web/server.js"));
  assert.ok(entries.includes("./apps/web/.next/static/app.js"));
  assert.ok(!entries.some((entry) => entry.startsWith("./apps/web/.next/cache")), "local acceptance cache must not enter immutable release package");
  assert.ok(fs.existsSync(path.join(standalone, ".next/cache/images/local.webp")), "packaging does not delete local cache or user files");
});
