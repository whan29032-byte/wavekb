import { readdirSync } from "node:fs";
import path from "node:path";

const posixOnlyRootTests = new Set([
  "tests/configure-wallet-runtime.test.mjs",
  "tests/deploy-release.test.mjs",
  "tests/diagnose-knowledge-transport.test.mjs",
  "tests/hermes-theory-artifact.test.mjs",
  "tests/integration-config-audit.test.mjs",
  "tests/tron-readiness-probe.test.mjs",
]);

export function rootTestFiles({ platform, testDirectory }) {
  const portableDirectory = testDirectory.replaceAll("\\", "/").replace(/\/$/, "");
  const entries = readdirSync(testDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.posix.join(portableDirectory, entry.name))
    .sort();

  const omitted = platform === "win32" ? entries.filter((entry) => posixOnlyRootTests.has(entry)) : [];
  const selected = entries.filter((entry) => !omitted.includes(entry));
  return { selected, omitted };
}

export function posixOnlyRootTestFiles({ testDirectory }) {
  return rootTestFiles({ platform: "win32", testDirectory }).omitted;
}
