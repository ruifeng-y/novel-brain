import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  goldenThreeWorkspaceResponseSchema,
  outlineNodeMutationResponseSchema,
  outlineWorkspaceSchema,
  outlineWorkspaceResponseSchema,
  storyLedgerEntryCreateRequestSchema,
  storyLedgerMutationResponseSchema,
  storyLedgerWorkspaceResponseSchema,
} from "@novel-brain/contracts";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { seedGoldenThree } from "../helpers/golden-three";
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
  const email = uniqueEmail("outline");
  const session = await registerUser(page.request, email, "StrongPassword123", "大纲作者");
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

async function createOutlineWork(page: Page) {
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

async function createNode(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
  body: Record<string, unknown>,
) {
  const response = await page.request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: body,
    },
  );
  expect(response.status()).toBe(201);
  return outlineNodeMutationResponseSchema.parse(await response.json()).data.node;
}

async function createEntity(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
  body: Record<string, unknown>,
) {
  const response = await page.request.post(`${branchPath(work)}/entities`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: body,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; name: string };
}

async function putVolumeContract(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
  volumeId: string,
) {
  const response = await page.request.put(
    `${branchPath(work)}/outline/nodes/${volumeId}/volume-contract`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        objective: "沈砚第一次真正面对血河宗，左臂受伤，忘川书暴露。",
        conflict: "血河宗追捕与左臂重伤同时逼近。",
        turningPoints: ["断臂", "忘川书显形"],
        exitConditions: ["离开南境", "顾青立场动摇"],
        plotLines: [{ name: "天门将开", status: "active", note: "主线" }],
      },
    },
  );
  expect(response.status()).toBe(200);
}

async function putSceneCard(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
  sceneId: string,
  characterId: string,
  mapId: string,
  withInformationRelease: boolean,
) {
  const response = await page.request.put(
    `${branchPath(work)}/outline/nodes/${sceneId}/scene-card`,
    {
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
        informationReleases: withInformationRelease
          ? [{ description: "顾青看见书页一角", constraint: "顾青不能知道完整来历" }]
          : [],
        tension: 72,
      },
    },
  );
  expect(response.status()).toBe(200);
}

async function setupCompleteOutline(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
  options: {
    bookId?: string;
    deferContractsAndScene?: boolean;
    withInformationRelease?: boolean;
  } = {},
) {
  const book =
    options.bookId !== undefined
      ? { id: options.bookId }
      : await createNode(page, work, token, {
          level: "book",
          parentId: null,
          title: "忘川书",
        });
  const volume = await createNode(page, work, token, {
    level: "volume",
    parentId: book.id,
    title: "第一卷 · 少年出山",
  });
  const act = await createNode(page, work, token, {
    level: "act",
    parentId: volume.id,
    title: "第三幕 · 断臂",
  });
  const chapter = await createNode(page, work, token, {
    level: "chapter",
    parentId: act.id,
    tension: 72,
    chapterCreate: {
      number: 48,
      title: "一只手也能结印",
      brief: completeBrief(),
    },
  });
  const scene = await createNode(page, work, token, {
    level: "scene",
    parentId: chapter.id,
    title: "藏起断臂",
  });
  const character = await createEntity(page, work, token, {
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
  });
  const map = await createEntity(page, work, token, {
    type: "map",
    name: "荒寺外山道",
    aliases: [],
    summary: "荒寺外的山道。",
    description: "",
    tags: [],
    data: { details: "荒寺外山道" },
  });
  if (!options.deferContractsAndScene) {
    await putVolumeContract(page, work, token, volume.id);
    await putSceneCard(
      page,
      work,
      token,
      scene.id,
      character.id,
      map.id,
      options.withInformationRelease ?? true,
    );
  }
  return { book, volume, act, chapter, scene, character, map };
}

