import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  chapterWorkspaceListResponseSchema,
  workListResponseSchema,
  workPurgeResponseSchema,
  workResponseSchema,
  workTrashResponseSchema,
} from "@novel-brain/contracts";
import { Pool } from "pg";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { createM0Chapter } from "../helpers/m0";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  productionScreenshotOptions,
  waitForApiResponse,
} from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";
const coverImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAS0lEQVRYhe3YwQkAMAxC0W7kRq7g/rdOUejhQe6BkKg/J+vTOhrMiGqL4tBKKkJNx3DCMidVVPCa6FjpOgCkECooc0A8Xgn7+NtyAd3p6ExZ1H3MAAAAAElFTkSuQmCC",
  "base64",
);

async function persistedWork(page: Page, workId: string) {
  const response = await page.request.get(`/api/v1/works/${workId}`);
  expect(response.status()).toBe(200);
  return workResponseSchema.parse(await response.json()).data;
}

async function trashWorkFromSettings(page: Page, workId: string) {
  const trashApi = `/api/v1/works/${workId}/trash`;
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page.getByRole("dialog")).toContainText("30 天内仍可在工作台恢复");
  const trashResponsePromise = waitForApiResponse(page, "POST", trashApi);
  await page.getByRole("button", { name: "确认移入" }).click();
  const response = await trashResponsePromise;
  expect(response.status()).toBe(200);
  return workTrashResponseSchema.parse(await response.json()).data;
}

async function authenticatedWorkPage(
  page: Page,
  context: BrowserContext,
  beforePageLoad?: (workId: string) => Promise<void>,
) {
  const email = uniqueEmail("work-settings");
  const session = await registerUser(page.request, email, "StrongPassword123", "作品设置作者");
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
  const work = await createWork(page.request, {
    mode: "blank",
    title: "仙途：忘川书",
    genre: "xianxia",
    scaleTarget: "long",
  });
  await beforePageLoad?.(work.id);
  await page.goto(`/workspace/${work.id}/work-settings`);
  await expect(page.getByRole("heading", { name: "把这本书的边界定清楚" })).toBeVisible();
  return work;
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("saves settings, tags, status and cover through production APIs", async ({
  page,
  context,
}) => {
  const work = await authenticatedWorkPage(page, context);
  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);
  const updateApi = `/api/v1/works/${work.id}`;

  await test.step("save settings", async () => {
    await page.getByLabel("书名").fill("仙途：忘川书 · 修订");
    await page.getByLabel("笔名").fill("青舟");
    await page.getByLabel("题材").selectOption("history");
    await page.getByLabel("目标平台").fill("起点中文网");
    await page.getByLabel("目标读者").fill("偏好长线伏笔的读者");
    await page.getByLabel("读者承诺").fill("每次变强都要付出记忆代价");
    await page.getByLabel("章节字数").fill("3200");
    await page.getByLabel("更新节奏").selectOption("every_other_day");
    const saveResponsePromise = waitForApiResponse(page, "PATCH", updateApi);
    await page.getByRole("button", { name: "保存设置" }).click();
    const savedResponse = await saveResponsePromise;
    expect(savedResponse.status()).toBe(200);
    const persisted = await persistedWork(page, work.id);
    expect(persisted.title).toBe("仙途：忘川书 · 修订");
    expect(persisted.settings.readerPromise).toBe("每次变强都要付出记忆代价");
  });

  await test.step("edit tags", async () => {
    await page.getByLabel("标签").fill("记忆代价, 长线伏笔");
    const tagsResponsePromise = waitForApiResponse(page, "PATCH", updateApi);
    await page.getByRole("button", { name: "保存设置" }).click();
    expect((await tagsResponsePromise).status()).toBe(200);
    const persisted = await persistedWork(page, work.id);
    expect(persisted.tags).toEqual(["记忆代价", "长线伏笔"]);
  });

  let coverVersion = 0;
  await test.step("change status", async () => {
    await page.getByLabel("连载状态").selectOption("serializing");
    const statusResponsePromise = waitForApiResponse(page, "PATCH", updateApi);
    await page.getByRole("button", { name: "保存设置" }).click();
    expect((await statusResponsePromise).status()).toBe(200);
    const persisted = await persistedWork(page, work.id);
    expect(persisted.status).toBe("serializing");
    coverVersion = persisted.version;
  });

  await test.step("upload cover", async () => {
    const uploadApi = `/api/v1/works/${work.id}/cover?version=${coverVersion}`;
    const uploadUrl = new URL(uploadApi, origin);
    const uploadResponsePromise = waitForApiResponse(
      page,
      "PUT",
      uploadUrl.pathname,
      Object.fromEntries(uploadUrl.searchParams),
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: coverImage,
    });
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(200);
    const uploaded = workResponseSchema.parse(await uploadResponse.json()).data;
    expect(uploaded.coverImageUrl).toContain(`/api/v1/works/${work.id}/cover`);
    await expect(page.getByText("作品封面已更新。")).toBeVisible();
    const coverResponse = await page.request.get(uploaded.coverImageUrl!);
    expect(coverResponse.status()).toBe(200);
    expect(coverResponse.headers()["content-type"]).toContain("image/webp");
    expect((await coverResponse.body()).byteLength).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByLabel("书名")).toHaveValue("仙途：忘川书 · 修订");
    await expect(page.getByLabel("标签")).toHaveValue("记忆代价, 长线伏笔");
    await expect(page.getByRole("img", { name: "作品封面" })).toBeVisible();
  });
});

