export type OutlineLevel = "book" | "volume" | "act" | "chapter" | "scene";

export interface OutlineStructureNode {
  id: string;
  workId: string;
  branchId: string;
  level: OutlineLevel;
  parentId: string | null;
  sortOrder: number;
  locked: boolean;
  chapterId?: string | null;
}

export type OutlineStructureIssueCode =
  | "OUTLINE_ROOT_MISSING"
  | "OUTLINE_ROOT_DUPLICATE"
  | "OUTLINE_ROOT_INVALID"
  | "OUTLINE_PARENT_MISSING"
  | "OUTLINE_PARENT_LEVEL_INVALID"
  | "OUTLINE_PARENT_BRANCH_MISMATCH"
  | "OUTLINE_CYCLE"
  | "OUTLINE_DUPLICATE_ORDER"
  | "OUTLINE_CHAPTER_LINK_INVALID"
  | "OUTLINE_CHAPTER_DUPLICATE";

export interface OutlineStructureIssue {
  code: OutlineStructureIssueCode;
  nodeId: string | null;
  parentId: string | null;
  message: string;
}

export interface OutlineImpact {
  nodeId: string;
  affectedNodeIds: string[];
  chapterIds: string[];
  sceneNodeIds: string[];
  lockedNodeIds: string[];
}

export interface OutlineSceneReadinessInput {
  nodeId: string;
  povReady: boolean;
  locationReady: boolean;
  storyTimeReady: boolean;
  beatCount: number;
  informationReleaseCount: number;
}

export interface OutlineReadinessInput {
  nodes: OutlineStructureNode[];
  volumeContractNodeIds: string[];
  chapterBriefReadyIds: string[];
  sceneCards: OutlineSceneReadinessInput[];
}

export type OutlineReadinessSeverity = "blocker" | "warning";

export interface OutlineReadinessItem {
  key: string;
  label: string;
  severity: OutlineReadinessSeverity;
  ready: boolean;
  resourceType: "outline_branch" | "outline_node";
  resourceId: string | null;
  remediation: string;
}

export interface OutlineReadinessResult {
  ruleVersion: typeof OUTLINE_READINESS_RULE_VERSION;
  status: "not_ready" | "partial" | "ready";
  canProceed: boolean;
  completed: number;
  total: number;
  items: OutlineReadinessItem[];
}

export const OUTLINE_READINESS_RULE_VERSION = "outline-readiness-v1" as const;

