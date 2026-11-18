import { createHash } from "node:crypto";

import type { ContinuityPlan, ContinuityScenarioFamily, ContinuitySeverity } from "./plan";

export type KnowledgeStateKind = "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown";
export type ControlMode = "clean" | "false_alarm" | "incomplete_context";

export interface ContinuityEntity {
  id: string;
  kind: "character" | "faction" | "location" | "item";
  name: string;
  aliases: readonly string[];
}

export interface EntityRelationship {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  validFromChapter: number;
  validToChapter: number | null;
  versionNodeId: string;
}

export interface ContinuityChapter {
  id: string;
  number: number;
  volumeNumber: number;
  title: string;
  povCharacterId: string;
  locationId: string;
  summary: string;
  content: string;
  versionNodeId: string;
}

export interface ContinuityVolume {
  id: string;
  number: number;
  title: string;
  startChapter: number;
  endChapter: number;
  goal: string;
  conflict: string;
  climax: string;
}

export interface ContinuityBranch {
  id: string;
  name: string;
  commonAncestorChapter: number;
  divergenceChapter: number | null;
  chapterCount: number;
}

export interface ContinuityFact {
  id: string;
  subjectId: string;
  relation: string;
  object: string;
  validFromChapter: number;
  validToChapter: number | null;
  visibility: "public" | "hidden";
  sourceChapterId: string;
  sourceEventId: string;
  versionNodeId: string;
}

export interface CharacterKnowledgeState {
  id: string;
  characterId: string;
  objectiveFactId: string;
  state: KnowledgeStateKind;
  claimedContent: string | null;
  validFromChapter: number;
  validToChapter: number | null;
  sourceChapterId: string;
  versionNodeId: string;
}

export interface StateTransition {
  id: string;
  kind: "body" | "ability" | "identity" | "location" | "relationship";
  subjectId: string;
  fromState: string;
  toState: string;
  chapterNumber: number;
  sourceEventId: string;
  versionNodeId: string;
}

export interface ItemRights {
  ownerId: string;
  custodianId: string;
  locationId: string;
  usageRightId: string;
}

export interface ContinuityItem {
  id: string;
  name: string;
  rights: ItemRights;
  validFromChapter: number;
  validToChapter: number | null;
  versionNodeId: string;
}

export interface TimelineEvent {
  id: string;
  chapterNumber: number;
  storyTimeLabel: string;
  storySortKey: number;
  locationId: string;
  participants: readonly string[];
}

export interface MapRoute {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  travelMinutes: number;
  bidirectional: boolean;
}

export interface PlotThread {
  id: string;
  name: string;
  status: "planned" | "active" | "paid_off" | "abandoned";
  startChapter: number;
  endChapter: number | null;
}

export interface Foreshadow {
  id: string;
  label: string;
  setupChapter: number;
  payoffChapter: number;
  status: "planted" | "paid_off" | "abandoned";
  importance: 1 | 2 | 3;
  sourceEventId: string;
}

export interface StyleSample {
  id: string;
  characterId: string;
  volumeNumber: number;
  approvalStatus: "approved";
  provenance: string;
  sampleText: string;
}

export interface ContinuityDefect {
  id: string;
  family: ContinuityScenarioFamily;
  severity: ContinuitySeverity;
  chapterNumber: number;
  branchId: string;
  entityIds: readonly string[];
  sourceFactId: string;
  versionNodeId: string;
  description: string;
  evidence: string;
}

export interface ContinuityControl {
  id: string;
  family: ContinuityScenarioFamily;
  mode: ControlMode;
  chapterNumber: number;
  branchId: string;
  entityIds: readonly string[];
  reason: string;
}

export interface ContinuityAgentScenario {
  id: string;
  expectedDisposition: "propose_repair" | "abstain" | "escalate";
  expectedDefectIds: readonly string[];
  controlIds: readonly string[];
  allowedTools: readonly string[];
  forbiddenTools: readonly string[];
  budgetTokens: number;
  maxImpactObjects: number;
  requiresApproval: boolean;
  description: string;
}

