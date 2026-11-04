import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("new-project");
  const session = await registerUser(page.request, email, "StrongPassword123", "新建作品作者");
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
  await page.goto("/workspace/new-project");
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("creates a work from an idea and opens its overview", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await expect(page.getByRole("heading", { name: "把一个想法，长成一本书" })).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByLabel("书名").fill("忘川书");
  await page.getByLabel("故事灵感").fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "忘川书" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "主创作线" })).toBeVisible();
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
});

test("creates a blank work without an idea", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "空白作品", exact: true }).click();
  await expect(page.getByLabel("故事灵感")).toHaveCount(0);

  await page.getByLabel("书名").fill("空白长篇");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "空白长篇" })).toBeVisible();
  await expect(page.getByText("还没有故事灵感", { exact: true })).toBeVisible();
});

test("creates a xianxia template work", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "题材模板", exact: true }).click();
  await page.getByLabel("书名").fill("仙途模板");
  await page.getByLabel("题材模板").selectOption("xianxia");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
  await expect(page.getByText("仙侠模板 · 修真文明", { exact: true })).toBeVisible();
});

test("shows loading, disabled, error and long-content states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const longTitle = "一部标题很长很长但仍然需要在创建预览里完整换行且不能撑破页面的仙侠作品";
  await page.getByLabel("书名").fill(longTitle);
  await page
    .getByLabel("故事灵感")
    .fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书，并决定追查自己的身世。");
  await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/works", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await gate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品创建失败。",
          details: {},
          requestId: "req_new_project_error",
        },
      }),
    });
  });

  const submit = page.getByRole("button", { name: "创建作品并进入总览" });
  await submit.click();
  await expect(submit).toBeDisabled();
  release?.();
  await expect(page.getByText("作品创建失败。")).toBeVisible();
  await expect(submit).toBeEnabled();
});