async function getOutlineWorkspace(page: Page, work: { id: string; mainBranch: { id: string } }) {
  const response = await page.request.get(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline`,
  );
  expect(response.status()).toBe(200);
  return outlineWorkspaceResponseSchema.parse(await response.json()).data;
}

async function createLedgerEntry(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
  title: string,
) {
  const payload = storyLedgerEntryCreateRequestSchema.parse({
    kind: "foreshadow",
    title,
    summary: "用于验证大纲账本视图读取持久化记录。",
    responsibleRole: "protagonist",
    status: "planned",
    targetWindow: { fromChapter: 1, toChapter: 3 },
    importance: "must",
    readerPromise: "身世谜团",
    reason: "大纲页需要展示剧情账本。",
  });
  const response = await page.request.post(`${branchPath(work)}/ledger/entries`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: payload,
  });
  expect(response.status()).toBe(201);
  return storyLedgerMutationResponseSchema.parse(await response.json()).data.entry;
}

async function setupTwoActOutline(
  page: Page,
  work: { id: string; mainBranch: { id: string } },
  token: string,
) {
  const book = await createNode(page, work, token, {
    level: "book",
    parentId: null,
    title: "忘川书",
  });
  const volume = await createNode(page, work, token, {
    level: "volume",
    parentId: book.id,
    title: "第一卷 · 少年出山",
  });
  const actOne = await createNode(page, work, token, {
    level: "act",
    parentId: volume.id,
    title: "第一幕 · 夜雨",
  });
  const actTwo = await createNode(page, work, token, {
    level: "act",
    parentId: volume.id,
    title: "第二幕 · 断臂",
  });
  const chapterOne = await createNode(page, work, token, {
    level: "chapter",
    parentId: actOne.id,
    tension: 46,
    chapterCreate: { number: 1, title: "断碑夜雨", brief: completeBrief() },
  });
  const chapterTwo = await createNode(page, work, token, {
    level: "chapter",
    parentId: actTwo.id,
    tension: 82,
    chapterCreate: { number: 2, title: "铜牌背面", brief: completeBrief() },
  });
  const scene = await createNode(page, work, token, {
    level: "scene",
    parentId: chapterOne.id,
    title: "藏起断臂",
  });
  return { book, volume, actOne, actTwo, chapterOne, chapterTwo, scene };
}

function completeBrief() {
  return {
    goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
    pov: "沈砚",
    location: "荒寺外山道",
    sceneBeats: [
      "沈砚藏起断臂，被顾青撞见。",
      "血河宗追兵逼近，两人被迫联手。",
      "沈砚单手结印，忘川书短暂显形。",
      "顾青看见书页一角，但没有点破。",
    ],
    requiredFacts: ["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"],
  };
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

test("creates and edits outline nodes through production forms", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  const outlineNodesApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes`;
  const outlineApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline`;

  await page.goto(`/workspace/${work.id}/outline`);
  await page.getByRole("textbox", { name: "全书标题" }).fill("忘川书");
  const createResponse = waitForApiResponse(page, "POST", outlineNodesApi);
  await page.getByRole("button", { name: "创建全书大纲" }).click();
  const created = outlineNodeMutationResponseSchema.parse(await (await createResponse).json()).data
    .node;
  const persistedResponse = await page.request.get(outlineApi);
  expect(persistedResponse.status()).toBe(200);
  const persisted = outlineWorkspaceResponseSchema.parse(await persistedResponse.json()).data;
  expect(persisted.nodes[0]?.id).toBe(created.id);

  await page.locator(`[data-outline-node-id="${created.id}"]`).click();
  const editor = page.locator("form.outline-plan-form").filter({ hasText: "节点信息" });
  await editor.getByLabel("摘要").fill("从生产节点表单保存的全书摘要。");
  const editApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes/${created.id}`;
  const editResponse = waitForApiResponse(page, "PATCH", editApi);
  await editor.getByRole("button", { name: "保存节点" }).click();
  expect((await editResponse).status()).toBe(200);
  const persistedEditResponse = await page.request.get(outlineApi);
  expect(persistedEditResponse.status()).toBe(200);
  const persistedEdit = outlineWorkspaceResponseSchema.parse(
    await persistedEditResponse.json(),
  ).data;
  const persistedSummary = persistedEdit.nodes[0]?.summary;
  expect(persistedSummary).toBe("从生产节点表单保存的全书摘要。");
});

