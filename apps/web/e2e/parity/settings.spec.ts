import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440];

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
  return createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
}

async function createEntity(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  payload: Record<string, unknown>,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: payload,
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; version: number; name: string };
}

async function lockEntity(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  entity: { id: string; version: number },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entity.id}/lock`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: entity.version },
    },
  );
  expect(response.status()).toBe(200);
}

async function createProposal(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  entity: { id: string; version: number },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entity.id}/proposals`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        version: entity.version,
        reason: "这条设定需要作者确认后才能进入已确认设定。",
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "天门不会为失去记忆的人开启。",
            locator: "第 1 章 · 第 3 段",
            confidence: 0.9,
          },
        ],
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
    contentType: "image/png",
  });
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("creates typed settings in all seven columns with custom fields, proposals and change requests", async ({
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

  await page.getByRole("button", { name: "自定义字段" }).click();
  await page.getByRole("button", { name: "新增字段" }).click();
  await page.getByLabel("字段标识").fill("fate");
  await page.getByLabel("字段名称").fill("命格");
  await page.getByLabel("字段类型").selectOption("single_select");
  await page.getByLabel("适用对象").selectOption("character");
  await page.getByLabel("选项").fill("剑骨，凡骨");
  await page.getByLabel("必填").check();
  await page.getByRole("button", { name: "创建字段" }).click();
  await expect(page.locator(".settings-custom-field-row", { hasText: "命格" })).toBeVisible();

  await page
    .locator(".settings-column-nav")
    .getByRole("button", { name: /^物品功法/ })
    .click();
  await page.getByRole("button", { name: "新增物品功法" }).first().click();
  await page.getByLabel("名称").fill("听潮剑");
  await page.getByLabel("别名").fill("潮生");
  await page.getByLabel("一句话摘要").fill("会记录持剑者杀意的法器。");
  await page.getByLabel("详细说明").fill("太玄门内门弟子配剑。");
  await page.getByLabel("标签").fill("法器");
  await page.getByLabel("物品类型").selectOption("equipment");
  await page.getByLabel("分类", { exact: true }).fill("兵器");
  await page.getByLabel("品阶", { exact: true }).fill("玄阶");
  await page.getByLabel("效果", { exact: true }).fill("剑身会记录持剑者的杀意。");
  await page.getByLabel("代价", { exact: true }).fill("杀意过重时会反噬持剑者。");
  await page.getByLabel("归属方式").selectOption("unique");
  await page.getByLabel("装备位").fill("main_hand");
  await page.getByLabel("限制", { exact: true }).fill("不能离开主人超过七日。");
  await page.getByRole("button", { name: "创建设定" }).click();
  await expect(page.locator(".settings-entity-card", { hasText: "听潮剑" })).toBeVisible();
  await expect(page.locator(".settings-entity-detail").getByText("唯一")).toBeVisible();
  await expect(page.locator(".settings-entity-detail").getByText("main_hand")).toBeVisible();

  await page
    .locator(".settings-column-nav")
    .getByRole("button", { name: /^时间线/ })
    .click();
  await page.getByRole("button", { name: "新增时间线" }).first().click();
  await page.getByLabel("名称").fill("忘川村灭门");
  await page.getByLabel("一句话摘要").fill("十六年前改变沈砚命运的事件。");
  await page.getByLabel("纪元", { exact: true }).fill("大玄历");
  await page.getByLabel("故事时间", { exact: true }).fill("十六年前");
  await page.getByLabel("持续时长", { exact: true }).fill("一夜");
  await page.getByLabel("事件", { exact: true }).fill("沈砚父母被杀，真相被伪装成自杀。");
  await page.getByRole("button", { name: "创建设定" }).click();
  await expect(page.locator(".settings-entity-card", { hasText: "忘川村灭门" })).toBeVisible();

  await page.locator(".settings-column-nav").getByRole("button", { name: /^人物/ }).click();
  await page.getByRole("button", { name: "新增人物档案" }).first().click();
  await page.getByLabel("名称").fill("沈砚");
  await page.getByLabel("别名").fill("小砚");
  await page.getByLabel("一句话摘要").fill("外门杂役，正在隐藏忘川书的存在。");
  await page.getByLabel("当前身体状态").fill("左臂骨折，不能双手结印。");
  await page.getByLabel("知识边界").fill("不知道父母死于仇杀。");
  await page.getByLabel("关系摘要").fill("与顾青表面亲近，实际互相试探。");
  await page.getByLabel(/命格/).selectOption("剑骨");
  await page.getByRole("button", { name: "创建设定" }).click();

  const detail = page.locator(".settings-entity-detail");
  await expect(detail.getByRole("heading", { name: "沈砚" })).toBeVisible();
  await expect(detail.getByText("命格")).toBeVisible();
  await expect(detail.getByText("剑骨")).toBeVisible();

  await detail.getByRole("button", { name: "锁定设定" }).click();
  await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "已锁定 · 别名需修改请求" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "已锁定 · 删除需修改请求" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "发起修改请求" })).toBeEnabled();

  await detail.getByRole("button", { name: "发起修改请求" }).click();
  await page.getByLabel("修改标题").fill("补全沈砚状态");
  await page.getByLabel("修改原因").fill("第 48 章正文写明左臂恢复了一部分。");
  await page.getByLabel("一句话摘要").fill("外门杂役，正在隐藏忘川书的存在。");
  await page.getByRole("button", { name: "提交修改请求" }).click();
  await expect(detail.getByText("补全沈砚状态")).toBeVisible();
  await expect(detail.getByText("第 48 章正文写明左臂恢复了一部分。").first()).toBeVisible();

  await page.locator(".settings-column-nav").getByRole("button", { name: /^世界/ }).click();
  await page.getByRole("button", { name: "新增世界规则" }).first().click();
  await page.getByLabel("名称").fill("天门只认完整记忆");
  await page.getByLabel("一句话摘要").fill("失去关键记忆的人无法通过天门。");
  await page
    .getByRole("textbox", { name: "世界规则" })
    .fill("主动抹除关键记忆会导致天门通行失败。");
  await page.getByRole("button", { name: "创建设定" }).click();

  await expect(detail.getByRole("heading", { name: "天门只认完整记忆" })).toBeVisible();
  await detail.getByRole("button", { name: "提交提案" }).click();
  await page.getByLabel("提案理由").fill("从第一章提取到需要作者确认的世界规则。");
  await page.getByLabel("证据来源").fill("第 1 章");
  await page.getByLabel("证据摘录").fill("天门不会为失去记忆的人开启。");
  await page.locator(".settings-proposal-form").getByRole("button", { name: "提交提案" }).click();
  await expect(detail.getByText("待裁决", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "确认提案" })).toBeEnabled();
  await detail.getByRole("button", { name: "确认提案" }).click();
  await expect(detail.getByText("已锁定").first()).toBeVisible();
  await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
});

