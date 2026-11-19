import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { createM0Chapter } from "../helpers/m0";
import { expectAuthorFacingLanguage, expectNoPrototypeOnlyLeakage } from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const origin = "http://localhost:3000";

test.describe.configure({ timeout: 180_000 });

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("dashboard");
  const session = await registerUser(page.request, email, "StrongPassword123", "作品库作者");
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
  await page.goto("/workspace");
}

async function holdWorksApi(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/works?*", async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

function waitForWorksPage(page: Page, predicate: (url: URL) => boolean) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" && url.pathname === "/api/v1/works" && predicate(url)
    );
  });
}

function waitForApiResponse(page: Page, method: string, api: string) {
  const expected = new URL(api, origin);
  return page.waitForResponse((response) => {
    const actual = new URL(response.url());
    if (response.request().method() !== method || actual.pathname !== expected.pathname) {
      return false;
    }
    for (const [key, value] of expected.searchParams) {
      if (value ? actual.searchParams.get(key) !== value : !actual.searchParams.has(key)) {
        return false;
      }
    }
    return true;
  });
}

async function trashWorkFromDashboard(page: Page, workId: string, title: string) {
  const workCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title }) });
  const trashApi = `/api/v1/works/${workId}/trash`;
  const trashResponse = waitForApiResponse(page, "POST", trashApi);
  const trashPage = waitForWorksPage(page, (url) => url.searchParams.get("trash") === "true");
  let dialogMessage = "";
  const confirmation = new Promise<void>((resolve, reject) => {
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      dialog.accept().then(resolve, reject);
    });
  });
  await workCard.getByRole("button", { name: "管理", exact: true }).click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "移入回收站", exact: true })
    .click();
  await confirmation;
  expect(dialogMessage).toContain(`移入回收站《${title}》`);
  return { trashed: await trashResponse, trashPage };
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("shows the empty work library with a real create action", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);
  await expect(page.getByText("还没有作品", { exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "还没有作品" })
    .getByRole("link", { name: "新建作品" })
    .click();
  await expect(page).toHaveURL(/\/workspace\/new-project$/);
});

test("creates a work from the dashboard and persists it", async ({ page, context }) => {
  await authenticatedPage(page, context);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.getByRole("link", { name: "新建作品" }).first().click();
  await expect(page).toHaveURL(/\/workspace\/new-project$/);
  await page.getByRole("button", { name: "空白作品", exact: true }).click();
  await page.getByLabel("书名").fill("雾港来信");

  const creationResponse = waitForApiResponse(page, "POST", "/api/v1/works");
  await page.getByRole("button", { name: "创建作品并进入总览" }).click();
  const created = await creationResponse;
  expect(created.status()).toBe(200);
  const createdWork = (await created.json()).data as { id: string };
  await expect(page).toHaveURL(new RegExp(`/workspace/${createdWork.id}/overview$`));

  const persistedResponse = await page.request.get(`/api/v1/works/${createdWork.id}`);
  expect(persistedResponse.status()).toBe(200);
  const persistedWork = (await persistedResponse.json()).data as { title: string };
  expect(persistedWork.title).toBe("雾港来信");

  const workspacePage = waitForWorksPage(page, (url) => url.searchParams.get("limit") === "20");
  await page.goto("/workspace");
  await workspacePage;
  await expect(page.getByRole("heading", { name: "雾港来信" })).toBeVisible();
});

