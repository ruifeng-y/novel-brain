import { createHash } from "node:crypto";

import { expect, type APIRequestContext } from "@playwright/test";

import { getCsrf } from "./auth";
import { createModelConfig, lockStoryBible } from "./m0";

const origin = "http://localhost:3000";

export interface M1Work {
  id: string;
  title: string;
  mainBranch: { id: string };
}

export interface M1Structure {
  branchPath: string;
  chapters: Array<{ id: string; content: string; versionId: string | null; number: number }>;
  generationChapterId: string;
  ledgerEntryId: string;
  volumeNodeId: string;
}

export async function seedM1Structure(
  request: APIRequestContext,
  work: M1Work,
  options: { skipBible?: boolean } = {},
): Promise<M1Structure> {
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  if (!options.skipBible) {
    await lockStoryBible(request, branchPath);
  }
  const settingRefs = await createSevenColumnSettings(request, branchPath, work.mainBranch.id);
  await createModelConfig(request);
  const volumeNodeId = await createFiveLevelOutline(request, branchPath);
  const chapters = await createM1Chapters(request, branchPath, work.mainBranch.id, settingRefs);
  await lockGoldenThree(request, branchPath, chapters.slice(0, 3));
  const ledgerEntryId = await createLedgerEntry(request, branchPath, chapters[0]!);
  await verifyChapter(request, branchPath, chapters[1]!);
  return {
    branchPath,
    chapters,
    generationChapterId: chapters[3]!.id,
    ledgerEntryId,
    volumeNodeId,
  };
}

