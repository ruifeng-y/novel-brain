import { createHash } from "node:crypto";

import {
  GENERATION_READINESS_RULE_VERSION,
  type ChapterBrief,
  type GenerationReadiness,
  type GenerationReadinessDependency,
  type GenerationReadinessEvidence,
  type GenerationReadinessItem,
  type GenerationReadinessItemState,
  type GenerationReadinessRemediation,
  type GenerationReadinessResourceRef,
  type GenerationReadinessSeverity,
  type StoryBibleReadiness,
} from "@novel-brain/contracts";

import { evaluateOutlineReadiness, type OutlineReadinessInput } from "./outline-planning";

export const READINESS_RULE_VERSION = GENERATION_READINESS_RULE_VERSION;

export interface GenerationReadinessSetting {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  status: string;
  version: number;
}

export interface GenerationReadinessPendingProposal {
  id: string;
  entityId: string;
  entityType: string;
  conflictType: string;
  status: string;
}

export interface GenerationReadinessPendingRisk {
  id: string;
  kind: "story_bible_change_request" | "setting_change_request" | "fact_proposal";
  label: string;
  resourceId: string;
  entityId: string | null;
  entityType: string | null;
}

export interface GenerationReadinessChapter {
  id: string;
  version: number;
  status: string;
  brief: ChapterBrief | null;
}

export interface GenerationReadinessInput {
  workId: string;
  branchId: string;
  branchHeadNodeId: string;
  chapterId: string | null;
  chapterLengthTarget: number;
  storyBible: {
    id: string;
    version: number;
    status: string;
    readiness: StoryBibleReadiness;
    worldRuleIds: string[];
  } | null;
  settings: GenerationReadinessSetting[];
  pendingSettingProposals: GenerationReadinessPendingProposal[];
  pendingRiskApprovals: GenerationReadinessPendingRisk[];
  outline: OutlineReadinessInput;
  chapter: GenerationReadinessChapter | null;
  hasReadyChapterBrief: boolean;
  unresolvedHighRiskFactIds: string[];
  config: {
    modelConfig: {
      id: string;
      version: number;
      label: string;
      model: string;
      purposes: string[];
      lastTestStatus: string | null;
    } | null;
    budget: {
      maxCostCny: number;
      maxTokens: number;
      maxRevisionRounds: number;
    };
    budgetSource: "default" | "request";
  };
}

interface RankedItem {
  item: GenerationReadinessItem;
  rank: number;
}

const REQUIRED_SETTING_TYPES: Array<{ type: string; label: string; column: string }> = [
  { type: "world_rule", label: "世界规则", column: "world" },
  { type: "character", label: "人物", column: "characters" },
  { type: "golden_finger", label: "金手指", column: "power" },
];

