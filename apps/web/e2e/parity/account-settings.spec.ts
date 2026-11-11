import { createHash, randomBytes } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";

import { registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  freezeApiTimestamps,
  productionScreenshotOptions,
} from "../helpers/ui";

const viewports = [390, 900, 1180, 1440] as const;

async function authenticatedPage(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
): Promise<{ email: string }> {
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
  return { email };
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

test("invalid and expired model keys stay masked and recoverable", async ({
  page,
  context,
  request,
}) => {
  await authenticatedPage(page, context, request);
  await freezeApiTimestamps(page);
  await page.reload();

  await page.getByLabel("配置名称").fill("无效 Key 配置");
  await page.getByLabel("API Key").fill("sk-invalid-key-1234");
  await page.getByRole("button", { name: "新增配置" }).click();
  const invalidRow = page.locator(".model-config-row", { hasText: "无效 Key 配置" });
  await expect(invalidRow).toContainText("****1234");
  await expect(page.getByText("sk-invalid-key-1234")).toHaveCount(0);

  await invalidRow.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("API Key 无效或已失效")).toBeVisible();
  await expect(invalidRow.getByText("Key 无效或失效", { exact: true })).toBeVisible();
  await expect(page.getByText("部分配置连接异常，请检查后重试。")).toBeVisible();

  const replaceInvalidKey = invalidRow.getByRole("button", {
    name: "替换 无效 Key 配置 的 Key",
  });
  await expect(replaceInvalidKey).toBeVisible();
  await replaceInvalidKey.click();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await expect(page.getByLabel("API Key")).toHaveAttribute("placeholder", "留空则保留原 Key");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(invalidRow).toContainText("****1234");

  await page.getByLabel("配置名称").fill("过期 Key 配置");
  await page.getByLabel("API Key").fill("sk-expired-key-5678");
  await page.getByRole("button", { name: "新增配置" }).click();
  const expiredRow = page.locator(".model-config-row", { hasText: "过期 Key 配置" });
  await expiredRow.getByRole("button", { name: "测试连接" }).click();
  await expect(expiredRow.getByText("Key 无效或失效", { exact: true })).toBeVisible();
  await expect(page.getByText("sk-expired-key-5678")).toHaveCount(0);

  await page.getByLabel("配置名称").fill("服务商失败配置");
  await page.getByLabel("API Key").fill("sk-provider-error-4321");
  await page.getByRole("button", { name: "新增配置" }).click();
  const failureRow = page.locator(".model-config-row", { hasText: "服务商失败配置" });
  await failureRow.getByRole("button", { name: "测试连接" }).click();
  await expect(failureRow.getByText("服务商异常", { exact: true })).toBeVisible();
  await expect(page.getByText("sk-provider-error-4321")).toHaveCount(0);
  await expect(page.locator(".model-config-row")).toHaveCount(3);
  await expect(page.getByText("平台 Key")).toHaveCount(0);
  await expect(page.getByText("本地模型")).toHaveCount(0);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page).toHaveURL(/\/workspace\/settings\/account$/u);
    await expect(invalidRow).toContainText("****1234");
    await expect(expiredRow).toContainText("****5678");
    await expect(invalidRow.getByText("Key 无效或失效", { exact: true })).toBeVisible();
    await expect(expiredRow.getByText("Key 无效或失效", { exact: true })).toBeVisible();
    await expect(failureRow.getByText("服务商异常", { exact: true })).toBeVisible();
    await expect(page.getByText("部分配置连接异常，请检查后重试。")).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page).toHaveScreenshot(
      ["account-settings", `account-settings-key-error-${width}.png`],
      productionScreenshotOptions,
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await replaceInvalidKey.click();
  await page.getByLabel("API Key").fill("sk-recovered-key-9012");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(invalidRow).toContainText("****9012");
  await invalidRow.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接正常。")).toBeVisible();
  await expect(invalidRow.getByText("连接正常", { exact: true })).toBeVisible();
  await expect(page.getByText("sk-recovered-key-9012")).toHaveCount(0);
});

test("create retries reuse the idempotency key", async ({ page, context, request }) => {
  const idempotencyKeys: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/v1/model-configs",
    async (route) => {
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
    },
  );

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
  await page.route(
    (url) => url.pathname === "/api/v1/model-configs",
    async (route) => {
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
    },
  );

  await authenticatedPage(page, context, request);
  await expect(page.getByText("正在加载模型配置")).toBeVisible();
  releaseConfigs?.();
  await expect(page.getByText("模型配置加载失败。")).toBeVisible();
});

