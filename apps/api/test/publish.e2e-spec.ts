import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(): string {
  return `publish-${randomUUID()}@example.com`;
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

async function seedPublishBook(
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
    hook = '',
  ) => {
    const result = await database.pool.query<{ id: string }>(
      `insert into chapter_outlines
         (work_id, branch_id, level, parent_id, order_index, title, summary, details,
          chapter_number, chapter_goal, chapter_end_hook)
       values ($1, $2, $3, $4, 0, $5, '', '', $6, '', $7)
       returning id`,
      [
        workId,
        branchId,
        level,
        parentKey ? outlineIds[parentKey] : null,
        title,
        chapterNumber,
        hook,
      ],
    );
    outlineIds[key] = result.rows[0].id;
  };

  await insertOutline('book', 'book', null, '天门残卷', null);
  await insertOutline('volume-1', 'volume', 'book', '第一卷 天门初开', null);
  await insertOutline('act-1', 'act', 'volume-1', '第一幕 断碑雨夜', null);
  await insertOutline(
    'chapter-1',
    'chapter',
    'act-1',
    '第1章 断碑',
    1,
    '黑暗里有人叫出了母亲的名字。',
  );
  await insertOutline(
    'chapter-2',
    'chapter',
    'act-1',
    '第2章 旧城门',
    2,
    '陌生人袖口露出焚毁的家纹。',
  );
  await insertOutline('chapter-3', 'chapter', 'act-1', '第3章 剑鸣', 3, '残剑在雨里叫出了第二声。');

  const contents: Array<{ chapterNumber: number; title: string; content: string; source: string }> =
    [
      { chapterNumber: 1, title: '断碑', content: '沈砚听见剑鸣。', source: 'generated' },
      { chapterNumber: 2, title: '旧城门', content: '城门下站着一个陌生人。', source: 'manual' },
      { chapterNumber: 3, title: '剑鸣', content: '残剑在雨里醒来。', source: 'manual' },
    ];
  for (const chapterData of contents) {
    const chapter = await database.pool.query<{ id: string }>(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, word_count, hook)
       values ($1, $2, $3, $4, 'writing', $5, '')
       returning id`,
      [workId, branchId, chapterData.chapterNumber, chapterData.title, chapterData.content.length],
    );
    const version = await database.pool.query<{ id: string }>(
      `insert into chapter_versions
         (chapter_id, version, content, content_hash, word_count, created_by, source)
       values ($1, 1, $2, md5($2), $3, $4, $5)
       returning id`,
      [
        chapter.rows[0].id,
        chapterData.content,
        chapterData.content.length,
        userId,
        chapterData.source,
      ],
    );
    await database.pool.query(`update chapters set current_version_id = $2 where id = $1`, [
      chapter.rows[0].id,
      version.rows[0].id,
    ]);
  }

  await database.pool.query(
    `insert into story_bibles
       (work_id, branch_id, one_sentence_story, protagonist, world_iron_law, cards)
     values ($1, $2, $3, $4, $5, '[]'::jsonb)`,
    [
      workId,
      branchId,
      '沈砚以记忆为代价追查母亲失踪的真相。',
      '沈砚',
      '每次借剑都会失去一段记忆。',
    ],
  );
}

function publishPath(workId: string, branchId: string, suffix: string): string {
  return `/api/v1/works/${workId}/branches/${branchId}/publish/${suffix}`;
}

describe('publish assistance API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AI_PROVIDER = 'fake';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/14';
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

  it('generates book title, synopsis, tag, and chapter-title suggestions with the fake model', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedPublishBook(app, work.id, work.mainBranchId, author.userId);
    await author.agent
      .post('/api/v1/model-configs')
      .send({
        name: '发布辅助模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: 'publish-key',
        purpose: 'planning',
      })
      .expect(201);

    const response = await author.agent
      .post(publishPath(work.id, work.mainBranchId, 'suggestions'))
      .send({})
      .expect(201);

    expect(response.body.titles).toHaveLength(3);
    expect(response.body.synopsis).toContain('沈砚');
    expect(response.body.tags).toEqual(expect.arrayContaining(['仙侠', '成长', '悬疑']));
    expect(response.body.chapterTitles).toEqual([
      { chapterNumber: 1, title: '断碑夜雨' },
      { chapterNumber: 2, title: '城门来客' },
      { chapterNumber: 3, title: '残剑初鸣' },
    ]);
  });

  it('serves a reader preview with the first three chapters and no upload path', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedPublishBook(app, work.id, work.mainBranchId, author.userId);

    const response = await author.agent
      .get(publishPath(work.id, work.mainBranchId, 'preview'))
      .expect(200);

    expect(response.body).toMatchObject({
      title: '天门残卷',
      penName: '青云客',
      genreLabel: '仙侠',
      synopsis: '沈砚以记忆为代价追查母亲失踪的真相。',
      exportOnly: true,
    });
    expect(response.body.tags).toEqual(expect.arrayContaining(['仙侠']));
    expect(response.body.chapters).toHaveLength(3);
    expect(response.body.chapters[0]).toEqual({
      chapterNumber: 1,
      title: '断碑',
      content: '沈砚听见剑鸣。',
    });
  });

  it('uses work-level synopsis, tags, and cover in the reader preview', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedPublishBook(app, work.id, work.mainBranchId, author.userId);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    await author.agent
      .patch(`/api/v1/works/${work.id}`)
      .send({
        synopsis: '边城剑客用一段段记忆换回天门后的真相。',
        tags: ['记忆代价', '边城', '群像'],
      })
      .expect(200);
    await author.agent
      .post(`/api/v1/works/${work.id}/cover`)
      .attach('cover', png, { filename: 'cover.png', contentType: 'image/png' })
      .expect(201);

    const response = await author.agent
      .get(publishPath(work.id, work.mainBranchId, 'preview'))
      .expect(200);

    expect(response.body).toMatchObject({
      synopsis: '边城剑客用一段段记忆换回天门后的真相。',
      coverUrl: expect.stringMatching(
        new RegExp(`^/api/v1/works/${work.id}/cover/content\\?v=\\d+$`),
      ),
    });
    expect(response.body.tags).toEqual(
      expect.arrayContaining(['仙侠', '记忆代价', '边城', '群像']),
    );
  });

  it('runs every publish check and returns a copyable report', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedPublishBook(app, work.id, work.mainBranchId, author.userId);

    const response = await author.agent
      .post(publishPath(work.id, work.mainBranchId, 'check'))
      .send({ format: 'epub' })
      .expect(201);

    expect(response.body.generatedAt).toEqual(expect.any(String));
    expect(response.body.checks.map((check: { key: string }) => check.key)).toEqual([
      'first_three_hooks',
      'chapter_word_counts',
      'sensitive_content',
      'ai_content_label',
      'copyright',
      'export_format',
    ]);
    expect(response.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'first_three_hooks', status: 'pass' }),
        expect.objectContaining({ key: 'chapter_word_counts', status: 'review' }),
        expect.objectContaining({ key: 'ai_content_label', status: 'review' }),
        expect.objectContaining({ key: 'export_format', status: 'pass' }),
      ]),
    );
    expect(response.body.report).toContain('# 天门残卷 · 发布检查');
    expect(response.body.report).toContain('V1 只导出文件，不会连接或上传到发布平台');
  });

  it('hides another author’s work from every publish assistance route', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedPublishBook(app, work.id, work.mainBranchId, author.userId);

    await otherAuthor.agent
      .get(publishPath(work.id, work.mainBranchId, 'preview'))
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .post(publishPath(work.id, work.mainBranchId, 'check'))
      .send({ format: 'txt' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .post(publishPath(work.id, work.mainBranchId, 'suggestions'))
      .send({})
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
  });

  it('asks for a planning model before generating suggestions', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedPublishBook(app, work.id, work.mainBranchId, author.userId);

    await author.agent
      .post(publishPath(work.id, work.mainBranchId, 'suggestions'))
      .send({})
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('MODEL_CONFIG_REQUIRED');
        expect(body.message).toContain('模型设置');
      });
  });
});
