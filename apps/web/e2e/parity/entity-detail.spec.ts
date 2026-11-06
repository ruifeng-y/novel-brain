import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440];

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("entity-detail");
  const session = await registerUser(page.request, email, "StrongPassword123", "人物档案作者");
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

async function createCharacter(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  name: string,
  profile: Record<string, string> = {},
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/characters`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name,
        aliases: name === "沈砚" ? ["小砚"] : [],
        summary: name === "沈砚" ? "被宗门抛弃的外门杂役。" : "奉命监视沈砚的内门弟子。",
        description: "",
        tags: [],
        profile: {
          desire: "找回被抹去的记忆",
          fear: "成为忘川书的下一个祭品",
          goal: "进入天门",
          voiceSample: "“我记得，只是还没想起来。”",
          voiceGuide: "句子短，少用感叹。",
          disguise: "藏起左臂伤势",
          ...profile,
        },
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as {
    character: { id: string };
    version: number;
    latestVersionNodeId: string;
  };
}

async function createMap(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  name: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        type: "map",
        name,
        aliases: [],
        summary: "人物位置回放使用的地图节点。",
        description: "",
        tags: [],
        data: { details: "山门位于太玄峰南侧。" },
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string };
}

async function createFaction(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  name: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/factions`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name,
        aliases: [],
        summary: `${name}控制北域山脉。`,
        description: "",
        tags: ["仙门"],
        profile: {
          overview: `${name}以剑阵和灵脉立宗。`,
          goals: name === "太玄门" ? "守住天门" : "夺取灵脉",
          resources: "剑阵、灵脉与内门弟子。",
          doctrine: "门人不得私入禁地。",
        },
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as {
    faction: { id: string };
    version: number;
  };
}

async function createLayer(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  mapId: string,
  name: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/maps/${mapId}/layers`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name,
        parentLayerId: null,
        sortOrder: 0,
        minScale: 0,
        maxScale: 100,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string };
}

async function createNode(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  mapId: string,
  input: {
    name: string;
    nodeType: string;
    layerId: string | null;
    parentNodeId?: string | null;
    x?: number | null;
    y?: number | null;
  },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/maps/${mapId}/nodes`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        layerId: input.layerId,
        parentNodeId: input.parentNodeId ?? null,
        name: input.name,
        nodeType: input.nodeType,
        summary: `${input.name}的地点说明。`,
        x: input.x ?? null,
        y: input.y ?? null,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string };
}

async function createEdge(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  mapId: string,
  fromNodeId: string,
  toNodeId: string,
  travelMinutes: number,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/maps/${mapId}/edges`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        layerId: null,
        fromNodeId,
        toNodeId,
        routeType: "road",
        bidirectional: true,
        travelMinutes,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function createMarker(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  mapId: string,
  nodeId: string,
  label: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/maps/${mapId}/markers`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        layerId: null,
        nodeId,
        label,
        markerType: "danger",
        x: 0.5,
        y: 0.4,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function createTimeline(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  map: { villageId: string; sectId: string },
  characterId: string,
) {
  const token = await getCsrf(page.request);
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  await page.request
    .post(`${base}/world/timeline/eras`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name: "大玄历",
        orderIndex: 1,
        startSortKey: 0,
        endSortKey: null,
        description: "大玄王朝纪年。",
      },
    })
    .then((response) => expect(response.status()).toBe(201));
  await page.request
    .post(`${base}/world/timeline/events`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name: "忘川村灭门",
        aliases: [],
        summary: "十六年前改变沈砚命运的事件。",
        description: "",
        tags: [],
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 100 },
        durationMinutes: 720,
        durationLabel: "一夜",
        event: "仇家屠村后伪装成自尽。",
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      },
    })
    .then((response) => expect(response.status()).toBe(201));
  await page.request
    .post(`${base}/world/timeline/itineraries`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        character: {
          type: "character",
          id: characterId,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        fromNode: {
          type: "map_node",
          id: map.villageId,
          branchId: work.mainBranch.id,
          label: "忘川村",
        },
        toNode: {
          type: "map_node",
          id: map.sectId,
          branchId: work.mainBranch.id,
          label: "太玄门",
        },
        departure: { era: "大玄历", label: "第一日辰时", sortKey: 1000 },
        arrival: { era: "大玄历", label: "第一日酉时", sortKey: 1180 },
        travelMinutes: 180,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
        evidence: [],
      },
    })
    .then((response) => expect(response.status()).toBe(201));
}

