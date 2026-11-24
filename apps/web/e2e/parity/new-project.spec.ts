import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import {
  IMPORT_FILE_LIMITS,
  chapterWorkspaceListResponseSchema,
  chunkedImportProgressResponseSchema,
  manuscriptImportConfirmResponseSchema,
  manuscriptImportResponseSchema,
  settingEntityListResponseSchema,
  settingsImportResponseSchema,
  workResponseSchema,
} from "@novel-brain/contracts";
import { Pool } from "pg";

import { getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { buildDocxFixture } from "../helpers/docx";
import { buildChunkedManuscriptFixture } from "../helpers/manuscript";
import { startWorker } from "../helpers/worker";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  waitForApiResponse,
} from "../helpers/ui";

const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";

async function getPersistedWork(page: Page, workId: string) {
  const response = await page.request.get(`/api/v1/works/${workId}`);
  expect(response.status()).toBe(200);
  return workResponseSchema.parse(await response.json()).data;
}

async function getPersistedSettingEntities(
  page: Page,
  work: Awaited<ReturnType<typeof getPersistedWork>>,
) {
  const response = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities?limit=20`,
  );
  expect(response.status()).toBe(200);
  return settingEntityListResponseSchema.parse(await response.json()).data;
}

async function getPersistedChapters(
  page: Page,
  work: Awaited<ReturnType<typeof getPersistedWork>>,
) {
  const response = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters?limit=20`,
  );
  expect(response.status()).toBe(200);
  return chapterWorkspaceListResponseSchema.parse(await response.json()).data;
}

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

test("shows every creation entry without prototype leakage at four viewports", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);

  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "把一个想法，长成一本书" })).toBeVisible();
    for (const entry of ["一句话想法", "空白作品", "题材模板", "导入设定", "导入旧稿"]) {
      await expect(page.getByRole("button", { name: entry, exact: true })).toBeVisible();
    }
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("creates a work from an idea and persists its blueprint", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await expect(page.getByRole("heading", { name: "把一个想法，长成一本书" })).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);

  await page.getByLabel("书名").fill("忘川书");
  await page.getByLabel("故事灵感").fill("一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。");
  const createResponse = waitForApiResponse(page, "POST", "/api/v1/works");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();
  const createdWork = workResponseSchema.parse(await (await createResponse).json()).data;

  await expect(page).toHaveURL(new RegExp(`/workspace/${createdWork.id}/overview$`));
  await expect(page.getByRole("heading", { name: "忘川书" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "主创作线" })).toBeVisible();
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();

  const persistedWork = await getPersistedWork(page, createdWork.id);
  expect(persistedWork).toMatchObject({
    id: createdWork.id,
    title: "忘川书",
    sourceMode: "idea",
    idea: "一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。",
  });
  expect(persistedWork.mainBranch.name).toBe("main");
  expect(persistedWork.mainBranch.headNodeId).toMatch(/^[0-9a-f-]{36}$/);
});

test("creates a blank work without an idea and persists it", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "空白作品", exact: true }).click();
  await expect(page.getByLabel("故事灵感")).toHaveCount(0);

  await page.getByLabel("书名").fill("空白长篇");
  const createResponse = waitForApiResponse(page, "POST", "/api/v1/works");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();
  const createdWork = workResponseSchema.parse(await (await createResponse).json()).data;

  await expect(page).toHaveURL(new RegExp(`/workspace/${createdWork.id}/overview$`));
  await expect(page.getByRole("heading", { name: "空白长篇" })).toBeVisible();
  await expect(page.getByText("还没有故事灵感", { exact: true })).toBeVisible();

  const persistedWork = await getPersistedWork(page, createdWork.id);
  expect(persistedWork.sourceMode).toBe("blank");
  expect(persistedWork.idea).toBeNull();
});

