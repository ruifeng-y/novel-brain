import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";

import { registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";

async function authenticatedPage(page: Page, context: BrowserContext, request: APIRequestContext) {
  const email = uniqueEmail("model-settings");
  const session = await registerUser(request, email, "StrongPassword123", "模型设置作者");
  await context.addCookies([
    {
      name: "nb_session",
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/workspace/settings/account");
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("account settings supports create, test, edit and delete", async ({
  page,
  context,
  request,
}) => {
  await authenticatedPage(page, context, request);
  await expect(page.getByRole("heading", { name: "把写作环境准备好" })).toBeVisible();

  await page.getByLabel("配置名称").fill("DeepSeek 正文");
  await page.getByLabel("API Key").fill("sk-secret-value-1234");
  await page.getByRole("checkbox", { name: "规划" }).check();
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.getByText("模型配置已保存。")).toBeVisible();
  await expect(page.getByText("****1234")).toBeVisible();
  await expect(page.getByText(/规划、正文/)).toBeVisible();
  await expect(page.getByText("sk-secret-value-1234")).toHaveCount(0);

  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接正常。")).toBeVisible();

  await page.getByRole("button", { name: "编辑 DeepSeek 正文" }).click();
  await expect(page.getByRole("combobox", { name: "服务商" })).toBeDisabled();
  await page.getByLabel("配置名称").fill("DeepSeek 主模型");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("DeepSeek 主模型")).toBeVisible();

  await page.getByRole("button", { name: "删除 DeepSeek 主模型" }).click();
  await expect(page.getByText("至少保留一套默认配置")).toBeVisible();
  await expect(page.getByText("DeepSeek 主模型")).toBeVisible();

  await page.getByLabel("配置名称").fill("备用检查模型");
  await page.getByLabel("API Key").fill("sk-backup-value-5678");
  await page.getByRole("checkbox", { name: "检查" }).check();
  await page.getByRole("checkbox", { name: "正文" }).uncheck();
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.getByText("备用检查模型")).toBeVisible();

  await page.getByRole("button", { name: "删除 DeepSeek 主模型" }).click();
  await expect(page.getByText("DeepSeek 主模型")).toHaveCount(0);
  await expect(page.getByText("备用检查模型")).toBeVisible();
  await expectNoInternalTerms(page);
});

test("settings route redirects to account settings", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.goto("/workspace/settings");
  await expect(page).toHaveURL(/\/workspace\/settings\/account$/);
});

test("rate-limit result is visible and recoverable", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.getByLabel("配置名称").fill("限流配置");
  await page.getByLabel("API Key").fill("sk-rate-limit-1234");
  await page.getByRole("button", { name: "新增配置" }).click();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("服务商已限流")).toBeVisible();
  await expect(page.getByText("部分配置连接异常，请检查后重试。")).toBeVisible();
});

test("provider failures are visible and recoverable", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.getByLabel("配置名称").fill("服务商异常配置");
  await page.getByLabel("API Key").fill("sk-provider-error-1234");
  await page.getByRole("button", { name: "新增配置" }).click();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("服务商返回错误")).toBeVisible();
  await expect(page.getByText("服务商异常", { exact: true })).toBeVisible();
  await expect(page.getByText("部分配置连接异常，请检查后重试。")).toBeVisible();
});

test("create retries reuse the idempotency key", async ({ page, context, request }) => {
  const idempotencyKeys: string[] = [];
  await page.route("**/api/v1/model-configs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const key = route.request().headers()["idempotency-key"];
    if (key) {
      idempotencyKeys.push(key);
    }
    if (idempotencyKeys.length === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "模型配置保存失败。",
            details: {},
            requestId: "req_e2e_retry",
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await authenticatedPage(page, context, request);
  await page.getByLabel("配置名称").fill("幂等重试配置");
  await page.getByLabel("API Key").fill("sk-idempotent-retry-1234");
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.getByText("模型配置保存失败。")).toBeVisible();
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.getByText("模型配置已保存。")).toBeVisible();
  expect(idempotencyKeys).toHaveLength(2);
  expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
});

test("loading and error states are visible", async ({ page, context, request }) => {
  let releaseConfigs: (() => void) | undefined;
  const configsGate = new Promise<void>((resolve) => {
    releaseConfigs = resolve;
  });
  await page.route("**/api/v1/model-configs", async (route) => {
    await configsGate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "模型配置加载失败。",
          details: {},
          requestId: "req_e2e_error",
        },
      }),
    });
  });

  await authenticatedPage(page, context, request);
  await expect(page.getByText("正在加载模型配置")).toBeVisible();
  releaseConfigs?.();
  await expect(page.getByText("模型配置加载失败。")).toBeVisible();
});

test("disabled accounts redirect to the permission state", async ({ page, context, request }) => {
  const email = uniqueEmail("disabled-settings");
  const session = await registerUser(request, email, "StrongPassword123", "禁用设置作者");
  await context.addCookies([
    {
      name: "nb_session",
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const pool = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
  });
  try {
    await pool.query("UPDATE users SET status = 'disabled' WHERE email = $1", [email]);
  } finally {
    await pool.end();
  }

  await page.goto("/workspace/settings/account");
  await expect(page).toHaveURL(/\/login\?reason=permission$/);
  await expect(page.getByText("当前账号无权访问此页面。")).toBeVisible();
});

test("account settings holds at all four viewports", async ({
  page,
  context,
  request,
}, testInfo) => {
  await authenticatedPage(page, context, request);
  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await expect(page.getByRole("heading", { name: "把写作环境准备好" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
    await testInfo.attach(`account-settings-${width}`, {
      body: screenshot,
      contentType: "image/png",
    });
  }
});

async function expectNoInternalTerms(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Provider");
  expect(text).not.toContain("provider_error");
  expect(text).not.toContain("model_config");
}
