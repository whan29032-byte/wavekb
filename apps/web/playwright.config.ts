import { defineConfig, devices } from "@playwright/test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
const localBaseUrl = "http://127.0.0.1:3100";
const acceptanceClientIp = process.env.E2E_POSTING_CLIENT_IP;
const fixture = process.env.TLINE_E2E_FIXTURE === "1";
if (fixture && (externalBaseUrl || process.env.TLINE_LIVE_ACCEPTANCE === "1")) throw new Error("Fixture mode cannot use an external or live server");
if (fixture && !process.env.TLINE_E2E_OWNER) process.env.TLINE_E2E_OWNER = randomUUID();
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
    command: fixture ? `node scripts/start-tline-e2e.mjs ${process.env.TLINE_E2E_STANDALONE === "1" ? "standalone" : "dev"} --hostname 127.0.0.1 --port 3100` : "pnpm dev --hostname 127.0.0.1 --port 3100",
    url: localBaseUrl,
    reuseExistingServer: fixture ? false : !process.env.CI,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
