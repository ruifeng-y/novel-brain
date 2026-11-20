import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  storyLedgerEntryCreateRequestSchema,
  storyLedgerMutationResponseSchema,
  storyLedgerWorkspaceResponseSchema,
} from "@novel-brain/contracts";
import { Pool } from "pg";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  freezeApiTimestamps,
  productionScreenshotOptions,
  waitForApiResponse,
} from "../helpers/ui";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440];

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("foreshadows");
  const session = await registerUser(page.request, email, "StrongPassword123", "伏笔作者");
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

async function createLedgerWork(page: Page) {
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

function branchPath(work: { id: string; mainBranch: { id: string } }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

async function createChapter(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  number: number,
  title: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(`${branchPath(work)}/chapters`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      number,
      title,
      brief: {
        goal: "埋下一条必须回收的线索。",
        pov: "沈砚",
        location: "旧宅",
        sceneBeats: ["沈砚发现旧信。", "血印浮现。"],
        requiredFacts: ["沈砚不知道父母死于仇杀"],
      },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; number: number };
}

async function createForeshadow(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  body: Record<string, unknown>,
) {
  const token = await getCsrf(page.request);
  const payload = storyLedgerEntryCreateRequestSchema.parse({
    kind: "foreshadow",
    responsibleRole: "protagonist",
    importance: "must",
    readerPromise: "身世谜团",
    ...body,
  });
  const response = await page.request.post(`${branchPath(work)}/ledger/entries`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: payload,
  });
  if (response.status() !== 201) {
    throw new Error(`${response.status()}: ${await response.text()}`);
  }
  return storyLedgerMutationResponseSchema.parse(await response.json()).data.entry;
}

async function getLedger(page: Page, work: { id: string; mainBranch: { id: string } }) {
  const response = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger`,
  );
  expect(response.status()).toBe(200);
  return storyLedgerWorkspaceResponseSchema.parse(await response.json()).data;
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("persists all nine foreshadows page actions through the production API", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  await authenticatedPage(page, context);
  const work = await createLedgerWork(page);
  const chapter = await createChapter(page, work, 1, "旧宅夜雨");
  const ledgerApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger`;
  const entryApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries`;

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/foreshadows`);
    await expect(page.getByRole("heading", { name: "埋下的，都要有回收计划" })).toBeVisible();
    await expect(page.getByText("还没有伏笔记录")).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`foreshadows-empty-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  const failedEntry = await createForeshadow(page, work, {
    title: "旧案失败回收",
    summary: "这条线索最终被证明无法按原计划回收。",
    targetWindow: { fromChapter: 1, toChapter: 3 },
    status: "planted",
    sourceChapterId: chapter.id,
    reason: "第 1 章埋下旧案线索。",
  });
  const abandonedEntry = await createForeshadow(page, work, {
    title: "被放弃的支线",
    summary: "作者决定不再追查这条支线。",
    targetWindow: { fromChapter: 1, toChapter: 3 },
    status: "planned",
  });
  const deferredEntry = await createForeshadow(page, work, {
    title: "延期到后续卷",
    summary: "这条承诺需要等人物成长后再兑现。",
    targetWindow: { fromChapter: 8, toChapter: 10 },
    status: "planned",
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${work.id}/foreshadows`);
  await page.getByRole("button", { name: "新增伏笔" }).click();
  await expect(page.getByRole("button", { name: "保存记录" })).toBeDisabled();
  await page.getByLabel("名称", { exact: true }).fill("父母之死");
  await page
    .getByLabel("摘要", { exact: true })
    .fill("沈砚以为父母是自杀，旧信里却藏着另一套说法。");
  await page.getByLabel("初始证据", { exact: true }).fill("沈砚把父母的旧信压在箱底。");
  await expect(page.getByRole("button", { name: "保存记录" })).toBeEnabled();

  const created = waitForApiResponse(page, "POST", entryApi);
  await page.getByRole("button", { name: "保存记录" }).click();
  expect((await created).status()).toBe(201);
  const persistedCreate = (await getLedger(page, work)).entries.find(
    (entry) => entry.title === "父母之死",
  );
  expect(persistedCreate?.title).toBe("父母之死");
  const createdId = persistedCreate!.id;

  const row = page.locator("article.foreshadow-row", { hasText: "父母之死" });
  await expect(row).toBeVisible();
  const editApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${createdId}`;
  await row.getByRole("button", { name: "编辑父母之死" }).click();
  const editForm = page.locator("form.foreshadow-inline-form").first();
  await expect(editForm).toContainText("编辑记录");
  await editForm.locator("textarea").fill("旧信里的两种死因必须由后续真相揭开。");
  const edited = waitForApiResponse(page, "PATCH", editApi);
  await editForm.getByRole("button", { name: "保存修改" }).click();
  expect((await edited).status()).toBe(200);
  const persistedEdit = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === createdId,
  );
  expect(persistedEdit?.summary).toBe("旧信里的两种死因必须由后续真相揭开。");

  const plantApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${createdId}/transitions`;
  await row.getByText("查看推进与证据").click();
  await expect(row.getByText("沈砚把父母的旧信压在箱底。")).toBeVisible();
  await row.getByRole("button", { name: "埋设", exact: true }).click();
  await expect(page.getByLabel("来源章节")).toHaveValue(chapter.id);
  await page.getByLabel("原因", { exact: true }).fill("第 1 章旧宅里埋下。");

  const plantResponse = waitForApiResponse(page, "POST", plantApi);
  await page.getByRole("button", { name: "确认埋设" }).click();
  expect((await plantResponse).status()).toBe(200);
  await expect(row.getByText("已埋设", { exact: true })).toBeVisible();
  await expect(row.getByText(/第 1 章 · 旧宅夜雨/).first()).toBeVisible();
  const persistedPlant = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === createdId,
  );
  expect(persistedPlant?.status).toBe("planted");

  const advanceApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${createdId}/transitions`;
  await row.getByRole("button", { name: "推进", exact: true }).click();
  await page.getByLabel("原因", { exact: true }).fill("旧信里的血印让线索继续推进。");
  const advanced = waitForApiResponse(page, "POST", advanceApi);
  await page.getByRole("button", { name: "确认推进" }).click();
  expect((await advanced).status()).toBe(200);
  await expect(row.getByText("推进中", { exact: true })).toBeVisible();
  const persistedAdvance = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === createdId,
  );
  expect(persistedAdvance?.status).toBe("progressed");

  const recoverApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${createdId}/transitions`;
  await row.getByRole("button", { name: "回收", exact: true }).click();
  await page.getByLabel("原因", { exact: true }).fill("旧信夹层里的追杀令揭晓真相。");
  await page.getByLabel("回收证据", { exact: true }).fill("信纸夹层里是血河宗的追杀令。");
  const recoverResponse = waitForApiResponse(page, "POST", recoverApi);
  await page.getByRole("button", { name: "确认回收" }).click();
  expect((await recoverResponse).status()).toBe(200);
  await expect(row.getByText("已回收", { exact: true })).toBeVisible();
  await expect(page.getByText("保留回收记录与证据")).toBeVisible();
  const persistedRecover = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === createdId,
  );
  expect(persistedRecover?.status).toBe("paid_off");

  const failedRow = page.locator("article.foreshadow-row", { hasText: "旧案失败回收" });
  const failedApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${failedEntry.id}/transitions`;
  await failedRow.getByRole("button", { name: "失败回收", exact: true }).click();
  await page.getByLabel("原因", { exact: true }).fill("后续证据证明原回收计划不可成立。");
  await page.getByLabel("回收证据", { exact: true }).fill("卷宗明确写出旧案已经结案多年。");
  const failedRecovery = waitForApiResponse(page, "POST", failedApi);
  await page.getByRole("button", { name: "确认失败回收" }).click();
  expect((await failedRecovery).status()).toBe(200);
  const persistedFailedRecovery = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === failedEntry.id,
  );
  expect(persistedFailedRecovery?.status).toBe("failed_payoff");

  const abandonedRow = page.locator("article.foreshadow-row", { hasText: "被放弃的支线" });
  const abandonApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${abandonedEntry.id}/transitions`;
  await abandonedRow.getByRole("button", { name: "放弃", exact: true }).click();
  await page.getByLabel("原因", { exact: true }).fill("主线调整后不再保留这条支线。");
  const abandoned = waitForApiResponse(page, "POST", abandonApi);
  await page.getByRole("button", { name: "确认放弃" }).click();
  expect((await abandoned).status()).toBe(200);
  const persistedAbandon = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === abandonedEntry.id,
  );
  expect(persistedAbandon?.status).toBe("abandoned");

  const deferredRow = page.locator("article.foreshadow-row", { hasText: "延期到后续卷" });
  const deferApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger/entries/${deferredEntry.id}/transitions`;
  await deferredRow.getByRole("button", { name: "延期", exact: true }).click();
  await page.getByLabel("新的目标起始章").fill("11");
  await page.getByLabel("新的目标结束章").fill("14");
  await page.getByLabel("原因", { exact: true }).fill("等主角进入下一卷后再回收。");
  const deferred = waitForApiResponse(page, "POST", deferApi);
  await page.getByRole("button", { name: "确认延期" }).click();
  expect((await deferred).status()).toBe(200);
  const persistedPostpone = (await getLedger(page, work)).entries.find(
    (entry) => entry.id === deferredEntry.id,
  );
  expect(persistedPostpone?.status).toBe("deferred");

  const overdueEntries = [
    await createForeshadow(page, work, {
      title: "旧线索",
      summary: "第 1 条重复线索。",
      targetWindow: { fromChapter: 1, toChapter: 3 },
      status: "planned",
    }),
    await createForeshadow(page, work, {
      title: "旧 线索",
      summary: "第 2 条重复线索。",
      targetWindow: { fromChapter: 1, toChapter: 3 },
      status: "planned",
      importance: "optional",
    }),
  ];
  const laterChapter = await createChapter(page, work, 6, "写作进度");
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_e2e";
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`UPDATE chapters SET status = 'writing', word_count = 3600 WHERE id = $1`, [
      laterChapter.id,
    ]);
  } finally {
    await pool.end();
  }

  await page.reload();
  const recheck = waitForApiResponse(page, "GET", ledgerApi);
  await page.getByRole("button", { name: "重新检查" }).click();
  const recheckResponse = await recheck;
  expect(recheckResponse.status()).toBe(200);
  const recheckedWorkspace = storyLedgerWorkspaceResponseSchema.parse(
    await recheckResponse.json(),
  ).data;
  await expect(page.locator('[data-ledger-finding="LEDGER_OVERDUE"]')).toHaveCount(2);
  await expect(page.locator('[data-ledger-finding="LEDGER_DUPLICATE"]')).toHaveCount(2);
  await expect(page.getByText("当前进度：写到第 6 章")).toBeVisible();
  const persistedCheck = await getLedger(page, work);
  const recheckedOverdue = recheckedWorkspace.findings.find(
    (finding) => finding.code === "LEDGER_OVERDUE",
  );
  const persistedOverdue = persistedCheck.findings.find(
    (finding) => finding.code === "LEDGER_OVERDUE",
  );
  expect(recheckedOverdue?.entryId).toBe(overdueEntries[0]!.id);
  expect(persistedOverdue?.entryId).toBe(overdueEntries[0]!.id);
  await expectAuthorFacingLanguage(page);
});

test("renders a long ledger at four viewports and opens the outline ledger", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);
  const work = await createLedgerWork(page);
  await createChapter(page, work, 1, "埋线");
  for (let index = 1; index <= 14; index += 1) {
    await createForeshadow(page, work, {
      title: `第 ${index} 条长线伏笔：${"旧信与铜牌背面反复出现的名字".repeat(2)}`,
      summary: "这条线索需要在后续章节里逐步揭示，并保留足够的证据与回收计划。".repeat(2),
      targetWindow: { fromChapter: index + 1, toChapter: index + 20 },
      status: "planned",
      importance: index % 2 === 0 ? "must" : "optional",
    });
  }
  await freezeApiTimestamps(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/foreshadows`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/foreshadows$`, "u"));
    await expect(page.getByRole("heading", { name: "埋下的，都要有回收计划" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增伏笔" })).toBeEnabled();
    await expect(page.locator("article.foreshadow-row")).toHaveCount(14);
    await expect(page.locator("article.foreshadow-row").first()).toContainText("第 1 条长线伏笔");
    await expectAuthorFacingLanguage(page);
    await expectNoPrototypeOnlyLeakage(page);
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .soft(page)
      .toHaveScreenshot(["foreshadows", `foreshadows-${width}.png`], productionScreenshotOptions);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${work.id}/outline`);
  await page.getByRole("tab", { name: "剧情账本" }).click();
  await expect(page.locator("[data-outline-ledger]")).toBeVisible();
  await expect(page.locator('[data-ledger-kind="foreshadow"]')).toContainText("第 1 条长线伏笔");
  await expect(page.getByRole("link", { name: "管理伏笔账本" })).toBeVisible();
  await expectNoOverflow(page);
  await expectAuthorFacingLanguage(page);
});

test("renders a recoverable error state at four viewports", async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  const work = await createLedgerWork(page);
  let releaseLedger: () => void = () => undefined;
  const ledgerGate = new Promise<void>((resolve) => {
    releaseLedger = resolve;
  });
  await page.route(`**${branchPath(work)}/ledger`, async (route) => {
    await ledgerGate;
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/foreshadows`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载伏笔账本")).toBeVisible();
  releaseLedger();
  await expect(page.getByRole("heading", { name: "埋下的，都要有回收计划" })).toBeVisible();
  await page.unroute(`**${branchPath(work)}/ledger`);

  await page.route(`**${branchPath(work)}/ledger`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "伏笔账本加载失败。",
          details: {},
          requestId: "req_ledger_error",
        },
      }),
    });
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/foreshadows`);
    await expect(page.getByText("伏笔账本加载失败。")).toBeVisible();
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`foreshadows-error-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});
