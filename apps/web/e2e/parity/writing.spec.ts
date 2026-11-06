import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("writing");
  const session = await registerUser(page.request, email, "StrongPassword123", "写作台作者");
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

async function createWritingWork(page: Page) {
  return (await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  })) as {
    id: string;
    title: string;
    mainBranch: { id: string };
  };
}

function chaptersPath(work: { id: string; mainBranch: { id: string } }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`;
}

async function createChapter(page: Page, work: { id: string; mainBranch: { id: string } }) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(chaptersPath(work), {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      number: 1,
      title: "一只手也能结印",
      brief: {
        goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: [
          "沈砚藏起断臂，被顾青撞见。",
          "血河宗追兵逼近，两人被迫联手。",
          "沈砚单手结印，忘川书短暂显形。",
        ],
        requiredFacts: ["左臂骨折，不能双手结印"],
      },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as {
    id: string;
    version: number;
    status: string;
  };
}

async function createModelConfig(page: Page) {
  const token = await getCsrf(page.request);
  const response = await page.request.post("/api/v1/model-configs", {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      provider: "deepseek",
      label: "DeepSeek 正文",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-fake-generation-1234",
      purposes: ["writing"],
      isDefault: true,
    },
  });
  expect(response.status()).toBe(200);
}

async function lockBible(page: Page, work: { id: string; mainBranch: { id: string } }) {
  const token = await getCsrf(page.request);
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const generated = await page.request.post(`${branchPath}/story-bible/generate`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {},
  });
  expect(generated.status()).toBe(200);
  const locked = await page.request.post(`${branchPath}/story-bible/lock`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: (await generated.json()).data.version },
  });
  expect(locked.status()).toBe(200);
}

async function lockSettings(page: Page, work: { id: string; mainBranch: { id: string } }) {
  const token = await getCsrf(page.request);
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const settings = [
    {
      type: "world_rule",
      name: "天门只认完整记忆",
      aliases: [],
      summary: "失去关键记忆的人无法通过天门。",
      description: "",
      tags: [],
      data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
    },
    {
      type: "character",
      name: "沈砚",
      aliases: [],
      summary: "隐藏忘川书的外门杂役。",
      description: "",
      tags: [],
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀。",
        relationshipSummary: "与顾青互相试探。",
      },
    },
    {
      type: "golden_finger",
      name: "忘川书",
      aliases: [],
      summary: "以记忆换取前人经验。",
      description: "",
      tags: [],
      data: {
        rules: "每次只能借用一位前人的经验。",
        cost: "永久失去一段重要记忆。",
        limits: "每次使用消耗一页。",
        growth: "缺失记忆会拼成完整人格。",
      },
    },
  ] as const;
  for (const setting of settings) {
    const created = await page.request.post(`${branchPath}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: setting,
    });
    expect(created.status()).toBe(201);
    const createdData = (await created.json()).data;
    const locked = await page.request.post(`${branchPath}/entities/${createdData.id}/lock`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: createdData.version },
    });
    expect(locked.status()).toBe(200);
  }
}

