import { fileURLToPath } from "node:url";
import { loadMentorNotificationConfig } from "./mentor-notifications/config.ts";
import { MentorNotificationWorker } from "./mentor-notifications/worker.ts";

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain) {
  try {
    const worker = new MentorNotificationWorker(loadMentorNotificationConfig(process.env), {
      log: (code) => console.info(code),
    });
    process.once("SIGTERM", () => worker.stop());
    process.once("SIGINT", () => worker.stop());
    await worker.run();
  } catch {
    // Configuration/errors can carry secrets. Only a fixed code is emitted.
    console.error("mentor_notification_worker_start_failed");
    process.exitCode = 1;
  }
}
