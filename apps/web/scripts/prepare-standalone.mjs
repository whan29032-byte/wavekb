import fs from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const standaloneApp = path.join(appRoot, ".next/standalone/apps/web");
const serverFile = path.join(standaloneApp, "server.js");

if (!fs.existsSync(serverFile)) throw new Error(`standalone server was not generated: ${serverFile}`);

fs.cpSync(path.join(appRoot, ".next/static"), path.join(standaloneApp, ".next/static"), {
  recursive: true,
  force: true,
});

const publicDirectory = path.join(appRoot, "public");
if (fs.existsSync(publicDirectory)) {
  fs.cpSync(publicDirectory, path.join(standaloneApp, "public"), { recursive: true, force: true });
}

// Preserve the CLI's exact source-relative imports in a tiny portable tree.
// Explicit allowlist: never copy tests, fixture initialization or SQLite files.
const worker = path.join(standaloneApp, "tline-worker");
const modules = path.join(worker, "apps/web/src/lib/tline");
fs.mkdirSync(modules, { recursive: true });
fs.mkdirSync(path.join(worker, "scripts"), { recursive: true });
for (const name of ["client.ts", "store.ts", "sync.ts"]) {
  fs.copyFileSync(path.join(appRoot, "src/lib/tline", name), path.join(modules, name));
}
fs.copyFileSync(path.resolve(appRoot, "../../scripts/tline-sync.mjs"), path.join(worker, "scripts/tline-sync.mjs"));
fs.writeFileSync(path.join(worker, "package.json"), '{"type":"module"}\n');
fs.writeFileSync(path.join(worker, "cli.mjs"), 'import "./scripts/tline-sync.mjs";\n');
console.log("Prepared the standalone server, static assets and portable research worker.");
