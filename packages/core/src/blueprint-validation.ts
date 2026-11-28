import { randomBytes } from "node:crypto";

import {
  blueprintConflictSchema,
  blueprintCoreSettingDraftSchema,
  blueprintMissingFieldSchema,
  blueprintOutlineDraftSchema,
  blueprintStoryBibleDraftSchema,
  genrePackGenerationGuidanceSchema,
  type BlueprintConflict,
  type BlueprintCoreSettingDraft,
  type BlueprintMissingField,
  type BlueprintOutlineDraft,
  type BlueprintStoryBibleDraft,
} from "@novel-brain/contracts";

import { BLUEPRINT_SCALE_PLAN } from "./blueprint";

const BLUEPRINT_ACTS_PER_VOLUME = 3;

export function validateBlueprintCandidates(input: {
  storyBible: BlueprintStoryBibleDraft;
  coreSettings: BlueprintCoreSettingDraft[];
  outline: BlueprintOutlineDraft;
  generationGuidance: Record<string, unknown>;
  genrePackFields: Record<string, unknown>;
  optionalGenrePackFields?: Record<string, unknown>;
  genre: string;
  scaleTarget: string;
}): { missingFields: BlueprintMissingField[]; conflicts: BlueprintConflict[] } {
  const storyBible = blueprintStoryBibleDraftSchema.parse(input.storyBible);
  const coreSettings = blueprintCoreSettingDraftSchema.array().parse(input.coreSettings);
  const outline = blueprintOutlineDraftSchema.parse(input.outline);
  const missingFields: BlueprintMissingField[] = [];
  const conflicts: BlueprintConflict[] = [];
  if (storyBible.cards.some((card) => !card.complete || card.content.trim().length === 0)) {
    conflicts.push(structureConflict("九卡故事圣经必须全部完成且内容非空"));
  }
  const requiredTypes: BlueprintCoreSettingDraft["type"][] = [
    "world_rule",
    "character",
    "faction",
    "map",
    "power_system",
    "item",
    "timeline_event",
    ...(input.genre === "xianxia" ? (["golden_finger"] as const) : []),
  ];
  const types = new Set(coreSettings.map((setting) => setting.type));
  const typeCounts = new Map<string, number>();
  for (const setting of coreSettings) {
    typeCounts.set(setting.type, (typeCounts.get(setting.type) ?? 0) + 1);
  }
  for (const type of requiredTypes) {
    if (!types.has(type)) {
      missingFields.push(
        blueprintMissingFieldSchema.parse({
          key: `core_setting:${type}`,
          label: type,
          required: true,
          severity: "P0",
          message: `核心设定缺少 ${type}`,
        }),
      );
    }
  }
  if ((typeCounts.get("world_rule") ?? 0) < 3) {
    conflicts.push(structureConflict("核心设定至少需要三条世界规则"));
  }
  const worldRuleNames = coreSettings
    .filter((setting) => setting.type === "world_rule")
    .map((setting) => setting.name.trim());
  if (new Set(worldRuleNames).size !== worldRuleNames.length) {
    conflicts.push(structureConflict("世界规则名称必须唯一"));
  }
  const itemCount = typeCounts.get("item") ?? 0;
  if (itemCount < 1 || itemCount > 3) {
    conflicts.push(structureConflict("核心设定需要一到三条与核心冲突相关的物品或功法"));
  }
  for (const [key, value] of Object.entries(input.genrePackFields)) {
    if (!hasStructuredFieldValue(coreSettings, key, value)) {
      missingFields.push(
        blueprintMissingFieldSchema.parse({
          key: `genre_pack:${key}`,
          label: key,
          required: true,
          severity: "P0",
          message: `题材包必填字段 ${key} 未在蓝图中体现`,
        }),
      );
    }
  }
  for (const [key, value] of Object.entries(input.optionalGenrePackFields ?? {})) {
    if (!hasStructuredFieldValue(coreSettings, key, value)) {
      missingFields.push(
        blueprintMissingFieldSchema.parse({
          key: `genre_pack:${key}`,
          label: key,
          required: false,
          severity: "P1",
          message: `题材包可选字段 ${key} 未在蓝图中体现`,
        }),
      );
    }
  }
  const guidance = genrePackGenerationGuidanceSchema.safeParse(input.generationGuidance);
  if (guidance.success) {
    const corpus = JSON.stringify({ storyBible, coreSettings, outline });
    for (const forbidden of guidance.data.forbiddenElements) {
      if (corpus.includes(forbidden)) {
        conflicts.push(
          blueprintConflictSchema.parse({
            id: uuidV7(),
            severity: "P0",
            title: "题材禁用元素",
            detail: `蓝图包含题材禁用元素：${forbidden}`,
            affectedKeys: ["forbidden_element"],
            status: "open",
          }),
        );
      }
    }
  }

  const nodes = outline.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) {
    conflicts.push(structureConflict("大纲节点 ID 必须唯一"));
  }
  const roots = nodes.filter((node) => node.level === "book");
  if (roots.length !== 1 || roots[0]?.parentId !== null) {
    conflicts.push(structureConflict("大纲必须恰好有一个全书根节点"));
  }
  for (const node of nodes) {
    const expectedParent =
      node.level === "book"
        ? null
        : node.level === "volume"
          ? "book"
          : node.level === "act"
            ? "volume"
            : node.level === "chapter"
              ? "act"
              : "chapter";
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (
      (expectedParent === null && node.parentId !== null) ||
      (expectedParent !== null && parent?.level !== expectedParent)
    ) {
      conflicts.push(structureConflict(`大纲节点 ${node.title} 的上级层级无效`));
    }
  }
  const chapters = nodes.filter((node) => node.level === "chapter");
  const volumes = nodes.filter((node) => node.level === "volume");
  const sceneNodes = nodes.filter((node) => node.level === "scene");
  const plan = BLUEPRINT_SCALE_PLAN[input.scaleTarget as keyof typeof BLUEPRINT_SCALE_PLAN];
  if (plan) {
    if (volumes.length !== plan.volumes) {
      conflicts.push(
        structureConflict(`当前规模需要 ${plan.volumes} 卷，实际为 ${volumes.length} 卷`),
      );
    }
    if (chapters.length !== plan.chapters) {
      conflicts.push(
        structureConflict(`当前规模需要 ${plan.chapters} 章，实际为 ${chapters.length} 章`),
      );
    }
    if (sceneNodes.length !== plan.scenes) {
      conflicts.push(
        structureConflict(`当前规模需要 ${plan.scenes} 个场景，实际为 ${sceneNodes.length} 个`),
      );
    }
    for (const volume of volumes) {
      const acts = nodes.filter((node) => node.level === "act" && node.parentId === volume.id);
      if (acts.length !== BLUEPRINT_ACTS_PER_VOLUME) {
        conflicts.push(
          structureConflict(`卷 ${volume.title} 必须恰好包含 ${BLUEPRINT_ACTS_PER_VOLUME} 幕`),
        );
      }
      const volumeChapters = chapters.filter(
        (chapter) => byId.get(chapter.parentId ?? "")?.parentId === volume.id,
      );
      const chaptersPerVolume = plan.chapters / plan.volumes;
      if (volumeChapters.length !== chaptersPerVolume) {
        conflicts.push(structureConflict(`每卷必须包含 ${chaptersPerVolume} 章`));
      }
    }
  }
  const chapterNumbers = chapters
    .map((node) => node.chapterNumber)
    .sort((a, b) => (a ?? 0) - (b ?? 0));
  if (chapterNumbers.some((number, index) => number !== index + 1)) {
    conflicts.push(structureConflict("章号必须从 1 开始连续递增"));
  }
  if (chapters.some((chapter) => !chapter.brief)) {
    conflicts.push(structureConflict("每个章节点必须有完整章纲"));
  }
  const openingChapters = chapters
    .filter((chapter) => (chapter.chapterNumber ?? 0) <= 12)
    .sort((left, right) => (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0));
  if (!openingChapters.some((chapter) => Boolean(chapter.hook))) {
    conflicts.push(structureConflict("前十二个章节点至少需要一个章末钩子"));
  }
  if (!openingChapters.some((chapter) => Boolean(chapter.foreshadow))) {
    conflicts.push(structureConflict("前十二章至少需要一个可追踪伏笔"));
  }
  if (
    chapters.some(
      (chapter) => sceneNodes.filter((scene) => scene.parentId === chapter.id).length < 2,
    )
  ) {
    conflicts.push(structureConflict("每章至少需要两个场景"));
  }
  const volumeContractIds = outline.volumeContracts.map((contract) => contract.nodeId);
  const volumeIds = new Set(volumeContractIds);
  if (volumeIds.size !== volumeContractIds.length) {
    conflicts.push(structureConflict("每个卷只能有一个卷契约"));
  }
  if (volumes.some((volume) => !volumeIds.has(volume.id))) {
    conflicts.push(structureConflict("每个卷节点必须有卷契约"));
  }
  if (outline.volumeContracts.some((contract) => byId.get(contract.nodeId)?.level !== "volume")) {
    conflicts.push(structureConflict("卷契约必须引用存在的卷节点"));
  }
  const sceneCardNodeIds = outline.sceneCards.map((card) => card.nodeId);
  const sceneCardIds = new Set(sceneCardNodeIds);
  if (sceneCardIds.size !== sceneCardNodeIds.length) {
    conflicts.push(structureConflict("每个场景只能有一张场景卡"));
  }
  if (sceneNodes.some((scene) => !sceneCardIds.has(scene.id))) {
    conflicts.push(structureConflict("每个场景节点必须有场景卡"));
  }
  if (outline.sceneCards.some((card) => byId.get(card.nodeId)?.level !== "scene")) {
    conflicts.push(structureConflict("场景卡必须引用存在的场景节点"));
  }
  if (nodes.some((node) => node.status !== "planned")) {
    conflicts.push(structureConflict("初始大纲节点必须全部处于 planned 状态"));
  }
  return { missingFields, conflicts };
}

