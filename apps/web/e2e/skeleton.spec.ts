import { expect, test, type Page } from "@playwright/test";

const timestamp = "2026-11-04T08:00:00.000Z";

async function mockReadyHealth(page: Page) {
  await page.route("**/api/v1/health/ready", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          status: "ready",
          service: "api",
          timestamp,
          checks: [
            { name: "database", status: "up", latencyMs: 4 },
            { name: "queue", status: "up", latencyMs: 2 },
          ],
        },
        requestId: "req_ready",
        meta: {},
      }),
    });
  });
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { status: "ok", service: "api", timestamp },
        requestId: "req_live",
        meta: {},
      }),
    });
  });
}

test("health page follows the shell at all signed-off viewports", async ({ page }, testInfo) => {
  await mockReadyHealth(page);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/health");

    await expect(page.getByRole("heading", { name: "服务状态" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await expect(page.getByText("运行正常")).toBeVisible();
    const results = page.getByRole("region", { name: "服务检查结果" });
    await expect(results.getByText("数据库", { exact: true })).toBeVisible();
    await expect(results.getByText("任务队列", { exact: true })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
    expect(screenshot.subarray(1, 4).toString("ascii")).toBe("PNG");
    await testInfo.attach(`health-${width}`, {
      body: screenshot,
      contentType: "image/png",
    });
  }
});

test("health page shows an actionable dependency failure", async ({ page }) => {
  await page.route("**/api/v1/health/ready", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          status: "not_ready",
          service: "api",
          timestamp,
          checks: [
            { name: "database", status: "up", latencyMs: 4 },
            { name: "queue", status: "down", latencyMs: 2 },
          ],
        },
        requestId: "req_not_ready",
        meta: {},
      }),
    });
  });
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { status: "ok", service: "api", timestamp },
        requestId: "req_live",
        meta: {},
      }),
    });
  });

  await page.goto("/health");
  await expect(page.getByText("需要处理")).toBeVisible();
  const queueCard = page
    .getByRole("region", { name: "服务检查结果" })
    .getByRole("article")
    .filter({ hasText: "任务队列" });
  await expect(queueCard.getByText("不可用")).toBeVisible();
});

test("health page leaves loading when the request times out", async ({ page }) => {
  await page.route("**/api/v1/health/ready", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await route.abort().catch(() => undefined);
  });
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { status: "ok", service: "api", timestamp },
        requestId: "req_live",
        meta: {},
      }),
    });
  });

  await page.goto("/health");
  await expect(page.getByText("暂时无法读取服务状态")).toBeVisible({ timeout: 8_000 });
});

test("workspace route renders the app shell placeholder at all viewports", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("lin@example.com");
  await page.getByLabel("密码").fill("StrongPassword123");
  const loginButton = page.getByRole("button", { name: "登录" });
  await expect(loginButton).toBeEnabled();
  await loginButton.click();
  await expect(page).toHaveURL(/\/workspace$/);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace");

    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "还没有作品" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