test("renders empty, tree, board and tension states at four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  let releaseOutline: () => void = () => undefined;
  const outlineGate = new Promise<void>((resolve) => {
    releaseOutline = resolve;
  });
  await page.route(`**${branchPath(work)}/outline`, async (route) => {
    await outlineGate;
    await route.continue();
  });
  await page.goto(`/workspace/${work.id}/outline`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在加载大纲工作台")).toBeVisible();
  releaseOutline();
  await expect(page.getByRole("heading", { name: "还没有全书大纲" })).toBeVisible();
  await page.unroute(`**${branchPath(work)}/outline`);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await expect(page.getByRole("heading", { name: "大纲工作台" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "还没有全书大纲" })).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`outline-empty-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${work.id}/outline`);
  await page.getByRole("textbox", { name: "全书标题" }).fill("忘川书");
  const created = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${branchPath(work)}/outline/nodes` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建全书大纲" }).click();
  const book = (await (await created).json()).data.node as { id: string };
  await expect(page.locator(`[data-outline-node-id="${book.id}"]`)).toBeVisible();
  const persistedBook = await getOutlineWorkspace(page, work);
  expect(persistedBook.nodes[0]?.id).toBe(book.id);

  const token = await getCsrf(page.request);
  const fixture = await setupCompleteOutline(page, work, token, { bookId: book.id });
  const persistedFixture = await getOutlineWorkspace(page, work);
  const persistedTension = persistedFixture.nodes.find(
    (node) => node.id === fixture.chapter.id,
  )?.tension;
  expect(persistedTension).toBe(72);
  await freezeApiTimestamps(page);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/outline$`, "u"));
    await expect(page.locator(`[data-outline-node-id="${fixture.book.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-outline-node-id="${fixture.volume.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-outline-node-id="${fixture.act.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-outline-node-id="${fixture.chapter.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-outline-node-id="${fixture.scene.id}"]`)).toBeVisible();

    await page.locator(`[data-outline-node-id="${fixture.volume.id}"]`).click();
    await expect(page.getByRole("heading", { name: "本卷的目标和退出条件" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "卷目标" })).toHaveValue(
      "沈砚第一次真正面对血河宗，左臂受伤，忘川书暴露。",
    );

    await page.locator(`[data-outline-node-id="${fixture.chapter.id}"]`).click();
    await expect(page.getByRole("heading", { name: "这一章要完成什么" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "章节标题" })).toHaveValue("一只手也能结印");
    const chapterTensionForm = page
      .locator("form.outline-plan-form")
      .filter({ hasText: "章节规划强度" });
    await expect(chapterTensionForm.getByLabel("规划张力（0–100）")).toBeVisible();
    await expect(
      chapterTensionForm.getByText(
        "章节正文状态由写作台管理；规划张力用于观察节奏起伏，不是质量评分。",
      ),
    ).toBeVisible();

    await page.locator(`[data-outline-node-id="${fixture.scene.id}"]`).click();
    await expect(page.getByRole("heading", { name: "POV、地点、时间和信息释放" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "视角人物" })).toHaveValue(
      fixture.character.id,
    );
    const sceneTensionForm = page
      .locator("form.outline-plan-form")
      .filter({ hasText: "POV、地点、时间和信息释放" });
    await expect(sceneTensionForm.getByLabel("规划张力（0–100）")).toBeVisible();
    await expect(
      sceneTensionForm.getByText(
        "规划张力用于观察节奏起伏，不是质量评分；场景卡保存后会进入准备度检查。",
      ),
    ).toBeVisible();

    await page.getByRole("tab", { name: "章节看板" }).click();
    await expect(page.getByRole("button", { name: /第 48 章/ })).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);

    await page.getByRole("tab", { name: "张力曲线" }).click();
    await expect(page.getByRole("img", { name: "章节张力曲线" })).toBeVisible();
    await expect(page.getByText("张力 72")).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);

    await page.getByRole("tab", { name: "树状大纲" }).click();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .soft(page)
      .toHaveScreenshot(["outline", `outline-${width}.png`], productionScreenshotOptions);
  }
});

