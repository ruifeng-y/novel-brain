import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import {
  chapterWorkspaceListResponseSchema,
  generationReadinessResponseSchema,
  outlineNodeMutationResponseSchema,
  settingEntityListResponseSchema,
  styleDriftReportResponseSchema,
  styleDriftWorkspaceResponseSchema,
  volumeAuditReportResponseSchema,
  volumeAuditWorkspaceResponseSchema,
  workResponseSchema,
  type OutlineNodeCreateRequest,
} from "@novel-brain/contracts";

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

type WorkRef = { id: string; mainBranch: { id: string } };

function branchPath(work: WorkRef) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

async function createOutlineNode(
  page: Page,
  work: WorkRef,
  token: string,
  data: OutlineNodeCreateRequest,
) {
  const response = await page.request.post(`${branchPath(work)}/outline/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data,
  });
  expect(response.status()).toBe(201);
  return outlineNodeMutationResponseSchema.parse(await response.json()).data.node;
}

async function createPlannedVolumeFixture(page: Page, work: WorkRef) {
  const token = await getCsrf(page.request);
  const book = await createOutlineNode(page, work, token, {
    level: "book",
    parentId: null,
    title: "忘川书",
    summary: "",
    status: "active",
    tension: null,
  });
  const volume = await createOutlineNode(page, work, token, {
    level: "volume",
    parentId: book.id,
    title: "第一卷 · 断碑夜雨",
    summary: "",
    status: "active",
    tension: null,
  });
  const act = await createOutlineNode(page, work, token, {
    level: "act",
    parentId: volume.id,
    title: "第一幕 · 失忆",
    summary: "",
    status: "active",
    tension: null,
  });
  const chapterNode = await createOutlineNode(page, work, token, {
    level: "chapter",
    parentId: act.id,
    tension: 72,
    summary: "",
    status: "planned",
    chapterCreate: {
      number: 1,
      title: "断碑夜雨",
      brief: {
        goal: "让沈砚在旧宅里发现父母留下的线索。",
        pov: "沈砚",
        location: "荒寺旧宅",
        sceneBeats: ["沈砚藏起断臂。", "追兵逼近，两人继续上路。"],
        requiredFacts: ["左臂骨折，不能双手结印"],
      },
    },
  });
  expect(chapterNode.chapter).toBeTruthy();
  return { volume, chapter: chapterNode.chapter! };
}

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

async function expectReadOnlyWorkNavigation(page: Page) {
  for (const label of ["故事圣经", "设定中心", "大纲工作台", "伏笔账本", "写作台"]) {
    await expect(
      page.locator(".main-nav").getByRole("link", { name: label, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('.main-nav .nav-item[aria-disabled="true"]').filter({ hasText: label }),
    ).toBeVisible();
  }
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
  await page.reload();
  await expect(page.getByLabel("当前作品与创作线")).toContainText(
    "一部标题很长但仍然需要保持清晰可读的作品",
  );
  await expect(page.getByLabel("当前作品与创作线")).toContainText("主线");
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

test("continues into a persisted planned chapter with matching tasks and recent changes", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "断碑夜雨",
  });
  const { chapter } = await createPlannedVolumeFixture(page, work);
  const token = await getCsrf(page.request);
  const chaptersApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters?limit=100`;
  const entitiesApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities?limit=100`;
  const readinessApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/readiness`;
  const entityResponse = await page.request.post(`${branchPath(work)}/entities`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      type: "character",
      name: "沈砚",
      aliases: [],
      summary: "带着断臂追查身世的杂役。",
      description: "总览最近修改需要显示的持久化角色。",
      tags: [],
      data: {
        bodyState: "左臂骨折",
        knowledgeBoundary: "不知道父母死亡的真相",
        relationshipSummary: "与顾青同行",
      },
    },
  });
  expect(entityResponse.status()).toBe(201);

  const chaptersResponse = await page.request.get(chaptersApi);
  expect(chaptersResponse.status()).toBe(200);
  const persistedChapters = chapterWorkspaceListResponseSchema.parse(
    await chaptersResponse.json(),
  ).data;
  expect(persistedChapters.map(({ number, title }) => ({ number, title }))).toEqual([
    { number: 1, title: "断碑夜雨" },
  ]);
  const entitiesResponse = await page.request.get(entitiesApi);
  expect(entitiesResponse.status()).toBe(200);
  const persistedEntities = settingEntityListResponseSchema.parse(
    await entitiesResponse.json(),
  ).data;
  expect(persistedEntities.some((entity) => entity.name === "沈砚")).toBe(true);

  const readinessResponse = await page.request.get(readinessApi);
  expect(readinessResponse.status()).toBe(200);
  const readiness = generationReadinessResponseSchema.parse(await readinessResponse.json()).data;
  const pendingReadiness = readiness.items.filter((item) => !item.ready);
  const expectedTaskCount = Math.min(pendingReadiness.length, 3);

  await page.goto(`/workspace/${work.id}/overview`);
  const continueWriting = page.getByRole("link", { name: "继续写作", exact: true });
  await expect(continueWriting).toHaveAttribute(
    "href",
    `/workspace/${work.id}/write?chapterId=${chapter.id}`,
  );
  await expect(page.locator(".overview-task-item")).toHaveCount(expectedTaskCount);
  for (const task of pendingReadiness.slice(0, 3)) {
    await expect(page.locator(".overview-task-list")).toContainText(task.label);
  }
  await expect(page.locator(".overview-change-list")).toContainText("第 1 章 · 断碑夜雨");
  await expect(page.locator(".overview-change-list")).toContainText("沈砚");

  const writingChaptersApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`;
  const writingContextResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === writingChaptersApi,
  );
  await continueWriting.click();
  const writingContextChapters = chapterWorkspaceListResponseSchema.parse(
    await (await writingContextResponse).json(),
  ).data;
  expect(writingContextChapters.some((candidate) => candidate.id === chapter.id)).toBe(true);
  await expect(page).toHaveURL(
    new RegExp(`/workspace/${work.id}/write\\?chapterId=${chapter.id}$`, "u"),
  );
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
  await expect(page.getByLabel("当前作品与创作线")).toContainText("仙途模板");
  await freezeApiTimestamps(page);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/overview`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/overview$`, "u"));
    await expect(page.getByRole("heading", { name: "仙途模板" })).toBeVisible();
    await expect(page.getByLabel("当前作品与创作线")).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect
      .soft(page)
      .toHaveScreenshot(
        ["work-overview", `work-overview-${width}.png`],
        productionScreenshotOptions,
      );
  }
});

test("shows partial overview when optional style data fails", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "部分加载作品",
  });
  const stylePath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/style`;
  await page.route(`**${stylePath}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "文风与声线数据暂时不可用。",
          details: {},
          requestId: "req_overview_partial_style",
        },
      }),
    });
  });

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByRole("heading", { name: "部分加载作品" })).toBeVisible();
  await expect(page.getByLabel("当前作品与创作线")).toContainText("部分加载作品");
  await expect(page.getByText("文风与声线数据暂时不可用。")).toBeVisible();
  await expect(page.getByText("作品总览加载失败。")).toHaveCount(0);
  await expect(page.getByText("准备度", { exact: false }).first()).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);
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
  await expect(
    page.locator(".page-head").getByRole("link", { name: "返回工作台" }),
  ).toHaveAttribute("href", "/workspace");
  await expect(page.getByText("还没有章节。可以先从大纲创建第一章。")).toBeVisible();
  await expect(page.getByLabel("当前作品与创作线")).toContainText("作品已归档 · 只读");
  await expect(
    page.locator(".overview-next").getByRole("link", { name: "进入写作台" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".overview-chapters").getByRole("link", { name: "打开写作台" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".main-nav").getByRole("link", { name: "写作台", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('.main-nav .nav-item[aria-disabled="true"]').filter({ hasText: "写作台" }),
  ).toBeVisible();
  await expect(
    page.locator('.main-nav .nav-item[aria-disabled="true"]').filter({ hasText: "故事圣经" }),
  ).toHaveAttribute("title", "当前作品只读");
  await expectReadOnlyWorkNavigation(page);
  await expect(page.locator(".overview-remediation")).toHaveCount(0);
  await expect(page.locator(".overview-links .quick-link-grid")).toHaveCount(0);
  await expect(page.locator(".overview-style")).toHaveCount(0);
  await expect(page.locator(".overview-volume-audit")).toHaveCount(0);
  await expect(
    page.locator(".overview-chapters").getByRole("link", { name: "返回工作台" }),
  ).toHaveAttribute("href", "/workspace");
});

test("offers an outline recovery path for an empty work", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "空作品",
  });

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByText("还没有章节。可以先从大纲创建第一章。")).toBeVisible();
  await expect(
    page.locator(".overview-chapters").getByRole("link", { name: "去大纲创建第一章" }),
  ).toHaveAttribute("href", `/workspace/${work.id}/outline`);
});

test("uses the selected parallel branch across work pages", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "全局创作线",
  });
  const token = await getCsrf(page.request);
  const branchResponse = await page.request.post(`/api/v1/works/${work.id}/branches`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      name: "what-if",
      sourceNodeId: work.mainBranch.headNodeId,
      reason: "验证全局创作线切换",
    },
  });
  expect(branchResponse.status()).toBe(200);
  const branch = (await branchResponse.json()).data as { id: string };
  await page.request
    .post(`/api/v1/works/${work.id}/branches/${branch.id}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        type: "character",
        name: "平行线角色",
        aliases: [],
        summary: "只存在于平行版本。",
        description: "用于验证全局分支上下文。",
        tags: [],
        data: {
          bodyState: "正常",
          knowledgeBoundary: "不知道主线秘密",
          relationshipSummary: "尚未登场",
        },
      },
    })
    .then((response) => expect(response.status()).toBe(201));
  const branchEntitiesApi = `/api/v1/works/${work.id}/branches/${branch.id}/entities?limit=100`;
  const branchEntitiesResponse = await page.request.get(branchEntitiesApi);
  expect(branchEntitiesResponse.status()).toBe(200);
  const branchEntities = settingEntityListResponseSchema.parse(
    await branchEntitiesResponse.json(),
  ).data;
  expect(branchEntities.some((entity) => entity.name === "平行线角色")).toBe(true);

  await page.goto("/workspace");
  await page.evaluate(
    ({ branchId, workId }) => {
      window.localStorage.setItem(`nb_active_branch_id:${workId}`, branchId);
    },
    { branchId: branch.id, workId: work.id },
  );
  const branchOverviewApi = `/api/v1/works/${work.id}?branchId=${branch.id}`;
  const branchOverviewUrl = new URL(branchOverviewApi, origin);
  const branchOverviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === branchOverviewUrl.pathname &&
      new URL(response.url()).searchParams.get("branchId") ===
        branchOverviewUrl.searchParams.get("branchId"),
  );
  await page.goto(`/workspace/${work.id}/overview`);
  const branchOverview = workResponseSchema.parse(await (await branchOverviewResponse).json()).data;
  expect(branchOverview.mainBranch.id).toBe(branch.id);
  await expect(page.getByLabel("切换创作线")).toHaveValue(branch.id);
  await expect(page.getByLabel("当前作品与创作线")).toContainText("what-if");
  await expect(page.locator(".overview-change-list")).toContainText("平行线角色");

  const mainOverviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/v1/works/${work.id}` &&
      new URL(response.url()).searchParams.get("branchId") === work.mainBranch.id,
  );
  await page.getByLabel("切换创作线").selectOption(work.mainBranch.id);
  const mainOverview = workResponseSchema.parse(await (await mainOverviewResponse).json()).data;
  expect(mainOverview.mainBranch.id).toBe(work.mainBranch.id);
  await expect(page.getByLabel("切换创作线")).toHaveValue(work.mainBranch.id);
  await expect(page.getByLabel("当前作品与创作线")).toContainText("主线");
  await expect(page.locator(".overview-change-list")).toHaveCount(0);
  const mainEntitiesResponse = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities?limit=100`,
  );
  expect(mainEntitiesResponse.status()).toBe(200);
  const mainEntities = settingEntityListResponseSchema.parse(
    await mainEntitiesResponse.json(),
  ).data;
  expect(mainEntities.some((entity) => entity.name === "平行线角色")).toBe(false);
});

