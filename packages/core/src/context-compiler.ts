import { createHash } from "node:crypto";

import type {
  ContextBudgetAccounting,
  ContextEvictionReason,
  ContextInclusionReason,
  ContextLayer,
  ContextPackEviction,
  ContextPackManifest,
  ContextPackSelected,
  ContextSourceRef,
  ContextTask,
  StoryTimePoint,
} from "@novel-brain/contracts";

import { CONTEXT_TOKEN_ESTIMATOR, estimateContextTokens } from "./context-tokens";
import type { ChapterContextInput } from "./index";

const LAYERS: ContextLayer[] = ["P0", "P1", "P2", "P3", "P4"];
const LAYER_RANK: Record<ContextLayer, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};
const DEFAULT_INCLUSION_REASON: Record<ContextLayer, ContextInclusionReason> = {
  P0: "p0_hard_constraint",
  P1: "scene_relevant_canon",
  P2: "recent_narrative",
  P3: "style_and_promise",
  P4: "optional_reference",
};

export interface ContextCandidateValidity {
  fromChapter?: number;
  toChapter?: number | null;
  fromStoryTime?: StoryTimePoint | null;
  toStoryTime?: StoryTimePoint | null;
}

export interface ContextCandidate {
  key: string;
  label: string;
  layer: ContextLayer;
  content: string;
  sourceRefs: ContextSourceRef[];
  order?: number;
  tasks?: ContextTask[];
  povCharacterIds?: string[];
  branchId?: string;
  validity?: ContextCandidateValidity;
  knowledgeFactId?: string;
  inclusionReason?: ContextInclusionReason;
}

export interface ContextKnowledgeFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFromChapter: number;
  validToChapter: number | null;
}

export interface ContextKnowledgeState {
  objectiveFactId: string;
  state: "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown";
  claimedContent: string | null;
  validFromChapter: number;
  validToChapter: number | null;
}

export interface ContextKnowledgeInput {
  facts: ContextKnowledgeFact[];
  states: ContextKnowledgeState[];
}

export interface CompileContextManifestInput {
  compilerVersion: string;
  task: ContextTask;
  chapterId: string;
  chapterNumber: number;
  povCharacterId: string | null;
  branchId: string;
  branchStatus: "active" | "archived";
  storyTime?: StoryTimePoint | null;
  requestedTokenBudget: number;
  modelContextWindowTokens?: number | null;
  reservedOutputTokens?: number;
  candidates: ContextCandidate[];
  knowledge?: ContextKnowledgeInput;
}

export class ContextWindowTooSmallError extends Error {
  constructor(
    readonly contextWindowTokens: number,
    readonly reservedOutputTokens: number,
  ) {
    super("The model context window does not leave room for input context");
    this.name = "ContextWindowTooSmallError";
  }
}

export class ContextBranchStaleError extends Error {
  constructor(readonly branchId: string) {
    super("The branch is archived and cannot compile new context");
    this.name = "ContextBranchStaleError";
  }
}

export class ContextBudgetExceededError extends Error {
  constructor(
    readonly requiredTokens: number,
    readonly tokenBudget: number,
    readonly p0Keys: string[] = [],
  ) {
    super("Required context exceeds the token budget");
    this.name = "ContextBudgetExceededError";
  }
}

interface PreparedCandidate {
  candidate: ContextCandidate;
  tokenCount: number;
  order: number;
  sourceRefs: ContextSourceRef[];
}