export function evaluateGenerationReadiness(input: GenerationReadinessInput): GenerationReadiness {
  const ranked: RankedItem[] = [];
  ranked.push({
    rank: 0,
    item: storyBibleItem(input),
  });
  ranked.push({
    rank: 1,
    item: worldRulesItem(input),
  });
  ranked.push({
    rank: 2,
    item: settingsItem(input),
  });
  ranked.push({
    rank: 3,
    item: povItem(input),
  });

  if (!input.chapter || input.outline.nodes.length > 0) {
    const outline = evaluateOutlineReadiness(input.outline);
    const structureIssue = outline.items.find((item) => item.key === "structure");
    ranked.push({
      rank: 4,
      item: {
        key: "outline:structure",
        label: "大纲 · 五层结构",
        severity: "blocker",
        state: structureIssue ? "conflict" : "ready",
        ready: !structureIssue,
        reason: structureIssue?.remediation ?? "五层结构完整",
        resource: resourceRef("outline_node", null, null, "五层大纲结构"),
        evidence: [
          evidence(
            structureIssue ? "conflict" : "resource_state",
            structureIssue?.remediation ?? "五层结构完整",
            resourceRef("outline_node", null, null, "五层大纲结构"),
          ),
        ],
        remediation: structureIssue
          ? remediation("resolve", "去修正大纲结构", `/workspace/${input.workId}/outline`)
          : null,
      },
    });
    for (const outlineItem of outline.items.filter((item) => item.key !== "structure")) {
      ranked.push({
        rank: outlineItemRank(outlineItem.key),
        item: {
          key: `outline:${outlineItem.key}`,
          label: `大纲 · ${outlineItem.label}`,
          severity: outlineItem.severity,
          state: outlineItem.ready ? "ready" : outlineState(outlineItem.key),
          ready: outlineItem.ready,
          reason: outlineItem.ready ? "已就绪" : outlineItem.remediation,
          resource: resourceRef("outline_node", outlineItem.resourceId, null, outlineItem.label),
          evidence: [
            evidence(
              outlineItem.ready ? "resource_state" : "missing_dependency",
              outlineItem.ready ? "大纲依赖已满足" : outlineItem.remediation,
              resourceRef("outline_node", outlineItem.resourceId, null, outlineItem.label),
            ),
          ],
          remediation: outlineItem.ready
            ? null
            : remediation(
                outlineState(outlineItem.key) === "conflict" ? "resolve" : "complete",
                `去处理${outlineItem.label}`,
                outlineHref(input, outlineItem.resourceId),
              ),
        },
      });
    }
  }

  ranked.push({
    rank: 13,
    item: requiredFactsItem(input),
  });
  ranked.push({
    rank: 14,
    item: modelConfigItem(input),
  });
  ranked.push({
    rank: 15,
    item: budgetItem(input),
  });
  ranked.push({
    rank: 16,
    item: riskApprovalItem(input),
  });

  const items = ranked
    .sort((left, right) => left.rank - right.rank || left.item.key.localeCompare(right.item.key))
    .map(({ item }) => item);
  const blockers = items.filter((item) => item.severity === "blocker" && !item.ready).length;
  const warnings = items.filter((item) => item.severity === "warning" && !item.ready).length;
  const dependencies = readinessDependencies(input);

  return {
    workId: input.workId,
    branchId: input.branchId,
    chapterId: input.chapterId,
    ruleVersion: READINESS_RULE_VERSION,
    status: blockers > 0 ? "not_ready" : warnings > 0 ? "partial" : "ready",
    canProceed: blockers === 0,
    completed: items.filter((item) => item.ready).length,
    total: items.length,
    blockers,
    warnings,
    dependencyFingerprint: fingerprint(dependencies),
    dependencies,
    items,
  };
}

export function isReadinessStale(
  previous: Pick<GenerationReadiness, "ruleVersion" | "dependencyFingerprint">,
  current: Pick<GenerationReadiness, "ruleVersion" | "dependencyFingerprint">,
): boolean {
  return (
    previous.ruleVersion !== current.ruleVersion ||
    previous.dependencyFingerprint !== current.dependencyFingerprint
  );
}

function storyBibleItem(input: GenerationReadinessInput): GenerationReadinessItem {
  if (!input.storyBible) {
    return item({
      key: "story_bible",
      label: "故事圣经",
      severity: "blocker",
      state: "missing",
      ready: false,
      reason: "还没有故事圣经",
      resource: resourceRef("story_bible", null, null, "故事圣经"),
      remediation: remediation(
        "complete",
        "去完善故事圣经",
        `/workspace/${input.workId}/bible#story-bible-readiness`,
      ),
    });
  }
  const resource = resourceRef(
    "story_bible",
    input.storyBible.id,
    String(input.storyBible.version),
    "故事圣经",
  );
  if (input.storyBible.status !== "locked") {
    return item({
      key: "story_bible",
      label: "故事圣经",
      severity: "blocker",
      state: "unlocked",
      ready: false,
      reason: "故事圣经尚未锁定",
      resource,
      remediation: remediation(
        "lock",
        "去锁定故事圣经",
        `/workspace/${input.workId}/bible#story-bible-readiness`,
      ),
    });
  }
  if (
    input.storyBible.readiness.status !== "ready" ||
    input.storyBible.readiness.issues.length > 0
  ) {
    return item({
      key: "story_bible",
      label: "故事圣经",
      severity: "blocker",
      state: "conflict",
      ready: false,
      reason:
        input.storyBible.readiness.issues[0]?.message ??
        `故事圣经还有 ${input.storyBible.readiness.missingCards.length} 张卡片未完成`,
      resource,
      remediation: remediation(
        "resolve",
        "去处理故事圣经问题",
        `/workspace/${input.workId}/bible#story-bible-readiness`,
      ),
    });
  }
  return item({
    key: "story_bible",
    label: "故事圣经",
    severity: "blocker",
    state: "ready",
    ready: true,
    reason: `已锁定第 ${input.storyBible.version} 版`,
    resource,
  });
}

