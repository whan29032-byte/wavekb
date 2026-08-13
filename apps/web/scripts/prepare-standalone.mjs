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

console.log("Prepared the standalone server with static assets.");
