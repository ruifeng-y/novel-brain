import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { seedM1Structure, type M1Work } from "../helpers/m1";
import { expectAuthorFacingLanguage } from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440] as const;

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async () => {
  await resetRateLimits();
});

async function authenticatedPage(page: Page, context: BrowserContext, request: APIRequestContext) {
  const email = uniqueEmail("m1-closeout");
  const session = await registerUser(request, email, "StrongPassword123", "M1 验收作者");
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

async function createM1Work(request: APIRequestContext): Promise<M1Work> {
  return (await createWork(request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  })) as M1Work;
}

test("completes the M1 author loop through outline, writing, facts and volume audit", async ({
  page,
  context,
  request,
}, testInfo) => {
  await authenticatedPage(page, context, request);

  await page.goto("/workspace/new-project");
  await page.getByLabel("书名").fill("忘川书");
  await page.getByLabel("故事灵感").fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  const workId = /\/workspace\/([0-9a-f-]+)\/overview/.exec(page.url())?.[1];
  expect(workId).toBeTruthy();
  const workResponse = await request.get(`/api/v1/works/${workId}`);
  expect(workResponse.ok()).toBe(true);
  const work = (await workResponse.json()).data as M1Work;

  await page.goto(`/workspace/${work.id}/bible`);
  await page.locator(".story-bible-empty").getByRole("button", { name: "生成九卡提案" }).click();
  await expect(page.getByRole("heading", { name: "九卡已完整" })).toBeVisible();
  await page.getByRole("button", { name: "锁定故事圣经" }).click();
  await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();

  const fixture = await seedM1Structure(request, work, { skipBible: true });

  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
  await expectAuthorFacingLanguage(page);

  await page.goto(`/workspace/${work.id}/outline`);
  await expect(page.getByRole("heading", { name: "大纲工作台" })).toBeVisible();
  await expect(page.getByText("第一卷 · 忘川").first()).toBeVisible();
  await expect(page.getByText("第一幕 · 断臂").first()).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByRole("tab", { name: "黄金三章" }).click();
  await expect(page.getByText("黄金三章已锁定")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${fixture.generationChapterId}`);
    await page.getByRole("button", { name: "生成整章" }).click();
    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 20_000 });

    const factsPanel = page.getByRole("region", { name: "本章事实" });
    const optionalFact = factsPanel
      .locator(".writing-fact-card")
      .filter({ has: page.locator(".writing-fact-risk-low") })
      .first();
    await expect(optionalFact).toBeVisible();
    await optionalFact.getByRole("button", { name: "驳回" }).click();
    await expect(optionalFact.getByText("已驳回", { exact: true })).toBeVisible();

    for (const risk of ["high", "medium"]) {
      const fact = factsPanel
        .locator(".writing-fact-card")
        .filter({ has: page.locator(`.writing-fact-risk-${risk}`) });
      await fact.getByRole("button", { name: "确认", exact: true }).click();
      await expect(fact.getByText("已确认", { exact: true })).toBeVisible();
    }
    await factsPanel.getByRole("button", { name: "批准本章" }).click();
    await expect(factsPanel.getByText("已满足提交条件，可以提交本章事实。")).toBeVisible();
    await factsPanel.getByRole("button", { name: "提交本章事实" }).click();
    await expect(factsPanel.getByRole("button", { name: "本章事实已提交" })).toBeDisabled();
    await expect(factsPanel.getByText("摘要已更新")).toBeVisible();
    await expectAuthorFacingLanguage(page);
  } finally {
    await worker.stop();
  }

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByRole("heading", { name: "卷末审计" })).toBeVisible();
  await page.getByRole("button", { name: "开始卷末审计" }).click();
  const audit = page.locator(".overview-volume-audit");
  await expect(audit.locator('[data-volume-audit-status="blocked"]')).toBeVisible();
  await expect(
    audit.locator('[data-volume-audit-finding="UNRESOLVED_LEDGER_ENTRY"]'),
  ).toBeVisible();
  await expect(audit.locator('[data-volume-audit-finding="MOTIVATION_BREAK"]')).toBeVisible();
  await expect(audit).toContainText("章节检查");
  await expect(audit).toContainText("第 2 章");
  await expectAuthorFacingLanguage(page);

  await audit.getByLabel("验收结论").selectOption("changes_requested");
  await audit
    .getByLabel("签收意见")
    .fill("父母之死伏笔仍未收束，第 2 章动机断裂需要补足因果后再验收。");
  await audit.getByRole("button", { name: "保存签收记录" }).click();
  await expect(audit.getByText("作者要求修改")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await testInfo.attach("m1-full-loop-completed", {
    body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
    contentType: "image/png",
  });
});

test("checks every M1 page at four viewports without claiming unsigned goldens", async ({
  page,
  context,
  request,
}, testInfo) => {
  await authenticatedPage(page, context, request);
  const work = await createM1Work(request);
  const fixture = await seedM1Structure(request, work);

  const pageContracts = [
    {
      id: "account-settings",
      path: "/workspace/settings/account",
      heading: "把写作环境准备好",
      ready: ".model-config-row, .model-empty",
    },
    {
      id: "work-overview",
      path: `/workspace/${work.id}/overview`,
      heading: work.title,
      ready: ".overview-hero",
    },
    {
      id: "bible",
      path: `/workspace/${work.id}/bible`,
      heading: work.title,
      ready: ".story-bible-layout",
    },
    {
      id: "settings",
      path: `/workspace/${work.id}/settings`,
      heading: "设定中心",
      ready: ".settings-workspace-grid",
    },
    {
      id: "outline",
      path: `/workspace/${work.id}/outline`,
      heading: "大纲工作台",
      ready: ".outline-plan-page",
    },
    {
      id: "foreshadows",
      path: `/workspace/${work.id}/foreshadows`,
      heading: "埋下的，都要有回收计划",
      ready: ".foreshadow-page",
    },
    {
      id: "writing",
      path: `/workspace/${work.id}/write?chapterId=${fixture.generationChapterId}`,
      heading: "写作台",
      ready: ".writing-editor",
    },
  ] as const;

  for (const pageContract of pageContracts) {
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pageContract.path);
      await expect(page.getByRole("heading", { name: pageContract.heading }).first()).toBeVisible();
      await expect(page.locator(pageContract.ready).first()).toBeVisible();
      await expectAuthorFacingLanguage(page);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await testInfo.attach(`${pageContract.id}-${width}`, {
        body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
        contentType: "image/png",
      });
    }
  }

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await page.locator(".settings-column-nav").getByRole("button", { name: /^人物/ }).click();
    await page
      .locator(".settings-entity-card", { hasText: "沈砚" })
      .first()
      .getByRole("button", { name: "查看设定详情" })
      .click();
    const detail = page.locator(".settings-entity-detail");
    await expect(detail.getByRole("heading", { name: "沈砚" })).toBeVisible();
    await expect(detail.getByText("隐藏忘川书的外门杂役。")).toBeVisible();
    await expect(detail.getByRole("heading", { name: "详细说明" })).toBeVisible();
    await expectAuthorFacingLanguage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach(`entity-detail-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  const csrf = await getCsrf(request);
  expect(csrf.length).toBeGreaterThan(20);
  expect(origin).toBe("http://localhost:3000");
});
