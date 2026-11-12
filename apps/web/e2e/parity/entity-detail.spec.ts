import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import type { PowerSystemCreateRequest } from "@novel-brain/contracts";

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

type PowerSystemFixture = {
  summary: PowerSystemCreateRequest["summary"];
  tags: readonly PowerSystemCreateRequest["tags"][number][];
  pathName: PowerSystemCreateRequest["paths"][number]["name"];
  pathType: PowerSystemCreateRequest["paths"][number]["pathType"];
  realmName: PowerSystemCreateRequest["paths"][number]["realms"][number]["name"];
  rank: PowerSystemCreateRequest["paths"][number]["realms"][number]["rank"];
  lifespanBasis: PowerSystemCreateRequest["lifespanPolicy"]["basis"];
  pathDescription: PowerSystemCreateRequest["paths"][number]["description"];
  breakthroughConditions: PowerSystemCreateRequest["paths"][number]["realms"][number]["breakthroughConditions"];
  breakthroughCosts: PowerSystemCreateRequest["paths"][number]["realms"][number]["breakthroughCosts"];
  bottlenecks: PowerSystemCreateRequest["paths"][number]["realms"][number]["bottlenecks"];
  counters: PowerSystemCreateRequest["paths"][number]["realms"][number]["counters"];
  counteredBy: PowerSystemCreateRequest["paths"][number]["realms"][number]["counteredBy"];
  lifespanAmount: PowerSystemCreateRequest["paths"][number]["realms"][number]["lifespanAmount"];
};

const defaultPowerSystemFixture: PowerSystemFixture = {
  summary: "剑修与体修并行的北域体系。",
  tags: ["修行"],
  pathName: "剑修",
  pathType: "剑道",
  realmName: "筑基",
  rank: 2,
  lifespanBasis: "境界",
  pathDescription: "以剑意破境。",
  breakthroughConditions: "灵台稳固。",
  breakthroughCosts: "三百灵石。",
  bottlenecks: "心魔未除不可筑基。",
  counters: "被破阵术克制。",
  counteredBy: "克制阴灵。",
  lifespanAmount: 240,
};

async function createPowerSystem(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  name: string,
  details: Partial<PowerSystemFixture> = {},
) {
  const fixture = { ...defaultPowerSystemFixture, ...details };
  const token = await getCsrf(page.request);
  const payload = {
    name,
    aliases: [],
    summary: fixture.summary,
    description: "",
    tags: [...fixture.tags],
    overview: "两条路径共享突破代价，但克制关系不同。",
    lifespanPolicy: {
      mode: "realm",
      unit: "年",
      basis: fixture.lifespanBasis,
      description: `不同${fixture.lifespanBasis}提供不同寿命。`,
      pathId: null,
      fixedAmount: null,
    },
    paths: [
      {
        name: fixture.pathName,
        pathType: fixture.pathType,
        description: fixture.pathDescription,
        sortOrder: 0,
        realms: [
          {
            name: fixture.realmName,
            rank: fixture.rank,
            description: "",
            breakthroughConditions: fixture.breakthroughConditions,
            breakthroughCosts: fixture.breakthroughCosts,
            bottlenecks: fixture.bottlenecks,
            counters: fixture.counters,
            counteredBy: fixture.counteredBy,
            lifespanAmount: fixture.lifespanAmount,
            prerequisiteRealmId: null,
          },
        ],
      },
    ],
  } satisfies PowerSystemCreateRequest;
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/power-systems`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: payload,
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as {
    powerSystem: { id: string; label: string | null };
    version: number;
  };
}

async function createMechanism(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  character: { character: { id: string } },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/mechanisms`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name: "忘川书",
        aliases: [],
        summary: "吞噬记忆换取答案。",
        description: "",
        tags: ["机制"],
        mechanismType: "记忆交易",
        owner: {
          type: "character",
          id: character.character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        powerSystem: null,
        rules: "写下问题，交换一段记忆。",
        costs: "每次交换失去一段记忆。",
        limits: "同一天只能问一次。",
        growth: "回答越远，代价越高。",
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as {
    mechanism: { id: string; label: string | null };
    version: number;
  };
}

async function createItem(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  input: {
    name: string;
    kind: "item" | "technique" | "equipment" | "resource";
    ownershipModel?: "shared" | "unique";
    quantity?: number;
    consumable?: boolean;
    equipmentSlot?: string | null;
  },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/items`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name: input.name,
        aliases: [],
        summary: `${input.name}的说明。`,
        description: "",
        tags: [],
        kind: input.kind,
        category: input.kind === "resource" ? "丹炉" : "兵器",
        grade: "玄阶",
        effect: input.kind === "resource" ? "可同时炼两炉丹。" : "斩断灵体。",
        cost: "每次使用消耗灵力。",
        limits: "离开主人超过七日会失效。",
        ownershipModel: input.ownershipModel ?? "shared",
        consumable: input.consumable ?? false,
        quantity: input.quantity ?? 1,
        equipmentSlot: input.equipmentSlot ?? null,
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as {
    item: { id: string; label: string | null };
    version: number;
  };
}

async function grantItemRight(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  itemId: string,
  body: Record<string, unknown>,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/items/${itemId}/rights`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: body,
    },
  );
  expect(response.status(), await response.text()).toBe(201);
}

