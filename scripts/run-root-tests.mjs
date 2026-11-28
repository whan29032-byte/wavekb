import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { posixOnlyRootTestFiles, rootTestFiles } from "./lib/root-test-manifest.mjs";

export function nodeTestArguments({ platform, testDirectory, posixOnly }) {
  if (posixOnly) {
    if (platform === "win32") {
      const error = new Error("--posix-only cannot run on Windows.");
      error.exitCode = 1;
      throw error;
    }

    return ["--test", ...posixOnlyRootTestFiles({ testDirectory })];
  }

  return ["--test", ...rootTestFiles({ platform, testDirectory }).selected];
}

export function runRootTests({
  platform = process.platform,
  argv = process.argv.slice(2),
  testDirectory = "tests",
} = {}) {
  const posixOnly = argv.includes("--posix-only");

  try {
    const { omitted } = rootTestFiles({ platform, testDirectory });
    const argumentsForNode = nodeTestArguments({ platform, testDirectory, posixOnly });

    if (omitted.length > 0) {
      console.log("Skipping POSIX-only root test suites on Windows:");
      for (const file of omitted) {
        console.log(`- ${file}`);
      }
    }

    const result = spawnSync(process.execPath, argumentsForNode, { stdio: "inherit" });
    if (result.error) {
      throw result.error;
    }

    return result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    return error.exitCode ?? 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runRootTests();
}