test("holds the empty settings state at all four viewports", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
    await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
    await expect(page.getByText("还没有世界规则")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-empty-${width}`);
  }
});

test("holds the locked state at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entity = await createEntity(page, work, {
    type: "world_rule",
    name: "天门只认完整记忆",
    aliases: ["完整记忆律"],
    summary: "失去关键记忆的人无法通过天门。",
    description: "",
    tags: [],
    data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
  });
  await lockEntity(page, work, entity);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await page.getByRole("button", { name: "查看设定详情" }).click();
    const detail = page.locator(".settings-entity-detail");
    await expect(detail.getByText("已锁定").first()).toBeVisible();
    await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
    await expect(detail.getByRole("button", { name: "发起修改请求" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-locked-${width}`);
  }
});

test("holds the proposal state at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entity = await createEntity(page, work, {
    type: "world_rule",
    name: "天门只认完整记忆",
    aliases: [],
    summary: "失去关键记忆的人无法通过天门。",
    description: "",
    tags: [],
    data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
  });
  await createProposal(page, work, entity);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await page.getByRole("button", { name: "查看设定详情" }).click();
    const detail = page.locator(".settings-entity-detail");
    await expect(detail.getByText("待确认").first()).toBeVisible();
    await expect(detail.getByText("待裁决", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "确认提案" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-proposal-${width}`);
  }
});

test("holds a long settings list at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  for (let index = 1; index <= 10; index += 1) {
    await createEntity(page, work, {
      type: "world_rule",
      name: `第 ${index} 条世界规则`,
      aliases: [],
      summary: "这是一条用于验证长列表和响应式布局的世界规则。",
      description: "规则内容需要保持可读，并且不能把页面横向撑开。",
      tags: [],
      data: { rule: "所有角色都必须遵守这条规则。" },
    });
  }

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page.locator(".settings-entity-card")).toHaveCount(10);
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-long-${width}`);
  }
});

test("holds the error state at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(`**${entitiesPath}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "设定加载失败。",
            details: {},
            requestId: "req_settings_error",
          },
        }),
      });
    });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page.getByText("设定加载失败。")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-error-${width}`);
    await page.unroute(`**${entitiesPath}`);
  }
});

test("shows a loading state and recovers from a failed settings load", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

  await page.route(`**${entitiesPath}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.getByText("正在加载设定中心")).toBeVisible();
  await page.unroute(`**${entitiesPath}`);
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
});
