import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  storyBibleChangeRequestResponseSchema,
  storyBibleReadinessResponseSchema,
  storyBibleResponseSchema,
  storyBibleVersionListResponseSchema,
  storyBibleWorldRuleListResponseSchema,
} from "@novel-brain/contracts";

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
  return storyBibleResponseSchema.parse(await response.json()).data;
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

test("persists all nine bible page actions through the production API", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createBibleWork(page, "逐动作故事圣经");
  const storyBibleApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
  const generateApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/generate`;
  const readinessApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/readiness`;
  const versionsApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/versions?limit=100`;
  const worldRulesApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/world-rules?limit=100`;
  const lockApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/lock`;
  const changeRequestsApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/change-requests`;
  const unlockApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/unlock`;

  await page.goto(`/workspace/${work.id}/bible`);
  await expect(page.getByRole("heading", { name: "故事圣经还没开始" })).toBeVisible();
  const initialBible = await getStoryBible(page.request, work);
  expect(initialBible.readiness.completed).toBe(0);

  await page.getByRole("button", { name: "编辑一句话故事" }).click();
  await page
    .getByRole("textbox", { name: "编辑一句话故事" })
    .fill("一个失去名字的杂役，用记忆换取仙途。");
  await page.getByRole("textbox", { name: "修改原因" }).fill("先补全开篇的一句话故事。");
  const completeCardResponse = waitForApiResponse(page, "PATCH", storyBibleApi);
  await page.getByRole("button", { name: "保存卡片" }).click();
  const completedBible = storyBibleResponseSchema.parse(
    await (await completeCardResponse).json(),
  ).data;
  expect(completedBible.readiness.completed).toBe(1);
  await expect(page.getByText("“一句话故事”已保存。")).toBeVisible();
  const persistedCompletedBible = await getStoryBible(page.request, work);
  expect(persistedCompletedBible.readiness.missingCards).toHaveLength(8);

  const readinessResponse = await page.request.get(readinessApi);
  expect(readinessResponse.status()).toBe(200);
  const checkedReadiness = storyBibleReadinessResponseSchema.parse(
    await readinessResponse.json(),
  ).data;
  expect(checkedReadiness.missingCards).toHaveLength(8);
  expect(checkedReadiness.canLock).toBe(false);

  const generateResponse = waitForApiResponse(page, "POST", generateApi);
  await page.getByRole("button", { name: "生成九卡提案" }).click();
  const generatedBible = storyBibleResponseSchema.parse(await (await generateResponse).json()).data;
  expect(generatedBible.status).toBe("proposed");
  expect(generatedBible.cards).toHaveLength(9);
  await expect(page.getByRole("heading", { name: "AI 已生成九卡提案" })).toBeVisible();
  const persistedGeneratedBible = await getStoryBible(page.request, work);
  expect(persistedGeneratedBible.proposal?.source).toBe("work_premise");

  await page.getByRole("button", { name: "编辑一句话故事" }).click();
  await page
    .getByRole("textbox", { name: "编辑一句话故事" })
    .fill("一个忘记姓名的杂役，用吞噬记忆的古书追回自己的过去。");
  await page.getByRole("textbox", { name: "修改原因" }).fill("让开篇承诺更贴近记忆主题。");
  const editCardResponse = waitForApiResponse(page, "PATCH", storyBibleApi);
  await page.getByRole("button", { name: "保存卡片" }).click();
  const editedBible = storyBibleResponseSchema.parse(await (await editCardResponse).json()).data;
  expect(editedBible.version).toBeGreaterThan(generatedBible.version);
  await expect(
    page
      .locator("#bible-oneSentence")
      .getByText("一个忘记姓名的杂役，用吞噬记忆的古书追回自己的过去。"),
  ).toBeVisible();
  const persistedEditedBible = await getStoryBible(page.request, work);
  const persistedEditedCard = persistedEditedBible.cards.find((card) => card.key === "oneSentence");
  expect(persistedEditedCard?.content).toBe("一个忘记姓名的杂役，用吞噬记忆的古书追回自己的过去。");

  const generatedWorldLaws = generatedBible.cards.find((card) => card.key === "worldLaws");
  if (!generatedWorldLaws) {
    throw new Error("生成提案缺少世界铁律卡片");
  }
  const newRuleNumber = generatedWorldLaws.worldRules.length + 1;
  await page.getByRole("button", { name: "编辑世界铁律" }).click();
  await page.getByRole("button", { name: "添加世界铁律" }).click();
  await page.getByLabel(`规则 ${newRuleNumber} 名称`).fill("记忆代价");
  await page
    .getByLabel(`规则 ${newRuleNumber} 约束`)
    .fill("每次借用前人经验都必须永久失去一段重要记忆。");
  await page.getByLabel(`规则 ${newRuleNumber} 范围`).fill("金手指使用与人物成长");
  await page.getByLabel(`规则 ${newRuleNumber} 例外`).fill("开篇前已失去的记忆不计入本次代价");
  await page.getByRole("textbox", { name: "修改原因" }).fill("补充金手指的不可逆代价。");
  const worldRuleResponse = waitForApiResponse(page, "PATCH", storyBibleApi);
  await page.getByRole("button", { name: "保存卡片" }).click();
  const worldRuleBible = storyBibleResponseSchema.parse(
    await (await worldRuleResponse).json(),
  ).data;
  expect(worldRuleBible.cards.find((card) => card.key === "worldLaws")?.worldRules).toHaveLength(
    newRuleNumber,
  );
  await expect(page.locator("#bible-worldLaws")).toContainText("记忆代价");

  const worldRulesResponse = await page.request.get(worldRulesApi);
  expect(worldRulesResponse.status()).toBe(200);
  const persistedWorldRules = storyBibleWorldRuleListResponseSchema.parse(
    await worldRulesResponse.json(),
  ).data;
  expect(persistedWorldRules.some((rule) => rule.name === "记忆代价")).toBe(true);

  const readyResponse = await page.request.get(readinessApi);
  expect(readyResponse.status()).toBe(200);
  const readyReadiness = storyBibleReadinessResponseSchema.parse(await readyResponse.json()).data;
  expect(readyReadiness.completed).toBe(9);
  expect(readyReadiness.canLock).toBe(true);

  const lockResponse = waitForApiResponse(page, "POST", lockApi);
  await page.getByRole("button", { name: "锁定故事圣经" }).click();
  const lockedBible = storyBibleResponseSchema.parse(await (await lockResponse).json()).data;
  expect(lockedBible.status).toBe("locked");
  await expect(page.getByText("故事圣经已锁定，修改需要发起修改请求。")).toBeVisible();
  const persistedLockedBible = await getStoryBible(page.request, work);
  expect(persistedLockedBible.status).toBe("locked");
  const lockedOneSentence = persistedLockedBible.cards.find(
    (card) => card.key === "oneSentence",
  )?.content;

  const lockedVersionsResponse = await page.request.get(versionsApi);
  expect(lockedVersionsResponse.status()).toBe(200);
  const lockedVersions = storyBibleVersionListResponseSchema.parse(
    await lockedVersionsResponse.json(),
  ).data;
  const lockedVersionActions = lockedVersions.map((version) => version.action);
  expect(lockedVersionActions).toContain("locked");
  await expect(page.locator(".story-bible-history")).toContainText("锁定");

  await page.getByRole("button", { name: "发起修改请求" }).click();
  await page.getByRole("textbox", { name: "修改请求标题" }).fill("调整记忆代价");
  await page
    .getByRole("textbox", { name: "修改请求原因" })
    .fill("第 2 章需要明确每次使用古书都会失去一段记忆。");
  await page
    .getByRole("textbox", { name: "修改后的内容" })
    .fill("一个失去名字的杂役，用无法挽回的记忆换取仙途。");
  const changeRequestResponse = waitForApiResponse(page, "POST", changeRequestsApi);
  await page.getByRole("button", { name: "提交修改请求" }).click();
  const changeRequest = storyBibleChangeRequestResponseSchema.parse(
    await (await changeRequestResponse).json(),
  ).data;
  expect(changeRequest.status).toBe("pending");
  expect(changeRequest.after.content).toBe("一个失去名字的杂役，用无法挽回的记忆换取仙途。");
  await expect(page.getByText("修改请求已创建，等待影响分析。")).toBeVisible();
  const submittedChangeResponse = await changeRequestResponse;
  const idempotencyKey = submittedChangeResponse.request().headers()["idempotency-key"];
  if (!idempotencyKey) {
    throw new Error("修改请求缺少幂等键");
  }
  const csrfToken = (await context.cookies(origin)).find(
    (cookie) => cookie.name === "nb_csrf",
  )?.value;
  if (!csrfToken) {
    throw new Error("修改请求缺少 CSRF Cookie");
  }
  const replayedChangeResponse = await page.request.post(changeRequestsApi, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": idempotencyKey,
    },
    data: {
      version: lockedBible.version,
      cardKey: changeRequest.cardKey,
      title: changeRequest.title,
      reason: changeRequest.reason,
      after: changeRequest.after,
    },
  });
  expect(replayedChangeResponse.status()).toBe(201);
  const replayedChangeRequest = storyBibleChangeRequestResponseSchema.parse(
    await replayedChangeResponse.json(),
  ).data;
  expect(replayedChangeRequest.id).toBe(changeRequest.id);
  expect(replayedChangeRequest.before.content).toBe(lockedOneSentence);
  expect(replayedChangeRequest.after.content).toBe(changeRequest.after.content);

  await page.getByRole("button", { name: "解锁并记录原因" }).click();
  await page.getByRole("textbox", { name: "解锁原因" }).fill("开篇定稿前需要调整一句话故事。");
  const unlockResponse = waitForApiResponse(page, "POST", unlockApi);
  await page.getByRole("button", { name: "确认解锁" }).click();
  const unlockedBible = storyBibleResponseSchema.parse(await (await unlockResponse).json()).data;
  expect(unlockedBible.status).toBe("draft");
  await expect(page.getByText("故事圣经已解锁，本次操作已记录。")).toBeVisible();
  const persistedUnlockedBible = await getStoryBible(page.request, work);
  expect(persistedUnlockedBible.status).toBe("draft");

  const finalVersionsResponse = await page.request.get(versionsApi);
  expect(finalVersionsResponse.status()).toBe(200);
  const finalVersions = storyBibleVersionListResponseSchema.parse(
    await finalVersionsResponse.json(),
  ).data;
  const finalVersionActions = finalVersions.map((version) => version.action);
  expect(finalVersionActions).toContain("unlocked");
  await expect(page.locator(".story-bible-history")).toContainText("解锁");
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
    await expect
      .soft(page)
      .toHaveScreenshot(["bible", `bible-${width}.png`], productionScreenshotOptions);
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
