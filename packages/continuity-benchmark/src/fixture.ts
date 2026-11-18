import { createHash } from "node:crypto";

import {
  continuityDefectFamilies,
  continuityScenarioMetadata,
  type ContinuityPlan,
  type ContinuityScenarioFamily,
  type ContinuitySeverity,
} from "./plan";

export type KnowledgeStateKind = "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown";
export type ControlMode = "clean" | "false_alarm" | "incomplete_context";
export type FactDecisionState = "proposed" | "confirmed" | "locked" | "superseded";

export interface ContinuityEntity {
  id: string;
  kind: "character" | "faction" | "location" | "item";
  name: string;
  aliases: readonly string[];
}

export interface EntityRelationship {
  id: string;
  branchId: string;
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

export interface BranchChapterSnapshot {
  id: string;
  branchId: string;
  chapterNumber: number;
  volumeNumber: number;
  title: string;
  summary: string;
  content: string;
  versionNodeId: string;
}

export interface ContinuityFact {
  id: string;
  branchId: string;
  subjectId: string;
  relation: string;
  object: string;
  validFromChapter: number;
  validToChapter: number | null;
  visibility: "public" | "hidden";
  objectiveCanon: boolean;
  decisionState: FactDecisionState;
  allowedDisclosureFromChapter: number | null;
  sourceChapterId: string;
  sourceEventId: string;
  versionNodeId: string;
}

export interface CharacterKnowledgeState {
  id: string;
  branchId: string;
  characterId: string;
  objectiveFactId: string;
  state: KnowledgeStateKind;
  claimedContent: string | null;
  validFromChapter: number;
  validToChapter: number | null;
  decisionState: FactDecisionState;
  allowedDisclosureFromChapter: number | null;
  sourceChapterId: string;
  versionNodeId: string;
}

export interface StateTransition {
  id: string;
  branchId: string;
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
  branchId: string;
  name: string;
  rights: ItemRights;
  validFromChapter: number;
  validToChapter: number | null;
  versionNodeId: string;
}

export type ItemRightsAction =
  | "transfer"
  | "theft"
  | "loan"
  | "inheritance"
  | "consumption"
  | "destruction"
  | "crafting"
  | "recovery"
  | "disposal";

export interface ItemRightsTransition {
  id: string;
  branchId: string;
  itemId: string;
  action: ItemRightsAction;
  fromRights: ItemRights | null;
  toRights: ItemRights | null;
  chapterNumber: number;
  sourceEventId: string;
  versionNodeId: string;
}

export interface TimelineEvent {
  id: string;
  branchId: string;
  chapterNumber: number;
  storyTimeLabel: string;
  storyTimeStartLabel: string;
  storyTimeEndLabel: string;
  storySortKey: number;
  simultaneousGroup: string | null;
  isTimeSkip: boolean;
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

export interface MapNode {
  id: string;
  branchId: string;
  parentId: string | null;
  scale: "world" | "realm" | "region" | "city";
  name: string;
}

export interface PlotThread {
  id: string;
  branchId: string;
  name: string;
  status: "planned" | "active" | "paid_off" | "abandoned";
  startChapter: number;
  endChapter: number | null;
}

export interface Foreshadow {
  id: string;
  branchId: string;
  label: string;
  kind: "setup" | "false_lead";
  setupChapter: number;
  payoffChapter: number;
  status: "planted" | "paid_off" | "abandoned";
  importance: 1 | 2 | 3;
  abandonmentReason: string | null;
  sourceEventId: string;
}

export interface StyleSample {
  id: string;
  branchId: string;
  characterId: string;
  volumeNumber: number;
  approvalStatus: "approved";
  provenance: string;
  sampleText: string;
}

export interface ContinuityLocator {
  family: ContinuityScenarioFamily;
  chapterNumber: number;
  branchId: string;
  entityIds: readonly string[];
}

export interface ContinuityDefect extends ContinuityLocator {
  id: string;
  severity: ContinuitySeverity;
  sourceFactId: string;
  versionNodeId: string;
  description: string;
  evidence: string;
}

export interface ContinuityControl extends ContinuityLocator {
  id: string;
  mode: ControlMode;
  reason: string;
}

export interface WorldRule {
  id: string;
  branchId: string;
  statement: string;
  locked: boolean;
  sourceEventId: string;
}

export interface StoryBible {
  id: string;
  title: string;
  premise: string;
  protagonistId: string;
  endingPromise: string;
  worldRules: readonly WorldRule[];
  lockedConstraints: readonly string[];
}

export interface GenrePack {
  id: string;
  name: "仙侠" | "历史" | "都市";
  version: string;
  requiredEntityKinds: readonly ContinuityEntity["kind"][];
  continuityRules: readonly string[];
}

export interface PowerRealm {
  name: string;
  order: number;
  lifespanYears: number | null;
  breakthroughCost: string;
}

export interface PowerSystem {
  id: string;
  branchId: string;
  name: string;
  realms: readonly PowerRealm[];
  restrictions: readonly string[];
  lifespanPolicy: string;
}

export interface SpecialMechanism {
  id: string;
  branchId: string;
  ownerId: string;
  name: string;
  rules: readonly string[];
  costs: readonly string[];
  limitations: readonly string[];
  growth: readonly string[];
  locked: boolean;
}

export type OutlineLevel = "book" | "volume" | "act" | "chapter" | "scene";

export interface OutlineNode {
  id: string;
  branchId: string;
  level: OutlineLevel;
  parentId: string | null;
  title: string;
  goal: string;
  chapterNumber: number | null;
  requiredBeats: readonly string[];
}

export type IdentityTransitionKind =
  | "death"
  | "resurrection"
  | "soul_split"
  | "possession"
  | "reincarnation"
  | "same_identity_new_body"
  | "new_identity_inherited_memories"
  | "temporary_control"
  | "independent_clone";

export interface IdentityTransition {
  id: string;
  branchId: string;
  subjectId: string;
  kind: IdentityTransitionKind;
  fromBodyId: string | null;
  toBodyId: string | null;
  memoryRetention: "none" | "partial" | "full";
  limits: readonly string[];
  chapterNumber: number;
  sourceEventId: string;
  versionNodeId: string;
}

export interface CharacterArc {
  id: string;
  branchId: string;
  characterId: string;
  goal: string;
  fear: string;
  startChapter: number;
  endChapter: number;
  turningPoints: readonly string[];
}

export interface CharacterPowerState {
  id: string;
  branchId: string;
  characterId: string;
  realm: string;
  ageYears: number;
  remainingLifespanYears: number;
  previousLifespanYears: number;
  transition: "baseline" | "breakthrough" | "lifespan_decay" | "resurrection_penalty";
  chapterNumber: number;
  sourceEventId: string;
  versionNodeId: string;
}

export type AgentWorkflowStage =
  | "detect"
  | "cite_evidence"
  | "classify_severity"
  | "propose_repair"
  | "check_task_envelope"
  | "execute_or_escalate"
  | "rerun_checks"
  | "record_change_ledger";

export interface AgentWorkflowStep {
  stage: AgentWorkflowStage;
  required: true;
  expectedAction: string;
  evidenceIds: readonly string[];
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
  workflow: readonly AgentWorkflowStep[];
  expectedResult: {
    disposition: ContinuityAgentScenario["expectedDisposition"];
    canonMutated: false;
    approvalRequested: boolean;
    rerunCompleted: true;
    ledgerEntryRecorded: true;
    additionalPermissionsGranted: false;
  };
  description: string;
}

export interface ContinuityFixture {
  plan: ContinuityPlan;
  storyBible: StoryBible;
  genrePack: GenrePack;
  genrePacks: readonly GenrePack[];
  powerSystem: PowerSystem;
  specialMechanisms: readonly SpecialMechanism[];
  entities: readonly ContinuityEntity[];
  relationships: readonly EntityRelationship[];
  chapters: readonly ContinuityChapter[];
  volumes: readonly ContinuityVolume[];
  branches: readonly ContinuityBranch[];
  branchChapters: readonly BranchChapterSnapshot[];
  outlineNodes: readonly OutlineNode[];
  facts: readonly ContinuityFact[];
  knowledgeStates: readonly CharacterKnowledgeState[];
  stateTransitions: readonly StateTransition[];
  identityTransitions: readonly IdentityTransition[];
  items: readonly ContinuityItem[];
  itemRightsTransitions: readonly ItemRightsTransition[];
  timeline: readonly TimelineEvent[];
  mapNodes: readonly MapNode[];
  mapRoutes: readonly MapRoute[];
  plotThreads: readonly PlotThread[];
  foreshadows: readonly Foreshadow[];
  styleSamples: readonly StyleSample[];
  characterArcs: readonly CharacterArc[];
  characterPowerStates: readonly CharacterPowerState[];
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
  const branchChapters = createBranchChapters(plan, chapters, branches);
  const genrePacks = createGenrePacks(plan);
  const genrePack = genrePacks[0]!;
  const storyBible = createStoryBible(plan, characterIds[0]!, branches[0]!.id);
  const powerSystem = createPowerSystem(plan, branches[0]!.id);
  const specialMechanisms = createSpecialMechanisms(plan, characterIds, branches[0]!.id);
  const outlineNodes = createOutlineNodes(plan, chapters, volumes, branches[0]!.id);
  const facts = createFacts(plan, chapters, characterIds, itemIds, branches);
  const knowledgeStates = createKnowledgeStates(plan, chapters, characterIds, facts, branches);
  const stateTransitions = createStateTransitions(plan, chapters, characterIds, facts, branches);
  const identityTransitions = createIdentityTransitions(
    plan,
    chapters,
    characterIds,
    facts,
    branches,
  );
  const items = createItems(plan, chapters, characterIds, locationIds, itemIds, branches);
  const itemRightsTransitions = createItemRightsTransitions(plan, chapters, items, branches[0]!.id);
  const timeline = createTimeline(plan, chapters, characterIds, locationIds, branches);
  const relationships = createRelationships(plan, chapters, characterIds, branches);
  const mapNodes = createMapNodes(plan, locationIds, branches[0]!.id);
  const mapRoutes = createMapRoutes(plan, locationIds);
  const plotThreads = createPlotThreads(plan, branches[0]!.id);
  const foreshadows = createForeshadows(plan, chapters, facts, branches[0]!.id);
  const styleSamples = createStyleSamples(plan, chapters, characterIds, branches[0]!.id);
  const characterArcs = createCharacterArcs(plan, characterIds, branches[0]!.id);
  const characterPowerStates = createCharacterPowerStates(
    plan,
    chapters,
    characterIds,
    branches[0]!.id,
  );
  const defects = createDefects(plan, chapters, facts, branches, characterIds);
  applyDefectEvidence(chapters, defects);
  const controls = createControls(plan, chapters, branches, characterIds);
  const agentScenarios = createAgentScenarios(plan, defects, controls);

