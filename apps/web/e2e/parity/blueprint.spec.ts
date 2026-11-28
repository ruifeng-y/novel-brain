import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { workBlueprintResponseSchema, type WorkBlueprint } from "@novel-brain/contracts";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  freezeApiTimestamps,
  productionScreenshotOptions,
} from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("blueprint");
  const session = await registerUser(page.request, email, "StrongPassword123", "蓝图作者");
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

async function createPlanningModelConfig(request: APIRequestContext) {
  const token = await getCsrf(request);
  const response = await request.post("/api/v1/model-configs", {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      provider: "deepseek",
      label: "故事蓝图规划",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-fake-blueprint-1234",
      purposes: ["planning", "writing", "review"],
      isDefault: true,
    },
  });
  expect(response.status()).toBe(200);
}

async function waitForBlueprintStatus(
  request: APIRequestContext,
  work: Awaited<ReturnType<typeof createWork>>,
  expected: WorkBlueprint["status"],
): Promise<WorkBlueprint> {
  const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
  let current: WorkBlueprint | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(path);
        if (!response.ok()) {
          return `http-${response.status()}`;
        }
        current = workBlueprintResponseSchema.parse(await response.json()).data;
        return current.status;
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .toBe(expected);
  if (!current) {
    throw new Error("Blueprint status polling did not return data");
  }
  return current;
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("loads a persisted story blueprint and shows generation progress", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });

  await page.goto(`/workspace/${work.id}/blueprint`);

  await expect(page.getByRole("heading", { name: "审阅故事蓝图" })).toBeVisible();
  await expect(page.getByText("忘川书", { exact: true }).first()).toBeVisible();
  await expect(page.locator('.page[data-blueprint-status="queued"]')).toBeVisible();
  await expect(page.getByText("正在生成故事蓝图")).toBeVisible();
  await expect(page.getByLabel("故事蓝图生成进度")).toContainText("0%");
});

test("reviews generated candidates, gates confirmation, and persists not-applicable reasons", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  await createPlanningModelConfig(page.request);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const worker = await startWorker();
  try {
    const blueprint = await waitForBlueprintStatus(page.request, work, "waiting_review");
    const pool = new Pool({
      connectionString:
        process.env.E2E_DATABASE_URL ??
        "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
    });
    try {
      await pool.query(
        `UPDATE work_blueprints
            SET core_settings_draft = COALESCE(
                  (
                    SELECT jsonb_agg(candidate)
                      FROM jsonb_array_elements(core_settings_draft) AS candidate
                     WHERE candidate->>'type' <> 'item'
                  ),
                  '[]'::jsonb
                ),
                missing_fields = $2::jsonb,
                conflicts = $3::jsonb,
                version = version + 1
          WHERE id = $1`,
        [
          blueprint.id,
          JSON.stringify([
            {
              key: "core_setting:item",
              label: "item",
              required: true,
              severity: "P0",
              message: "核心设定缺少 item",
            },
          ]),
          JSON.stringify([
            {
              id: "01900000-0000-7000-8000-000000009001",
              severity: "P0",
              title: "时间线互相排斥",
              detail: "同一夜沈砚被安排在两处地点，需要保留一条路线。",
              affectedKeys: ["outline:nodes"],
              status: "open",
            },
            {
              id: "01900000-0000-7000-8000-000000009002",
              severity: "P1",
              title: "角色知道秘密的时间偏早",
              detail: "建议把第二次暗示后移。",
              affectedKeys: ["storyBible:cards"],
              status: "open",
            },
            {
              id: "01900000-0000-7000-8000-000000009003",
              severity: "P2",
              title: "章末钩子语气重复",
              detail: "可增加动作型悬念。",
              affectedKeys: ["outline:nodes"],
              status: "open",
            },
          ]),
        ],
      );
    } finally {
      await pool.end();
    }

    await page.goto(`/workspace/${work.id}/blueprint`);
    await expect(page.getByRole("heading", { name: "审阅故事蓝图" })).toBeVisible();
    await expect(
      page.locator(".title-with-badge").getByText("待你确认", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".story-bible-card")).toHaveCount(9);
    await expect(page.getByRole("heading", { name: "核心设定候选" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "初始大纲基线" })).toBeVisible();
    await expect(page.getByText("Token 用量", { exact: true })).toBeVisible();
    await expect(page.getByText("费用与预算", { exact: true })).toBeVisible();
    await expect(page.locator('.blueprint-conflict[data-severity="P0"]').first()).toContainText(
      "必须解决",
    );
    await expect(page.locator('.blueprint-conflict[data-severity="P1"]')).toContainText("建议处理");
    await expect(page.locator('.blueprint-conflict[data-severity="P2"]')).toContainText("可选优化");
    await expectAuthorFacingLanguage(page);

    const confirm = page.getByRole("button", { name: "确认蓝图" });
    await expect(confirm).toBeDisabled();
    await expect(page.getByText(/必须先处理/)).toBeVisible();

    await page.getByRole("button", { name: "标记不适用" }).click();
    await page.getByLabel("不适用理由").fill("开篇十二章只写人物追索，不引入可追踪物品。");
    const patchResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith("/blueprint/draft"),
    );
    await page.getByRole("button", { name: "确认不适用" }).click();
    expect((await patchResponse).status()).toBe(200);
    await expect(page.getByText("已标记不适用", { exact: true })).toBeVisible();

    const persistedResponse = await page.request.get(
      `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`,
    );
    const persisted = workBlueprintResponseSchema.parse(await persistedResponse.json()).data;
    expect(persisted.acknowledgements).toContainEqual({
      fieldKey: "core_setting:item",
      decision: "not_applicable",
      reason: "开篇十二章只写人物追索，不引入可追踪物品。",
    });
  } finally {
    await worker.stop();
  }
});

