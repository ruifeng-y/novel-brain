import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  entities,
  mapNodes,
  outlineNodes,
  sceneCards,
  versionNodes,
  volumeContracts,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import {
  computeOutlineImpact,
  outlineParentLevel,
  validateOutlineStructure,
  type OutlineImpact,
  type OutlineStructureNode,
} from "@novel-brain/core";
import type {
  DomainRef,
  OutlineNodeCreateRequest,
  OutlineNodeMoveRequest,
  OutlineNodePatchRequest,
  OutlineSceneCardWriteRequest,
  OutlineVolumeContractWriteRequest,
  SceneBeat,
  SceneInformationRelease,
} from "@novel-brain/contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type OutlineNodeRecord = InferSelectModel<typeof outlineNodes>;
export type ChapterRecord = InferSelectModel<typeof chapters>;
export type VolumeContractRecord = InferSelectModel<typeof volumeContracts>;
export type SceneCardRecord = InferSelectModel<typeof sceneCards>;

export interface OutlineWorkContext {
  workId: string;
  branchId: string;
}

export interface OutlineAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface OutlineNodeWithChapter {
  node: OutlineNodeRecord;
  chapter: ChapterRecord | null;
}

export type OutlineWriteResult<T> =
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

export interface OutlineMutationRecord {
  node: OutlineNodeRecord;
  versionNodeId: string;
  auditId: string;
}

export interface OutlineContractMutationRecord {
  contract: VolumeContractRecord;
  versionNodeId: string;
  auditId: string;
}

export interface OutlineSceneMutationRecord {
  card: SceneCardRecord;
  versionNodeId: string;
  auditId: string;
}

export interface OutlineReplanRecord {
  nodeId: string;
  canApply: boolean;
  impact: OutlineImpact;
  blockers: Array<{ code: string; message: string; nodeId: string | null }>;
  warnings: Array<{ code: string; message: string; nodeId: string | null }>;
}