test("creates a xianxia template work and persists its genre pack", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "题材模板", exact: true }).click();
  await page.getByLabel("书名").fill("仙途模板");
  await page.getByLabel("题材模板").selectOption("xianxia");
  const createResponse = waitForApiResponse(page, "POST", "/api/v1/works");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();
  const createdWork = workResponseSchema.parse(await (await createResponse).json()).data;

  await expect(page).toHaveURL(new RegExp(`/workspace/${createdWork.id}/overview$`));
  await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
  await expect(page.getByText("仙侠模板 · 修真文明", { exact: true })).toBeVisible();

  const persistedWork = await getPersistedWork(page, createdWork.id);
  expect(persistedWork.sourceMode).toBe("template");
  expect(persistedWork.genre).toBe("xianxia");
  expect(persistedWork.templatePack?.key).toBe("xianxia");
});

test("creates a history template work with military pack hints", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "题材模板", exact: true }).click();
  await page.getByLabel("书名").fill("边关粮道");
  await page.getByLabel("题材模板").selectOption("history");
  await expect(
    page.locator(".creation-preview").getByText("架空历史模板 · 架空古代", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "边关粮道" })).toBeVisible();
  await expect(page.getByText("架空历史模板 · 架空古代", { exact: true })).toBeVisible();
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

test("imports partial settings and persists accepted entities", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把人物、势力、地图和体系带进来" })).toBeVisible();

  await page.getByLabel("上传设定文件").setInputFiles({
    name: "settings-partial.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      ["人物：沈砚，外门杂役，左臂骨折。", "这是一段暂时无法归类的旧笔记。"].join("\n"),
      "utf8",
    ),
  });
  const importResponse = waitForApiResponse(page, "POST", "/api/v1/imports");
  await page.getByRole("button", { name: "开始识别" }).click();
  const settingsImport = settingsImportResponseSchema.parse(
    await (await importResponse).json(),
  ).data;

  await expect(page.getByRole("heading", { name: "识别结果" })).toBeVisible();
  await expect(page.getByText("已接受 1")).toBeVisible();
  await expect(page.getByText("无法解析 1")).toBeVisible();
  await expect(
    page
      .locator(".settings-import-report")
      .getByText("人物：沈砚，外门杂役，左臂骨折。", { exact: true }),
  ).toBeVisible();
  await expectAuthorFacingLanguage(page);

  const persistedImportResponse = await page.request.get(`/api/v1/imports/${settingsImport.id}`);
  expect(persistedImportResponse.status()).toBe(200);
  const persistedImport = settingsImportResponseSchema.parse(
    await persistedImportResponse.json(),
  ).data;
  expect(persistedImport.report.accepted).toHaveLength(1);
  expect(persistedImport.report.unparsed).toHaveLength(1);

  await page.getByLabel("书名").fill("部分设定开书");
  const confirmResponse = waitForApiResponse(
    page,
    "POST",
    `/api/v1/imports/${settingsImport.id}/confirm`,
  );
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  const createdWork = workResponseSchema.parse(await (await confirmResponse).json()).data;
  await expect(page).toHaveURL(new RegExp(`/workspace/${createdWork.id}/overview$`));
  await expect(page.getByRole("heading", { name: "部分设定开书" })).toBeVisible();

  const persistedWork = await getPersistedWork(page, createdWork.id);
  expect(persistedWork.sourceMode).toBe("settings_import");
  expect(persistedWork.settings.materializedSettingCount).toBe(1);
  const entities = await getPersistedSettingEntities(page, persistedWork);
  expect(entities).toHaveLength(1);
  expect(entities[0]).toMatchObject({ name: "沈砚", type: "character", source: "import" });
  if (entities[0]?.type === "character") {
    expect(entities[0].data.bodyState).toContain("左臂骨折");
  }
});

