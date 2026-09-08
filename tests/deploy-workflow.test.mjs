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
const backendWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-backend-production.yml", import.meta.url), "utf8"));
const backendSteps = backendWorkflow.jobs["migrate-and-deploy"].steps;

test("persistent candidate runs owned standalone SQLite browser and worker gates before upload", () => {
  const upload = steps.findIndex((step) => step.id === "upload");
  const fixture = steps.findIndex((step) => step.env?.TLINE_E2E_FIXTURE === "1");
  assert.ok(fixture >= 0 && fixture < upload);
  assert.equal(steps[fixture].env.TLINE_E2E_STANDALONE, "1");
  assert.equal(steps[fixture].env.PLAYWRIGHT_BASE_URL, undefined);
  assert.match(steps[fixture].run, /e2e\/tline.acceptance.spec.ts/);
  assert.ok(!/--workers=2/.test(steps[fixture].run));
  assert.ok(steps.findIndex((step) => /tline:worker:smoke/.test(step.run ?? "")) < upload);
  const probe = steps.findIndex((step) => /scripts\/probe-tline-runtime.mjs/.test(step.run ?? ""));
  assert.ok(probe >= 0 && probe < upload);
  assert.match(steps[probe].run, /ssh -i/);
  assert.ok(!steps[probe].env.TLINE_API_KEY, "runtime preflight never receives provider secret");
});

test("every emitted workflow shell program parses before a runner can execute it", () => {
  for (const step of [...steps, ...backendSteps].filter((item) => item.run)) {
    const result = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
    assert.equal(result.status, 0, `${step.name}: ${result.stderr}`);
  }
});

test("backend deployment validates host before migration and rolls gateway code back on activation failure", () => {
  const hostPreflight = backendSteps.findIndex((step) => /Verify gateway host/.test(step.name));
  const migration = backendSteps.findIndex((step) => /Apply the additive/.test(step.name));
  const upload = backendSteps.findIndex((step) => /Upload gateway archive/.test(step.name));
  const activation = backendSteps.findIndex((step) => /Activate gateway/.test(step.name));
  const publicSchemaCheck = backendSteps.findIndex((step) => /Verify the public schema marker/.test(step.name));
  assert.ok(hostPreflight >= 0 && hostPreflight < migration && migration < upload && upload < activation && activation < publicSchemaCheck);
  assert.match(backendSteps[migration].run, /schema_before/);
  assert.match(backendSteps[migration].run, /202608210002/);
  assert.match(backendSteps[migration].run, /202609080001/);
  assert.match(backendSteps[migration].run, /202609080002/);
  assert.match(backendSteps[migration].run, /202609080002_realtime_trading_leaderboard\.sql/);
  assert.equal(backendSteps[migration].env.SUPABASE_DB_URL, "${{ secrets.SUPABASE_DB_URL }}");
  assert.match(backendSteps[publicSchemaCheck].run, /202609080002/);
  assert.match(backendSteps[activation].run, /rollback\(\)/);
  assert.match(backendSteps[activation].run, /previous-release/);
  assert.match(backendSteps[activation].run, /legacy_layout/);
  assert.match(backendSteps[activation].run, /sudo mv "\$current_link" "\$previous"/);
  assert.doesNotMatch(backendSteps[activation].run, /gateway\.env.*(?:cat|sed|awk)/);
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
  fs.writeFileSync(path.join(standalone, "research.sqlite"), "private database must not ship");
  fs.writeFileSync(path.join(standalone, "research.sqlite-wal"), "private WAL must not ship");
  const packaging = steps.find((step) => /^tar -C apps\/web\/\.next\/standalone/.test(step.run ?? ""));
  const result = spawnSync("bash", ["-c", packaging.run], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const archive = spawnSync("tar", ["-tzf", "wavekb-next-preview.tar.gz"], { cwd: directory, encoding: "utf8" });
  assert.equal(archive.status, 0);
  const entries = archive.stdout.split("\n");
  assert.ok(entries.includes("./apps/web/server.js"));
  assert.ok(entries.includes("./apps/web/.next/static/app.js"));
  assert.ok(!entries.some((entry) => entry.startsWith("./apps/web/.next/cache")), "local acceptance cache must not enter immutable release package");
  assert.ok(!entries.some((entry) => entry.includes(".sqlite")), "catalogues and WAL never enter production archives");
  assert.ok(fs.existsSync(path.join(standalone, ".next/cache/images/local.webp")), "packaging does not delete local cache or user files");
});