export interface ContinuityFixture {
  plan: ContinuityPlan;
  entities: readonly ContinuityEntity[];
  relationships: readonly EntityRelationship[];
  chapters: readonly ContinuityChapter[];
  volumes: readonly ContinuityVolume[];
  branches: readonly ContinuityBranch[];
  facts: readonly ContinuityFact[];
  knowledgeStates: readonly CharacterKnowledgeState[];
  stateTransitions: readonly StateTransition[];
  items: readonly ContinuityItem[];
  timeline: readonly TimelineEvent[];
  mapRoutes: readonly MapRoute[];
  plotThreads: readonly PlotThread[];
  foreshadows: readonly Foreshadow[];
  styleSamples: readonly StyleSample[];
  defects: readonly ContinuityDefect[];
  controls: readonly ContinuityControl[];
  agentScenarios: readonly ContinuityAgentScenario[];
  digest: {
    schemaVersion: 1;
    generatorVersion: "continuity-benchmark-v1";
    sourceCommit: string;
    seed: number;
    chapterCount: number;
    volumeCount: number;
    defectCount: number;
    controlCount: number;
    sha256: string;
  };
}

const characterNames = ["沈砚", "顾青", "裴照", "闻雪"] as const;
const locationNames = ["旧城", "忘川渡", "北境关", "归墟"] as const;
const phrasePool = [
  "山雨落在旧城的青瓦上，石阶向雾里延伸。",
  "剑鞘轻响，远处的钟声像从水底传来。",
  "旧信上的年号被墨迹遮住，没有人敢先开口。",
  "渡口的灯火一盏盏熄灭，河面只剩风声。",
  "城门尚未开启，守夜人已经换了第三班。",
] as const;

export function generateContinuityFixture(input: {
  plan: ContinuityPlan;
  sourceCommit: string;
}): ContinuityFixture {
  const { plan, sourceCommit } = input;
  if (!/^[a-f0-9]{7,64}$/u.test(sourceCommit)) {
    throw new Error("SOURCE_COMMIT_INVALID");
  }

  const characterIds = characterNames.map((_, index) => uuid(plan.seed, `character:${index}`));
  const locationIds = locationNames.map((_, index) => uuid(plan.seed, `location:${index}`));
  const factionId = uuid(plan.seed, "faction:main");
  const itemIds = ["忘川书", "照骨镜", "归墟令"].map((_, index) =>
    uuid(plan.seed, `item:${index}`),
  );

  const entities: ContinuityEntity[] = [
    ...characterNames.map((name, index) => ({
      id: characterIds[index]!,
      kind: "character" as const,
      name,
      aliases: index === 0 ? ["阿砚", "沈公子"] : [`${name}的化名`],
    })),
    ...locationNames.map((name, index) => ({
      id: locationIds[index]!,
      kind: "location" as const,
      name,
      aliases: [],
    })),
    { id: factionId, kind: "faction", name: "听雪宗", aliases: ["北宗"] },
    ...itemIds.map((id, index) => ({
      id,
      kind: "item" as const,
      name: ["忘川书", "照骨镜", "归墟令"][index]!,
      aliases: [],
    })),
  ];

  const volumes = createVolumes(plan);
  const chapters = createChapters(plan, characterIds, locationIds);
  const branches = createBranches(plan);
  const facts = createFacts(plan, chapters, characterIds, locationIds, itemIds);
  const knowledgeStates = createKnowledgeStates(plan, chapters, characterIds, facts);
  const stateTransitions = createStateTransitions(plan, chapters, characterIds, facts);
  const items = createItems(plan, chapters, characterIds, locationIds, itemIds);
  const timeline = createTimeline(plan, chapters, characterIds, locationIds);
  const relationships = createRelationships(plan, chapters, characterIds);
  const mapRoutes = createMapRoutes(plan, locationIds);
  const plotThreads = createPlotThreads(plan);
  const foreshadows = createForeshadows(plan, chapters, facts);
  const styleSamples = createStyleSamples(plan, chapters, characterIds);
  const defects = createDefects(plan, chapters, facts, branches, characterIds);
  const controls = createControls(plan, chapters, branches, characterIds);
  const agentScenarios = createAgentScenarios(plan, defects, controls);

  const fixtureWithoutDigest = {
    plan,
    entities,
    relationships,
    chapters,
    volumes,
    branches,
    facts,
    knowledgeStates,
    stateTransitions,
    items,
    timeline,
    mapRoutes,
    plotThreads,
    foreshadows,
    styleSamples,
    defects,
    controls,
    agentScenarios,
  };
  const sha256 = createHash("sha256").update(JSON.stringify(fixtureWithoutDigest)).digest("hex");

  return {
    ...fixtureWithoutDigest,
    digest: {
      schemaVersion: 1,
      generatorVersion: "continuity-benchmark-v1",
      sourceCommit,
      seed: plan.seed,
      chapterCount: plan.chapterCount,
      volumeCount: plan.volumeCount,
      defectCount: defects.length,
      controlCount: controls.length,
      sha256,
    },
  };
}