function hasStructuredFieldValue(
  coreSettings: BlueprintCoreSettingDraft[],
  key: string,
  expectedValue: unknown,
): boolean {
  return coreSettings.some((setting) => containsKeyValue(setting.data, key, expectedValue));
}

function containsKeyValue(value: unknown, key: string, expectedValue: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsKeyValue(entry, key, expectedValue));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(record, key) &&
    structuredValueMatches(record[key], expectedValue)
  ) {
    return true;
  }
  return Object.values(record).some((entry) => containsKeyValue(entry, key, expectedValue));
}

function structuredValueMatches(actualValue: unknown, expectedValue: unknown): boolean {
  if (Array.isArray(expectedValue)) {
    return (
      Array.isArray(actualValue) &&
      expectedValue.every((expected) =>
        actualValue.some((actual) => structuredValueMatches(actual, expected)),
      )
    );
  }
  if (expectedValue && typeof expectedValue === "object") {
    if (!actualValue || typeof actualValue !== "object" || Array.isArray(actualValue)) {
      return false;
    }
    const expectedRecord = expectedValue as Record<string, unknown>;
    const actualRecord = actualValue as Record<string, unknown>;
    const expectedKeys = Object.keys(expectedRecord).sort();
    const actualKeys = Object.keys(actualRecord).sort();
    return (
      expectedKeys.length === actualKeys.length &&
      expectedKeys.every(
        (key, index) =>
          key === actualKeys[index] &&
          structuredValueMatches(actualRecord[key], expectedRecord[key]),
      )
    );
  }
  return actualValue === expectedValue;
}

function structureConflict(message: string): BlueprintConflict {
  return blueprintConflictSchema.parse({
    id: uuidV7(),
    severity: "P0",
    title: "大纲结构冲突",
    detail: message,
    affectedKeys: ["outline"],
    status: "open",
  });
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