test("manages profile, multiple pen names and device sessions", async ({
  page,
  context,
  request,
}) => {
  const { email } = await authenticatedPage(page, context, request);
  await expect(page.getByRole("heading", { name: "模型设置作者" })).toBeVisible();

  await page.getByLabel("显示名称").fill("青舟作者");
  await page.getByLabel("个人简介").fill("写仙侠长篇，也写短篇。");
  await page.getByLabel("头像链接").fill("https://example.com/avatar.png");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("账号资料已保存。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "青舟作者" })).toBeVisible();

  await page.getByLabel("新笔名", { exact: true }).fill("青舟");
  await page.getByLabel("新笔名简介").fill("仙侠长篇署名");
  await page.getByRole("button", { name: "新增笔名" }).click();
  await expect(page.getByText("笔名已创建。")).toBeVisible();
  const penNameRow = page.locator(".pen-name-row").filter({ hasText: "青舟" });
  await expect(penNameRow).toBeVisible();
  await expect(penNameRow.getByText("默认", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "编辑笔名 青舟" }).click();
  await page.getByLabel("笔名名称").fill("青舟子");
  await page.getByRole("button", { name: "保存笔名" }).click();
  await expect(page.getByText("笔名已保存。")).toBeVisible();
  await expect(page.locator(".pen-name-row").filter({ hasText: "青舟子" })).toBeVisible();

  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "删除笔名 青舟子" }).click();
  await expect(page.getByText("笔名已删除。")).toBeVisible();
  await expect(page.getByText("还没有笔名")).toBeVisible();

  const pool = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
  });
  try {
    const owner = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
      [
        uuidV7(),
        owner.rows[0]?.id,
        createHash("sha256").update(randomBytes(32).toString("hex")).digest("hex"),
        "Second Device",
        "203.0.113.20",
      ],
    );
  } finally {
    await pool.end();
  }

  await page.reload();
  await expect(page.locator(".account-session-row")).toHaveCount(2);
  const otherDevice = page.locator(".account-session-row").filter({ hasNotText: "当前设备" });
  await expect(otherDevice).toHaveCount(1);
  await otherDevice.getByRole("button", { name: /退出设备/ }).click();
  await expect(page.getByText("已退出该设备。")).toBeVisible();
  await expect(page.locator(".account-session-row")).toHaveCount(1);

  await page.getByRole("button", { name: "退出所有设备" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("account loading states hold at four viewports", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.route(
    (url) => url.pathname === "/api/v1/users/me/pen-names",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/auth/sessions",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    },
  );

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await expect(page.getByText("正在加载账号资料")).toBeVisible();
    await expect(page.getByText("正在加载登录设备")).toBeVisible();
    await expect(page.getByText("还没有笔名")).toBeVisible();
    await expect(page.locator(".account-session-row")).toHaveCount(1);
  }
});

test("account error state holds at four viewports", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.route(
    (url) => url.pathname === "/api/v1/users/me/pen-names",
    async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "笔名加载失败。",
            details: {},
            requestId: "req_e2e_pen_names",
          },
        }),
      });
    },
  );

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await expect(page.getByText("笔名加载失败。")).toBeVisible();
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  }
});

test("account disabled state holds at four viewports", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.route("**/api/v1/users/me", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await page.getByLabel("显示名称").fill(`保存中作者${width}`);
    await page.getByRole("button", { name: "保存资料" }).click();
    await expect(page.getByRole("button", { name: "保存中" })).toBeDisabled();
    await expect(page.getByText("账号资料已保存。")).toBeVisible();
  }
});

test("account rate-limit state holds at four viewports", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await page.route("**/api/v1/users/me", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "AUTH_RATE_LIMITED",
          message: "操作过于频繁，请稍后再试。",
          details: {},
          requestId: "req_e2e_account_limit",
        },
      }),
    });
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await page.getByLabel("显示名称").fill(`限流作者${width}`);
    await page.getByRole("button", { name: "保存资料" }).click();
    await expect(page.getByText("操作过于频繁，请稍后再试。")).toBeVisible();
  }
});

test("account session-expired state holds at four viewports", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "nb_session",
      value: "stale-session",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await expect(page).toHaveURL(/\/login\?reason=session-expired$/);
    await expect(page.getByText("登录状态已失效，请重新登录。")).toBeVisible();
  }
});

test("disabled accounts redirect to the permission state at four viewports", async ({
  page,
  context,
  request,
}) => {
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

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await expect(page).toHaveURL(/\/login\?reason=permission$/);
    await expect(page.getByText("当前账号无权访问此页面。")).toBeVisible();
  }
});

test("account settings holds at all four viewports", async ({ page, context, request }) => {
  await authenticatedPage(page, context, request);
  await freezeApiTimestamps(page);
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/settings/account");
    await expect(page).toHaveURL(/\/workspace\/settings\/account$/u);
    await expect(page.getByRole("heading", { name: "把写作环境准备好" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "模型设置作者" })).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page).toHaveScreenshot(
      ["account-settings", `account-settings-${width}.png`],
      productionScreenshotOptions,
    );
  }
});

async function expectNoInternalTerms(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Provider");
  expect(text).not.toContain("provider_error");
  expect(text).not.toContain("model_config");
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  const timestamp = Date.now();
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