function createVolumes(plan: ContinuityPlan): ContinuityVolume[] {
  const chaptersPerVolume = plan.chaptersPerVolume;
  return Array.from({ length: plan.volumeCount }, (_, index) => {
    const number = index + 1;
    return {
      id: uuid(plan.seed, `volume:${number}`),
      number,
      title: `第${number}卷 · ${["旧城雨", "忘川潮", "归墟火"][index % 3]}`,
      startChapter: index * chaptersPerVolume + 1,
      endChapter: number * chaptersPerVolume,
      goal: `完成第${number}阶段的主线推进`,
      conflict: `对手在第${number}卷升级并制造信息差`,
      climax: `卷末回收一条跨卷伏笔`,
    };
  });
}

function createChapters(
  plan: ContinuityPlan,
  characterIds: readonly string[],
  locationIds: readonly string[],
): ContinuityChapter[] {
  return Array.from({ length: plan.chapterCount }, (_, index) => {
    const number = index + 1;
    const volumeNumber = Math.ceil(number / plan.chaptersPerVolume);
    const povCharacterId = characterIds[(number - 1) % characterIds.length]!;
    const locationId = locationIds[(number - 1) % locationIds.length]!;
    return {
      id: uuid(plan.seed, `chapter:${number}`),
      number,
      volumeNumber,
      title: `第${number}章`,
      povCharacterId,
      locationId,
      summary: `${characterNames[(number - 1) % characterNames.length]}在${locationNames[(number - 1) % locationNames.length]}发现一处与旧案有关的线索。`,
      content: chapterContent(plan.seed, number),
      versionNodeId: uuid(plan.seed, `version:chapter:${number}`),
    };
  });
}

function createBranches(plan: ContinuityPlan): ContinuityBranch[] {
  const names = ["main", "early-divergence", "middle-divergence", "late-divergence"] as const;
  return names.map((name, index) => {
    const divergenceChapter = index === 0 ? null : plan.branchDivergenceChapters[index - 1]!;
    return {
      id: uuid(plan.seed, `branch:${name}`),
      name,
      commonAncestorChapter: index === 0 ? 0 : divergenceChapter!,
      divergenceChapter,
      chapterCount:
        divergenceChapter === null ? plan.chapterCount : plan.chapterCount - divergenceChapter + 1,
    };
  });
}

