import { ConfigService } from '@nestjs/config';
import { createDatabase } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectStorageService } from '../storage/object-storage.service';
import { WorkPurgeRunner } from './work-purge.runner';

const DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';

describe('work purge runner', () => {
  let pool: ReturnType<typeof createDatabase>['pool'];
  let runner: WorkPurgeRunner;
  let removeObject: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const connection = createDatabase(DATABASE_URL);
    pool = connection.pool;
    await migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), 'packages/db/migrations'),
    });
    removeObject = vi.fn(async () => undefined);
    runner = new WorkPurgeRunner(
      new ConfigService({
        DATABASE_URL,
        DATABASE_ADMIN_URL: DATABASE_URL,
      }),
      { removeObject } as unknown as ObjectStorageService,
    );
  });

  beforeEach(async () => {
    removeObject.mockClear();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local novel.allow_history_delete = 'on'`);
      await client.query(`delete from users where email like 'work-purge-%@example.com'`);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local novel.allow_history_delete = 'on'`);
      await client.query(
        `delete from work_purge_receipts
         where user_id in (select id from users where email like 'work-purge-%@example.com')`,
      );
      await client.query(`delete from users where email like 'work-purge-%@example.com'`);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    await runner.onModuleDestroy();
    await pool.end();
  });

  it('purges expired works, cascades database rows, and keeps referenced objects', async () => {
    const now = new Date('2001-01-02T00:00:00.000Z');
    const expired = await seedUserAndWork(pool, now, '已到期作品', 31);
    const userId = expired.userId;
    const live = await seedUserAndWork(pool, now, '仍在使用的作品', null, userId);
    const mapUniqueKey = objectKey(userId, expired.workId, expired.branchId, 'map-unique.webp');
    const mapSharedKey = objectKey(userId, expired.workId, expired.branchId, 'map-shared.webp');
    const avatarKey = objectKey(userId, expired.workId, expired.branchId, 'avatar.webp');
    const exportUniqueKey = objectKey(userId, 'exports', 'unique.zip');
    const accountExportKey = objectKey(userId, 'exports', 'account-shared.zip');
    const penNameKey = objectKey(userId, 'exports', 'pen-name-avatar.zip');

    await seedMapImage(pool, expired, userId, mapUniqueKey, '唯一地图');
    await seedMapImage(pool, expired, userId, mapSharedKey, '共享地图');
    await seedMapImage(pool, expired, userId, avatarKey, '头像引用');
    await seedMapImage(pool, live, userId, mapSharedKey, '另一本书共享地图');
    await seedExport(pool, expired, userId, exportUniqueKey);
    await seedExport(pool, expired, userId, accountExportKey);
    await seedExport(pool, expired, userId, penNameKey);
    await pool.query(
      `insert into account_export_jobs (user_id, file_key, expires_at)
       values ($1, $2, $3)`,
      [userId, accountExportKey, new Date(now.getTime() + 86_400_000)],
    );
    await pool.query('update users set avatar_url = $2 where id = $1', [userId, avatarKey]);
    await pool.query(
      `insert into pen_names (user_id, name, avatar_url)
       values ($1, $2, $3)`,
      [userId, `笔名-${userId}`, penNameKey],
    );
    await pool.query(
      `insert into audit_logs
         (user_id, work_id, branch_id, action, target_type, title)
       values ($1, $2, $3, 'work_updated', 'work', '作品内审计')`,
      [userId, expired.workId, expired.branchId],
    );

    const result = await runner.run({ now, limit: 10 });

    expect(result).toMatchObject({ purged: 1, failed: 0, dryRun: false });
    expect(result.items[0]).toMatchObject({
      workId: expired.workId,
      status: 'completed',
      counts: expect.objectContaining({
        branches: 1,
        chapters: 1,
        chapterVersions: 1,
        mapImages: 3,
        exportJobs: 3,
      }),
      objectCleanup: {
        status: 'completed',
        total: 6,
        deleted: 2,
        referenced: 4,
        failed: 0,
      },
    });
    expect(removeObject.mock.calls).toEqual(
      expect.arrayContaining([
        [userId, mapUniqueKey],
        [userId, exportUniqueKey],
      ]),
    );
    expect(removeObject).toHaveBeenCalledTimes(2);

    const remainingWorks = await pool.query<{ id: string }>(
      'select id from works where id = any($1::uuid[]) order by id',
      [[expired.workId, live.workId]],
    );
    expect(remainingWorks.rows).toEqual([{ id: live.workId }]);
    const cascaded = await pool.query<{
      branches: string;
      chapters: string;
      versions: string;
      maps: string;
      exports: string;
    }>(
      `select
         (select count(*) from work_branches where work_id = $1)::text as branches,
         (select count(*) from chapters where work_id = $1)::text as chapters,
         (select count(*) from chapter_versions cv join chapters c on c.id = cv.chapter_id
            where c.work_id = $1)::text as versions,
         (select count(*) from map_images where work_id = $1)::text as maps,
         (select count(*) from export_jobs where work_id = $1)::text as exports`,
      [expired.workId],
    );
    expect(cascaded.rows[0]).toEqual({
      branches: '0',
      chapters: '0',
      versions: '0',
      maps: '0',
      exports: '0',
    });
    const liveMap = await pool.query<{ storage_key: string }>(
      'select storage_key from map_images where work_id = $1',
      [live.workId],
    );
    expect(liveMap.rows).toEqual([{ storage_key: mapSharedKey }]);

    const receipt = await pool.query<{
      work_id: string;
      user_id: string;
      title_hash: string;
      status: string;
      summary: {
        objectStorage: {
          status: string;
          total: number;
          deleted: number;
          referenced: number;
          failed: number;
        };
      };
    }>('select * from work_purge_receipts where work_id = $1', [expired.workId]);
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]).toMatchObject({
      user_id: userId,
      status: 'completed',
      summary: {
        objectStorage: {
          status: 'completed',
          total: 6,
          deleted: 2,
          referenced: 4,
          failed: 0,
        },
      },
    });
    expect(receipt.rows[0].title_hash).toMatch(/^[a-f0-9]{64}$/);

    const audit = await pool.query<{ work_id: string | null; action: string }>(
      `select work_id, action from audit_logs
       where user_id = $1 and target_id = $2
       order by created_at desc`,
      [userId, expired.workId],
    );
    expect(audit.rows).toEqual([{ work_id: null, action: 'work_purged' }]);
  });

  it('supports dry runs and enforces the batch limit', async () => {
    const now = new Date('2002-01-02T00:00:00.000Z');
    const first = await seedUserAndWork(pool, now, '批量清理一', 31);
    const userId = first.userId;
    const second = await seedUserAndWork(pool, now, '批量清理二', 32, userId);
    const key = objectKey(userId, first.workId, first.branchId, 'dry-run.webp');
    await seedMapImage(pool, first, userId, key, '演练地图');

    const dryRun = await runner.run({ now, dryRun: true, limit: 1 });
    expect(dryRun).toMatchObject({ dryRun: true, scanned: 1, purged: 0, failed: 0 });
    expect(dryRun.items[0]).toMatchObject({
      workId: second.workId,
      status: 'dry_run',
      objectKeyCount: 0,
    });
    expect(removeObject).not.toHaveBeenCalled();

    const firstRun = await runner.run({ now, limit: 1 });
    expect(firstRun).toMatchObject({ scanned: 1, purged: 1, failed: 0 });
    expect(firstRun.items[0]?.workId).toBe(second.workId);
    const stillPresent = await pool.query<{ id: string }>(
      'select id from works where id = any($1::uuid[]) order by title',
      [[first.workId, second.workId]],
    );
    expect(stillPresent.rows).toEqual([{ id: first.workId }]);

    const receiptCount = await pool.query<{ count: string }>(
      'select count(*) from work_purge_receipts where work_id = $1',
      [first.workId],
    );
    expect(receiptCount.rows[0].count).toBe('0');
  });
});

