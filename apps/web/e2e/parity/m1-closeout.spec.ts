import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { seedM1Structure, type M1Work } from "../helpers/m1";
import { createModelConfig } from "../helpers/m0";
import { expectAuthorFacingLanguage } from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440] as const;
const goldenThreeReviewDimensions = [
  "opening_hook",
  "protagonist_appeal",
  "world_rules",
  "core_conflict",
  "reader_promise",
  "chapter_end_hook",
] as const;

test.describe.configure({ timeout: 240_000 });

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

async function recordGoldenThreeReviews(request: APIRequestContext, branchPath: string) {
  const token = await getCsrf(request);
  const workspaceResponse = await request.get(`${branchPath}/golden-three`);
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = (await workspaceResponse.json()).data as {
    selectedCandidateId: string | null;
    candidates: Array<{
      id: string;
      version: number;
      pins: Array<{
        chapterId: string;
        chapterVersionId: string;
        content: string;
      }>;
    }>;
  };
  const candidate = workspace.candidates.find(
    (entry) => entry.id === workspace.selectedCandidateId,
  );
  expect(candidate).toBeTruthy();
  const pin = candidate!.pins[0]!;
  const reviewResponse = await request.put(
    `${branchPath}/golden-three/candidates/${candidate!.id}/reviews`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        version: candidate!.version,
        reviews: goldenThreeReviewDimensions.map((dimension, index) => ({
          dimension,
          score: 4,
          evidence: {
            chapterId: pin.chapterId,
            chapterVersionId: pin.chapterVersionId,
            passage: pin.content,
            locator: `第 ${index + 1} 个评审维度 · 开篇`,
          },
          reviewerOrigin: "critic",
        })),
      },
    },
  );
  expect(reviewResponse.status()).toBe(200);
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
  await createModelConfig(request);

  await page.goto(`/workspace/${work.id}/bible`);
  await page.locator(".story-bible-empty").getByRole("button", { name: "生成九卡提案" }).click();
  await expect(page.getByRole("heading", { name: "九卡已完整" })).toBeVisible();
  await page.getByRole("button", { name: "锁定故事圣经" }).click();
  await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();

  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
  await createSettingsThroughUi(page);
  await expectAuthorFacingLanguage(page);

  await createOutlineThroughUi(page, work);
  await expectAuthorFacingLanguage(page);

  const chapterResponse = await request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`,
  );
  expect(chapterResponse.ok()).toBe(true);
  const chapters = (await chapterResponse.json()).data as Array<{ id: string; number: number }>;
  const chapterByNumber = new Map(chapters.map((chapter) => [chapter.number, chapter]));
  const chapterOne = chapterByNumber.get(1)!;
  const chapterTwo = chapterByNumber.get(2)!;
  const chapterThree = chapterByNumber.get(3)!;
  const chapterFour = chapterByNumber.get(4)!;

  await writeChapterVersionThroughUi(page, work.id, chapterOne.id, chapterOneContent());
  await writeChapterVersionThroughUi(page, work.id, chapterTwo.id, chapterTwoContent());
  await writeChapterVersionThroughUi(page, work.id, chapterThree.id, chapterThreeContent());

  await page.goto(`/workspace/${work.id}/outline`);
  const goldenThreeWorker = await startWorker();
  try {
    await page.getByRole("button", { name: "生成 3 个候选" }).click();
    await expect(page.getByText(/正在生成黄金三章候选/)).toBeVisible();
    await expect(page.locator(".golden-three-candidate")).toHaveCount(3, {
      timeout: 30_000,
    });
  } finally {
    await goldenThreeWorker.stop();
  }
  await page
    .locator(".golden-three-candidate")
    .first()
    .getByRole("button", { name: "选定这个方向" })
    .click();
  await expect(page.locator(".golden-three-candidate").first().getByText("已选定")).toBeVisible();
  await page.getByRole("button", { name: "登记第 2、3 章", exact: true }).click();
  await expect(page.getByText("续写版本已登记")).toBeVisible();
  await recordGoldenThreeReviews(
    request,
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "锁定黄金三章" })).toBeEnabled();
  await page.getByRole("button", { name: "锁定黄金三章" }).click();
  await expect(page.getByText("黄金三章已锁定")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.goto(`/workspace/${work.id}/write?chapterId=${chapterTwo.id}`);
  const chapterTwoCheck = page.waitForResponse(
    (response) =>
      response.url().includes(`/chapters/${chapterTwo.id}/verify`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "检查本章", exact: true }).click();
  expect((await chapterTwoCheck).status()).toBe(200);
  await expect(
    page.locator('.writing-quality [data-critic-finding="MOTIVATION_BREAK"]'),
  ).toBeVisible();

  await createForeshadowThroughUi(page, work.id, chapterOne.id);

  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapterFour.id}`);
    await startGenerationThroughUi(page, chapterFour.id);
    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "检查本章", exact: true }).click();
    await expect(
      page.locator(".writing-quality").getByText("当前版本没有阻断级质量问题。"),
    ).toBeVisible();
    await page.getByRole("tab", { name: "事实" }).click();

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
    await expect(detail.getByText("隐藏忘川书的外门杂役。", { exact: true })).toBeVisible();
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

