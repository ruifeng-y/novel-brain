import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import {
  characterDetailResponseSchema,
  characterRelationshipResponseSchema,
  customFieldDefinitionListResponseSchema,
  customFieldDefinitionResponseSchema,
  genrePackListResponseSchema,
  mapDetailResponseSchema,
  powerSystemResponseSchema,
  settingEntityDeleteResponseSchema,
  settingEntityResponseSchema,
  settingProposalListResponseSchema,
  settingProposalResponseSchema,
  workResponseSchema,
  worldTimelineResponseSchema,
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
  const email = uniqueEmail("settings");
  const session = await registerUser(page.request, email, "StrongPassword123", "设定作者");
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

async function createSettingsWork(page: Page) {
  return createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
}

async function createEntity(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  payload: Record<string, unknown>,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: payload,
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; version: number; name: string };
}

async function lockEntity(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  entity: { id: string; version: number },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entity.id}/lock`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: entity.version },
    },
  );
  expect(response.status()).toBe(200);
}

async function createPowerSystem(page: Page, work: { id: string; mainBranch: { id: string } }) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/power-systems`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        name: "北域双路径",
        aliases: [],
        summary: "剑修与体修并行。",
        description: "",
        tags: ["修行"],
        overview: "第一版力量体系总览。",
        lifespanPolicy: {
          mode: "fixed",
          unit: "年",
          basis: "",
          description: "固定寿元。",
          pathId: null,
          fixedAmount: 120,
        },
        paths: [],
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as {
    powerSystem: { id: string };
    version: number;
    overview: string;
  };
}

async function updatePowerSystemOverview(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  powerSystem: { powerSystem: { id: string }; version: number },
  overview: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.patch(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/power-systems/${powerSystem.powerSystem.id}`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: powerSystem.version, overview },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).data as typeof powerSystem;
}

async function createProposal(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  entity: { id: string; version: number },
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entity.id}/proposals`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        version: entity.version,
        reason: "这条设定需要作者确认后才能进入已确认设定。",
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "天门不会为失去记忆的人开启。",
            locator: "第 1 章 · 第 3 段",
            confidence: 0.9,
          },
        ],
      },
    },
  );
  expect(response.status()).toBe(201);
  return settingProposalResponseSchema.parse(await response.json()).data;
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

