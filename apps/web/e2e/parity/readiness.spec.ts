import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440];

async function authenticatedPage(page: Page, context: BrowserContext, prefix: string) {
  const email = uniqueEmail(prefix);
  const session = await registerUser(page.request, email, "StrongPassword123", "准备度作者");
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
  return email;
}

async function createReadinessWork(page: Page, title = "忘川书") {
  return (await createWork(page.request, {
    mode: "idea",
    title,
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

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("shows precise remediation links from overview at four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context, "readiness-overview");
  const work = await createReadinessWork(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/overview`);
    await expect(page.getByRole("heading", { name: "缺项与提醒" })).toBeVisible();
    await expect(page.locator('[data-readiness-key="story_bible"]')).toContainText("故事圣经");
    await expect(
      page.locator('[data-readiness-key="story_bible"]').getByRole("link", {
        name: "去完善故事圣经",
      }),
    ).toHaveAttribute("href", `/workspace/${work.id}/bible#story-bible-readiness`);
    await expect(
      page.locator('[data-readiness-key="settings"]').getByRole("link", {
        name: "去处理世界规则",
      }),
    ).toHaveAttribute("href", `/workspace/${work.id}/settings?column=world`);
    await expectNoOverflow(page);
    await testInfo.attach(`readiness-overview-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${work.id}/overview`);
  await page
    .locator('[data-readiness-key="settings"]')
    .getByRole("link", { name: "去处理世界规则" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/settings\\?column=world$`, "u"));
  await expect(page.getByRole("heading", { name: "世界规则", exact: true })).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.goto(`/workspace/${work.id}/overview`);
  await page
    .locator('[data-readiness-key="story_bible"]')
    .getByRole("link", { name: "去完善故事圣经" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/workspace/${work.id}/bible#story-bible-readiness$`, "u"),
  );
  await expect(page.locator("#story-bible-readiness")).toBeVisible();
});

test("renders locked, partial and ready readiness on the writing page", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context, "readiness-writing");
  const fixture = await createReadyFixture(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${fixture.work.id}/write?chapterId=${fixture.chapterId}`);
    await page.getByRole("tab", { name: "本章参考" }).click();
    await expect(page.locator("#writing-readiness")).toContainText("所有准备项已就绪");
    await expectNoOverflow(page);
    await testInfo.attach(`readiness-writing-ready-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  const outlineResponse = await page.request.get(`${branchPath(fixture.work)}/outline`);
  const outline = (await outlineResponse.json()).data as {
    sceneCards: Array<{ nodeId: string; version: number }>;
  };
  const sceneVersion = outline.sceneCards.find((card) => card.nodeId === fixture.sceneId)!.version;
  const updated = await page.request.put(
    `${branchPath(fixture.work)}/outline/nodes/${fixture.sceneId}/scene-card`,
    {
      headers: { Origin: origin, "X-CSRF-Token": await getCsrf(page.request) },
      data: {
        version: sceneVersion,
        title: "藏起断臂",
        pov: {
          type: "character",
          id: fixture.characterId,
          branchId: fixture.work.mainBranch.id,
          label: "沈砚",
          version: null,
        },
        location: {
          type: "map",
          id: fixture.mapId,
          branchId: fixture.work.mainBranch.id,
          label: "荒寺外山道",
          version: null,
        },
        storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
        beats: [{ description: "沈砚藏起断臂。" }, { description: "顾青撞见。" }],
        informationReleases: [],
        tension: 72,
      },
    },
  );
  expect(updated.status()).toBe(200);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${fixture.work.id}/write?chapterId=${fixture.chapterId}`);
  await page.getByRole("tab", { name: "本章参考" }).click();
  await expect(
    page.locator(`[data-readiness-key="outline:scene_information:${fixture.sceneId}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`[data-readiness-key="outline:scene_information:${fixture.sceneId}"]`),
  ).toContainText("提醒");
  await expect(page.getByRole("button", { name: "生成整章" })).toBeEnabled();

  await page.goto(`/workspace/${fixture.work.id}/overview`);
  await expect(page.locator('[data-readiness-key="story_bible"]')).toHaveCount(0);
  await expect(page.locator('[data-readiness-key="settings"]')).toHaveCount(0);
  await expectAuthorFacingLanguage(page);
});

test("targets the conflicting setting and denies cross-tenant access", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context, "readiness-conflict");
  const fixture = await createReadyFixture(page);
  const token = await getCsrf(page.request);
  const draftCharacter = await page.request.post(`${branchPath(fixture.work)}/entities`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      type: "character",
      name: "顾青",
      aliases: [],
      summary: "追查忘川书的同门。",
      description: "",
      tags: [],
      data: {
        bodyState: "轻伤",
        knowledgeBoundary: "怀疑沈砚隐瞒来历",
        relationshipSummary: "与沈砚互相试探",
      },
    },
  });
  expect(draftCharacter.status()).toBe(201);
  const draft = (await draftCharacter.json()).data as { id: string; version: number };
  await page.request.post(`${branchPath(fixture.work)}/entities/${draft.id}/proposals`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      version: draft.version,
      reason: "章节事实与人物认知冲突",
      conflictType: "contradictory_fact",
      evidence: [
        {
          kind: "author_note",
          sourceId: null,
          label: "冲突说明",
          quote: "顾青在同一章既知道又不知道忘川书。",
          locator: "",
          confidence: null,
        },
      ],
    },
  });

  await page.goto(`/workspace/${fixture.work.id}/overview`);
  const settingLink = page
    .locator('[data-readiness-key="settings"]')
    .getByRole("link", { name: "去处理人物" });
  await expect(settingLink).toBeVisible();
  await expect(settingLink).toHaveAttribute(
    "href",
    `/workspace/${fixture.work.id}/settings?column=characters&entityId=${draft.id}`,
  );
  await settingLink.click();
  await expect(page).toHaveURL(
    new RegExp(
      `/workspace/${fixture.work.id}/settings\\?column=characters&entityId=${draft.id}$`,
      "u",
    ),
  );
  await expect(page.getByRole("heading", { name: "顾青" })).toBeVisible();
  await expect(page.getByText("人物档案").first()).toBeVisible();

  const otherEmail = uniqueEmail("readiness-permission");
  const otherSession = await registerUser(
    page.request,
    otherEmail,
    "StrongPassword123",
    "旁观作者",
  );
  await context.clearCookies();
  await context.addCookies([
    {
      name: "nb_session",
      value: otherSession,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`/workspace/${fixture.work.id}/overview`);
  await expect(page.getByText("作品不存在或无权访问")).toBeVisible();
});

