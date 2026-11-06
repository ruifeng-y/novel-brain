import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import {
  mailCode,
  mailPasswordResetToken,
  registerUser,
  resetRateLimits,
  sendCode,
  uniqueEmail,
} from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const viewports = [390, 900, 1180, 1440] as const;

test.beforeEach(async () => {
  await resetRateLimits();
});

test("auth pages match the shell at four viewports", async ({ page }, testInfo) => {
  const pages = [
    { id: "login", path: "/login", heading: "欢迎回来", tab: "登录" },
    { id: "register", path: "/register", heading: "创建作者账号", tab: "注册" },
    { id: "forgot", path: "/forgot-password", heading: "找回密码", tab: "找回密码" },
    {
      id: "reset",
      path: `/reset-password?token=${"t".repeat(64)}`,
      heading: "设置新密码",
      tab: "找回密码",
    },
  ] as const;

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    for (const pageContract of pages) {
      await page.goto(pageContract.path);
      await expect(page.getByRole("heading", { name: pageContract.heading })).toBeVisible();
      await expect(page.getByRole("tab", { name: pageContract.tab })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expectAuthorFacingLanguage(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
      expect(screenshot.byteLength).toBeGreaterThan(10_000);
      await testInfo.attach(`${pageContract.id}-${width}`, {
        body: screenshot,
        contentType: "image/png",
      });
    }
  }
});

test("loading and disabled states hold at four viewports", async ({ page }) => {
  await page.route("**/api/v1/auth/register/send-code", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/register");
    await page.getByLabel("邮箱").fill(uniqueEmail("auth-loading"));
    await page.getByRole("button", { name: "发送验证码" }).click();

    await expect(page.getByRole("button", { name: "发送中" })).toBeDisabled();
    await expect(page.getByText("验证码已发送，请检查邮箱。")).toBeVisible();
  }
});

test("login error state holds at four viewports", async ({ page }) => {
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(uniqueEmail("missing-login"));
    await page.getByLabel("密码").fill("StrongPassword123");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByText("邮箱或密码不正确。")).toBeVisible();
  }
});

test("registers, enters the workspace and logs out", async ({ page }) => {
  const email = uniqueEmail("register");
  await page.goto("/register");
  await page.getByLabel("邮箱").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "发送验证码" });
  await expect(sendCodeButton).toBeEnabled();
  await sendCodeButton.click();
  await expect(page.getByText("验证码已发送，请检查邮箱。")).toBeVisible();
  await page.getByLabel("验证码").fill(await mailCode(email));
  await page.getByLabel("显示名称").fill("新作者");
  await page.getByLabel("密码").fill("StrongPassword123");
  await page.getByRole("button", { name: "注册并进入" }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByText("新作者", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("logs in and reaches the authenticated shell", async ({ page, request }) => {
  const email = uniqueEmail("login");
  await registerUser(request, email, "StrongPassword123", "林见鹿");

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("StrongPassword123");
  const loginButton = page.getByRole("button", { name: "登录" });
  await expect(loginButton).toBeEnabled();
  await loginButton.click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("林见鹿", { exact: true })).toBeVisible();
});

test("recovers a forgotten password from the email link", async ({ page, request }) => {
  const email = uniqueEmail("password-reset");
  const newPassword = "NewStrongPassword456";
  await registerUser(request, email, "StrongPassword123", "找回密码作者");

  await page.goto("/forgot-password");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送重置链接" }).click();
  await expect(
    page.getByText("如果该邮箱已注册，重置链接会发送到邮箱。链接 30 分钟内有效。"),
  ).toBeVisible();

  const token = await mailPasswordResetToken(email);
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel("新密码", { exact: true }).fill(newPassword);
  await page.getByLabel("再次输入新密码").fill(newPassword);
  await page.getByRole("button", { name: "重置密码" }).click();
  await expect(page.getByText("密码已重置，请使用新密码重新登录。")).toBeVisible();

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel("新密码", { exact: true }).fill("AnotherPassword789");
  await page.getByLabel("再次输入新密码").fill("AnotherPassword789");
  await page.getByRole("button", { name: "重置密码" }).click();
  await expect(page.getByText("重置链接无效、已使用或已过期，请重新申请。")).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(newPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("找回密码作者", { exact: true })).toBeVisible();
});

test("stale sessions redirect to login with an expired-session message at four viewports", async ({
  page,
  context,
}) => {
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
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/login\?reason=session-expired$/);
    await expect(page.getByText("登录状态已失效，请重新登录。")).toBeVisible();
  }
});

test("rate-limit errors are visible and recoverable at four viewports", async ({
  page,
  request,
}) => {
  for (const width of viewports) {
    await resetRateLimits();
    const email = uniqueEmail("rate-limit");
    await sendCode(request, email);

    await page.setViewportSize({ width, height: 900 });
    await page.goto("/register");
    await page.getByLabel("邮箱").fill(email);
    const sendCodeButton = page.getByRole("button", { name: "发送验证码" });
    await expect(sendCodeButton).toBeEnabled();
    await sendCodeButton.click();
    await expect(page.getByText("操作过于频繁，请稍后再试。")).toBeVisible();
  }
});

test("disabled accounts redirect to the permission state at four viewports", async ({
  page,
  context,
  request,
}) => {
  const email = uniqueEmail("disabled");
  const sessionCookie = await registerUser(request, email, "StrongPassword123", "禁用作者");
  await context.addCookies([
    {
      name: "nb_session",
      value: sessionCookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace$/);

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

  const disabledSession = await request.get("/api/v1/auth/me", {
    headers: { cookie: `nb_session=${sessionCookie}` },
  });
  expect(disabledSession.status()).toBe(403);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/login\?reason=permission$/);
    await expect(page.getByText("当前账号无权访问此页面。")).toBeVisible();
  }
});
