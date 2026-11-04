import { expect, test } from "@playwright/test";

import { mailCode, registerUser, sendCode, uniqueEmail } from "../helpers/auth";

test("auth page matches the shell at four viewports", async ({ page }, testInfo) => {
  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "登录" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
    await testInfo.attach(`auth-${width}`, { body: screenshot, contentType: "image/png" });
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
  await expect(page.getByText("新作者")).toBeVisible();

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
  await expect(page.getByText("林见鹿")).toBeVisible();
});

test("stale sessions redirect to login with an expired-session message", async ({
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

  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login\?reason=session-expired$/);
  await expect(page.getByText("登录状态已失效，请重新登录。")).toBeVisible();
});

test("rate-limit errors are visible and recoverable", async ({ page, request }) => {
  const email = uniqueEmail("rate-limit");
  await sendCode(request, email);

  await page.goto("/register");
  await page.getByLabel("邮箱").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "发送验证码" });
  await expect(sendCodeButton).toBeEnabled();
  await sendCodeButton.click();
  await expect(page.getByText("操作过于频繁，请稍后再试。")).toBeVisible();
});

test("permission-denied state is explicit", async ({ page }) => {
  await page.goto("/login?reason=permission");
  await expect(page.getByText("当前账号无权访问此页面。")).toBeVisible();
});
