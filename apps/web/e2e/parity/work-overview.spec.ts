import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createWork, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  createStyleArc,
  createStyleChapter,
  createStyleCharacter,
  createStyleProfile,
} from "../helpers/styles";
import { expectAuthorFacingLanguage } from "../helpers/ui";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("work-overview");
  const session = await registerUser(page.request, email, "StrongPassword123", "总览作者");
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
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("shows title, status, main branch, scale target and readiness", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "一部标题很长但仍然需要保持清晰可读的作品",
    idea: "一个失去名字的人，靠替别人写信找回自己的过去。",
    genre: "history",
    scaleTarget: "medium",
    chapterLengthTarget: 2600,
  });

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(
    page.getByRole("heading", { name: "一部标题很长但仍然需要保持清晰可读的作品" }),
  ).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "主创作线" })).toBeVisible();
  await expect(page.getByText("中篇", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "准备度" })).toBeVisible();
  await expect(
    page.locator(".readiness-item").getByText("主创作线", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".readiness-item").getByText("故事圣经", { exact: true }),
  ).toBeVisible();
});

test("overview handles error and four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "template",
    templateKey: "xianxia",
    title: "仙途模板",
  });

  await page.route(`**/api/v1/works/${work.id}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品总览加载失败。",
          details: {},
          requestId: "req_overview_error",
        },
      }),
    });
  });
  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByText("作品总览加载失败。")).toBeVisible();
  await page.unroute(`**/api/v1/works/${work.id}`);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/overview`);
    await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`work-overview-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide" }),
      contentType: "image/png",
    });
  }
});

test("shows loading and archived read-only states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "归档作品",
  });
  const pool = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
  });
  try {
    await pool.query("UPDATE works SET status = 'archived' WHERE id = $1", [work.id]);
  } finally {
    await pool.end();
  }

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/works/${work.id}`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/overview`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载作品总览")).toBeVisible();
  release?.();
  await expect(page.getByText("作品已归档，当前为只读状态。")).toBeVisible();
  await expect(page.getByText("已归档", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续写作" })).toBeDisabled();
});

test("approves a traceable style baseline and shows cross-volume drift with growth evidence", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const characterId = await createStyleCharacter(page, work);
  const baselineChapter = await createStyleChapter(
    page,
    work,
    1,
    "风声",
    "风停了。\n他没有回头。\n“走吧。”沈砚说。",
  );
  await createStyleChapter(
    page,
    work,
    2,
    "天裂",
    "不可能！！！这绝不可能！！！\n他看见天裂开了！！！血液像火一样燃烧！！！",
  );
  const growthChapter = await createStyleChapter(
    page,
    work,
    3,
    "火起",
    "他终于喊了出来！！！这声音烧穿了长夜！！！\n他不再压住胸口的火！！！",
  );
  await createStyleArc(page, work, characterId, baselineChapter.id);
  await createStyleProfile(page, work, characterId, baselineChapter.versionId);

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByRole("heading", { name: "跨卷一致性" })).toBeVisible();
  const pending = page.locator('[data-style-profile="pending"]');
  await expect(pending).toBeVisible();
  await pending.getByRole("button", { name: "批准为基线" }).click();
  await pending.getByRole("textbox", { name: "批准理由" }).fill("作者确认这是沈砚前期的稳定声线。");
  await pending.getByRole("button", { name: "确认批准" }).click();
  await expect(page.locator('[data-style-profile="approved"]')).toBeVisible();
  await expect(page.getByText("作者已批准")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByRole("button", { name: "检查跨卷趋势" }).click();
  const stylePanel = page.locator(".overview-style");
  await expect(stylePanel.locator('[data-style-drift-report="cross_volume"]')).toBeVisible();
  await expect(stylePanel.locator('[data-style-finding="CHARACTER_VOICE_DRIFT"]')).toContainText(
    "第 2 章",
  );
  const growth = stylePanel.locator('[data-style-finding="INTENTIONAL_CHARACTER_DEVELOPMENT"]');
  await expect(growth).toContainText("成长依据");
  await expect(growth).toContainText("克制，压住情绪");
  await expect(growth).toContainText("不再克制，情绪转为热烈");
  await expect(stylePanel).toContainText(`第 1–3 章`);
  await expect(stylePanel).toContainText("基线版本 2");
  await expectAuthorFacingLanguage(page);

  const chapterResponse = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${growthChapter.id}`,
  );
  expect(chapterResponse.ok()).toBe(true);
  expect((await chapterResponse.json()).data.currentVersion.content).toBe(growthChapter.content);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(stylePanel).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`work-overview-style-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});