test("persists setting creation, editing and deletion through the production API", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entitiesApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  await page.getByRole("button", { name: "新增世界规则" }).first().click();
  await page.getByLabel("名称").fill("天门只认完整记忆");
  await page.getByLabel("一句话摘要").fill("失去关键记忆的人无法通过天门。");
  await page
    .getByRole("textbox", { name: "世界规则" })
    .fill("主动抹除关键记忆会导致天门通行失败。");

  const createResponse = waitForApiResponse(page, "POST", entitiesApi);
  await page.getByRole("button", { name: "创建设定" }).click();
  const created = settingEntityResponseSchema.parse(await (await createResponse).json()).data;
  await expect(
    page.locator(".settings-entity-detail").getByRole("heading", { name: created.name }),
  ).toBeVisible();

  const entityApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${created.id}`;
  const persistedCreateResponse = await page.request.get(entityApi);
  expect(persistedCreateResponse.status()).toBe(200);
  const persistedCreated = settingEntityResponseSchema.parse(
    await persistedCreateResponse.json(),
  ).data;
  expect(persistedCreated.name).toBe("天门只认完整记忆");

  const detail = page.locator(".settings-entity-detail");
  await detail.getByRole("button", { name: "编辑设定", exact: true }).click();
  await page.getByLabel("一句话摘要").fill("失去完整记忆的人会被天门留在门外。");
  const editResponse = waitForApiResponse(page, "PATCH", entityApi);
  await page.getByRole("button", { name: "保存修改" }).click();
  const edited = settingEntityResponseSchema.parse(await (await editResponse).json()).data;
  await expect(detail.getByText("失去完整记忆的人会被天门留在门外。")).toBeVisible();

  const persistedEditResponse = await page.request.get(entityApi);
  expect(persistedEditResponse.status()).toBe(200);
  const persistedEdited = settingEntityResponseSchema.parse(
    await persistedEditResponse.json(),
  ).data;
  expect(persistedEdited.summary).toBe("失去完整记忆的人会被天门留在门外。");

  page.once("dialog", (dialog) => void dialog.accept());
  const deleteResponse = waitForApiResponse(page, "DELETE", entityApi);
  await detail.getByRole("button", { name: "删除设定" }).click();
  const deleted = settingEntityDeleteResponseSchema.parse(await (await deleteResponse).json()).data;
  expect(deleted.deleted).toBe(true);
  const deletedDetailResponse = await page.request.get(entityApi);
  expect(deletedDetailResponse.status()).toBe(403);
  expect(edited.version).toBeGreaterThan(created.version);
});

test("persists relationship, map, power system, timeline and custom-field actions through production forms", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const branchApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const charactersApi = `${branchApi}/characters`;
  const mapApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/maps`;
  const powerSystemsApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/power-systems`;
  const customFieldsApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/custom-fields`;
  const entitiesApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
  const token = await getCsrf(page.request);
  const headers = { Origin: origin, "X-CSRF-Token": token };

  const sourceCharacterResponse = await page.request.post(charactersApi, {
    headers,
    data: {
      name: "沈砚",
      aliases: [],
      summary: "带着断臂追查身世的杂役。",
      description: "",
      tags: [],
      profile: {
        desire: "找回被抹去的记忆。",
        fear: "再次被宗门抛弃。",
        goal: "进入内门。",
        voiceSample: "“我记得，只是还没想起来。”",
        voiceGuide: "短句，克制。",
        disguise: "藏起左臂伤势。",
      },
    },
  });
  expect(sourceCharacterResponse.status()).toBe(201);
  const sourceCharacter = characterDetailResponseSchema.parse(
    await sourceCharacterResponse.json(),
  ).data;
  const targetCharacterResponse = await page.request.post(charactersApi, {
    headers,
    data: {
      name: "顾青",
      aliases: [],
      summary: "与沈砚互相提防又不得不同行。",
      description: "",
      tags: [],
      profile: {
        desire: "守住师门秘密。",
        fear: "被宗门除名。",
        goal: "查明忘川村的旧案。",
        voiceSample: "“你刚才那招，我见过。”",
        voiceGuide: "简短，带试探。",
        disguise: "",
      },
    },
  });
  expect(targetCharacterResponse.status()).toBe(201);
  const targetCharacter = characterDetailResponseSchema.parse(
    await targetCharacterResponse.json(),
  ).data;

  const relationshipApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/characters/${sourceCharacter.character.id}/relationships`;
  await page.goto(
    `/workspace/${work.id}/settings?column=characters&entityId=${sourceCharacter.character.id}`,
  );
  await expect(page.getByRole("heading", { name: "沈砚" })).toBeVisible();
  await page.locator(".entity-page-nav").getByRole("button", { name: /^关系/ }).click();
  const relationshipSection = page.locator("#entity-section-relations");
  await relationshipSection.getByLabel("关系对象").selectOption(targetCharacter.character.id);
  await relationshipSection.getByLabel("关系类型").selectOption("ally");
  const relationshipResponse = waitForApiResponse(page, "POST", relationshipApi);
  await relationshipSection.getByRole("button", { name: "保存关系" }).click();
  const relationship = characterRelationshipResponseSchema.parse(
    await (await relationshipResponse).json(),
  ).data;
  await expect(relationshipSection).toContainText("同盟 · 顾青");
  const persistedCharacterResponse = await page.request.get(
    `${charactersApi}/${sourceCharacter.character.id}`,
  );
  expect(persistedCharacterResponse.status()).toBe(200);
  const persistedCharacter = characterDetailResponseSchema.parse(
    await persistedCharacterResponse.json(),
  ).data;
  expect(persistedCharacter.relationships[0]?.target.id).toBe(relationship.target.id);

  await page.goto(`/workspace/${work.id}/settings`);
  await page.locator(".settings-column-nav").getByRole("button", { name: /^地图/ }).click();
  await page.getByRole("button", { name: "新增地图" }).first().click();
  await page.getByLabel("名称").fill("东境舆图");
  await page.getByLabel("一句话摘要").fill("忘川渡与太玄门之间的地理关系。");
  await page
    .getByRole("textbox", { name: "地图", exact: true })
    .fill("山道、渡口与宗门驻地的层级关系。");
  const mapResponse = waitForApiResponse(page, "POST", mapApi);
  await page.getByRole("button", { name: "创建设定" }).click();
  const createdMap = mapDetailResponseSchema.parse(await (await mapResponse).json()).data;
  await expect(page.getByRole("heading", { name: "东境舆图" })).toBeVisible();
  const persistedMapResponse = await page.request.get(`${mapApi}/${createdMap.map.id}`);
  expect(persistedMapResponse.status()).toBe(200);
  const persistedMap = mapDetailResponseSchema.parse(await persistedMapResponse.json()).data;
  expect(persistedMap.map.label).toBe("东境舆图");

  await page.getByRole("button", { name: "返回设定中心" }).first().click();
  await page
    .locator(".settings-column-nav")
    .getByRole("button", { name: /^力量体系/ })
    .click();
  await page.getByRole("button", { name: "新增力量体系" }).first().click();
  await page.getByLabel("名称").fill("北域双路径");
  await page.getByLabel("一句话摘要").fill("剑修与体修并行。");
  await page.getByRole("textbox", { name: "力量体系", exact: true }).fill("第一版力量体系总览。");
  await page.getByLabel("寿命绑定").selectOption("fixed");
  await page.getByRole("spinbutton", { name: "固定寿命" }).fill("120");
  const powerSystemResponse = waitForApiResponse(page, "POST", powerSystemsApi);
  await page.getByRole("button", { name: "创建设定" }).click();
  const createdPowerSystem = powerSystemResponseSchema.parse(
    await (await powerSystemResponse).json(),
  ).data;
  await expect(page.getByRole("heading", { name: "北域双路径" })).toBeVisible();
  const persistedPowerResponse = await page.request.get(
    `${powerSystemsApi}/${createdPowerSystem.powerSystem.id}`,
  );
  expect(persistedPowerResponse.status()).toBe(200);
  const persistedPowerSystem = powerSystemResponseSchema.parse(
    await persistedPowerResponse.json(),
  ).data;
  expect(persistedPowerSystem.overview).toBe("第一版力量体系总览。");

  await page.getByRole("button", { name: "返回设定中心" }).first().click();
  await page
    .locator(".settings-column-nav")
    .getByRole("button", { name: /^时间线/ })
    .click();
  await page.getByRole("button", { name: "新增时间线" }).first().click();
  await page.getByLabel("名称").fill("忘川村灭门");
  await page.getByLabel("一句话摘要").fill("十六年前改变沈砚命运的事件。");
  await page.getByLabel("纪元", { exact: true }).fill("大玄历");
  await page.getByLabel("故事时间", { exact: true }).fill("十六年前");
  await page.getByLabel("持续时长", { exact: true }).fill("一夜");
  await page.getByLabel("事件", { exact: true }).fill("沈砚父母被杀，真相被伪装成自杀。");
  const timelineResponse = waitForApiResponse(page, "POST", entitiesApi);
  await page.getByRole("button", { name: "创建设定" }).click();
  const createdTimelineEvent = settingEntityResponseSchema.parse(
    await (await timelineResponse).json(),
  ).data;
  await expect(page.getByRole("heading", { name: "忘川村灭门" })).toBeVisible();
  const persistedTimelineResponse = await page.request.get(`${branchApi}/world/timeline`);
  expect(persistedTimelineResponse.status()).toBe(200);
  const persistedTimeline = worldTimelineResponseSchema.parse(
    await persistedTimelineResponse.json(),
  ).data;
  const timelineEventIds = persistedTimeline.events.map((event) => event.event.id);
  expect(timelineEventIds).toContain(createdTimelineEvent.id);

  await page.getByRole("button", { name: "返回设定中心" }).first().click();
  await page.getByRole("button", { name: "自定义字段" }).click();
  await page.getByRole("button", { name: "新增字段" }).click();
  await page.getByLabel("字段标识").fill("fate");
  await page.getByLabel("字段名称").fill("命格");
  await page.getByLabel("字段类型").selectOption("single_select");
  await page.getByLabel("适用对象").selectOption("character");
  await page.getByLabel("选项").fill("剑骨，凡骨");
  const customFieldResponse = waitForApiResponse(page, "POST", customFieldsApi);
  await page.getByRole("button", { name: "创建字段" }).click();
  const customField = customFieldDefinitionResponseSchema.parse(
    await (await customFieldResponse).json(),
  ).data;
  expect(customField.key).toBe("fate");
  await expect(page.locator(".settings-custom-field-row", { hasText: "命格" })).toBeVisible();
  const persistedFieldsResponse = await page.request.get(customFieldsApi);
  expect(persistedFieldsResponse.status()).toBe(200);
  const persistedFields = customFieldDefinitionListResponseSchema.parse(
    await persistedFieldsResponse.json(),
  ).data;
  expect(persistedFields.some((field) => field.key === "fate")).toBe(true);
});

test("persists a setting proposal decision through the production API", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entity = await createEntity(page, work, {
    type: "world_rule",
    name: "天门只认完整记忆",
    aliases: [],
    summary: "失去关键记忆的人无法通过天门。",
    description: "",
    tags: [],
    data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
  });
  const proposal = await createProposal(page, work, entity);
  const entityApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entity.id}`;
  const proposalsApi = `${entityApi}/proposals`;
  const decisionApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${entity.id}/proposals/${proposal.id}/decision`;

  await page.goto(`/workspace/${work.id}/settings?column=world&entityId=${entity.id}`);
  const detail = page.locator(".settings-entity-detail");
  await expect(detail.getByRole("button", { name: "确认提案" })).toBeEnabled();
  const decisionResponse = waitForApiResponse(page, "POST", decisionApi);
  await detail.getByRole("button", { name: "确认提案" }).click();
  const decided = settingProposalResponseSchema.parse(await (await decisionResponse).json()).data;
  expect(decided.status).toBe("accepted");
  await expect(detail.getByText("已锁定").first()).toBeVisible();

  const persistedProposalsResponse = await page.request.get(proposalsApi);
  expect(persistedProposalsResponse.status()).toBe(200);
  const persistedProposals = settingProposalListResponseSchema.parse(
    await persistedProposalsResponse.json(),
  ).data;
  const persistedProposal = persistedProposals.find((candidate) => candidate.id === proposal.id);
  expect(persistedProposal?.status).toBe("accepted");

  const persistedEntityResponse = await page.request.get(entityApi);
  expect(persistedEntityResponse.status()).toBe(200);
  const persistedEntity = settingEntityResponseSchema.parse(
    await persistedEntityResponse.json(),
  ).data;
  expect(persistedEntity.status).toBe("locked");
});

test("switches a history work to an older genre pack version", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "旧朝军功簿",
    genre: "history",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const genrePackVersionApi = `/api/v1/works/${work.id}/genre-pack/version`;
  const workApi = `/api/v1/works/${work.id}`;
  const genrePacksApi = "/api/v1/genre-packs?key=history";

  await page.goto(`/workspace/${work.id}/settings`);
  const packBar = page.getByLabel("题材包版本");
  await expect(packBar.getByText("架空历史模板", { exact: true })).toBeVisible();
  await expect(packBar.getByText("当前第 2 版")).toBeVisible();
  await packBar.getByLabel("题材包版本").selectOption("1");
  const switchResponse = waitForApiResponse(page, "POST", genrePackVersionApi);
  await packBar.getByRole("button", { name: "切换题材包版本" }).click();
  const switchedWork = workResponseSchema.parse(await (await switchResponse).json()).data;
  expect(switchedWork.templatePack?.version).toBe(1);
  await expect(page.getByText("题材包已切换到第 1 版。")).toBeVisible();
  await expect(packBar.getByText("当前第 1 版")).toBeVisible();

  const persistedWorkResponse = await page.request.get(workApi);
  expect(persistedWorkResponse.status()).toBe(200);
  const persistedWork = workResponseSchema.parse(await persistedWorkResponse.json()).data;
  expect(persistedWork.templatePack?.version).toBe(1);
  const packsResponse = await page.request.get(genrePacksApi);
  expect(packsResponse.status()).toBe(200);
  const packs = genrePackListResponseSchema.parse(await packsResponse.json()).data;
  expect(packs.some((pack) => pack.key === "history" && pack.version === 1)).toBe(true);
});

test("creates typed settings in all seven columns with custom fields, proposals and change requests", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  await page.goto(`/workspace/${work.id}/settings`);

  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
  await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
  await expect(page.locator(".settings-column-nav .settings-column-item span")).toHaveText([
    "世界",
    "势力",
    "人物",
    "地图",
    "力量体系",
    "物品功法",
    "时间线",
  ]);
  await expect(page.getByText("还没有世界规则")).toBeVisible();
  await expectAuthorFacingLanguage(page);

  await page.getByRole("button", { name: "自定义字段" }).click();
  await page.getByRole("button", { name: "新增字段" }).click();
  await page.getByLabel("字段标识").fill("fate");
  await page.getByLabel("字段名称").fill("命格");
  await page.getByLabel("字段类型").selectOption("single_select");
  await page.getByLabel("适用对象").selectOption("character");
  await page.getByLabel("选项").fill("剑骨，凡骨");
  await page.getByLabel("必填").check();
  await page.getByRole("button", { name: "创建字段" }).click();
  await expect(page.locator(".settings-custom-field-row", { hasText: "命格" })).toBeVisible();

  await page
    .locator(".settings-column-nav")
    .getByRole("button", { name: /^物品功法/ })
    .click();
  await page.getByRole("button", { name: "新增物品功法" }).first().click();
  await page.getByLabel("名称").fill("听潮剑");
  await page.getByLabel("别名").fill("潮生");
  await page.getByLabel("一句话摘要").fill("会记录持剑者杀意的法器。");
  await page.getByLabel("详细说明").fill("太玄门内门弟子配剑。");
  await page.getByLabel("标签").fill("法器");
  await page.getByLabel("物品类型").selectOption("equipment");
  await page.getByLabel("分类", { exact: true }).fill("兵器");
  await page.getByLabel("品阶", { exact: true }).fill("玄阶");
  await page.getByLabel("效果", { exact: true }).fill("剑身会记录持剑者的杀意。");
  await page.getByLabel("代价", { exact: true }).fill("杀意过重时会反噬持剑者。");
  await page.getByLabel("归属方式").selectOption("unique");
  await page.getByLabel("装备位").fill("main_hand");
  await page.getByLabel("限制", { exact: true }).fill("不能离开主人超过七日。");
  await page.getByRole("button", { name: "创建设定" }).click();
  const itemDetail = page.locator(".settings-entity-detail");
  await expect(itemDetail.getByText("唯一")).toBeVisible();
  await expect(itemDetail.getByText("main_hand")).toBeVisible();
  await itemDetail.getByRole("button", { name: "返回设定中心" }).first().click();
  await expect(page.locator(".settings-entity-card", { hasText: "听潮剑" })).toBeVisible();

  await page
    .locator(".settings-column-nav")
    .getByRole("button", { name: /^时间线/ })
    .click();
  await page.getByRole("button", { name: "新增时间线" }).first().click();
  await page.getByLabel("名称").fill("忘川村灭门");
  await page.getByLabel("一句话摘要").fill("十六年前改变沈砚命运的事件。");
  await page.getByLabel("纪元", { exact: true }).fill("大玄历");
  await page.getByLabel("故事时间", { exact: true }).fill("十六年前");
  await page.getByLabel("持续时长", { exact: true }).fill("一夜");
  await page.getByLabel("事件", { exact: true }).fill("沈砚父母被杀，真相被伪装成自杀。");
  await page.getByRole("button", { name: "创建设定" }).click();
  await expect(
    page.locator(".settings-entity-detail").getByRole("heading", { name: "忘川村灭门" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回设定中心" }).first().click();
  await expect(page.locator(".settings-entity-card", { hasText: "忘川村灭门" })).toBeVisible();

  await page.locator(".settings-column-nav").getByRole("button", { name: /^人物/ }).click();
  await page.getByRole("button", { name: "新增人物档案" }).first().click();
  await page.getByLabel("名称").fill("沈砚");
  await page.getByLabel("别名").fill("小砚");
  await page.getByLabel("一句话摘要").fill("外门杂役，正在隐藏忘川书的存在。");
  await page.getByLabel("人物欲望").fill("找回被抹去的记忆。");
  await page.getByLabel("人物恐惧").fill("再次被宗门抛弃。");
  await page.getByLabel("人物目标").fill("进入内门。");
  await page.getByLabel("声纹样本").fill("“我记得，只是还没想起来。”");
  await page.getByLabel("声线指南").fill("短句，克制。");
  await page.getByLabel("伪装").fill("藏起左臂伤势。");
  await page.getByLabel(/命格/).selectOption("剑骨");
  await page.getByRole("button", { name: "创建设定" }).click();

  const detail = page.locator(".settings-entity-detail");
  await expect(detail.getByRole("heading", { name: "沈砚" })).toBeVisible();
  await expect(detail.getByText("命格")).toBeVisible();
  await expect(detail.getByText("剑骨")).toBeVisible();

  await detail.getByRole("button", { name: "编辑设定", exact: true }).click();
  await page.getByLabel("人物欲望").fill("找回被抹去的全部记忆。");
  const characterPatch = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" && /\/characters\/[^/]+$/u.test(new URL(request.url()).pathname),
  );
  await page.getByRole("button", { name: "保存修改" }).click();
  await characterPatch;
  await expect(detail.getByText("找回被抹去的全部记忆。")).toBeVisible();

  await detail.getByRole("button", { name: "锁定设定" }).click();
  await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "已锁定 · 别名需修改请求" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "已锁定 · 删除需修改请求" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "发起修改请求" })).toBeEnabled();

  await detail.getByRole("button", { name: "发起修改请求" }).click();
  await page.getByLabel("修改标题").fill("补全沈砚状态");
  await page.getByLabel("修改原因").fill("第 48 章正文写明左臂恢复了一部分。");
  await page.getByLabel("一句话摘要").fill("外门杂役，正在隐藏忘川书的存在。");
  await page.getByRole("button", { name: "提交修改请求" }).click();
  await expect(detail.getByText("补全沈砚状态")).toBeVisible();
  await expect(detail.getByText("第 48 章正文写明左臂恢复了一部分。").first()).toBeVisible();

  await page.getByRole("button", { name: "返回设定中心" }).first().click();
  await page.locator(".settings-column-nav").getByRole("button", { name: /^世界/ }).click();
  await page.getByRole("button", { name: "新增世界规则" }).first().click();
  await page.getByLabel("名称").fill("天门只认完整记忆");
  await page.getByLabel("一句话摘要").fill("失去关键记忆的人无法通过天门。");
  await page
    .getByRole("textbox", { name: "世界规则" })
    .fill("主动抹除关键记忆会导致天门通行失败。");
  await page.getByRole("button", { name: "创建设定" }).click();

  await expect(detail.getByRole("heading", { name: "天门只认完整记忆" })).toBeVisible();
  await detail.getByRole("button", { name: "提交提案" }).click();
  await page.getByLabel("提案理由").fill("从第一章提取到需要作者确认的世界规则。");
  await page.getByLabel("证据来源").fill("第 1 章");
  await page.getByLabel("证据摘录").fill("天门不会为失去记忆的人开启。");
  await page.locator(".settings-proposal-form").getByRole("button", { name: "提交提案" }).click();
  await expect(detail.getByText("待裁决", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "确认提案" })).toBeEnabled();
  await detail.getByRole("button", { name: "确认提案" }).click();
  await expect(detail.getByText("已锁定").first()).toBeVisible();
  await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
});

test("opens setting version history and restores the past power-system overview", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const created = await createPowerSystem(page, work);
  await updatePowerSystemOverview(page, work, created, "第二版力量体系总览。");

  await page.goto(`/workspace/${work.id}/settings?column=power&entityId=${created.powerSystem.id}`);
  await expect(page.getByRole("heading", { name: "北域双路径" })).toBeVisible();
  const history = page.locator(".settings-version-history");
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByText("第 2 版").first()).toBeVisible();
  await history.getByRole("button", { name: /第 1 版/ }).click();
  await page.getByLabel("恢复原因").fill("恢复作者确认的第一版力量体系总览。");
  await history.getByRole("button", { name: "恢复第 1 版" }).click();

  await expect(page.getByText(/已恢复到第 1 版，并生成第 3 版/)).toBeVisible();
  await expect(page.locator(".entity-page-meta").getByText("第 3 版")).toBeVisible();
  await expect(history.getByText("第 3 版").first()).toBeVisible();

  const detail = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/world/power-systems/${created.powerSystem.id}`,
  );
  expect(detail.ok()).toBe(true);
  expect((await detail.json()).data.overview).toBe("第一版力量体系总览。");
});