test("waits for model configuration and can cancel before generation", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "等待模型",
    idea: "一个没有可用模型时仍然保留检查点的故事。",
    genre: "xianxia",
    scaleTarget: "short",
    chapterLengthTarget: 3000,
    blueprintBudget: { maxTokens: 600000, maxCostCny: 10 },
  });
  const worker = await startWorker();
  try {
    await waitForBlueprintStatus(page.request, work, "waiting_model_config");
    await page.goto(`/workspace/${work.id}/blueprint`);

    await expect(page.locator('.page[data-blueprint-status="waiting_model_config"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "还差一个可用的模型连接" })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开模型设置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "配置完成后重试" })).toBeVisible();

    const cancelResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/blueprint/cancel"),
    );
    await page.getByRole("button", { name: "取消蓝图" }).click();
    expect((await cancelResponse).status()).toBe(200);
    await expect(page.locator('.page[data-blueprint-status="cancelled"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "候选和检查点仍然保留" })).toBeVisible();
    await expect(page.getByRole("button", { name: "重新生成" })).toHaveCount(0);
  } finally {
    await worker.stop();
  }
});

test("polls a queued blueprint until generation finishes", async ({ page, context }) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  await createPlanningModelConfig(page.request);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "自动刷新",
    idea: "页面打开后等待后台完成故事蓝图。",
    genre: "xianxia",
    scaleTarget: "short",
    chapterLengthTarget: 3000,
    blueprintBudget: { maxTokens: 600000, maxCostCny: 10 },
  });

  await page.goto(`/workspace/${work.id}/blueprint`);
  await expect(page.locator('.page[data-blueprint-status="queued"]')).toBeVisible();

  const worker = await startWorker();
  try {
    await expect(page.locator('.page[data-blueprint-status="waiting_review"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".story-bible-card")).toHaveCount(9);
  } finally {
    await worker.stop();
  }
});

test("edits story bible and outline candidates through the persisted draft API", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  await createPlanningModelConfig(page.request);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "可编辑蓝图",
    idea: "作者需要修正候选内容后再确认。",
    genre: "xianxia",
    scaleTarget: "short",
    chapterLengthTarget: 3000,
    blueprintBudget: { maxTokens: 600000, maxCostCny: 10 },
  });
  const worker = await startWorker();
  try {
    const original = await waitForBlueprintStatus(page.request, work, "waiting_review");
    await page.goto(`/workspace/${work.id}/blueprint`);

    await page.getByRole("button", { name: "编辑九卡" }).click();
    await page.getByLabel("一句话故事内容").fill("作者修订后的故事核心。");
    const storyResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith("/blueprint/draft"),
    );
    await page.getByRole("button", { name: "保存九卡" }).click();
    const storyPatch = workBlueprintResponseSchema.parse(await (await storyResponse).json()).data;
    expect(storyPatch.version).toBeGreaterThan(original.version);
    expect(storyPatch.storyBibleDraft?.cards[0]?.content).toBe("作者修订后的故事核心。");

    await page.getByRole("button", { name: "编辑章纲" }).click();
    await page.getByLabel("第 1 章标题").fill("作者修订后的第一章");
    const outlineResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith("/blueprint/draft"),
    );
    await page.getByRole("button", { name: "保存章纲" }).click();
    const outlinePatch = workBlueprintResponseSchema.parse(
      await (await outlineResponse).json(),
    ).data;
    expect(outlinePatch.outlineDraft?.nodes.find((node) => node.level === "chapter")?.title).toBe(
      "作者修订后的第一章",
    );

    await page.getByRole("button", { name: "编辑章纲" }).click();
    await page.getByLabel("第 1 章目标").fill("让作者确认章纲目标可以持久化。");
    await page.getByLabel("场景 1-1 标题").fill("作者修订后的场景");
    await page.getByLabel("场景 1-1 节拍").fill("第一条节拍\n第二条节拍");
    await page.getByLabel("场景 1-1 信息释放").fill("释放修订后的信息");
    const sceneResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith("/blueprint/draft"),
    );
    await page.getByRole("button", { name: "保存章纲" }).click();
    const scenePatch = workBlueprintResponseSchema.parse(await (await sceneResponse).json()).data;
    expect(
      scenePatch.outlineDraft?.nodes.find((node) => node.level === "chapter")?.brief?.goal,
    ).toBe("让作者确认章纲目标可以持久化。");
    expect(scenePatch.outlineDraft?.sceneCards[0]?.title).toBe("作者修订后的场景");
    expect(scenePatch.outlineDraft?.sceneCards[0]?.beats).toEqual(["第一条节拍", "第二条节拍"]);

    const persistedResponse = await page.request.get(
      `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`,
    );
    const persisted = workBlueprintResponseSchema.parse(await persistedResponse.json()).data;
    expect(persisted.storyBibleDraft?.cards[0]?.content).toBe("作者修订后的故事核心。");
    expect(persisted.outlineDraft?.nodes.find((node) => node.level === "chapter")?.title).toBe(
      "作者修订后的第一章",
    );
    expect(
      persisted.outlineDraft?.nodes.find((node) => node.level === "chapter")?.brief?.goal,
    ).toBe("让作者确认章纲目标可以持久化。");
    expect(persisted.outlineDraft?.sceneCards[0]?.title).toBe("作者修订后的场景");
  } finally {
    await worker.stop();
  }
});

