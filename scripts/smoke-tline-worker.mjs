import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ResearchStore } from "../apps/web/.next/standalone/apps/web/tline-worker/apps/web/src/lib/tline/store.ts";

const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-worker-smoke-")));
try {
  const file = path.join(directory, "research.sqlite");
  const db = new ResearchStore(file);
  const now = new Date().toISOString(); db.publish([], [], now, now); db.close();
  const worker = new URL("../apps/web/.next/standalone/apps/web/tline-worker/cli.mjs", import.meta.url).pathname;
  const status = JSON.parse(execFileSync(process.execPath, [worker, "status"], { env: { TLINE_RESEARCH_DB_PATH: file, TLINE_API_KEY: "" }, encoding: "utf8" }));
  if (status.lastSuccess !== now) throw new Error("Candidate worker did not reopen initialized catalogue");
  console.log(`Standalone worker smoke passed on Node ${process.versions.node}`);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