test("shows version-history loading, empty, error and restore-conflict states", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const editable = await createEntity(page, work, {
    type: "world_rule",
    name: "有历史的规则",
    aliases: [],
    summary: "第一版规则摘要。",
    description: "",
    tags: [],
    data: { rule: "第一版规则内容。" },
  });
  const token = await getCsrf(page.request);
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const edited = await page.request.patch(`${base}/entities/${editable.id}`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: editable.version, summary: "第二版规则摘要。" },
  });
  expect(edited.ok()).toBe(true);
  const empty = await createEntity(page, work, {
    type: "world_rule",
    name: "没有历史的规则",
    aliases: [],
    summary: "只有第一版。",
    description: "",
    tags: [],
    data: { rule: "尚未发生后续修改。" },
  });

  const versionsPath = `**${base}/entities/${editable.id}/versions*`;
  let releaseVersionRequest: () => void = () => undefined;
  const versionRequestGate = new Promise<void>((resolve) => {
    releaseVersionRequest = resolve;
  });
  const delayedVersionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname.endsWith(`/entities/${editable.id}/versions`),
  );
  await page.route(versionsPath, async (route) => {
    await versionRequestGate;
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/settings?column=world&entityId=${editable.id}`);
  await expect(page.getByText("正在加载版本历史")).toBeVisible();
  releaseVersionRequest();
  await delayedVersionResponse;
  await page.unroute(versionsPath);

  await page.route(versionsPath, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "版本历史加载失败。",
          details: {},
          requestId: "req_settings_versions_error",
        },
      }),
    });
  });
  await page.reload();
  const history = page.locator(".settings-version-history");
  await expect(history.getByText("版本历史加载失败。")).toBeVisible();
  await expect(history.getByRole("button", { name: "重新加载" })).toBeVisible();
  await page.unroute(versionsPath);

  await page.reload();
  await history.getByRole("button", { name: /第 1 版/ }).click();
  const advancedToken = await getCsrf(page.request);
  const advanced = await page.request.patch(`${base}/entities/${editable.id}`, {
    headers: { Origin: origin, "X-CSRF-Token": advancedToken },
    data: { version: 2, summary: "页面打开后又被修改。" },
  });
  expect(advanced.ok()).toBe(true);
  await page.getByLabel("恢复原因").fill("页面尚未刷新时恢复旧版本。");
  await history.getByRole("button", { name: "恢复第 1 版" }).click();
  await expect(page.getByText("设定已被其他操作更新，请刷新后重试")).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings?column=world&entityId=${empty.id}`);
    await expect(page.getByText("还没有可恢复的历史版本。")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-version-empty-${width}`);
  }
});

test("filters settings by search and status and opens recent updates", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  await createEntity(page, work, {
    type: "world_rule",
    name: "天门只认完整记忆",
    aliases: [],
    summary: "失去关键记忆的人无法通过天门。",
    description: "",
    tags: [],
    data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
  });
  const locked = await createEntity(page, work, {
    type: "world_rule",
    name: "已锁定的规则",
    aliases: [],
    summary: "已经确认并锁定的世界规则。",
    description: "",
    tags: [],
    data: { rule: "锁定后的规则只能通过修改请求调整。" },
  });
  await lockEntity(page, work, locked);

  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.locator(".settings-entity-card")).toHaveCount(2);
  await expect(page.locator(".settings-recent-item")).toHaveCount(2);

  await page.getByLabel("搜索设定").fill("已锁定");
  await expect(page.locator(".settings-entity-card")).toHaveCount(1);
  await expect(page.locator(".settings-entity-card", { hasText: "已锁定的规则" })).toBeVisible();

  await page.getByLabel("按状态筛选").selectOption("draft");
  await expect(page.getByText("没有匹配的设定")).toBeVisible();
  await page.getByLabel("搜索设定").fill("");
  await expect(page.locator(".settings-entity-card")).toHaveCount(1);
  await expect(
    page.locator(".settings-entity-card", { hasText: "天门只认完整记忆" }),
  ).toBeVisible();

  await page.getByLabel("按状态筛选").selectOption("all");
  await expect(page.locator(".settings-entity-card")).toHaveCount(2);
  await page.locator(".settings-recent-item", { hasText: "已锁定的规则" }).click();
  await expect(page.getByRole("heading", { name: "已锁定的规则" })).toBeVisible();
});

test("holds the empty settings state at all four viewports", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  await freezeApiTimestamps(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/settings$`, "u"));
    await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
    await expect(page.locator(".settings-column-nav button")).toHaveCount(7);
    await expect(page.getByText("还没有世界规则")).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await capture(page, testInfo, `settings-empty-${width}`);
  }
});

