import { expect, test, type APIRequestContext } from "@playwright/test";

async function resetMockApi(request: APIRequestContext) {
  await request.post("http://127.0.0.1:3001/__test/reset");
}

test.beforeEach(async ({ request }) => {
  await resetMockApi(request);
});

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
  await page.goto("/register");
  await page.getByLabel("邮箱").fill("new-author@example.com");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByText("验证码已发送，请检查邮箱。")).toBeVisible();
  await page.getByLabel("验证码").fill("123456");
  await page.getByLabel("显示名称").fill("新作者");
  await page.getByLabel("密码").fill("StrongPassword123");
  await page.getByRole("button", { name: "注册并进入" }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByText("新作者")).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("logs in and reaches the authenticated shell", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("lin@example.com");
  await page.getByLabel("密码").fill("StrongPassword123");
  await page.getByRole("button", { name: "登录" }).click();

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

test("rate-limit errors are visible and recoverable", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("邮箱").fill("rate-limited@example.com");
  const sendCode = page.getByRole("button", { name: "发送验证码" });
  await expect(sendCode).toBeEnabled();
  await sendCode.click();
  await expect(page.getByText("操作过于频繁，请稍后再试。")).toBeVisible();
});

test("permission-denied state is explicit", async ({ page }) => {
  await page.goto("/login?reason=permission");
  await expect(page.getByText("当前账号无权访问此页面。")).toBeVisible();
});