async function seedUserAndWork(
  pool: ReturnType<typeof createDatabase>['pool'],
  now: Date,
  title: string,
  deletedDaysAgo: number | null,
  existingUserId?: string,
): Promise<{ workId: string; branchId: string; userId: string }> {
  const userId = existingUserId ?? randomUUID();
  if (!existingUserId) {
    await pool.query(
      `insert into users (id, email, password_hash, display_name, status)
       values ($1, $2, 'hash', $3, 'active')`,
      [userId, `work-purge-${userId}@example.com`, `清理作者-${userId.slice(0, 8)}`],
    );
  }
  const deletedAt =
    deletedDaysAgo === null ? null : new Date(now.getTime() - deletedDaysAgo * 86_400_000);
  const work = await pool.query<{ id: string }>(
    `insert into works
       (user_id, title, pen_name, genre_pack, scale, target_platform, deleted_at)
     values ($1, $2, '旧笔名', 'xianxia', 'long', '起点中文网', $3)
     returning id`,
    [userId, `${title}-${randomUUID()}`, deletedAt],
  );
  const workId = work.rows[0].id;
  const branch = await pool.query<{ id: string }>(
    `insert into work_branches (work_id, name, is_main, created_by)
     values ($1, 'main', true, $2)
     returning id`,
    [workId, userId],
  );
  const branchId = branch.rows[0].id;
  const chapter = await pool.query<{ id: string }>(
    `insert into chapters (work_id, branch_id, chapter_number, title, status, word_count)
     values ($1, $2, 1, '第一章', 'writing', 4)
     returning id`,
    [workId, branchId],
  );
  await pool.query(
    `insert into chapter_versions
       (chapter_id, version, content, content_hash, word_count, created_by, source)
     values ($1, 1, '测试正文', 'hash', 4, $2, 'manual')`,
    [chapter.rows[0].id, userId],
  );
  return { workId, branchId, userId };
}