test("archives and restores a work through production APIs", async ({ page, context }) => {
  const work = await authenticatedWorkPage(page, context);
  const beforeArchive = await persistedWork(page, work.id);
  const archiveApi = `/api/v1/works/${work.id}/archive`;
  const archiveResponsePromise = waitForApiResponse(page, "POST", archiveApi);
  await page.getByRole("button", { name: "归档作品" }).click();
  await expect(page.getByRole("dialog")).toContainText("归档不会删除分支、版本或正文");
  await page.getByRole("button", { name: "确认归档" }).click();
  const archivedResponse = await archiveResponsePromise;
  expect(archivedResponse.status()).toBe(200);
  const archived = await persistedWork(page, work.id);
  expect(archived.status).toBe("archived");
  await expect(page.getByText("作品已归档，可在工作台筛选“已归档”后恢复。")).toBeVisible();

  const restoreApi = `/api/v1/works/${work.id}/restore`;
  const restoreResponsePromise = waitForApiResponse(page, "POST", restoreApi);
  await page.getByRole("button", { name: "恢复作品" }).first().click();
  const restoredResponse = await restoreResponsePromise;
  expect(restoredResponse.status()).toBe(200);
  const restored = await persistedWork(page, work.id);
  expect(restored.status).toBe(beforeArchive.status);
  expect(restored.mainBranch.id).toBe(beforeArchive.mainBranch.id);
  expect(restored.archivedAt).toBeNull();
  await expect(page.getByText("作品已恢复到归档前状态。")).toBeVisible();
});