function worldRulesItem(input: GenerationReadinessInput): GenerationReadinessItem {
  const ruleIds = input.storyBible?.worldRuleIds ?? [];
  if (!input.storyBible || ruleIds.length === 0) {
    return item({
      key: "world_rules",
      label: "世界规则",
      severity: "blocker",
      state: "missing",
      ready: false,
      reason: "缺少结构化世界规则",
      resource: resourceRef("world_rule", null, null, "结构化世界规则"),
      remediation: remediation(
        "complete",
        "去补世界规则",
        `/workspace/${input.workId}/bible#bible-worldLaws`,
      ),
    });
  }
  const resource = resourceRef(
    "world_rule",
    ruleIds[0] ?? null,
    String(input.storyBible.version),
    `${ruleIds.length} 条世界规则`,
  );
  return item({
    key: "world_rules",
    label: "世界规则",
    severity: "blocker",
    state: "ready",
    ready: true,
    reason: `已载入 ${ruleIds.length} 条结构化规则`,
    resource,
  });
}

function settingsItem(input: GenerationReadinessInput): GenerationReadinessItem {
  const issues: Array<{
    type: string;
    label: string;
    column: string;
    setting: GenerationReadinessSetting | null;
    reason: string;
    state: GenerationReadinessItemState;
  }> = [];
  for (const required of REQUIRED_SETTING_TYPES) {
    const ofType = input.settings.filter((setting) => setting.type === required.type);
    const locked = ofType.filter((setting) => setting.status === "locked");
    const pendingConflict = input.pendingSettingProposals.find(
      (proposal) =>
        proposal.status === "pending" &&
        proposal.entityType === required.type &&
        proposal.conflictType !== "none",
    );
    if (pendingConflict) {
      issues.push({
        type: required.type,
        label: required.label,
        column: required.column,
        setting: ofType.find((setting) => setting.id === pendingConflict.entityId) ?? null,
        reason: `${required.label}还有待裁决冲突`,
        state: "conflict",
      });
      continue;
    }
    if (locked.length === 0) {
      const candidate = ofType[0] ?? null;
      issues.push({
        type: required.type,
        label: required.label,
        column: required.column,
        setting: candidate,
        reason: candidate === null ? `缺少${required.label}设定` : `${required.label}设定尚未锁定`,
        state: candidate === null ? "missing" : "unlocked",
      });
    }
  }

  if (issues.length === 0) {
    const source = input.settings.find((setting) => setting.status === "locked") ?? null;
    return item({
      key: "settings",
      label: "已确认设定",
      severity: "blocker",
      state: "ready",
      ready: true,
      reason: "世界规则、人物和金手指均已锁定",
      resource: resourceRef(
        "setting",
        source?.id ?? null,
        source ? String(source.version) : null,
        "已确认设定",
      ),
    });
  }

  const first = issues[0]!;
  const firstResource = resourceRef(
    "setting",
    first.setting?.id ?? null,
    first.setting ? String(first.setting.version) : null,
    first.label,
  );
  const evidenceItems = issues.map((issue) =>
    evidence(
      issue.state === "conflict" ? "conflict" : "missing_dependency",
      issue.reason,
      resourceRef(
        "setting",
        issue.setting?.id ?? null,
        issue.setting ? String(issue.setting.version) : null,
        issue.label,
      ),
    ),
  );
  return item({
    key: "settings",
    label: "已确认设定",
    severity: "blocker",
    state: issues.some((issue) => issue.state === "conflict") ? "conflict" : first.state,
    ready: false,
    reason: issues.map((issue) => issue.reason).join("；"),
    resource: firstResource,
    evidence: evidenceItems,
    remediation: remediation(
      first.state === "conflict" ? "resolve" : first.state === "unlocked" ? "lock" : "complete",
      `去处理${first.label}`,
      settingsHref(input, first.column, first.setting?.id ?? null),
    ),
  });
}

