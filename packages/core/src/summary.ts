import { createHash } from "node:crypto";

export const SUMMARY_COMPILER_VERSION = "summary-compiler-v1";
export const SUMMARY_MODEL_VERSION = "deterministic-summary-v1";
export const SUMMARY_INVALIDATION_RULE_VERSION = "summary-invalidation-v1";

export type SummaryOutlineLevel = "book" | "volume" | "act" | "chapter" | "scene";

export interface SummaryOutlineNode {
  id: string;
  branchId: string;
  level: SummaryOutlineLevel;
  parentId: string | null;
  chapterId: string | null;
}

export type SummaryInvalidationTrigger =
  | {
      kind: "chapter";
      branchId: string;
      chapterId: string;
    }
  | {
      kind: "outline_node";
      branchId: string;
      nodeId: string;
    }
  | {
      kind: "branch";
      branchId: string;
    };

export interface SummaryInvalidation {
  branchId: string;
  scopeIds: string[];
}

export type SummaryLevel = "chapter" | "stage" | "volume" | "book";

export interface SummarySourceRange {
  nodeId: string;
  versionNodeId: string | null;
  objectVersion: number;
  chapterFrom: number;
  chapterTo: number | null;
}

export interface SummaryProjectionInput {
  level: SummaryLevel;
  title: string;
  outlineSummary: string;
  contractText?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  manuscript?: string;
  facts?: string[];
  childSummaries?: Array<{
    label: string;
    content: string;
    fromChapter: number;
    toChapter: number | null;
  }>;
  sourceRanges: SummarySourceRange[];
}

export interface SummaryProjection {
  content: string;
  contentHash: string;
  inputHash: string;
  fromChapter: number;
  toChapter: number | null;
  sourceRanges: SummarySourceRange[];
}

const SUMMARY_LEVEL_RANK: Record<SummaryOutlineLevel, number> = {
  chapter: 0,
  scene: 1,
  act: 2,
  volume: 3,
  book: 4,
};

export function computeSummaryInvalidation(
  nodes: SummaryOutlineNode[],
  trigger: SummaryInvalidationTrigger,
): SummaryInvalidation {
  const branchNodes = nodes.filter((node) => node.branchId === trigger.branchId);
  const byId = new Map(branchNodes.map((node) => [node.id, node]));
  const impacted = new Set<string>();

  const addAncestors = (node: SummaryOutlineNode): void => {
    let current: SummaryOutlineNode | undefined = node;
    while (current) {
      if (current.level !== "scene") {
        impacted.add(current.id);
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  };

  if (trigger.kind === "branch") {
    for (const node of branchNodes) {
      if (node.level !== "scene") {
        impacted.add(node.id);
      }
    }
  } else if (trigger.kind === "chapter") {
    const chapterNode = branchNodes.find(
      (node) => node.level === "chapter" && node.chapterId === trigger.chapterId,
    );
    if (chapterNode) {
      addAncestors(chapterNode);
    }
  } else {
    const changed = byId.get(trigger.nodeId);
    if (changed) {
      addAncestors(changed);
      addDescendants(branchNodes, changed.id, impacted);
    }
  }

  return {
    branchId: trigger.branchId,
    scopeIds: [...impacted].sort((left, right) => {
      const leftNode = byId.get(left);
      const rightNode = byId.get(right);
      return (
        (leftNode ? SUMMARY_LEVEL_RANK[leftNode.level] : Number.MAX_SAFE_INTEGER) -
          (rightNode ? SUMMARY_LEVEL_RANK[rightNode.level] : Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right)
      );
    }),
  };
}

export function buildSummaryProjection(input: SummaryProjectionInput): SummaryProjection {
  const sourceRanges = [...input.sourceRanges].sort(compareSourceRanges);
  const fromChapter =
    sourceRanges.length > 0 ? Math.min(...sourceRanges.map((range) => range.chapterFrom)) : 1;
  const chapterEnds = sourceRanges.flatMap((range) =>
    range.chapterTo === null ? [] : [range.chapterTo],
  );
  const toChapter =
    sourceRanges.length === 0 ||
    sourceRanges.some((range) => range.chapterTo === null) ||
    chapterEnds.length === 0
      ? null
      : Math.max(...chapterEnds);
  const lines = [`${levelLabel(input.level)}「${input.title}」`];
  if (input.outlineSummary.trim()) {
    lines.push(input.outlineSummary.trim());
  }
  if (input.contractText?.trim()) {
    lines.push(input.contractText.trim());
  }
  if (input.level === "chapter") {
    if (input.chapterTitle) {
      lines.push(
        `第 ${input.chapterNumber ?? "?"} 章「${input.chapterTitle}」：${truncate(
          input.manuscript?.trim() || "尚未保存正文",
          500,
        )}`,
      );
    }
    if (input.facts && input.facts.length > 0) {
      lines.push(`本章事实：${input.facts.map((fact) => truncate(fact, 160)).join("；")}`);
    }
  } else {
    for (const child of input.childSummaries ?? []) {
      lines.push(`${child.label}：${truncate(child.content, 320)}`);
    }
  }
  const content = lines.filter((line) => line.trim()).join("\n");
  const inputHash = hashStable({
    level: input.level,
    title: input.title,
    outlineSummary: input.outlineSummary,
    contractText: input.contractText ?? null,
    chapterNumber: input.chapterNumber ?? null,
    chapterTitle: input.chapterTitle ?? null,
    manuscript: input.manuscript ?? null,
    facts: input.facts ?? [],
    childSummaries: input.childSummaries ?? [],
    sourceRanges,
  });
  return {
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
    inputHash,
    fromChapter,
    toChapter,
    sourceRanges,
  };
}

export function summaryLevelForOutlineLevel(level: SummaryOutlineLevel): SummaryLevel | null {
  switch (level) {
    case "chapter":
      return "chapter";
    case "act":
      return "stage";
    case "volume":
      return "volume";
    case "book":
      return "book";
    case "scene":
      return null;
  }
}

function addDescendants(
  nodes: SummaryOutlineNode[],
  parentId: string,
  impacted: Set<string>,
): void {
  for (const node of nodes) {
    if (node.parentId !== parentId) {
      continue;
    }
    if (node.level !== "scene") {
      impacted.add(node.id);
    }
    addDescendants(nodes, node.id, impacted);
  }
}

function compareSourceRanges(left: SummarySourceRange, right: SummarySourceRange): number {
  return (
    left.chapterFrom - right.chapterFrom ||
    (left.chapterTo ?? Number.MAX_SAFE_INTEGER) - (right.chapterTo ?? Number.MAX_SAFE_INTEGER) ||
    left.nodeId.localeCompare(right.nodeId) ||
    (left.versionNodeId ?? "").localeCompare(right.versionNodeId ?? "")
  );
}

function levelLabel(level: SummaryLevel): string {
  switch (level) {
    case "chapter":
      return "章";
    case "stage":
      return "阶段";
    case "volume":
      return "卷";
    case "book":
      return "全书";
  }
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length <= maxLength ? value : `${characters.slice(0, maxLength).join("")}…`;
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