async function prepareGenerationWork(page: Page) {
  const work = await createWritingWork(page);
  await createModelConfig(page);
  await lockBible(page, work);
  await lockSettings(page, work);
  const chapter = await createChapter(page, work);
  return { work, chapter };
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("opens a planned chapter, saves twice and compares two versions", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createWritingWork(page);
  const chapter = await createChapter(page, work);

  await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
  await expect(page.getByRole("heading", { name: "写作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "一只手也能结印" })).toBeVisible();
  await expect(page.getByText("已规划", { exact: true })).toBeVisible();
  await expect(page.getByText("部分就绪")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.fill("血从袖口滴下来，落在青石板上。");
  await expect(page.getByRole("button", { name: "保存版本" })).toBeEnabled();
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.getByText("写作中", { exact: true })).toBeVisible();
  await expect(page.locator(".writing-version-list").getByText("第 1 版")).toBeVisible();
  await expect(page.getByText("已保存")).toBeVisible();

  await editor.fill("血从袖口滴下来，落在青石板上。\n\n沈砚把断臂藏进袖中。");
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.locator(".writing-version-list").getByText("第 2 版")).toBeVisible();
  await expect(page.getByRole("heading", { name: "版本比较" })).toBeVisible();
  await expect(page.locator(".writing-version-diff pre")).toHaveCount(2);
  await expect(page.locator(".writing-version-diff pre").first()).toHaveText(
    "血从袖口滴下来，落在青石板上。",
  );
  await expect(page.locator(".writing-version-diff pre").nth(1)).toContainText(
    "沈砚把断臂藏进袖中。",
  );
  await expect(page.getByRole("button", { name: "保存版本" })).toBeDisabled();

  const versions = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${chapter.id}/versions`,
  );
  expect(versions.ok()).toBe(true);
  expect((await versions.json()).data).toHaveLength(2);
});

test("shows empty and error states and keeps the editor usable at four viewports", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createWritingWork(page);

  await page.goto(`/workspace/${work.id}/write`);
  await expect(page.getByRole("heading", { name: "还没有章纲" })).toBeVisible();
  await expect(page.getByRole("link", { name: "先去写章纲" })).toBeVisible();

  const chapter = await createChapter(page, work);
  await page.route(`**${chaptersPath(work)}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "写作台加载失败。",
          details: {},
          requestId: "req_writing_error",
        },
      }),
    });
  });
  await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
  await expect(page.getByText("写作台加载失败。")).toBeVisible();
  await page.unroute(`**${chaptersPath(work)}`);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    await expect(page.getByRole("heading", { name: "一只手也能结印" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "章节正文" })).toBeVisible();
    await expect(page.getByText("故事圣经尚未锁定")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`writing-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("shows loading and recoverable version conflict states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWritingWork(page);
  const chapter = await createChapter(page, work);
  const chapters = chaptersPath(work);

  await page.route(`**${chapters}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
  await expect(page.getByText("正在加载写作台")).toBeVisible();
  await page.unroute(`**${chapters}`);
  await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
  await expect(page.getByRole("heading", { name: "一只手也能结印" })).toBeVisible();

  await page.getByRole("textbox", { name: "章节正文" }).fill("沈砚把断臂藏进袖中。");
  const versionsPath = `${chapters}/${chapter.id}/versions`;
  await page.route(`**${versionsPath}`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "章节版本已变化，请刷新后重试。",
            details: {},
            requestId: "req_writing_conflict",
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.getByText("章节版本已变化，请刷新后重试。")).toBeVisible();
});

