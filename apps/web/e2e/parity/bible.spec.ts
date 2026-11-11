import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  freezeApiTimestamps,
  productionScreenshotOptions,
} from "../helpers/ui";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440];

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("bible");
  const session = await registerUser(page.request, email, "StrongPassword123", "故事圣经作者");
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

async function createBibleWork(
  page: Page,
  title = "忘川书",
  genre: "xianxia" | "history" | "urban" = "xianxia",
) {
  const work = (await createWork(page.request, {
    mode: "idea",
    title,
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre,
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  })) as {
    id: string;
    title: string;
    mainBranch: { id: string };
  };
  return work;
}

function biblePath(work: { id: string; mainBranch: { id: string } }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
}

async function getStoryBible(
  request: APIRequestContext,
  work: { id: string; mainBranch: { id: string } },
) {
  const response = await request.get(biblePath(work));
  expect(response.ok()).toBe(true);
  return (await response.json()).data as {
    id: string;
    version: number;
    status: string;
    cards: Array<{ key: string; content: string }>;
  };
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("generates, edits, checks readiness, locks and rejects locked edits", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createBibleWork(page);

  await page.goto(`/workspace/${work.id}/bible`);
  await expect(page.getByRole("heading", { name: work.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "故事圣经还没开始" })).toBeVisible();
  await expect(page.locator(".story-bible-nav-item")).toHaveCount(9);
  await expectAuthorFacingLanguage(page);

  await page.locator(".story-bible-empty").getByRole("button", { name: "生成九卡提案" }).click();
  await expect(page.getByRole("heading", { name: "AI 已生成九卡提案" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "九卡已完整" })).toBeVisible();
  await expect(page.getByRole("button", { name: "锁定故事圣经" })).toBeEnabled();
  await expect(page.getByText("境界差距", { exact: true })).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "AI 已生成九卡提案" })).toBeVisible();
    await expect(page.locator(".story-bible-nav-item")).toHaveCount(9);
    await expect(page.getByText("境界差距", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  await page.route(`**${biblePath(work)}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          message: "故事圣经已被其他操作更新，请刷新后重试。",
          details: {},
          requestId: "req_bible_conflict",
        },
      }),
    });
  });
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "编辑一句话故事" }).click();
    await page.getByRole("textbox", { name: "编辑一句话故事" }).fill("冲突内容不应保存。");
    await page.getByRole("textbox", { name: "修改原因" }).fill("测试版本冲突。");
    await page.getByRole("button", { name: "保存卡片" }).click();
    await expect(page.getByText("故事圣经已被其他操作更新，请刷新后重试。")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
  }
  await page.unroute(`**${biblePath(work)}`);

  await page.getByRole("button", { name: "编辑一句话故事" }).click();
  const editor = page.getByRole("textbox", { name: "编辑一句话故事" });
  await editor.fill("一个失去名字的杂役，用吞噬记忆的古书寻找自己的过去。");
  await page.getByRole("textbox", { name: "修改原因" }).fill("按开篇记忆设定收紧一句话故事。");
  await page.getByRole("button", { name: "保存卡片" }).click();
  await expect(
    page
      .locator("#bible-oneSentence")
      .getByText("一个失去名字的杂役，用吞噬记忆的古书寻找自己的过去。"),
  ).toBeVisible();
  await expect(page.getByText("“一句话故事”已保存。")).toBeVisible();

  await page.getByRole("button", { name: "锁定故事圣经" }).click();
  await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();
  await expect(page.getByRole("button", { name: "故事圣经已锁定" })).toBeDisabled();
  const lockedEditButtons = page.getByRole("button", { name: /已锁定 · .+需修改请求/ });
  await expect(lockedEditButtons).toHaveCount(9);
  await expect
    .poll(() =>
      lockedEditButtons.evaluateAll((buttons) =>
        buttons.every((button) => (button as HTMLButtonElement).disabled),
      ),
    )
    .toBe(true);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  await page.getByRole("button", { name: "发起修改请求" }).click();
  await page.getByRole("textbox", { name: "修改请求标题" }).fill("调整一句话故事");
  await page.getByRole("textbox", { name: "修改请求原因" }).fill("第 2 章需要更明确的开篇承诺。");
  await page
    .getByRole("textbox", { name: "修改后的内容" })
    .fill("一个失去名字的杂役，用记忆换仙途。");
  await page.getByRole("button", { name: "提交修改请求" }).click();
  await expect(page.getByText("修改请求已创建，等待影响分析。")).toBeVisible();

  const bible = await getStoryBible(page.request, work);
  const csrfToken = await getCsrf(page.request);
  const directEdit = await page.request.patch(biblePath(work), {
    headers: { Origin: origin, "X-CSRF-Token": csrfToken },
    data: {
      version: bible.version,
      reason: "锁定后不应被覆盖。",
      cards: [{ key: "oneSentence", content: "锁定后不应被覆盖。" }],
    },
  });
  expect(directEdit.status()).toBe(409);
  expect((await directEdit.json()).error.code).toBe("BIBLE_LOCKED");

  const directDelete = await page.request.delete(`${biblePath(work)}/cards/oneSentence`, {
    headers: { Origin: origin, "X-CSRF-Token": csrfToken },
  });
  expect(directDelete.status()).toBe(409);
  expect((await directDelete.json()).error.code).toBe("BIBLE_LOCKED");

  await page.reload();
  await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();
  await page.getByRole("button", { name: "解锁并记录原因" }).click();
  await page.getByRole("textbox", { name: "解锁原因" }).fill("开篇前需要调整一句话故事。");
  await page.getByRole("button", { name: "确认解锁" }).click();
  await expect(page.getByText("故事圣经已解锁，本次操作已记录。")).toBeVisible();
});

test("renders loading, error, partial and long states across four viewports", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createBibleWork(page, "长夜仙途");
  const initial = await getStoryBible(page.request, work);
  const csrfToken = await getCsrf(page.request);
  const partial = await page.request.patch(biblePath(work), {
    headers: { Origin: origin, "X-CSRF-Token": csrfToken },
    data: {
      version: initial.version,
      reason: "补齐一句话故事。",
      cards: [{ key: "oneSentence", content: "一个守碑人发现每次修碑都会失去一段记忆。" }],
    },
  });
  expect(partial.ok()).toBe(true);

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${biblePath(work)}`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/bible`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载故事圣经")).toBeVisible();
  release?.();
  await expect(page.getByRole("heading", { name: "还差 8 张" })).toBeVisible();
  await expect(page.getByRole("button", { name: "锁定故事圣经" })).toBeDisabled();
  await page.unroute(`**${biblePath(work)}`);

  await page.route(`**${biblePath(work)}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "故事圣经加载失败。",
          details: {},
          requestId: "req_bible_error",
        },
      }),
    });
  });
  await page.goto(`/workspace/${work.id}/bible`);
  await expect(page.getByText("故事圣经加载失败。")).toBeVisible();
  await page.unroute(`**${biblePath(work)}`);

  const current = await getStoryBible(page.request, work);
  const longContent = `长内容：${"守碑人必须在每次选择前核对旧约，不能凭空知道。".repeat(180)}`;
  const longUpdate = await page.request.patch(biblePath(work), {
    headers: { Origin: origin, "X-CSRF-Token": csrfToken },
    data: {
      version: current.version,
      reason: "补充长内容验收数据。",
      cards: [{ key: "oneSentence", content: longContent }],
    },
  });
  expect(longUpdate.ok()).toBe(true);
  await freezeApiTimestamps(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/bible`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/bible$`, "u"));
    await expect(page.getByRole("heading", { name: work.title })).toBeVisible();
    await expect(page.locator(".story-bible-nav-item")).toHaveCount(9);
    await expect(page.locator("#bible-oneSentence .story-bible-card-copy")).toContainText(
      "长内容：",
    );
    await expectNoPrototypeOnlyLeakage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page).toHaveScreenshot(
      ["bible", `bible-${width}.png`],
      productionScreenshotOptions,
    );
  }
});

test("generates a history story bible without cultivation realms", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createBibleWork(page, "旧朝档案", "history");

  await page.goto(`/workspace/${work.id}/bible`);
  await page.locator(".story-bible-empty").getByRole("button", { name: "生成九卡提案" }).click();
  await expect(page.getByRole("heading", { name: "AI 已生成九卡提案" })).toBeVisible();
  await expect(page.getByText("粮道约束", { exact: true })).toBeVisible();
  await expect(page.getByText("境界差距", { exact: true })).toHaveCount(0);
  await expect(page.locator(".story-bible-nav-item")).toHaveCount(9);
});