async function lockEntity(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  entityId: string,
  version: number,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entityId}/lock`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as { version: number };
}

async function createEntityProposal(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  entityId: string,
  version: number,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entityId}/proposals`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        version,
        reason: "这条设定需要作者确认后才能进入已确认设定。",
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "书页吞掉了他的名字。",
            locator: "第 1 章 · 第 3 段",
            confidence: 0.9,
          },
        ],
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
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
  await page.locator(".settings-column-nav").getByRole("button", { name: /^人物/ }).click();
  await page
    .locator(".settings-entity-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "查看设定详情" })
    .click();
  return page.locator(".settings-entity-detail");
}

async function openEntity(page: Page, work: { id: string }, column: RegExp, name: string) {
  await page.goto(`/workspace/${work.id}/settings`);
  await page.locator(".settings-column-nav").getByRole("button", { name: column }).click();
  await page
    .locator(".settings-entity-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "查看设定详情" })
    .click();
  return page.locator(".settings-entity-detail");
}

async function expectNoOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > viewportWidth + 0.5 || rect.left < -0.5;
      })
      .slice(0, 5)
      .map((element) => {
        const className = element.getAttribute("class") ?? "";
        const rect = element.getBoundingClientRect();
        return `${element.tagName.toLowerCase()}.${className} [left=${rect.left.toFixed(1)}, right=${rect.right.toFixed(1)}, width=${rect.width.toFixed(1)}]`;
      });
    return { overflow, offenders, viewportWidth };
  });
  expect(
    result.overflow,
    `viewport=${result.viewportWidth}; overflowing elements: ${result.offenders.join(", ")}`,
  ).toBeLessThanOrEqual(0);
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