function createFacts(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  locationIds: readonly string[],
  itemIds: readonly string[],
): ContinuityFact[] {
  const definitions = [
    ["knows-hidden-origin", characterIds[0]!, "身世", "真实身世被宗门封存", "hidden"],
    ["death", characterIds[1]!, "生死", "在忘川渡假死", "hidden"],
    ["identity", characterIds[2]!, "身份", "灵魂转移至新身体", "hidden"],
    ["inventory", itemIds[0]!, "所有权", "忘川书由沈砚保管", "public"],
    ["location", characterIds[0]!, "位置", "在归墟", "public"],
    ["relationship", characterIds[0]!, "关系", "与顾青结盟", "public"],
    ["ability", characterIds[0]!, "能力", "只能承受一次返魂代价", "public"],
    ["timeline", characterIds[3]!, "时间", "北境关比旧城晚三十日", "public"],
    ["foreshadow", characterIds[1]!, "预言", "照骨镜会指向真名", "hidden"],
    ["limb", characterIds[0]!, "身体", "左臂骨折尚未痊愈", "public"],
    ["clone", characterIds[2]!, "分身", "独立分身不得继承本体记忆", "hidden"],
    ["motivation", characterIds[1]!, "目标", "必须保护旧城证人", "public"],
  ] as const;
  return definitions.map(([key, subjectId, relation, object, visibility], index) => {
    const chapter = chapters[Math.min(chapters.length - 1, chapterAt(plan, index / 12))]!;
    return {
      id: uuid(plan.seed, `fact:${key}`),
      subjectId,
      relation,
      object,
      validFromChapter: chapter.number,
      validToChapter: key === "limb" ? chapter.number + 20 : null,
      visibility,
      sourceChapterId: chapter.id,
      sourceEventId: uuid(plan.seed, `fact-event:${key}`),
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createKnowledgeStates(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  facts: readonly ContinuityFact[],
): CharacterKnowledgeState[] {
  const states: KnowledgeStateKind[] = ["knowledge", "belief", "suspicion", "misbelief", "unknown"];
  return states.map((state, index) => {
    const chapter = chapterAtReference(plan, chapters, (index + 1) / 6);
    const fact = facts[index % facts.length]!;
    return {
      id: uuid(plan.seed, `knowledge:${state}`),
      characterId: characterIds[index % characterIds.length]!,
      objectiveFactId: fact.id,
      state,
      claimedContent: state === "unknown" ? null : `角色对“${fact.object}”持${state}状态`,
      validFromChapter: chapter.number,
      validToChapter: null,
      sourceChapterId: chapter.id,
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createStateTransitions(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  facts: readonly ContinuityFact[],
): StateTransition[] {
  const definitions = [
    ["body", "健康", "左臂骨折"],
    ["ability", "未觉醒", "返魂能力觉醒"],
    ["identity", characterIds[2]!, "新身体与原身份分离"],
    ["location", "旧城", "归墟"],
    ["relationship", "敌对", "临时结盟"],
  ] as const;
  return definitions.map(([kind, fromState, toState], index) => {
    const chapter = chapterAtReference(plan, chapters, 0.18 + index * 0.16);
    return {
      id: uuid(plan.seed, `transition:${kind}`),
      kind,
      subjectId: characterIds[index % characterIds.length]!,
      fromState,
      toState,
      chapterNumber: chapter.number,
      sourceEventId: facts[index]!.sourceEventId,
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createItems(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  locationIds: readonly string[],
  itemIds: readonly string[],
): ContinuityItem[] {
  return itemIds.map((id, index) => {
    const chapter = chapters[Math.min(chapters.length - 1, chapterAt(plan, 0.2 + index * 0.25))]!;
    return {
      id,
      name: ["忘川书", "照骨镜", "归墟令"][index]!,
      rights: {
        ownerId: characterIds[index % characterIds.length]!,
        custodianId: characterIds[(index + 1) % characterIds.length]!,
        locationId: locationIds[index % locationIds.length]!,
        usageRightId: characterIds[(index + 2) % characterIds.length]!,
      },
      validFromChapter: chapter.number,
      validToChapter: null,
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createTimeline(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  locationIds: readonly string[],
): TimelineEvent[] {
  return Array.from({ length: Math.min(chapters.length, 24) }, (_, index) => {
    const chapter = chapters[chapterAt(plan, (index + 1) / (Math.min(chapters.length, 24) + 1))]!;
    return {
      id: uuid(plan.seed, `timeline:${index}`),
      chapterNumber: chapter.number,
      storyTimeLabel: `第${chapter.volumeNumber}年春-${index + 1}`,
      storySortKey: chapter.number * 1_000 + index,
      locationId: locationIds[index % locationIds.length]!,
      participants: [characterIds[index % characterIds.length]!],
    };
  });
}

function createRelationships(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
): EntityRelationship[] {
  return (
    [
      ["ally", "盟友"],
      ["rival", "对手"],
      ["mentor", "师承"],
    ] as const
  ).map(([type], index) => {
    const chapter = chapterAtReference(plan, chapters, 0.25 + index * 0.2);
    return {
      id: uuid(plan.seed, `relationship:${type}`),
      fromId: characterIds[index]!,
      toId: characterIds[(index + 1) % characterIds.length]!,
      type,
      validFromChapter: chapter.number,
      validToChapter: null,
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createMapRoutes(plan: ContinuityPlan, locationIds: readonly string[]): MapRoute[] {
  return locationIds.slice(1).map((locationId, index) => ({
    id: uuid(plan.seed, `route:${index}`),
    fromLocationId: locationIds[index]!,
    toLocationId: locationId,
    travelMinutes: [180, 720, 1_440][index] ?? 1_440,
    bidirectional: true,
  }));
}

function createPlotThreads(plan: ContinuityPlan): PlotThread[] {
  return [
    ["main-plot", "找回忘川书", 1, plan.chapterCount],
    ["hidden-origin", "身世真相", chapterAt(plan, 0.1), chapterAt(plan, 0.85)],
    ["antagonist", "听雪宗旧案", chapterAt(plan, 0.2), chapterAt(plan, 0.95)],
  ].map(([id, name, startChapter, endChapter]) => ({
    id: uuid(plan.seed, `plot:${id}`),
    name: String(name),
    status: "paid_off",
    startChapter: Number(startChapter),
    endChapter: Number(endChapter),
  }));
}

function createForeshadows(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  facts: readonly ContinuityFact[],
): Foreshadow[] {
  return [
    ["照骨镜真名", 0.07, 0.74, "paid_off", 3],
    ["归墟令双主", 0.23, 0.91, "paid_off", 2],
    ["假死旧信", 0.43, 0.83, "paid_off", 3],
  ].map(([label, setup, payoff, status, importance], index) => {
    const setupChapter = chapterAtReference(plan, chapters, Number(setup));
    return {
      id: uuid(plan.seed, `foreshadow:${index}`),
      label: String(label),
      setupChapter: setupChapter.number,
      payoffChapter: chapterAt(plan, Number(payoff)),
      status: status as Foreshadow["status"],
      importance: importance as Foreshadow["importance"],
      sourceEventId: facts[index]!.sourceEventId,
    };
  });
}

function createStyleSamples(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
): StyleSample[] {
  return [0.12, 0.5, 0.9].map((position, index) => {
    const chapter = chapterAtReference(plan, chapters, position);
    return {
      id: uuid(plan.seed, `style:${index}`),
      characterId: characterIds[index % characterIds.length]!,
      volumeNumber: chapter.volumeNumber,
      approvalStatus: "approved",
      provenance: `chapter:${chapter.number}`,
      sampleText: chapter.content.slice(0, Math.min(120, chapter.content.length)),
    };
  });
}

function createDefects(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  facts: readonly ContinuityFact[],
  branches: readonly ContinuityBranch[],
  characterIds: readonly string[],
): ContinuityDefect[] {
  const defectDefinitions: Array<{
    family: Exclude<ContinuityScenarioFamily, "false_alarm" | "incomplete_context">;
    severity: ContinuitySeverity;
    factIndex: number;
  }> = [
    { family: "knowledge_boundary", severity: "P0", factIndex: 0 },
    { family: "body_continuity", severity: "P0", factIndex: 9 },
    { family: "identity_transition", severity: "P0", factIndex: 2 },
    { family: "inventory_rights", severity: "P1", factIndex: 3 },
    { family: "travel_time", severity: "P1", factIndex: 7 },
    { family: "foreshadow_payoff", severity: "P1", factIndex: 8 },
    { family: "motivation_drift", severity: "P2", factIndex: 11 },
    { family: "branch_divergence", severity: "P0", factIndex: 6 },
  ];
  const positions = [0.1, 0.5, 0.9] as const;
  return defectDefinitions.flatMap((definition) =>
    positions.map((position, positionIndex) => {
      const branch =
        definition.family === "branch_divergence" ? branches[positionIndex + 1] : branches[0];
      const chapterNumber =
        definition.family === "branch_divergence" && branch?.divergenceChapter
          ? branch.divergenceChapter
          : chapterAt(plan, position);
      const chapter = chapterAtReference(plan, chapters, chapterNumber / plan.chapterCount);
      const fact = facts[definition.factIndex]!;
      return {
        id: uuid(plan.seed, `defect:${definition.family}:${positionIndex}`),
        family: definition.family,
        severity: definition.severity,
        chapterNumber,
        branchId: branch?.id ?? branches[0]!.id,
        entityIds: [characterIds[positionIndex % characterIds.length]!],
        sourceFactId: fact.id,
        versionNodeId: chapter.versionNodeId,
        description: `${definition.family} seeded defect at chapter ${chapterNumber}`,
        evidence: `Chapter ${chapterNumber} contradicts ${fact.relation}: ${fact.object}`,
      };
    }),
  );
}

function createControls(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  branches: readonly ContinuityBranch[],
  characterIds: readonly string[],
): ContinuityControl[] {
  const controls: ContinuityControl[] = [];
  for (const [index, family] of continuityDefectFamilies().entries()) {
    const chapter = chapterAtReference(plan, chapters, 0.25 + (index % 5) * 0.08);
    controls.push({
      id: uuid(plan.seed, `control:clean:${family}`),
      family,
      mode: "clean",
      chapterNumber: chapter.number,
      branchId: branches[0]!.id,
      entityIds: [characterIds[index % characterIds.length]!],
      reason: "known-safe continuity window",
    });
  }
  controls.push(
    {
      id: uuid(plan.seed, "control:false-alarm"),
      family: "false_alarm",
      mode: "false_alarm",
      chapterNumber: chapterAtReference(plan, chapters, 0.72).number,
      branchId: branches[0]!.id,
      entityIds: [characterIds[0]!],
      reason: "surface similarity without contradiction",
    },
    {
      id: uuid(plan.seed, "control:incomplete-context"),
      family: "incomplete_context",
      mode: "incomplete_context",
      chapterNumber: chapterAtReference(plan, chapters, 0.62).number,
      branchId: branches[1]!.id,
      entityIds: [characterIds[1]!],
      reason: "required hidden context is intentionally absent",
    },
  );
  return controls;
}

function createAgentScenarios(
  plan: ContinuityPlan,
  defects: readonly ContinuityDefect[],
  controls: readonly ContinuityControl[],
): ContinuityAgentScenario[] {
  const scenarios: ContinuityAgentScenario[] = defects.map((defect, index) => {
    const highRisk = defect.severity === "P0";
    return {
      id: uuid(plan.seed, `agent-scenario:${defect.family}:${index}`),
      expectedDisposition: highRisk ? "escalate" : "propose_repair",
      expectedDefectIds: [defect.id],
      controlIds: [],
      allowedTools: highRisk
        ? ["read_fact", "read_context", "propose_change", "request_author_approval"]
        : ["read_fact", "read_context", "propose_change", "apply_preapproved_repair"],
      forbiddenTools: ["submit_canon", "grant_permission", "rewrite_locked_text"],
      budgetTokens: highRisk ? 4_000 : 2_000,
      maxImpactObjects: highRisk ? 1 : 3,
      requiresApproval: highRisk,
      description: highRisk
        ? "高风险连续性冲突只能提出修复请求并等待作者批准"
        : "低风险连续性问题可在既定 grant 内提出并执行预批准修复",
    };
  });
  for (const control of controls) {
    const incomplete = control.mode === "incomplete_context";
    scenarios.push({
      id: uuid(plan.seed, `agent-control:${control.mode}:${control.id}`),
      expectedDisposition: incomplete ? "escalate" : "abstain",
      expectedDefectIds: [],
      controlIds: [control.id],
      allowedTools: ["read_fact", "read_context"],
      forbiddenTools: ["submit_canon", "grant_permission", "rewrite_locked_text"],
      budgetTokens: 1_000,
      maxImpactObjects: 1,
      requiresApproval: incomplete,
      description: incomplete
        ? "上下文不足时必须升级复核，不得把缺失信息当成矛盾"
        : "表面相似但无真实矛盾时必须克制不修改",
    });
  }
  return scenarios;
}

function continuityDefectFamilies(): Exclude<
  ContinuityScenarioFamily,
  "false_alarm" | "incomplete_context" | "branch_divergence"
>[] {
  return [
    "knowledge_boundary",
    "body_continuity",
    "identity_transition",
    "inventory_rights",
    "travel_time",
    "foreshadow_payoff",
    "motivation_drift",
  ];
}

function chapterAtReference(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  position: number,
): ContinuityChapter {
  return chapters[chapterAt(plan, position)]!;
}

function chapterAt(plan: ContinuityPlan, position: number): number {
  return Math.max(
    0,
    Math.min(plan.chapterCount - 1, Math.round((plan.chapterCount - 1) * position)),
  );
}

function chapterContent(seed: number, chapterNumber: number): string {
  const random = mulberry32(seed ^ Math.imul(chapterNumber, 0x9e3779b1));
  let content = `${characterNames[chapterNumber % characterNames.length]}走进${locationNames[chapterNumber % locationNames.length]}。`;
  while (content.length < 240) {
    content += phrasePool[Math.floor(random() * phrasePool.length)]!;
  }
  return content.slice(0, 240);
}

function uuid(seed: number, namespace: string): string {
  const hash = createHash("sha256").update(`${seed}:${namespace}`).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "7";
  const variant = Number.parseInt(chars[16]!, 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20,
  )}-${value.slice(20)}`;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