export function compileContextManifest(input: CompileContextManifestInput): ContextPackManifest {
  if (input.branchStatus !== "active") {
    throw new ContextBranchStaleError(input.branchId);
  }
  if (!Number.isInteger(input.requestedTokenBudget) || input.requestedTokenBudget < 1) {
    throw new RangeError("requestedTokenBudget must be a positive integer");
  }
  if (!Number.isInteger(input.chapterNumber) || input.chapterNumber < 1) {
    throw new RangeError("chapterNumber must be a positive integer");
  }
  const effectiveTokenBudget = resolveEffectiveBudget(input);
  const selected = new Map<string, PreparedCandidate>();
  const evicted: ContextPackEviction[] = [];

  for (const candidate of input.candidates) {
    const rejection = rejectionReason(candidate, input);
    if (rejection) {
      evicted.push(toEviction(candidate, rejection));
      continue;
    }
    selected.set(candidate.key, prepare(candidate));
  }

  let tokenUsed = sumTokens(selected.values());
  while (tokenUsed > effectiveTokenBudget) {
    const victim = pickBudgetVictim(selected.values());
    if (!victim) {
      break;
    }
    selected.delete(victim.candidate.key);
    tokenUsed -= victim.tokenCount;
    evicted.push(toEviction(victim.candidate, "token_budget"));
  }
  if (tokenUsed > effectiveTokenBudget) {
    const p0Tokens = sumTokens(
      [...selected.values()].filter((entry) => entry.candidate.layer === "P0"),
    );
    throw new ContextBudgetExceededError(
      p0Tokens,
      effectiveTokenBudget,
      [...selected.values()]
        .filter((entry) => entry.candidate.layer === "P0")
        .map((entry) => entry.candidate.key)
        .sort(),
    );
  }

  const selectedEntries = [...selected.values()].sort(comparePrepared).map(toSelected);
  const evictedEntries = [...evicted].sort(compareEvictions);
  const sourceRefs = uniqueSourceRefs(selectedEntries.flatMap((entry) => entry.sourceRefs));
  const budget = accountBudget(
    selectedEntries,
    evictedEntries,
    input,
    effectiveTokenBudget,
    tokenUsed,
  );
  const manifestWithoutHash = {
    compilerVersion: input.compilerVersion,
    task: input.task,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    povCharacterId: input.povCharacterId,
    branchId: input.branchId,
    tokenBudget: effectiveTokenBudget,
    tokenUsed,
    effectiveTokenBudget,
    selected: selectedEntries,
    evicted: evictedEntries,
    sourceRefs,
    budget,
  };
  return {
    ...manifestWithoutHash,
    manifestHash: hashManifest(manifestWithoutHash),
  };
}

export interface ChapterContextManifestInput extends ChapterContextInput {
  branchId: string;
  branchStatus: "active" | "archived";
  task?: ContextTask;
  povCharacterId?: string | null;
  storyTime?: StoryTimePoint | null;
  modelContextWindowTokens?: number | null;
  reservedOutputTokens?: number;
  knowledge?: ContextKnowledgeInput;
  compilerVersion?: string;
}

