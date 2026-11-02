import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  accountExportJobs,
  auditLogs,
  chapters,
  chapterVersions,
  createDatabase,
  exportJobs,
  mapImages,
  penNames,
  users,
  workBranches,
  works,
  workPurgeReceipts,
  type Database,
  type DatabaseConnection,
} from '@novel/db';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ObjectStorageService } from '../storage/object-storage.service';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type WorkPurgeCandidate = {
  id: string;
  userId: string;
  title: string;
  deletedAt: Date;
};

type WorkCounts = {
  branches: number;
  chapters: number;
  chapterVersions: number;
  mapImages: number;
  exportJobs: number;
  auditLogs: number;
};

type ObjectCleanup = {
  status: 'completed' | 'failed';
  total: number;
  deleted: number;
  referenced: number;
  failed: number;
  error?: string;
};

export type WorkPurgeOptions = {
  now?: Date;
  limit?: number;
  dryRun?: boolean;
};

export type WorkPurgeItem = {
  workId: string;
  userId: string;
  status: 'completed' | 'dry_run' | 'failed';
  counts?: WorkCounts;
  objectKeyCount?: number;
  objectCleanup?: ObjectCleanup;
  error?: string;
};

export type WorkPurgeResult = {
  runAt: string;
  limit: number;
  dryRun: boolean;
  scanned: number;
  purged: number;
  failed: number;
  items: WorkPurgeItem[];
};