@Injectable()
export class OutlineRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<OutlineWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async listNodes(userId: string, context: OutlineWorkContext): Promise<OutlineNodeWithChapter[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ node: outlineNodes, chapter: chapters })
        .from(outlineNodes)
        .leftJoin(chapters, eq(chapters.id, outlineNodes.chapterId))
        .where(
          and(
            eq(outlineNodes.userId, userId),
            eq(outlineNodes.workId, context.workId),
            eq(outlineNodes.branchId, context.branchId),
          ),
        )
        .orderBy(asc(outlineNodes.createdAt));
      return rows.map(({ node, chapter }) => ({ node, chapter: chapter ?? null }));
    });
  }

  async listVolumeContracts(
    userId: string,
    context: OutlineWorkContext,
  ): Promise<VolumeContractRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(volumeContracts)
        .where(
          and(
            eq(volumeContracts.userId, userId),
            eq(volumeContracts.workId, context.workId),
            eq(volumeContracts.branchId, context.branchId),
          ),
        )
        .orderBy(asc(volumeContracts.createdAt)),
    );
  }

  async listSceneCards(userId: string, context: OutlineWorkContext): Promise<SceneCardRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(sceneCards)
        .where(
          and(
            eq(sceneCards.userId, userId),
            eq(sceneCards.workId, context.workId),
            eq(sceneCards.branchId, context.branchId),
          ),
        )
        .orderBy(asc(sceneCards.createdAt)),
    );
  }

  async findNode(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
  ): Promise<OutlineNodeWithChapter | undefined> {
    return this.withTenant(userId, async (transaction) =>
      this.findNodeInTransaction(transaction, userId, context, nodeId),
    );
  }

  async createNode(
    userId: string,
    context: OutlineWorkContext,
    input: OutlineNodeCreateRequest,
    chapter: { id: string; title: string } | null,
    audit: OutlineAuditContext,
  ): Promise<OutlineWriteResult<OutlineMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      let headNodeId = await requireBranchHead(transaction, userId, context);
      const current = await loadNodesForUpdate(transaction, userId, context);

      const parentIssue = validateProposedParent(current, input.level, input.parentId);
      if (parentIssue) {
        return parentIssue;
      }
      if (input.parentId && isLockedByAncestor(current, input.parentId)) {
        return { kind: "locked" };
      }

      const nodeId = uuidv7();
      const plan = planInsert(current, input.parentId, input.sortOrder, nodeId);
      const structureCandidate = [
        ...current.map((entry) => ({
          ...toStructureNode(entry),
          sortOrder: plan.orders.get(entry.id) ?? entry.sortOrder,
        })),
        {
          id: nodeId,
          workId: context.workId,
          branchId: context.branchId,
          level: input.level,
          parentId: input.parentId,
          sortOrder: plan.insertAt,
          locked: false,
          chapterId: chapter?.id ?? null,
        } satisfies OutlineStructureNode,
      ];
      const structureIssue = mapStructureIssues(validateOutlineStructure(structureCandidate));
      if (structureIssue) {
        return structureIssue;
      }

      headNodeId = await applySiblingOrders(
        transaction,
        userId,
        context,
        plan.changed,
        plan.orders,
        headNodeId,
      );

      const now = new Date();
      const versionNodeId = uuidv7();
      await insertOutlineVersion(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "outline_node",
        nodeId,
        1,
        "outline.node_created",
        `创建${levelTitle(input.level)}节点`,
        {
          level: input.level,
          parentId: input.parentId,
          sortOrder: plan.insertAt,
          chapterId: chapter?.id ?? null,
        },
        now,
      );
      const [created] = await transaction
        .insert(outlineNodes)
        .values({
          id: nodeId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          level: input.level,
          parentId: input.parentId,
          sortOrder: plan.insertAt,
          title: chapter?.title ?? input.title ?? input.sceneCard?.title ?? "",
          summary: input.summary,
          status: input.status,
          locked: false,
          version: 1,
          chapterId: chapter?.id ?? null,
          tension: input.tension,
          versionNodeId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create outline node");
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "outline.node_created",
        "outline_node",
        created.id,
      );

      if (input.sceneCard) {
        const sceneVersionNodeId = uuidv7();
        await this.upsertSceneCardInTransaction(
          transaction,
          userId,
          context,
          created,
          input.sceneCard,
          null,
          versionNodeId,
          sceneVersionNodeId,
          now,
        );
        await advanceBranchHead(transaction, context, sceneVersionNodeId, now);
        await writeAudit(
          transaction,
          userId,
          audit,
          "outline.scene_card_saved",
          "scene_card",
          created.id,
        );
      }
      return { kind: "ok", value: { node: created, versionNodeId, auditId } };
    });
  }

  async patchNode(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    input: OutlineNodePatchRequest,
    audit: OutlineAuditContext,
  ): Promise<OutlineWriteResult<OutlineMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await loadNodesForUpdate(transaction, userId, context);
      const node = current.find((entry) => entry.id === nodeId);
      if (!node) {
        return { kind: "not_found" };
      }
      if (isLockedByAncestor(current, node.id)) {
        return { kind: "locked" };
      }
      if (node.version !== input.version) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const versionNodeId = uuidv7();
      const nextTitle = input.title ?? node.title;
      const nextSummary = input.summary ?? node.summary;
      const nextStatus = input.status ?? node.status;
      const nextTension = input.tension === undefined ? node.tension : input.tension;
      await insertOutlineVersion(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "outline_node",
        node.id,
        node.version + 1,
        "outline.node_updated",
        `更新${levelTitle(node.level)}节点`,
        {
          title: nextTitle,
          summary: nextSummary,
          status: nextStatus,
          tension: nextTension,
        },
        now,
      );
      const [updated] = await transaction
        .update(outlineNodes)
        .set({
          title: nextTitle,
          summary: nextSummary,
          status: nextStatus,
          tension: nextTension,
          version: node.version + 1,
          versionNodeId,
          updatedAt: now,
        })
        .where(and(eq(outlineNodes.id, node.id), eq(outlineNodes.version, node.version)))
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "outline.node_updated",
        "outline_node",
        updated.id,
      );
      return { kind: "ok", value: { node: updated, versionNodeId, auditId } };
    });
  }

  async moveNode(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    input: OutlineNodeMoveRequest,
    audit: OutlineAuditContext,
  ): Promise<OutlineWriteResult<OutlineMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      let headNodeId = await requireBranchHead(transaction, userId, context);
      const current = await loadNodesForUpdate(transaction, userId, context);
      const node = current.find((entry) => entry.id === nodeId);
      if (!node) {
        return { kind: "not_found" };
      }
      if (isLockedByAncestor(current, node.id)) {
        return { kind: "locked" };
      }
      if (node.version !== input.version) {
        return { kind: "version_conflict" };
      }
      const parentIssue = validateProposedParent(
        current,
        node.level as OutlineStructureNode["level"],
        input.parentId,
      );
      if (parentIssue) {
        return parentIssue;
      }
      if (input.parentId && isDescendant(current, node.id, input.parentId)) {
        return { kind: "parent_invalid", message: "不能把节点移入自己的子树" };
      }
      if (input.parentId && isLockedByAncestor(current, input.parentId)) {
        return { kind: "locked" };
      }

      const plan = planMove(current, node, input.parentId, input.sortOrder);
      const structureCandidate = current.map((entry) => ({
        ...toStructureNode(entry),
        parentId: entry.id === node.id ? input.parentId : entry.parentId,
        sortOrder: plan.orders.get(entry.id) ?? entry.sortOrder,
      }));
      const structureIssue = mapStructureIssues(validateOutlineStructure(structureCandidate));
      if (structureIssue) {
        return structureIssue;
      }

      await offsetSortOrders(transaction, plan.changed, node.id);
      headNodeId = await applySiblingOrders(
        transaction,
        userId,
        context,
        plan.changed,
        plan.orders,
        headNodeId,
        true,
      );

      const now = new Date();
      const versionNodeId = uuidv7();
      await insertOutlineVersion(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "outline_node",
        node.id,
        node.version + 1,
        "outline.node_moved",
        `移动${levelTitle(node.level)}节点`,
        {
          parentId: input.parentId,
          sortOrder: plan.insertAt,
        },
        now,
      );
      const [updated] = await transaction
        .update(outlineNodes)
        .set({
          parentId: input.parentId,
          sortOrder: plan.insertAt,
          version: node.version + 1,
          versionNodeId,
          updatedAt: now,
        })
        .where(and(eq(outlineNodes.id, node.id), eq(outlineNodes.version, node.version)))
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "outline.node_moved",
        "outline_node",
        updated.id,
      );
      return { kind: "ok", value: { node: updated, versionNodeId, auditId } };
    });
  }

  async setNodeLocked(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    expectedVersion: number,
    locked: boolean,
    audit: OutlineAuditContext,
  ): Promise<OutlineWriteResult<OutlineMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await loadNodesForRead(transaction, userId, context);
      const node = current.find((entry) => entry.id === nodeId);
      if (!node) {
        return { kind: "not_found" };
      }
      if (!locked && isLockedByAncestor(current, node.id, false)) {
        return { kind: "locked" };
      }
      if (node.version !== expectedVersion) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const versionNodeId = uuidv7();
      const action = locked ? "outline.node_locked" : "outline.node_unlocked";
      await insertOutlineVersion(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "outline_node",
        node.id,
        node.version + 1,
        action,
        locked ? `锁定${levelTitle(node.level)}节点` : `解锁${levelTitle(node.level)}节点`,
        { locked },
        now,
      );
      const [updated] = await transaction
        .update(outlineNodes)
        .set({
          locked,
          version: node.version + 1,
          versionNodeId,
          updatedAt: now,
        })
        .where(and(eq(outlineNodes.id, node.id), eq(outlineNodes.version, node.version)))
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        action,
        "outline_node",
        updated.id,
      );
      return { kind: "ok", value: { node: updated, versionNodeId, auditId } };
    });
  }

  async saveVolumeContract(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    input: OutlineVolumeContractWriteRequest,
    audit: OutlineAuditContext,
  ): Promise<OutlineWriteResult<OutlineContractMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await loadNodesForUpdate(transaction, userId, context);
      const node = current.find((entry) => entry.id === nodeId);
      if (!node) {
        return { kind: "not_found" };
      }
      if (node.level !== "volume") {
        return { kind: "not_volume" };
      }
      if (isLockedByAncestor(current, node.id)) {
        return { kind: "locked" };
      }
      const [existing] = await transaction
        .select()
        .from(volumeContracts)
        .where(eq(volumeContracts.nodeId, node.id))
        .limit(1);
      if (existing && input.version !== existing.version) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const versionNodeId = uuidv7();
      const contractId = existing?.id ?? uuidv7();
      const contractVersion = existing ? existing.version + 1 : 1;
      await insertOutlineVersion(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "volume_contract",
        contractId,
        contractVersion,
        "outline.volume_contract_saved",
        "保存卷契约",
        { nodeId: node.id, version: contractVersion },
        now,
      );
      let contract: VolumeContractRecord | undefined;
      if (existing) {
        [contract] = await transaction
          .update(volumeContracts)
          .set({
            objective: input.objective,
            conflict: input.conflict,
            turningPoints: input.turningPoints,
            exitConditions: input.exitConditions,
            plotLines: input.plotLines,
            version: contractVersion,
            versionNodeId,
            updatedAt: now,
          })
          .where(
            and(eq(volumeContracts.id, existing.id), eq(volumeContracts.version, existing.version)),
          )
          .returning();
      } else {
        [contract] = await transaction
          .insert(volumeContracts)
          .values({
            id: contractId,
            nodeId: node.id,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            objective: input.objective,
            conflict: input.conflict,
            turningPoints: input.turningPoints,
            exitConditions: input.exitConditions,
            plotLines: input.plotLines,
            version: 1,
            versionNodeId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      }
      if (!contract) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "outline.volume_contract_saved",
        "volume_contract",
        contract.id,
      );
      return { kind: "ok", value: { contract, versionNodeId, auditId } };
    });
  }

  async saveSceneCard(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    input: OutlineSceneCardWriteRequest,
    audit: OutlineAuditContext,
  ): Promise<OutlineWriteResult<OutlineSceneMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await loadNodesForUpdate(transaction, userId, context);
      const node = current.find((entry) => entry.id === nodeId);
      if (!node) {
        return { kind: "not_found" };
      }
      if (node.level !== "scene") {
        return { kind: "not_scene" };
      }
      if (isLockedByAncestor(current, node.id)) {
        return { kind: "locked" };
      }
      const referenceIssue = await validateSceneReferences(transaction, userId, context, input);
      if (referenceIssue) {
        return referenceIssue;
      }
      const [existing] = await transaction
        .select()
        .from(sceneCards)
        .where(eq(sceneCards.nodeId, node.id))
        .limit(1);
      if (existing && input.version !== existing.version) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const versionNodeId = uuidv7();
      const result = await this.upsertSceneCardInTransaction(
        transaction,
        userId,
        context,
        node,
        input,
        existing ?? null,
        headNodeId,
        versionNodeId,
        now,
      );
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "outline.scene_card_saved",
        "scene_card",
        result.id,
      );
      return { kind: "ok", value: { card: result, versionNodeId, auditId } };
    });
  }

  async checkReplan(
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
    proposedParentId?: string | null,
    proposedSortOrder?: number,
  ): Promise<OutlineWriteResult<OutlineReplanRecord>> {
    return this.withTenant(userId, async (transaction) => {
      const current = await loadNodesForUpdate(transaction, userId, context);
      const node = current.find((entry) => entry.id === nodeId);
      if (!node) {
        return { kind: "not_found" };
      }
      const blockers: OutlineReplanRecord["blockers"] = [];
      const warnings: OutlineReplanRecord["warnings"] = [];
      if (isLockedByAncestor(current, node.id)) {
        blockers.push({
          code: "OUTLINE_NODE_LOCKED",
          message: "节点或上级已锁定，需先解锁",
          nodeId: node.id,
        });
      }
      if (proposedParentId !== undefined) {
        const parentIssue = validateProposedParent(
          current,
          node.level as OutlineStructureNode["level"],
          proposedParentId,
        );
        if (parentIssue) {
          blockers.push({
            code:
              parentIssue.kind === "parent_invalid"
                ? "OUTLINE_PARENT_INVALID"
                : "OUTLINE_STRUCTURE_INVALID",
            message: parentIssue.message,
            nodeId: node.id,
          });
        } else if (proposedParentId && isDescendant(current, node.id, proposedParentId)) {
          blockers.push({
            code: "OUTLINE_PARENT_INVALID",
            message: "不能把节点移入自己的子树",
            nodeId: node.id,
          });
        } else if (proposedParentId && isLockedByAncestor(current, proposedParentId)) {
          blockers.push({
            code: "OUTLINE_NODE_LOCKED",
            message: "目标上级已锁定",
            nodeId: proposedParentId,
          });
        }
      }
      const impact = computeOutlineImpact(current.map(toStructureNode), node.id);
      const lockedDescendants = impact.lockedNodeIds.filter((id) => id !== node.id);
      if (lockedDescendants.length > 0) {
        warnings.push({
          code: "OUTLINE_LOCKED_DESCENDANTS",
          message: "子树中有锁定节点，重排后仍保持锁定",
          nodeId: lockedDescendants[0] ?? null,
        });
      }
      void proposedSortOrder;
      return {
        kind: "ok",
        value: {
          nodeId: node.id,
          canApply: blockers.length === 0,
          impact,
          blockers,
          warnings,
        },
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async findNodeInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: OutlineWorkContext,
    nodeId: string,
  ): Promise<OutlineNodeWithChapter | undefined> {
    const [row] = await transaction
      .select({ node: outlineNodes, chapter: chapters })
      .from(outlineNodes)
      .leftJoin(chapters, eq(chapters.id, outlineNodes.chapterId))
      .where(
        and(
          eq(outlineNodes.id, nodeId),
          eq(outlineNodes.userId, userId),
          eq(outlineNodes.workId, context.workId),
          eq(outlineNodes.branchId, context.branchId),
        ),
      )
      .limit(1);
    if (!row) {
      return undefined;
    }
    return { node: row.node, chapter: row.chapter ?? null };
  }

  private async upsertSceneCardInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: OutlineWorkContext,
    node: OutlineNodeRecord,
    input: OutlineSceneCardWriteRequest,
    existing: SceneCardRecord | null,
    headNodeId: string,
    versionNodeId: string,
    now: Date,
  ): Promise<SceneCardRecord> {
    const beats: SceneBeat[] = input.beats.map((beat, index) => ({
      id: uuidv7(),
      order: index + 1,
      description: beat.description,
    }));
    const informationReleases: SceneInformationRelease[] = input.informationReleases.map(
      (release, index) => ({
        id: uuidv7(),
        order: index + 1,
        description: release.description,
        constraint: release.constraint,
      }),
    );
    const values = {
      nodeId: node.id,
      workId: context.workId,
      branchId: context.branchId,
      userId,
      title: input.title,
      ...povColumns(input.pov),
      ...locationColumns(input.location),
      storyEra: input.storyTime?.era ?? null,
      storyTimeLabel: input.storyTime?.label ?? null,
      storySortKey: input.storyTime?.sortKey ?? null,
      beats,
      informationReleases,
      tension: input.tension,
      versionNodeId,
      updatedAt: now,
    };
    const cardId = existing?.id ?? uuidv7();
    const cardVersion = existing ? existing.version + 1 : 1;
    await insertOutlineVersion(
      transaction,
      userId,
      context,
      headNodeId,
      versionNodeId,
      "scene_card",
      cardId,
      cardVersion,
      "outline.scene_card_saved",
      "保存场景卡",
      { nodeId: node.id, version: cardVersion },
      now,
    );
    let card: SceneCardRecord | undefined;
    if (existing) {
      [card] = await transaction
        .update(sceneCards)
        .set({ ...values, version: cardVersion })
        .where(and(eq(sceneCards.id, existing.id), eq(sceneCards.version, existing.version)))
        .returning();
    } else {
      [card] = await transaction
        .insert(sceneCards)
        .values({
          id: cardId,
          ...values,
          version: cardVersion,
          createdAt: now,
        })
        .returning();
    }
    if (!card) {
      throw new Error("Failed to save scene card");
    }
    return card;
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

function toStructureNode(node: OutlineNodeRecord): OutlineStructureNode {
  return {
    id: node.id,
    workId: node.workId,
    branchId: node.branchId,
    level: node.level as OutlineStructureNode["level"],
    parentId: node.parentId,
    sortOrder: node.sortOrder,
    locked: node.locked,
    chapterId: node.chapterId,
  };
}

function validateProposedParent(
  nodes: OutlineNodeRecord[],
  level: OutlineStructureNode["level"],
  parentId: string | null,
):
  | { kind: "parent_invalid"; message: string }
  | { kind: "structure_invalid"; message: string }
  | null {
  const expected = outlineParentLevel(level);
  if (expected === null) {
    if (parentId !== null) {
      return { kind: "parent_invalid", message: "全书节点不能有上级节点" };
    }
    return null;
  }
  if (parentId === null) {
    return {
      kind: "parent_invalid",
      message: `${levelTitle(level)}节点必须挂在${levelTitle(expected)}下`,
    };
  }
  const parent = nodes.find((entry) => entry.id === parentId);
  if (!parent) {
    return { kind: "parent_invalid", message: "上级节点不存在" };
  }
  if (parent.level !== expected) {
    return {
      kind: "parent_invalid",
      message: `${levelTitle(level)}节点只能挂在${levelTitle(expected)}下`,
    };
  }
  return null;
}

function mapStructureIssues(
  issues: ReturnType<typeof validateOutlineStructure>,
):
  | { kind: "parent_invalid"; message: string }
  | { kind: "chapter_invalid"; message: string }
  | { kind: "structure_invalid"; message: string }
  | null {
  const first = issues[0];
  if (!first) {
    return null;
  }
  if (first.code === "OUTLINE_PARENT_LEVEL_INVALID" || first.code === "OUTLINE_PARENT_MISSING") {
    return { kind: "parent_invalid", message: first.message };
  }
  if (first.code === "OUTLINE_CHAPTER_LINK_INVALID" || first.code === "OUTLINE_CHAPTER_DUPLICATE") {
    return { kind: "chapter_invalid", message: first.message };
  }
  return { kind: "structure_invalid", message: first.message };
}

function planInsert(
  nodes: OutlineNodeRecord[],
  parentId: string | null,
  requested: number | undefined,
  newNodeId: string,
): { insertAt: number; orders: Map<string, number>; changed: OutlineNodeRecord[] } {
  const siblings = nodes
    .filter((entry) => entry.parentId === parentId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const insertAt = clamp(requested ?? siblings.length, 0, siblings.length);
  const orders = new Map<string, number>();
  siblings.forEach((entry, index) => {
    orders.set(entry.id, index < insertAt ? index : index + 1);
  });
  orders.set(newNodeId, insertAt);
  return {
    insertAt,
    orders,
    changed: siblings.filter((entry) => orders.get(entry.id) !== entry.sortOrder),
  };
}

function planMove(
  nodes: OutlineNodeRecord[],
  moved: OutlineNodeRecord,
  newParentId: string | null,
  requested: number | undefined,
): { insertAt: number; orders: Map<string, number>; changed: OutlineNodeRecord[] } {
  const oldSiblings = nodes
    .filter((entry) => entry.id !== moved.id && entry.parentId === moved.parentId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const newSiblings =
    newParentId === moved.parentId
      ? oldSiblings
      : nodes
          .filter((entry) => entry.id !== moved.id && entry.parentId === newParentId)
          .sort(
            (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
          );
  const insertAt = clamp(requested ?? newSiblings.length, 0, newSiblings.length);
  const orders = new Map<string, number>();
  if (newParentId === moved.parentId) {
    oldSiblings.forEach((entry, index) => {
      orders.set(entry.id, index < insertAt ? index : index + 1);
    });
  } else {
    oldSiblings.forEach((entry, index) => orders.set(entry.id, index));
    newSiblings.forEach((entry, index) => {
      orders.set(entry.id, index < insertAt ? index : index + 1);
    });
  }
  orders.set(moved.id, insertAt);
  const changed = nodes.filter(
    (entry) =>
      entry.id !== moved.id &&
      orders.get(entry.id) !== undefined &&
      orders.get(entry.id) !== entry.sortOrder,
  );
  return { insertAt, orders, changed };
}

async function offsetSortOrders(
  transaction: DatabaseTransaction,
  changed: OutlineNodeRecord[],
  movedId?: string,
): Promise<void> {
  const ids = Array.from(
    new Set([...changed.map((entry) => entry.id), ...(movedId ? [movedId] : [])]),
  );
  if (ids.length === 0) {
    return;
  }
  await transaction
    .update(outlineNodes)
    .set({ sortOrder: sql`${outlineNodes.sortOrder} + 100000` })
    .where(inArray(outlineNodes.id, ids));
}

async function applySiblingOrders(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
  changed: OutlineNodeRecord[],
  orders: Map<string, number>,
  headNodeId: string,
  alreadyOffset = false,
): Promise<string> {
  let head = headNodeId;
  const now = new Date();
  if (!alreadyOffset) {
    await offsetSortOrders(transaction, changed);
  }
  for (const sibling of changed) {
    const sortOrder = orders.get(sibling.id);
    if (sortOrder === undefined) {
      continue;
    }
    const version = sibling.version + 1;
    const versionNodeId = uuidv7();
    await insertOutlineVersion(
      transaction,
      userId,
      context,
      head,
      versionNodeId,
      "outline_node",
      sibling.id,
      version,
      "outline.node_reordered",
      "调整同级顺序",
      { sortOrder },
      now,
    );
    const [updated] = await transaction
      .update(outlineNodes)
      .set({ sortOrder, version, versionNodeId, updatedAt: now })
      .where(and(eq(outlineNodes.id, sibling.id), eq(outlineNodes.version, sibling.version)))
      .returning();
    if (!updated) {
      throw new Error("Outline sibling changed while reordering");
    }
    head = versionNodeId;
  }
  if (changed.length > 0) {
    await advanceBranchHead(transaction, context, head, now);
  }
  return head;
}

async function loadNodesForUpdate(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
): Promise<OutlineNodeRecord[]> {
  return transaction
    .select()
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.userId, userId),
        eq(outlineNodes.workId, context.workId),
        eq(outlineNodes.branchId, context.branchId),
      ),
    )
    .for("update");
}

async function loadNodesForRead(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
): Promise<OutlineNodeRecord[]> {
  return transaction
    .select()
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.userId, userId),
        eq(outlineNodes.workId, context.workId),
        eq(outlineNodes.branchId, context.branchId),
      ),
    );
}