async function createSevenColumnSettings(
  request: APIRequestContext,
  branchPath: string,
  branchId: string,
): Promise<{ characterId: string; mapNodeId: string }> {
  let characterId = "";
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
      tags: ["主角"],
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀。",
        relationshipSummary: "与顾青互相试探。",
      },
    },
    {
      type: "character",
      name: "罗刹长老",
      aliases: [],
      summary: "血河宗追杀沈砚的长老。",
      description: "",
      tags: ["反派"],
      data: {
        bodyState: "完好。",
        knowledgeBoundary: "不知道忘川书的真正来历。",
        relationshipSummary: "视沈砚为宗门叛徒。",
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
  ] as const;
  for (const entity of entities) {
    const token = await getCsrf(request);
    const created = await request.post(`${branchPath}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: entity,
    });
    if (created.status() !== 201) {
      throw new Error(`entity create failed: ${created.status()} ${await created.text()}`);
    }
    const data = (await created.json()).data;
    if (entity.type === "character" && entity.name === "沈砚") {
      characterId = data.id as string;
    }
    const lockToken = await getCsrf(request);
    const locked = await request.post(`${branchPath}/entities/${data.id}/lock`, {
      headers: { Origin: origin, "X-CSRF-Token": lockToken },
      data: { version: data.version },
    });
    expect(locked.status()).toBe(200);
  }

  const factionToken = await getCsrf(request);
  const faction = await request.post(`${branchPath}/world/factions`, {
    headers: { Origin: origin, "X-CSRF-Token": factionToken },
    data: {
      name: "血河宗",
      aliases: [],
      summary: "以血河秘术追杀叛徒的宗门。",
      description: "",
      tags: ["宗门"],
      profile: {
        overview: "盘踞北域血河。",
        goals: "夺回忘川书。",
        resources: "血河秘术与追兵。",
        doctrine: "叛徒必须带回宗内受审。",
      },
    },
  });
  expect(faction.status()).toBe(201);
  const mapToken = await getCsrf(request);
  const map = await request.post(`${branchPath}/world/maps`, {
    headers: { Origin: origin, "X-CSRF-Token": mapToken },
    data: {
      name: "北域山河",
      aliases: [],
      summary: "沈砚逃亡经过的地图。",
      description: "",
      tags: ["地图"],
      details: "荒寺在山道北侧，血河城在南侧。",
    },
  });
  expect(map.status()).toBe(201);
  const mapId = (await map.json()).data.map.id as string;
  const nodeToken = await getCsrf(request);
  const node = await request.post(`${branchPath}/world/maps/${mapId}/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": nodeToken },
    data: {
      layerId: null,
      parentNodeId: null,
      name: "血河城",
      nodeType: "settlement",
      summary: "血河宗控制的城市。",
      x: null,
      y: null,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    },
  });
  expect(node.status()).toBe(201);
  const mapNodeId = (await node.json()).data.id as string;
  const powerToken = await getCsrf(request);
  const power = await request.post(`${branchPath}/world/power-systems`, {
    headers: { Origin: origin, "X-CSRF-Token": powerToken },
    data: {
      name: "大玄修炼体系",
      aliases: [],
      summary: "炼气、筑基、金丹、元婴、化神五境。",
      description: "",
      tags: ["力量体系"],
      overview: "越级突破需要付出寿元与记忆。",
      lifespanPolicy: {
        mode: "realm",
        unit: "年",
        basis: "境界",
        description: "境界越高寿元越长。",
        pathId: null,
        fixedAmount: null,
      },
      paths: [
        {
          name: "玄门正道",
          pathType: "orthodox",
          description: "以静心凝气为根基。",
          sortOrder: 0,
          realms: [
            realm("炼气", 1, ""),
            realm("筑基", 2, "炼气"),
            realm("金丹", 3, "筑基"),
            realm("元婴", 4, "金丹"),
            realm("化神", 5, "元婴"),
          ],
        },
      ],
    },
  });
  expect(power.status()).toBe(201);
  const itemToken = await getCsrf(request);
  const item = await request.post(`${branchPath}/world/items`, {
    headers: { Origin: origin, "X-CSRF-Token": itemToken },
    data: {
      name: "听潮剑",
      aliases: ["潮生"],
      summary: "会记录持剑者杀意的法器。",
      description: "",
      tags: ["法器"],
      kind: "equipment",
      category: "兵器",
      grade: "玄阶",
      effect: "剑身会记录持剑者的杀意。",
      cost: "杀意过重时会反噬持剑者。",
      limits: "不能离开主人超过七日。",
      ownershipModel: "unique",
      consumable: false,
      quantity: 1,
      equipmentSlot: "main_hand",
    },
  });
  expect(item.status()).toBe(201);
  const eraToken = await getCsrf(request);
  const era = await request.post(`${branchPath}/world/timeline/eras`, {
    headers: { Origin: origin, "X-CSRF-Token": eraToken },
    data: {
      name: "大玄历",
      orderIndex: 1,
      startSortKey: 0,
      endSortKey: null,
      description: "大玄王朝纪年。",
    },
  });
  expect(era.status()).toBe(201);
  const eventToken = await getCsrf(request);
  const event = await request.post(`${branchPath}/world/timeline/events`, {
    headers: { Origin: origin, "X-CSRF-Token": eventToken },
    data: {
      name: "天门洞开",
      aliases: [],
      summary: "第一卷末的天门开启事件。",
      description: "",
      tags: [],
      era: "大玄历",
      storyTime: { era: "大玄历", label: "卷一末", sortKey: 900 },
      durationMinutes: 60,
      durationLabel: "一个时辰",
      event: "天门洞开",
      validity: { fromChapter: 4, toChapter: null, fromStoryTime: null, toStoryTime: null },
    },
  });
  expect(event.status()).toBe(201);
  expect(branchId).toBeTruthy();
  return { characterId, mapNodeId };
}

