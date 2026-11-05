import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("settings");
  const session = await registerUser(page.request, email, "StrongPassword123", "设定作者");
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

async function createSettingsWork(page: Page) {
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  return work;
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("creates, edits and locks a minimal setting, then views confirmed settings read-only", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);

  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
  await expect(page.locator(".settings-column-nav .settings-column-item span")).toHaveText([
    "世界",
    "势力",
    "人物",
    "地图",
    "力量体系",
    "物品功法",
    "时间线",
  ]);
  await expect(page.getByText("还没有世界规则")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByRole("button", { name: "新增设定" }).click();
  await page.getByRole("combobox", { name: "设定类型" }).selectOption("world_rule");
  await page.getByRole("textbox", { name: "名称" }).fill("天门只认完整记忆");
  await page.getByRole("textbox", { name: "别名" }).fill("完整记忆律");
  await page.getByRole("textbox", { name: "一句话摘要" }).fill("失去关键记忆的人无法通过天门。");
  await page.getByRole("textbox", { name: "详细说明" }).fill("此规则对仙、凡、灵三界同时生效。");
  await page
    .getByRole("textbox", { name: "世界规则" })
    .fill("主动抹除关键记忆会导致天门通行失败。");
  await page.getByRole("button", { name: "创建设定" }).click();

  const worldCard = page.locator(".settings-entity-card", { hasText: "天门只认完整记忆" });
  await expect(worldCard).toBeVisible();
  await worldCard.getByRole("button", { name: "查看设定详情" }).click();
  const detail = page.locator(".settings-entity-detail");
  await expect(detail.getByRole("heading", { name: "天门只认完整记忆" })).toBeVisible();
  await expect(detail.getByText("内容：主动抹除关键记忆会导致天门通行失败。")).toBeVisible();
  await expect(detail.getByText("第 1 版")).toBeVisible();

  await page.getByRole("button", { name: "编辑设定" }).click();
  await page
    .getByRole("textbox", { name: "一句话摘要" })
    .fill("失去关键记忆的人无法通过天门，也无法伪造完整人格。");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(detail.getByText("第 2 版")).toBeVisible();

  await page.getByRole("button", { name: "锁定设定" }).click();
  await expect(page.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "已锁定 · 别名需修改请求" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "已锁定 · 删除需修改请求" })).toBeDisabled();

  await page.getByRole("button", { name: "查看已确认设定" }).click();
  const confirmed = page.locator(".confirmed-settings");
  await expect(confirmed.getByRole("heading", { name: "已确认设定" })).toBeVisible();
  await expect(confirmed.getByText("天门只认完整记忆")).toBeVisible();
  await expect(confirmed.getByText("作者创建")).toBeVisible();
  await expect(confirmed.getByText("状态：已确认")).toBeVisible();
  await expect(confirmed.getByRole("button", { name: /编辑|删除|锁定/ })).toHaveCount(0);
  await expect(page.locator(".settings-detail-rail").getByRole("button")).toHaveCount(0);

  for (const column of ["势力", "地图", "物品功法", "时间线"]) {
    await page
      .locator(".settings-column-nav")
      .getByRole("button", { name: new RegExp(`^${column}`) })
      .click();
    await expect(page.getByText("这个栏目将在后续能力中开放。")).toBeVisible();
  }

  const token = await getCsrf(page.request);
  const foreign = await page.request.get(
    `/api/v1/works/${work.id}/branches/00000000-0000-7000-8000-000000000000/entities`,
  );
  expect(foreign.status()).toBe(403);
  expect(token.length).toBeGreaterThan(20);
});

test("holds the seven-column settings layout at all four viewports", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const token = await getCsrf(page.request);
  const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
  await page.request.post(entitiesPath, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      type: "character",
      name: "沈砚",
      aliases: ["小砚"],
      summary: "外门杂役，正在隐藏忘川书的存在。",
      description: "谨慎、记仇，但会为救过自己的人承担风险。",
      tags: ["主角"],
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀。",
        relationshipSummary: "与顾青表面亲近，实际互相试探。",
      },
    },
  });
  const goldenToken = await getCsrf(page.request);
  await page.request.post(entitiesPath, {
    headers: { Origin: origin, "X-CSRF-Token": goldenToken },
    data: {
      type: "golden_finger",
      name: "忘川书",
      aliases: [],
      summary: "以重要记忆换取前人经验。",
      description: "每次翻页都会永久失去一段记忆。",
      tags: ["核心金手指"],
      data: {
        rules: "每次只能借用一位前人的经验。",
        cost: "永久失去一段重要记忆。",
        limits: "每次使用消耗一页。",
        growth: "缺失的记忆会逐步拼成完整人格。",
      },
    },
  });

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
    await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
    await page.getByRole("button", { name: /^人物/ }).click();
    await expect(page.getByText("沈砚")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`settings-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});
