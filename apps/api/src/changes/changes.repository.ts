import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  BranchCreateRequest,
  ChangeApplyRequest,
  ChangeImpact,
  ChangeRequest,
  ChangeRequestCreateRequest,
  ChangeRequestListQuery,
  ChangeTargetType,
  MergeApplyRequest,
  MergeItem,
  MergeItemDecisionRequest,
  VersionRollbackRequest,
} from "@novel-brain/contracts";
import {
  auditLogs,
  chapterVersions,
  changeImpacts,
  changeRequests,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  entityVersions,
  entities,
  facts,
  foreshadows,
  mapNodes,
  mergeDecisions,
  mergeItems,
  notifications,
  outlineNodes,
  timelineEvents,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { toCursorPage, type CursorPageResult } from "../common/cursor-page";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type ChangeRecord = typeof changeRequests.$inferSelect;
type MergeItemRecord = typeof mergeItems.$inferSelect;

class MergeApplyAbort extends Error {
  constructor(readonly result: "version_conflict") {
    super(result);
  }
}

export interface ChangesAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

@Injectable()
export class ChangesRepository implements OnModuleDestroy {
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

  async list(
    userId: string,
    workId: string,
    branchId: string,
    query: ChangeRequestListQuery,
  ): Promise<CursorPageResult<ChangeRequest> | "not_found" | "invalid_cursor"> {
    return this.withTenant(userId, async (transaction) => {
      const context = await this.context(transaction, userId, workId, branchId);
      if (!context) {
        return "not_found";
      }
      const cursor = query.cursor
        ? (
            await transaction
              .select({ id: changeRequests.id, createdAt: changeRequests.createdAt })
              .from(changeRequests)
              .where(
                and(
                  eq(changeRequests.userId, userId),
                  eq(changeRequests.workId, workId),
                  eq(changeRequests.branchId, branchId),
                  eq(changeRequests.id, query.cursor),
                ),
              )
              .limit(1)
          )[0]
        : undefined;
      if (query.cursor && !cursor) {
        return "invalid_cursor";
      }
      const rows = await transaction
        .select()
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.userId, userId),
            eq(changeRequests.workId, workId),
            eq(changeRequests.branchId, branchId),
            query.status ? eq(changeRequests.status, query.status) : undefined,
            query.risk ? eq(changeRequests.risk, query.risk) : undefined,
            query.targetType ? eq(changeRequests.targetType, query.targetType) : undefined,
            cursor
              ? or(
                  lt(changeRequests.createdAt, cursor.createdAt),
                  and(
                    eq(changeRequests.createdAt, cursor.createdAt),
                    lt(changeRequests.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(changeRequests.createdAt), desc(changeRequests.id))
        .limit(query.limit + 1);
      const page = toCursorPage(rows, query.limit);
      return {
        data: page.data.map(toChangeRequest),
        nextCursor: page.nextCursor,
      };
    });
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: ChangeRequestCreateRequest,
    idempotencyKey: string,
    audit: ChangesAuditContext,
  ): Promise<
    | ChangeRequest
    | "not_found"
    | "idempotency_conflict"
    | "target_not_found"
    | "version_conflict"
    | "invalid_object_type"
  > {
    return this.withTenant(userId, async (transaction) => {
      const context = await this.context(transaction, userId, workId, branchId, true);
      if (!context) {
        return "not_found";
      }
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${idempotencyKey}`}))`,
      );
      const [existing] = await transaction
        .select()
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.userId, userId),
            eq(changeRequests.branchId, branchId),
            eq(changeRequests.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return sameChangeRequest(existing, input)
          ? toChangeRequest(existing)
          : "idempotency_conflict";
      }
      const target = await loadTargetVersion(
        transaction,
        userId,
        workId,
        branchId,
        input.targetType,
        input.targetId,
      );
      if (!target) {
        return "target_not_found";
      }
      if (!objectTypeMatchesTarget(input.objectType, input.targetType)) {
        return "invalid_object_type";
      }
      if (target.version !== input.targetVersion) {
        return "version_conflict";
      }
      const now = new Date();
      const [created] = await transaction
        .insert(changeRequests)
        .values({
          id: uuidv7(),
          workId,
          branchId,
          userId,
          title: input.title,
          reason: input.reason,
          targetVersion: input.targetVersion,
          targetType: input.targetType,
          targetId: input.targetId,
          objectType: input.objectType,
          before: input.before,
          after: input.after,
          diff: objectDiff(input.before, input.after),
          source: input.source,
          risk: target.locked ? "high" : input.risk,
          status: "draft",
          idempotencyKey,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create change request");
      }
      await this.audit(transaction, userId, workId, branchId, "change.created", created.id, audit, {
        risk: created.risk,
        targetType: created.targetType,
      });
      return toChangeRequest(created);
    });
  }

  async analyze(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
  ): Promise<{ change: ChangeRequest; impacts: ChangeImpact[] } | "not_found"> {
    return this.withTenant(userId, async (transaction) => {
      const [change] = await transaction
        .select()
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.id, changeId),
            eq(changeRequests.userId, userId),
            eq(changeRequests.workId, workId),
            eq(changeRequests.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!change) {
        return "not_found";
      }
      const counts = await this.impactCounts(transaction, userId, workId, branchId);
      await transaction.delete(changeImpacts).where(eq(changeImpacts.changeId, changeId));
      const category =
        change.risk === "high" ? "structural" : change.risk === "medium" ? "repairable" : "safe";
      const impactRows = [
        {
          category,
          affectedType: "chapters",
          summary: `可能影响 ${counts.chapters} 个章节`,
          confidence: change.risk === "high" ? 0.95 : 0.75,
        },
        {
          category,
          affectedType: "settings",
          summary: `可能影响 ${counts.entities} 个设定实体`,
          confidence: change.risk === "high" ? 0.9 : 0.7,
        },
        {
          category,
          affectedType: "facts",
          summary: `可能影响 ${counts.facts} 条已确认事实`,
          confidence: change.risk === "high" ? 0.9 : 0.65,
        },
        {
          category,
          affectedType: "planning",
          summary: `可能影响 ${counts.outline} 个大纲节点和 ${counts.ledger} 条剧情账本记录`,
          confidence: 0.6,
        },
        {
          category,
          affectedType: "maps",
          summary: `可能影响 ${counts.maps} 个地图节点`,
          confidence: 0.7,
        },
        {
          category,
          affectedType: "timeline",
          summary: `可能影响 ${counts.timeline} 条时间线事件`,
          confidence: 0.7,
        },
        {
          category,
          affectedType: "resources",
          summary: `可能影响 ${counts.resources} 个能力、金手指或物品资源`,
          confidence: 0.7,
        },
      ];
      const inserted = await transaction
        .insert(changeImpacts)
        .values(
          impactRows.map((impact) => ({
            id: uuidv7(),
            changeId,
            workId,
            branchId,
            userId,
            category: impact.category,
            affectedType: impact.affectedType,
            affectedId: null,
            chapterId: null,
            summary: impact.summary,
            evidence: { risk: change.risk, targetType: change.targetType },
            confidence: impact.confidence,
            createdAt: new Date(),
          })),
        )
        .returning();
      const [updated] = await transaction
        .update(changeRequests)
        .set({
          status: "awaiting_confirmation",
          version: change.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(changeRequests.id, changeId))
        .returning();
      if (!updated) {
        throw new Error("Failed to update analyzed change");
      }
      return {
        change: toChangeRequest(updated),
        impacts: inserted.map(toChangeImpact),
      };
    });
  }

  async apply(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: ChangeApplyRequest,
    audit: ChangesAuditContext,
  ): Promise<
    | { change: ChangeRequest; versionNodeId: string }
    | "not_found"
    | "version_conflict"
    | "invalid_state"
    | "target_not_found"
    | "analysis_required"
    | "fact_gate_required"
    | "high_risk_confirmation_required"
  > {
    return this.withTenant(userId, async (transaction) => {
      const [change] = await transaction
        .select()
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.id, changeId),
            eq(changeRequests.userId, userId),
            eq(changeRequests.workId, workId),
            eq(changeRequests.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!change) {
        return "not_found";
      }
      if (change.status === "applied") {
        const [existingNode] = await transaction
          .select({ id: versionNodes.id })
          .from(versionNodes)
          .where(
            and(
              eq(versionNodes.userId, userId),
              eq(versionNodes.workId, workId),
              eq(versionNodes.branchId, branchId),
              sql`${versionNodes.payload}->>'changeId' = ${change.id}`,
            ),
          )
          .limit(1);
        return existingNode
          ? { change: toChangeRequest(change), versionNodeId: existingNode.id }
          : "invalid_state";
      }
      if (change.status !== "awaiting_confirmation") {
        return "invalid_state";
      }
      if (change.targetType === "fact") {
        return "fact_gate_required";
      }
      if (change.version !== input.version) {
        return "version_conflict";
      }
      if (change.risk === "high" && !input.confirmHighRisk) {
        return "high_risk_confirmation_required";
      }
      const [branch] = await transaction
        .select()
        .from(workBranches)
        .where(and(eq(workBranches.id, branchId), eq(workBranches.userId, userId)))
        .for("update")
        .limit(1);
      if (!branch?.headNodeId) {
        return "not_found";
      }
      const [impact] = await transaction
        .select({ id: changeImpacts.id })
        .from(changeImpacts)
        .where(
          and(
            eq(changeImpacts.changeId, change.id),
            eq(changeImpacts.userId, userId),
            eq(changeImpacts.workId, workId),
            eq(changeImpacts.branchId, branchId),
          ),
        )
        .limit(1);
      if (!impact) {
        return "analysis_required";
      }
      const target = await loadTargetVersion(
        transaction,
        userId,
        workId,
        branchId,
        change.targetType as ChangeTargetType,
        change.targetId,
      );
      if (!target) {
        return "target_not_found";
      }
      if (target.version !== input.expectedTargetVersion) {
        return "version_conflict";
      }
      if (target.version !== change.targetVersion) {
        return "version_conflict";
      }
      if (target.locked && !input.confirmHighRisk) {
        return "high_risk_confirmation_required";
      }
      const versionNodeId = uuidv7();
      const now = new Date();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId,
        branchId,
        userId,
        parentNodeId: branch.headNodeId,
        nodeType: "change_apply",
        objectType: change.objectType,
        objectId: change.targetId,
        objectVersion: change.version + 1,
        snapshotId: null,
        payload: {
          changeId: change.id,
          targetType: change.targetType,
          objectKey: target.objectKey,
          before: change.before,
          after: change.after,
          diff: change.diff,
          reason: input.reason ?? change.reason,
        },
        actorId: userId,
        message: `应用修改：${change.title}`,
        createdAt: now,
      });
      const appliedTarget = await applyObjectSnapshot(
        transaction,
        userId,
        workId,
        branchId,
        change.targetType as ChangeTargetType,
        change.targetId,
        input.expectedTargetVersion,
        change.after,
        versionNodeId,
        now,
      );
      if (!appliedTarget) {
        throw new Error("Target object disappeared while applying the change");
      }
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, branchId));
      const [updated] = await transaction
        .update(changeRequests)
        .set({
          status: "applied",
          version: change.version + 1,
          updatedAt: now,
        })
        .where(eq(changeRequests.id, changeId))
        .returning();
      if (!updated) {
        throw new Error("Failed to mark change applied");
      }
      await this.audit(transaction, userId, workId, branchId, "change.applied", changeId, audit, {
        versionNodeId,
      });
      return { change: toChangeRequest(updated), versionNodeId };
    });
  }

  async rollback(
    userId: string,
    workId: string,
    branchId: string,
    input: VersionRollbackRequest,
    audit: ChangesAuditContext,
  ): Promise<
    | { versionNodeId: string; nodeType: "rollback" }
    | "not_found"
    | "version_conflict"
    | "target_not_found"
    | "canon_gate_required"
  > {
    return this.withTenant(userId, async (transaction) => {
      const context = await this.context(transaction, userId, workId, branchId, true);
      if (!context?.branch.headNodeId) {
        return "not_found";
      }
      if (context.branch.headNodeId !== input.expectedHeadNodeId) {
        return "version_conflict";
      }
      const [targetNode] = await transaction
        .select()
        .from(versionNodes)
        .where(
          and(
            eq(versionNodes.id, input.targetNodeId),
            eq(versionNodes.userId, userId),
            eq(versionNodes.workId, workId),
            eq(versionNodes.branchId, branchId),
          ),
        )
        .limit(1);
      if (!targetNode) {
        return "target_not_found";
      }
      if (targetNode.nodeType === "branch_merge") {
        const itemIds = Array.isArray(targetNode.payload.itemIds)
          ? targetNode.payload.itemIds.filter((value): value is string => typeof value === "string")
          : [];
        const mergeItemsToRestore = await transaction
          .select()
          .from(mergeItems)
          .where(
            and(
              eq(mergeItems.userId, userId),
              eq(mergeItems.workId, workId),
              eq(mergeItems.targetBranchId, branchId),
              inArray(mergeItems.id, itemIds),
            ),
          )
          .for("update");
        if (mergeItemsToRestore.length !== itemIds.length) {
          return "target_not_found";
        }
        const restoreTargets: Array<{
          targetType: ChangeTargetType;
          targetId: string;
          expectedVersion: number;
          payload: Record<string, unknown>;
        }> = [];
        for (const item of mergeItemsToRestore) {
          if (!item.targetNodeId) {
            return "target_not_found";
          }
          const [itemNode] = await transaction
            .select()
            .from(versionNodes)
            .where(
              and(
                eq(versionNodes.id, item.targetNodeId),
                eq(versionNodes.userId, userId),
                eq(versionNodes.workId, workId),
                eq(versionNodes.branchId, branchId),
              ),
            )
            .limit(1);
          if (!itemNode) {
            return "target_not_found";
          }
          const targetType = targetTypeForVersionNode(itemNode);
          if (!targetType || targetType === "fact") {
            return "canon_gate_required";
          }
          const current = await loadTargetVersion(
            transaction,
            userId,
            workId,
            branchId,
            targetType,
            itemNode.objectId,
          );
          if (!current) {
            return "target_not_found";
          }
          restoreTargets.push({
            targetType,
            targetId: itemNode.objectId,
            expectedVersion: current.version,
            payload: extractObjectPayload(itemNode.payload),
          });
        }
        const versionNodeId = uuidv7();
        const now = new Date();
        await transaction.insert(versionNodes).values({
          id: versionNodeId,
          workId,
          branchId,
          userId,
          parentNodeId: context.branch.headNodeId,
          nodeType: "rollback",
          objectType: "branch",
          objectId: branchId,
          objectVersion: 1,
          snapshotId: null,
          payload: {
            targetNodeId: targetNode.id,
            priorHeadNodeId: context.branch.headNodeId,
            restoredItems: mergeItemsToRestore.map((item) => item.id),
            reason: input.reason,
          },
          actorId: userId,
          message: `撤销摘取版本 ${targetNode.id}`,
          createdAt: now,
        });
        for (const target of restoreTargets) {
          const restored = await applyObjectSnapshot(
            transaction,
            userId,
            workId,
            branchId,
            target.targetType,
            target.targetId,
            target.expectedVersion,
            target.payload,
            versionNodeId,
            now,
          );
          if (!restored) {
            throw new Error("Merge rollback target disappeared during restore");
          }
        }
        await transaction
          .update(workBranches)
          .set({ headNodeId: versionNodeId, updatedAt: now })
          .where(eq(workBranches.id, branchId));
        await this.audit(
          transaction,
          userId,
          workId,
          branchId,
          "version.rollback",
          versionNodeId,
          audit,
          { targetNodeId: targetNode.id, reason: input.reason },
        );
        return { versionNodeId, nodeType: "rollback" };
      }
      const targetType = targetTypeForVersionNode(targetNode);
      if (!targetType) {
        return "target_not_found";
      }
      if (targetType === "fact") {
        return "canon_gate_required";
      }
      const current = await loadTargetVersion(
        transaction,
        userId,
        workId,
        branchId,
        targetType,
        targetNode.objectId,
      );
      if (!current) {
        return "target_not_found";
      }
      const restorePayload = rollbackPayload(targetNode);
      const versionNodeId = uuidv7();
      const now = new Date();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId,
        branchId,
        userId,
        parentNodeId: context.branch.headNodeId,
        nodeType: "rollback",
        objectType: targetNode.objectType,
        objectId: targetNode.objectId,
        objectVersion: current.version + 1,
        snapshotId: null,
        payload: {
          targetNodeId: targetNode.id,
          priorHeadNodeId: context.branch.headNodeId,
          restored: restorePayload,
          reason: input.reason,
        },
        actorId: userId,
        message: `回滚到版本 ${targetNode.id}`,
        createdAt: now,
      });
      const restored = await applyObjectSnapshot(
        transaction,
        userId,
        workId,
        branchId,
        targetType,
        targetNode.objectId,
        current.version,
        restorePayload,
        versionNodeId,
        now,
      );
      if (!restored) {
        throw new Error("Rollback target disappeared during restore");
      }
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, branchId));
      await this.audit(
        transaction,
        userId,
        workId,
        branchId,
        "version.rollback",
        versionNodeId,
        audit,
        { targetNodeId: targetNode.id, reason: input.reason },
      );
      return { versionNodeId, nodeType: "rollback" };
    });
  }

  async createBranch(
    userId: string,
    workId: string,
    input: BranchCreateRequest,
    audit: ChangesAuditContext,
  ): Promise<typeof workBranches.$inferSelect | "not_found" | "name_conflict"> {
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select({ id: works.id })
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), sql`${works.deletedAt} is null`))
        .limit(1);
      if (!work) {
        return "not_found";
      }
      const [sourceNode] = await transaction
        .select({ id: versionNodes.id })
        .from(versionNodes)
        .where(
          and(
            eq(versionNodes.id, input.sourceNodeId),
            eq(versionNodes.workId, workId),
            eq(versionNodes.userId, userId),
          ),
        )
        .limit(1);
      if (!sourceNode) {
        return "not_found";
      }
      const [existing] = await transaction
        .select({ id: workBranches.id })
        .from(workBranches)
        .where(and(eq(workBranches.workId, workId), eq(workBranches.name, input.name)))
        .limit(1);
      if (existing) {
        return "name_conflict";
      }
      const now = new Date();
      const [branch] = await transaction
        .insert(workBranches)
        .values({
          id: uuidv7(),
          workId,
          userId,
          name: input.name,
          headNodeId: input.sourceNodeId,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!branch) {
        throw new Error("Failed to create branch");
      }
      await this.audit(transaction, userId, workId, branch.id, "branch.created", branch.id, audit, {
        sourceNodeId: input.sourceNodeId,
        reason: input.reason,
      });
      return branch;
    });
  }

  async compare(
    userId: string,
    workId: string,
    targetBranchId: string,
    sourceBranchId: string,
  ): Promise<MergeItem[] | "not_found"> {
    return this.withTenant(userId, async (transaction) => {
      const context = await this.context(transaction, userId, workId, targetBranchId);
      const source = await this.context(transaction, userId, workId, sourceBranchId);
      if (!context || !source) {
        return "not_found";
      }
      const allNodes = await transaction
        .select()
        .from(versionNodes)
        .where(and(eq(versionNodes.userId, userId), eq(versionNodes.workId, workId)))
        .orderBy(desc(versionNodes.createdAt));
      const targetCurrent = nodesAlongHead(allNodes, context.branch.headNodeId);
      const sourceCurrent = nodesAlongHead(allNodes, source.branch.headNodeId);
      const targetByKey = new Map<string, (typeof allNodes)[number]>();
      const sourceByKey = new Map<string, (typeof allNodes)[number]>();
      for (const node of sourceCurrent) {
        const key = mergeObjectKey(node.objectType, node.objectId, node.payload);
        if (!sourceByKey.has(key)) {
          sourceByKey.set(key, node);
        }
      }
      for (const node of targetCurrent) {
        const key = mergeObjectKey(node.objectType, node.objectId, node.payload);
        if (!targetByKey.has(key)) {
          targetByKey.set(key, node);
        }
      }
      await transaction
        .update(mergeItems)
        .set({ status: "stale", updatedAt: new Date() })
        .where(
          and(
            eq(mergeItems.userId, userId),
            eq(mergeItems.workId, workId),
            eq(mergeItems.sourceBranchId, sourceBranchId),
            eq(mergeItems.targetBranchId, targetBranchId),
            inArray(mergeItems.status, ["pending", "accepted"]),
          ),
        );
      const items: MergeItem[] = [];
      const keys = new Set([...sourceByKey.keys(), ...targetByKey.keys()]);
      for (const key of keys) {
        const sourceNode = sourceByKey.get(key);
        const targetNode = targetByKey.get(key);
        const representative = sourceNode ?? targetNode;
        if (!representative) {
          continue;
        }
        const changeKind = mergeChangeKind(sourceNode, targetNode);
        const conflict =
          Boolean(targetNode) && (changeKind === "changed" || changeKind === "removed");
        const risk =
          conflict || changeKind === "removed"
            ? "high"
            : representative.nodeType === "canon_commit"
              ? "medium"
              : "low";
        const objectType = mergeObjectType(representative.objectType, representative.nodeType);
        if (!objectType) {
          continue;
        }
        const objectKey = key;
        const [item] = await transaction
          .insert(mergeItems)
          .values({
            id: uuidv7(),
            workId,
            sourceBranchId,
            targetBranchId,
            userId,
            sourceNodeId: sourceNode?.id ?? null,
            targetNodeId: targetNode?.id ?? null,
            objectType,
            objectId: representative.objectId,
            objectKey,
            sourcePayload: sourceNode?.payload ?? {},
            targetPayload: targetNode?.payload ?? {},
            diff: objectDiff(targetNode?.payload ?? {}, sourceNode?.payload ?? {}),
            changeKind,
            risk,
            conflict,
            status: "pending",
            reason: null,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              mergeItems.sourceBranchId,
              mergeItems.targetBranchId,
              mergeItems.objectType,
              mergeItems.objectKey,
            ],
            set: {
              sourceNodeId: sourceNode?.id ?? null,
              targetNodeId: targetNode?.id ?? null,
              sourcePayload: sourceNode?.payload ?? {},
              targetPayload: targetNode?.payload ?? {},
              diff: objectDiff(targetNode?.payload ?? {}, sourceNode?.payload ?? {}),
              changeKind,
              risk,
              conflict,
              status: "pending",
              version: sql`${mergeItems.version} + 1`,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (item) {
          items.push(toMergeItem(item));
        }
      }
      return items;
    });
  }

  async decide(
    userId: string,
    workId: string,
    itemId: string,
    input: MergeItemDecisionRequest,
    audit: ChangesAuditContext,
  ): Promise<MergeItem | "not_found" | "version_conflict"> {
    return this.withTenant(userId, async (transaction) => {
      const [item] = await transaction
        .select()
        .from(mergeItems)
        .where(
          and(
            eq(mergeItems.id, itemId),
            eq(mergeItems.userId, userId),
            eq(mergeItems.workId, workId),
          ),
        )
        .for("update")
        .limit(1);
      if (!item) {
        return "not_found";
      }
      if (item.version !== input.version) {
        return "version_conflict";
      }
      await transaction.insert(mergeDecisions).values({
        id: uuidv7(),
        mergeItemId: item.id,
        userId,
        action: input.action,
        reason: input.reason,
        expectedVersion: input.version,
        createdAt: new Date(),
      });
      const [updated] = await transaction
        .update(mergeItems)
        .set({
          status: input.action === "accept" ? "accepted" : "rejected",
          reason: input.reason,
          version: item.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(mergeItems.id, item.id))
        .returning();
      if (!updated) {
        throw new Error("Failed to update merge item");
      }
      await this.audit(
        transaction,
        userId,
        workId,
        item.targetBranchId,
        `merge.item.${input.action}`,
        item.id,
        audit,
        { reason: input.reason },
      );
      return toMergeItem(updated);
    });
  }

  async applyMerge(
    userId: string,
    workId: string,
    targetBranchId: string,
    input: MergeApplyRequest,
    audit: ChangesAuditContext,
  ): Promise<
    | { applied: string[]; versionNodeId: string }
    | "not_found"
    | "high_risk_confirmation_required"
    | "invalid_selection"
    | "version_conflict"
    | "target_not_found"
    | "canon_gate_required"
  > {
    try {
      return await this.withTenant(userId, async (transaction) => {
        const context = await this.context(transaction, userId, workId, targetBranchId, true);
        if (!context) {
          return "not_found";
        }
        const items = await transaction
          .select()
          .from(mergeItems)
          .where(
            and(
              eq(mergeItems.userId, userId),
              eq(mergeItems.workId, workId),
              eq(mergeItems.targetBranchId, targetBranchId),
              inArray(mergeItems.id, input.itemIds),
            ),
          )
          .for("update");
        if (
          items.length !== input.itemIds.length ||
          items.some((item) => item.status !== "accepted")
        ) {
          return "invalid_selection";
        }
        if (items.some((item) => item.risk === "high") && !input.confirmHighRisk) {
          return "high_risk_confirmation_required";
        }
        if (items.some((item) => item.objectType === "fact")) {
          return "canon_gate_required";
        }
        const branch = context.branch;
        if (!branch.headNodeId) {
          return "not_found";
        }
        if (branch.headNodeId !== input.expectedTargetHeadNodeId) {
          return "version_conflict";
        }
        const targets: Array<{
          item: MergeItemRecord;
          targetType: ChangeTargetType;
          targetId: string;
          expectedVersion: number;
        }> = [];
        for (const item of items) {
          if (!item.targetNodeId) {
            return "target_not_found";
          }
          const [targetNode] = await transaction
            .select()
            .from(versionNodes)
            .where(
              and(
                eq(versionNodes.id, item.targetNodeId),
                eq(versionNodes.userId, userId),
                eq(versionNodes.workId, workId),
                eq(versionNodes.branchId, targetBranchId),
              ),
            )
            .limit(1);
          if (!targetNode) {
            return "target_not_found";
          }
          const targetType = targetTypeForVersionNode(targetNode);
          if (!targetType) {
            return "target_not_found";
          }
          const current = await loadTargetVersion(
            transaction,
            userId,
            workId,
            targetBranchId,
            targetType,
            targetNode.objectId,
          );
          if (!current) {
            return "target_not_found";
          }
          const expectedVersion =
            typeof item.targetPayload.version === "number"
              ? item.targetPayload.version
              : current.version;
          if (current.version !== expectedVersion) {
            return "version_conflict";
          }
          targets.push({
            item,
            targetType,
            targetId: targetNode.objectId,
            expectedVersion,
          });
        }
        const versionNodeId = uuidv7();
        const now = new Date();
        await transaction.insert(versionNodes).values({
          id: versionNodeId,
          workId,
          branchId: targetBranchId,
          userId,
          parentNodeId: branch.headNodeId,
          nodeType: "branch_merge",
          objectType: "branch",
          objectId: targetBranchId,
          objectVersion: 1,
          snapshotId: null,
          payload: {
            sourceBranchIds: [...new Set(items.map((item) => item.sourceBranchId))],
            itemIds: items.map((item) => item.id),
            items: items.map((item) => ({
              objectType: item.objectType,
              objectId: item.objectId,
              diff: item.diff,
              reason: item.reason,
            })),
          },
          actorId: userId,
          message: `选择性摘取 ${items.length} 个对象`,
          createdAt: now,
        });
        for (const target of targets) {
          const applied = await applyObjectSnapshot(
            transaction,
            userId,
            workId,
            targetBranchId,
            target.targetType,
            target.targetId,
            target.expectedVersion,
            extractObjectPayload(target.item.sourcePayload),
            versionNodeId,
            now,
          );
          if (!applied) {
            throw new MergeApplyAbort("version_conflict");
          }
        }
        await transaction
          .update(workBranches)
          .set({ headNodeId: versionNodeId, updatedAt: now })
          .where(eq(workBranches.id, targetBranchId));
        await transaction
          .update(mergeItems)
          .set({ status: "applied", updatedAt: now, version: sql`${mergeItems.version} + 1` })
          .where(
            inArray(
              mergeItems.id,
              items.map((item) => item.id),
            ),
          );
        const hasConflict = items.some((item) => item.conflict);
        await transaction.insert(notifications).values({
          id: uuidv7(),
          userId,
          workId,
          branchId: targetBranchId,
          type: hasConflict ? "merge_conflict" : "merge_completed",
          targetType: "merge",
          targetId: versionNodeId,
          payload: {
            title: hasConflict ? "平行版本摘取存在冲突" : "平行版本摘取完成",
            message: hasConflict
              ? `已应用 ${items.length} 个对象，其中包含覆盖冲突，请检查修改记录。`
              : `已将 ${items.length} 个对象摘取到当前版本。`,
            href: `/workspace/${workId}/changes`,
          },
          dedupeKey: `merge:${versionNodeId}:${hasConflict ? "conflict" : "completed"}`,
          readAt: null,
          createdAt: now,
        });
        await this.audit(
          transaction,
          userId,
          workId,
          targetBranchId,
          "merge.applied",
          versionNodeId,
          audit,
          { itemIds: input.itemIds },
        );
        return { applied: input.itemIds, versionNodeId };
      });
    } catch (error) {
      if (error instanceof MergeApplyAbort) {
        return error.result;
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async context(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    lock = false,
  ): Promise<{ workId: string; branch: typeof workBranches.$inferSelect } | undefined> {
    const query = transaction
      .select({ workId: works.id, branch: workBranches })
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
    const [row] = lock ? await query.for("update") : await query;
    return row;
  }

  private async impactCounts(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
  ) {
    const [chapterCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(chapters)
      .where(
        and(
          eq(chapters.userId, userId),
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
        ),
      );
    const [entityCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          sql`${entities.deletedAt} is null`,
        ),
      );
    const [factCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.workId, workId), eq(facts.branchId, branchId)));
    const [outlineCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(outlineNodes)
      .where(
        and(
          eq(outlineNodes.userId, userId),
          eq(outlineNodes.workId, workId),
          eq(outlineNodes.branchId, branchId),
        ),
      );
    const [ledgerCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(foreshadows)
      .where(
        and(
          eq(foreshadows.userId, userId),
          eq(foreshadows.workId, workId),
          eq(foreshadows.branchId, branchId),
        ),
      );
    const [mapCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(mapNodes)
      .where(
        and(
          eq(mapNodes.userId, userId),
          eq(mapNodes.workId, workId),
          eq(mapNodes.branchId, branchId),
        ),
      );
    const [timelineCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.userId, userId),
          eq(timelineEvents.workId, workId),
          eq(timelineEvents.branchId, branchId),
        ),
      );
    const [resourceCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          inArray(entities.type, ["power_system", "golden_finger", "item"]),
          sql`${entities.deletedAt} is null`,
        ),
      );
    return {
      chapters: chapterCount?.count ?? 0,
      entities: entityCount?.count ?? 0,
      facts: factCount?.count ?? 0,
      outline: outlineCount?.count ?? 0,
      ledger: ledgerCount?.count ?? 0,
      maps: mapCount?.count ?? 0,
      timeline: timelineCount?.count ?? 0,
      resources: resourceCount?.count ?? 0,
    };
  }

  private async audit(
    transaction: DatabaseTransaction,
    userId: string,
    _workId: string,
    _branchId: string,
    action: string,
    targetId: string,
    audit: ChangesAuditContext,
    details: Record<string, unknown>,
  ) {
    void details;
    await transaction.insert(auditLogs).values({
      id: uuidv7(),
      actorId: userId,
      action,
      targetType: action.split(".")[0] ?? "change",
      targetId,
      decision: "allowed",
      correlationId: audit.requestId,
      ip: audit.ip,
      userAgent: audit.userAgent,
      createdAt: new Date(),
    });
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

function toChangeRequest(record: ChangeRecord): ChangeRequest {
  return {
    id: record.id,
    workId: record.workId,
    branchId: record.branchId,
    title: record.title,
    reason: record.reason,
    targetVersion: record.targetVersion,
    targetType: record.targetType as ChangeRequest["targetType"],
    targetId: record.targetId,
    objectType: record.objectType,
    before: record.before,
    after: record.after,
    diff: record.diff,
    source: record.source as ChangeRequest["source"],
    risk: record.risk as ChangeRequest["risk"],
    status: record.status as ChangeRequest["status"],
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toChangeImpact(record: typeof changeImpacts.$inferSelect): ChangeImpact {
  return {
    id: record.id,
    category: record.category as ChangeImpact["category"],
    affectedType: record.affectedType,
    affectedId: record.affectedId,
    chapterId: record.chapterId,
    summary: record.summary,
    evidence: record.evidence,
    confidence: record.confidence,
  };
}

function toMergeItem(record: MergeItemRecord): MergeItem {
  return {
    id: record.id,
    sourceBranchId: record.sourceBranchId,
    targetBranchId: record.targetBranchId,
    sourceNodeId: record.sourceNodeId,
    targetNodeId: record.targetNodeId,
    objectType: record.objectType as MergeItem["objectType"],
    objectId: record.objectId,
    objectKey: record.objectKey,
    sourcePayload: record.sourcePayload,
    targetPayload: record.targetPayload,
    diff: record.diff,
    changeKind: record.changeKind as MergeItem["changeKind"],
    risk: record.risk as MergeItem["risk"],
    conflict: record.conflict,
    status: record.status as MergeItem["status"],
    reason: record.reason,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mergeObjectType(objectType: string, nodeType: string): MergeItem["objectType"] | null {
  if (["chapter", "entity", "fact", "outline", "ledger"].includes(objectType)) {
    return objectType as MergeItem["objectType"];
  }
  switch (nodeType) {
    case "chapter_version":
      return "chapter";
    case "entity_version":
      return "entity";
    case "canon_commit":
      return "fact";
    case "outline_version":
      return "outline";
    case "ledger_version":
      return "ledger";
    default:
      return null;
  }
}

function mergeObjectKey(
  objectType: string,
  objectId: string,
  payload: Record<string, unknown>,
): string {
  if (typeof payload.objectKey === "string" && payload.objectKey.trim()) {
    return payload.objectKey;
  }
  const logicalName = [payload.name, payload.title, payload.subject, payload.label].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return logicalName ? `${objectType}:name:${logicalName.trim()}` : `${objectType}:${objectId}`;
}

function nodesAlongHead(
  nodes: Array<typeof versionNodes.$inferSelect>,
  headNodeId: string | null,
): Array<typeof versionNodes.$inferSelect> {
  if (!headNodeId) {
    return [];
  }
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const result: Array<typeof versionNodes.$inferSelect> = [];
  const seen = new Set<string>();
  let currentId: string | null = headNodeId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const node = byId.get(currentId);
    if (!node) {
      break;
    }
    result.push(node);
    currentId = node.parentNodeId;
  }
  return result;
}

function mergeChangeKind(
  source: typeof versionNodes.$inferSelect | undefined,
  target: typeof versionNodes.$inferSelect | undefined,
): MergeItem["changeKind"] {
  if (!source) {
    return "removed";
  }
  if (!target) {
    return "added";
  }
  return JSON.stringify(source.payload) === JSON.stringify(target.payload)
    ? "unchanged"
    : "changed";
}

interface TargetVersion {
  version: number;
  locked: boolean;
  objectKey: string;
}

async function loadTargetVersion(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  targetType: ChangeTargetType,
  targetId: string,
): Promise<TargetVersion | undefined> {
  switch (targetType) {
    case "entity": {
      const [row] = await transaction
        .select({
          version: entities.version,
          lockedAt: entities.lockedAt,
          name: entities.name,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, targetId),
            eq(entities.userId, userId),
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .limit(1);
      return row
        ? {
            version: row.version,
            locked: Boolean(row.lockedAt),
            objectKey: mergeObjectKey("entity", targetId, { name: row.name }),
          }
        : undefined;
    }
    case "chapter": {
      const [row] = await transaction
        .select({ version: chapters.version, status: chapters.status, title: chapters.title })
        .from(chapters)
        .where(
          and(
            eq(chapters.id, targetId),
            eq(chapters.userId, userId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
          ),
        )
        .limit(1);
      return row
        ? {
            version: row.version,
            locked: row.status === "locked" || row.status === "published",
            objectKey: mergeObjectKey("chapter", targetId, { title: row.title }),
          }
        : undefined;
    }
    case "outline": {
      const [row] = await transaction
        .select({
          version: outlineNodes.version,
          locked: outlineNodes.locked,
          title: outlineNodes.title,
        })
        .from(outlineNodes)
        .where(
          and(
            eq(outlineNodes.id, targetId),
            eq(outlineNodes.userId, userId),
            eq(outlineNodes.workId, workId),
            eq(outlineNodes.branchId, branchId),
          ),
        )
        .limit(1);
      return row
        ? {
            version: row.version,
            locked: row.locked,
            objectKey: mergeObjectKey("outline", targetId, { title: row.title }),
          }
        : undefined;
    }
    case "ledger": {
      const [row] = await transaction
        .select({
          version: foreshadows.version,
          deletedAt: foreshadows.deletedAt,
          title: foreshadows.title,
        })
        .from(foreshadows)
        .where(
          and(
            eq(foreshadows.id, targetId),
            eq(foreshadows.userId, userId),
            eq(foreshadows.workId, workId),
            eq(foreshadows.branchId, branchId),
            sql`${foreshadows.deletedAt} is null`,
          ),
        )
        .limit(1);
      return row
        ? {
            version: row.version,
            locked: false,
            objectKey: mergeObjectKey("ledger", targetId, { title: row.title }),
          }
        : undefined;
    }
    case "fact": {
      const [row] = await transaction
        .select({ status: facts.status, subject: facts.subject })
        .from(facts)
        .where(
          and(
            eq(facts.id, targetId),
            eq(facts.userId, userId),
            eq(facts.workId, workId),
            eq(facts.branchId, branchId),
          ),
        )
        .limit(1);
      return row
        ? {
            version: 1,
            locked: row.status === "superseded",
            objectKey: mergeObjectKey("fact", targetId, { subject: row.subject }),
          }
        : undefined;
    }
    case "work": {
      const [row] = await transaction
        .select({ status: works.status, title: works.title })
        .from(works)
        .where(
          and(
            eq(works.id, targetId),
            eq(works.userId, userId),
            eq(works.id, workId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return row
        ? {
            version: 1,
            locked: row.status === "archived" || row.status === "completed",
            objectKey: mergeObjectKey("work", targetId, { title: row.title }),
          }
        : undefined;
    }
  }
}

async function applyObjectSnapshot(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  targetType: ChangeTargetType,
  targetId: string,
  expectedVersion: number,
  payload: Record<string, unknown>,
  versionNodeId: string,
  now: Date,
): Promise<boolean> {
  switch (targetType) {
    case "entity": {
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, targetId),
            eq(entities.userId, userId),
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            eq(entities.version, expectedVersion),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .limit(1);
      if (!current) {
        return false;
      }
      const next = {
        name: stringValue(payload, "name", current.name),
        aliases: stringArrayValue(payload, "aliases", current.aliases),
        summary: stringValue(payload, "summary", current.summary),
        description: stringValue(payload, "description", current.description),
        attributes: recordValue(payload, "attributes", current.attributes),
        tags: stringArrayValue(payload, "tags", current.tags),
        version: current.version + 1,
      };
      const [updated] = await transaction
        .update(entities)
        .set({ ...next, updatedAt: now })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!updated) {
        return false;
      }
      await transaction.insert(entityVersions).values({
        id: uuidv7(),
        entityId: updated.id,
        workId,
        branchId,
        userId,
        version: updated.version,
        snapshot: {
          type: updated.type,
          name: updated.name,
          aliases: updated.aliases,
          summary: updated.summary,
          description: updated.description,
          attributes: updated.attributes,
          tags: updated.tags,
          status: updated.status,
          source: updated.source,
          version: updated.version,
          lockedAt: updated.lockedAt?.toISOString() ?? null,
          lockedBy: updated.lockedBy,
        },
        versionNodeId,
        createdBy: userId,
        createdAt: now,
      });
      return true;
    }
    case "chapter": {
      const [current] = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, targetId),
            eq(chapters.userId, userId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            eq(chapters.version, expectedVersion),
          ),
        )
        .limit(1);
      if (!current) {
        return false;
      }
      const nextVersion = current.version + 1;
      const content = typeof payload.content === "string" ? payload.content : undefined;
      let currentVersionId = current.currentVersionId;
      if (content !== undefined) {
        const chapterVersionId = uuidv7();
        await transaction.insert(chapterVersions).values({
          id: chapterVersionId,
          workId,
          branchId,
          userId,
          chapterId: current.id,
          version: nextVersion,
          content,
          contentHash: createHash("sha256").update(content).digest("hex"),
          versionNodeId,
          source: "change_apply",
        });
        currentVersionId = chapterVersionId;
      }
      const [updated] = await transaction
        .update(chapters)
        .set({
          title: stringValue(payload, "title", current.title),
          status: stringValue(payload, "status", current.status),
          brief: recordValue(payload, "brief", current.brief),
          wordCount: content === undefined ? current.wordCount : countCharacters(content),
          currentVersionId,
          version: nextVersion,
          updatedAt: now,
        })
        .where(and(eq(chapters.id, current.id), eq(chapters.version, current.version)))
        .returning();
      return Boolean(updated);
    }
    case "outline": {
      const [current] = await transaction
        .select()
        .from(outlineNodes)
        .where(
          and(
            eq(outlineNodes.id, targetId),
            eq(outlineNodes.userId, userId),
            eq(outlineNodes.workId, workId),
            eq(outlineNodes.branchId, branchId),
            eq(outlineNodes.version, expectedVersion),
          ),
        )
        .limit(1);
      if (!current) {
        return false;
      }
      const [updated] = await transaction
        .update(outlineNodes)
        .set({
          title: stringValue(payload, "title", current.title),
          summary: stringValue(payload, "summary", current.summary),
          status: stringValue(payload, "status", current.status),
          tension: numberValue(payload, "tension", current.tension),
          version: current.version + 1,
          versionNodeId,
          updatedAt: now,
        })
        .where(and(eq(outlineNodes.id, current.id), eq(outlineNodes.version, current.version)))
        .returning();
      return Boolean(updated);
    }
    case "ledger": {
      const [current] = await transaction
        .select()
        .from(foreshadows)
        .where(
          and(
            eq(foreshadows.id, targetId),
            eq(foreshadows.userId, userId),
            eq(foreshadows.workId, workId),
            eq(foreshadows.branchId, branchId),
            eq(foreshadows.version, expectedVersion),
            sql`${foreshadows.deletedAt} is null`,
          ),
        )
        .limit(1);
      if (!current) {
        return false;
      }
      const [updated] = await transaction
        .update(foreshadows)
        .set({
          title: stringValue(payload, "title", current.title),
          summary: stringValue(payload, "summary", current.summary),
          status: stringValue(payload, "status", current.status),
          importance: stringValue(payload, "importance", current.importance),
          readerPromise: stringValue(payload, "readerPromise", current.readerPromise),
          version: current.version + 1,
          versionNodeId,
          updatedAt: now,
        })
        .where(and(eq(foreshadows.id, current.id), eq(foreshadows.version, current.version)))
        .returning();
      return Boolean(updated);
    }
    case "fact": {
      return false;
    }
    case "work": {
      const [updated] = await transaction
        .update(works)
        .set({
          title: stringValue(payload, "title", ""),
          penName: stringValue(payload, "penName", ""),
          status: stringValue(payload, "status", "draft"),
          scaleTarget: stringValue(payload, "scaleTarget", "long"),
          chapterLengthTarget: numberValue(payload, "chapterLengthTarget", 3000) ?? 3000,
          settings: recordValue(payload, "settings", {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(works.id, targetId),
            eq(works.id, workId),
            eq(works.userId, userId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .returning({ id: works.id });
      return Boolean(updated);
    }
  }
}

function targetTypeForVersionNode(
  node: typeof versionNodes.$inferSelect,
): ChangeTargetType | undefined {
  if (node.objectType === "setting") {
    return "entity";
  }
  if (
    node.objectType === "entity" ||
    node.objectType === "chapter" ||
    node.objectType === "fact" ||
    node.objectType === "outline" ||
    node.objectType === "ledger" ||
    node.objectType === "work"
  ) {
    return node.objectType;
  }
  switch (node.nodeType) {
    case "entity_version":
      return "entity";
    case "chapter_version":
      return "chapter";
    case "canon_commit":
      return "fact";
    case "outline_version":
      return "outline";
    case "ledger_version":
      return "ledger";
    default:
      return undefined;
  }
}

function objectTypeMatchesTarget(objectType: string, targetType: ChangeTargetType): boolean {
  switch (targetType) {
    case "entity":
      return objectType === "entity" || objectType === "setting";
    case "chapter":
      return objectType === "chapter";
    case "outline":
      return objectType === "outline";
    case "fact":
      return objectType === "fact";
    case "ledger":
      return objectType === "ledger";
    case "work":
      return objectType === "work";
  }
}

function rollbackPayload(node: typeof versionNodes.$inferSelect): Record<string, unknown> {
  if (node.nodeType === "change_apply" && isRecord(node.payload.before)) {
    return node.payload.before;
  }
  if (isRecord(node.payload.restored)) {
    return node.payload.restored;
  }
  return node.payload;
}

function extractObjectPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.after) ? payload.after : payload;
}

function stringValue(payload: Record<string, unknown>, key: string, fallback: string): string {
  return typeof payload[key] === "string" ? payload[key] : fallback;
}

function numberValue(
  payload: Record<string, unknown>,
  key: string,
  fallback: number | null,
): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArrayValue(
  payload: Record<string, unknown>,
  key: string,
  fallback: string[],
): string[] {
  const value = payload[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : fallback;
}

function recordValue(
  payload: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(payload[key]) ? payload[key] : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function objectDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { before: before[key] ?? null, after: after[key] ?? null };
    }
  }
  return changes;
}

function sameChangeRequest(record: ChangeRecord, input: ChangeRequestCreateRequest): boolean {
  return (
    record.title === input.title &&
    record.reason === input.reason &&
    record.targetVersion === input.targetVersion &&
    record.targetType === input.targetType &&
    record.targetId === input.targetId &&
    record.objectType === input.objectType &&
    JSON.stringify(record.before) === JSON.stringify(input.before) &&
    JSON.stringify(record.after) === JSON.stringify(input.after)
  );
}