function povItem(input: GenerationReadinessInput): GenerationReadinessItem {
  const lockedCharacters = input.settings.filter(
    (setting) => setting.type === "character" && setting.status === "locked",
  );
  const pov = input.chapter?.brief?.pov?.trim() ?? "";
  if (!input.chapter) {
    const source = lockedCharacters[0] ?? null;
    return item({
      key: "pov",
      label: "角色与 POV",
      severity: "blocker",
      state: lockedCharacters.length > 0 ? "ready" : "missing",
      ready: lockedCharacters.length > 0,
      reason:
        lockedCharacters.length > 0 ? "人物库已就绪，章节 POV 将在章纲中指定" : "还没有已锁定人物",
      resource: resourceRef(
        "character",
        source?.id ?? null,
        source ? String(source.version) : null,
        source?.name ?? "人物",
      ),
      remediation:
        lockedCharacters.length > 0
          ? null
          : remediation(
              "complete",
              "去补人物设定",
              settingsHref(input, "characters", source?.id ?? null),
            ),
    });
  }

  const match = lockedCharacters.find(
    (character) => character.name === pov || character.aliases.includes(pov),
  );
  if (!pov || !match) {
    return item({
      key: "pov",
      label: "角色与 POV",
      severity: "blocker",
      state: "missing",
      ready: false,
      reason: pov ? `章纲 POV“${pov}”没有对应的已锁定人物` : "章纲缺少 POV",
      resource: resourceRef("chapter", input.chapter.id, String(input.chapter.version), "章节 POV"),
      remediation: remediation(
        "complete",
        "去指定本章 POV",
        `/workspace/${input.workId}/outline?nodeId=${input.chapterId ?? ""}`,
      ),
    });
  }
  return item({
    key: "pov",
    label: "角色与 POV",
    severity: "blocker",
    state: "ready",
    ready: true,
    reason: `POV 已对应人物“${match.name}”`,
    resource: resourceRef("character", match.id, String(match.version), match.name),
  });
}

function requiredFactsItem(input: GenerationReadinessInput): GenerationReadinessItem {
  const facts = input.chapter?.brief?.requiredFacts ?? [];
  if ((input.chapter && facts.length > 0) || (!input.chapter && input.hasReadyChapterBrief)) {
    return item({
      key: "required_facts",
      label: "必要事实",
      severity: "blocker",
      state: "ready",
      ready: true,
      reason: input.chapter ? `章纲已列出 ${facts.length} 条必要事实` : "已有包含必要事实的章纲",
      resource: resourceRef(
        "required_facts",
        input.chapter?.id ?? null,
        input.chapter ? String(input.chapter.version) : null,
        "本章必要事实",
      ),
    });
  }
  return item({
    key: "required_facts",
    label: "必要事实",
    severity: "blocker",
    state: "missing",
    ready: false,
    reason: input.chapter ? "章纲缺少必要事实" : "还没有可生成的章纲",
    resource: resourceRef(
      "required_facts",
      input.chapter?.id ?? null,
      input.chapter ? String(input.chapter.version) : null,
      "本章必要事实",
    ),
    remediation: remediation(
      "complete",
      "去补本章必要事实",
      input.chapterId
        ? `/workspace/${input.workId}/outline?nodeId=${input.chapterId}`
        : `/workspace/${input.workId}/outline`,
    ),
  });
}

function modelConfigItem(input: GenerationReadinessInput): GenerationReadinessItem {
  const config = input.config.modelConfig;
  if (!config) {
    return item({
      key: "model_config",
      label: "模型配置",
      severity: "blocker",
      state: "missing",
      ready: false,
      reason: "缺少可用于正文生成的模型配置",
      resource: resourceRef("model_config", null, null, "模型配置"),
      remediation: remediation(
        "configure",
        "去配置模型",
        "/workspace/settings/account#model-config-title",
      ),
    });
  }
  const resource = resourceRef("model_config", config.id, String(config.version), config.label);
  if (config.lastTestStatus === "success") {
    return item({
      key: "model_config",
      label: "模型配置",
      severity: "blocker",
      state: "ready",
      ready: true,
      reason: `${config.model} 连接正常`,
      resource,
    });
  }
  if (config.lastTestStatus === null) {
    return item({
      key: "model_config",
      label: "模型配置",
      severity: "warning",
      state: "invalid",
      ready: false,
      reason: "模型配置尚未测试连接",
      resource,
      remediation: remediation(
        "configure",
        "去测试模型连接",
        "/workspace/settings/account#model-config-title",
      ),
    });
  }
  return item({
    key: "model_config",
    label: "模型配置",
    severity: "blocker",
    state: "invalid",
    ready: false,
    reason: `模型连接状态为 ${config.lastTestStatus}`,
    resource,
    remediation: remediation(
      "configure",
      "去修复模型连接",
      "/workspace/settings/account#model-config-title",
    ),
  });
}