async function createFiveLevelOutline(
  request: APIRequestContext,
  branchPath: string,
): Promise<string> {
  const token = await getCsrf(request);
  const book = await request.post(`${branchPath}/outline/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { level: "book", parentId: null, title: "忘川书", summary: "全书总纲。" },
  });
  expect(book.status()).toBe(201);
  const bookId = (await book.json()).data.node.id as string;
  const volume = await request.post(`${branchPath}/outline/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      level: "volume",
      parentId: bookId,
      title: "第一卷 · 忘川",
      summary: "沈砚从杂役到踏入仙途的第一卷。",
    },
  });
  expect(volume.status()).toBe(201);
  const volumeId = (await volume.json()).data.node.id as string;
  const contract = await request.put(`${branchPath}/outline/nodes/${volumeId}/volume-contract`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      objective: "让沈砚在追杀中活下来并发现忘川书的代价。",
      conflict: "血河宗追杀与天门记忆规则。",
      turningPoints: ["断臂结印", "记忆代价", "天门开启"],
      exitConditions: ["沈砚进入天门", "父母之死线索浮出"],
      plotLines: [{ name: "父母之死", status: "active", note: "卷末仍未回收。" }],
    },
  });
  expect(contract.status()).toBe(200);
  const act = await request.post(`${branchPath}/outline/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      level: "act",
      parentId: volumeId,
      sortOrder: 1,
      title: "第一幕 · 断臂",
      summary: "沈砚在追杀中被迫使用忘川书。",
    },
  });
  expect(act.status()).toBe(201);
  return volumeId;
}

async function createM1Chapters(
  request: APIRequestContext,
  branchPath: string,
  branchId: string,
  refs: { characterId: string; mapNodeId: string },
): Promise<Array<{ id: string; content: string; versionId: string | null; number: number }>> {
  const token = await getCsrf(request);
  const outline = await request.get(`${branchPath}/outline`);
  expect(outline.status()).toBe(200);
  const act = (await outline.json()).data.nodes.find(
    (node: { level: string }) => node.level === "act",
  );
  const chapters: Array<{
    id: string;
    content: string;
    versionId: string | null;
    number: number;
  }> = [];
  let lastChapterNodeId = "";
  for (let number = 1; number <= 4; number += 1) {
    const content = chapterContent(number);
    const created = await request.post(`${branchPath}/outline/nodes`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        level: "chapter",
        parentId: act.id,
        sortOrder: number,
        title: `第 ${number} 章 ${chapterTitle(number)}`,
        chapterCreate: {
          number,
          title: chapterTitle(number),
          brief: chapterBrief(number),
        },
      },
    });
    expect(created.status()).toBe(201);
    const createdNode = (await created.json()).data.node as {
      id: string;
      chapter: { id: string };
    };
    const chapterId = createdNode.chapter.id;
    lastChapterNodeId = createdNode.id;
    if (number <= 3) {
      const version = await request.post(`${branchPath}/chapters/${chapterId}/versions`, {
        headers: { Origin: origin, "X-CSRF-Token": token },
        data: { version: 1, content },
      });
      expect(version.status()).toBe(201);
      const saved = (await version.json()).data.version.id as string;
      chapters.push({ id: chapterId, content, versionId: saved, number });
    } else {
      chapters.push({ id: chapterId, content, versionId: null, number });
    }
  }
  const scene = await request.post(`${branchPath}/outline/nodes`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      level: "scene",
      parentId: lastChapterNodeId,
      sortOrder: 1,
      sceneCard: {
        title: "天门前的告别",
        pov: {
          type: "character",
          id: refs.characterId,
          branchId,
          label: "沈砚",
          version: null,
        },
        location: {
          type: "map_node",
          id: refs.mapNodeId,
          branchId,
          label: "血河城",
          version: null,
        },
        storyTime: { era: "大玄历", label: "第一卷第四日", sortKey: 400 },
        beats: [{ description: "沈砚在门前停步。" }, { description: "顾青留下铜牌。" }],
        informationReleases: [{ description: "父母之死仍未揭晓。", constraint: null }],
        tension: 70,
      },
    },
  });
  if (scene.status() !== 201) {
    throw new Error(`scene create failed: ${scene.status()} ${await scene.text()}`);
  }
  return chapters;
}

async function lockGoldenThree(
  request: APIRequestContext,
  branchPath: string,
  chapters: Array<{ id: string; content: string; versionId: string | null }>,
): Promise<void> {
  const token = await getCsrf(request);
  const pins = [
    {
      chapterId: chapters[0]!.id,
      chapterVersionId: chapters[0]!.versionId!,
      expectedContentHash: createHash("sha256").update(chapters[0]!.content).digest("hex"),
    },
  ];
  const candidate = (index: number) => ({
    label: index === 0 ? "候选 A · 钩子优先" : "候选 B · 人物优先",
    strategy: index === 0 ? "hook_focus" : "character_focus",
    prompt: {
      key: "golden-three-opening",
      version: 3,
      hash: (index === 0 ? "a" : "c").repeat(64),
    },
    model: {
      provider: "deepseek",
      model: "deepseek-chat",
      parameters: { temperature: index === 0 ? 0.7 : 0.6 },
    },
    context: {
      packVersionId: null,
      manifestHash: (index === 0 ? "b" : "d").repeat(64),
    },
    pins,
  });
  const batch = await request.post(`${branchPath}/golden-three/candidates`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": "m1-closeout-golden-three",
    },
    data: { candidates: [candidate(0), candidate(1)] },
  });
  expect(batch.status()).toBe(201);
  const selected = (await batch.json()).data.candidates[0] as {
    id: string;
    version: number;
    pins: Array<{ chapterId: string; chapterVersionId: string; content: string }>;
  };
  const dimensions = [
    "opening_hook",
    "protagonist_appeal",
    "world_rules",
    "core_conflict",
    "reader_promise",
    "chapter_end_hook",
  ];
  const review = await request.put(`${branchPath}/golden-three/candidates/${selected.id}/reviews`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      version: selected.version,
      reviews: dimensions.map((dimension, index) => {
        const pin = selected.pins[index % selected.pins.length]!;
        return {
          dimension,
          score: 4,
          evidence: {
            chapterId: pin.chapterId,
            chapterVersionId: pin.chapterVersionId,
            passage: pin.content.slice(0, 200),
            locator: `第 ${index + 1} 章 · 首句`,
          },
          reviewerOrigin: "critic",
        };
      }),
    },
  });
  expect(review.status()).toBe(200);
  const selection = await request.post(
    `${branchPath}/golden-three/candidates/${selected.id}/select`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: selected.version + 1 },
    },
  );
  expect(selection.status()).toBe(200);
  const continuation = await request.post(
    `${branchPath}/golden-three/candidates/${selected.id}/continuation`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: selected.version + 2 },
    },
  );
  expect(continuation.status()).toBe(200);
  const lock = await request.post(`${branchPath}/golden-three/candidates/${selected.id}/lock`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: selected.version + 3 },
  });
  expect(lock.status()).toBe(200);
}

async function createLedgerEntry(
  request: APIRequestContext,
  branchPath: string,
  chapter: { id: string },
): Promise<string> {
  const token = await getCsrf(request);
  const created = await request.post(`${branchPath}/ledger/entries`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      kind: "foreshadow",
      title: "父母之死",
      summary: "沈砚以为父母是自杀。",
      responsibleRole: "protagonist",
      status: "planned",
      targetWindow: { fromChapter: 1, toChapter: 2 },
      importance: "must",
      readerPromise: "身世谜团",
      reason: "开篇埋下身世线索。",
    },
  });
  expect(created.status()).toBe(201);
  const entry = (await created.json()).data.entry as { id: string; version: number };
  const transition = await request.post(`${branchPath}/ledger/entries/${entry.id}/transitions`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      version: entry.version,
      action: "setup",
      chapterId: chapter.id,
      reason: "在第 1 章旧宅里埋下。",
      evidence: [
        {
          kind: "chapter",
          sourceId: chapter.id,
          label: "第 1 章",
          quote: "沈砚把父母的旧信压在箱底。",
          locator: "第 1 章 · 第 1 段",
          strength: "strong",
        },
      ],
    },
  });
  expect(transition.status()).toBe(200);
  return entry.id;
}

async function verifyChapter(
  request: APIRequestContext,
  branchPath: string,
  chapter: { id: string; versionId: string | null },
): Promise<void> {
  const token = await getCsrf(request);
  const response = await request.post(`${branchPath}/chapters/${chapter.id}/verify`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { chapterVersionId: chapter.versionId },
  });
  expect(response.status()).toBe(200);
}

function realm(name: string, rank: number, prerequisiteName: string) {
  return {
    name,
    rank,
    description: `${name}境界。`,
    breakthroughConditions: prerequisiteName
      ? `从${prerequisiteName}突破，需要宗门试炼与完整记忆。`
      : "引气入体。",
    breakthroughCosts: rank >= 3 ? "消耗一段重要记忆。" : "",
    bottlenecks: "",
    counters: "",
    counteredBy: "",
    lifespanAmount: rank * 50,
    prerequisiteRealmId: null,
  };
}

function chapterTitle(number: number): string {
  return ["断碑夜雨", "一只手也能结印", "铜牌背面", "天门之前"][number - 1] ?? `忘川 ${number}`;
}

function chapterBrief(number: number) {
  return {
    goal:
      number === 2
        ? "让沈砚在断臂后护住顾青，找到新的战斗方式。"
        : `推进第 ${number} 章的忘川书主线。`,
    pov: "沈砚",
    location: "荒寺外山道",
    sceneBeats: ["沈砚藏起断臂。", "追兵逼近，两人继续上路。"],
    requiredFacts: ["左臂骨折，不能双手结印"],
  };
}

function chapterContent(number: number): string {
  if (number === 1) {
    return "沈砚把父母的旧信压在箱底。\n\n风从荒寺的瓦上压下来，顾青在门外等他。";
  }
  if (number === 2) {
    return "沈砚握紧断刀，听见追兵踏碎山道上的积水。\n\n沈砚收起断刀，转身离开，不再战斗。";
  }
  if (number === 3) {
    return "铜牌背面刻着沈砚自己的名字。\n\n顾青看见书页一角，却没有点破。";
  }
  return "";
}