test("persists volume contracts and scene cards through production forms", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  const token = await getCsrf(page.request);
  const fixture = await setupCompleteOutline(page, work, token, {
    deferContractsAndScene: true,
  });
  const volumeContractApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes/${fixture.volume.id}/volume-contract`;
  const sceneCardApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes/${fixture.scene.id}/scene-card`;

  await page.goto(`/workspace/${work.id}/outline`);
  await page.locator(`[data-outline-node-id="${fixture.volume.id}"]`).click();
  const volumeForm = page.locator("form.outline-plan-form").filter({ hasText: "卷契约" });
  await volumeForm.getByLabel("卷目标").fill("守住忘川渡并揭开第一卷旧案。");
  await volumeForm.getByLabel("核心冲突").fill("宗门追捕与同伴信任同时崩塌。");
  await volumeForm.getByLabel("关键转折（一行一个）").fill("断臂\n铜牌显形");
  await volumeForm.getByLabel("退出条件（一行一个）").fill("离开东境\n顾青立场动摇");
  await volumeForm.getByLabel("相关剧情线（名称｜状态｜备注）").fill("天门将开｜active｜主线");
  const volumeResponse = waitForApiResponse(page, "PUT", volumeContractApi);
  await volumeForm.getByRole("button", { name: "保存卷契约" }).click();
  const savedVolume = outlineWorkspaceSchema.parse(
    (await (await volumeResponse).json()).data.workspace,
  );
  expect(savedVolume.volumeContracts[0]?.objective).toBe("守住忘川渡并揭开第一卷旧案。");

  await page.locator(`[data-outline-node-id="${fixture.scene.id}"]`).click();
  const sceneForm = page
    .locator("form.outline-plan-form")
    .filter({ hasText: "POV、地点、时间和信息释放" });
  await sceneForm.getByLabel("场景标题").fill("荒寺外山道");
  await sceneForm.getByLabel("视角人物").selectOption(fixture.character.id);
  await sceneForm.getByLabel("地点").selectOption(fixture.map.id);
  await sceneForm.getByLabel("故事纪元").fill("大玄历");
  await sceneForm.getByLabel("故事时间").fill("雨夜");
  await sceneForm.getByLabel("时间排序值").fill("100");
  await sceneForm.getByLabel("场景节拍（一行一个）").fill("沈砚藏起断臂。\n顾青撞见。");
  await sceneForm
    .getByLabel("信息释放（一行一个，可用“｜”补充知情边界）")
    .fill("顾青看见书页一角｜顾青不能知道完整来历");
  await sceneForm.getByLabel("规划张力（0–100）").fill("72");
  const sceneResponse = waitForApiResponse(page, "PUT", sceneCardApi);
  await sceneForm.getByRole("button", { name: "保存场景卡" }).click();
  const savedScene = outlineWorkspaceSchema.parse(
    (await (await sceneResponse).json()).data.workspace,
  );
  expect(savedScene.sceneCards[0]?.informationReleases[0]?.description).toBe("顾青看见书页一角");

  const persistedResponse = await page.request.get(`${branchPath(work)}/outline`);
  expect(persistedResponse.status()).toBe(200);
  const persisted = outlineWorkspaceResponseSchema.parse(await persistedResponse.json()).data;
  const persistedVolumeObjective = persisted.volumeContracts[0]?.objective;
  const persistedScenePov = persisted.sceneCards[0]?.pov?.id;
  expect(persistedVolumeObjective).toBe("守住忘川渡并揭开第一卷旧案。");
  expect(persistedScenePov).toBe(fixture.character.id);
});

test("renders the persisted story ledger from the outline workspace", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  const token = await getCsrf(page.request);
  const entry = await createLedgerEntry(page, work, token, "旧信里的身世线索");
  const ledgerApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/ledger`;
  const ledgerResponse = waitForApiResponse(page, "GET", ledgerApi);

  await page.goto(`/workspace/${work.id}/outline`);
  const ledger = storyLedgerWorkspaceResponseSchema.parse(await (await ledgerResponse).json()).data;
  expect(ledger.entries[0]?.id).toBe(entry.id);
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await page.getByRole("tab", { name: "剧情账本" }).click();
    await expect(page.locator("[data-outline-ledger]")).toContainText("旧信里的身世线索");
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    await expectNoOverflow(page);
  }
});

test("selects a golden-three direction from the outline page", async ({ page, context }) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  const token = await getCsrf(page.request);
  const fixture = await seedGoldenThree(page, token, work);
  const selectApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/golden-three/candidates/${fixture.candidateB.id}/select`;

  await page.goto(`/workspace/${work.id}/outline`);
  const candidateCard = page.locator(`[data-golden-candidate-id="${fixture.candidateB.id}"]`);
  await expect(candidateCard).toBeVisible();
  const selectResponse = waitForApiResponse(page, "POST", selectApi);
  await candidateCard.getByRole("button", { name: "选定这个方向" }).click();
  expect((await selectResponse).status()).toBe(200);
  await expect(candidateCard.getByText("已选定")).toBeVisible();

  const persistedResponse = await page.request.get(`${branchPath(work)}/golden-three`);
  expect(persistedResponse.status()).toBe(200);
  const persisted = goldenThreeWorkspaceResponseSchema.parse(await persistedResponse.json()).data;
  expect(persisted.selectedCandidateId).toBe(fixture.candidateB.id);
  await expectNoPrototypeOnlyLeakage(page);
  await expectAuthorFacingLanguage(page);
  await expectNoOverflow(page);
});

