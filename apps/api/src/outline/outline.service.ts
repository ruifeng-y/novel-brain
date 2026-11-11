import { Injectable } from "@nestjs/common";
import {
  chapterBriefSchema,
  outlineNodeStatusSchema,
  outlineReadinessSchema,
  outlineReplanResultSchema,
  type ChapterStatus,
  type DomainRef,
  type OutlineNode,
  type OutlineNodeCreateRequest,
  type OutlineNodeMoveRequest,
  type OutlineNodeMutationData,
  type OutlineNodePatchRequest,
  type OutlineNodeStatus,
  type OutlineReadiness,
  type OutlineReplanResult,
  type OutlineSceneCardWriteRequest,
  type OutlineVolumeContractWriteRequest,
  type OutlineWorkspace,
  type SceneCard,
  type VolumeContract,
} from "@novel-brain/contracts";
import {
  computeOutlineImpact,
  evaluateOutlineReadiness,
  type OutlineStructureNode,
} from "@novel-brain/core";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChaptersService } from "../chapters/chapters.service";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { OutlineRepository } from "./outline.repository";
import type {
  OutlineContractMutationRecord,
  OutlineMutationRecord,
  OutlineNodeWithChapter,
  OutlineReplanRecord,
  OutlineSceneMutationRecord,
  OutlineWorkContext,
  SceneCardRecord,
  VolumeContractRecord,
} from "./outline.repository";

type OutlineWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "version_conflict" }
  | { kind: "structure_invalid"; message: string }
  | { kind: "parent_invalid"; message: string }
  | { kind: "chapter_invalid"; message: string }
  | { kind: "reference_invalid"; message: string }
  | { kind: "not_volume" }
  | { kind: "not_scene" };

@Injectable()
export class OutlineService {
  constructor(
    private readonly repository: OutlineRepository,
    private readonly chapters: ChaptersService,
  ) {}

