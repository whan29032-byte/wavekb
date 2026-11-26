import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { gatewayTestFiles } from "../scripts/lib/test-manifest.ts";
import { nodeTestArguments, runGatewayTests } from "../scripts/run-tests.ts";

const testDirectory = "test";
const windowsOnly = [
  "test/private-theory.test.ts",
  "test/research-configure-runtime.test.ts",
  "test/youtube-configure-runtime.test.ts",
];
const discoveredGatewayTests = readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => path.posix.join(testDirectory, entry.name))
  .sort();

test("returns a sorted, complete gateway test manifest without stale or duplicate entries", () => {
  for (const platform of ["win32", "linux"]) {
    const { selected, omitted } = gatewayTestFiles({ platform, testDirectory });
    const entries = [...selected, ...omitted];

    assert.deepEqual(selected, [...selected].sort(), `${platform} selected order`);
    assert.deepEqual(omitted, [...omitted].sort(), `${platform} omitted order`);
    assert.equal(new Set(entries).size, entries.length, `${platform} duplicate entry`);
    assert.deepEqual([...entries].sort(), discoveredGatewayTests, `${platform} incomplete manifest`);
    for (const file of entries) assert.ok(existsSync(path.resolve(file)), `${platform} stale entry: ${file}`);
  }
});

test("omits exactly the Windows-incompatible gateway security suites", () => {
  const windows = gatewayTestFiles({ platform: "win32", testDirectory });

  assert.deepEqual(windows.omitted, windowsOnly);
  for (const file of windowsOnly) assert.ok(!windows.selected.includes(file), `Windows selected ${file}`);
});

test("Linux selects every direct gateway test and omits none", () => {
  const linux = gatewayTestFiles({ platform: "linux", testDirectory });

  assert.deepEqual(linux.omitted, []);
  assert.deepEqual(linux.selected, discoveredGatewayTests);
  for (const file of windowsOnly) assert.ok(linux.selected.includes(file), `Linux omitted ${file}`);
});

test("builds exact default and POSIX-only Node arguments", () => {
  const portable = discoveredGatewayTests.filter((file) => !windowsOnly.includes(file));

  assert.deepEqual(nodeTestArguments({ platform: "win32", testDirectory, posixOnly: false }), ["--test", ...portable]);
  assert.deepEqual(nodeTestArguments({ platform: "linux", testDirectory, posixOnly: false }), ["--test", ...discoveredGatewayTests]);
  assert.deepEqual(nodeTestArguments({ platform: "linux", testDirectory, posixOnly: true }), ["--test", ...windowsOnly]);
});

test("rejects POSIX-only gateway tests on Windows", () => {
  assert.throws(
    () => nodeTestArguments({ platform: "win32", testDirectory, posixOnly: true }),
    (error: unknown) => error instanceof Error && "exitCode" in error && error.exitCode === 1 && /--posix-only cannot run on Windows/.test(error.message),
  );
});

test("prints Windows omissions and propagates child exit status", () => {
  const output: string[] = [];
  let call: [string, string[], { stdio: "inherit" }] | undefined;
  const result = runGatewayTests({
    platform: "win32",
    testDirectory,
    log: (line: string) => output.push(line),
    spawn: (command, args, options) => { call = [command, args, options]; return { status: 7 }; },
  });

  assert.equal(result, 7);
  assert.equal(call?.[0], process.execPath);
  assert.deepEqual(call?.[1], nodeTestArguments({ platform: "win32", testDirectory, posixOnly: false }));
  assert.deepEqual(call?.[2], { stdio: "inherit" });
  assert.deepEqual(output, ["Skipping POSIX-only gateway test suites on Windows:", ...windowsOnly.map((file) => `- ${file}`)]);
});

test("treats a signaled gateway test child as failure", () => {
  assert.equal(runGatewayTests({ platform: "linux", testDirectory, spawn: () => ({ status: null, signal: "SIGTERM" }) }), 1);
});
