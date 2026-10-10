import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.STORYBOOK_TEST_BASE_URL;

export default defineConfig({
  testDir: "./e2e-ui",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: externalBaseUrl || "http://127.0.0.1:6006", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: externalBaseUrl ? undefined : { command: "pnpm storybook --ci --host 127.0.0.1", url: "http://127.0.0.1:6006", reuseExistingServer: !process.env.CI, timeout: 120000 },
});