  async workspace(userId: string, workId: string, branchId: string): Promise<OutlineWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.buildWorkspace(userId, context);
  }

  async readiness(userId: string, workId: string, branchId: string): Promise<OutlineReadiness> {
    return (await this.workspace(userId, workId, branchId)).readiness;
  }

  async createNode(
    userId: string,
    workId: string,
    branchId: string,
    input: OutlineNodeCreateRequest,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    let chapter: { id: string; title: string } | null = null;
    if (input.chapterCreate) {
      const created = await this.chapters.create(
        userId,
        workId,
        branchId,
        input.chapterCreate,
        audit,
      );
      chapter = { id: created.id, title: created.title };
    } else if (input.chapterId) {
      const existing = await this.chapters.get(userId, workId, branchId, input.chapterId);
      chapter = { id: existing.id, title: existing.title };
    }
    const record = unwrap(await this.repository.createNode(userId, context, input, chapter, audit));
    return this.buildMutation(userId, context, record);
  }

  async patchNode(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    input: OutlineNodePatchRequest,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(await this.repository.patchNode(userId, context, nodeId, input, audit));
    return this.buildMutation(userId, context, record);
  }

  async moveNode(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    input: OutlineNodeMoveRequest,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(await this.repository.moveNode(userId, context, nodeId, input, audit));
    return this.buildMutation(userId, context, record);
  }

  async lockNode(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    version: number,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(
      await this.repository.setNodeLocked(userId, context, nodeId, version, true, audit),
    );
    return this.buildMutation(userId, context, record);
  }

  async unlockNode(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    version: number,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(
      await this.repository.setNodeLocked(userId, context, nodeId, version, false, audit),
    );
    return this.buildMutation(userId, context, record);
  }

  async saveVolumeContract(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    input: OutlineVolumeContractWriteRequest,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(
      await this.repository.saveVolumeContract(userId, context, nodeId, input, audit),
    );
    return this.buildContractMutation(userId, context, nodeId, record);
  }

  async saveSceneCard(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    input: OutlineSceneCardWriteRequest,
    audit: WorksAuditContext,
  ): Promise<OutlineNodeMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(
      await this.repository.saveSceneCard(userId, context, nodeId, input, audit),
    );
    return this.buildSceneMutation(userId, context, nodeId, record);
  }

  async checkReplan(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    proposedParentId?: string | null,
    proposedSortOrder?: number,
  ): Promise<OutlineReplanResult> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(
      await this.repository.checkReplan(
        userId,
        context,
        nodeId,
        proposedParentId,
        proposedSortOrder,
      ),
    );
    return toReplanResult(record);
  }

  private async buildMutation(
    userId: string,
    context: OutlineWorkContext,
    record: OutlineMutationRecord,
  ): Promise<OutlineNodeMutationData> {
    const [workspace, node] = await Promise.all([
      this.buildWorkspace(userId, context),
      this.requireNode(userId, context, record.node.id),
    ]);
    return {
      workspace,
      node: toOutlineNode(node),
      versionNodeId: record.versionNodeId,
      auditId: record.auditId,
      replan: this.buildWorkspaceReplan(workspace, record.node.id),
    };
  }

  private async buildContractMutation(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    record: OutlineContractMutationRecord,
  ): Promise<OutlineNodeMutationData> {
    const [workspace, node] = await Promise.all([
      this.buildWorkspace(userId, context),
      this.requireNode(userId, context, nodeId),
    ]);
    return {
      workspace,
      node: toOutlineNode(node),
      versionNodeId: record.versionNodeId,
      auditId: record.auditId,
      replan: this.buildWorkspaceReplan(workspace, nodeId),
    };
  }

  private async buildSceneMutation(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    record: OutlineSceneMutationRecord,
  ): Promise<OutlineNodeMutationData> {
    const [workspace, node] = await Promise.all([
      this.buildWorkspace(userId, context),
      this.requireNode(userId, context, nodeId),
    ]);
    return {
      workspace,
      node: toOutlineNode(node),
      versionNodeId: record.versionNodeId,
      auditId: record.auditId,
      replan: this.buildWorkspaceReplan(workspace, nodeId),
    };
  }

  private buildWorkspaceReplan(workspace: OutlineWorkspace, nodeId: string): OutlineReplanResult {
    const impact = computeOutlineImpact(
      workspace.nodes.map((node) => toStructureNode(node)),
      nodeId,
    );
    const warnings = impact.lockedNodeIds.length
      ? [
          {
            code: "OUTLINE_LOCKED_DESCENDANTS",
            message: "子树中有锁定节点，后续修改需要先解锁",
            nodeId: impact.lockedNodeIds[0] ?? null,
          },
        ]
      : [];
    return outlineReplanResultSchema.parse({
      ruleVersion: "outline-replan-v1",
      nodeId,
      canApply: true,
      impacted: {
        nodeIds: impact.affectedNodeIds,
        chapterIds: impact.chapterIds,
        sceneNodeIds: impact.sceneNodeIds,
        lockedNodeIds: impact.lockedNodeIds,
      },
      blockers: [],
      warnings,
    });
  }

  private async buildWorkspace(
    userId: string,
    context: OutlineWorkContext,
  ): Promise<OutlineWorkspace> {
    const [records, contractRecords, cardRecords] = await Promise.all([
      this.repository.listNodes(userId, context),
      this.repository.listVolumeContracts(userId, context),
      this.repository.listSceneCards(userId, context),
    ]);
    const nodes = orderNodes(records.map(toOutlineNode));
    const volumeContracts = contractRecords.map(toVolumeContract);
    const sceneCards = cardRecords.map(toSceneCard);
    const chapterBriefReadyIds = records
      .filter(
        (record) =>
          record.node.level === "chapter" &&
          record.chapter &&
          chapterBriefSchema.safeParse(record.chapter.brief).success,
      )
      .map((record) => record.node.id);
    const readiness = evaluateOutlineReadiness({
      nodes: nodes.map(toStructureNode),
      volumeContractNodeIds: volumeContracts.map((contract) => contract.nodeId),
      chapterBriefReadyIds,
      sceneCards: sceneCards.map((card) => ({
        nodeId: card.nodeId,
        povReady: Boolean(card.pov),
        locationReady: Boolean(card.location),
        storyTimeReady: Boolean(card.storyTime),
        beatCount: card.beats.length,
        informationReleaseCount: card.informationReleases.length,
      })),
    });
    const tensionNodeIds = new Set([
      ...nodes.filter((node) => node.tension !== null).map((node) => node.id),
      ...sceneCards.filter((card) => card.tension !== null).map((card) => card.nodeId),
    ]);
    return {
      workId: context.workId,
      branchId: context.branchId,
      nodes,
      volumeContracts,
      sceneCards,
      readiness: outlineReadinessSchema.parse(readiness),
      stats: {
        totalNodes: nodes.length,
        chapterCount: nodes.filter((node) => node.level === "chapter").length,
        plannedChapters: nodes.filter((node) => node.chapter?.status === "planned").length,
        activeChapters: nodes.filter(
          (node) =>
            node.chapter?.status === "writing" ||
            node.chapter?.status === "waiting_review" ||
            node.chapter?.status === "changes_requested",
        ).length,
        lockedChapters: nodes.filter(
          (node) =>
            node.chapter?.status === "approved" ||
            node.chapter?.status === "locked" ||
            node.chapter?.status === "published",
        ).length,
        wordCount: nodes.reduce((total, node) => total + (node.chapter?.wordCount ?? 0), 0),
        tensionPoints: tensionNodeIds.size,
      },
    };
  }

  private async requireNode(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
  ): Promise<OutlineNodeWithChapter> {
    const node = await this.repository.findNode(userId, context, nodeId);
    if (!node) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "大纲节点不存在或无权访问");
    }
    return node;
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<OutlineWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }
}