test("drags to reorder and locks/unlocks a node with persisted state", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  const token = await getCsrf(page.request);
  const fixture = await setupTwoActOutline(page, work, token);
  const moveApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes/${fixture.actTwo.id}/move`;
  const lockApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes/${fixture.actTwo.id}/lock`;
  const unlockApi = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/nodes/${fixture.actTwo.id}/unlock`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${work.id}/outline`);
  const actOneItem = page.locator(`[data-outline-node-id="${fixture.actOne.id}"]`);
  const actTwoItem = page.locator(`[data-outline-node-id="${fixture.actTwo.id}"]`);
  await expect(actOneItem).toBeVisible();
  await expect(actTwoItem).toBeVisible();

  const moved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === moveApi && response.request().method() === "POST",
  );
  await actTwoItem.dragTo(actOneItem);
  expect((await moved).status()).toBe(200);

  const workspaceResponse = await page.request.get(`${branchPath(work)}/outline`);
  const outline = (await workspaceResponse.json()).data as {
    nodes: Array<{ id: string; parentId: string | null; sortOrder: number }>;
  };
  const volumeChildren = outline.nodes
    .filter((node) => node.parentId === fixture.volume.id)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((node) => node.id);
  expect(volumeChildren).toEqual([fixture.actTwo.id, fixture.actOne.id]);

  await actTwoItem.click();
  const lockedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === lockApi && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  expect((await lockedResponse).status()).toBe(200);
  await expect(page.locator(".outline-plan-detail-badges").getByText("已锁定")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存节点" })).toBeDisabled();
  const persistedLock = await getOutlineWorkspace(page, work);
  const persistedLocked = persistedLock.nodes.find((node) => node.id === fixture.actTwo.id)?.locked;
  expect(persistedLocked).toBe(true);

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await actTwoItem.click();
    await expect(page.locator(".outline-plan-detail-badges").getByText("已锁定")).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`outline-locked-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  const unlockedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === unlockApi && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  expect((await unlockedResponse).status()).toBe(200);
  await expect(page.locator(".outline-plan-detail-badges").getByText("可编辑")).toBeVisible();
  await expectAuthorFacingLanguage(page);
});

test("renders partial readiness and long outlines at four viewports without overflow", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  const token = await getCsrf(page.request);
  const fixture = await setupCompleteOutline(page, work, token, {
    withInformationRelease: false,
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await expect(page.locator(`[data-outline-node-id="${fixture.scene.id}"]`)).toBeVisible();
    await expect(page.getByText("部分就绪").first()).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`outline-partial-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  const longWork = await createOutlineWork(page);
  const longToken = await getCsrf(page.request);
  const book = await createNode(page, longWork, longToken, {
    level: "book",
    parentId: null,
    title: "忘川书",
  });
  const volume = await createNode(page, longWork, longToken, {
    level: "volume",
    parentId: book.id,
    title: "第一卷 · 少年出山",
  });
  const act = await createNode(page, longWork, longToken, {
    level: "act",
    parentId: volume.id,
    title: "第三幕 · 断臂",
  });
  for (let index = 1; index <= 10; index += 1) {
    await createNode(page, longWork, longToken, {
      level: "chapter",
      parentId: act.id,
      tension: 40 + index * 5,
      chapterCreate: {
        number: index,
        title: `第 ${index} 章 · ${"忘川书页里反复出现的名字与断臂之后仍未说完的旧事".repeat(2)}`,
        brief: completeBrief(),
      },
    });
  }

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${longWork.id}/outline`);
    await expect(page.locator("[data-outline-node-id]")).toHaveCount(13);
    await expectNoOverflow(page);
    await testInfo.attach(`outline-long-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("renders error state at four viewports", async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);
  await page.route(`**${branchPath(work)}/outline`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "大纲加载失败。",
          details: {},
          requestId: "req_outline_error",
        },
      }),
    });
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await expect(page.getByText("大纲加载失败。")).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`outline-error-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});