test("keeps a long chapter usable at the narrow viewport", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWritingWork(page);
  const chapter = await createChapter(page, work);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);

  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.fill("沈砚把断臂藏进袖中。".repeat(800));
  await expect(editor).toHaveValue(/沈砚把断臂藏进袖中。/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("shows six-dimension evidence and completes a finding dismiss/reopen lifecycle", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const { work, chapter } = await prepareGenerationWork(page);

  await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.fill("沈砚双手结印，断臂竟毫无妨碍。\n\n风停了，山道上没有声音。");
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.getByText("已保存")).toBeVisible();

  await page.getByRole("button", { name: "检查本章" }).click();
  const quality = page.locator(".writing-quality");
  await expect(quality.getByRole("heading", { name: "质量报告" })).toBeVisible();
  await expect(quality.locator(".quality-dimension")).toHaveCount(6);
  await expect(quality.locator('[data-quality-dimension="continuity"]')).toBeVisible();
  await expect(quality.locator('[data-quality-dimension="hook"]')).toBeVisible();
  await expect(quality.locator('[data-critic-finding="FACT_CONTRADICTION"]')).toBeVisible();
  await expect(
    quality
      .locator('[data-critic-finding="FACT_CONTRADICTION"]')
      .getByText("阻断", { exact: true }),
  ).toBeVisible();
  await expect(quality.locator('[data-critic-finding="WEAK_CHAPTER_END_HOOK"]')).toBeVisible();
  await expectAuthorFacingLanguage(page);

  const dismissible = quality.locator('[data-critic-finding="WEAK_CHAPTER_END_HOOK"]');
  await dismissible.getByRole("button", { name: "忽略误报" }).click();
  await dismissible
    .getByRole("textbox", { name: "忽略理由" })
    .fill("章末留白是有意处理，不按误报修订。");
  await dismissible.getByRole("button", { name: "记录理由并忽略" }).click();
  await expect(dismissible).toHaveAttribute("data-critic-status", "dismissed");
  await expect(dismissible.getByText("已记录理由忽略")).toBeVisible();
  await expect(dismissible.getByText("章末留白是有意处理，不按误报修订。")).toBeVisible();
  await dismissible.getByRole("button", { name: "恢复问题" }).click();
  await expect(dismissible).toHaveAttribute("data-critic-status", "open");

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(quality).toBeVisible();
    await expect(quality.locator(".quality-dimension")).toHaveCount(6);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`writing-quality-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("generates a chapter with progress, references, citations, cost and checkpoint", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const { work, chapter } = await prepareGenerationWork(page);
  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    const generate = page.getByRole("button", { name: "生成整章" });
    await expect(generate).toBeEnabled();
    await generate.click();

    const generationPanel = page.locator(".writing-generation");
    await expect(generationPanel.getByRole("heading", { name: "等待审阅" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(generationPanel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(generationPanel.getByText("断点")).toBeVisible();
    await expect(generationPanel.getByText("费用")).toBeVisible();
    await expect(generationPanel.getByText("生成记录")).toBeVisible();
    await expect(generationPanel.locator(".writing-run-trace-item")).toHaveCount(3);
    await expect(generationPanel.getByText(/用量 /).first()).toBeVisible();
    await expect(generationPanel.getByText("已锁定故事圣经")).toBeVisible();
    await expect(generationPanel.locator(".writing-source-item").first()).toContainText("第 1 章");
    await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(/修订稿/);
    await expect(page.locator(".writing-version-list").getByText("第 2 版")).toBeVisible();
    await expectAuthorFacingLanguage(page);

    for (const width of [390, 900, 1180, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(generationPanel).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await testInfo.attach(`writing-generation-${width}`, {
        body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
        contentType: "image/png",
      });
    }
  } finally {
    await worker.stop();
  }
});

test("rewrites only the selected draft and applies a generated title at four viewports", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const { work, chapter } = await prepareGenerationWork(page);
  const worker = await startWorker();
  const source = "风停。\n\nSELECTED_BLOCK\n\n钟声未响。";
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    const editor = page.getByRole("textbox", { name: "章节正文" });
    await editor.fill(source);
    await page.getByRole("button", { name: "保存版本" }).click();
    await expect(page.getByText("已保存")).toBeVisible();
    await expect(page.locator(".writing-version-list").getByText("第 1 版")).toBeVisible();

    await editor.evaluate(
      (element, range) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(range.start, range.end);
      },
      {
        start: source.indexOf("SELECTED_BLOCK"),
        end: source.indexOf("SELECTED_BLOCK") + "SELECTED_BLOCK".length,
      },
    );
    await page.getByRole("button", { name: "改写选中" }).click();

    const actionPanel = page.locator(".writing-action-panel");
    await expect(actionPanel.getByText("改写选中", { exact: true })).toBeVisible();
    await expect(
      actionPanel.locator(".writing-action-summary").getByText("等待审阅", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(editor).toHaveValue(/风停。\n\n改写片段/);
    await expect(editor).not.toHaveValue(/SELECTED_BLOCK/);
    await expect(editor).toHaveValue(/钟声未响。$/);
    await expect(actionPanel.getByText(/改写范围：第 \d+–\d+ 字/)).toBeVisible();
    await expect(actionPanel.getByText("新版本已生成，原稿保留在版本历史")).toBeVisible();
    await expect(page.locator(".writing-version-list").getByText("第 1 版")).toBeVisible();
    await expectAuthorFacingLanguage(page);

    await page.getByRole("button", { name: "更多生成" }).click();
    await page.getByRole("button", { name: "生成标题" }).click();
    await expect(actionPanel.getByText("生成标题", { exact: true })).toBeVisible();
    await expect(
      actionPanel.locator(".writing-action-summary").getByText("等待审阅", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const titleButtons = actionPanel.locator(".writing-action-title-options button");
    await expect(titleButtons.first()).toBeVisible();
    const generatedTitle = (await titleButtons.first().innerText()).trim();
    await titleButtons.first().click();
    await expect(page.locator("#writing-chapter-title")).toHaveText(generatedTitle);
    await expectAuthorFacingLanguage(page);

    for (const width of [390, 900, 1180, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(actionPanel).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await testInfo.attach(`writing-actions-${width}`, {
        body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
        contentType: "image/png",
      });
    }
  } finally {
    await worker.stop();
  }
});

test("confirms two fact proposals without changing confirmed settings", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const { work, chapter } = await prepareGenerationWork(page);
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const settingsBefore = await page.request.get(`${branchPath}/facts`);
  expect(settingsBefore.ok()).toBe(true);
  const settingsDataBefore = (await settingsBefore.json()).data;
  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    await expect(page.getByRole("heading", { name: "写作台" })).toBeVisible();
    const generate = page.getByRole("button", { name: "生成整章" });
    await expect(generate).toBeEnabled();
    await generate.click();

    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 15_000 });
    const factsPanel = page.getByRole("region", { name: "本章事实" });
    await expect(factsPanel).toBeVisible();
    await expect(factsPanel.getByText("待确认", { exact: true }).first()).toBeVisible();
    await expect(factsPanel.getByText(/来源句：/).first()).toBeVisible();

    const confirmButtons = factsPanel.getByRole("button", { name: "确认", exact: true });
    expect(await confirmButtons.count()).toBeGreaterThanOrEqual(2);
    await confirmButtons.first().click();
    await expect(factsPanel.getByText("已确认", { exact: true })).toHaveCount(1);
    await confirmButtons.first().click();
    await expect(factsPanel.getByText("已确认", { exact: true })).toHaveCount(2);
    await expect(factsPanel.getByText("来源句：").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("已写入已确认设定");
    await expectAuthorFacingLanguage(page);

    const settingsAfter = await page.request.get(`${branchPath}/facts`);
    expect(settingsAfter.ok()).toBe(true);
    expect((await settingsAfter.json()).data).toEqual(settingsDataBefore);
  } finally {
    await worker.stop();
  }
});

test("approves, confirms required facts and submits the chapter end to end", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const { work, chapter } = await prepareGenerationWork(page);
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const settingsBefore = await page.request.get(`${branchPath}/facts`);
  expect(settingsBefore.ok()).toBe(true);
  const settingsDataBefore = (await settingsBefore.json()).data;
  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    await page.getByRole("button", { name: "生成整章" }).click();
    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 15_000 });

    const factsPanel = page.getByRole("region", { name: "本章事实" });
    const submit = factsPanel.getByRole("button", { name: "提交本章事实" });
    await expect(submit).toBeDisabled();
    const proposalsBeforeApproval = await page.request.get(
      `${branchPath}/chapters/${chapter.id}/fact-proposals`,
    );
    expect(proposalsBeforeApproval.ok()).toBe(true);
    const proposalsDataBeforeApproval = (await proposalsBeforeApproval.json()).data;

    await factsPanel.getByRole("button", { name: "批准本章" }).click();
    await expect(factsPanel.getByRole("button", { name: "本章已批准" })).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(factsPanel.getByText(/还有 2 条事实待确认/)).toBeVisible();
    const proposalsAfterApproval = await page.request.get(
      `${branchPath}/chapters/${chapter.id}/fact-proposals`,
    );
    expect((await proposalsAfterApproval.json()).data).toEqual(proposalsDataBeforeApproval);
    const settingsAfterApproval = await page.request.get(`${branchPath}/facts`);
    expect((await settingsAfterApproval.json()).data).toEqual(settingsDataBefore);

    await factsPanel
      .locator(".writing-fact-card:has(.writing-fact-risk-high)")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(factsPanel.getByText("已确认", { exact: true })).toHaveCount(1);
    await factsPanel
      .locator(".writing-fact-card:has(.writing-fact-risk-medium)")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(factsPanel.getByText("已确认", { exact: true })).toHaveCount(2);
    await expect(factsPanel.getByText("已满足提交条件，可以提交本章事实。")).toBeVisible();
    await expect(submit).toBeEnabled();
    const settingsBeforeSubmission = await page.request.get(`${branchPath}/facts`);
    expect((await settingsBeforeSubmission.json()).data).toEqual(settingsDataBefore);

    await submit.click();
    await expect(factsPanel.getByRole("button", { name: "本章事实已提交" })).toBeDisabled();
    await expect(factsPanel.getByText("摘要已更新")).toBeVisible();
    await expect(page.getByText("已批准", { exact: true })).toBeVisible();

    const settingsAfterSubmission = await page.request.get(`${branchPath}/facts`);
    const submittedSettings = (await settingsAfterSubmission.json()).data as Array<{
      kind?: string;
    }>;
    expect(submittedSettings.filter((item) => item.kind === "fact")).toHaveLength(2);
    expectAuthorFacingLanguage(page);
  } finally {
    await worker.stop();
  }
});

test("keeps the draft checkpoint after provider failure and resumes from revise", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const { work, chapter } = await prepareGenerationWork(page);
  const failingWorker = await startWorker({ failStep: "revise" });
  try {
    await page.goto(`/workspace/${work.id}/write?chapterId=${chapter.id}`);
    await page.getByRole("button", { name: "生成整章" }).click();

    const generationPanel = page.locator(".writing-generation");
    await expect(generationPanel.getByRole("heading", { name: "生成失败" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(generationPanel.getByText("模型服务暂时不可用，草稿和检查点已保留")).toBeVisible();
    await expect(generationPanel.getByText("MODEL_PROVIDER_ERROR")).toBeVisible();
    await expect(generationPanel.getByText(/模型服务异常/).first()).toBeVisible();
    await expect(generationPanel.getByText("模型服务异常，请稍后从断点重试")).toBeVisible();
    await expect(generationPanel.getByRole("button", { name: "从断点重试" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(/生成草稿/);
  } finally {
    await failingWorker.stop();
  }

  const recoveredWorker = await startWorker();
  try {
    await page.locator(".writing-generation").getByRole("button", { name: "从断点重试" }).click();
    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "等待审阅" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(/修订稿/);
    await expect(page.locator(".writing-generation").getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  } finally {
    await recoveredWorker.stop();
  }
});
