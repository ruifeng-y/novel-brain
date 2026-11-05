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
      order: 1,
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
    await expect(generationPanel.getByRole("heading", { name: "已完成" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(generationPanel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(generationPanel.getByText("断点")).toBeVisible();
    await expect(generationPanel.getByText("费用")).toBeVisible();
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
    await expect(generationPanel.getByRole("button", { name: "从断点重试" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(/生成草稿/);
  } finally {
    await failingWorker.stop();
  }

  const recoveredWorker = await startWorker();
  try {
    await page.locator(".writing-generation").getByRole("button", { name: "从断点重试" }).click();
    await expect(
      page.locator(".writing-generation").getByRole("heading", { name: "已完成" }),
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
