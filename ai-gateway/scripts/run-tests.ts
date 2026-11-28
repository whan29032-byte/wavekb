import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { gatewayTestFiles, posixOnlyGatewayTestFiles } from "./lib/test-manifest.ts";

type RunnerOptions = {
  platform?: string;
  argv?: string[];
  testDirectory?: string;
  spawn?: (command: string, args: string[], options: { stdio: "inherit" }) => { status: number | null; error?: Error };
  log?: (line: string) => void;
};

export function nodeTestArguments({ platform, testDirectory, posixOnly }: { platform: string; testDirectory: string; posixOnly: boolean }) {
  if (posixOnly) {
    if (platform === "win32") {
      const error = Object.assign(new Error("--posix-only cannot run on Windows."), { exitCode: 1 });
      throw error;
    }
    return ["--test", ...posixOnlyGatewayTestFiles({ testDirectory })];
  }

  return ["--test", ...gatewayTestFiles({ platform, testDirectory }).selected];
}

export function runGatewayTests({
  platform = process.platform,
  argv = process.argv.slice(2),
  testDirectory = "test",
  spawn = spawnSync,
  log = console.log,
}: RunnerOptions = {}) {
  const posixOnly = argv.includes("--posix-only");

  try {
    const { omitted } = gatewayTestFiles({ platform, testDirectory });
    const argumentsForNode = nodeTestArguments({ platform, testDirectory, posixOnly });
    if (omitted.length > 0) {
      log("Skipping POSIX-only gateway test suites on Windows:");
      for (const file of omitted) log(`- ${file}`);
    }

    const result = spawn(process.execPath, argumentsForNode, { stdio: "inherit" });
    if (result.error) throw result.error;
    return Number.isInteger(result.status) ? result.status : 1;
  } catch (error) {
    log(error instanceof Error ? error.message : "Gateway test runner failed.");
    return typeof error === "object" && error !== null && "exitCode" in error && Number.isInteger(error.exitCode) ? error.exitCode as number : 1;
  }
}

const executedFile = process.argv[1];
if (executedFile && import.meta.url === pathToFileURL(executedFile).href) {
  process.exitCode = runGatewayTests();
}
