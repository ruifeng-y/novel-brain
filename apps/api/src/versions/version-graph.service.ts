import { HttpStatus, Injectable } from '@nestjs/common';
import {
  PARALLEL_VERSION_KIND_LABELS,
  VERSION_KIND_LABELS,
  type AuditAction,
  type RollbackVersionInput,
  type VersionKind,
} from '@novel/contracts';
import {
  branchCommits,
  chapters,
  chapterVersions,
  workBranches,
  works,
  type BranchCommitRow,
  type WorkBranchRow,
} from '@novel/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BranchStateService } from '../branches/branch-state.service';
import { branchesError } from '../branches/branches.errors';
import { DatabaseService } from '../database/database.service';
import { AuditService } from './audit.service';

type RecordVersionInput = {
  userId: string;
  workId: string;
  branchId: string;
  kind: VersionKind;
  title: string;
  reason: string;
  chapterVersionId?: string | null;
  changeRequestId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export type VersionNodeResponse = {
  id: string;
  type: 'version';
  kind: VersionKind;
  kindLabel: string;
  branchId: string;
  branchName: string;
  title: string;
  reason: string;
  parentId: string;
  chapterVersionId: string | null;
  chapterNumber: number | null;
  chapterVersion: number | null;
  changeRequestId: string | null;
  targetVersionId: string | null;
  sourceBranchId: string | null;
  createdAt: string;
  isCurrent: boolean;
};

type BranchNodeResponse = {
  id: string;
  type: 'branch';
  kind: 'branch';
  kindLabel: string;
  branchId: string;
  branchName: string;
  title: string;
  reason: string;
  parentId: null;
  chapterVersionId: null;
  chapterNumber: null;
  chapterVersion: null;
  changeRequestId: null;
  targetVersionId: null;
  sourceBranchId: null;
  createdAt: string;
  isCurrent: false;
};

export type GraphNodeResponse = VersionNodeResponse | BranchNodeResponse;

export type VersionGraphResponse = {
  workId: string;
  branchId: string;
  branches: Array<{
    id: string;
    name: string;
    isMain: boolean;
    parentBranchId: string | null;
    parentBranchName: string | null;
    kindLabel: string;
    reason: string;
    statusLabel: string;
    forkPointLabel: string;
    createdAt: string;
  }>;
  nodes: GraphNodeResponse[];
  edges: Array<{
    id: string;
    from: string;
    to: string;
    kind: 'sequence' | 'fork' | 'rollback' | 'merge';
  }>;
  summary: {
    branchCount: number;
    versionCount: number;
    mergeCount: number;
  };
};

@Injectable()
export class VersionGraphService {
  constructor(
    private readonly database: DatabaseService,
    private readonly branchState: BranchStateService,
    private readonly audit: AuditService,
  ) {}

  async getGraph(userId: string, workId: string, branchId: string): Promise<VersionGraphResponse> {
    const logicalBranchId = await this.branchState.logicalBranchId(branchId);
    const { branches } = await this.requireWorkBranch(userId, workId, logicalBranchId);
    const visibleBranches = await this.database.db
      .select()
      .from(workBranches)
      .where(and(eq(workBranches.workId, workId), eq(workBranches.isSnapshot, false)))
      .orderBy(desc(workBranches.isMain), asc(workBranches.createdAt));
    const branchNames = new Map(visibleBranches.map((branch) => [branch.id, branch.name]));
    const commits = await this.database.db
      .select({
        commit: branchCommits,
        chapterNumber: chapters.chapterNumber,
        chapterVersion: chapterVersions.version,
      })
      .from(branchCommits)
      .leftJoin(chapterVersions, eq(chapterVersions.id, branchCommits.chapterVersionId))
      .leftJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
      .where(eq(branchCommits.workId, workId))
      .orderBy(asc(branchCommits.createdAt));

    const branchNodes: BranchNodeResponse[] = visibleBranches.map((branch) => ({
      id: this.branchNodeId(branch.id),
      type: 'branch',
      kind: 'branch',
      kindLabel: branch.isMain ? '主线' : '平行版本',
      branchId: branch.id,
      branchName: branch.name,
      title: branch.name,
      reason: branch.reason,
      parentId: null,
      chapterVersionId: null,
      chapterNumber: null,
      chapterVersion: null,
      changeRequestId: null,
      targetVersionId: null,
      sourceBranchId: null,
      createdAt: branch.createdAt.toISOString(),
      isCurrent: false,
    }));

    const lastCommitByBranch = new Map<string, string>();
    const versionNodes: VersionNodeResponse[] = commits.map(
      ({ commit, chapterNumber, chapterVersion }) => {
        const metadata = commit.metadata ?? {};
        const parentId =
          commit.parentCommitId ??
          lastCommitByBranch.get(commit.sourceBranchId) ??
          this.branchNodeId(commit.sourceBranchId);
        lastCommitByBranch.set(commit.sourceBranchId, commit.id);
        const targetVersionId =
          typeof metadata.targetVersionId === 'string' ? metadata.targetVersionId : null;
        const sourceBranchId =
          typeof metadata.sourceBranchId === 'string' ? metadata.sourceBranchId : null;
        return {
          id: commit.id,
          type: 'version',
          kind: commit.kind,
          kindLabel: VERSION_KIND_LABELS[commit.kind],
          branchId: commit.sourceBranchId,
          branchName: branchNames.get(commit.sourceBranchId) ?? '平行版本',
          title: commit.title || commit.message,
          reason: commit.reason,
          parentId,
          chapterVersionId: commit.chapterVersionId,
          chapterNumber,
          chapterVersion,
          changeRequestId: commit.changeRequestId,
          targetVersionId,
          sourceBranchId,
          createdAt: commit.createdAt.toISOString(),
          isCurrent: false,
        };
      },
    );
    const currentByBranch = new Map<string, string>();
    for (const node of versionNodes) {
      currentByBranch.set(node.branchId, node.id);
    }
    for (const node of versionNodes) {
      node.isCurrent = currentByBranch.get(node.branchId) === node.id;
    }

    const edges: VersionGraphResponse['edges'] = [];
    for (const branch of visibleBranches) {
      if (branch.isMain) {
        continue;
      }
      const parentId = branch.parentBranchId ?? branches.parentBranchId;
      if (parentId && branchNames.has(parentId)) {
        edges.push({
          id: `fork:${parentId}:${branch.id}`,
          from: this.branchNodeId(parentId),
          to: this.branchNodeId(branch.id),
          kind: 'fork',
        });
      }
    }
    for (const node of versionNodes) {
      edges.push({
        id: `sequence:${node.parentId}:${node.id}`,
        from: node.parentId,
        to: node.id,
        kind: 'sequence',
      });
      if (node.targetVersionId) {
        edges.push({
          id: `rollback:${node.targetVersionId}:${node.id}`,
          from: node.targetVersionId,
          to: node.id,
          kind: 'rollback',
        });
      }
      if (node.kind === 'merge' && node.sourceBranchId) {
        edges.push({
          id: `merge:${node.sourceBranchId}:${node.id}`,
          from: this.branchNodeId(node.sourceBranchId),
          to: node.id,
          kind: 'merge',
        });
      }
    }

    return {
      workId,
      branchId: logicalBranchId,
      branches: visibleBranches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        isMain: branch.isMain,
        parentBranchId: branch.parentBranchId,
        parentBranchName: branch.parentBranchId
          ? (branchNames.get(branch.parentBranchId) ?? null)
          : null,
        kindLabel: PARALLEL_VERSION_KIND_LABELS[branch.kind],
        reason: branch.reason,
        statusLabel: branch.status === 'active' ? '进行中' : '已归档',
        forkPointLabel:
          branch.forkPointKind === 'chapter_version' && branch.forkChapterNumber
            ? `第 ${branch.forkChapterNumber} 章`
            : '当前状态',
        createdAt: branch.createdAt.toISOString(),
      })),
      nodes: [...branchNodes, ...versionNodes],
      edges,
      summary: {
        branchCount: visibleBranches.length,
        versionCount: versionNodes.length,
        mergeCount: versionNodes.filter((node) => node.kind === 'merge').length,
      },
    };
  }

  async recordChapterVersion(
    userId: string,
    workId: string,
    branchId: string,
    chapterVersionId: string,
  ): Promise<BranchCommitRow> {
    const [row] = await this.database.db
      .select({
        chapterNumber: chapters.chapterNumber,
        chapterTitle: chapters.title,
        version: chapterVersions.version,
      })
      .from(chapterVersions)
      .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
      .where(eq(chapterVersions.id, chapterVersionId))
      .limit(1);
    if (!row) {
      throw branchesError(
        HttpStatus.NOT_FOUND,
        'VERSION_POINT_NOT_FOUND',
        'The selected version point is not available',
      );
    }
    return this.recordVersion({
      userId,
      workId,
      branchId,
      kind: 'chapter_version',
      title: `第 ${row.chapterNumber} 章 · ${row.chapterTitle} · 版本 ${row.version}`,
      reason: `保存第 ${row.chapterNumber} 章正文版本 ${row.version}`,
      chapterVersionId,
      metadata: {
        chapterNumber: row.chapterNumber,
        chapterVersion: row.version,
      },
    });
  }

  async recordVersion(input: RecordVersionInput): Promise<BranchCommitRow> {
    const logicalBranchId = await this.branchState.logicalBranchId(input.branchId);
    await this.requireWorkBranch(input.userId, input.workId, logicalBranchId);
    return this.database.db.transaction(async (tx) => {
      if (input.chapterVersionId) {
        const [existing] = await tx
          .select()
          .from(branchCommits)
          .where(eq(branchCommits.chapterVersionId, input.chapterVersionId))
          .limit(1);
        if (existing) {
          return existing;
        }
      }

      const [logicalBranch] = await tx
        .select()
        .from(workBranches)
        .where(eq(workBranches.id, logicalBranchId))
        .limit(1);
      if (!logicalBranch) {
        throw branchesError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
      }
      const stateSourceId = await this.branchState.effectiveReadBranchId(logicalBranchId);
      const [parent] = await tx
        .select({ id: branchCommits.id })
        .from(branchCommits)
        .where(eq(branchCommits.sourceBranchId, logicalBranchId))
        .orderBy(desc(branchCommits.createdAt))
        .limit(1);
      const now = new Date();
      const requiresFullSnapshot =
        Boolean(input.chapterVersionId) ||
        ['change', 'undo', 'rollback', 'merge'].includes(input.kind);
      let snapshotBranchId = stateSourceId;
      if (requiresFullSnapshot) {
        const [snapshotBranch] = await tx
          .insert(workBranches)
          .values({
            workId: input.workId,
            name: `snapshot-${randomUUID()}`,
            isMain: false,
            isSnapshot: true,
            parentBranchId: logicalBranchId,
            kind: logicalBranch.kind,
            reason: input.title,
            forkPointKind: 'current',
            baselineMaterializedAt: now,
            status: 'active',
            createdBy: input.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await this.branchState.cloneBranchRows(
          tx,
          input.workId,
          stateSourceId,
          snapshotBranch.id,
          false,
        );
        snapshotBranchId = snapshotBranch.id;
      }

      const [commit] = await tx
        .insert(branchCommits)
        .values({
          workId: input.workId,
          sourceBranchId: logicalBranchId,
          snapshotBranchId,
          chapterVersionId: input.chapterVersionId ?? null,
          parentCommitId: parent?.id ?? null,
          changeRequestId: input.changeRequestId ?? null,
          kind: input.kind,
          title: input.title,
          reason: input.reason,
          metadata: input.metadata ?? {},
          message: input.title,
          createdBy: input.userId,
          createdAt: now,
        })
        .returning();
      await tx
        .update(workBranches)
        .set({ baseCommitId: commit.id, updatedAt: now })
        .where(eq(workBranches.id, logicalBranchId));
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, input.workId));
      await this.audit.record({
        userId: input.userId,
        workId: input.workId,
        branchId: logicalBranchId,
        action: this.auditAction(input.kind),
        targetType: 'version',
        targetId: commit.id,
        title: input.title,
        detail: input.reason,
        metadata: {
          ...input.metadata,
          kind: input.kind,
          changeRequestId: input.changeRequestId ?? null,
        },
        ip: input.ip,
        userAgent: input.userAgent,
      });
      return commit;
    });
  }

  async rollback(
    userId: string,
    workId: string,
    branchId: string,
    input: RollbackVersionInput,
  ): Promise<{ version: VersionNodeResponse; graph: VersionGraphResponse }> {
    const logicalBranchId = await this.branchState.logicalBranchId(branchId);
    await this.requireWorkBranch(userId, workId, logicalBranchId);
    const [target] = await this.database.db
      .select()
      .from(branchCommits)
      .where(
        and(
          eq(branchCommits.id, input.targetVersionId),
          eq(branchCommits.workId, workId),
          eq(branchCommits.sourceBranchId, logicalBranchId),
        ),
      )
      .limit(1);
    if (!target) {
      throw branchesError(
        HttpStatus.NOT_FOUND,
        'VERSION_NOT_FOUND',
        'This version is not available on the current story line',
      );
    }

    const commit = await this.database.db.transaction(async (tx) => {
      const [logicalBranch] = await tx
        .select()
        .from(workBranches)
        .where(eq(workBranches.id, logicalBranchId))
        .limit(1);
      if (!logicalBranch) {
        throw branchesError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
      }
      const [parent] = await tx
        .select({ id: branchCommits.id })
        .from(branchCommits)
        .where(eq(branchCommits.sourceBranchId, logicalBranchId))
        .orderBy(desc(branchCommits.createdAt))
        .limit(1);
      const now = new Date();
      const snapshotBranchId = await this.branchState.resolveSnapshotBranchId(
        target.id,
        target.snapshotBranchId,
      );
      const [restoredState] = await tx
        .insert(workBranches)
        .values({
          workId,
          name: `restore-${randomUUID()}`,
          isMain: false,
          isSnapshot: true,
          parentBranchId: logicalBranchId,
          kind: logicalBranch.kind,
          reason: input.reason,
          forkPointKind: 'current',
          baselineMaterializedAt: now,
          status: 'active',
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.branchState.cloneBranchRows(
        tx,
        workId,
        snapshotBranchId,
        restoredState.id,
        true,
      );
      await tx
        .update(workBranches)
        .set({ stateBranchId: restoredState.id, updatedAt: now })
        .where(eq(workBranches.id, logicalBranchId));
      const [created] = await tx
        .insert(branchCommits)
        .values({
          workId,
          sourceBranchId: logicalBranchId,
          snapshotBranchId: restoredState.id,
          chapterVersionId: null,
          parentCommitId: parent?.id ?? null,
          changeRequestId: null,
          kind: 'rollback',
          title: `回滚到：${target.title || target.message}`,
          reason: input.reason,
          metadata: {
            targetVersionId: target.id,
          },
          message: `回滚到：${target.title || target.message}`,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      await tx
        .update(workBranches)
        .set({ baseCommitId: created.id, updatedAt: now })
        .where(eq(workBranches.id, logicalBranchId));
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      await this.audit.record({
        userId,
        workId,
        branchId: logicalBranchId,
        action: 'rollback',
        targetType: 'version',
        targetId: created.id,
        title: created.title,
        detail: input.reason,
        metadata: {
          targetVersionId: target.id,
        },
      });
      return created;
    });

    const graph = await this.getGraph(userId, workId, logicalBranchId);
    const version = graph.nodes.find(
      (node): node is VersionNodeResponse => node.type === 'version' && node.id === commit.id,
    );
    if (!version) {
      throw branchesError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'VERSION_NOT_FOUND',
        'The rollback version could not be read',
      );
    }
    return { version, graph };
  }

  private auditAction(kind: VersionKind): AuditAction {
    if (kind === 'change') {
      return 'change_applied';
    }
    if (kind === 'undo') {
      return 'change_undone';
    }
    if (kind === 'rollback') {
      return 'rollback';
    }
    if (kind === 'merge') {
      return 'merge_applied';
    }
    return 'version_created';
  }

  private branchNodeId(branchId: string): string {
    return `branch:${branchId}`;
  }

  private async requireWorkBranch(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ work: typeof works.$inferSelect; branches: WorkBranchRow }> {
    const [row] = await this.database.db
      .select({ work: works, branch: workBranches })
      .from(works)
      .innerJoin(workBranches, eq(workBranches.workId, works.id))
      .where(
        and(
          eq(works.id, workId),
          eq(works.userId, userId),
          isNull(works.deletedAt),
          eq(workBranches.id, branchId),
        ),
      )
      .limit(1);
    if (!row) {
      throw branchesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return { work: row.work, branches: row.branch };
  }
}
