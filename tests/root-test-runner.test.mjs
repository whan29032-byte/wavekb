import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { rootTestFiles } from "../scripts/lib/root-test-manifest.mjs";
import { nodeTestArguments } from "../scripts/run-root-tests.mjs";

const testDirectory = "tests";
const windowsOnly = [
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

test("selects portable root suites on Windows and Linux", () => {
  for (const platform of ["win32", "linux"]) {
    const { selected } = rootTestFiles({ platform, testDirectory });
    assert.ok(selected.includes("tests/braces-security-backport.test.mjs"), platform);
  }
});

test("omits the POSIX-only root suites only on Windows", () => {
  const windows = rootTestFiles({ platform: "win32", testDirectory });
  const linux = rootTestFiles({ platform: "linux", testDirectory });

  assert.deepEqual(windows.omitted, windowsOnly);
  for (const file of windowsOnly) {
    assert.ok(!windows.selected.includes(file), `Windows selected ${file}`);
    assert.ok(linux.selected.includes(file), `Linux omitted ${file}`);
  }
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
  const portableTests = discoveredRootTests.filter((file) => !windowsOnly.includes(file));

  assert.deepEqual(
    nodeTestArguments({ platform: "win32", testDirectory, posixOnly: false }),
    ["--test", ...portableTests],
  );
});

test("runs exactly the POSIX root suite when requested", () => {
  assert.deepEqual(
    nodeTestArguments({ platform: "linux", testDirectory, posixOnly: true }),
    ["--test", ...windowsOnly],
  );
});

test("rejects --posix-only on Windows with a non-zero exit result", () => {
  assert.throws(
    () => nodeTestArguments({ platform: "win32", testDirectory, posixOnly: true }),
    (error) => error.exitCode === 1 && /--posix-only cannot run on Windows/.test(error.message),
  );
});