test("keeps generation status observable when live events are unavailable", async ({
  page,
  context,
  request,
}) => {
  await authenticatedPage(page, context, request);
  const work = await createM1Work(request);
  const fixture = await seedM1Structure(request, work);
  await page.route("**/jobs/*/events", (route) => route.abort("failed"));

  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${fixture.generationChapterId}`);
    await startGenerationThroughUi(page, fixture.generationChapterId);

    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await worker.stop();
  }
});

async function createSettingsThroughUi(page: Page) {
  const settings = [
    {
      type: "world_rule",
      name: "天门只认完整记忆",
      summary: "失去关键记忆的人无法通过天门。",
      fields: { 世界规则: "主动抹除关键记忆会导致天门通行失败。" },
    },
    {
      type: "character",
      name: "沈砚",
      summary: "隐藏忘川书的外门杂役。",
      fields: {
        人物欲望: "找回被抹去的记忆。",
        人物恐惧: "再次被宗门抛弃。",
        人物目标: "进入内门。",
        声纹样本: "“我记得，只是还没想起来。”",
        声线指南: "短句，克制。",
        伪装: "藏起左臂伤势。",
      },
    },
    {
      type: "faction",
      name: "血河宗",
      summary: "以血河秘术追杀叛徒的宗门。",
      fields: { 势力: "盘踞北域血河，誓要夺回忘川书。" },
    },
    {
      type: "map",
      name: "北域山河",
      summary: "沈砚逃亡经过的地图。",
      fields: { 地图: "荒寺在山道北侧，血河城在南侧。" },
    },
    {
      type: "power_system",
      name: "大玄修炼体系",
      summary: "炼气、筑基、金丹、元婴、化神五境。",
      fields: { 力量体系: "越级突破需要付出寿元与记忆。" },
    },
    {
      type: "golden_finger",
      name: "忘川书",
      summary: "以记忆换取前人经验。",
      fields: {
        规则: "每次只能借用一位前人的经验。",
        代价: "永久失去一段重要记忆。",
        限制: "每次使用消耗一页。",
        成长: "缺失记忆会拼成完整人格。",
      },
    },
    {
      type: "item",
      name: "听潮剑",
      summary: "会记录持剑者杀意的法器。",
      fields: {
        分类: "兵器",
        效果: "剑身会记录持剑者的杀意。",
      },
    },
    {
      type: "timeline_event",
      name: "天门洞开",
      summary: "第一卷末的天门开启事件。",
      fields: {
        故事时间: "大玄历 · 卷一末",
        事件: "天门洞开，只有完整记忆者能通行。",
      },
    },
  ] as const;

  for (const setting of settings) {
    await page.getByRole("button", { name: "新增设定" }).click();
    const editor = page.locator(".settings-editor");
    await editor.getByLabel("设定类型").selectOption(setting.type);
    await editor.locator("#setting-name").fill(setting.name);
    await editor.getByLabel("一句话摘要").fill(setting.summary);
    for (const [label, value] of Object.entries(setting.fields)) {
      await editor.getByLabel(label, { exact: true }).fill(value);
    }
    await editor.getByRole("button", { name: "创建设定" }).click();
    const detail = page.locator(".settings-entity-detail");
    await expect(detail.getByRole("heading", { name: setting.name })).toBeVisible();
    await detail.getByRole("button", { name: "锁定设定" }).click();
    await expect(detail.getByText("已锁定 · 编辑需修改请求")).toBeVisible();
    await detail.getByRole("button", { name: "返回设定中心" }).first().click();
    await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  }
}

async function createOutlineThroughUi(page: Page, work: M1Work) {
  await page.goto(`/workspace/${work.id}/outline`);
  await expect(page.getByRole("heading", { name: "大纲工作台" })).toBeVisible();
  await page.getByLabel("全书标题").fill("忘川书");
  await page.getByRole("button", { name: "创建全书大纲" }).click();
  await expect(page.getByText("全书大纲已创建。")).toBeVisible();

  const creator = page.locator("details.outline-plan-create");
  await ensureCreatorOpen(creator);
  await creator.getByLabel("层级").selectOption("volume");
  await creator.getByLabel("上级全书").selectOption({ label: "忘川书" });
  await creator.getByLabel("标题").fill("第一卷 · 忘川");
  await creator.getByLabel("摘要").fill("沈砚从杂役到踏入仙途的第一卷。");
  await creator.getByRole("button", { name: "创建节点" }).click();
  await expect(page.getByText("第一卷 · 忘川").first()).toBeVisible();

  if (
    !(await page
      .getByLabel("卷目标")
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole("treeitem", { name: /第一卷 · 忘川/u }).click();
  }
  await page.getByLabel("卷目标").fill("让沈砚在追杀中活下来并发现忘川书的代价。");
  await page.getByLabel("核心冲突").fill("血河宗追杀与天门记忆规则。");
  await page.getByLabel("关键转折（一行一个）").fill("断臂结印\n记忆代价\n天门开启");
  await page.getByLabel("退出条件（一行一个）").fill("沈砚进入天门\n父母之死线索浮出");
  await page.getByLabel("相关剧情线（名称｜状态｜备注）").fill("父母之死｜active｜卷末仍未回收");
  await page.getByRole("button", { name: "保存卷契约" }).click();
  await expect(page.getByText("卷契约已保存。")).toBeVisible();

  await ensureCreatorOpen(creator);
  await creator.getByLabel("层级").selectOption("act");
  await creator.getByLabel("上级卷").selectOption({ label: "第一卷 · 忘川" });
  await creator.getByLabel("标题").fill("第一幕 · 断臂");
  await creator.getByLabel("摘要").fill("沈砚在追杀中被迫使用忘川书。");
  await creator.getByRole("button", { name: "创建节点" }).click();
  await expect(page.getByText("第一幕 · 断臂").first()).toBeVisible();

  const chapters = [
    {
      number: 1,
      title: "断碑夜雨",
      goal: "让沈砚在旧宅里发现父母留下的线索。",
    },
    {
      number: 2,
      title: "一只手也能结印",
      goal: "让沈砚在断臂后护住顾青，找到新的战斗方式。",
    },
    {
      number: 3,
      title: "铜牌背面",
      goal: "让沈砚发现铜牌背面的名字与自己的身世有关。",
    },
    {
      number: 4,
      title: "天门之前",
      goal: "让沈砚抵达天门，面对记忆与通行规则。",
    },
  ];
  for (const chapter of chapters) {
    await ensureCreatorOpen(creator);
    await creator.getByLabel("层级").selectOption("chapter");
    await creator.getByLabel("上级幕").selectOption({ label: "第一幕 · 断臂" });
    await creator.getByLabel("章节序号").fill(String(chapter.number));
    await creator.getByLabel("章节标题").fill(chapter.title);
    await creator.getByLabel("章目标").fill(chapter.goal);
    await creator.getByLabel("视角人物").fill("沈砚");
    await creator.getByLabel("地点").fill("荒寺外山道");
    await creator
      .getByLabel("场景节拍（一行一个）")
      .fill("沈砚藏起断臂。\n追兵逼近，两人继续上路。");
    await creator.getByLabel("必用事实（一行一个）").fill("左臂骨折，不能双手结印");
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/outline/nodes"),
      { timeout: 60_000 },
    );
    await creator.getByRole("button", { name: "创建节点" }).click();
    const response = await createResponse;
    expect(response.status()).toBe(201);
    const created = (await response.json()).data as {
      node: { id: string; chapter: { number: number } | null };
    };
    expect(created.node.chapter?.number).toBe(chapter.number);
    const createdNode = page.locator(`[data-outline-node-id="${created.node.id}"]`);
    await expect(createdNode).toBeVisible();
    await expect(createdNode).toContainText(`第 ${chapter.number} 章`);
  }
}

async function ensureCreatorOpen(creator: Locator) {
  const open = await creator.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!open) {
    await creator.locator("summary").click();
  }
}

async function startGenerationThroughUi(page: Page, chapterId: string): Promise<void> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith(`/chapters/${chapterId}/generate`),
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "生成整章" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
}

async function writeChapterVersionThroughUi(
  page: Page,
  workId: string,
  chapterId: string,
  content: string,
) {
  await page.goto(`/workspace/${workId}/write?chapterId=${chapterId}`);
  await page.getByLabel("章节正文").fill(content);
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.locator(".writing-save-state")).toContainText("已保存");
}

async function createForeshadowThroughUi(page: Page, workId: string, chapterId: string) {
  await page.goto(`/workspace/${workId}/foreshadows`);
  await expect(page.getByRole("heading", { name: "埋下的，都要有回收计划" })).toBeVisible();
  await page.getByRole("button", { name: "新增伏笔" }).click();
  const form = page.locator(".foreshadow-form");
  await form.getByLabel("名称").fill("父母之死");
  await form.getByLabel("摘要").fill("沈砚以为父母是自杀。");
  await form.getByLabel("目标起始章").fill("1");
  await form.getByLabel("目标结束章").fill("2");
  await form.getByLabel("读者承诺").fill("身世谜团");
  await form.getByRole("button", { name: "保存记录" }).click();
  await expect(page.getByText("伏笔已保存。")).toBeVisible();

  const row = page.locator(".foreshadow-row", { hasText: "父母之死" });
  await row.getByRole("button", { name: "埋设" }).click();
  const transition = page.locator(".foreshadow-inline-form");
  await transition.getByLabel("来源章节").selectOption(chapterId);
  await transition.getByLabel("原因").fill("在第 1 章旧宅里埋下。");
  await transition.getByRole("button", { name: "确认埋设" }).click();
  await expect(page.getByText("记录状态已更新。")).toBeVisible();
}

function chapterOneContent(): string {
  return "沈砚把父母的旧信压在箱底。\n\n风从荒寺的瓦上压下来，顾青在门外等他。";
}

function chapterTwoContent(): string {
  return "沈砚握紧断刀，听见追兵踏碎山道上的积水。\n\n沈砚收起断刀，转身离开，不再战斗。";
}

function chapterThreeContent(): string {
  return "铜牌背面刻着沈砚自己的名字。\n\n顾青看见书页一角，却没有点破。";
}
