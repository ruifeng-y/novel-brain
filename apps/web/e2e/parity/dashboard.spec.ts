import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("dashboard");
  const session = await registerUser(page.request, email, "StrongPassword123", "作品库作者");
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
  await page.goto("/workspace");
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("shows the empty work library with a real create action", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expect(page.getByText("还没有作品", { exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "还没有作品" })
    .getByRole("link", { name: "新建作品" })
    .click();
  await expect(page).toHaveURL(/\/workspace\/new-project$/);
});

test("lists, searches and filters works", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await createWork(page.request, {
    mode: "blank",
    title: "长夜行",
    genre: "xianxia",
    scaleTarget: "long",
  });
  await createWork(page.request, {
    mode: "blank",
    title: "都市回声",
    genre: "urban",
    scaleTarget: "medium",
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "长夜行" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "都市回声" })).toBeVisible();
  await page.getByLabel("搜索作品").fill("长夜");
  await expect(page.getByRole("heading", { name: "长夜行" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "都市回声" })).toHaveCount(0);

  await page.getByLabel("搜索作品").fill("");
  await page.getByLabel("题材筛选").selectOption("urban");
  await expect(page.getByRole("heading", { name: "都市回声" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "长夜行" })).toHaveCount(0);
});

test("shows loading, disabled and long-content states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const longTitle = "一部标题很长很长但仍然需要在作品卡片里保持清晰可读并且不能撑破布局的长篇作品";
  await createWork(page.request, {
    mode: "blank",
    title: longTitle,
  });

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/works?*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载作品")).toBeVisible();
  release?.();

  await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: "管理" })).toBeDisabled();
});

test("loads additional pages for a long work list", async ({ page, context }) => {
  await authenticatedPage(page, context);
  for (let index = 1; index <= 22; index += 1) {
    await createWork(page.request, {
      mode: "blank",
      title: `批量作品 ${String(index).padStart(2, "0")}`,
    });
  }
  await page.reload();

  await expect(page.getByRole("heading", { name: /批量作品/ })).toHaveCount(20);
  await page.getByRole("button", { name: "加载更多作品" }).click();
  await expect(page.getByRole("heading", { name: /批量作品/ })).toHaveCount(22);
});

test("dashboard states and four viewports hold", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  await page.route("**/api/v1/works?*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品库加载失败。",
          details: {},
          requestId: "req_dashboard_error",
        },
      }),
    });
  });
  await page.reload();
  await expect(page.getByText("作品库加载失败。")).toBeVisible();
  await page.unroute("**/api/v1/works?*");

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`dashboard-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide" }),
      contentType: "image/png",
    });
  }
});