function isLockedByAncestor(
  nodes: OutlineNodeRecord[],
  nodeId: string,
  includeSelf = true,
): boolean {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current) {
    if (includeSelf && current.locked) {
      return true;
    }
    if (!current.parentId || seen.has(current.id)) {
      return false;
    }
    seen.add(current.id);
    current = byId.get(current.parentId);
    if (current && current.locked) {
      return true;
    }
  }
  return false;
}

function isDescendant(
  nodes: OutlineNodeRecord[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  let current = byId.get(candidateId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    if (seen.has(current.parentId)) {
      return false;
    }
    seen.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return false;
}

async function validateSceneReferences(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
  input: OutlineSceneCardWriteRequest,
): Promise<{ kind: "reference_invalid"; message: string } | null> {
  if (input.pov && input.pov.type !== "character") {
    return { kind: "reference_invalid", message: "场景 POV 必须引用人物" };
  }
  if (input.location && !["map", "map_node", "territory"].includes(input.location.type)) {
    return { kind: "reference_invalid", message: "场景地点必须引用地点类对象" };
  }
  for (const [label, ref] of [
    ["POV", input.pov],
    ["地点", input.location],
  ] as const) {
    if (!ref) {
      continue;
    }
    if (ref.branchId !== context.branchId) {
      return { kind: "reference_invalid", message: `${label}必须属于当前创作线` };
    }
    if (!(await verifyDomainRef(transaction, userId, context, ref))) {
      return { kind: "reference_invalid", message: `${label}引用不存在或无权访问` };
    }
  }
  return null;
}

async function verifyDomainRef(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
  ref: DomainRef,
): Promise<boolean> {
  if (ref.type === "map_node") {
    const [row] = await transaction
      .select({ id: mapNodes.id })
      .from(mapNodes)
      .where(
        and(
          eq(mapNodes.id, ref.id),
          eq(mapNodes.userId, userId),
          eq(mapNodes.workId, context.workId),
          eq(mapNodes.branchId, context.branchId),
        ),
      )
      .limit(1);
    if (!row) {
      return false;
    }
  } else {
    const [row] = await transaction
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.id, ref.id),
          eq(entities.userId, userId),
          eq(entities.workId, context.workId),
          eq(entities.branchId, context.branchId),
          eq(entities.type, ref.type),
          sql`${entities.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!row) {
      return false;
    }
  }
  if (ref.version?.versionNodeId) {
    const [version] = await transaction
      .select({ id: versionNodes.id })
      .from(versionNodes)
      .where(
        and(
          eq(versionNodes.id, ref.version.versionNodeId),
          eq(versionNodes.userId, userId),
          eq(versionNodes.workId, context.workId),
          eq(versionNodes.branchId, context.branchId),
        ),
      )
      .limit(1);
    if (!version) {
      return false;
    }
  }
  return true;
}

function povColumns(ref: DomainRef | null) {
  return {
    povType: ref?.type ?? null,
    povId: ref?.id ?? null,
    povBranchId: ref?.branchId ?? null,
    povLabel: ref?.label ?? null,
    povVersionNodeId: ref?.version?.versionNodeId ?? null,
    povObjectVersion: ref?.version?.objectVersion ?? null,
  };
}

function locationColumns(ref: DomainRef | null) {
  return {
    locationType: ref?.type ?? null,
    locationId: ref?.id ?? null,
    locationBranchId: ref?.branchId ?? null,
    locationLabel: ref?.label ?? null,
    locationVersionNodeId: ref?.version?.versionNodeId ?? null,
    locationObjectVersion: ref?.version?.objectVersion ?? null,
  };
}

async function insertOutlineVersion(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
  parentNodeId: string,
  versionNodeId: string,
  objectType: "outline_node" | "volume_contract" | "scene_card",
  objectId: string,
  objectVersion: number,
  action: string,
  message: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await transaction.insert(versionNodes).values({
    id: versionNodeId,
    workId: context.workId,
    branchId: context.branchId,
    userId,
    parentNodeId,
    nodeType: "outline_version",
    objectType,
    objectId,
    objectVersion,
    payload: { action, ...payload },
    actorId: userId,
    message,
    createdAt: now,
  });
}

async function advanceBranchHead(
  transaction: DatabaseTransaction,
  context: OutlineWorkContext,
  versionNodeId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: OutlineWorkContext,
): Promise<string> {
  const [branch] = await transaction
    .select({ headNodeId: workBranches.headNodeId })
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("Outline branch is missing its version head");
  }
  return branch.headNodeId;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: OutlineAuditContext,
  action: string,
  targetType: string,
  targetId: string,
): Promise<string> {
  const id = uuidv7();
  await transaction.insert(auditLogs).values({
    id,
    actorId: userId,
    action,
    targetType,
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
  return id;
}

function levelTitle(level: string): string {
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
    default:
      return "大纲";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
