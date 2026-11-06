import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type RandomUuid = () => string;

export function createRequestId(generateUuid: RandomUuid = randomUUID): string {
  return `req_${generateUuid()}`;
}

export function elapsedMilliseconds(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  return Math.round(Number(elapsedNanoseconds) / 100_000) / 10;
}

export function signClientIp(ip: string, secret: string): string {
  const encodedIp = Buffer.from(ip, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedIp).digest("base64url");
  return `${encodedIp}.${signature}`;
}

export function verifyClientIp(value: string | undefined, secret: string): string | null {
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const encodedIp = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(encodedIp).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  return Buffer.from(encodedIp, "base64url").toString("utf8");
}

export function resolveProxyIpSecret(
  secret: string | undefined,
  allowInsecureLocal: string | undefined,
): string {
  const localSecret = "local-development-proxy-ip-secret";
  const insecureSecrets = new Set([localSecret, "change-me-in-production"]);
  if (secret && (!insecureSecrets.has(secret) || allowInsecureLocal === "true")) {
    return secret;
  }
  if (allowInsecureLocal === "true") {
    return localSecret;
  }
  throw new Error("PROXY_IP_SECRET must be configured with a non-default secret");
}

export type ContextSourceType =
  "story_bible" | "setting" | "chapter_brief" | "chapter_version" | "style";
export type ContextSourcePriority = "required" | "high" | "normal";

export interface ContextSourceRef {
  sourceType: ContextSourceType;
  sourceId: string;
  label: string;
  citation: string;
}

export interface ContextCompilerSource {
  key: string;
  label: string;
  priority: ContextSourcePriority;
  content: string;
  sourceRefs: ContextSourceRef[];
}

export interface CompileContextPackInput {
  tokenBudget: number;
  compilerVersion: string;
  sources: ContextCompilerSource[];
}

export interface CompiledContextPack {
  compilerVersion: string;
  tokenBudget: number;
  tokenUsed: number;
  selected: Array<{
    key: string;
    label: string;
    priority: ContextSourcePriority;
    content: string;
    tokenCount: number;
    sourceRefs: ContextSourceRef[];
  }>;
  evicted: Array<{
    key: string;
    label: string;
    reason: "token_budget";
    tokenCount: number;
  }>;
  sourceRefs: ContextSourceRef[];
}

export interface ChapterContextInput {
  chapter: {
    id: string;
    number: number;
    title: string;
    brief: {
      goal?: string;
      pov?: string;
      location?: string;
      sceneBeats?: string[];
      requiredFacts?: string[];
    };
  };
  storyBible: {
    id: string;
    cards: Array<{ title: string; content: string }>;
    worldRules?: Array<{
      id: string;
      name: string;
      constraint: string;
      scope: string;
      exceptions: string[];
    }>;
  };
  styleSample?: string;
  styleSampleId?: string;
  settings: Array<{
    id: string;
    type?: string;
    name: string;
    aliases?: string[];
    summary: string;
    description?: string;
    tags?: string[];
    attributes: Record<string, unknown>;
    sourceChapterNumber?: number;
    validFromChapter?: number;
    validToChapter?: number | null;
  }>;
  previousVersions: Array<{
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    versionId: string;
    content: string;
  }>;
}

export class ContextBudgetExceededError extends Error {
  constructor(
    readonly requiredTokens: number,
    readonly tokenBudget: number,
  ) {
    super("Required context exceeds the token budget");
    this.name = "ContextBudgetExceededError";
  }
}

export function estimateContextTokens(value: string): number {
  return Math.max(1, Math.ceil(Array.from(value.replace(/\s/gu, "")).length / 2));
}

export function compileContextPack(input: CompileContextPackInput): CompiledContextPack {
  const priorities: Record<ContextSourcePriority, number> = {
    required: 0,
    high: 1,
    normal: 2,
  };
  const ranked = input.sources
    .map((source, index) => ({
      source,
      index,
      tokenCount: estimateContextTokens(source.content),
    }))
    .sort(
      (left, right) =>
        priorities[left.source.priority] - priorities[right.source.priority] ||
        left.index - right.index,
    );
  const requiredTokens = ranked
    .filter(({ source }) => source.priority === "required")
    .reduce((total, source) => total + source.tokenCount, 0);
  if (requiredTokens > input.tokenBudget) {
    throw new ContextBudgetExceededError(requiredTokens, input.tokenBudget);
  }

  let tokenUsed = 0;
  const selected: CompiledContextPack["selected"] = [];
  const evicted: CompiledContextPack["evicted"] = [];
  for (const source of ranked) {
    if (tokenUsed + source.tokenCount <= input.tokenBudget) {
      tokenUsed += source.tokenCount;
      selected.push({
        key: source.source.key,
        label: source.source.label,
        priority: source.source.priority,
        content: source.source.content,
        tokenCount: source.tokenCount,
        sourceRefs: source.source.sourceRefs,
      });
      continue;
    }
    evicted.push({
      key: source.source.key,
      label: source.source.label,
      reason: "token_budget",
      tokenCount: source.tokenCount,
    });
  }

  return {
    compilerVersion: input.compilerVersion,
    tokenBudget: input.tokenBudget,
    tokenUsed,
    selected,
    evicted,
    sourceRefs: uniqueSourceRefs(selected.flatMap((source) => source.sourceRefs)),
  };
}