async function seedMapImage(
  pool: ReturnType<typeof createDatabase>['pool'],
  work: { workId: string; branchId: string },
  userId: string,
  storageKey: string,
  name: string,
): Promise<void> {
  const entity = await pool.query<{ id: string }>(
    `insert into entities (work_id, branch_id, name, type)
     values ($1, $2, $3, 'map')
     returning id`,
    [work.workId, work.branchId, `${name}-${randomUUID()}`],
  );
  const [world] = (
    await pool.query<{ id: string }>(
      `select id from map_nodes
       where work_id = $1 and branch_id = $2 and level = 'world'
       limit 1`,
      [work.workId, work.branchId],
    )
  ).rows;
  const node = await pool.query<{ id: string }>(
    `insert into map_nodes (work_id, branch_id, entity_id, parent_node_id, level)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      work.workId,
      work.branchId,
      entity.rows[0].id,
      world?.id ?? null,
      world ? 'location' : 'world',
    ],
  );
  await pool.query(
    `insert into map_images
       (work_id, branch_id, node_id, storage_key, mime_type, width, height, size, created_by)
     values ($1, $2, $3, $4, 'image/webp', 1, 1, 1, $5)`,
    [work.workId, work.branchId, node.rows[0].id, storageKey, userId],
  );
}

async function seedExport(
  pool: ReturnType<typeof createDatabase>['pool'],
  work: { workId: string; branchId: string },
  userId: string,
  fileKey: string,
): Promise<void> {
  await pool.query(
    `insert into export_jobs
       (user_id, work_id, branch_id, format, scope, options, file_key, expires_at)
     values ($1, $2, $3, 'txt', '{}'::jsonb, '{}'::jsonb, $4, $5)`,
    [userId, work.workId, work.branchId, fileKey, new Date('2100-01-01T00:00:00.000Z')],
  );
}

function objectKey(userId: string, ...segments: string[]): string {
  return [userId, ...segments].join('/');
}