function budgetItem(input: GenerationReadinessInput): GenerationReadinessItem {
  const budget = input.config.budget;
  const resource = resourceRef(
    "budget",
    input.config.budgetSource,
    `${budget.maxCostCny}:${budget.maxTokens}:${budget.maxRevisionRounds}`,
    "本章生成预算",
  );
  if (budget.maxCostCny <= 0 || budget.maxTokens <= 0 || budget.maxRevisionRounds < 0) {
    return item({
      key: "budget",
      label: "生成预算",
      severity: "blocker",
      state: "invalid",
      ready: false,
      reason: "生成预算必须有大于 0 的成本上限和 token 上限",
      resource,
      evidence: [
        evidence(
          "budget",
          `当前为 ${budget.maxTokens.toLocaleString("zh-CN")} tokens / ¥${budget.maxCostCny}`,
          resource,
        ),
      ],
      remediation: remediation(
        "configure",
        "去调整生成预算",
        `/workspace/${input.workId}/write${input.chapterId ? `?chapterId=${input.chapterId}` : ""}#writing-readiness`,
      ),
    });
  }
  return item({
    key: "budget",
    label: "生成预算",
    severity: "blocker",
    state: "ready",
    ready: true,
    reason: `${budget.maxTokens.toLocaleString("zh-CN")} tokens / ¥${budget.maxCostCny}`,
    resource,
  });
}

function riskApprovalItem(input: GenerationReadinessInput): GenerationReadinessItem {
  if (input.pendingRiskApprovals.length > 0) {
    const first = input.pendingRiskApprovals[0]!;
    const resource = resourceRef("risk_approval", first.resourceId, null, first.label);
    return item({
      key: "risk_approval",
      label: "风险审批",
      severity: "blocker",
      state: "pending",
      ready: false,
      reason: `还有 ${input.pendingRiskApprovals.length} 个待确认修改`,
      resource,
      evidence: input.pendingRiskApprovals.map((approval) =>
        evidence(
          "pending_approval",
          approval.label,
          resourceRef("risk_approval", approval.resourceId, null, approval.label),
        ),
      ),
      remediation: remediation("review", "去确认高风险修改", riskHref(input, first)),
    });
  }
  if (input.unresolvedHighRiskFactIds.length > 0) {
    return item({
      key: "risk_approval",
      label: "风险审批",
      severity: "blocker",
      state: "pending",
      ready: false,
      reason: `还有 ${input.unresolvedHighRiskFactIds.length} 条高风险事实待确认`,
      resource: resourceRef(
        "risk_approval",
        input.unresolvedHighRiskFactIds[0] ?? null,
        null,
        "高风险事实",
      ),
      remediation: remediation(
        "review",
        "去确认高风险事实",
        `/workspace/${input.workId}/write${input.chapterId ? `?chapterId=${input.chapterId}` : ""}#writing-facts`,
      ),
    });
  }
  return item({
    key: "risk_approval",
    label: "风险审批",
    severity: "blocker",
    state: "ready",
    ready: true,
    reason: "没有待确认的高风险修改",
    resource: resourceRef("risk_approval", null, null, "风险审批"),
  });
}

function readinessDependencies(input: GenerationReadinessInput): GenerationReadinessDependency[] {
  const dependencies: GenerationReadinessDependency[] = [
    { key: "branch", version: input.branchHeadNodeId },
  ];
  if (input.storyBible) {
    dependencies.push({
      key: `story_bible:${input.storyBible.id}`,
      version: `${input.storyBible.version}:${input.storyBible.status}`,
    });
    for (const ruleId of [...input.storyBible.worldRuleIds].sort()) {
      dependencies.push({
        key: `world_rule:${ruleId}`,
        version: input.storyBible.version.toString(),
      });
    }
  }
  for (const setting of [...input.settings].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    dependencies.push({
      key: `setting:${setting.id}`,
      version: `${setting.version}:${setting.status}`,
    });
  }
  for (const proposal of [...input.pendingSettingProposals].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    dependencies.push({
      key: `setting_proposal:${proposal.id}`,
      version: `${proposal.status}:${proposal.conflictType}`,
    });
  }
  for (const node of [...input.outline.nodes].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    dependencies.push({
      key: `outline:${node.id}`,
      version: `${node.level}:${node.parentId ?? "root"}:${node.sortOrder}:${node.locked ? "locked" : "editable"}:${node.chapterId ?? "none"}`,
    });
  }
  if (input.chapter) {
    dependencies.push({
      key: `chapter:${input.chapter.id}`,
      version: `${input.chapter.version}:${input.chapter.status}`,
    });
  }
  if (input.config.modelConfig) {
    dependencies.push({
      key: `model_config:${input.config.modelConfig.id}`,
      version: `${input.config.modelConfig.version}:${input.config.modelConfig.lastTestStatus ?? "untested"}`,
    });
  }
  dependencies.push({
    key: "budget",
    version: `${input.config.budget.maxCostCny}:${input.config.budget.maxTokens}:${input.config.budget.maxRevisionRounds}`,
  });
  for (const risk of [...input.pendingRiskApprovals].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    dependencies.push({ key: `risk:${risk.id}`, version: risk.kind });
  }
  for (const factId of [...input.unresolvedHighRiskFactIds].sort()) {
    dependencies.push({ key: `fact_risk:${factId}`, version: "pending" });
  }
  return dependencies.sort((left, right) => left.key.localeCompare(right.key));
}