test("imports DOCX settings through settings mode and persists accepted entities", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page.getByLabel("上传设定文件").setInputFiles({
    name: "settings.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: buildDocxFixture(["人物：沈砚，外门杂役，左臂骨折。", "势力：太玄门，正道魁首。"]),
  });
  const importResponse = waitForApiResponse(page, "POST", "/api/v1/imports");
  await page.getByRole("button", { name: "开始识别" }).click();
  const settingsImport = settingsImportResponseSchema.parse(
    await (await importResponse).json(),
  ).data;

  await expect(page.getByText("已接受 2")).toBeVisible();
  await expect(page.getByText("DOCX 不支持")).toHaveCount(0);
  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "把人物、势力、地图和体系带进来" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await page.getByLabel("书名").fill("DOCX 设定开书");
  const confirmResponse = waitForApiResponse(
    page,
    "POST",
    `/api/v1/imports/${settingsImport.id}/confirm`,
  );
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  const createdWork = workResponseSchema.parse(await (await confirmResponse).json()).data;
  await expect(page).toHaveURL(new RegExp(`/workspace/${createdWork.id}/overview$`));

  const persistedWork = await getPersistedWork(page, createdWork.id);
  expect(persistedWork.sourceMode).toBe("settings_import");
  const entities = await getPersistedSettingEntities(page, persistedWork);
  expect(entities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "character", name: "沈砚", source: "import" }),
      expect.objectContaining({ type: "faction", name: "太玄门", source: "import" }),
    ]),
  );
});

test("imports complete settings and reports pending candidates before creation", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page
    .getByLabel("粘贴设定")
    .fill(
      [
        "人物：沈砚，外门杂役。",
        "人物：顾青，太玄门弟子。",
        "势力：太玄门、血河宗。",
        "地图：人界 → 东境 → 忘川渡。",
        "力量体系：练气 → 筑基 → 金丹。",
        "金手指：忘川书，以记忆换取前人经验。",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "开始识别" }).click();

  await expect(page.getByText("已接受 7")).toBeVisible();
  await expect(page.getByText("待确认 0")).toBeVisible();
  await expect(page.getByText("冲突 0")).toBeVisible();
  await expect(page.getByText("无法解析 0")).toBeVisible();

  await page.getByLabel("书名").fill("完整设定开书");
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "完整设定开书" })).toBeVisible();
});

test("imports an old manuscript and persists chapter order and content", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入旧稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把已经写下的部分带进来" })).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "old-draft.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      [
        "# 第一章 断碑夜雨",
        "",
        "雨落在断碑上。",
        "",
        "# 第二章 夜船",
        "",
        "夜船顺流而下。",
        "",
        "# 第三章 断臂之后",
        "",
        "沈砚按住左臂。",
      ].join("\n"),
      "utf8",
    ),
  });
  const recognizeResponse = waitForApiResponse(page, "POST", "/api/v1/imports/manuscripts");
  await page.getByRole("button", { name: "识别章节" }).click();
  const manuscriptImport = manuscriptImportResponseSchema.parse(
    await (await recognizeResponse).json(),
  ).data;
  await expect(page.getByText("识别到 3 章")).toBeVisible();
  expect(manuscriptImport.chapters.map((chapter) => chapter.title)).toEqual([
    "断碑夜雨",
    "夜船",
    "断臂之后",
  ]);

  const rows = page.getByTestId("manuscript-chapter-row");
  await expect(rows).toHaveCount(3);
  await rows.nth(0).getByLabel("第 1 章标题").fill("第一章 断碑夜雨");
  await rows.nth(0).getByRole("button", { name: "拆分第 1 章" }).click();
  await expect(page.getByLabel("拆分位置")).toBeVisible();
  await page.getByRole("button", { name: "确认拆分" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1).getByLabel("第 2 章标题")).toHaveValue("拆分章节");
  await rows.nth(1).getByLabel("第 2 章标题").fill("雨落断碑");
  await rows.nth(1).getByRole("button", { name: "合并第 2 章与下一章" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).getByLabel("第 2 章标题")).toHaveValue("雨落断碑");

  await page.getByLabel("书名").fill("旧稿新书");
  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "把已经写下的部分带进来" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
  const confirmResponse = waitForApiResponse(
    page,
    "POST",
    `/api/v1/imports/manuscripts/${manuscriptImport.id}/confirm`,
  );
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  const confirmedImport = manuscriptImportConfirmResponseSchema.parse(
    await (await confirmResponse).json(),
  ).data;
  await expect(page).toHaveURL(new RegExp(`/workspace/${confirmedImport.work.id}/overview$`));
  await expect(page.getByRole("heading", { name: "旧稿新书" })).toBeVisible();
  await expectAuthorFacingLanguage(page);

  const persistedWork = await getPersistedWork(page, confirmedImport.work.id);
  expect(persistedWork.sourceMode).toBe("manuscript_import");
  const persistedChapters = await getPersistedChapters(page, persistedWork);
  expect(persistedChapters.map(({ number, title }) => ({ number, title }))).toEqual([
    { number: 1, title: "第一章 断碑夜雨" },
    { number: 2, title: "雨落断碑" },
    { number: 3, title: "断臂之后" },
  ]);
  expect(persistedChapters.every((chapter) => chapter.wordCount > 0)).toBe(true);
  const persistedManuscript = persistedChapters
    .map((chapter) => chapter.currentVersion?.content ?? "")
    .join("");
  expect(persistedManuscript).toContain("雨落在断碑上。");
  expect(persistedManuscript).toContain("夜船顺流而下。");
  expect(persistedManuscript).toContain("沈砚按住左臂。");
});

