import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

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
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.getByText("模型配置已保存。")).toBeVisible();
  await expect(page.getByText("****1234")).toBeVisible();
  await expect(page.getByText("sk-secret-value-1234")).toHaveCount(0);

  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接正常。")).toBeVisible();

  await page.getByRole("button", { name: "编辑 DeepSeek 正文" }).click();
  await page.getByLabel("配置名称").fill("DeepSeek 主模型");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("DeepSeek 主模型")).toBeVisible();

  await page.getByRole("button", { name: "删除 DeepSeek 主模型" }).click();
  await expect(page.getByText("还没有模型配置")).toBeVisible();
});

test("rate-limit result is visible and recoverable", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.getByLabel("配置名称").fill("限流配置");
  await page.getByLabel("API Key").fill("sk-rate-limit-1234");
  await page.getByRole("button", { name: "新增配置" }).click();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("Provider 已限流")).toBeVisible();
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
