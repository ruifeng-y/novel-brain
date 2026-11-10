import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  createStyleArc,
  createStyleChapter,
  createStyleCharacter,
  createStyleProfile,
} from "../helpers/styles";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  freezeApiTimestamps,
  productionScreenshotOptions,
} from "../helpers/ui";

const origin = "http://localhost:3000";

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
  const workContext = page.getByLabel("当前作品与创作线");
  await expect(workContext).toContainText("一部标题很长但仍然需要保持清晰可读的作品");
  await expect(workContext).toContainText("主线");
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
  await expect(page.locator(".overview-next")).toBeVisible();
  await expect(page.locator(".stat-grid .stat-card")).toHaveCount(6);
  await expect(page.locator(".overview-chapters")).toBeVisible();
  await expect(page.locator(".overview-links")).toBeVisible();
});

test("overview handles error and four viewports", async ({ page, context }) => {
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
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
  await freezeApiTimestamps(page);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/overview`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/overview$`, "u"));
    await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page).toHaveScreenshot(
      ["work-overview", `work-overview-${width}.png`],
      productionScreenshotOptions,
    );
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
  await expect(page.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
    "href",
    "/workspace",
  );
  await expect(page.getByText("还没有章节。可以先从大纲创建第一章。")).toBeVisible();
  await expect(page.getByLabel("当前作品与创作线")).toContainText("作品已归档 · 只读");
});

test("shows completed work as read-only with a return path", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "完本作品",
  });
  const pool = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
  });
  try {
    await pool.query("UPDATE works SET status = 'completed' WHERE id = $1", [work.id]);
  } finally {
    await pool.end();
  }

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByText("作品已完本，当前为只读状态。可返回工作台查看版本。")).toBeVisible();
  await expect(page.getByRole("button", { name: "作品已完本" })).toBeDisabled();
  await expect(page.getByText("创作线状态 只读")).toBeVisible();
  await expect(page.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
    "href",
    "/workspace",
  );
  await expect(page.getByLabel("当前作品与创作线")).toContainText("作品已完本 · 只读");
});

test("shows current branch, recent changes and long content at four viewports", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const longTitle =
    "忘川书页里反复出现的名字与断臂之后仍未说完的旧事，以及一条必须被清楚看见却不会撑破布局的长标题";
  const longIdea =
    "沈砚在荒寺醒来时只记得自己失去过一段重要记忆。他沿着旧信、铜牌和断臂留下的线索追查身世，同时必须在宗门、血河宗与天门之间作出选择。".repeat(
      8,
    );
  const work = await createWork(page.request, {
    mode: "idea",
    title: longTitle,
    idea: longIdea,
    genre: "xianxia",
    scaleTarget: "epic",
    chapterLengthTarget: 4200,
  });

  for (let index = 1; index <= 6; index += 1) {
    await createStyleChapter(
      page,
      work,
      index,
      `第 ${index} 章 · ${"铜牌背面与旧信夹层里的名字".repeat(4)}`,
      `第 ${index} 章长内容。${"沈砚没有回头，风从荒寺的瓦上压下来。".repeat(80)}`,
    );
  }
  for (let index = 1; index <= 6; index += 1) {
    const token = await getCsrf(page.request);
    const response = await page.request.post(
      `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`,
      {
        headers: { Origin: origin, "X-CSRF-Token": token },
        data: {
          type: "world_rule",
          name: `第 ${index} 条长世界规则 · ${"天门与记忆代价".repeat(5)}`,
          aliases: [],
          summary: "失去关键记忆的人无法通过天门，守门人必须核对全部旧约。".repeat(4),
          description: "",
          tags: ["长内容"],
          data: { rule: "主动抹除关键记忆会导致天门通行失败。".repeat(4) },
        },
      },
    );
    expect(response.status()).toBe(201);
  }

  await freezeApiTimestamps(page);
  await page.reload();
  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();
  await expect(page.getByLabel("当前作品与创作线")).toContainText(longTitle);
  await expect(page.getByLabel("当前作品与创作线")).toContainText("主线");
  await expect(page.getByText("当前创作线：主线")).toBeVisible();
  await expect(page.getByRole("heading", { name: "待处理" })).toBeVisible();
  await expect(page.locator(".overview-task-item")).not.toHaveCount(0);
  await expect(page.getByRole("heading", { name: "最近修改" })).toBeVisible();
  await expect(page.locator(".overview-change-item")).toHaveCount(5);
  await expect(page.locator(".overview-change-list")).toContainText("长世界规则");
  await expectAuthorFacingLanguage(page);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/overview$`, "u"));
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page).toHaveScreenshot(
      ["work-overview", `work-overview-long-${width}.png`],
      productionScreenshotOptions,
    );
  }
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
