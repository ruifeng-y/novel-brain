import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    colorScheme: "light",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node apps/web/e2e/mock-api.mjs",
      url: "http://127.0.0.1:3001/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @novel-brain/web dev",
      url: "http://localhost:3000/health",
      env: { API_INTERNAL_URL: "http://127.0.0.1:3001" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
