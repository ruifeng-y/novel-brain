import { ConfigService } from '@nestjs/config';
import { createDatabase } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AccountPurgeRunner } from './account-purge.runner';

const DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';

describe('account purge runner', () => {
  let pool: ReturnType<typeof createDatabase>['pool'];
  let runner: AccountPurgeRunner;
  let removeUserObjects: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const connection = createDatabase(DATABASE_URL);
    pool = connection.pool;
    await migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), 'packages/db/migrations'),
    });
    removeUserObjects = vi.fn(async () => undefined);
    const storage = {
      removeUserObjects,
    } as unknown as ObjectStorageService;
    runner = new AccountPurgeRunner(
      new ConfigService({
        DATABASE_URL,
        DATABASE_ADMIN_URL: DATABASE_URL,
      }),
      storage,
    );
  });

  afterAll(async () => {
    await runner.onModuleDestroy();
    await pool.end();
  });

  it('purges only expired pending-deletion accounts and leaves evidence', async () => {
    const now = new Date('2026-11-03T00:00:00.000Z');
    const activeId = randomUUID();
    const futureId = randomUUID();
    const expiredId = randomUUID();

    await pool.query(
      `insert into users
         (id, email, password_hash, display_name, status, deletion_requested_at,
          deletion_scheduled_for)
       values
         ($1, $2, 'hash', '活跃作者', 'active', null, null),
         ($3, $4, 'hash', '待恢复作者', 'pending_deletion',
          $5, $6),
         ($7, $8, 'hash', '已到期作者', 'pending_deletion',
          $9, $10)`,
      [
        activeId,
        `purge-active-${activeId}@example.com`,
        futureId,
        `purge-future-${futureId}@example.com`,
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
        expiredId,
        `purge-expired-${expiredId}@example.com`,
        new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 1_000),
      ],
    );
    await pool.query(
      `insert into works (user_id, title, pen_name, genre_pack, scale, target_platform)
       values
         ($1, '到期作品一', '旧笔名', 'xianxia', 'long', '起点中文网'),
         ($1, '到期作品二', '旧笔名', 'xianxia', 'long', '起点中文网')`,
      [expiredId],
    );
    await pool.query(
      `insert into audit_logs
         (user_id, action, target_type, title, metadata)
       values ($1, 'account_login', 'account', '登录账号', '{}'::jsonb)`,
      [expiredId],
    );

    const result = await runner.run({ now, limit: 10 });

    expect(result).toMatchObject({
      purged: 1,
      failed: 0,
      dryRun: false,
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        userId: expiredId,
        status: 'completed',
        counts: expect.objectContaining({ works: 2 }),
      }),
    ]);
    expect(removeUserObjects).toHaveBeenCalledWith(expiredId);

    const users = await pool.query<{ id: string }>(
      'select id from users where id = any($1::uuid[]) order by id',
      [[activeId, futureId, expiredId]],
    );
    expect(users.rows.map((row) => row.id).sort()).toEqual([activeId, futureId].sort());

    const receipt = await pool.query<{
      user_id: string;
      email_hash: string;
      status: string;
      summary: Record<string, unknown>;
    }>(
      'select user_id, email_hash, status, summary from account_purge_receipts where user_id = $1',
      [expiredId],
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0].status).toBe('completed');
    expect(receipt.rows[0].email_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.rows[0].summary).toMatchObject({ works: 2 });
  });

  it('supports a dry run without deleting or writing receipts', async () => {
    const now = new Date('2026-11-04T00:00:00.000Z');
    const userId = randomUUID();
    await pool.query(
      `insert into users
         (id, email, password_hash, display_name, status, deletion_requested_at,
          deletion_scheduled_for)
       values ($1, $2, 'hash', '演练作者', 'pending_deletion', $3, $4)`,
      [
        userId,
        `purge-dry-${userId}@example.com`,
        new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 1_000),
      ],
    );

    const result = await runner.run({ now, dryRun: true, limit: 10 });
    expect(result.dryRun).toBe(true);
    expect(result.items.some((item) => item.userId === userId)).toBe(true);

    const stored = await pool.query('select 1 from users where id = $1', [userId]);
    expect(stored.rowCount).toBe(1);
    const receipt = await pool.query(
      'select 1 from account_purge_receipts where user_id = $1',
      [userId],
    );
    expect(receipt.rowCount).toBe(0);
    expect(removeUserObjects).not.toHaveBeenCalledWith(userId);
  });
});