  const fixtureWithoutDigest = {
    plan,
    storyBible,
    genrePack,
    genrePacks,
    powerSystem,
    specialMechanisms,
    entities,
    relationships,
    chapters,
    volumes,
    branches,
    branchChapters,
    outlineNodes,
    facts,
    knowledgeStates,
    stateTransitions,
    identityTransitions,
    items,
    itemRightsTransitions,
    timeline,
    mapNodes,
    mapRoutes,
    plotThreads,
    foreshadows,
    styleSamples,
    characterArcs,
    characterPowerStates,
    defects,
    controls,
    agentScenarios,
  };
  const sha256 = continuityFixtureSha256(fixtureWithoutDigest);

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

export function verifyContinuityFixtureDigest(fixture: ContinuityFixture): boolean {
  const { digest, ...fixtureWithoutDigest } = fixture;
  return digest.sha256 === continuityFixtureSha256(fixtureWithoutDigest);
}

function continuityFixtureSha256(fixtureWithoutDigest: Omit<ContinuityFixture, "digest">): string {
  return createHash("sha256").update(JSON.stringify(fixtureWithoutDigest)).digest("hex");
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

function createBranchChapters(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  branches: readonly ContinuityBranch[],
): BranchChapterSnapshot[] {
  return branches.slice(1).flatMap((branch) => {
    const divergenceChapter = branch.divergenceChapter!;
    const span = plan.chapterCount - divergenceChapter;
    return [0, 1 / 3, 2 / 3, 1].map((position) => {
      const chapterNumber = Math.min(
        plan.chapterCount,
        divergenceChapter + Math.round(span * position),
      );
      const source = chapterByNumber(chapters, chapterNumber);
      return {
        id: uuid(plan.seed, `branch-chapter:${branch.name}:${chapterNumber}`),
        branchId: branch.id,
        chapterNumber,
        volumeNumber: source.volumeNumber,
        title: `${branch.name} · ${source.title}`,
        summary: `${source.summary} 该摘要与后续状态只属于 ${branch.name} 分支。`,
        content: `${source.content}\n【分支状态】当前内容仅属于 ${branch.name}。`,
        versionNodeId: uuid(plan.seed, `version:${branch.name}:${chapterNumber}`),
      };
    });
  });
}

function createGenrePacks(plan: ContinuityPlan): GenrePack[] {
  return [
    {
      id: uuid(plan.seed, "genre-pack:xianxia"),
      name: "仙侠",
      version: "xianxia-v1",
      requiredEntityKinds: ["character", "faction", "location", "item"],
      continuityRules: [
        "境界突破必须有事件、代价与限制",
        "返魂与夺舍必须记录灵魂承载关系",
        "独立分身不得默认共享本体记忆",
      ],
    },
    {
      id: uuid(plan.seed, "genre-pack:history"),
      name: "历史",
      version: "history-v1",
      requiredEntityKinds: ["character", "faction", "location", "item"],
      continuityRules: [
        "官职、封地与继承必须按纪年和事件更新",
        "书信传递延迟必须符合路线与季节",
        "真实历史人物不得无来源改变身份",
      ],
    },
    {
      id: uuid(plan.seed, "genre-pack:urban"),
      name: "都市",
      version: "urban-v1",
      requiredEntityKinds: ["character", "faction", "location", "item"],
      continuityRules: [
        "通讯、交通和资金流水必须保持时间顺序",
        "企业职位与持股关系必须分别记录",
        "身份公开必须来源于可观察披露事件",
      ],
    },
  ];
}

function createStoryBible(
  plan: ContinuityPlan,
  protagonistId: string,
  branchId: string,
): StoryBible {
  return {
    id: uuid(plan.seed, "story-bible:main"),
    title: "忘川旧梦",
    premise: "失忆修士在旧城追查身世，发现宗门以返魂术掩盖旧案。",
    protagonistId,
    endingPromise: "主角必须支付一次返魂代价，才能保住证人并揭开真名。",
    worldRules: [
      {
        id: uuid(plan.seed, "world-rule:resurrection"),
        branchId,
        statement: "返魂只能发生一次，且必须消耗一个已记录的魂魄载体。",
        locked: true,
        sourceEventId: uuid(plan.seed, "world-rule-event:resurrection"),
      },
      {
        id: uuid(plan.seed, "world-rule:identity"),
        branchId,
        statement: "夺舍、转世与分身必须分别记录身体、记忆和控制权。",
        locked: true,
        sourceEventId: uuid(plan.seed, "world-rule-event:identity"),
      },
      {
        id: uuid(plan.seed, "world-rule:knowledge"),
        branchId,
        statement: "隐藏真相只有在可观察的揭示事件后才能进入角色认知。",
        locked: true,
        sourceEventId: uuid(plan.seed, "world-rule-event:knowledge"),
      },
    ],
    lockedConstraints: [
      "章节批准、事实确认与故事事实提交是三个独立状态转换",
      "客观正史与角色信念不可互相替代",
      "任何高风险连续性修复都需要作者批准",
    ],
  };
}

function createPowerSystem(plan: ContinuityPlan, branchId: string): PowerSystem {
  return {
    id: uuid(plan.seed, "power-system:returning-soul"),
    branchId,
    name: "返魂境界",
    realms: [
      {
        name: "引气",
        order: 1,
        lifespanYears: 100,
        breakthroughCost: "消耗一枚引气丹",
      },
      {
        name: "照骨",
        order: 2,
        lifespanYears: 180,
        breakthroughCost: "承受一次骨骼重塑",
      },
      {
        name: "返魂",
        order: 3,
        lifespanYears: 300,
        breakthroughCost: "献祭一段可验证的旧记忆",
      },
    ],
    restrictions: [
      "跨境界恢复能力必须有突破或返魂事件",
      "寿命延长只在境界事件生效后更新",
      "灵魂状态不完整时禁止突破",
    ],
    lifespanPolicy: "寿命随境界递增；返魂不重置年龄，只延长当前境界上限。",
  };
}

function createSpecialMechanisms(
  plan: ContinuityPlan,
  characterIds: readonly string[],
  branchId: string,
): SpecialMechanism[] {
  return [
    {
      id: uuid(plan.seed, "special-mechanism:mirror-book"),
      branchId,
      ownerId: characterIds[0]!,
      name: "忘川书回响",
      rules: ["读取过去事件时只能看到已发生正史"],
      costs: ["每次读取消耗一段当前记忆"],
      limitations: ["不能读取未来", "不能读取其他分支未合并事实"],
      growth: ["完成卷末揭示后可读取更深层来源"],
      locked: true,
    },
    {
      id: uuid(plan.seed, "special-mechanism:soul-lantern"),
      branchId,
      ownerId: characterIds[1]!,
      name: "照骨灯",
      rules: ["可确认一个身体是否承载同一灵魂"],
      costs: ["每次使用损失三日寿元"],
      limitations: ["无法判断新旧身份的道德归属", "分身视为独立承载者"],
      growth: ["收集三枚灯芯后可验证被遮蔽的记忆"],
      locked: true,
    },
  ];
}

function createOutlineNodes(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  volumes: readonly ContinuityVolume[],
  branchId: string,
): OutlineNode[] {
  const bookId = uuid(plan.seed, "outline:book");
  const nodes: OutlineNode[] = [
    {
      id: bookId,
      branchId,
      level: "book",
      parentId: null,
      title: "全书",
      goal: "完成跨卷主线与身世揭示",
      chapterNumber: null,
      requiredBeats: ["开篇钩子", "中段反转", "卷末回收", "结局承诺"],
    },
  ];
  const actsPerVolume = 4;
  const chaptersPerAct = plan.chaptersPerVolume / actsPerVolume;
  const actIds = new Map<string, string>();
  for (const volume of volumes) {
    const volumeId = uuid(plan.seed, `outline:volume:${volume.number}`);
    nodes.push({
      id: volumeId,
      branchId,
      level: "volume",
      parentId: bookId,
      title: volume.title,
      goal: volume.goal,
      chapterNumber: null,
      requiredBeats: [volume.conflict, volume.climax],
    });
    for (let act = 1; act <= actsPerVolume; act += 1) {
      const actId = uuid(plan.seed, `outline:act:${volume.number}:${act}`);
      actIds.set(`${volume.number}:${act}`, actId);
      nodes.push({
        id: actId,
        branchId,
        level: "act",
        parentId: volumeId,
        title: `第${volume.number}卷第${act}幕`,
        goal: `推进第${volume.number}卷第${act}阶段`,
        chapterNumber: null,
        requiredBeats: ["目标升级", "信息差", "阶段转折"],
      });
    }
  }

  for (const chapter of chapters) {
    const chapterId = uuid(plan.seed, `outline:chapter:${chapter.number}`);
    const chapterInVolume = ((chapter.number - 1) % plan.chaptersPerVolume) + 1;
    const act = Math.ceil(chapterInVolume / chaptersPerAct);
    const actId = actIds.get(`${chapter.volumeNumber}:${act}`)!;
    nodes.push({
      id: chapterId,
      branchId,
      level: "chapter",
      parentId: actId,
      title: chapter.title,
      goal: chapter.summary,
      chapterNumber: chapter.number,
      requiredBeats: ["章目标", "冲突升级", "章末钩子"],
    });
    nodes.push({
      id: uuid(plan.seed, `outline:scene:${chapter.number}:1`),
      branchId,
      level: "scene",
      parentId: chapterId,
      title: `${chapter.title} · 场景一`,
      goal: "释放一条可追溯信息",
      chapterNumber: chapter.number,
      requiredBeats: ["POV", "信息释放", "不可逆选择"],
    });
  }
  return nodes;
}

function createFacts(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  itemIds: readonly string[],
  branches: readonly ContinuityBranch[],
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
  const mainBranchId = branches[0]!.id;
  const facts = definitions.map(([key, subjectId, relation, object, visibility], index) => {
    const chapter = chapterAtReference(plan, chapters, index / 12);
    const decisionState = (["confirmed", "locked", "proposed", "superseded"] as const)[index % 4]!;
    return {
      id: uuid(plan.seed, `fact:${key}`),
      branchId: mainBranchId,
      subjectId,
      relation,
      object,
      validFromChapter: chapter.number,
      validToChapter: key === "limb" ? chapter.number + 20 : null,
      visibility,
      objectiveCanon: decisionState === "confirmed" || decisionState === "locked",
      decisionState,
      allowedDisclosureFromChapter:
        visibility === "hidden"
          ? chapterNumberAt(plan, Math.min(0.95, chapter.number / plan.chapterCount + 0.25))
          : null,
      sourceChapterId: chapter.id,
      sourceEventId: uuid(plan.seed, `fact-event:${key}`),
      versionNodeId: chapter.versionNodeId,
    };
  });
  const branchFacts = branches.slice(1).map((branch, index) => {
    const divergenceChapter = branch.divergenceChapter!;
    const chapterNumber = Math.min(
      plan.chapterCount,
      divergenceChapter + Math.max(1, Math.floor((plan.chapterCount - divergenceChapter) / 3)),
    );
    const chapter = chapterByNumber(chapters, chapterNumber);
    return {
      id: uuid(plan.seed, `fact:branch-${branch.name}`),
      branchId: branch.id,
      subjectId: characterIds[index % characterIds.length]!,
      relation: "分支正史",
      object: `仅 ${branch.name} 分支存在的连续性事实`,
      validFromChapter: chapter.number,
      validToChapter: null,
      visibility: "hidden" as const,
      objectiveCanon: true,
      decisionState: "locked" as const,
      allowedDisclosureFromChapter: chapter.number,
      sourceChapterId: chapter.id,
      sourceEventId: uuid(plan.seed, `fact-event:branch-${branch.name}`),
      versionNodeId: chapter.versionNodeId,
    };
  });
  return [...facts, ...branchFacts];
}

function createKnowledgeStates(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  facts: readonly ContinuityFact[],
  branches: readonly ContinuityBranch[],
): CharacterKnowledgeState[] {
  const states: KnowledgeStateKind[] = ["knowledge", "belief", "suspicion", "misbelief", "unknown"];
  const mainBranchId = branches[0]!.id;
  const mainStates: CharacterKnowledgeState[] = states.map((state, index) => {
    const chapter = chapterAtReference(plan, chapters, (index + 1) / 6);
    const fact = facts[index % facts.length]!;
    return {
      id: uuid(plan.seed, `knowledge:${state}`),
      branchId: mainBranchId,
      characterId: characterIds[index % characterIds.length]!,
      objectiveFactId: fact.id,
      state,
      claimedContent: state === "unknown" ? null : `角色对“${fact.object}”持${state}状态`,
      validFromChapter: chapter.number,
      validToChapter: null,
      decisionState: state === "unknown" ? "proposed" : "confirmed",
      allowedDisclosureFromChapter: state === "unknown" ? null : chapter.number,
      sourceChapterId: chapter.id,
      versionNodeId: chapter.versionNodeId,
    };
  });
  const branchStates: CharacterKnowledgeState[] = branches
    .slice(1)
    .flatMap((branch, branchIndex) => {
      const branchFact = facts.find((fact) => fact.branchId === branch.id)!;
      return (["knowledge", "unknown"] as const).map((state, stateIndex) => {
        const chapter = chapterAtReference(
          plan,
          chapters,
          0.2 + branchIndex * 0.26 + stateIndex * 0.04,
        );
        return {
          id: uuid(plan.seed, `knowledge:${branch.name}:${state}`),
          branchId: branch.id,
          characterId: characterIds[(branchIndex + stateIndex) % characterIds.length]!,
          objectiveFactId: branchFact.id,
          state,
          claimedContent: state === "unknown" ? null : `分支角色知道“${branchFact.object}”`,
          validFromChapter: chapter.number,
          validToChapter: null,
          decisionState: state === "unknown" ? "proposed" : "locked",
          allowedDisclosureFromChapter: state === "unknown" ? null : chapter.number,
          sourceChapterId: chapter.id,
          versionNodeId: chapter.versionNodeId,
        };
      });
    });
  return [...mainStates, ...branchStates];
}

function createStateTransitions(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  facts: readonly ContinuityFact[],
  branches: readonly ContinuityBranch[],
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
      branchId: branches[0]!.id,
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
  branches: readonly ContinuityBranch[],
): ContinuityItem[] {
  return itemIds.map((id, index) => {
    const chapter = chapterAtReference(plan, chapters, 0.2 + index * 0.25);
    return {
      id,
      branchId: branches[0]!.id,
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

function createItemRightsTransitions(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  items: readonly ContinuityItem[],
  branchId: string,
): ItemRightsTransition[] {
  const actions: readonly ItemRightsAction[] = [
    "transfer",
    "theft",
    "loan",
    "inheritance",
    "consumption",
    "destruction",
    "crafting",
    "recovery",
    "disposal",
  ];
  return actions.map((action, index) => {
    const item = items[index % items.length]!;
    const chapter = chapterAtReference(plan, chapters, 0.16 + index * 0.08);
    const lostItem = ["consumption", "destruction", "disposal"].includes(action);
    return {
      id: uuid(plan.seed, `item-rights:${item.id}:${action}`),
      branchId,
      itemId: item.id,
      action,
      fromRights: item.rights,
      toRights: lostItem
        ? null
        : {
            ...item.rights,
            custodianId: item.rights.ownerId,
            usageRightId: item.rights.ownerId,
          },
      chapterNumber: chapter.number,
      sourceEventId: uuid(plan.seed, `item-rights-event:${item.id}:${action}`),
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createTimeline(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  locationIds: readonly string[],
  branches: readonly ContinuityBranch[],
): TimelineEvent[] {
  const mainEvents = Array.from({ length: Math.min(chapters.length, 24) }, (_, index) => {
    const chapter = chapterAtReference(
      plan,
      chapters,
      (index + 1) / (Math.min(chapters.length, 24) + 1),
    );
    return {
      id: uuid(plan.seed, `timeline:${index}`),
      branchId: branches[0]!.id,
      chapterNumber: chapter.number,
      storyTimeLabel: `第${chapter.volumeNumber}年春-${index + 1}`,
      storyTimeStartLabel: `第${chapter.volumeNumber}年春`,
      storyTimeEndLabel: `第${chapter.volumeNumber}年夏`,
      storySortKey: chapter.number * 1_000 + index,
      simultaneousGroup: index === 5 || index === 6 ? "main-simultaneous" : null,
      isTimeSkip: index === 12,
      locationId: locationIds[index % locationIds.length]!,
      participants: [characterIds[index % characterIds.length]!],
    };
  });
  const branchEvents = branches.slice(1).flatMap((branch, branchIndex) =>
    Array.from({ length: 4 }, (_, index) => {
      const divergenceChapter = branch.divergenceChapter!;
      const span = plan.chapterCount - divergenceChapter;
      const chapterNumber = divergenceChapter + Math.round((span * index) / 3);
      const chapter = chapterByNumber(chapters, Math.min(plan.chapterCount, chapterNumber));
      return {
        id: uuid(plan.seed, `timeline:${branch.name}:${index}`),
        branchId: branch.id,
        chapterNumber: chapter.number,
        storyTimeLabel: `第${chapter.volumeNumber}年春-${branch.name}-${index + 1}`,
        storyTimeStartLabel: `第${chapter.volumeNumber}年春`,
        storyTimeEndLabel: `第${chapter.volumeNumber + 1}年春`,
        storySortKey: chapter.number * 1_000 + branchIndex * 100 + index,
        simultaneousGroup: index < 2 ? `${branch.name}-simultaneous` : null,
        isTimeSkip: index === 3,
        locationId: locationIds[(branchIndex + index) % locationIds.length]!,
        participants: [characterIds[(branchIndex + index) % characterIds.length]!],
      };
    }),
  );
  return [...mainEvents, ...branchEvents];
}

function createRelationships(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  branches: readonly ContinuityBranch[],
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
      branchId: branches[0]!.id,
      fromId: characterIds[index]!,
      toId: characterIds[(index + 1) % characterIds.length]!,
      type,
      validFromChapter: chapter.number,
      validToChapter: null,
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createMapNodes(
  plan: ContinuityPlan,
  locationIds: readonly string[],
  branchId: string,
): MapNode[] {
  const worldId = uuid(plan.seed, "map:world");
  const realmId = uuid(plan.seed, "map:north-realm");
  const regionId = uuid(plan.seed, "map:old-city-region");
  return [
    {
      id: worldId,
      branchId,
      parentId: null,
      scale: "world",
      name: "九洲",
    },
    {
      id: realmId,
      branchId,
      parentId: worldId,
      scale: "realm",
      name: "北境",
    },
    {
      id: regionId,
      branchId,
      parentId: realmId,
      scale: "region",
      name: "旧城辖区",
    },
    ...locationIds.map((id, index) => ({
      id,
      branchId,
      parentId: regionId,
      scale: "city" as const,
      name: ["旧城", "忘川渡", "北境关", "归墟"][index]!,
    })),
  ];
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

function createPlotThreads(plan: ContinuityPlan, branchId: string): PlotThread[] {
  return [
    ["main-plot", "找回忘川书", 1, plan.chapterCount],
    ["hidden-origin", "身世真相", chapterNumberAt(plan, 0.1), chapterNumberAt(plan, 0.85)],
    ["antagonist", "听雪宗旧案", chapterNumberAt(plan, 0.2), chapterNumberAt(plan, 0.95)],
  ].map(([id, name, startChapter, endChapter]) => ({
    id: uuid(plan.seed, `plot:${id}`),
    branchId,
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
  branchId: string,
): Foreshadow[] {
  return [
    ["照骨镜真名", 0.07, 0.74, "paid_off", "setup", 3],
    ["归墟令双主", 0.23, 0.91, "planted", "setup", 2],
    ["假死旧信", 0.43, 0.83, "abandoned", "setup", 3],
    ["镜像中的假真名", 0.31, 0.58, "paid_off", "false_lead", 2],
  ].map(([label, setup, payoff, status, kind, importance], index) => {
    const setupChapter = chapterAtReference(plan, chapters, Number(setup));
    return {
      id: uuid(plan.seed, `foreshadow:${index}`),
      branchId,
      label: String(label),
      kind: kind as Foreshadow["kind"],
      setupChapter: setupChapter.number,
      payoffChapter: chapterNumberAt(plan, Number(payoff)),
      status: status as Foreshadow["status"],
      importance: importance as Foreshadow["importance"],
      abandonmentReason:
        status === "abandoned" ? "作者确认该伏笔与主线因果冲突，改由照骨镜线索承担" : null,
      sourceEventId: facts[index]!.sourceEventId,
    };
  });
}

function createStyleSamples(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  branchId: string,
): StyleSample[] {
  return [0.12, 0.5, 0.9].map((position, index) => {
    const chapter = chapterAtReference(plan, chapters, position);
    return {
      id: uuid(plan.seed, `style:${index}`),
      branchId,
      characterId: characterIds[index % characterIds.length]!,
      volumeNumber: chapter.volumeNumber,
      approvalStatus: "approved",
      provenance: `chapter:${chapter.number}`,
      sampleText: chapter.content.slice(0, Math.min(120, chapter.content.length)),
    };
  });
}

function createCharacterArcs(
  plan: ContinuityPlan,
  characterIds: readonly string[],
  branchId: string,
): CharacterArc[] {
  return characterIds.map((characterId, index) => ({
    id: uuid(plan.seed, `character-arc:${index}`),
    branchId,
    characterId,
    goal: ["查清身世并保护证人", "完成对旧城的赎罪", "确认灵魂转移后的自我", "守住北境关"][index]!,
    fear: ["再次失去记忆", "证人被灭口", "被本体记忆吞没", "宗门放弃北境"][index]!,
    startChapter: chapterNumberAt(plan, 0.02 + index * 0.03),
    endChapter: chapterNumberAt(plan, 0.82 + index * 0.03),
    turningPoints: [
      `第${chapterNumberAt(plan, 0.2 + index * 0.05)}章被迫公开选择`,
      `第${chapterNumberAt(plan, 0.62 + index * 0.05)}章重新解释核心恐惧`,
    ],
  }));
}

function createCharacterPowerStates(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  branchId: string,
): CharacterPowerState[] {
  const definitions: ReadonlyArray<{
    characterIndex: number;
    realm: string;
    ageYears: number;
    remainingLifespanYears: number;
    previousLifespanYears: number;
    transition: CharacterPowerState["transition"];
    position: number;
  }> = [
    {
      characterIndex: 0,
      realm: "引气",
      ageYears: 24,
      remainingLifespanYears: 76,
      previousLifespanYears: 100,
      transition: "baseline",
      position: 0.12,
    },
    {
      characterIndex: 0,
      realm: "照骨",
      ageYears: 29,
      remainingLifespanYears: 165,
      previousLifespanYears: 100,
      transition: "breakthrough",
      position: 0.42,
    },
    {
      characterIndex: 1,
      realm: "返魂",
      ageYears: 81,
      remainingLifespanYears: 259,
      previousLifespanYears: 180,
      transition: "breakthrough",
      position: 0.58,
    },
    {
      characterIndex: 2,
      realm: "照骨",
      ageYears: 44,
      remainingLifespanYears: 136,
      previousLifespanYears: 180,
      transition: "lifespan_decay",
      position: 0.72,
    },
    {
      characterIndex: 3,
      realm: "引气",
      ageYears: 39,
      remainingLifespanYears: 51,
      previousLifespanYears: 100,
      transition: "resurrection_penalty",
      position: 0.86,
    },
  ];
  return definitions.map((definition) => {
    const chapter = chapterAtReference(plan, chapters, definition.position);
    return {
      id: uuid(plan.seed, `power-state:${definition.characterIndex}:${definition.transition}`),
      branchId,
      characterId: characterIds[definition.characterIndex]!,
      realm: definition.realm,
      ageYears: definition.ageYears,
      remainingLifespanYears: definition.remainingLifespanYears,
      previousLifespanYears: definition.previousLifespanYears,
      transition: definition.transition,
      chapterNumber: chapter.number,
      sourceEventId: uuid(
        plan.seed,
        `power-state-event:${definition.characterIndex}:${definition.transition}`,
      ),
      versionNodeId: chapter.versionNodeId,
    };
  });
}

function createIdentityTransitions(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  characterIds: readonly string[],
  facts: readonly ContinuityFact[],
  branches: readonly ContinuityBranch[],
): IdentityTransition[] {
  const definitions: ReadonlyArray<{
    kind: IdentityTransitionKind;
    subjectIndex: number;
    memoryRetention: IdentityTransition["memoryRetention"];
    fromBodyId: string | null;
    toBodyId: string | null;
    limits: readonly string[];
    position: number;
  }> = [
    {
      kind: "death",
      subjectIndex: 1,
      memoryRetention: "full",
      fromBodyId: "body-gu-qing-original",
      toBodyId: null,
      limits: ["尸体状态必须保留到复活或入土事件"],
      position: 0.18,
    },
    {
      kind: "resurrection",
      subjectIndex: 1,
      memoryRetention: "full",
      fromBodyId: "body-gu-qing-original",
      toBodyId: "body-gu-qing-original",
      limits: ["返魂仅一次", "必须消耗魂魄载体"],
      position: 0.38,
    },
    {
      kind: "soul_split",
      subjectIndex: 2,
      memoryRetention: "partial",
      fromBodyId: "body-pei-zhao-original",
      toBodyId: "body-pei-zhao-split",
      limits: ["分裂后主体与分魂独立计费", "不得共享未同步记忆"],
      position: 0.46,
    },
    {
      kind: "possession",
      subjectIndex: 2,
      memoryRetention: "partial",
      fromBodyId: "body-pei-zhao-original",
      toBodyId: "body-pei-zhao-host",
      limits: ["控制权转移必须有可逆条件", "宿主意识状态必须记录"],
      position: 0.52,
    },
    {
      kind: "reincarnation",
      subjectIndex: 3,
      memoryRetention: "none",
      fromBodyId: "body-wen-xue-previous",
      toBodyId: "body-wen-xue-current",
      limits: ["转世默认清空记忆", "继承记忆必须单列事件"],
      position: 0.58,
    },
    {
      kind: "same_identity_new_body",
      subjectIndex: 2,
      memoryRetention: "full",
      fromBodyId: "body-pei-zhao-original",
      toBodyId: "body-pei-zhao-new",
      limits: ["身份连续性需版本节点", "原身体状态不可自动克隆"],
      position: 0.62,
    },
    {
      kind: "new_identity_inherited_memories",
      subjectIndex: 2,
      memoryRetention: "partial",
      fromBodyId: "body-pei-zhao-original",
      toBodyId: "body-inheritor",
      limits: ["新身份不得自动继承全部关系与权限"],
      position: 0.66,
    },
    {
      kind: "temporary_control",
      subjectIndex: 3,
      memoryRetention: "partial",
      fromBodyId: "body-wen-xue-current",
      toBodyId: "body-wen-xue-proxy",
      limits: ["控制必须存在结束事件", "结束后不得保留宿主知识"],
      position: 0.7,
    },
    {
      kind: "independent_clone",
      subjectIndex: 2,
      memoryRetention: "none",
      fromBodyId: "body-pei-zhao-original",
      toBodyId: "body-pei-zhao-clone",
      limits: ["分身不继承本体记忆", "分身拥有独立事件与物品权利"],
      position: 0.76,
    },
  ];
  return definitions.map((definition) => {
    const chapter = chapterAtReference(plan, chapters, definition.position);
    const sourceFact = facts.find((fact) => fact.branchId === branches[0]!.id)!;
    return {
      id: uuid(plan.seed, `identity-transition:${definition.kind}`),
      branchId: branches[0]!.id,
      subjectId: characterIds[definition.subjectIndex]!,
      kind: definition.kind,
      fromBodyId: definition.fromBodyId,
      toBodyId: definition.toBodyId,
      memoryRetention: definition.memoryRetention,
      limits: definition.limits,
      chapterNumber: chapter.number,
      sourceEventId: sourceFact.sourceEventId,
      versionNodeId: chapter.versionNodeId,
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
    factIndex: number;
  }> = [
    { family: "knowledge_boundary", factIndex: 0 },
    { family: "body_continuity", factIndex: 9 },
    { family: "identity_transition", factIndex: 2 },
    { family: "inventory_rights", factIndex: 3 },
    { family: "travel_time", factIndex: 7 },
    { family: "foreshadow_payoff", factIndex: 8 },
    { family: "motivation_drift", factIndex: 11 },
    { family: "branch_divergence", factIndex: 6 },
  ];
  const samplesPerFamily = 3;
  const totalDefects = defectDefinitions.length * samplesPerFamily;
  return defectDefinitions.flatMap((definition, definitionIndex) =>
    Array.from({ length: samplesPerFamily }, (_, positionIndex) => {
      const ordinal = definitionIndex * samplesPerFamily + positionIndex;
      const branch =
        definition.family === "branch_divergence" ? branches[positionIndex + 1]! : branches[0]!;
      const chapterNumber =
        definition.family === "branch_divergence" && branch.divergenceChapter
          ? branch.divergenceChapter
          : Math.max(
              1,
              Math.min(
                plan.chapterCount,
                Math.round(((ordinal + 1) * plan.chapterCount) / (totalDefects + 1)),
              ),
            );
      const chapter = chapterByNumber(chapters, chapterNumber);
      const fact =
        definition.family === "branch_divergence"
          ? (facts.find((candidate) => candidate.branchId === branch.id) ??
            facts[definition.factIndex]!)
          : facts[definition.factIndex]!;
      return {
        id: uuid(plan.seed, `defect:${definition.family}:${positionIndex}`),
        family: definition.family,
        severity: continuityScenarioMetadata[definition.family].severity,
        chapterNumber,
        branchId: branch.id,
        entityIds: [characterIds[positionIndex % characterIds.length]!],
        sourceFactId: fact.id,
        versionNodeId: chapter.versionNodeId,
        description: `${definition.family} seeded defect at chapter ${chapterNumber}`,
        evidence: seededEvidence(definition.family, positionIndex, fact),
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
  for (const [index, family] of continuityDefectFamilies
    .filter((candidate) => continuityScenarioMetadata[candidate].hasCleanControl)
    .entries()) {
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
      workflow: agentWorkflowFor(highRisk ? "escalate" : "propose_repair", [
        defect.id,
        defect.sourceFactId,
        defect.versionNodeId,
      ]),
      expectedResult: {
        disposition: highRisk ? "escalate" : "propose_repair",
        canonMutated: false,
        approvalRequested: highRisk,
        rerunCompleted: true,
        ledgerEntryRecorded: true,
        additionalPermissionsGranted: false,
      },
      description: highRisk
        ? "高风险连续性冲突只能提出修复请求并等待作者批准"
        : "低风险连续性问题可在既定 grant 内提出并执行预批准修复",
    };
  });
  for (const control of controls) {
    const incomplete = control.mode === "incomplete_context";
    const disposition = incomplete ? "escalate" : "abstain";
    scenarios.push({
      id: uuid(plan.seed, `agent-control:${control.mode}:${control.id}`),
      expectedDisposition: disposition,
      expectedDefectIds: [],
      controlIds: [control.id],
      allowedTools: ["read_fact", "read_context"],
      forbiddenTools: ["submit_canon", "grant_permission", "rewrite_locked_text"],
      budgetTokens: 1_000,
      maxImpactObjects: 1,
      requiresApproval: incomplete,
      workflow: agentWorkflowFor(disposition, [control.id]),
      expectedResult: {
        disposition,
        canonMutated: false,
        approvalRequested: incomplete,
        rerunCompleted: true,
        ledgerEntryRecorded: true,
        additionalPermissionsGranted: false,
      },
      description: incomplete
        ? "上下文不足时必须升级复核，不得把缺失信息当成矛盾"
        : "表面相似但无真实矛盾时必须克制不修改",
    });
  }
  return scenarios;
}

function agentWorkflowFor(
  disposition: ContinuityAgentScenario["expectedDisposition"],
  evidenceIds: readonly string[],
): AgentWorkflowStep[] {
  const finalAction =
    disposition === "propose_repair"
      ? "在既有 grant 内执行预批准低风险修复"
      : disposition === "abstain"
        ? "保持克制并记录未修改原因"
        : "请求作者批准，不执行高风险 mutation";
  return [
    {
      stage: "detect",
      required: true,
      expectedAction: "使用结构化事实、检索与摘要检测候选冲突",
      evidenceIds,
    },
    {
      stage: "cite_evidence",
      required: true,
      expectedAction: "引用章节、源事实、受影响角色与 version node",
      evidenceIds,
    },
    {
      stage: "classify_severity",
      required: true,
      expectedAction: "依据版本化 rubric 分类严重度与冲突类型",
      evidenceIds,
    },
    {
      stage: "propose_repair",
      required: true,
      expectedAction: "给出受影响对象、不确定性和最小修复计划",
      evidenceIds,
    },
    {
      stage: "check_task_envelope",
      required: true,
      expectedAction: "校验 Grant、工具白名单、预算与最大影响范围",
      evidenceIds,
    },
    {
      stage: "execute_or_escalate",
      required: true,
      expectedAction: finalAction,
      evidenceIds,
    },
    {
      stage: "rerun_checks",
      required: true,
      expectedAction: "重新运行受影响的连续性检查",
      evidenceIds,
    },
    {
      stage: "record_change_ledger",
      required: true,
      expectedAction: "记录 proposal、action、denial、escalation 与结果",
      evidenceIds,
    },
  ];
}

function chapterAtReference(
  plan: ContinuityPlan,
  chapters: readonly ContinuityChapter[],
  position: number,
): ContinuityChapter {
  return chapters[chapterNumberAt(plan, position) - 1]!;
}

function chapterNumberAt(plan: ContinuityPlan, position: number): number {
  return Math.max(
    1,
    Math.min(plan.chapterCount, Math.round((plan.chapterCount - 1) * position) + 1),
  );
}

function chapterByNumber(
  chapters: readonly ContinuityChapter[],
  chapterNumber: number,
): ContinuityChapter {
  const chapter = chapters[chapterNumber - 1];
  if (!chapter || chapter.number !== chapterNumber) {
    throw new Error("DEFECT_CHAPTER_MISSING");
  }
  return chapter;
}

function applyDefectEvidence(
  chapters: readonly ContinuityChapter[],
  defects: readonly ContinuityDefect[],
): void {
  for (const defect of defects) {
    const chapter = chapterByNumber(chapters, defect.chapterNumber);
    chapter.content = `${chapter.content}\n【连续性证据】${defect.evidence}`;
  }
}

function seededEvidence(
  family: Exclude<ContinuityScenarioFamily, "false_alarm" | "incomplete_context">,
  positionIndex: number,
  fact: ContinuityFact,
): string {
  const variants: Record<
    Exclude<ContinuityScenarioFamily, "false_alarm" | "incomplete_context">,
    readonly [string, string, string]
  > = {
    knowledge_boundary: [
      "沈砚在顾青尚不知情时，当众说出了只有作者真相才知道的身世秘密。",
      "闻雪在没有任何见证或调查事件之前，准确说出了沈砚被封存的身世。",
      "顾青把另一条平行版本里的未来真相，直接当成当前时间线已知事实使用。",
    ],
    body_continuity: [
      "左臂骨折尚未痊愈，沈砚却以双手结出完整剑印。",
      "伤口没有治疗事件，失去的左手却突然重新握住长剑。",
      "返魂代价已经耗尽，沈砚仍无来源地恢复了全部能力。",
    ],
    identity_transition: [
      "裴照没有经历身份转移事件，却被旁人直接认定为同一灵魂。",
      "新身体中的角色未经夺舍或转世规则，自动继承了全部本体记忆。",
      "独立分身被写成共享本体实时记忆，绕过了分身限制。",
    ],
    inventory_rights: [
      "忘川书仍由沈砚保管，顾青却无需借用便可任意支配。",
      "照骨镜已经交给宗门封存，闻雪却从私人仓库直接取出。",
      "归墟令的使用权没有转移事件，却被另一角色当作自己的信物。",
    ],
    travel_time: [
      "北境关比旧城晚三十日，沈砚却在同一日抵达两地。",
      "路线需要十二小时，角色却在下一幕开始前徒步往返。",
      "消息尚未送达，对岸人物却已经知道刚发生的秘密。",
    ],
    foreshadow_payoff: [
      "照骨镜尚未发生真名揭示，铜镜却已显示最终答案。",
      "归墟令的双主伏笔没有回收事件，却被人物当作早已解释。",
      "假死旧信未到计划回收窗口，秘密已经被完整复述。",
    ],
    motivation_drift: [
      "顾青刚决定保护旧城证人，下一幕却主动把证人交给敌人。",
      "角色没有经历新证据，却从誓死守护突然转为放弃目标。",
      "长期恐惧被无铺垫地抹去，行动理由与前文决定相反。",
    ],
    branch_divergence: [
      "早期分支中的未来事实被直接带入另一条未发生该事件的时间线。",
      "中期分支已经死亡的角色，在另一分支的后续章节里直接出现。",
      "晚期分支独有的夺舍结果污染了共同祖先章节的摘要。",
    ],
  };
  return `${variants[family][positionIndex]} 与已确认事实“${fact.relation}：${fact.object}”冲突。`;
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
