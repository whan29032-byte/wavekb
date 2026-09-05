import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ResearchStore } from "../src/lib/tline/store.ts";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(realpathSync(tmpdir()), "wavekb-tline-e2e-"));
const file = join(root, "research.sqlite");
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
  rmSync(root, { recursive: true, force: true });
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