function fingerprint(dependencies: GenerationReadinessDependency[]): string {
  return createHash("sha256").update(JSON.stringify(dependencies)).digest("hex");
}

function item(input: {
  key: string;
  label: string;
  severity: GenerationReadinessSeverity;
  state: GenerationReadinessItemState;
  ready: boolean;
  reason: string;
  resource: GenerationReadinessResourceRef;
  evidence?: GenerationReadinessEvidence[];
  remediation?: GenerationReadinessRemediation | null;
}): GenerationReadinessItem {
  return {
    key: input.key,
    label: input.label,
    severity: input.severity,
    state: input.state,
    ready: input.ready,
    reason: input.reason,
    resource: input.resource,
    evidence: input.evidence ?? [
      evidence(input.ready ? "resource_state" : "missing_dependency", input.reason, input.resource),
    ],
    remediation: input.ready ? null : (input.remediation ?? null),
  };
}

function resourceRef(
  type: GenerationReadinessResourceRef["type"],
  id: string | null,
  version: string | null,
  label: string,
): GenerationReadinessResourceRef {
  return { type, id, version, label };
}

function evidence(
  kind: GenerationReadinessEvidence["kind"],
  summary: string,
  resource: GenerationReadinessResourceRef,
): GenerationReadinessEvidence {
  return { kind, summary, resource };
}

function remediation(
  action: GenerationReadinessRemediation["action"],
  label: string,
  href: string,
): GenerationReadinessRemediation {
  return { action, label, href };
}

function settingsHref(
  input: GenerationReadinessInput,
  column: string,
  entityId: string | null,
): string {
  const params = new URLSearchParams({ column });
  if (entityId) {
    params.set("entityId", entityId);
  }
  return `/workspace/${input.workId}/settings?${params.toString()}`;
}

function outlineHref(input: GenerationReadinessInput, resourceId: string | null): string {
  return resourceId
    ? `/workspace/${input.workId}/outline?nodeId=${resourceId}`
    : `/workspace/${input.workId}/outline`;
}

function riskHref(
  input: GenerationReadinessInput,
  approval: GenerationReadinessPendingRisk,
): string {
  if (approval.kind === "story_bible_change_request") {
    return `/workspace/${input.workId}/bible#story-bible-change-requests`;
  }
  if (approval.kind === "setting_change_request") {
    return settingsHref(input, columnForSettingType(approval.entityType), approval.entityId);
  }
  return `/workspace/${input.workId}/write${input.chapterId ? `?chapterId=${input.chapterId}` : ""}#writing-facts`;
}

function columnForSettingType(type: string | null): string {
  switch (type) {
    case "character":
      return "characters";
    case "faction":
      return "factions";
    case "map":
      return "map";
    case "power_system":
    case "golden_finger":
      return "power";
    case "item":
      return "items";
    case "timeline_event":
      return "timeline";
    default:
      return "world";
  }
}

function outlineItemRank(key: string): number {
  if (key === "structure") {
    return 4;
  }
  if (key === "book_root") {
    return 5;
  }
  if (key.startsWith("volume_contract:")) {
    return 6;
  }
  if (key.startsWith("chapter_brief:")) {
    return 7;
  }
  if (key.startsWith("scene_pov:")) {
    return 8;
  }
  if (key.startsWith("scene_location:")) {
    return 9;
  }
  if (key.startsWith("scene_beats:")) {
    return 10;
  }
  if (key.startsWith("scene_time:")) {
    return 11;
  }
  if (key.startsWith("scene_information:")) {
    return 12;
  }
  return 12;
}

function outlineState(key: string): GenerationReadinessItemState {
  return key === "structure" ? "conflict" : "missing";
}