test("imports a DOCX manuscript and persists ordered chapter content", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入旧稿", exact: true }).click();
  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "old-draft.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: buildDocxFixture([
      "第一章 断碑夜雨",
      "雨落在断碑上。",
      "第二章 夜船",
      "夜船顺流而下。",
    ]),
  });
  const recognizeResponse = waitForApiResponse(page, "POST", "/api/v1/imports/manuscripts");
  await page.getByRole("button", { name: "识别章节" }).click();
  const manuscriptImport = manuscriptImportResponseSchema.parse(
    await (await recognizeResponse).json(),
  ).data;

  expect(manuscriptImport.format).toBe("docx");
  expect(manuscriptImport.chapters.map((chapter) => chapter.title)).toEqual(["断碑夜雨", "夜船"]);
  await expect(page.getByText("识别到 2 章")).toBeVisible();
  await expect(page.getByText("DOCX 不支持")).toHaveCount(0);

  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "把已经写下的部分带进来" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  await page.getByLabel("书名").fill("DOCX 旧稿新书");
  const confirmResponse = waitForApiResponse(
    page,
    "POST",
    `/api/v1/imports/manuscripts/${manuscriptImport.id}/confirm`,
  );
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  const confirmedImport = manuscriptImportConfirmResponseSchema.parse(
    await (await confirmResponse).json(),
  ).data;
  await expect(page).toHaveURL(new RegExp(`/workspace/${confirmedImport.work.id}/overview$`));

  const persistedWork = await getPersistedWork(page, confirmedImport.work.id);
  expect(persistedWork.sourceMode).toBe("manuscript_import");
  const persistedChapters = await getPersistedChapters(page, persistedWork);
  expect(persistedChapters.map(({ title }) => title)).toEqual(["断碑夜雨", "夜船"]);
  expect(persistedChapters.map((chapter) => chapter.currentVersion?.content ?? "").join("")).toBe(
    ["第一章 断碑夜雨", "雨落在断碑上。", "第二章 夜船", "夜船顺流而下。"].join("\n"),
  );
});

test("shows empty, partial, malformed and unreadable manuscript states", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入旧稿", exact: true }).click();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "old-draft.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("not supported", "utf8"),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("DOCX 旧稿文件损坏或格式不受支持")).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "oversized.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.alloc(IMPORT_FILE_LIMITS.manuscript.maxFileBytes + 1),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("DOCX 旧稿不能超过 1 MB，请拆分文件后重试。")).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "empty.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(" \n\n ", "utf8"),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByRole("heading", { name: "旧稿里没有可导入的正文" })).toBeVisible();

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "partial.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("只有正文，没有章节标题。\n第二段仍然保留。", "utf8"),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("部分内容未识别到章节标题")).toBeVisible();
  await expect(page.getByTestId("manuscript-chapter-row")).toHaveCount(1);

  await page.getByLabel("上传旧稿文件").setInputFiles({
    name: "broken.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xff, 0xfe, 0xfd]),
  });
  await page.getByRole("button", { name: "识别章节" }).click();
  await expect(page.getByText("旧稿编码无法解析，请使用 UTF-8 编码")).toBeVisible();
});

