import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";

const [sha, output] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !output) {
  throw new Error("Usage: package-gateway-release.mjs <release-sha> <archive-output>");
}

const root = path.resolve(import.meta.dirname, "..");
const gateway = path.join(root, "ai-gateway");
const requireFromGateway = createRequire(path.join(gateway, "package.json"));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-gateway-release-"));

try {
  fs.cpSync(path.join(gateway, "src"), path.join(stage, "src"), { recursive: true });
  fs.copyFileSync(path.join(gateway, "package.json"), path.join(stage, "package.json"));
  fs.mkdirSync(path.join(stage, "knowledge"));
  fs.copyFileSync(path.join(gateway, "knowledge/retrieval-index.json"), path.join(stage, "knowledge/retrieval-index.json"));
  fs.copyFileSync(path.join(root, "scripts/trading-release-preflight.mjs"), path.join(stage, "release-preflight.mjs"));
  fs.writeFileSync(path.join(stage, "DEPLOYMENT_VERSION"), `${sha}\n`);

  // Node cannot strip TypeScript located under node_modules. Emit JavaScript for
  // the workspace package's self-contained runtime entry points at build time.
  const domainDir = path.join(stage, "node_modules/@wavekb/domain");
  fs.mkdirSync(domainDir, { recursive: true });
  const domainEntries = ["community", "trading-review"];
  const exports = { ".": "./index.js" };
  for (const entry of domainEntries) {
    const source = fs.readFileSync(path.join(root, "packages/domain/src", `${entry}.ts`), "utf8");
    fs.writeFileSync(path.join(domainDir, `${entry}.js`), stripTypeScriptTypes(source));
    exports[`./${entry}`] = `./${entry}.js`;
  }
  fs.writeFileSync(path.join(domainDir, "index.js"), domainEntries.map((entry) => `export * from "./${entry}.js";\n`).join(""));
  fs.writeFileSync(path.join(domainDir, "package.json"), JSON.stringify({ name: "@wavekb/domain", type: "module", exports }));

  // Use the locked, dependency-free distribution; do not include workspace
  // symlinks, source maps, or developer dependencies in the release.
  const openAlgoSource = path.dirname(path.dirname(requireFromGateway.resolve("openalgo-charts")));
  const openAlgoDir = path.join(stage, "node_modules/openalgo-charts");
  fs.mkdirSync(openAlgoDir);
  fs.cpSync(path.join(openAlgoSource, "dist"), path.join(openAlgoDir, "dist"), {
    recursive: true,
    filter: (source) => fs.statSync(source).isDirectory() || source.endsWith(".mjs"),
  });
  for (const name of ["package.json", "LICENSE", "NOTICE"]) {
    fs.copyFileSync(path.join(openAlgoSource, name), path.join(openAlgoDir, name));
  }

  execFileSync("tar", ["-czf", "release.tar.gz", "package.json", "src", "knowledge/retrieval-index.json", "DEPLOYMENT_VERSION", "release-preflight.mjs", "node_modules"], { cwd: stage, stdio: "inherit" });
  fs.copyFileSync(path.join(stage, "release.tar.gz"), path.resolve(output), fs.constants.COPYFILE_EXCL);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