test("opens entity detail as a full page with directory navigation and returns to settings", async ({
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
  await createCharacter(page, work, "沈砚");

  await page.goto(`/workspace/${work.id}/settings`);
  await page.locator(".settings-column-nav").getByRole("button", { name: /^人物/ }).click();
  await page
    .locator(".settings-entity-card", { hasText: "沈砚" })
    .first()
    .getByRole("button", { name: "查看设定详情" })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`/workspace/${work.id}/settings\\?column=characters&entityId=`, "u"),
  );
  await expect(page.locator(".entity-page-hero")).toBeVisible();
  await expect(page.locator(".entity-page-layout")).toBeVisible();
  await expect(page.locator(".settings-detail-rail")).toHaveCount(0);
  await expect(page.locator(".entity-page-nav-item")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "沈砚" })).toBeVisible();

  const relationsTab = page.locator(".entity-page-nav-item", { hasText: "关系" });
  await relationsTab.click();
  await expect(relationsTab).toHaveClass(/active/);

  await page.getByRole("button", { name: "返回设定中心" }).first().click();
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  await expect(page).not.toHaveURL(/entityId=/);
  await expect(page.locator(".entity-page-layout")).toHaveCount(0);
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
  await freezeApiTimestamps(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openCharacter(page, work);
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${work.id}/settings\\?column=characters&entityId=`, "u"),
    );
    await expect(detail.getByRole("heading", { name: "沈砚" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "锁定设定" })).toBeEnabled();
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
    const prototypeOnlyScan = await expectNoPrototypeOnlyLeakage(page);
    await testInfo.attach(`entity-detail-prototype-only-scan-${width}`, {
      body: JSON.stringify(prototypeOnlyScan, null, 2),
      contentType: "application/json",
    });
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page).toHaveScreenshot(
      ["entity-detail", `entity-detail-${width}.png`],
      productionScreenshotOptions,
    );
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
    await expect(mapDetail.getByRole("heading", { name: "地图图层" })).toBeVisible();
    await expect(mapDetail.getByText("外域")).toBeVisible();
    await expect(mapDetail.getByText("忘川村 · 聚落")).toBeVisible();
    await expect(mapDetail.getByText("路线与旅行时间")).toBeVisible();
    await expect(mapDetail.getByText(/忘川村.*太玄门/).first()).toBeVisible();
    await expect(mapDetail.getByRole("heading", { name: "地图标记" })).toBeVisible();
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

test("shows multi-path power systems and mechanism ownership at all four viewports", async ({
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
  const shen = await createCharacter(page, work, "沈砚");
  await createPowerSystem(page, work, "北域双路径");
  await createMechanism(page, work, shen);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const power = await openEntity(page, work, /^力量体系/, "北域双路径");
    await expect(power.getByText("体系概览")).toBeVisible();
    await expect(power.getByText("按境界绑定")).toBeVisible();
    await expect(power.getByText("路径与境界")).toBeVisible();
    await expect(power.getByText("剑修 · 剑道")).toBeVisible();
    await expect(power.getByText("境界 2 · 筑基")).toBeVisible();
    await expect(power.getByText("突破条件：灵台稳固。")).toBeVisible();
    await expect(power.getByText("瓶颈：心魔未除不可筑基。")).toBeVisible();
    await expect(power.getByText("克制：被破阵术克制。")).toBeVisible();
    await expect(power.getByText("寿命：240 年")).toBeVisible();
    await expectAuthorFacingLanguage(page);
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-power-${width}`);

    const mechanism = await openEntity(page, work, /^力量体系/, "忘川书");
    await expect(mechanism.getByText("机制归属")).toBeVisible();
    await expect(mechanism.getByText("记忆交易")).toBeVisible();
    await expect(mechanism.getByText("规则、代价、限制与成长")).toBeVisible();
    await expect(mechanism.getByText("写下问题，交换一段记忆。")).toBeVisible();
    await expect(mechanism.getByText("所有权历史")).toBeVisible();
    await expect(mechanism.getByText("首次登记 · 沈砚")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-mechanism-${width}`);
  }
});

test("uses genre pack level labels for power systems in history and urban works", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);

  const cases = [
    {
      genre: "history",
      title: "北境军功录",
      idea: "边军校尉在粮道断绝后争夺军功，并追查军械失窃的真相。",
      systemName: "北境军制",
      pathName: "边军",
      pathType: "军职",
      realmName: "校尉",
      rank: 3,
      lifespanBasis: "军职",
      powerLevelLabel: "军职层级",
      summary: "边军以军功和军令维持晋升。",
      tags: ["军制"],
      pathDescription: "边军凭军功晋升。",
      breakthroughConditions: "获得军功。",
      breakthroughCosts: "承担军令风险。",
      bottlenecks: "粮道断绝时无法晋升。",
      counters: "被监军节制。",
      counteredBy: "可压制地方豪强。",
    },
    {
      genre: "urban",
      title: "算法围城",
      idea: "项目经理在平台规则与资本压力之间寻找出路，并追查算法歧视。",
      systemName: "平台资源体系",
      pathName: "平台资源",
      pathType: "资源",
      realmName: "合伙人",
      rank: 4,
      lifespanBasis: "资源等级",
      powerLevelLabel: "资源等级",
      summary: "资源与信用决定平台权限。",
      tags: ["资源"],
      pathDescription: "资源与信用决定权限。",
      breakthroughConditions: "完成平台问责。",
      breakthroughCosts: "让渡部分股权。",
      bottlenecks: "资本链断裂时无法晋升。",
      counters: "受合同约束。",
      counteredBy: "可调动平台资源。",
    },
  ] as const;

  for (const item of cases) {
    const work = await createWork(page.request, {
      mode: "idea",
      title: item.title,
      idea: item.idea,
      genre: item.genre,
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    });
    await createPowerSystem(page, work, item.systemName, item);

    for (const width of viewports) {
      await page.setViewportSize({ width, height: 1000 });
      const power = await openEntity(page, work, /^力量体系/, item.systemName);
      await expect(power.getByText(`路径与${item.powerLevelLabel}`)).toBeVisible();
      await expect(power.getByText(`按${item.powerLevelLabel}绑定`)).toBeVisible();
      await expect(
        power.getByText(`${item.powerLevelLabel} ${item.rank} · ${item.realmName}`),
      ).toBeVisible();
      await expect(
        power.getByRole("button", { name: new RegExp(`${item.powerLevelLabel}变化`) }),
      ).toBeVisible();
      await expect(power.getByText("路径与境界")).toHaveCount(0);
      await expectNoOverflow(page);
      await capture(page, testInfo, `entity-detail-power-${item.genre}-${width}`);
    }

    const editablePower = await openEntity(page, work, /^力量体系/, item.systemName);
    await expect(editablePower.getByText(`按${item.powerLevelLabel}绑定`)).toBeVisible();
    await editablePower.getByRole("button", { name: "编辑设定" }).click();
    const lifespanMode = page.locator(".settings-editor").getByLabel("寿命绑定");
    await expect(lifespanMode).toHaveValue("realm");
    await expect(
      lifespanMode.getByRole("option", { name: `按${item.powerLevelLabel}绑定` }),
    ).toHaveCount(1);
    await page
      .locator(".settings-editor")
      .getByRole("button", { name: "取消", exact: true })
      .first()
      .click();
  }
});

test("keeps item ownership, custody, location, usage and disposal separate", async ({
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
  const first = await createCharacter(page, work, "沈砚");
  const second = await createCharacter(page, work, "顾青");
  const third = await createCharacter(page, work, "陈渡");
  const map = await createMap(page, work, "北域");
  const item = await createItem(page, work, {
    name: "共灵丹炉",
    kind: "resource",
    ownershipModel: "shared",
    quantity: 5,
    consumable: true,
  });
  const validity = {
    fromChapter: 1,
    toChapter: null,
    fromStoryTime: null,
    toStoryTime: null,
  };
  await grantItemRight(page, work, item.item.id, {
    rightType: "ownership",
    holder: {
      type: "character",
      id: first.character.id,
      branchId: work.mainBranch.id,
      label: "沈砚",
    },
    sharePercent: 60,
    validity,
    reason: "共同持有。",
  });
  await grantItemRight(page, work, item.item.id, {
    rightType: "ownership",
    holder: {
      type: "character",
      id: second.character.id,
      branchId: work.mainBranch.id,
      label: "顾青",
    },
    sharePercent: 40,
    validity,
    reason: "共同持有。",
  });
  for (const right of [
    {
      rightType: "custody",
      holder: {
        type: "character",
        id: third.character.id,
        branchId: work.mainBranch.id,
        label: "陈渡",
      },
      reason: "由陈渡保管。",
    },
    {
      rightType: "usage",
      holder: {
        type: "character",
        id: first.character.id,
        branchId: work.mainBranch.id,
        label: "沈砚",
      },
      reason: "沈砚可以使用。",
    },
    {
      rightType: "disposal",
      holder: {
        type: "character",
        id: second.character.id,
        branchId: work.mainBranch.id,
        label: "顾青",
      },
      reason: "顾青拥有处置权。",
    },
    {
      rightType: "location",
      holder: {
        type: "map",
        id: map.id,
        branchId: work.mainBranch.id,
        label: "北域",
      },
      reason: "存放在北域。",
    },
  ]) {
    await grantItemRight(page, work, item.item.id, {
      ...right,
      sharePercent: null,
      validity,
    });
  }

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const detail = await openEntity(page, work, /^物品功法/, "共灵丹炉");
    await expect(detail.getByText("物品档案")).toBeVisible();
    await expect(detail.getByText("资源")).toBeVisible();
    await expect(detail.getByText("共享")).toBeVisible();
    await expect(detail.getByText("归属 · 沈砚")).toBeVisible();
    await expect(detail.getByText("归属 · 顾青")).toBeVisible();
    await expect(detail.getByText("保管 · 陈渡")).toBeVisible();
    await expect(detail.getByText("位置 · 北域")).toBeVisible();
    await expect(detail.getByText("使用权 · 沈砚")).toBeVisible();
    await expect(detail.getByText("处置权 · 顾青")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-item-${width}`);
  }
});