export function compileChapterContextManifest(
  input: ChapterContextManifestInput,
  tokenBudget: number,
): ContextPackManifest {
  const chapterRef = {
    sourceType: "chapter_brief" as const,
    sourceId: input.chapter.id,
    label: `第 ${input.chapter.number} 章章纲`,
    citation: `第 ${input.chapter.number} 章 · 章纲`,
  };
  const bibleRef = {
    sourceType: "story_bible" as const,
    sourceId: input.storyBible.id,
    label: "故事圣经",
    citation: "已锁定故事圣经",
  };
  const brief = input.chapter.brief;
  const sceneText = [
    input.chapter.title,
    brief.goal,
    brief.pov,
    brief.location,
    ...(brief.sceneBeats ?? []),
    ...(brief.requiredFacts ?? []),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const hasStructuredWorldRules = (input.storyBible.worldRules ?? []).length > 0;
  const candidates: ContextCandidate[] = [
    {
      key: "brief:required-facts",
      label: "本章必用事实",
      layer: "P0",
      content: (brief.requiredFacts ?? []).join("\n"),
      sourceRefs: [chapterRef],
      branchId: input.branchId,
    },
    {
      key: "brief:scene",
      label: "本章章纲",
      layer: "P0",
      content: [
        `目标：${brief.goal ?? ""}`,
        `视角：${brief.pov ?? ""}`,
        `地点：${brief.location ?? ""}`,
        ...(brief.sceneBeats ?? []).map((beat, index) => `${index + 1}. ${beat}`),
      ].join("\n"),
      sourceRefs: [chapterRef],
      branchId: input.branchId,
    },
    {
      key: "story-bible:locked",
      label: "故事圣经",
      layer: "P0",
      content: input.storyBible.cards
        .filter((card) => !(hasStructuredWorldRules && card.title === "世界铁律"))
        .map((card) => `${card.title}：${card.content}`)
        .join("\n"),
      sourceRefs: [bibleRef],
      branchId: input.branchId,
    },
    ...((input.storyBible.worldRules ?? []).length > 0
      ? [
          {
            key: "story-bible:world-rules",
            label: "世界铁律",
            layer: "P0" as const,
            content: (input.storyBible.worldRules ?? [])
              .map(
                (rule) =>
                  `${rule.name}：${rule.constraint}\n适用范围：${rule.scope}${
                    rule.exceptions.length > 0 ? `\n例外：${rule.exceptions.join("；")}` : ""
                  }`,
              )
              .join("\n"),
            sourceRefs: [bibleRef],
            branchId: input.branchId,
          },
        ]
      : []),
    ...(input.styleSample?.trim()
      ? [
          {
            key: "style:sample",
            label: "文风样本",
            layer: "P3" as const,
            content: input.styleSample,
            sourceRefs: [
              {
                sourceType: "style" as const,
                sourceId: input.styleSampleId ?? input.storyBible.id,
                label: "文风样本",
                citation: "作品文风样本",
              },
            ],
            branchId: input.branchId,
            tasks: ["chapter_draft", "chapter_revision", "continuity_check"] as ContextTask[],
          },
        ]
      : []),
    ...input.settings
      .filter((setting) => isSceneRelevantSetting(setting, input.chapter.number, sceneText))
      .map((setting, index) => ({
        key: `setting:${setting.id}`,
        label: setting.name,
        layer: "P1" as const,
        content: `${setting.summary}\n${JSON.stringify(setting.attributes)}`,
        sourceRefs: [
          {
            sourceType: "setting" as const,
            sourceId: setting.id,
            label: setting.name,
            citation:
              setting.type === "fact"
                ? `第 ${setting.sourceChapterNumber ?? setting.validFromChapter ?? input.chapter.number} 章事实 · ${setting.name} · ${setting.summary}`
                : `已确认设定 · ${setting.name}`,
          },
        ],
        branchId: input.branchId,
        order: index,
        validity: {
          ...(setting.validFromChapter !== undefined
            ? { fromChapter: setting.validFromChapter }
            : {}),
          ...(setting.validToChapter !== undefined ? { toChapter: setting.validToChapter } : {}),
        },
        ...(setting.type === "fact" ? { knowledgeFactId: setting.id } : {}),
      })),
    ...input.previousVersions.map((version, index) => ({
      key: `recent:${version.chapterId}`,
      label: `第 ${version.chapterNumber} 章`,
      layer: "P2" as const,
      content: version.content,
      sourceRefs: [
        {
          sourceType: "chapter_version" as const,
          sourceId: version.versionId,
          label: `第 ${version.chapterNumber} 章`,
          citation: `第 ${version.chapterNumber} 章 · ${version.chapterTitle}`,
        },
      ],
      branchId: input.branchId,
      order: index,
      tasks: ["chapter_draft", "chapter_revision", "continuity_check"] as ContextTask[],
    })),
  ];
  return compileContextManifest({
    compilerVersion: input.compilerVersion ?? "m1-context-v1",
    task: input.task ?? "chapter_draft",
    chapterId: input.chapter.id,
    chapterNumber: input.chapter.number,
    povCharacterId: input.povCharacterId ?? null,
    branchId: input.branchId,
    branchStatus: input.branchStatus,
    storyTime: input.storyTime ?? null,
    requestedTokenBudget: tokenBudget,
    modelContextWindowTokens: input.modelContextWindowTokens ?? null,
    reservedOutputTokens: input.reservedOutputTokens ?? 0,
    candidates: candidates.filter((candidate) => candidate.content.trim().length > 0),
    ...(input.knowledge ? { knowledge: input.knowledge } : {}),
  });
}

export function resolveModelContextWindow(model: string): number | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("deepseek")) {
    return 64_000;
  }
  if (normalized.includes("gpt-4o") || normalized.includes("gpt-4.1")) {
    return 128_000;
  }
  if (normalized.includes("claude")) {
    return 200_000;
  }
  if (normalized.includes("qwen")) {
    return 128_000;
  }
  return null;
}

