import { defineConfig } from "@playwright/test";

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

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
      command: "node apps/api/dist/main.js",
      url: "http://127.0.0.1:3001/api/v1/health",
      env: {
        NODE_ENV: "test",
        API_PORT: "3001",
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        AUTH_SECRET: "playwright-auth-secret",
        APP_ORIGIN: "http://localhost:3000",
        COOKIE_SECURE: "false",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1025",
        MAIL_FROM: "墨舟 <no-reply@novelbrain.local>",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
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
