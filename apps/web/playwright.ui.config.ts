import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-ui",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:6006", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "pnpm storybook --ci --host 127.0.0.1", url: "http://127.0.0.1:6006", reuseExistingServer: !process.env.CI, timeout: 120000 },
});
