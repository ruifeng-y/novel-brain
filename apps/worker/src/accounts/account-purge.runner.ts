import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  accountPurgeReceipts,
  chapters,
  createDatabase,
  users,
  works,
  type DatabaseConnection,
} from '@novel/db';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ObjectStorageService } from '../storage/object-storage.service';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export type AccountPurgeOptions = {
  now?: Date;
  limit?: number;
  dryRun?: boolean;
};

export type AccountPurgeItem = {
  userId: string;
  status: 'completed' | 'dry_run' | 'failed';
  counts?: { works: number; chapters: number };
  error?: string;
};

export type AccountPurgeResult = {
  runAt: string;
  limit: number;
  dryRun: boolean;
  scanned: number;
  purged: number;
  failed: number;
  items: AccountPurgeItem[];
};

@Injectable()
export class AccountPurgeRunner implements OnModuleDestroy {
  private readonly logger = new Logger(AccountPurgeRunner.name);
  private admin: DatabaseConnection | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: ObjectStorageService,
  ) {}

  async run(options: AccountPurgeOptions = {}): Promise<AccountPurgeResult> {
    const now = options.now ?? new Date();
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)),
    );
    const dryRun = options.dryRun ?? false;
    const admin = this.getAdmin();

    const candidates = await admin.db
      .select({
        id: users.id,
        email: users.email,
        deletionRequestedAt: users.deletionRequestedAt,
        deletionScheduledFor: users.deletionScheduledFor,
      })
      .from(users)
      .where(
        and(
          eq(users.status, 'pending_deletion'),
          isNotNull(users.deletionScheduledFor),
          lte(users.deletionScheduledFor, now),
        ),
      )
      .orderBy(asc(users.deletionScheduledFor))
      .limit(limit);

    const items: AccountPurgeItem[] = [];
    for (const candidate of candidates) {
      if (dryRun) {
        items.push({ userId: candidate.id, status: 'dry_run' });
        continue;
      }

      try {
        const counts = await admin.db.transaction(async (tx) => {
          await tx.execute(sql`set local novel.allow_history_delete = 'on'`);
          const [locked] = await tx
            .select({
              id: users.id,
              email: users.email,
              deletionRequestedAt: users.deletionRequestedAt,
              deletionScheduledFor: users.deletionScheduledFor,
            })
            .from(users)
            .where(
              and(
                eq(users.id, candidate.id),
                eq(users.status, 'pending_deletion'),
                isNotNull(users.deletionScheduledFor),
                lte(users.deletionScheduledFor, now),
              ),
            )
            .limit(1)
            .for('update');
          if (!locked) {
            return null;
          }

          const [workCounts, chapterCounts] = await Promise.all([
            tx
              .select({ count: sql<number>`count(*)::int` })
              .from(works)
              .where(eq(works.userId, locked.id)),
            tx
              .select({ count: sql<number>`count(*)::int` })
              .from(chapters)
              .innerJoin(works, eq(works.id, chapters.workId))
              .where(eq(works.userId, locked.id)),
          ]);
          const counts = {
            works: workCounts[0]?.count ?? 0,
            chapters: chapterCounts[0]?.count ?? 0,
          };

          await tx.delete(users).where(eq(users.id, locked.id));
          await tx.insert(accountPurgeReceipts).values({
            userId: locked.id,
            emailHash: createHash('sha256').update(locked.email.toLowerCase()).digest('hex'),
            status: 'completed',
            deletionRequestedAt: locked.deletionRequestedAt,
            deletionScheduledFor: locked.deletionScheduledFor,
            purgedAt: now,
            summary: { ...counts, objectStorageCleanup: 'pending' },
          });
          return counts;
        });

        if (!counts) {
          continue;
        }
        try {
          await this.storage.removeUserObjects(candidate.id);
          await admin.db
            .update(accountPurgeReceipts)
            .set({
              summary: { ...counts, objectStorageCleanup: 'completed' },
            })
            .where(eq(accountPurgeReceipts.userId, candidate.id));
          items.push({ userId: candidate.id, status: 'completed', counts });
        } catch (error) {
          this.logger.error(
            `Account ${candidate.id} database purge completed but object cleanup failed`,
          );
          await admin.db
            .update(accountPurgeReceipts)
            .set({
              summary: {
                ...counts,
                objectStorageCleanup: 'failed',
                objectStorageError: error instanceof Error ? error.message : String(error),
              },
            })
            .where(eq(accountPurgeReceipts.userId, candidate.id));
          items.push({ userId: candidate.id, status: 'completed', counts });
        }
      } catch (error) {
        this.logger.error(`Account ${candidate.id} purge failed`);
        items.push({
          userId: candidate.id,
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

  private getAdmin(): DatabaseConnection {
    if (!this.admin) {
      const url = this.config.get<string>('DATABASE_ADMIN_URL');
      if (!url) {
        throw new Error('DATABASE_ADMIN_URL is required to purge accounts');
      }
      this.admin = createDatabase(url);
    }
    return this.admin;
  }
}
