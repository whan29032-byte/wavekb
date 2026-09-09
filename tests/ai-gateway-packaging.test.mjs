import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml");
const backendWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-backend-production.yml", import.meta.url), "utf8"));
const packageStep = backendWorkflow.jobs["migrate-and-deploy"].steps.find((step) => /Package immutable gateway release/.test(step.name));

test("the backend archive starts outside checkout with all three books and no PDFs or secrets", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-gateway-package-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const gateway = path.join(directory, "ai-gateway");
  fs.mkdirSync(gateway, { recursive: true });
  fs.cpSync(path.join(repoRoot, "ai-gateway", "package.json"), path.join(gateway, "package.json"));
  fs.cpSync(path.join(repoRoot, "ai-gateway", "src"), path.join(gateway, "src"), { recursive: true });
  fs.mkdirSync(path.join(gateway, "knowledge"));
  fs.cpSync(
    path.join(repoRoot, "ai-gateway", "knowledge", "retrieval-index.json"),
    path.join(gateway, "knowledge", "retrieval-index.json"),
  );
  fs.writeFileSync(path.join(gateway, ".env"), "AI_SECRET_MASTER_KEY=must-not-ship\n");
  fs.writeFileSync(path.join(gateway, "knowledge", "source.pdf"), "must-not-ship");

  const packaged = spawnSync("bash", ["-c", packageStep.run], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_SHA: "a".repeat(40) },
  });
  assert.equal(packaged.status, 0, packaged.stderr);

  const listed = spawnSync("tar", ["-tzf", "wavekb-gateway.tar.gz"], { cwd: directory, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const entries = listed.stdout.split(/\r?\n/);
  for (const expected of ["package.json", "src/", "knowledge/retrieval-index.json", "DEPLOYMENT_VERSION"]) {
    assert.ok(entries.some((entry) => entry === expected || entry.startsWith(expected)), `${expected} must be packaged`);
  }
  assert.ok(!entries.some((entry) => /\.pdf$/i.test(entry)), "source PDFs must not be packaged");
  assert.ok(!entries.some((entry) => /(^|\/)\.env(?:\.|$)/.test(entry)), "environment secrets must not be packaged");

  const extracted = path.join(directory, "extracted");
  fs.mkdirSync(extracted);
  const unpacked = spawnSync("tar", ["-xzf", path.join(directory, "wavekb-gateway.tar.gz"), "-C", extracted], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const smoke = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'import { buildKnowledgeIndex } from "./src/knowledge/index.ts"; const index = buildKnowledgeIndex(); if (index.books.length !== 3) process.exit(1);',
  ], { cwd: extracted, encoding: "utf8" });
  assert.equal(smoke.status, 0, smoke.stderr);
});