test("keeps author edits when an earlier page load finishes late", async ({ page, context }) => {
  let requestCount = 0;
  await authenticatedWorkPage(page, context, async (workId) => {
    await page.route(`**/api/v1/works/${workId}`, async (route) => {
      requestCount += 1;
      if (requestCount > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await route.continue();
    });
  });

  await page.getByLabel("书名").fill("仙途：忘川书 · 并发修订");
  await page.waitForTimeout(700);

  await expect(page.getByLabel("书名")).toHaveValue("仙途：忘川书 · 并发修订");
});

test("duplicates with conservative defaults", async ({ page, context }) => {
  const work = await authenticatedWorkPage(page, context);
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const chapter = await createM0Chapter(page.request, work);
  const chapterResponse = await page.request.get(`${branchPath}/chapters/${chapter.id}`);
  expect(chapterResponse.status()).toBe(200);
  const chapterVersion = (await chapterResponse.json()).data.version as number;
  const chapterToken = await getCsrf(page.request);
  const savedChapter = await page.request.post(`${branchPath}/chapters/${chapter.id}/versions`, {
    headers: { Origin: origin, "X-CSRF-Token": chapterToken },
    data: {
      version: chapterVersion,
      content: "正文不应随默认复制进入副本。",
    },
  });
  expect(savedChapter.status()).toBe(201);

  await page.getByRole("button", { name: "复制作品" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "默认不会复制正文、章节版本、章节派生事实、人物认知状态与黄金三章候选",
  );
  await expect(dialog.getByLabel("正文（默认不复制）")).not.toBeChecked();
  await expect(dialog.getByLabel("章节历史版本（需先选择正文）")).toBeDisabled();
  const duplicateApi = `/api/v1/works/${work.id}/duplicate`;
  const duplicateResponsePromise = waitForApiResponse(page, "POST", duplicateApi);
  await dialog.getByRole("button", { name: "创建副本" }).click();
  const duplicateResponse = await duplicateResponsePromise;
  expect(duplicateResponse.status()).toBe(200);
  const copied = workResponseSchema.parse(await duplicateResponse.json()).data;
  expect(copied.id).not.toBe(work.id);
  const persistedCopy = await persistedWork(page, copied.id);
  expect(persistedCopy.title).toBe("仙途：忘川书（副本）");
  expect(persistedCopy.tags).toEqual([]);
  const sourceChaptersResponse = await page.request.get(`${branchPath}/chapters`);
  expect(sourceChaptersResponse.status()).toBe(200);
  expect(
    chapterWorkspaceListResponseSchema.parse(await sourceChaptersResponse.json()).data,
  ).toHaveLength(1);
  const copiedChaptersResponse = await page.request.get(
    `/api/v1/works/${copied.id}/branches/${copied.mainBranch.id}/chapters`,
  );
  expect(copiedChaptersResponse.status()).toBe(200);
  expect(
    chapterWorkspaceListResponseSchema.parse(await copiedChaptersResponse.json()).data,
  ).toEqual([]);

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "仙途：忘川书（副本）" })).toBeVisible();
});

test("moves a work to trash and restores it from the dashboard", async ({ page, context }) => {
  const work = await authenticatedWorkPage(page, context);

  const trashed = await trashWorkFromSettings(page, work.id);
  expect(trashed.id).toBe(work.id);
  expect(new Date(trashed.purgeAfter).getTime() - new Date(trashed.deletedAt).getTime()).toBe(
    30 * 24 * 60 * 60 * 1_000,
  );

  await expect(page).toHaveURL(/\/workspace\?trash=true$/);
  await expect(page.getByRole("heading", { name: "仙途：忘川书" })).toBeVisible();
  const trashListResponse = await page.request.get(`/api/v1/works?limit=20&trash=true`);
  expect(trashListResponse.status()).toBe(200);
  expect(
    workListResponseSchema
      .parse(await trashListResponse.json())
      .data.some((item) => item.id === work.id && item.deletedAt !== null),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "永久删除" })).toBeDisabled();
  const restoreApi = `/api/v1/works/${work.id}/trash/restore`;
  const restoreResponsePromise = waitForApiResponse(page, "POST", restoreApi);
  await page.getByRole("button", { name: "恢复" }).click();
  expect((await restoreResponsePromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "仙途：忘川书" })).toHaveCount(0);
});