async function createReadyFixture(page: Page) {
  const work = await createReadinessWork(page);
  const path = branchPath(work);
  let token = await getCsrf(page.request);
  const config = await page.request.post("/api/v1/model-configs", {
    headers: { Origin: origin, "X-CSRF-Token": token, "Idempotency-Key": crypto.randomUUID() },
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
  expect(config.status()).toBe(200);
  await page.request.post(`/api/v1/model-configs/${(await config.json()).data.id}/test`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
  });

  const generated = await page.request.post(`${path}/story-bible/generate`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {},
  });
  expect(generated.status()).toBe(200);
  await page.request.post(`${path}/story-bible/lock`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: (await generated.json()).data.version },
  });

  token = await getCsrf(page.request);
  const entities = [
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
      aliases: ["小砚"],
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
    {
      type: "map",
      name: "荒寺外山道",
      aliases: [],
      summary: "荒寺外的山道。",
      description: "",
      tags: [],
      data: { details: "荒寺外山道" },
    },
  ] as const;
  let characterId = "";
  let mapId = "";
  for (const entity of entities) {
    const created = await page.request.post(`${path}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: entity,
    });
    expect(created.status()).toBe(201);
    const data = (await created.json()).data as { id: string; version: number };
    await page.request.post(`${path}/entities/${data.id}/lock`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: data.version },
    });
    if (entity.type === "character") {
      characterId = data.id;
    }
    if (entity.type === "map") {
      mapId = data.id;
    }
  }

  const outlinePath = `${path}/outline`;
  const book = await createOutlineNode(page, token, outlinePath, {
    level: "book",
    parentId: null,
    title: "忘川书",
  });
  const volume = await createOutlineNode(page, token, outlinePath, {
    level: "volume",
    parentId: book.id,
    title: "第一卷 · 少年出山",
  });
  const act = await createOutlineNode(page, token, outlinePath, {
    level: "act",
    parentId: volume.id,
    title: "第一幕 · 断臂",
  });
  const chapter = await createOutlineNode(page, token, outlinePath, {
    level: "chapter",
    parentId: act.id,
    chapterCreate: {
      number: 1,
      title: "一只手也能结印",
      brief: {
        goal: "让沈砚在断臂后找到新的战斗方式。",
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: ["沈砚藏起断臂。", "顾青撞见。", "忘川书显形。"],
        requiredFacts: ["左臂骨折，不能双手结印。"],
      },
    },
  });
  const scene = await createOutlineNode(page, token, outlinePath, {
    level: "scene",
    parentId: chapter.id,
    title: "藏起断臂",
  });
  await page.request.put(`${outlinePath}/nodes/${volume.id}/volume-contract`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      objective: "沈砚第一次真正面对血河宗。",
      conflict: "血河宗追捕与左臂重伤。",
      turningPoints: ["断臂", "忘川书显形"],
      exitConditions: ["离开南境"],
      plotLines: [{ name: "天门将开", status: "active", note: "主线" }],
    },
  });
  const sceneCard = await page.request.put(`${outlinePath}/nodes/${scene.id}/scene-card`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      title: "藏起断臂",
      pov: {
        type: "character",
        id: characterId,
        branchId: work.mainBranch.id,
        label: "沈砚",
        version: null,
      },
      location: {
        type: "map",
        id: mapId,
        branchId: work.mainBranch.id,
        label: "荒寺外山道",
        version: null,
      },
      storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
      beats: [{ description: "沈砚藏起断臂。" }, { description: "顾青撞见。" }],
      informationReleases: [
        { description: "顾青看见书页一角", constraint: "顾青不能知道完整来历" },
      ],
      tension: 72,
    },
  });
  expect(sceneCard.status()).toBe(200);
  return {
    work,
    chapterId: chapter.chapter!.id,
    sceneId: scene.id,
    characterId,
    mapId,
  };
}

async function createOutlineNode(
  page: Page,
  token: string,
  outlinePath: string,
  body: Record<string, unknown>,
) {
  const response = await page.request.post(`${outlinePath}/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: body,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.node as {
    id: string;
    chapter?: { id: string };
  };
}