export function validateOutlineStructure(nodes: OutlineStructureNode[]): OutlineStructureIssue[] {
  const issues: OutlineStructureIssue[] = [];
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const books = nodes.filter((entry) => entry.level === "book");

  if (books.length === 0) {
    issues.push({
      code: "OUTLINE_ROOT_MISSING",
      nodeId: null,
      parentId: null,
      message: "大纲缺少全书根节点",
    });
  }
  for (const book of books.slice(1)) {
    issues.push({
      code: "OUTLINE_ROOT_DUPLICATE",
      nodeId: book.id,
      parentId: null,
      message: "同一创作线只能有一个全书根节点",
    });
  }

  for (const entry of nodes) {
    const expectedParentLevel = outlineParentLevel(entry.level);
    if (entry.level === "book") {
      if (entry.parentId !== null) {
        issues.push({
          code: "OUTLINE_ROOT_INVALID",
          nodeId: entry.id,
          parentId: entry.parentId,
          message: "全书节点不能有上级节点",
        });
      }
    } else if (entry.parentId === null) {
      issues.push({
        code: "OUTLINE_PARENT_MISSING",
        nodeId: entry.id,
        parentId: null,
        message: "非全书节点必须有上级节点",
      });
    } else {
      const parent = byId.get(entry.parentId);
      if (!parent) {
        issues.push({
          code: "OUTLINE_PARENT_MISSING",
          nodeId: entry.id,
          parentId: entry.parentId,
          message: "上级节点不存在",
        });
      } else {
        if (parent.level !== expectedParentLevel) {
          issues.push({
            code: "OUTLINE_PARENT_LEVEL_INVALID",
            nodeId: entry.id,
            parentId: entry.parentId,
            message: `该层级只能挂在${levelLabel(expectedParentLevel ?? "book")}下`,
          });
        }
        if (parent.workId !== entry.workId || parent.branchId !== entry.branchId) {
          issues.push({
            code: "OUTLINE_PARENT_BRANCH_MISMATCH",
            nodeId: entry.id,
            parentId: entry.parentId,
            message: "上级节点必须属于同一作品的同一创作线",
          });
        }
      }
    }

    if ((entry.level === "chapter") !== Boolean(entry.chapterId)) {
      issues.push({
        code: "OUTLINE_CHAPTER_LINK_INVALID",
        nodeId: entry.id,
        parentId: entry.parentId,
        message: entry.level === "chapter" ? "章节点必须引用已有章节" : "只有章节点可以引用章节",
      });
    }
  }

  for (const entry of nodes) {
    if (cycleOrigin(entry.id, byId)) {
      issues.push({
        code: "OUTLINE_CYCLE",
        nodeId: entry.id,
        parentId: entry.parentId,
        message: "大纲层级存在循环引用",
      });
    }
  }

  const siblingGroups = new Map<string, OutlineStructureNode[]>();
  for (const entry of nodes) {
    const key = `${entry.branchId}|${entry.parentId ?? "root"}|${entry.sortOrder}`;
    const group = siblingGroups.get(key) ?? [];
    group.push(entry);
    siblingGroups.set(key, group);
  }
  for (const group of siblingGroups.values()) {
    for (const duplicate of group.slice(1)) {
      issues.push({
        code: "OUTLINE_DUPLICATE_ORDER",
        nodeId: duplicate.id,
        parentId: duplicate.parentId,
        message: "同一上级下的节点顺序不能重复",
      });
    }
  }

  const chapterGroups = new Map<string, OutlineStructureNode[]>();
  for (const entry of nodes) {
    if (!entry.chapterId) {
      continue;
    }
    const group = chapterGroups.get(entry.chapterId) ?? [];
    group.push(entry);
    chapterGroups.set(entry.chapterId, group);
  }
  for (const group of chapterGroups.values()) {
    for (const duplicate of group.slice(1)) {
      issues.push({
        code: "OUTLINE_CHAPTER_DUPLICATE",
        nodeId: duplicate.id,
        parentId: duplicate.parentId,
        message: "同一章节只能有一个章节点",
      });
    }
  }

  return issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code) || (left.nodeId ?? "").localeCompare(right.nodeId ?? ""),
  );
}

export function computeOutlineImpact(nodes: OutlineStructureNode[], nodeId: string): OutlineImpact {
  const children = new Map<string | null, OutlineStructureNode[]>();
  for (const entry of nodes) {
    const group = children.get(entry.parentId) ?? [];
    group.push(entry);
    children.set(entry.parentId, group);
  }
  for (const group of children.values()) {
    group.sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  }

  const affected: OutlineStructureNode[] = [];
  const queue = nodes.filter((entry) => entry.id === nodeId);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    affected.push(current);
    queue.push(...(children.get(current.id) ?? []));
  }

  return {
    nodeId,
    affectedNodeIds: affected.map((entry) => entry.id),
    chapterIds: unique(
      affected
        .filter((entry) => entry.level === "chapter" && entry.chapterId)
        .map((entry) => entry.chapterId as string),
    ),
    sceneNodeIds: affected.filter((entry) => entry.level === "scene").map((entry) => entry.id),
    lockedNodeIds: affected.filter((entry) => entry.locked).map((entry) => entry.id),
  };
}