function unwrap<T>(result: OutlineWriteResult<T>): T {
  switch (result.kind) {
    case "ok":
      return result.value;
    case "not_found":
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "大纲节点不存在或无权访问");
    case "locked":
      throw new ApiError(409, "OUTLINE_NODE_LOCKED", "节点或上级已锁定，请先解锁");
    case "version_conflict":
      throw new ApiError(409, "VERSION_CONFLICT", "大纲已被其他操作更新，请刷新后重试");
    case "structure_invalid":
      throw new ApiError(400, "OUTLINE_STRUCTURE_INVALID", result.message);
    case "parent_invalid":
      throw new ApiError(400, "OUTLINE_PARENT_INVALID", result.message);
    case "chapter_invalid":
      throw new ApiError(400, "OUTLINE_CHAPTER_INVALID", result.message);
    case "reference_invalid":
      throw new ApiError(400, "OUTLINE_REFERENCE_INVALID", result.message);
    case "not_volume":
      throw new ApiError(400, "VALIDATION_INVALID", "卷契约只能挂在卷节点");
    case "not_scene":
      throw new ApiError(400, "VALIDATION_INVALID", "场景卡只能挂在场景节点");
  }
}

function toOutlineNode(record: OutlineNodeWithChapter): OutlineNode {
  const chapter = record.chapter;
  return {
    id: record.node.id,
    workId: record.node.workId,
    branchId: record.node.branchId,
    level: record.node.level as OutlineNode["level"],
    parentId: record.node.parentId,
    sortOrder: record.node.sortOrder,
    title: chapter?.title ?? record.node.title,
    summary: record.node.summary,
    status: outlineNodeStatusSchema.parse(record.node.status) as OutlineNodeStatus,
    locked: record.node.locked,
    version: record.node.version,
    chapter: chapter
      ? {
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          status: chapter.status as ChapterStatus,
          version: chapter.version,
          wordCount: chapter.wordCount,
          brief: chapterBriefSchema.safeParse(chapter.brief).success
            ? chapterBriefSchema.parse(chapter.brief)
            : null,
        }
      : null,
    tension: record.node.tension,
    versionNodeId: record.node.versionNodeId,
    createdAt: record.node.createdAt.toISOString(),
    updatedAt: record.node.updatedAt.toISOString(),
  };
}

