import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ResearchStore } from "../src/lib/tline/store.ts";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = realpathSync(tmpdir());

function assertFixturePath(file) {
  if (!isAbsolute(file) || resolve(file) !== file || dirname(file) !== temporaryRoot || !basename(file).startsWith("wavekb-tline-e2e-")) {
    throw new Error("TLINE_E2E_DB_PATH must be an absolute wavekb-tline-e2e-* file in the system temporary directory");
  }
}

function removeFixtureFiles(file) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${file}${suffix}`, { force: true });
}

const configuredFile = process.env.TLINE_E2E_DB_PATH;
if (configuredFile) assertFixturePath(configuredFile);

if (process.argv[2] === "publish") {
  if (!configuredFile) throw new Error("TLINE_E2E_DB_PATH is required in publish mode");
  const id = process.argv[3];
  const title = process.argv[4];
  if (!id || !/^r-refresh-[a-z0-9-]+$/.test(id) || !title) throw new Error("Publish mode requires a synthetic refresh row id and title");
  const finishedAt = Date.now();
  const writer = new ResearchStore(configuredFile);
  writer.publish([], [{
    id,
    title: { zh: title },
    institution: { slug: "bank-a" },
    ingestedAt: new Date(finishedAt - 1).toISOString(),
    publishedAt: new Date(finishedAt - 1).toISOString(),
    analysis: { summary: { zh: "刷新后才写入本地测试数据库的合成研报。" } },
  }], new Date(finishedAt - 1_000).toISOString(), new Date(finishedAt).toISOString());
  writer.close();
  process.stdout.write(`${JSON.stringify({ id, database: configuredFile })}\n`);
  process.exit(0);
}

const root = configuredFile ? null : mkdtempSync(join(temporaryRoot, "wavekb-tline-e2e-"));
const file = configuredFile ?? join(root, "research.sqlite");
if (configuredFile) removeFixtureFiles(file);
const finished = Math.floor(Date.now() / 60_000) * 60_000;
const store = new ResearchStore(file);

store.publish(
  [{ slug: "bank-a", name: "机构甲" }, { slug: "bank-b", name: "机构乙" }],
  Array.from({ length: 65 }, (_, index) => ({
    id: `r${String(index).padStart(2, "0")}`,
    title: { zh: index === 64 ? "跨页黄金观察 64" : `本地市场研报 ${index}`, en: `Local market report ${index}` },
    institution: { slug: index >= 60 ? "bank-b" : "bank-a" },
    ingestedAt: new Date(finished - (index + 1) * 60_000).toISOString(),
    publishedAt: new Date(finished - index * 3_600_000).toISOString(),
    analysis: {
      summary: { zh: `这是第 ${index} 篇已保存研报摘要。` },
      keyArguments: { zh: [`本地论点 ${index}`] },
      risks: { zh: ["合成验收数据，不构成投资建议。"] },
    },
    assets: index === 64 ? [{ ticker: "XAUUSD", name: { zh: "黄金" }, direction: 1 }] : [],
  })),
  new Date(finished - 60_000).toISOString(),
  new Date(finished).toISOString(),
);
store.close();

const child = spawn("pnpm", ["dev", ...process.argv.slice(2)], {
  cwd: webRoot,
  env: { ...process.env, TLINE_RESEARCH_DB_PATH: file, TLINE_API_KEY: "" },
  stdio: "inherit",
});

let stopping = false;
function cleanup() {
  if (root) rmSync(root, { recursive: true, force: true });
  else removeFixtureFiles(file);
}
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("error", (error) => { cleanup(); throw error; });
child.on("exit", (code, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
