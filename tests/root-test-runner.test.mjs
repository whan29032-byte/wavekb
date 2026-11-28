import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { rootTestFiles } from "../scripts/lib/root-test-manifest.mjs";
import { nodeTestArguments } from "../scripts/run-root-tests.mjs";

const testDirectory = "tests";
const posixOnly = [
  "tests/configure-wallet-runtime.test.mjs",
  "tests/deploy-release.test.mjs",
  "tests/diagnose-knowledge-transport.test.mjs",
  "tests/hermes-theory-artifact.test.mjs",
  "tests/integration-config-audit.test.mjs",
  "tests/tron-readiness-probe.test.mjs",
];
const discoveredRootTests = readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.posix.join(testDirectory, entry.name))
  .sort();
const releaseWorkflow = readFileSync(".github/workflows/verify-release.yml", "utf8");

function parseVerifyReleaseJob(workflow) {
  const lines = workflow.split(/\r?\n/);
  const verifyIndex = lines.findIndex((line) => line === "  verify:");
  assert.notEqual(verifyIndex, -1, "release workflow must define the verify job");

  const jobLines = [];
  for (const line of lines.slice(verifyIndex + 1)) {
    if (line !== "" && !/^ {4,}/.test(line)) break;
    jobLines.push(line);
  }
  const job = { steps: [] };
  let currentStep;
  let readingSteps = false;

  for (const line of jobLines) {
    const runner = line.match(/^ {4}runs-on:\s*(.+)$/);
    if (runner) {
      job.runsOn = runner[1].trim();
      continue;
    }
    if (line === "    steps:") {
      readingSteps = true;
      continue;
    }
    if (!readingSteps) continue;

    const step = line.match(/^ {6}- name:\s*(.+)$/);
    if (step) {
      currentStep = { name: step[1].trim() };
      job.steps.push(currentStep);
      continue;
    }
    const command = line.match(/^ {8}run:\s*(.+)$/);
    if (command && currentStep) currentStep.run = command[1].trim();
  }

  return job;
}

function assertReleaseWorkflowRunsFullLinuxSuite(workflow) {
  const verifyJob = parseVerifyReleaseJob(workflow);
  assert.equal(verifyJob.runsOn, "ubuntu-latest", "verify job must run on Ubuntu");
  const fullLinuxSuite = verifyJob.steps.find((step) => step.name === "Full Linux test suite");

  assert.ok(fullLinuxSuite, "verify job must include the Full Linux test suite step");
  assert.equal(fullLinuxSuite.run, "pnpm test", "Full Linux test suite must run pnpm test");
}

test("selects portable root suites on Windows and Linux", () => {
  for (const platform of ["win32", "linux"]) {
    const { selected } = rootTestFiles({ platform, testDirectory });
    assert.ok(selected.includes("tests/braces-security-backport.test.mjs"), platform);
  }
});

test("omits the POSIX-only root suites only on Windows", () => {
  const windows = rootTestFiles({ platform: "win32", testDirectory });
  const linux = rootTestFiles({ platform: "linux", testDirectory });

  assert.deepEqual(windows.omitted, posixOnly);
  for (const file of posixOnly) {
    assert.ok(!windows.selected.includes(file), `Windows selected ${file}`);
    assert.ok(linux.selected.includes(file), `Linux omitted ${file}`);
  }
});

test("selects every POSIX-only suite on Linux without selected and omitted basename overlap", () => {
  const windows = rootTestFiles({ platform: "win32", testDirectory });
  const linux = rootTestFiles({ platform: "linux", testDirectory });

  for (const file of windows.omitted) {
    assert.ok(linux.selected.includes(file), `Linux did not select POSIX suite ${file}`);
  }
  for (const [platform, { selected, omitted }] of Object.entries({ windows, linux })) {
    const selectedBasenames = new Set(selected.map((file) => path.posix.basename(file)));
    const omittedBasenames = new Set(omitted.map((file) => path.posix.basename(file)));
    assert.ok(
      [...selectedBasenames].every((basename) => !omittedBasenames.has(basename)),
      `${platform} selected and omitted the same root-test basename`,
    );
  }
});

test("release verification runs the full default test command on Ubuntu", () => {
  assertReleaseWorkflowRunsFullLinuxSuite(releaseWorkflow);
});

test("release verification rejects a POSIX-only command in the full Linux suite step", () => {
  const posixOnlyWorkflow = releaseWorkflow.replace("run: pnpm test", "run: pnpm test:posix");

  assert.throws(
    () => assertReleaseWorkflowRunsFullLinuxSuite(posixOnlyWorkflow),
    /Full Linux test suite must run pnpm test/,
  );
});

test("returns a sorted, complete manifest without stale or duplicate entries", () => {
  for (const platform of ["win32", "linux"]) {
    const { selected, omitted } = rootTestFiles({ platform, testDirectory });
    const entries = [...selected, ...omitted];

    assert.deepEqual(selected, [...selected].sort(), `${platform} selected order`);
    assert.deepEqual(omitted, [...omitted].sort(), `${platform} omitted order`);
    assert.equal(new Set(entries).size, entries.length, `${platform} duplicate entry`);
    assert.deepEqual([...entries].sort(), discoveredRootTests, `${platform} incomplete manifest`);
    for (const file of entries) {
      assert.match(file, /^tests\/.+\.test\.mjs$/, `${platform} malformed entry: ${file}`);
      assert.ok(existsSync(path.resolve(file)), `${platform} stale entry: ${file}`);
    }
  }
});

test("Linux omits no root test suites", () => {
  assert.deepEqual(rootTestFiles({ platform: "linux", testDirectory }).omitted, []);
});

test("passes every discovered root suite to Node on Linux", () => {
  assert.deepEqual(
    nodeTestArguments({ platform: "linux", testDirectory, posixOnly: false }),
    ["--test", ...discoveredRootTests],
  );
});

test("passes only portable root suites to Node on Windows", () => {
  const portableTests = discoveredRootTests.filter((file) => !posixOnly.includes(file));

  assert.deepEqual(
    nodeTestArguments({ platform: "win32", testDirectory, posixOnly: false }),
    ["--test", ...portableTests],
  );
});

test("runs exactly the POSIX root suite when requested", () => {
  assert.deepEqual(
    nodeTestArguments({ platform: "linux", testDirectory, posixOnly: true }),
    ["--test", ...posixOnly],
  );
});

test("rejects --posix-only on Windows with a non-zero exit result", () => {
  assert.throws(
    () => nodeTestArguments({ platform: "win32", testDirectory, posixOnly: true }),
    (error) => error.exitCode === 1 && /--posix-only cannot run on Windows/.test(error.message),
  );
});