export function evaluateOutlineReadiness(input: OutlineReadinessInput): OutlineReadinessResult {
  const issues = validateOutlineStructure(input.nodes);
  const items: OutlineReadinessItem[] = [];
  const books = input.nodes.filter((entry) => entry.level === "book");

  if (issues.length > 0) {
    items.push({
      key: "structure",
      label: "五层结构",
      severity: "blocker",
      ready: false,
      resourceType: "outline_branch",
      resourceId: null,
      remediation: "修正大纲层级、循环引用或重复顺序",
    });
  }
  items.push({
    key: "book_root",
    label: "全书根节点",
    severity: "blocker",
    ready: books.length === 1,
    resourceType: "outline_branch",
    resourceId: books[0]?.id ?? null,
    remediation: books.length === 0 ? "先创建全书大纲" : "只保留一个全书根节点",
  });

  const volumeNodeIds = new Set(input.volumeContractNodeIds);
  for (const volume of input.nodes.filter((entry) => entry.level === "volume")) {
    items.push({
      key: `volume_contract:${volume.id}`,
      label: "卷契约",
      severity: "blocker",
      ready: volumeNodeIds.has(volume.id),
      resourceType: "outline_node",
      resourceId: volume.id,
      remediation: "补齐卷目标、核心冲突、转折、退出条件和相关剧情线",
    });
  }

  const briefReadyNodeIds = new Set(input.chapterBriefReadyIds);
  for (const chapter of input.nodes.filter(
    (entry) => entry.level === "chapter" && entry.chapterId,
  )) {
    items.push({
      key: `chapter_brief:${chapter.id}`,
      label: "章纲",
      severity: "blocker",
      ready: briefReadyNodeIds.has(chapter.id),
      resourceType: "outline_node",
      resourceId: chapter.id,
      remediation: "补齐章目标、POV、地点、场景节拍和必用事实",
    });
  }

  const cards = new Map(input.sceneCards.map((card) => [card.nodeId, card]));
  for (const scene of input.nodes.filter((entry) => entry.level === "scene")) {
    const card = cards.get(scene.id);
    if (!card) {
      items.push({
        key: `scene_card:${scene.id}`,
        label: "场景卡",
        severity: "blocker",
        ready: false,
        resourceType: "outline_node",
        resourceId: scene.id,
        remediation: "补场景卡、节拍、POV、地点和信息释放",
      });
      continue;
    }
    items.push(
      sceneItem(scene.id, "scene_pov", "场景 POV", "blocker", card.povReady, "指定场景 POV"),
      sceneItem(
        scene.id,
        "scene_location",
        "场景地点",
        "blocker",
        card.locationReady,
        "指定场景地点",
      ),
      sceneItem(
        scene.id,
        "scene_beats",
        "场景节拍",
        "blocker",
        card.beatCount > 0,
        "至少写一个有序节拍",
      ),
      sceneItem(
        scene.id,
        "scene_time",
        "故事时间",
        "warning",
        card.storyTimeReady,
        "补故事时间点，避免时间线冲突",
      ),
      sceneItem(
        scene.id,
        "scene_information",
        "信息释放",
        "warning",
        card.informationReleaseCount > 0,
        "补信息释放和知情边界",
      ),
    );
  }

  const sorted = items.sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.key.localeCompare(right.key),
  );
  const blockers = sorted.filter((item) => item.severity === "blocker" && !item.ready).length;
  const warnings = sorted.filter((item) => item.severity === "warning" && !item.ready).length;
  return {
    ruleVersion: OUTLINE_READINESS_RULE_VERSION,
    status: blockers > 0 ? "not_ready" : warnings > 0 ? "partial" : "ready",
    canProceed: blockers === 0,
    completed: sorted.filter((item) => item.ready).length,
    total: sorted.length,
    items: sorted,
  };
}

export function outlineParentLevel(level: OutlineLevel): OutlineLevel | null {
  switch (level) {
    case "book":
      return null;
    case "volume":
      return "book";
    case "act":
      return "volume";
    case "chapter":
      return "act";
    case "scene":
      return "chapter";
  }
}

function sceneItem(
  nodeId: string,
  keyPrefix: string,
  label: string,
  severity: OutlineReadinessSeverity,
  ready: boolean,
  remediation: string,
): OutlineReadinessItem {
  return {
    key: `${keyPrefix}:${nodeId}`,
    label,
    severity,
    ready,
    resourceType: "outline_node",
    resourceId: nodeId,
    remediation,
  };
}

function severityRank(severity: OutlineReadinessSeverity): number {
  return severity === "blocker" ? 0 : 1;
}

function cycleOrigin(nodeId: string, byId: Map<string, OutlineStructureNode>): boolean {
  const seen = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null) {
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function levelLabel(level: OutlineLevel): string {
  switch (level) {
    case "book":
      return "全书";
    case "volume":
      return "卷";
    case "act":
      return "幕";
    case "chapter":
      return "章";
    case "scene":
      return "场景";
  }
}
