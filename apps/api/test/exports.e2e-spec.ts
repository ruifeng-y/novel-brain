import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(): string {
  return `exports-${randomUUID()}@example.com`;
}

async function clearAuthRateLimits(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService).client;
  const keys = await redis.keys('auth:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

async function createAuthor(app: INestApplication, passwordHash: string) {
  const email = uniqueEmail();
  const password = 'correct horse battery staple';
  const agent = request.agent(app.getHttpServer());

  await clearAuthRateLimits(app);
  await app
    .get(DatabaseService)
    .db.insert(usersTable)
    .values({
      email,
      passwordHash,
      displayName: email.slice(0, email.indexOf('@')),
    });
  const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return { agent, userId: login.body.id as string };
}

async function createWork(agent: ReturnType<typeof request.agent>, title: string) {
  const response = await agent
    .post('/api/v1/works')
    .send({
      title,
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'long',
      targetPlatform: '起点中文网',
    })
    .expect(201);
  return {
    id: response.body.id as string,
    mainBranchId: response.body.mainBranch.id as string,
  };
}

async function seedExportBook(
  app: INestApplication,
  workId: string,
  branchId: string,
  userId: string,
) {
  const database = app.get(DatabaseService);
  const outlineIds: Record<string, string> = {};
  const insertOutline = async (
    key: string,
    level: string,
    parentKey: string | null,
    title: string,
    chapterNumber: number | null,
    content?: string,
  ) => {
    const result = await database.pool.query<{ id: string }>(
      `insert into chapter_outlines
         (work_id, branch_id, level, parent_id, order_index, title, summary, details,
          chapter_number, chapter_goal)
       values ($1, $2, $3, $4, 0, $5, '', '', $6, '')
       returning id`,
      [workId, branchId, level, parentKey ? outlineIds[parentKey] : null, title, chapterNumber],
    );
    outlineIds[key] = result.rows[0].id;
    if (level === 'chapter' && chapterNumber !== null && content) {
      const chapter = await database.pool.query<{ id: string }>(
        `insert into chapters
           (work_id, branch_id, chapter_number, title, status, word_count)
         values ($1, $2, $3, $4, 'writing', $5)
         returning id`,
        [workId, branchId, chapterNumber, title.replace(/^第.+?章\s*/, ''), content.length],
      );
      const version = await database.pool.query<{ id: string }>(
        `insert into chapter_versions
           (chapter_id, version, content, content_hash, word_count, created_by, source)
         values ($1, 1, $2, md5($2), $3, $4, 'manual')
         returning id`,
        [chapter.rows[0].id, content, content.length, userId],
      );
      await database.pool.query(`update chapters set current_version_id = $2 where id = $1`, [
        chapter.rows[0].id,
        version.rows[0].id,
      ]);
    }
  };

  await insertOutline('book', 'book', null, '天门残卷', null);
  await insertOutline('volume-1', 'volume', 'book', '第一卷 天门初开', null);
  await insertOutline('act-1', 'act', 'volume-1', '第一幕 断碑雨夜', null);
  await insertOutline('chapter-1', 'chapter', 'act-1', '第1章 断碑', 1, '沈砚听见剑鸣。');
  await insertOutline('chapter-2', 'chapter', 'act-1', '第2章 旧城门', 2, '城门下站着一个陌生人。');
  await insertOutline('chapter-3', 'chapter', 'act-1', '第3章 剑鸣', 3, '残剑在雨里醒来。');
  await insertOutline('volume-2', 'volume', 'book', '第二卷 山海来客', null);
  await insertOutline('act-2', 'act', 'volume-2', '第二幕 远客', null);
  await insertOutline('chapter-4', 'chapter', 'act-2', '第4章 来客', 4, '陌生人递来一封旧信。');
  await insertOutline('chapter-5', 'chapter', 'act-2', '第5章 旧信', 5, '信上只有母亲的名字。');

  return { volumeId: outlineIds['volume-1'] };
}

async function appendChapters(
  app: INestApplication,
  workId: string,
  branchId: string,
  userId: string,
  from: number,
  to: number,
) {
  const database = app.get(DatabaseService);
  const act = await database.pool.query<{ id: string }>(
    `select id from chapter_outlines
     where work_id = $1 and branch_id = $2 and level = 'act'
     order by order_index limit 1`,
    [workId, branchId],
  );
  for (let chapterNumber = from; chapterNumber <= to; chapterNumber += 1) {
    const title = `第${chapterNumber}章 远行`;
    const content = `第 ${chapterNumber} 章正文。`;
    await database.pool.query(
      `insert into chapter_outlines
         (work_id, branch_id, level, parent_id, order_index, title, summary, details,
          chapter_number, chapter_goal)
       values ($1, $2, 'chapter', $3, $4, $5, '', '', $6, '')`,
      [workId, branchId, act.rows[0].id, chapterNumber, title, chapterNumber],
    );
    const chapter = await database.pool.query<{ id: string }>(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, word_count)
       values ($1, $2, $3, $4, 'writing', $5)
       returning id`,
      [workId, branchId, chapterNumber, title, content.length],
    );
    const version = await database.pool.query<{ id: string }>(
      `insert into chapter_versions
         (chapter_id, version, content, content_hash, word_count, created_by, source)
       values ($1, 1, $2, md5($2), $3, $4, 'manual')
       returning id`,
      [chapter.rows[0].id, content, content.length, userId],
    );
    await database.pool.query(`update chapters set current_version_id = $2 where id = $1`, [
      chapter.rows[0].id,
      version.rows[0].id,
    ]);
  }
}

const binaryParser = (
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('export API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-16-characters';
    process.env.MODEL_KEY_ENCRYPTION_KEY =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    passwordHash = await hash('correct horse battery staple', {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const connection = createDatabase(process.env.DATABASE_URL);
    await migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), 'packages/db/migrations'),
    });
    await connection.pool.end();

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    const redis = app.get(RedisService).client;
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => redis.once('ready', resolve));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearAuthRateLimits(app);
  });

  it('previews table of contents and every supported range', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const { volumeId } = await seedExportBook(app, work.id, work.mainBranchId, author.userId);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const preview = await author.agent
      .post(`${base}/exports/preview`)
      .send({
        format: 'markdown',
        preset: 'generic',
        scope: { type: 'book' },
      })
      .expect(201);

    expect(preview.body.chapterCount).toBe(5);
    expect(preview.body.tableOfContents).toEqual([
      expect.objectContaining({ volumeTitle: '第一卷 天门初开' }),
      expect.objectContaining({ volumeTitle: '第二卷 山海来客' }),
    ]);
    expect(preview.body.chapters).toHaveLength(3);
    expect(preview.body.sample).toContain('第 1 章 断碑');

    const scopes = [
      [{ type: 'chapter', chapterNumber: 2 }, 1],
      [{ type: 'chapters', chapterNumbers: [4, 1, 3] }, 3],
      [{ type: 'range', startChapter: 2, endChapter: 4 }, 3],
      [{ type: 'volume', volumeId }, 3],
      [{ type: 'book' }, 5],
    ] as const;
    for (const [scope, chapterCount] of scopes) {
      const response = await author.agent
        .post(`${base}/exports/preview`)
        .send({ format: 'txt', scope, options: { preset: 'generic' } })
        .expect(201);
      expect(response.body.chapterCount).toBe(chapterCount);
    }
  });

  it('renders TXT, Markdown, DOCX, and EPUB with the selected preset', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedExportBook(app, work.id, work.mainBranchId, author.userId);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    for (const format of ['txt', 'markdown'] as const) {
      const created = await author.agent
        .post(`${base}/exports`)
        .send({
          format,
          scope: { type: 'chapter', chapterNumber: 1 },
          options: { preset: 'qidian' },
        })
        .expect(202);
      expect(created.body.status).toBe('completed');
      const downloaded = await author.agent
        .get(`${base}/exports/${created.body.id}/download`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(downloaded.body.toString('utf8')).toContain(
        format === 'txt' ? '第1章 断碑' : '### 第1章 断碑',
      );
    }

    for (const format of ['docx', 'epub'] as const) {
      const created = await author.agent
        .post(`${base}/exports`)
        .send({
          format,
          scope: { type: 'book' },
          options: { preset: 'fanqie' },
        })
        .expect(202);
      const downloaded = await author.agent
        .get(`${base}/exports/${created.body.id}/download`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      const archive = await JSZip.loadAsync(downloaded.body);
      expect(
        format === 'docx' ? archive.file('word/document.xml') : archive.file('OEBPS/content.opf'),
      ).not.toBeNull();
    }
  });

  it('keeps seven-day history and blocks expired downloads', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedExportBook(app, work.id, work.mainBranchId, author.userId);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const created = await author.agent
      .post(`${base}/exports`)
      .send({ format: 'txt', scope: { type: 'book' } })
      .expect(202);

    const history = await author.agent.get(`${base}/exports`).expect(200);
    expect(history.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        status: 'completed',
        formatLabel: 'TXT',
        presetLabel: '通用网文',
      }),
    ]);
    const expiresAt = new Date(created.body.expiresAt).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1_000);

    await app
      .get(DatabaseService)
      .pool.query(`update export_jobs set expires_at = now() - interval '1 second' where id = $1`, [
        created.body.id,
      ]);
    await author.agent
      .get(`${base}/exports/${created.body.id}/download`)
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('EXPORT_EXPIRED');
      });
  });

  it('issues short-lived signed download links that work without a session and reject tampering', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedExportBook(app, work.id, work.mainBranchId, author.userId);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    await author.agent
      .post(`${base}/exports`)
      .send({ format: 'txt', scope: { type: 'chapter', chapterNumber: 1 } })
      .expect(202);

    const history = await author.agent.get(`${base}/exports`).expect(200);
    const downloadUrl = history.body.items[0].downloadUrl as string;
    expect(downloadUrl).toMatch(/^\/api\/v1\/downloads\/[A-Za-z0-9._~-]+$/);

    const downloaded = await request(app.getHttpServer())
      .get(downloadUrl)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(downloaded.headers['cache-control']).toBe('no-store');
    expect(downloaded.body.toString('utf8')).toContain('沈砚听见剑鸣。');

    const tampered = `${downloadUrl.slice(0, -1)}${downloadUrl.endsWith('A') ? 'B' : 'A'}`;
    await request(app.getHttpServer())
      .get(tampered)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('DOWNLOAD_LINK_INVALID');
      });
  });

  it('hands a large export to the background queue', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '长篇天门残卷');
    await seedExportBook(app, work.id, work.mainBranchId, author.userId);
    await appendChapters(app, work.id, work.mainBranchId, author.userId, 6, 24);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    const created = await author.agent
      .post(`${base}/exports`)
      .send({ format: 'epub', scope: { type: 'book' } })
      .expect(202);
    expect(created.body).toMatchObject({
      status: 'queued',
      progress: 0,
      chapterCount: 24,
      downloadUrl: null,
    });
    const history = await author.agent.get(`${base}/exports`).expect(200);
    expect(history.body.items[0]).toMatchObject({
      id: created.body.id,
      status: 'queued',
      scopeLabel: '全本',
    });
  });

  it('exports a specified branch and hides every export from other authors', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedExportBook(app, work.id, work.mainBranchId, author.userId);
    const branch = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: 'current',
        name: '母亲回音的另一版',
        reason: '导出这个分支看看。',
        kind: 'alternate_ending',
      })
      .expect(201);
    const base = `/api/v1/works/${work.id}/branches/${branch.body.id}`;
    const preview = await author.agent
      .post(`${base}/exports/preview`)
      .send({ format: 'epub', scope: { type: 'book' } })
      .expect(201);
    expect(preview.body.chapterCount).toBe(5);

    const created = await author.agent
      .post(`${base}/exports`)
      .send({ format: 'txt', scope: { type: 'book' } })
      .expect(202);
    await otherAuthor.agent
      .get(`${base}/exports/${created.body.id}/download`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
  });
});
