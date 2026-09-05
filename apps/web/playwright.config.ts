import { defineConfig, devices } from "@playwright/test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
const localBaseUrl = "http://127.0.0.1:3100";
const acceptanceClientIp = process.env.E2E_POSTING_CLIENT_IP;
if (process.env.TLINE_E2E_FIXTURE === "1" && !process.env.TLINE_E2E_DB_PATH) {
  process.env.TLINE_E2E_DB_PATH = join(realpathSync(tmpdir()), `wavekb-tline-e2e-${process.pid}.sqlite`);
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.TLINE_E2E_FIXTURE === "1" ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    extraHTTPHeaders: acceptanceClientIp ? { "x-forwarded-for": acceptanceClientIp } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBaseUrl ? undefined : {
    command: process.env.TLINE_E2E_FIXTURE === "1" ? "node scripts/start-tline-e2e.mjs --hostname 127.0.0.1 --port 3100" : "pnpm dev --hostname 127.0.0.1 --port 3100",
    url: localBaseUrl,
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
