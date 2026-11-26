import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { rootTestFiles } from "../scripts/lib/root-test-manifest.mjs";

const testDirectory = "tests";
const windowsOnly = [
  "tests/configure-wallet-runtime.test.mjs",
  "tests/deploy-release.test.mjs",
  "tests/diagnose-knowledge-transport.test.mjs",
  "tests/hermes-theory-artifact.test.mjs",
  "tests/integration-config-audit.test.mjs",
  "tests/tron-readiness-probe.test.mjs",
];

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
    for (const file of entries) {
      assert.match(file, /^tests\/.+\.test\.mjs$/, `${platform} malformed entry: ${file}`);
      assert.ok(existsSync(path.resolve(file)), `${platform} stale entry: ${file}`);
    }
  }
});