test("searches and filters persisted works from the dashboard", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const searchWork = await createWork(page.request, {
    mode: "blank",
    title: "长夜行",
    genre: "xianxia",
    scaleTarget: "long",
  });
  const urbanWork = await createWork(page.request, {
    mode: "blank",
    title: "都市回声",
    genre: "urban",
    scaleTarget: "medium",
  });
  const pausedWork = await createWork(page.request, {
    mode: "blank",
    title: "暂停之后",
    genre: "urban",
    scaleTarget: "short",
  });
  const pausedDetails = await page.request.get(`/api/v1/works/${pausedWork.id}`);
  expect(pausedDetails.status()).toBe(200);
  const pausedVersion = (await pausedDetails.json()).data.version as number;
  const token = await getCsrf(page.request);
  const paused = await page.request.patch(`/api/v1/works/${pausedWork.id}`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: pausedVersion, status: "paused" },
  });
  expect(paused.status()).toBe(200);

  const initialPage = waitForWorksPage(page, (url) => url.searchParams.get("limit") === "20");
  await page.reload();
  await initialPage;
  await expect(page.getByRole("heading", { name: "长夜行" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "都市回声" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂停之后" })).toBeVisible();

  const searchApi = "/api/v1/works?limit=20&q=";
  const searchResponse = waitForApiResponse(page, "GET", searchApi);
  await page.getByLabel("搜索作品").fill("长夜");
  const searched = await searchResponse;
  expect(searched.status()).toBe(200);
  const searchedTitles = (await searched.json()).data.map((work: { title: string }) => work.title);
  expect(searchedTitles).toEqual(["长夜行"]);
  await expect(page.getByRole("heading", { name: searchWork.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: urbanWork.title })).toHaveCount(0);

  const clearedSearch = waitForWorksPage(
    page,
    (url) => url.searchParams.get("limit") === "20" && !url.searchParams.has("q"),
  );
  await page.getByLabel("搜索作品").fill("");
  await clearedSearch;

  const genreApi = "/api/v1/works?limit=20&genre=urban";
  const genreResponse = waitForApiResponse(page, "GET", genreApi);
  await page.getByLabel("题材筛选").selectOption("urban");
  const genreFiltered = await genreResponse;
  expect(genreFiltered.status()).toBe(200);
  expect((await genreFiltered.json()).data.map((work: { genre: string }) => work.genre)).toEqual([
    "urban",
    "urban",
  ]);
  await expect(page.getByRole("heading", { name: urbanWork.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: searchWork.title })).toHaveCount(0);

  const clearedGenre = waitForWorksPage(
    page,
    (url) => url.searchParams.get("limit") === "20" && !url.searchParams.has("genre"),
  );
  await page.getByLabel("题材筛选").selectOption("");
  await clearedGenre;

  const statusApi = "/api/v1/works?limit=20&status=paused";
  const statusResponse = waitForApiResponse(page, "GET", statusApi);
  await page.getByLabel("状态筛选").selectOption("paused");
  const statusFiltered = await statusResponse;
  expect(statusFiltered.status()).toBe(200);
  const filteredStatuses = (await statusFiltered.json()).data.map(
    (work: { status: string }) => work.status,
  );
  expect(filteredStatuses).toEqual(["paused"]);
  await expect(page.getByRole("heading", { name: pausedWork.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: searchWork.title })).toHaveCount(0);
});

test("shows loading, disabled and long-content states", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const longTitle = "一部标题很长很长但仍然需要在作品卡片里保持清晰可读并且不能撑破布局的长篇作品";
  await createWork(page.request, {
    mode: "blank",
    title: longTitle,
  });

  const releaseWorks = await holdWorksApi(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载作品")).toBeVisible();
  releaseWorks();

  await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();
  const manageButton = page.getByRole("button", { name: "管理", exact: true });
  await manageButton.click();
  const manageDialog = page.getByRole("dialog", { name: longTitle });
  await expect(manageDialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await expect(manageDialog.getByRole("link", { name: "作品设置" })).toHaveAttribute(
    "href",
    /\/workspace\/[0-9a-f-]+\/work-settings$/,
  );
  await page.keyboard.press("Shift+Tab");
  await expect(manageDialog.getByRole("button", { name: "移入回收站", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(manageDialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(manageDialog).toHaveCount(0);
  await expect(manageButton).toBeFocused();
});

test("loads additional pages for a long work list", async ({ page, context }) => {
  await authenticatedPage(page, context);
  for (let index = 1; index <= 22; index += 1) {
    await createWork(page.request, {
      mode: "blank",
      title: `批量作品 ${String(index).padStart(2, "0")}`,
    });
  }
  await page.reload();

  await expect(page.getByRole("heading", { name: /批量作品/ })).toHaveCount(20);
  let releaseMore!: () => void;
  const additionalPageGate = new Promise<void>((resolve) => {
    releaseMore = resolve;
  });
  await page.route("**/api/v1/works?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      await additionalPageGate;
    }
    await route.continue();
  });
  const loadMoreApi = "/api/v1/works?limit=20&cursor=";
  const additionalPage = waitForApiResponse(page, "GET", loadMoreApi);
  const loadMore = page.getByRole("button", { name: "加载更多作品" });
  await loadMore.click();
  await expect(loadMore).toBeDisabled();
  releaseMore();
  const loadedMore = await additionalPage;
  expect(loadedMore.status()).toBe(200);
  expect((await loadedMore.json()).data).toHaveLength(2);
  await expect(page.getByRole("heading", { name: /批量作品/ })).toHaveCount(22);
  await page.unroute("**/api/v1/works?*");
  await page.reload();
  await expect(page.getByRole("heading", { name: /批量作品/ })).toHaveCount(20);
});

test("archives and restores a work from dashboard views", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "归档往返",
    genre: "history",
    scaleTarget: "long",
  });
  const details = await page.request.get(`/api/v1/works/${work.id}`);
  expect(details.status()).toBe(200);
  const version = (await details.json()).data.version as number;
  const token = await getCsrf(page.request);
  const serializing = await page.request.patch(`/api/v1/works/${work.id}`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version, status: "serializing" },
  });
  expect(serializing.status()).toBe(200);

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();
  const workCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: work.title }) });
  const archiveApi = `/api/v1/works/${work.id}/archive`;
  const archiveResponse = waitForApiResponse(page, "POST", archiveApi);
  const activeAfterArchive = waitForWorksPage(
    page,
    (url) => url.searchParams.get("limit") === "20" && !url.searchParams.has("status"),
  );
  await workCard.getByRole("button", { name: "管理", exact: true }).click();
  await page
    .getByRole("dialog", { name: work.title })
    .getByRole("button", { name: "归档", exact: true })
    .click();
  const archived = await archiveResponse;
  await activeAfterArchive;
  expect(archived.status()).toBe(200);
  expect((await archived.json()).data.status).toBe("archived");

  await page.goto("/workspace");
  const archivedPage = waitForWorksPage(
    page,
    (url) => url.searchParams.get("status") === "archived",
  );
  await page.getByRole("button", { name: "已归档" }).click();
  await archivedPage;
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();

  const persistedArchived = await page.request.get("/api/v1/works?status=archived");
  expect(persistedArchived.status()).toBe(200);
  expect((await persistedArchived.json()).data.map((item: { id: string }) => item.id)).toEqual([
    work.id,
  ]);

  const restoreApi = `/api/v1/works/${work.id}/restore`;
  const restoreResponse = waitForApiResponse(page, "POST", restoreApi);
  const restoredArchivedPage = waitForWorksPage(
    page,
    (url) => url.searchParams.get("status") === "archived",
  );
  await page.getByRole("button", { name: "恢复" }).click();
  const restored = await restoreResponse;
  await restoredArchivedPage;
  expect(restored.status()).toBe(200);
  expect((await restored.json()).data.status).toBe("serializing");

  const activePage = waitForWorksPage(
    page,
    (url) => url.searchParams.get("limit") === "20" && !url.searchParams.has("status"),
  );
  await page.getByRole("button", { name: "作品", exact: true }).click();
  await activePage;
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();

  const persistedRestore = await page.request.get(`/api/v1/works/${work.id}`);
  expect(persistedRestore.status()).toBe(200);
  expect((await persistedRestore.json()).data.status).toBe("serializing");

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();
  const { trashed, trashPage } = await trashWorkFromDashboard(page, work.id, work.title);
  expect(trashed.status()).toBe(200);
  expect((await trashed.json()).data).toMatchObject({
    id: work.id,
    deletedAt: expect.any(String),
    purgeAfter: expect.any(String),
  });

  await expect(page).toHaveURL(/\/workspace\?trash=true$/);
  await trashPage;
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();

  const trashRestoreApi = `/api/v1/works/${work.id}/trash/restore`;
  const trashRestoreResponse = waitForApiResponse(page, "POST", trashRestoreApi);
  await page.getByRole("button", { name: "恢复" }).click();
  const restoredTrash = await trashRestoreResponse;
  expect(restoredTrash.status()).toBe(200);
  expect((await restoredTrash.json()).data.deletedAt).toBeNull();

  const persistedTrashRestore = await page.request.get(`/api/v1/works/${work.id}`);
  expect(persistedTrashRestore.status()).toBe(200);
  expect((await persistedTrashRestore.json()).data.deletedAt).toBeNull();
});