async function addRelationship(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  characterId: string,
  targetId: string,
  relationType: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/characters/${characterId}/relationships`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        target: {
          type: "character",
          id: targetId,
          branchId: work.mainBranch.id,
          label: "顾青",
        },
        relationType,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function addState(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  characterId: string,
  body: Record<string, unknown>,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/characters/${characterId}/state-transitions`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: body,
    },
  );
  expect(response.status()).toBe(201);
}

async function lockCharacter(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  character: { character: { id: string }; version: number },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/characters/${character.character.id}/lock`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: character.version },
    },
  );
  expect(response.status()).toBe(200);
}

async function createProposal(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  character: { character: { id: string }; version: number },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${character.character.id}/proposals`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        version: character.version,
        reason: "这条人物认知需要作者确认后才能进入已确认设定。",
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "沈砚把断臂藏进衣袍。",
            locator: "第 1 章 · 第 3 段",
            confidence: 0.9,
          },
        ],
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function openCharacter(page: Page, work: { id: string }, name = "沈砚") {
  await page.goto(`/workspace/${work.id}/settings`);
  await page.getByRole("button", { name: /^人物/ }).click();
  await page
    .locator(".settings-entity-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "查看设定详情" })
    .click();
  return page.locator(".settings-entity-detail");
}

async function openEntity(page: Page, work: { id: string }, column: RegExp, name: string) {
  await page.goto(`/workspace/${work.id}/settings`);
  await page.getByRole("button", { name: column }).click();
  await page
    .locator(".settings-entity-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "查看设定详情" })
    .click();
  return page.locator(".settings-entity-detail");
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
    contentType: "image/png",
  });
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("loads the dedicated character profile, relationships, state history and health", async ({
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
  const shen = await createCharacter(page, work, "沈砚");
  const gu = await createCharacter(page, work, "顾青");
  const gate = await createMap(page, work, "太玄门山门");
  await addRelationship(page, work, shen.character.id, gu.character.id, "enemy");
  await addState(page, work, shen.character.id, {
    stateKind: "body",
    stateKey: "overall",
    value: "左臂骨折，不能双手结印。",
    target: null,
    validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    sourceChapterId: null,
  });
  await addState(page, work, shen.character.id, {
    stateKind: "location",
    stateKey: "current_location",
    value: "太玄门山门",
    target: {
      type: "map",
      id: gate.id,
      branchId: work.mainBranch.id,
      label: "太玄门山门",
    },
    validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    sourceChapterId: null,
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openCharacter(page, work);
    await expect(detail.getByRole("heading", { name: "沈砚" })).toBeVisible();
    await expect(detail.getByText("基本档案")).toBeVisible();
    await expect(detail.getByText("找回被抹去的记忆")).toBeVisible();
    await expect(detail.getByText("成为忘川书的下一个祭品")).toBeVisible();
    await expect(detail.getByText("敌对 · 顾青")).toBeVisible();
    await expect(detail.getByText("身体 · overall")).toBeVisible();
    await expect(detail.getByText("左臂骨折，不能双手结印。")).toBeVisible();
    await expect(detail.getByText("位置 · current_location")).toBeVisible();
    await expect(detail.getByText("地点：太玄门山门")).toBeVisible();
    await expect(detail.getByText("角色认知与引用")).toBeVisible();
    await expect(detail.getByText("还没有角色认知记录。")).toBeVisible();
    await expect(detail.getByText("设定体检")).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-profile-${width}`);
  }
});

test("shows loading, empty and recoverable error states at all four viewports", async ({
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
  const shen = await createCharacter(page, work, "沈砚");
  const detailPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/characters/${shen.character.id}`;

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto(`/workspace/${work.id}/settings`);
  await page.locator(".settings-column-nav").getByRole("button", { name: /^世界/ }).click();
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByText("还没有世界规则")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-empty-${width}`);
  }

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.route(`**${detailPath}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const detailLoaded = page.waitForResponse(
    (response) =>
      response.url().includes(detailPath) &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await openCharacter(page, work);
  await expect(page.getByText("正在加载人物档案")).toBeVisible();
  await detailLoaded;
  await page.unroute(`**${detailPath}`);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(`**${detailPath}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "人物档案加载失败。",
            details: {},
            requestId: "req_entity_detail_error",
          },
        }),
      });
    });
    const detail = await openCharacter(page, work);
    await expect(detail.getByText("人物档案加载失败。")).toBeVisible();
    await expect(detail.getByRole("button", { name: "重试" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-error-${width}`);
    await page.unroute(`**${detailPath}`);
  }
});

test("keeps locked and proposal states explicit at all four viewports", async ({
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
  const lockedCharacter = await createCharacter(page, work, "沈砚");
  await lockCharacter(page, work, lockedCharacter);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openCharacter(page, work);
    await expect(detail.getByText("已锁定").first()).toBeVisible();
    await expect(detail.getByText("基本档案")).toBeVisible();
    await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
    await expect(detail.getByRole("button", { name: "发起修改请求" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-locked-${width}`);
  }

  const proposedCharacter = await createCharacter(page, work, "顾青");
  await createProposal(page, work, proposedCharacter);
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openCharacter(page, work, "顾青");
    await expect(detail.getByText("待确认").first()).toBeVisible();
    await expect(detail.getByText("待裁决", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "确认提案" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-proposal-${width}`);
  }
});

test("holds long relationships and state history at all four viewports", async ({
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
  const shen = await createCharacter(page, work, "沈砚", {
    goal: "进入天门并找回被忘川书抹去的全部记忆，同时查清父母死亡真相。".repeat(12),
  });
  const gu = await createCharacter(page, work, "顾青");
  for (let index = 0; index < 8; index += 1) {
    await addRelationship(
      page,
      work,
      shen.character.id,
      gu.character.id,
      index % 2 === 0 ? "ally" : "enemy",
    );
  }
  for (let index = 0; index < 8; index += 1) {
    await addState(page, work, shen.character.id, {
      stateKind: "ability",
      stateKey: `seal_${index}`,
      value: "这门封印术需要在失去一段重要记忆后才能继续提升。".repeat(4),
      target: null,
      validity: {
        fromChapter: index * 10 + 1,
        toChapter: index * 10 + 9,
        fromStoryTime: null,
        toStoryTime: null,
      },
      sourceChapterId: null,
    });
  }

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openCharacter(page, work);
    await expect(detail.getByText("同盟 · 顾青").first()).toBeVisible();
    await expect(detail.getByText("能力 · seal_7")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-long-${width}`);
  }
});

test("loads faction, map and timeline domain details at all four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const map = await createMap(page, work, "北域");
  const layer = await createLayer(page, work, map.id, "外域");
  const village = await createNode(page, work, map.id, {
    name: "忘川村",
    nodeType: "settlement",
    layerId: layer.id,
    x: 0.1,
    y: 0.8,
  });
  const sect = await createNode(page, work, map.id, {
    name: "太玄门",
    nodeType: "sect",
    layerId: layer.id,
    parentNodeId: village.id,
    x: 0.5,
    y: 0.4,
  });
  await createEdge(page, work, map.id, village.id, sect.id, 180);
  await createMarker(page, work, map.id, sect.id, "护山大阵");

  const taiXuan = await createFaction(page, work, "太玄门");
  const bloodRiver = await createFaction(page, work, "血河宗");
  const token = await getCsrf(page.request);
  const relationship = await page.request.post(
    `${base}/world/factions/${taiXuan.faction.id}/relationships`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        target: {
          type: "faction",
          id: bloodRiver.faction.id,
          branchId: work.mainBranch.id,
          label: "血河宗",
        },
        relationType: "enemy",
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      },
    },
  );
  expect(relationship.status()).toBe(201);
  const territory = await page.request.post(
    `${base}/world/factions/${taiXuan.faction.id}/territories`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        node: {
          type: "map_node",
          id: village.id,
          branchId: work.mainBranch.id,
          label: "忘川村",
        },
        controlLevel: "direct",
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "村口插着太玄门的青旗。",
            locator: "第 1 章 · 第 2 段",
            confidence: 0.94,
          },
        ],
      },
    },
  );
  expect(territory.status()).toBe(201);

  const character = await createCharacter(page, work, "沈砚");
  await createTimeline(
    page,
    work,
    {
      villageId: village.id,
      sectId: sect.id,
    },
    character.character.id,
  );

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });

    const factionDetail = await openEntity(page, work, /^势力/, "太玄门");
    await expect(factionDetail.getByText("组织目标")).toBeVisible();
    await expect(factionDetail.getByText("守住天门")).toBeVisible();
    await expect(factionDetail.getByText("敌对 · 血河宗")).toBeVisible();
    await expect(factionDetail.getByText("忘川村 · 直辖")).toBeVisible();
    await expect(factionDetail.getByText("设定体检")).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-faction-${width}`);

    const mapDetail = await openEntity(page, work, /^地图/, "北域");
    await expect(mapDetail.getByText("地图图层")).toBeVisible();
    await expect(mapDetail.getByText("外域")).toBeVisible();
    await expect(mapDetail.getByText("忘川村 · 聚落")).toBeVisible();
    await expect(mapDetail.getByText("路线与旅行时间")).toBeVisible();
    await expect(mapDetail.getByText(/忘川村.*太玄门/).first()).toBeVisible();
    await expect(mapDetail.getByText("地图标记")).toBeVisible();
    await expect(mapDetail.getByText("护山大阵 · 危险")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-map-${width}`);

    const timelineDetail = await openEntity(page, work, /^时间线/, "忘川村灭门");
    await expect(timelineDetail.getByText("事件序列")).toBeVisible();
    await expect(timelineDetail.getByText("大玄历 · 十六年前")).toBeVisible();
    await expect(timelineDetail.getByText("仇家屠村后伪装成自尽。").first()).toBeVisible();
    await expect(timelineDetail.getByText("角色行程")).toBeVisible();
    await expect(timelineDetail.getByText(/沈砚.*忘川村.*太玄门/)).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-timeline-${width}`);
  }
});

test("shows world detail loading and recoverable error states at all four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const faction = await createFaction(page, work, "太玄门");
  const detailPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/factions/${faction.faction.id}`;

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.route(`**${detailPath}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes(detailPath) &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await openEntity(page, work, /^势力/, "太玄门");
  await expect(page.getByText("正在加载势力档案")).toBeVisible();
  await loaded;
  await expect(page.getByText("组织目标")).toBeVisible();
  await page.unroute(`**${detailPath}`);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(`**${detailPath}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "势力档案加载失败。",
            details: {},
            requestId: "req_world_detail_error",
          },
        }),
      });
    });
    const detail = await openEntity(page, work, /^势力/, "太玄门");
    await expect(detail.getByText("势力档案加载失败。")).toBeVisible();
    await expect(detail.getByRole("button", { name: "重试" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-world-error-${width}`);
    await page.unroute(`**${detailPath}`);
  }
});

test("holds locked faction and long map details at all four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const faction = await createFaction(page, work, "太玄门");
  const token = await getCsrf(page.request);
  const locked = await page.request.post(`${base}/entities/${faction.faction.id}/lock`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: faction.version },
  });
  expect(locked.status(), await locked.text()).toBe(200);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openEntity(page, work, /^势力/, "太玄门");
    await expect(detail.getByText("已锁定").first()).toBeVisible();
    await expect(detail.getByText("组织目标")).toBeVisible();
    await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-world-locked-${width}`);
  }

  const map = await createMap(page, work, "长卷地图");
  const layer = await createLayer(page, work, map.id, "全域");
  for (let index = 1; index <= 10; index += 1) {
    await createNode(page, work, map.id, {
      name: `地点 ${index}`,
      nodeType: "landmark",
      layerId: layer.id,
    });
  }
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openEntity(page, work, /^地图/, "长卷地图");
    await expect(detail.getByText("地点 10 · 地标")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-world-long-${width}`);
  }
});