test("recovers a chunked manuscript import after upload failure, pause and process interruption", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  let worker = await startWorker({
    importProcessingDelayMs: 1_000,
    workerLockDurationMs: 1_000,
    workerStalledIntervalMs: 1_000,
  });
  try {
    await authenticatedPage(page, context);
    await page.getByRole("button", { name: "导入旧稿", exact: true }).click();

    let failedChunk = false;
    await page.route("**/api/v1/imports/manuscripts/*/chunks", async (route) => {
      const payload = route.request().postDataJSON() as { sequence?: number };
      if (payload.sequence === 1 && !failedChunk) {
        failedChunk = true;
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });

    const manuscriptFixture = buildChunkedManuscriptFixture();
    const fixtureText = manuscriptFixture.toString("utf8");
    const chunkCount = Math.ceil(fixtureText.length / 250_000);
    const startResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname === "/api/v1/imports/manuscripts/chunked/start"
      );
    });
    await page.getByLabel("上传旧稿文件").setInputFiles({
      name: "chunked-recovery.txt",
      mimeType: "text/plain",
      buffer: manuscriptFixture,
    });
    await page.getByRole("button", { name: "识别章节" }).click();
    const importId = chunkedImportProgressResponseSchema.parse(await (await startResponse).json())
      .data.importId;

    await expect(page.getByText("分块上传暂时失败，请重试。")).toBeVisible();
    await expect(page.getByText(`已接收 1 / ${chunkCount}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "继续导入" })).toBeVisible();
    await attachResponsiveState(page, testInfo, "upload-failure", async () => {
      await expect(page.getByText("分块上传暂时失败，请重试。")).toBeVisible();
      await expect(page.getByRole("button", { name: "继续导入" })).toBeVisible();
    });

    await page.getByRole("button", { name: "继续导入" }).click();
    const pauseResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        /^\/api\/v1\/imports\/manuscripts\/[0-9a-f-]+\/pause$/u.test(url.pathname)
      );
    });
    await expect(page.getByRole("button", { name: "暂停处理" })).toBeVisible();
    await page.getByRole("button", { name: "暂停处理" }).click();
    await pauseResponse;
    await expect(page.getByRole("button", { name: "继续导入" })).toBeVisible();
    await attachResponsiveState(page, testInfo, "paused", async () => {
      await expect(page.getByRole("button", { name: "继续导入" })).toBeVisible();
    });

    await page.getByRole("button", { name: "继续导入" }).click();
    await expect(
      page.getByText(new RegExp(`已处理\\s*[1-${chunkCount - 1}]\\s*/\\s*${chunkCount}`)),
    ).toBeVisible({ timeout: 30_000 });
    await attachResponsiveState(page, testInfo, "processing", async () => {
      await expect(
        page.getByText(new RegExp(`已处理\\s*[1-${chunkCount - 1}]\\s*/\\s*${chunkCount}`)),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "暂停处理" })).toBeVisible();
    });
    await expect.poll(() => worker.activeJobCount()).toBe(1);
    const failureSequence = await readNextProcessSequence(importId);
    expect(failureSequence).toBeGreaterThan(0);
    await worker.crash();
    worker = await startWorker({
      failImportSequence: failureSequence,
      importProcessingDelayMs: 300,
      workerLockDurationMs: 1_000,
      workerStalledIntervalMs: 1_000,
    });
    await expect(page.getByText("旧稿分块处理部分失败，已保留进度，可以继续导入。")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(new RegExp(`已处理\\s*${failureSequence}\\s*/\\s*${chunkCount}`)),
    ).toBeVisible();
    await attachResponsiveState(page, testInfo, "partial-failure", async () => {
      await expect(
        page.getByText("旧稿分块处理部分失败，已保留进度，可以继续导入。"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "继续导入" })).toBeVisible();
    });

    await worker.stop();
    worker = await startWorker({ importProcessingDelayMs: 20 });
    await page.getByRole("button", { name: "继续导入" }).click();
    await expect(page.getByText("识别到 8 章")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/原文已安全保留在导入任务中/).first()).toBeVisible();
    await page.getByLabel("书名").fill("分块恢复旧稿");
    await attachResponsiveState(page, testInfo, "preview", async () => {
      await expect(page.getByText("识别到 8 章")).toBeVisible();
      await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeEnabled();
    });

    const confirmRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "POST" &&
        /^\/api\/v1\/imports\/manuscripts\/[0-9a-f-]+\/confirm-chunked$/u.test(url.pathname)
      );
    });
    const confirmResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        /^\/api\/v1\/imports\/manuscripts\/[0-9a-f-]+\/confirm-chunked$/u.test(url.pathname)
      );
    });
    await page.getByRole("button", { name: "确认并创建作品" }).click();
    const submittedConfirm = await confirmRequest;
    const confirmedResponse = await confirmResponse;
    const confirmed = workResponseSchema.parse(await confirmedResponse.json()).data;
    await expect(page).toHaveURL(new RegExp(`/workspace/${confirmed.id}/overview$`));
    const persistedWork = await getPersistedWork(page, confirmed.id);
    const persistedChapters = await getPersistedChapters(page, persistedWork);
    expect(persistedChapters).toHaveLength(8);
    expect(persistedChapters.map((chapter) => chapter.currentVersion?.content ?? "").join("")).toBe(
      manuscriptFixture.toString("utf8"),
    );
    expect(persistedChapters[0]?.currentVersion?.content.split("\n")[0]).toBe("第1章 分块旧稿0001");
    expect(persistedChapters[7]?.currentVersion?.content.split("\n")[0]).toBe("第8章 分块旧稿0008");

    const expectedContents = fixtureText.split(/(?=第\d+章 )/u).filter(Boolean);
    let expectedStart = 0;
    const expectedRanges = expectedContents.map((content) => {
      const range = { start: expectedStart, end: expectedStart + content.length };
      expectedStart = range.end;
      return range;
    });
    const csrfToken = await getCsrf(page.request);
    const replay = await page.request.post(confirmedResponse.url(), {
      headers: {
        Origin: "http://localhost:3000",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": "playwright-chunked-confirm-replay",
      },
      data: submittedConfirm.postDataJSON(),
    });
    expect(replay.status(), await replay.text()).toBe(200);

    const pool = new Pool({ connectionString: e2eDatabaseUrl });
    try {
      const persistedRanges = await pool.query<{
        number: number;
        content: string;
        source_start: number;
        source_end: number;
      }>(
        `SELECT chapter.number,
                version.content,
                (node.payload->'sourceRange'->>'start')::int AS source_start,
                (node.payload->'sourceRange'->>'end')::int AS source_end
           FROM chapters AS chapter
           INNER JOIN chapter_versions AS version ON version.chapter_id = chapter.id
           INNER JOIN version_nodes AS node ON node.id = version.version_node_id
          WHERE chapter.work_id = $1
          ORDER BY chapter.number`,
        [confirmed.id],
      );
      expect(persistedRanges.rows.map((row) => row.content)).toEqual(expectedContents);
      expect(
        persistedRanges.rows.map((row) => ({
          start: row.source_start,
          end: row.source_end,
        })),
      ).toEqual(expectedRanges);

      const counts = await pool.query<{
        chapters: number;
        versions: number;
        nodes: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM chapters WHERE work_id = $1) AS chapters,
           (SELECT count(*)::int FROM chapter_versions WHERE work_id = $1) AS versions,
           (SELECT count(*)::int
              FROM version_nodes
             WHERE work_id = $1 AND node_type = 'chapter_version') AS nodes`,
        [confirmed.id],
      );
      expect(counts.rows[0]).toEqual({ chapters: 8, versions: 8, nodes: 8 });
    } finally {
      await pool.end();
    }
  } finally {
    await worker.stop();
  }
});