test("keeps confirmation failure in place and enters overview after a successful retry", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  await createPlanningModelConfig(page.request);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "确认蓝图",
    idea: "候选完整后由作者确认并进入总览。",
    genre: "xianxia",
    scaleTarget: "short",
    chapterLengthTarget: 3000,
    blueprintBudget: { maxTokens: 600000, maxCostCny: 10 },
  });
  const worker = await startWorker();
  try {
    const blueprint = await waitForBlueprintStatus(page.request, work, "waiting_review");
    expect(blueprint.allowedActions).not.toContain("confirm");
    await page.goto(`/workspace/${work.id}/blueprint`);

    for (let index = 0; index < blueprint.missingFields.length; index += 1) {
      await page.getByRole("button", { name: "标记不适用" }).first().click();
      await page
        .getByLabel("不适用理由")
        .fill(`开篇候选暂不采用题材字段 ${blueprint.missingFields[index]!.label}。`);
      const acknowledgementResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname.endsWith("/blueprint/draft"),
      );
      await page.getByRole("button", { name: "确认不适用" }).click();
      expect((await acknowledgementResponse).status()).toBe(200);
    }

    const confirmPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint/confirm`;
    await page.route(`**${confirmPath}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "故事蓝图刚刚更新，请刷新后再确认。",
            details: {},
            requestId: "req_blueprint_confirm_conflict",
          },
        }),
      });
    });

    const confirmButton = page.getByRole("button", { name: "确认蓝图" });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(page.locator(".blueprint-action-error")).toContainText("故事蓝图刚刚更新");
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/blueprint$`, "u"));

    await page.unroute(`**${confirmPath}`);
    const confirmResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === confirmPath,
    );
    await confirmButton.click();
    expect((await confirmResponse).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/overview$`, "u"));

    await page.goto(`/workspace/${work.id}/blueprint`);
    await expect(page.locator('.page[data-blueprint-status="confirmed"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "故事圣经、核心设定和初始大纲已锁定" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑九卡" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认蓝图" })).toBeDisabled();
  } finally {
    await worker.stop();
  }
});