export function compileChapterContext(
  input: ChapterContextInput,
  tokenBudget: number,
  compilerVersion = "m0-context-v1",
): CompiledContextPack {
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
  const hasStructuredWorldRules = (input.storyBible.worldRules ?? []).length > 0;
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
  const candidates: ContextCompilerSource[] = [
    {
      key: "brief:required-facts",
      label: "本章必用事实",
      priority: "required",
      content: (brief.requiredFacts ?? []).join("\n"),
      sourceRefs: [chapterRef],
    },
    {
      key: "brief:scene",
      label: "本章章纲",
      priority: "required",
      content: [
        `目标：${brief.goal ?? ""}`,
        `视角：${brief.pov ?? ""}`,
        `地点：${brief.location ?? ""}`,
        ...(brief.sceneBeats ?? []).map((beat, index) => `${index + 1}. ${beat}`),
      ].join("\n"),
      sourceRefs: [chapterRef],
    },
    {
      key: "story-bible:locked",
      label: "故事圣经",
      priority: "required",
      content: input.storyBible.cards
        .filter((card) => !(hasStructuredWorldRules && card.title === "世界铁律"))
        .map((card) => `${card.title}：${card.content}`)
        .join("\n"),
      sourceRefs: [bibleRef],
    },
    ...((input.storyBible.worldRules ?? []).length > 0
      ? [
          {
            key: "story-bible:world-rules",
            label: "世界铁律",
            priority: "required" as const,
            content: (input.storyBible.worldRules ?? [])
              .map(
                (rule) =>
                  `${rule.name}：${rule.constraint}\n适用范围：${rule.scope}${
                    rule.exceptions.length > 0 ? `\n例外：${rule.exceptions.join("；")}` : ""
                  }`,
              )
              .join("\n"),
            sourceRefs: [bibleRef],
          },
        ]
      : []),
    ...(input.styleSample?.trim()
      ? [
          {
            key: "style:sample",
            label: "文风样本",
            priority: "normal" as const,
            content: input.styleSample,
            sourceRefs: [
              {
                sourceType: "style" as const,
                sourceId: input.styleSampleId ?? input.storyBible.id,
                label: "文风样本",
                citation: "作品文风样本",
              },
            ],
          },
        ]
      : []),
    ...input.settings
      .filter((setting) => isSceneRelevantSetting(setting, input.chapter.number, sceneText))
      .map((setting) => ({
        key: `setting:${setting.id}`,
        label: setting.name,
        priority: "high" as const,
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
      })),
    ...input.previousVersions.map((version) => ({
      key: `recent:${version.chapterId}`,
      label: `第 ${version.chapterNumber} 章`,
      priority: "normal" as const,
      content: version.content,
      sourceRefs: [
        {
          sourceType: "chapter_version" as const,
          sourceId: version.versionId,
          label: `第 ${version.chapterNumber} 章`,
          citation: `第 ${version.chapterNumber} 章 · ${version.chapterTitle}`,
        },
      ],
    })),
  ];
  return compileContextPack({
    tokenBudget,
    compilerVersion,
    sources: candidates.filter((source) => source.content.trim().length > 0),
  });
}