function toVolumeContract(record: VolumeContractRecord): VolumeContract {
  return {
    id: record.id,
    nodeId: record.nodeId,
    workId: record.workId,
    branchId: record.branchId,
    objective: record.objective,
    conflict: record.conflict,
    turningPoints: record.turningPoints,
    exitConditions: record.exitConditions,
    plotLines: record.plotLines.map((line) => ({
      name: line.name,
      status: line.status as VolumeContract["plotLines"][number]["status"],
      note: line.note,
    })),
    version: record.version,
    versionNodeId: record.versionNodeId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSceneCard(record: SceneCardRecord): SceneCard {
  return {
    id: record.id,
    nodeId: record.nodeId,
    workId: record.workId,
    branchId: record.branchId,
    title: record.title,
    pov: toDomainRef(
      record.povType,
      record.povId,
      record.povBranchId,
      record.povLabel,
      record.povVersionNodeId,
      record.povObjectVersion,
    ),
    location: toDomainRef(
      record.locationType,
      record.locationId,
      record.locationBranchId,
      record.locationLabel,
      record.locationVersionNodeId,
      record.locationObjectVersion,
    ),
    storyTime:
      record.storyEra && record.storyTimeLabel && record.storySortKey !== null
        ? {
            era: record.storyEra,
            label: record.storyTimeLabel,
            sortKey: record.storySortKey,
          }
        : null,
    beats: record.beats,
    informationReleases: record.informationReleases,
    tension: record.tension,
    version: record.version,
    versionNodeId: record.versionNodeId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toDomainRef(
  type: string | null,
  id: string | null,
  branchId: string | null,
  label: string | null,
  versionNodeId: string | null,
  objectVersion: number | null,
): DomainRef | null {
  if (!type || !id || !branchId) {
    return null;
  }
  return {
    type: type as DomainRef["type"],
    id,
    branchId,
    label,
    version: versionNodeId && objectVersion ? { branchId, versionNodeId, objectVersion } : null,
  };
}

function toStructureNode(node: OutlineNode): OutlineStructureNode {
  return {
    id: node.id,
    workId: node.workId,
    branchId: node.branchId,
    level: node.level,
    parentId: node.parentId,
    sortOrder: node.sortOrder,
    locked: node.locked,
    chapterId: node.chapter?.id ?? null,
  };
}

function toReplanResult(record: OutlineReplanRecord): OutlineReplanResult {
  return outlineReplanResultSchema.parse({
    ruleVersion: "outline-replan-v1",
    nodeId: record.nodeId,
    canApply: record.canApply,
    impacted: {
      nodeIds: record.impact.affectedNodeIds,
      chapterIds: record.impact.chapterIds,
      sceneNodeIds: record.impact.sceneNodeIds,
      lockedNodeIds: record.impact.lockedNodeIds,
    },
    blockers: record.blockers,
    warnings: record.warnings,
  });
}

function orderNodes(nodes: OutlineNode[]): OutlineNode[] {
  const children = new Map<string | null, OutlineNode[]>();
  for (const node of nodes) {
    const group = children.get(node.parentId) ?? [];
    group.push(node);
    children.set(node.parentId, group);
  }
  for (const group of children.values()) {
    group.sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  }
  const ordered: OutlineNode[] = [];
  const seen = new Set<string>();
  const visit = (node: OutlineNode) => {
    if (seen.has(node.id)) {
      return;
    }
    seen.add(node.id);
    ordered.push(node);
    for (const child of children.get(node.id) ?? []) {
      visit(child);
    }
  };
  for (const root of children.get(null) ?? []) {
    visit(root);
  }
  for (const node of nodes) {
    if (!seen.has(node.id)) {
      ordered.push(node);
      seen.add(node.id);
    }
  }
  return ordered;
}