@Injectable()
export class WorkPurgeRunner implements OnModuleDestroy {
  private readonly logger = new Logger(WorkPurgeRunner.name);
  private admin: DatabaseConnection | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: ObjectStorageService,
  ) {}

  async run(options: WorkPurgeOptions = {}): Promise<WorkPurgeResult> {
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
    const dryRun = options.dryRun ?? false;
    const admin = this.getAdmin();
    const candidates = await admin.db
      .select({
        id: works.id,
        userId: works.userId,
        title: works.title,
        deletedAt: works.deletedAt,
      })
      .from(works)
      .where(and(isNotNull(works.deletedAt), lte(works.deletedAt, cutoff)))
      .orderBy(asc(works.deletedAt))
      .limit(limit);

    const items: WorkPurgeItem[] = [];
    for (const row of candidates) {
      const candidate: WorkPurgeCandidate = {
        id: row.id,
        userId: row.userId,
        title: row.title,
        deletedAt: row.deletedAt as Date,
      };
      if (dryRun) {
        const snapshot = await this.snapshotWork(admin.db, candidate.id);
        items.push({
          workId: candidate.id,
          userId: candidate.userId,
          status: 'dry_run',
          counts: snapshot.counts,
          objectKeyCount: snapshot.objectKeys.length,
        });
        continue;
      }

      try {
        const result = await this.purgeOne(admin, candidate, now);
        if (result) {
          items.push(result);
        }
      } catch (error) {
        this.logger.error(`Work ${candidate.id} purge failed`);
        items.push({
          workId: candidate.id,
          userId: candidate.userId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      runAt: now.toISOString(),
      limit,
      dryRun,
      scanned: candidates.length,
      purged: items.filter((item) => item.status === 'completed').length,
      failed: items.filter((item) => item.status === 'failed').length,
      items,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.admin) {
      await this.admin.pool.end();
      this.admin = null;
    }
  }

  private async purgeOne(
    admin: DatabaseConnection,
    candidate: WorkPurgeCandidate,
    now: Date,
  ): Promise<WorkPurgeItem | null> {
    const purged = await admin.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: works.id,
          userId: works.userId,
          title: works.title,
          deletedAt: works.deletedAt,
        })
        .from(works)
        .where(
          and(
            eq(works.id, candidate.id),
            isNotNull(works.deletedAt),
            lte(works.deletedAt, new Date(now.getTime() - RETENTION_MS)),
          ),
        )
        .for('update')
        .limit(1);
      if (!locked?.deletedAt) {
        return null;
      }

      const snapshot = await this.snapshotWork(tx, locked.id);
      const titleHash = createHash('sha256').update(locked.title).digest('hex');
      await tx.execute(sql`set local novel.allow_history_delete = 'on'`);
      await tx.delete(works).where(eq(works.id, locked.id));
      await tx.insert(auditLogs).values({
        userId: locked.userId,
        workId: null,
        branchId: null,
        action: 'work_purged',
        targetType: 'work',
        targetId: locked.id,
        title: '永久删除已到期作品',
        detail: '30 天恢复期已结束，作品数据已由后台清理任务永久删除。',
        metadata: {
          workId: locked.id,
          titleHash,
          deletedAt: locked.deletedAt.toISOString(),
          objectKeyCount: snapshot.objectKeys.length,
        },
      });
      await tx.insert(workPurgeReceipts).values({
        workId: locked.id,
        userId: locked.userId,
        titleHash,
        status: 'completed',
        deletedAt: locked.deletedAt,
        purgedAt: now,
        summary: {
          ...snapshot.counts,
          objectStorage: {
            status: 'pending',
            total: snapshot.objectKeys.length,
          },
        },
      });
      return {
        workId: locked.id,
        userId: locked.userId,
        counts: snapshot.counts,
        objectKeys: snapshot.objectKeys,
      };
    });
    if (!purged) {
      return null;
    }

    const objectCleanup = await this.cleanupObjects(admin.db, purged.userId, purged.objectKeys);
    await admin.db
      .update(workPurgeReceipts)
      .set({
        summary: {
          ...purged.counts,
          objectStorage: objectCleanup,
        },
      })
      .where(eq(workPurgeReceipts.workId, purged.workId));

    return {
      workId: purged.workId,
      userId: purged.userId,
      status: 'completed',
      counts: purged.counts,
      objectKeyCount: purged.objectKeys.length,
      objectCleanup,
    };
  }

  private async snapshotWork(
    db: Database,
    workId: string,
  ): Promise<{ counts: WorkCounts; objectKeys: string[] }> {
    const [branchRows, chapterRows, versionRows, imageRows, exportRows, auditRows, workRows] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(workBranches)
          .where(eq(workBranches.workId, workId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(chapters)
          .where(eq(chapters.workId, workId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(chapterVersions)
          .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
          .where(eq(chapters.workId, workId)),
        db
          .select({ storageKey: mapImages.storageKey })
          .from(mapImages)
          .where(eq(mapImages.workId, workId)),
        db
          .select({ fileKey: exportJobs.fileKey })
          .from(exportJobs)
          .where(eq(exportJobs.workId, workId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(eq(auditLogs.workId, workId)),
        db
          .select({ coverStorageKey: works.coverStorageKey })
          .from(works)
          .where(eq(works.id, workId))
          .limit(1),
      ]);

    return {
      counts: {
        branches: branchRows[0]?.count ?? 0,
        chapters: chapterRows[0]?.count ?? 0,
        chapterVersions: versionRows[0]?.count ?? 0,
        mapImages: imageRows.length,
        exportJobs: exportRows.length,
        auditLogs: auditRows[0]?.count ?? 0,
      },
      objectKeys: [
        ...new Set([
          ...imageRows.map((row) => row.storageKey),
          ...exportRows.map((row) => row.fileKey).filter((key): key is string => Boolean(key)),
          ...workRows
            .map((row) => row.coverStorageKey)
            .filter((key): key is string => Boolean(key)),
        ]),
      ],
    };
  }

  private async cleanupObjects(
    db: Database,
    userId: string,
    objectKeys: string[],
  ): Promise<ObjectCleanup> {
    let deleted = 0;
    let referenced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const key of objectKeys) {
      if (await this.isObjectReferenced(db, key)) {
        referenced += 1;
        continue;
      }
      try {
        await this.storage.removeObject(userId, key);
        deleted += 1;
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return {
      status: failed > 0 ? 'failed' : 'completed',
      total: objectKeys.length,
      deleted,
      referenced,
      failed,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  }

  private async isObjectReferenced(db: Database, key: string): Promise<boolean> {
    const checks = await Promise.all([
      db.select({ id: mapImages.id }).from(mapImages).where(eq(mapImages.storageKey, key)).limit(1),
      db.select({ id: exportJobs.id }).from(exportJobs).where(eq(exportJobs.fileKey, key)).limit(1),
      db
        .select({ id: accountExportJobs.id })
        .from(accountExportJobs)
        .where(eq(accountExportJobs.fileKey, key))
        .limit(1),
      db.select({ id: users.id }).from(users).where(eq(users.avatarUrl, key)).limit(1),
      db.select({ id: penNames.id }).from(penNames).where(eq(penNames.avatarUrl, key)).limit(1),
      db.select({ id: works.id }).from(works).where(eq(works.coverStorageKey, key)).limit(1),
    ]);
    return checks.some((rows) => rows.length > 0);
  }

  private getAdmin(): DatabaseConnection {
    if (!this.admin) {
      const url = this.config.get<string>('DATABASE_ADMIN_URL');
      if (!url) {
        throw new Error('DATABASE_ADMIN_URL is required to purge works');
      }
      this.admin = createDatabase(url);
    }
    return this.admin;
  }
}
