import { readdirSync } from "node:fs";
import path from "node:path";

type TestFileOptions = { platform: string; testDirectory: string };

const posixOnlyGatewayTests = new Set([
  "test/private-theory.test.ts",
  "test/research-configure-runtime.test.ts",
  "test/youtube-configure-runtime.test.ts",
]);

export function gatewayTestFiles({ platform, testDirectory }: TestFileOptions) {
  const portableDirectory = testDirectory.replaceAll("\\", "/").replace(/\/$/, "");
  const entries = readdirSync(testDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.posix.join(portableDirectory, entry.name))
    .sort();
  const omitted = platform === "win32" ? entries.filter((entry) => posixOnlyGatewayTests.has(entry)) : [];
  const selected = entries.filter((entry) => !omitted.includes(entry));

  return { selected, omitted };
}

export function posixOnlyGatewayTestFiles({ testDirectory }: Pick<TestFileOptions, "testDirectory">) {
  return gatewayTestFiles({ platform: "win32", testDirectory }).omitted;
}