function isSceneRelevantSetting(
  setting: ChapterContextInput["settings"][number],
  _chapterNumber: number,
  sceneText: string,
): boolean {
  const identifiers = [setting.name, ...(setting.aliases ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  return identifiers.some((identifier) => sceneText.includes(identifier));
}

function resolveEffectiveBudget(input: CompileContextManifestInput): number {
  const reservedOutputTokens = input.reservedOutputTokens ?? 0;
  if (!Number.isInteger(reservedOutputTokens) || reservedOutputTokens < 0) {
    throw new RangeError("reservedOutputTokens must be a non-negative integer");
  }
  const window = input.modelContextWindowTokens ?? null;
  if (window === null) {
    return input.requestedTokenBudget;
  }
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError("modelContextWindowTokens must be a positive integer");
  }
  const available = window - reservedOutputTokens;
  if (available < 1) {
    throw new ContextWindowTooSmallError(window, reservedOutputTokens);
  }
  return Math.min(input.requestedTokenBudget, available);
}

function rejectionReason(
  candidate: ContextCandidate,
  input: CompileContextManifestInput,
): ContextEvictionReason | null {
  if (candidate.sourceRefs.length === 0) {
    if (candidate.layer === "P0") {
      throw new Error(`P0 candidate ${candidate.key} requires at least one source reference`);
    }
    return "missing_source";
  }
  if (!candidate.content.trim()) {
    return "empty_content";
  }
  if (candidate.branchId && candidate.branchId !== input.branchId) {
    return "stale_branch";
  }
  if (candidate.tasks && !candidate.tasks.includes(input.task)) {
    return "task_mismatch";
  }
  if (
    candidate.povCharacterIds &&
    (!input.povCharacterId || !candidate.povCharacterIds.includes(input.povCharacterId))
  ) {
    return "pov_mismatch";
  }
  const validity = candidate.validity;
  if (validity?.fromChapter != null && validity.fromChapter > input.chapterNumber) {
    return "future_fact";
  }
  if (validity?.toChapter != null && validity.toChapter < input.chapterNumber) {
    return "expired_fact";
  }
  if (storyTimeOutsideValidity(validity, input.storyTime ?? null)) {
    return "time_window";
  }
  if (
    candidate.knowledgeFactId &&
    input.knowledge &&
    !isFactKnownToPov(input.knowledge, candidate.knowledgeFactId, input)
  ) {
    return "knowledge_boundary";
  }
  return null;
}

function storyTimeOutsideValidity(
  validity: ContextCandidateValidity | undefined,
  storyTime: StoryTimePoint | null,
): boolean {
  if (!validity || !storyTime) {
    return false;
  }
  if (
    validity.fromStoryTime &&
    validity.fromStoryTime.era === storyTime.era &&
    storyTime.sortKey < validity.fromStoryTime.sortKey
  ) {
    return true;
  }
  return Boolean(
    validity.toStoryTime &&
    validity.toStoryTime.era === storyTime.era &&
    storyTime.sortKey > validity.toStoryTime.sortKey,
  );
}

function isFactKnownToPov(
  knowledge: ContextKnowledgeInput | undefined,
  objectiveFactId: string,
  input: CompileContextManifestInput,
): boolean {
  if (!knowledge) {
    return false;
  }
  const fact = knowledge.facts.find(
    (entry) =>
      entry.id === objectiveFactId &&
      entry.validFromChapter <= input.chapterNumber &&
      (entry.validToChapter === null || entry.validToChapter >= input.chapterNumber),
  );
  if (!fact) {
    return false;
  }
  const activeStates = knowledge.states
    .filter(
      (state) =>
        state.objectiveFactId === objectiveFactId &&
        state.validFromChapter <= input.chapterNumber &&
        (state.validToChapter === null || state.validToChapter >= input.chapterNumber),
    )
    .sort(
      (left, right) =>
        left.validFromChapter - right.validFromChapter ||
        (left.validToChapter ?? Number.MAX_SAFE_INTEGER) -
          (right.validToChapter ?? Number.MAX_SAFE_INTEGER),
    );
  return activeStates.at(-1)?.state === "knowledge";
}

function prepare(candidate: ContextCandidate): PreparedCandidate {
  return {
    candidate,
    tokenCount: estimateContextTokens(candidate.content),
    order: candidate.order ?? 0,
    sourceRefs: candidate.sourceRefs,
  };
}

function toSelected(entry: PreparedCandidate): ContextPackSelected {
  return {
    key: entry.candidate.key,
    label: entry.candidate.label,
    layer: entry.candidate.layer,
    priority: entry.candidate.layer,
    content: entry.candidate.content,
    tokenCount: entry.tokenCount,
    sourceRefs: entry.sourceRefs,
    reason: entry.candidate.inclusionReason ?? DEFAULT_INCLUSION_REASON[entry.candidate.layer],
  };
}

function toEviction(
  candidate: ContextCandidate,
  reason: ContextEvictionReason,
): ContextPackEviction {
  return {
    key: candidate.key,
    label: candidate.label,
    layer: candidate.layer,
    reason,
    tokenCount: estimateContextTokens(candidate.content),
    sourceRefs: candidate.sourceRefs,
  };
}

function pickBudgetVictim(candidates: Iterable<PreparedCandidate>): PreparedCandidate | undefined {
  return [...candidates]
    .filter((entry) => entry.candidate.layer !== "P0")
    .sort(
      (left, right) =>
        LAYER_RANK[right.candidate.layer] - LAYER_RANK[left.candidate.layer] ||
        right.order - left.order ||
        right.candidate.key.localeCompare(left.candidate.key),
    )[0];
}

function comparePrepared(left: PreparedCandidate, right: PreparedCandidate): number {
  return (
    LAYER_RANK[left.candidate.layer] - LAYER_RANK[right.candidate.layer] ||
    left.order - right.order ||
    left.candidate.key.localeCompare(right.candidate.key)
  );
}

function compareEvictions(left: ContextPackEviction, right: ContextPackEviction): number {
  return (
    LAYER_RANK[left.layer ?? "P4"] - LAYER_RANK[right.layer ?? "P4"] ||
    left.key.localeCompare(right.key)
  );
}

function sumTokens(entries: Iterable<PreparedCandidate>): number {
  let total = 0;
  for (const entry of entries) {
    total += entry.tokenCount;
  }
  return total;
}

function accountBudget(
  selected: ContextPackSelected[],
  evicted: ContextPackEviction[],
  input: CompileContextManifestInput,
  effectiveTokenBudget: number,
  tokenUsed: number,
): ContextBudgetAccounting {
  const layers = Object.fromEntries(
    LAYERS.map((layer) => {
      const selectedForLayer = selected.filter((entry) => entry.layer === layer);
      const evictedForLayer = evicted.filter((entry) => entry.layer === layer);
      return [
        layer,
        {
          selectedCount: selectedForLayer.length,
          selectedTokens: selectedForLayer.reduce((total, entry) => total + entry.tokenCount, 0),
          evictedCount: evictedForLayer.length,
          evictedTokens: evictedForLayer.reduce((total, entry) => total + entry.tokenCount, 0),
        },
      ];
    }),
  ) as ContextBudgetAccounting["layers"];
  return {
    requestedTokenBudget: input.requestedTokenBudget,
    effectiveTokenBudget,
    modelContextWindowTokens: input.modelContextWindowTokens ?? null,
    reservedOutputTokens: input.reservedOutputTokens ?? 0,
    tokenUsed,
    tokenRemaining: Math.max(0, effectiveTokenBudget - tokenUsed),
    tokenEstimator: CONTEXT_TOKEN_ESTIMATOR,
    layers,
  };
}

function uniqueSourceRefs(refs: ContextSourceRef[]): ContextSourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.sourceType}:${ref.sourceId}:${ref.citation}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hashManifest(manifest: Omit<ContextPackManifest, "manifestHash">): string {
  return createHash("sha256").update(stableStringify(manifest)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
