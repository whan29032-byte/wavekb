import { ResearchStore } from "../apps/web/src/lib/tline/store.ts";
import { syncResearch } from "../apps/web/src/lib/tline/sync.ts";

const [command = "sync", output, ...extra] = process.argv.slice(2);
try {
  const path = process.env.TLINE_RESEARCH_DB_PATH;
  if (!path || extra.length || !["sync", "status", "backup"].includes(command) || (command === "backup" ? !output : Boolean(output))) throw new Error("Invalid worker configuration");
  if (command === "sync") console.log(JSON.stringify(await syncResearch({ path })));
  else {
    const store = new ResearchStore(path, { readOnly: command === "status" });
    try {
      if (command === "backup") { store.backupTo(output); console.log(JSON.stringify({ status: "backed_up" })); }
      else console.log(JSON.stringify(store.status()));
    } finally { store.close(); }
  }
} catch {
  console.error(JSON.stringify({ status: "failed", code: "research_worker_failed" }));
  process.exitCode = 1;
}