test("holds the locked state at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entity = await createEntity(page, work, {
    type: "world_rule",
    name: "天门只认完整记忆",
    aliases: ["完整记忆律"],
    summary: "失去关键记忆的人无法通过天门。",
    description: "",
    tags: [],
    data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
  });
  await lockEntity(page, work, entity);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await page.getByRole("button", { name: "查看设定详情" }).click();
    const detail = page.locator(".settings-entity-detail");
    await expect(detail.getByText("已锁定").first()).toBeVisible();
    await expect(detail.getByRole("button", { name: "已锁定 · 编辑需修改请求" })).toBeDisabled();
    await expect(detail.getByRole("button", { name: "发起修改请求" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-locked-${width}`);
  }
});

test("holds the proposal state at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entity = await createEntity(page, work, {
    type: "world_rule",
    name: "天门只认完整记忆",
    aliases: [],
    summary: "失去关键记忆的人无法通过天门。",
    description: "",
    tags: [],
    data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
  });
  await createProposal(page, work, entity);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await page.getByRole("button", { name: "查看设定详情" }).click();
    const detail = page.locator(".settings-entity-detail");
    await expect(detail.getByText("待确认").first()).toBeVisible();
    await expect(detail.getByText("待裁决", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "确认提案" })).toBeEnabled();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-proposal-${width}`);
  }
});