test("treats an archived branch as read-only without write links", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "归档创作线",
  });
  const pool = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
  });
  try {
    await pool.query("UPDATE work_branches SET status = 'archived' WHERE work_id = $1", [work.id]);
  } finally {
    await pool.end();
  }

  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByText("创作线状态 只读")).toBeVisible();
  await expect(page.getByRole("button", { name: "继续写作" })).toBeDisabled();
  await expect(
    page.locator(".overview-next").getByRole("link", { name: "进入写作台" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".overview-chapters").getByRole("link", { name: "打开写作台" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".main-nav").getByRole("link", { name: "写作台", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('.main-nav .nav-item[aria-disabled="true"]').filter({ hasText: "故事圣经" }),
  ).toHaveAttribute("title", "当前创作线只读");
  await expectReadOnlyWorkNavigation(page);
  await expect(page.locator(".overview-remediation")).toHaveCount(0);
  await expect(page.locator(".overview-style")).toHaveCount(0);
  await expect(page.locator(".overview-volume-audit")).toHaveCount(0);
  await expect(page.getByLabel("当前作品与创作线")).toContainText("创作线已归档");
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
  await expect(
    page.locator(".page-head").getByRole("link", { name: "返回工作台" }),
  ).toHaveAttribute("href", "/workspace");
  await expect(page.getByLabel("当前作品与创作线")).toContainText("作品已完本 · 只读");
  await expect(
    page.locator(".overview-next").getByRole("link", { name: "进入写作台" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".overview-chapters").getByRole("link", { name: "打开写作台" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".main-nav").getByRole("link", { name: "写作台", exact: true }),
  ).toHaveCount(0);
  await expectReadOnlyWorkNavigation(page);
  await expect(page.locator(".overview-remediation")).toHaveCount(0);
  await expect(page.locator(".overview-links .quick-link-grid")).toHaveCount(0);
  await expect(page.locator(".overview-style")).toHaveCount(0);
  await expect(page.locator(".overview-volume-audit")).toHaveCount(0);
});

test("runs and signs off a persisted volume audit", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "卷末审计证据",
  });
  const { volume } = await createPlannedVolumeFixture(page, work);
  const volumeAuditsApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/volume-audits`;

  await page.goto(`/workspace/${work.id}/overview`);
  const panel = page.locator(".overview-volume-audit");
  await expect(panel.getByRole("heading", { name: "卷末审计" })).toBeVisible();
  const runButton = panel.getByRole("button", { name: "开始卷末审计" });
  await expect(runButton).toBeEnabled();

  const auditResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === volumeAuditsApi,
  );
  await runButton.click();
  const auditReport = volumeAuditReportResponseSchema.parse(
    await (await auditResponse).json(),
  ).data;
  expect(auditReport.volumeNodeId).toBe(volume.id);
  await expect(panel.locator(`[data-volume-audit-status="${auditReport.status}"]`)).toBeVisible();

  const workspaceResponse = await page.request.get(volumeAuditsApi);
  expect(workspaceResponse.status()).toBe(200);
  const persistedWorkspace = volumeAuditWorkspaceResponseSchema.parse(
    await workspaceResponse.json(),
  ).data;
  expect(persistedWorkspace.latestReport?.id).toBe(auditReport.id);

  const rationale = "第一卷正文与账本证据已核对，仍需补齐卷级问题后再申请通过。";
  const signoffApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/volume-audits/${auditReport.id}/signoff`;
  await panel.getByLabel("验收结论").selectOption("changes_requested");
  await panel.getByLabel("签收意见").fill(rationale);
  const signoffResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === signoffApi,
  );
  await panel.getByRole("button", { name: "保存签收记录" }).click();
  const signedReport = volumeAuditReportResponseSchema.parse(
    await (await signoffResponse).json(),
  ).data;
  expect(signedReport.signoff?.decision).toBe("changes_requested");
  expect(signedReport.signoff?.rationale).toBe(rationale);
  await expect(panel.getByText("作者要求修改")).toBeVisible();

  const persistedSignoffResponse = await page.request.get(volumeAuditsApi);
  expect(persistedSignoffResponse.status()).toBe(200);
  const persistedSignoff = volumeAuditWorkspaceResponseSchema.parse(
    await persistedSignoffResponse.json(),
  ).data;
  expect(persistedSignoff.latestReport?.signoff?.decision).toBe("changes_requested");
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
  await expect(
    page.locator(".overview-change-list").getByText("世界规则", { exact: true }).first(),
  ).toBeVisible();
  await expectAuthorFacingLanguage(page);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/overview$`, "u"));
    await expect(page.getByLabel("当前作品与创作线")).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .soft(page)
      .toHaveScreenshot(
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
  const styleDriftApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/style/drift`;
  const styleWorkspaceApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/style`;

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

  const driftResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === styleDriftApi,
  );
  await page.getByRole("button", { name: "检查跨卷趋势" }).click();
  const driftReport = styleDriftReportResponseSchema.parse(await (await driftResponse).json()).data;
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

  const persistedStyleResponse = await page.request.get(styleWorkspaceApi);
  expect(persistedStyleResponse.status()).toBe(200);
  const persistedStyle = styleDriftWorkspaceResponseSchema.parse(
    await persistedStyleResponse.json(),
  ).data;
  expect(persistedStyle.latestCrossVolumeReport?.id).toBe(driftReport.id);

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
