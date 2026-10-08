import { fileURLToPath } from "node:url";
import { loadYouTubeSyncConfig } from "./youtube/config.ts";
import { YouTubeSyncWorker } from "./youtube/worker.ts";

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain) {
  try {
    const worker = new YouTubeSyncWorker(loadYouTubeSyncConfig(process.env), { log: (code) => console.info(code) });
    process.once("SIGTERM", () => worker.stop());
    process.once("SIGINT", () => worker.stop());
    await worker.run();
  } catch {
    console.error("youtube_sync_worker_start_failed");
    process.exitCode = 1;
  }
}