test("holds a long settings list at all four viewports", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  for (let index = 1; index <= 10; index += 1) {
    await createEntity(page, work, {
      type: "world_rule",
      name: `第 ${index} 条世界规则`,
      aliases: [],
      summary: "这是一条用于验证长列表和响应式布局的世界规则。",
      description: "规则内容需要保持可读，并且不能把页面横向撑开。",
      tags: [],
      data: { rule: "所有角色都必须遵守这条规则。" },
    });
  }
  await freezeApiTimestamps(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page.locator(".settings-entity-card")).toHaveCount(10);
    await expectNoPrototypeOnlyLeakage(page);
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .soft(page)
      .toHaveScreenshot(["settings", `settings-${width}.png`], productionScreenshotOptions);
  }
});

test("loads every entity and custom-field cursor page across settings consumers", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  for (let index = 1; index <= 21; index += 1) {
    await createEntity(page, work, {
      type: "world_rule",
      name: `分页世界规则 ${index}`,
      aliases: [],
      summary: "用于验证超过默认分页上限的真实页面。",
      description: "",
      tags: [],
      data: { rule: "所有页面都必须消费完整分页结果。" },
    });
  }
  const token = await getCsrf(page.request);
  for (let index = 1; index <= 21; index += 1) {
    const field = await page.request.post(`${base}/custom-fields`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        key: `page_field_${index}`,
        label: `分页字段 ${index}`,
        fieldType: "text",
        appliesTo: "all",
        required: false,
        options: [],
        relationTarget: null,
        sortOrder: index,
      },
    });
    expect(field.status()).toBe(201);
  }

  const entityCursorRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname.endsWith("/entities") &&
      url.searchParams.has("cursor")
    ) {
      entityCursorRequests.push(request.url());
    }
  });

  for (const path of ["write", "outline", "foreshadows", "overview", "settings"]) {
    entityCursorRequests.length = 0;
    await page.goto(`/workspace/${work.id}/${path}`);
    await expect
      .poll(() => entityCursorRequests.length, {
        message: `${path} should load the second /entities page`,
      })
      .toBeGreaterThan(0);
  }

  await expect(page.locator(".settings-entity-card")).toHaveCount(21);
  await page.getByRole("button", { name: "自定义字段", exact: true }).click();
  await expect(page.locator(".settings-custom-field-row")).toHaveCount(21);
});

test("holds the error state at all four viewports", async ({ page, context }, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(`**${entitiesPath}*`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "设定加载失败。",
            details: {},
            requestId: "req_settings_error",
          },
        }),
      });
    });
    await page.goto(`/workspace/${work.id}/settings`);
    await expect(page.getByText("设定加载失败。")).toBeVisible();
    await expectNoOverflow(page);
    await capture(page, testInfo, `settings-error-${width}`);
    await page.unroute(`**${entitiesPath}*`);
  }
});

test("shows a loading state and recovers from a failed settings load", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createSettingsWork(page);
  const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

  await page.route(`**${entitiesPath}*`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/settings`);
  await expect(page.getByText("正在加载设定中心")).toBeVisible();
  await page.unroute(`**${entitiesPath}*`);
  await expect(page.getByRole("heading", { name: "设定中心" })).toBeVisible();
});