test("handles paused, failed, running and readonly lifecycle actions", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  await createPlanningModelConfig(page.request);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "生命周期蓝图",
    idea: "用于验证预算、失败、运行和只读状态的候选。",
    genre: "xianxia",
    scaleTarget: "short",
    chapterLengthTarget: 3000,
    blueprintBudget: { maxTokens: 200000, maxCostCny: 2 },
  });
  const worker = await startWorker();
  let blueprint: WorkBlueprint;
  try {
    blueprint = await waitForBlueprintStatus(page.request, work, "waiting_review");
  } finally {
    await worker.stop();
  }

  const pool = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e",
  });
  try {
    await pool.query(`UPDATE work_blueprints SET status = 'budget_paused' WHERE id = $1`, [
      blueprint.id,
    ]);
    await page.goto(`/workspace/${work.id}/blueprint`);
    await expect(page.locator('.page[data-blueprint-status="budget_paused"]')).toBeVisible();
    await expect(page.getByText("下一次模型调用会超过当前预算")).toBeVisible();
    await expect(page.getByLabel("Token 上限")).toBeVisible();
    await expect(page.getByLabel("费用上限（元）")).toBeVisible();

    const budgetResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/blueprint/budget"),
    );
    await page.getByRole("button", { name: "提高预算并继续" }).click();
    expect((await budgetResponse).status()).toBe(202);
    await expect(page.locator('.page[data-blueprint-status="queued"]')).toBeVisible();

    await pool.query(`UPDATE work_blueprints SET status = 'running' WHERE id = $1`, [blueprint.id]);
    await page.reload();
    await expect(page.locator('.page[data-blueprint-status="running"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "取消生成" })).toBeVisible();

    await pool.query(`UPDATE work_blueprints SET status = 'failed' WHERE id = $1`, [blueprint.id]);
    await page.reload();
    await expect(page.locator('.page[data-blueprint-status="failed"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "故事蓝图生成中断" })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消蓝图" })).toHaveCount(0);
    const retryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/blueprint/retry"),
    );
    await page.getByRole("button", { name: "从检查点重试" }).click();
    expect((await retryResponse).status()).toBe(202);
    await expect(page.locator('.page[data-blueprint-status="queued"]')).toBeVisible();

    await pool.query(`UPDATE work_blueprints SET status = 'waiting_review' WHERE id = $1`, [
      blueprint.id,
    ]);
    await pool.query(`UPDATE works SET status = 'archived' WHERE id = $1`, [work.id]);
    await page.reload();
    await expect(page.getByText("作品已归档，当前为只读状态。")).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑九卡" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认蓝图" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "取消蓝图" })).toHaveCount(0);
  } finally {
    await pool.end();
  }
});

test("shows empty and recoverable load error states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const blankWork = await createWork(page.request, {
    mode: "blank",
    title: "空白作品",
  });
  await page.goto(`/workspace/${blankWork.id}/blueprint`);
  await expect(page.getByRole("heading", { name: "还没有故事蓝图" })).toBeVisible();
  await expect(page.getByText("这一创作线还没有生成故事蓝图。")).toBeVisible();

  const ideaWork = await createWork(page.request, {
    mode: "idea",
    title: "加载失败",
    idea: "页面出错后应能重试。",
    genre: "history",
    scaleTarget: "short",
    chapterLengthTarget: 3000,
  });
  const blueprintPath = `/api/v1/works/${ideaWork.id}/branches/${ideaWork.mainBranch.id}/blueprint`;
  await page.route(`**${blueprintPath}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "故事蓝图暂时无法加载。",
          details: {},
          requestId: "req_blueprint_load_error",
        },
      }),
    });
  });
  await page.goto(`/workspace/${ideaWork.id}/blueprint`);
  await expect(page.getByRole("alert").filter({ hasText: "故事蓝图暂时无法加载。" })).toBeVisible();
  await page.unroute(`**${blueprintPath}`);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.locator('.page[data-blueprint-status="queued"]')).toBeVisible();
});

test("keeps the signed blueprint layout usable at four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  await createPlanningModelConfig(page.request);
  const longIdea =
    "一个被宗门抛弃的杂役，靠吞掉记忆的古书爬上仙途，并在每一次代价里重新认识身边的人。".repeat(4);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书里没有说完的旧事与四档审阅证据",
    idea: longIdea,
    genre: "xianxia",
    scaleTarget: "short",
    chapterLengthTarget: 4200,
    blueprintBudget: { maxTokens: 200000, maxCostCny: 2 },
  });
  const worker = await startWorker();
  try {
    await waitForBlueprintStatus(page.request, work, "waiting_review");
    await freezeApiTimestamps(page);
    await page.goto(`/workspace/${work.id}/blueprint`);
    await expect(page.locator(".story-bible-card")).toHaveCount(9);
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 900, height: 900 },
      { width: 1180, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const clipped = await page.evaluate(() => {
        const selectors = [
          ".blueprint-status-card",
          ".blueprint-metric",
          ".story-bible-card",
          ".blueprint-setting-card",
          ".blueprint-required-field",
          ".blueprint-table-row",
          ".blueprint-scene-card",
          ".blueprint-gate-item",
          ".blueprint-conflict",
          ".blueprint-confirm-card",
        ];
        return selectors.flatMap((selector) =>
          [...document.querySelectorAll<HTMLElement>(selector)]
            .filter((element) => element.offsetParent !== null)
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => ({
              selector,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              text: element.textContent?.trim().slice(0, 80),
            })),
        );
      });
      expect(clipped).toEqual([]);

      await testInfo.attach(`blueprint-${viewport.width}`, {
        body: await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true,
        }),
        contentType: "image/png",
      });
      await expect
        .soft(page)
        .toHaveScreenshot(
          ["blueprint", `blueprint-${viewport.width}.png`],
          productionScreenshotOptions,
        );
    }
  } finally {
    await worker.stop();
  }
});