test("deletes a work from trash after its export receipt is complete", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const deletedWork = await createWork(page.request, {
    mode: "blank",
    title: "终章备份",
    genre: "urban",
    scaleTarget: "short",
  });
  const branchPath = `/api/v1/works/${deletedWork.id}/branches/${deletedWork.mainBranch.id}`;
  const chapter = await createM0Chapter(page.request, deletedWork);
  const chapterDetails = await page.request.get(`${branchPath}/chapters/${chapter.id}`);
  expect(chapterDetails.status()).toBe(200);
  const chapterVersion = (await chapterDetails.json()).data.version as number;
  const chapterToken = await getCsrf(page.request);
  const savedChapter = await page.request.post(`${branchPath}/chapters/${chapter.id}/versions`, {
    headers: { Origin: origin, "X-CSRF-Token": chapterToken },
    data: {
      version: chapterVersion,
      content: "最后一章已经备份，作者确认可以永久删除。",
    },
  });
  expect(savedChapter.status()).toBe(201);

  let exportId = "";
  const worker = await startWorker();
  try {
    const exportToken = await getCsrf(page.request);
    const exportResponse = await page.request.post(`${branchPath}/exports`, {
      headers: {
        Origin: origin,
        "X-CSRF-Token": exportToken,
        "Idempotency-Key": "dashboard-delete-export",
      },
      data: { format: "txt", scope: { kind: "book" } },
    });
    expect(exportResponse.status()).toBe(202);
    exportId = (await exportResponse.json()).data.id as string;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${branchPath}/exports/${exportId}`);
          return response.ok() ? (await response.json()).data.status : response.status();
        },
        { timeout: 30_000 },
      )
      .toBe("completed");
  } finally {
    await worker.stop();
  }

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: deletedWork.title })).toBeVisible();
  const { trashed, trashPage } = await trashWorkFromDashboard(
    page,
    deletedWork.id,
    deletedWork.title,
  );

  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await trashPage;
    expect(trashed.status()).toBe(200);
    const trashPayload = (await trashed.json()).data as {
      deletedAt: string;
      id: string;
      purgeAfter: string;
    };
    expect(trashPayload).toMatchObject({
      id: deletedWork.id,
      deletedAt: expect.any(String),
      purgeAfter: expect.any(String),
    });
    expect(trashPayload.id).toBe(deletedWork.id);
    expect(
      new Date(trashPayload.purgeAfter).getTime() - new Date(trashPayload.deletedAt).getTime(),
    ).toBe(30 * 24 * 60 * 60 * 1_000);

    await pool.query(
      `UPDATE works
          SET deleted_at = now() - interval '2 minutes',
              purge_after = now() - interval '1 minute'
        WHERE id = $1`,
      [deletedWork.id],
    );

    await page.goto("/workspace?trash=true");
    await expect(page.getByRole("heading", { name: deletedWork.title })).toBeVisible();
    await expect(page.getByRole("button", { name: "永久删除" })).toBeEnabled();

    const purgeApi = `/api/v1/works/${deletedWork.id}/purge`;
    const purgeResponse = waitForApiResponse(page, "POST", purgeApi);
    let dialogMessage = "";
    const dialogHandled = new Promise<void>((resolve, reject) => {
      page.once("dialog", (dialog) => {
        dialogMessage = dialog.message();
        dialog.accept().then(resolve, reject);
      });
    });
    await page.getByRole("button", { name: "永久删除" }).click();
    await dialogHandled;
    expect(dialogMessage).toContain(`永久删除《${deletedWork.title}》`);
    const purged = await purgeResponse;
    expect(purged.status()).toBe(200);
    expect((await purged.json()).data).toEqual({ id: deletedWork.id, deleted: true });
    await expect(page.getByRole("heading", { name: deletedWork.title })).toHaveCount(0);
    expect((await page.request.get(`/api/v1/works/${deletedWork.id}`)).status()).toBe(403);
    const purgedRows = await pool.query<{
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
      [deletedWork.id],
    );
    expect(purgedRows.rows[0]).toEqual({
      branches: "0",
      chapters: "0",
      exports: "0",
      versions: "0",
      works: "0",
    });
    expect(purgedRows.rows[0]?.works).toBe("0");
  } finally {
    await pool.end();
  }
});

test("dashboard states and four viewports hold", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "视口检查作品",
  });
  await page.route("**/api/v1/works?*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "作品库加载失败。",
          details: {},
          requestId: "req_dashboard_error",
        },
      }),
    });
  });
  await page.reload();
  await expect(page.getByText("作品库加载失败。")).toBeVisible();
  await page.unroute("**/api/v1/works?*");

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const listPage = waitForWorksPage(
      page,
      (url) => url.searchParams.get("limit") === "20" && !url.searchParams.has("status"),
    );
    await page.goto("/workspace");
    await listPage;
    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
    await expect(page.getByRole("heading", { name: work.title })).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`dashboard-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide" }),
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "管理", exact: true }).click();
    const manageDialog = page.getByRole("dialog", { name: work.title });
    await expect(manageDialog.getByRole("button", { name: "归档", exact: true })).toBeVisible();
    await expect(
      manageDialog.getByRole("button", { name: "移入回收站", exact: true }),
    ).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);
    const manageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(manageOverflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`dashboard-manage-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide" }),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
  }
});
