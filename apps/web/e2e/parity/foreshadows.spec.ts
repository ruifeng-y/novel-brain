import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

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
  const response = await page.request.post(`${branchPath(work)}/ledger/entries`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      kind: "foreshadow",
      responsibleRole: "protagonist",
      importance: "must",
      readerPromise: "身世谜团",
      ...body,
    },
  });
  if (response.status() !== 201) {
    throw new Error(`${response.status()}: ${await response.text()}`);
  }
  return (await response.json()).data.entry as { id: string; title: string };
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

test("creates, plants and pays off a foreshadow through the production page", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);
  const work = await createLedgerWork(page);
  const chapter = await createChapter(page, work, 1, "旧宅夜雨");

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

  const created = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${branchPath(work)}/ledger/entries` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存记录" }).click();
  expect((await created).status()).toBe(201);

  const row = page.locator("article.foreshadow-row", { hasText: "父母之死" });
  await expect(row).toBeVisible();
  await row.getByText("查看推进与证据").click();
  await expect(row.getByText("沈砚把父母的旧信压在箱底。")).toBeVisible();
  await row.getByRole("button", { name: "埋设", exact: true }).click();
  await expect(page.getByLabel("来源章节")).toHaveValue(chapter.id);
  await page.getByLabel("原因", { exact: true }).fill("第 1 章旧宅里埋下。");

  const setup = page.waitForResponse(
    (response) =>
      response.url().includes("/ledger/entries/") &&
      response.url().endsWith("/transitions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认埋设" }).click();
  expect((await setup).status()).toBe(200);
  await expect(row.getByText("已埋设", { exact: true })).toBeVisible();
  await expect(row.getByText(/第 1 章 · 旧宅夜雨/).first()).toBeVisible();

  await row.getByRole("button", { name: "回收", exact: true }).click();
  await page.getByLabel("原因", { exact: true }).fill("旧信夹层里的追杀令揭晓真相。");
  await page.getByLabel("回收证据", { exact: true }).fill("信纸夹层里是血河宗的追杀令。");
  const payoff = page.waitForResponse(
    (response) =>
      response.url().includes("/ledger/entries/") &&
      response.url().endsWith("/transitions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认回收" }).click();
  expect((await payoff).status()).toBe(200);
  await expect(row.getByText("已回收", { exact: true })).toBeVisible();
  await expect(page.getByText("保留回收记录与证据")).toBeVisible();

  await createForeshadow(page, work, {
    title: "旧线索",
    summary: "第 1 条重复线索。",
    targetWindow: { fromChapter: 1, toChapter: 3 },
    status: "planned",
  });
  await createForeshadow(page, work, {
    title: "旧 线索",
    summary: "第 2 条重复线索。",
    targetWindow: { fromChapter: 1, toChapter: 3 },
    status: "planned",
    importance: "optional",
  });
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
  await expect(page.locator('[data-ledger-finding="LEDGER_OVERDUE"]')).toHaveCount(2);
  await expect(page.locator('[data-ledger-finding="LEDGER_DUPLICATE"]')).toHaveCount(2);
  await expect(page.getByText("当前进度：写到第 6 章")).toBeVisible();
  await expectAuthorFacingLanguage(page);
});

test("renders a long ledger at four viewports and opens the outline ledger", async ({
  page,
  context,
}, testInfo) => {
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

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/foreshadows`);
    await expect(page.locator("article.foreshadow-row")).toHaveCount(14);
    await expectNoOverflow(page);
    await testInfo.attach(`foreshadows-long-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
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