test("holds locked, proposal, long and error states for power and item domains", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const lockedPower = await createPowerSystem(page, work, "锁定的力量体系");
  await lockEntity(page, work, lockedPower.powerSystem.id, lockedPower.version);
  const proposedPower = await createPowerSystem(page, work, "待确认的力量体系");
  await createEntityProposal(page, work, proposedPower.powerSystem.id, proposedPower.version);
  const lockedItem = await createItem(page, work, {
    name: "锁定的斩灵剑",
    kind: "equipment",
    equipmentSlot: "main_hand",
  });
  await lockEntity(page, work, lockedItem.item.id, lockedItem.version);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    const locked = await openEntity(page, work, /^力量体系/, "锁定的力量体系");
    await expect(locked.getByText("已锁定").first()).toBeVisible();
    await expect(locked.getByText("按境界绑定")).toBeVisible();
    await expect(locked.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-power-locked-${width}`);

    const proposal = await openEntity(page, work, /^力量体系/, "待确认的力量体系");
    await expect(proposal.getByText("待确认").first()).toBeVisible();
    await expect(proposal.getByText("待裁决", { exact: true })).toBeVisible();
    await expect(proposal.getByRole("button", { name: "确认提案" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-power-proposal-${width}`);

    const item = await openEntity(page, work, /^物品功法/, "锁定的斩灵剑");
    await expect(item.getByText("已锁定").first()).toBeVisible();
    await expect(item.getByText("物品档案")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-item-locked-${width}`);
  }

  for (let index = 1; index <= 10; index += 1) {
    await createItem(page, work, {
      name: `长卷物品 ${index}`,
      kind: "item",
    });
  }
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/workspace/${work.id}/settings`);
    await page
      .locator(".settings-column-nav")
      .getByRole("button", { name: /^物品功法/ })
      .click();
    await expect(page.locator(".settings-entity-card")).toHaveCount(11);
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-item-long-${width}`);
  }

  const powerPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/power-systems/${lockedPower.powerSystem.id}`;
  const itemPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/items/${lockedItem.item.id}`;
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    await page.route(`**${powerPath}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "力量体系加载失败。",
            details: {},
            requestId: "req_power_error",
          },
        }),
      });
    });
    const power = await openEntity(page, work, /^力量体系/, "锁定的力量体系");
    await expect(power.getByText("力量体系加载失败。")).toBeVisible();
    await expect(power.getByRole("button", { name: "重试" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-power-error-${width}`);
    await page.unroute(`**${powerPath}`);

    await page.route(`**${itemPath}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "物品功法加载失败。",
            details: {},
            requestId: "req_item_error",
          },
        }),
      });
    });
    const item = await openEntity(page, work, /^物品功法/, "锁定的斩灵剑");
    await expect(item.getByText("物品功法加载失败。")).toBeVisible();
    await expect(item.getByRole("button", { name: "重试" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `entity-detail-item-error-${width}`);
    await page.unroute(`**${itemPath}`);
  }
});