async function attachResponsiveState(
  page: Page,
  testInfo: TestInfo,
  state: string,
  assertState?: () => Promise<void>,
) {
  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await assertState?.();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach(`new-project-${state}-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
}

async function readNextProcessSequence(importId: string): Promise<number> {
  const pool = new Pool({ connectionString: e2eDatabaseUrl });
  try {
    const result = await pool.query<{ next_process_sequence: number }>(
      `SELECT (checkpoint->>'nextProcessSequence')::int AS next_process_sequence
         FROM import_jobs
        WHERE id = $1`,
      [importId],
    );
    if (result.rows[0]?.next_process_sequence === undefined) {
      throw new Error("Chunked import checkpoint is missing nextProcessSequence");
    }
    return result.rows[0].next_process_sequence;
  } finally {
    await pool.end();
  }
}

test("persists a settings conflict decision before creating the work", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page
    .getByLabel("粘贴设定")
    .fill(
      [
        "人物：沈砚，外门杂役，左臂骨折。",
        "人物：沈砚，外门杂役，左臂完好。",
        "势力：太玄门，正道魁首。",
      ].join("\n"),
    );
  const importResponse = waitForApiResponse(page, "POST", "/api/v1/imports");
  await page.getByRole("button", { name: "开始识别" }).click();
  const settingsImport = settingsImportResponseSchema.parse(
    await (await importResponse).json(),
  ).data;
  const conflict = settingsImport.report.conflicts[0];
  expect(conflict).toBeDefined();
  if (!conflict) {
    throw new Error("Expected a persisted settings conflict");
  }
  expect(conflict.decision).toBe("pending");

  const blocked = page.getByRole("button", { name: "先裁决 1 条冲突" });
  await expect(blocked).toBeDisabled();
  await expect(
    page.locator(".settings-conflict-card").getByText("外门杂役，左臂骨折。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".settings-conflict-card").getByText("外门杂役，左臂完好。", { exact: true }),
  ).toBeVisible();

  const decisionResponse = waitForApiResponse(
    page,
    "POST",
    `/api/v1/imports/${settingsImport.id}/conflicts/${conflict.id}/decision`,
  );
  await page.getByRole("button", { name: "采用第一条" }).click();
  const decidedImport = settingsImportResponseSchema.parse(
    await (await decisionResponse).json(),
  ).data;
  expect(decidedImport.report.conflicts[0]?.decision).toBe("use_primary");
  await expect(page.getByText("已裁决 · 采用第一条")).toBeVisible();
  await page.getByLabel("书名").fill("冲突裁决后开书");
  await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeEnabled();

  const confirmResponse = waitForApiResponse(
    page,
    "POST",
    `/api/v1/imports/${settingsImport.id}/confirm`,
  );
  await page.getByRole("button", { name: "确认并创建作品" }).click();
  const createdWork = workResponseSchema.parse(await (await confirmResponse).json()).data;
  const persistedWork = await getPersistedWork(page, createdWork.id);
  const entities = await getPersistedSettingEntities(page, persistedWork);
  const character = entities.find((entity) => entity.type === "character");
  expect(character?.name).toBe("沈砚");
  if (character?.type === "character") {
    expect(character.data.bodyState).toBe("外门杂役，左臂骨折。");
  }
});

test("shows a recoverable settings-import error state", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page.getByLabel("粘贴设定").fill("人物：沈砚，外门杂役。");
  await page.route("**/api/v1/imports", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "设定识别服务暂时不可用。",
          details: {},
          requestId: "req_settings_import_error",
        },
      }),
    });
  });

  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.locator(".settings-import-panel .model-notice")).toContainText(
    "设定识别服务暂时不可用。",
  );
  await expect(page.getByRole("button", { name: "开始识别" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeDisabled();
});

test("keeps the settings-import flow usable at all required viewports", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  await page.getByRole("button", { name: "导入设定", exact: true }).click();
  await page
    .getByLabel("粘贴设定")
    .fill(["人物：沈砚，外门杂役。", "势力：太玄门，正道魁首。"].join("\n"));
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByRole("heading", { name: "识别结果" })).toBeVisible();

  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "把人物、势力、地图和体系带进来" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并创建作品" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
