import { ConfigService } from '@nestjs/config';
import { createDatabase } from '@novel/db';
import { ObjectStorageClient } from '@novel/storage';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { ExportRunner } from './export.runner';

const DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';

describe('background export runner', () => {
  let database: DatabaseService;
  let storage: ObjectStorageService;
  let adminPool: ReturnType<typeof createDatabase>['pool'];

  beforeAll(async () => {
    const config = new ConfigService({
      DATABASE_URL,
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minio',
      MINIO_SECRET_KEY: 'minio123',
      MINIO_BUCKET: 'novel-brain',
    });
    const migrationConnection = createDatabase(DATABASE_URL);
    adminPool = migrationConnection.pool;
    await migrate(migrationConnection.db, {
      migrationsFolder: path.resolve(process.cwd(), 'packages/db/migrations'),
    });
    database = new DatabaseService(config);
    storage = new ObjectStorageService(config);
  });

  afterAll(async () => {
    await database.onModuleDestroy();
    await adminPool.end();
  });

  it('completes a queued large export into seven-day object storage', async () => {
    const userId = randomUUID();
    const workId = randomUUID();
    const branchId = randomUUID();
    const exportId = randomUUID();
    const email = `background-export-${userId}@example.com`;
    await adminPool.query(
      `insert into users (id, email, password_hash, display_name)
       values ($1, $2, 'test-hash', '后台导出作者')`,
      [userId, email],
    );
    await adminPool.query(
      `insert into works
         (id, user_id, title, pen_name, genre_pack, scale, target_platform)
       values ($1, $2, '后台导出书', '青云客', 'xianxia', 'long', '起点中文网')`,
      [workId, userId],
    );
    await adminPool.query(
      `insert into work_branches (id, work_id, name, is_main, created_by)
       values ($1, $2, '主线', true, $3)`,
      [branchId, workId, userId],
    );
    const book = await adminPool.query<{ id: string }>(
      `insert into chapter_outlines
         (work_id, branch_id, level, title, summary, details)
       values ($1, $2, 'book', '后台导出书', '', '')
       returning id`,
      [workId, branchId],
    );
    const volume = await adminPool.query<{ id: string }>(
      `insert into chapter_outlines
         (work_id, branch_id, level, parent_id, title, summary, details)
       values ($1, $2, 'volume', $3, '第一卷', '', '')
       returning id`,
      [workId, branchId, book.rows[0].id],
    );
    const act = await adminPool.query<{ id: string }>(
      `insert into chapter_outlines
         (work_id, branch_id, level, parent_id, title, summary, details)
       values ($1, $2, 'act', $3, '第一幕', '', '')
       returning id`,
      [workId, branchId, volume.rows[0].id],
    );
    for (const [chapterNumber, title, content] of [
      [1, '断碑', '沈砚听见剑鸣。'],
      [2, '旧城门', '城门下站着一个陌生人。'],
    ] as const) {
      await adminPool.query(
        `insert into chapter_outlines
           (work_id, branch_id, level, parent_id, order_index, title, summary, details,
            chapter_number, chapter_goal)
         values ($1, $2, 'chapter', $3, $4, $5, '', '', $6, '')`,
        [workId, branchId, act.rows[0].id, chapterNumber, title, chapterNumber],
      );
      const chapter = await adminPool.query<{ id: string }>(
        `insert into chapters
           (work_id, branch_id, chapter_number, title, status, word_count)
         values ($1, $2, $3, $4, 'writing', $5)
         returning id`,
        [workId, branchId, chapterNumber, title, content.length],
      );
      const version = await adminPool.query<{ id: string }>(
        `insert into chapter_versions
           (chapter_id, version, content, content_hash, word_count, created_by, source)
         values ($1, 1, $2, md5($2), $3, $4, 'manual')
         returning id`,
        [chapter.rows[0].id, content, content.length, userId],
      );
      await adminPool.query(`update chapters set current_version_id = $2 where id = $1`, [
        chapter.rows[0].id,
        version.rows[0].id,
      ]);
    }
    await adminPool.query(
      `insert into export_jobs
         (id, user_id, work_id, branch_id, format, scope, options, status, progress,
          chapter_count, expires_at)
       values ($1, $2, $3, $4, 'epub', '{"type":"book"}'::jsonb,
               '{"preset":"generic","encoding":"utf-8"}'::jsonb, 'queued', 0, 2,
               now() + interval '7 days')`,
      [exportId, userId, workId, branchId],
    );

    const runner = new ExportRunner(database, storage);
    const result = await database.withUserContext(userId, () => runner.run(exportId));
    expect(result).toEqual({ ok: true });

    const completed = await adminPool.query<{
      status: string;
      file_key: string;
      file_size: number;
      chapter_count: number;
      expires_at: Date;
    }>(
      `select status, file_key, file_size, chapter_count, expires_at
       from export_jobs where id = $1`,
      [exportId],
    );
    expect(completed.rows[0]).toMatchObject({
      status: 'completed',
      chapter_count: 2,
    });
    expect(completed.rows[0].file_size).toBeGreaterThan(0);
    expect(completed.rows[0].file_key).toMatch(new RegExp(`^${userId}/${workId}/${branchId}/`));
    expect(completed.rows[0].expires_at.getTime()).toBeGreaterThan(
      Date.now() + 6.9 * 24 * 60 * 60 * 1_000,
    );

    const client = new ObjectStorageClient({
      endpoint: 'http://127.0.0.1:9000',
      accessKey: 'minio',
      secretKey: 'minio123',
      bucket: 'novel-brain',
    });
    const archive = await JSZip.loadAsync(
      await client.getObject(userId, completed.rows[0].file_key),
    );
    expect(archive.file('OEBPS/content.opf')).not.toBeNull();
  });
});