function isSceneRelevantSetting(
  setting: ChapterContextInput["settings"][number],
  chapterNumber: number,
  sceneText: string,
): boolean {
  if (
    setting.type === "fact" &&
    setting.validFromChapter != null &&
    setting.validFromChapter > chapterNumber
  ) {
    return false;
  }
  if (
    setting.type === "fact" &&
    setting.validToChapter != null &&
    setting.validToChapter < chapterNumber
  ) {
    return false;
  }
  const identifiers = [setting.name, ...(setting.aliases ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  return identifiers.some((identifier) => sceneText.includes(identifier));
}

export interface CharacterKnowledgeFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFromChapter: number;
  validToChapter: number | null;
}

export interface CharacterKnowledgeStateInput {
  objectiveFactId: string;
  state: "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown";
  claimedContent: string | null;
  validFromChapter: number;
  validToChapter: number | null;
}

export interface CharacterKnowledgeProjection {
  knownFacts: CharacterKnowledgeFact[];
  beliefs: Array<{
    objectiveFactId: string;
    state: Exclude<CharacterKnowledgeStateInput["state"], "knowledge">;
    claimedContent: string | null;
  }>;
  hiddenFactIds: string[];
}

export function projectCharacterKnowledgeAtChapter(
  facts: CharacterKnowledgeFact[],
  states: CharacterKnowledgeStateInput[],
  chapterNumber: number,
): CharacterKnowledgeProjection {
  const activeFacts = facts.filter((fact) =>
    chapterWithinValidity(fact.validFromChapter, fact.validToChapter, chapterNumber),
  );
  const latestStateByFact = new Map<string, CharacterKnowledgeStateInput>();
  for (const state of [...states].sort(
    (left, right) => left.validFromChapter - right.validFromChapter,
  )) {
    if (chapterWithinValidity(state.validFromChapter, state.validToChapter, chapterNumber)) {
      latestStateByFact.set(state.objectiveFactId, state);
    }
  }

  const knownFacts = activeFacts.filter(
    (fact) => latestStateByFact.get(fact.id)?.state === "knowledge",
  );
  const knownFactIds = new Set(knownFacts.map((fact) => fact.id));
  const beliefs = [...latestStateByFact.values()].flatMap((state) => {
    if (
      state.state === "knowledge" ||
      !activeFacts.some((fact) => fact.id === state.objectiveFactId)
    ) {
      return [];
    }
    return [
      {
        objectiveFactId: state.objectiveFactId,
        state: state.state,
        claimedContent: state.claimedContent,
      },
    ];
  });

  return {
    knownFacts,
    beliefs,
    hiddenFactIds: activeFacts.filter((fact) => !knownFactIds.has(fact.id)).map((fact) => fact.id),
  };
}

export interface CharacterStateTransitionInput {
  stateKind: "body" | "limb" | "location" | "ability" | "disguise";
  stateKey: string;
  value: string;
  validFromChapter: number;
  validToChapter: number | null;
}

export function projectCharacterStateAtChapter<T extends CharacterStateTransitionInput>(
  transitions: T[],
  chapterNumber: number,
): Record<string, T> {
  const active: Record<string, T> = {};
  for (const transition of [...transitions].sort(
    (left, right) => left.validFromChapter - right.validFromChapter,
  )) {
    if (
      chapterWithinValidity(transition.validFromChapter, transition.validToChapter, chapterNumber)
    ) {
      active[`${transition.stateKind}:${transition.stateKey}`] = transition;
    }
  }
  return active;
}

export interface CharacterRelationshipValidity {
  validFromChapter: number;
  validToChapter: number | null;
}

export function projectActiveRelationshipsAtChapter<T extends CharacterRelationshipValidity>(
  relationships: T[],
  chapterNumber: number,
): T[] {
  return relationships.filter((relationship) =>
    chapterWithinValidity(
      relationship.validFromChapter,
      relationship.validToChapter,
      chapterNumber,
    ),
  );
}

function chapterWithinValidity(
  fromChapter: number,
  toChapter: number | null,
  chapterNumber: number,
): boolean {
  return fromChapter <= chapterNumber && (toChapter === null || toChapter >= chapterNumber);
}

export interface ExtractedFactCandidate {
  subject: string;
  predicate: string;
  object: string;
  sourceSentence: string;
  risk: "low" | "medium" | "high";
  confidence: number;
  required: boolean;
}

export function extractFactCandidates(content: string): ExtractedFactCandidate[] {
  const sentences = content.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [];
  return sentences
    .map((sourceSentence) => sourceSentence.trim())
    .filter((sourceSentence) => sourceSentence.length >= 4)
    .map((sourceSentence) => {
      const object = sourceSentence.replace(/[。！？!?；;]+$/u, "").trim();
      if (/(断臂|骨折|左手|右手|身体|伤口)/u.test(sourceSentence)) {
        return {
          subject: findNamedSubject(sourceSentence, "沈砚"),
          predicate: "身体状态",
          object,
          sourceSentence,
          risk: "high" as const,
          confidence: 0.95,
          required: true,
        };
      }
      if (
        sourceSentence.includes("顾青") &&
        /(看见|察觉|知道|怀疑|听见|发现)/u.test(sourceSentence)
      ) {
        return {
          subject: "顾青",
          predicate: "角色认知",
          object,
          sourceSentence,
          risk: "medium" as const,
          confidence: 0.82,
          required: true,
        };
      }
      if (sourceSentence.includes("忘川书")) {
        return {
          subject: "忘川书",
          predicate: "状态",
          object,
          sourceSentence,
          risk: "medium" as const,
          confidence: 0.78,
          required: false,
        };
      }
      return {
        subject: findNamedSubject(sourceSentence, "未明人物"),
        predicate: "事件",
        object,
        sourceSentence,
        risk: "low" as const,
        confidence: 0.65,
        required: false,
      };
    });
}

function findNamedSubject(sentence: string, fallback: string): string {
  return ["沈砚", "顾青"].find((name) => sentence.includes(name)) ?? fallback;
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

export * from "./agent-runtime";
export * from "./world-simulation";
export * from "./orchestrator";