test("permanently deletes a trashed work after export through production APIs", async ({
  page,
  context,
}) => {
  const work = await authenticatedWorkPage(page, context);
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const chapter = await createM0Chapter(page.request, work);
  const chapterDetails = await page.request.get(`${branchPath}/chapters/${chapter.id}`);
  expect(chapterDetails.status()).toBe(200);
  const chapterVersion = (await chapterDetails.json()).data.version as number;
  const chapterToken = await getCsrf(page.request);
  const savedChapter = await page.request.post(`${branchPath}/chapters/${chapter.id}/versions`, {
    headers: { Origin: origin, "X-CSRF-Token": chapterToken },
    data: {
      version: chapterVersion,
      content: "终章已经完成导出，作者确认可以永久删除。",
    },
  });
  expect(savedChapter.status()).toBe(201);

  const worker = await startWorker();
  try {
    const exportToken = await getCsrf(page.request);
    const exportResponse = await page.request.post(`${branchPath}/exports`, {
      headers: {
        Origin: origin,
        "X-CSRF-Token": exportToken,
        "Idempotency-Key": "work-settings-delete-export",
      },
      data: { format: "txt", scope: { kind: "book" } },
    });
    expect(exportResponse.status()).toBe(202);
    const exportId = (await exportResponse.json()).data.id as string;
    await expect
      .poll(
        async () => {
          const receipt = await page.request.get(`${branchPath}/exports/${exportId}`);
          return receipt.ok() ? (await receipt.json()).data.status : receipt.status();
        },
        { timeout: 30_000 },
      )
      .toBe("completed");
  } finally {
    await worker.stop();
  }

  await trashWorkFromSettings(page, work.id);

  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `UPDATE works
          SET deleted_at = now() - interval '2 minutes',
              purge_after = now() - interval '1 minute'
        WHERE id = $1`,
      [work.id],
    );
  } finally {
    await pool.end();
  }

  await page.goto("/workspace?trash=true");
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();
  const purgeButton = page.getByRole("button", { name: "永久删除" });
  await expect(purgeButton).toBeEnabled();
  const purgeApi = `/api/v1/works/${work.id}/purge`;
  const purgeResponsePromise = waitForApiResponse(page, "POST", purgeApi);
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await purgeButton.click();
  const purgeResponse = await purgeResponsePromise;
  expect(purgeResponse.status()).toBe(200);
  expect(workPurgeResponseSchema.parse(await purgeResponse.json()).data).toEqual({
    id: work.id,
    deleted: true,
  });
  await expect(page.getByRole("heading", { name: work.title })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/works/${work.id}`)).status()).toBe(403);

  const cleanupPool = new Pool({ connectionString: databaseUrl });
  try {
    const purgedRows = await cleanupPool.query<{
      branches: string;
      chapters: string;
      exports: string;
      versions: string;
      works: string;
    }>(
      `SELECT
         (SELECT count(*) FROM works WHERE id = $1)::text AS works,
         (SELECT count(*) FROM work_branches WHERE work_id = $1)::text AS branches,
         (SELECT count(*) FROM chapters WHERE work_id = $1)::text AS chapters,
         (SELECT count(*) FROM chapter_versions WHERE work_id = $1)::text AS versions,
         (SELECT count(*) FROM work_export_receipts WHERE work_id = $1)::text AS exports`,
      [work.id],
    );
    expect(purgedRows.rows[0]).toEqual({
      branches: "0",
      chapters: "0",
      exports: "0",
      versions: "0",
      works: "0",
    });
  } finally {
    await cleanupPool.end();
  }
});

test("shows loading, permission and error states and holds four viewports", async ({
  page,
  context,
}, testInfo) => {
  const work = await authenticatedWorkPage(page, context);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/works/${work.id}`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载作品设置")).toBeVisible();
  release?.();
  await page.unroute(`**/api/v1/works/${work.id}`);

  await page.route(`**/api/v1/works/${work.id}`, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN_TENANT_ACCESS",
          message: "作品不存在或无权访问",
          details: {},
          requestId: "req_work_settings_permission",
        },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "无权修改这本作品" })).toBeVisible();
  await page.unroute(`**/api/v1/works/${work.id}`);

  await page.route(`**/api/v1/works/${work.id}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品设置加载失败。",
          details: {},
          requestId: "req_work_settings_error",
        },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByText("作品设置加载失败。")).toBeVisible();
  await page.unroute(`**/api/v1/works/${work.id}`);

  const details = await page.request.get(`/api/v1/works/${work.id}`);
  const current = (await details.json()).data as { version: number };
  const token = await getCsrf(page.request);
  const completed = await page.request.patch(`/api/v1/works/${work.id}`, {
    headers: { Origin: "http://localhost:3000", "X-CSRF-Token": token },
    data: { version: current.version, status: "completed" },
  });
  expect(completed.status()).toBe(200);
  const completedVersion = (await completed.json()).data.version as number;
  await page.goto(`/workspace/${work.id}/work-settings`);
  await expect(page.getByText("作品已完本，默认只读。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();

  const reopenToken = await getCsrf(page.request);
  const reopened = await page.request.patch(`/api/v1/works/${work.id}`, {
    headers: { Origin: "http://localhost:3000", "X-CSRF-Token": reopenToken },
    data: { version: completedVersion, status: "serializing" },
  });
  expect(reopened.status()).toBe(200);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/work-settings`);
    await expect(page.getByRole("heading", { name: "把这本书的边界定清楚" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach(`work-settings-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide" }),
      contentType: "image/png",
    });
    await expect
      .soft(page)
      .toHaveScreenshot(
        ["work-settings", `work-settings-${width}.png`],
        productionScreenshotOptions,
      );
  }
});
