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

const CHAPTER_COUNT = 1_000;
const CHAPTER_TARGET_CHARACTERS = 3_000;
const SEARCH_MARKER = '唯一回响标记';

function uniqueEmail(): string {
  return `performance-${randomUUID()}@example.com`;
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

  return {
    agent,
    email,
    userId: login.body.id as string,
  };
}

async function createWork(
  agent: ReturnType<typeof request.agent>,
  title: string,
): Promise<{ id: string; mainBranchId: string }> {
  const response = await agent
    .post('/api/v1/works')
    .send({
      title,
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'epic',
      targetPlatform: '起点中文网',
    })
    .expect(201);

  return {
    id: response.body.id as string,
    mainBranchId: response.body.mainBranch.id as string,
  };
}

async function seedLargeWork(
  app: INestApplication,
  userId: string,
  workId: string,
  branchId: string,
): Promise<void> {
  const database = app.get(DatabaseService);
  await database.withUserContext(userId, async () => {
    await database.db.execute(`
      insert into chapter_outlines (
        work_id, branch_id, level, order_index, title, summary, details,
        chapter_number, chapter_goal, pov, scene_beats, chapter_end_hook
      )
      select
        '${workId}'::uuid,
        '${branchId}'::uuid,
        'chapter',
        n,
        '第 ' || n || ' 章',
        '第 ' || n || ' 章摘要',
        '',
        n,
        '第 ' || n || ' 章目标',
        '沈砚',
        '["进入荒寺", "发现断碑"]'::jsonb,
        '第 ' || n || ' 章钩子'
      from generate_series(1, ${CHAPTER_COUNT}) as n
    `);

    await database.db.execute(`
      insert into chapters (
        work_id, branch_id, chapter_number, title, status, word_count, summary, hook
      )
      select
        '${workId}'::uuid,
        '${branchId}'::uuid,
        n,
        '第 ' || n || ' 章',
        case when n <= 30 then 'locked'::chapter_status else 'writing'::chapter_status end,
        ${CHAPTER_TARGET_CHARACTERS},
        '第 ' || n || ' 章摘要',
        '第 ' || n || ' 章钩子'
      from generate_series(1, ${CHAPTER_COUNT}) as n
    `);

    await database.db.execute(`
      insert into chapter_versions (
        chapter_id, version, content, content_hash, word_count, created_by, source
      )
      select
        c.id,
        1,
        case when c.chapter_number = 777 then '${SEARCH_MARKER}。' else '' end ||
          repeat('沈砚走进荒寺，断碑上刻着旧名。', ${Math.ceil(
            CHAPTER_TARGET_CHARACTERS / 14,
          )}),
        md5(c.id::text || ':1'),
        ${CHAPTER_TARGET_CHARACTERS},
        '${userId}'::uuid,
        'manual'
      from chapters c
      where c.work_id = '${workId}'::uuid
        and c.branch_id = '${branchId}'::uuid
    `);

    await database.db.execute(`
      update chapters c
      set current_version_id = v.id
      from chapter_versions v
      where v.chapter_id = c.id
        and v.version = 1
        and c.work_id = '${workId}'::uuid
        and c.branch_id = '${branchId}'::uuid
    `);
  });
}

describe('performance scale API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/10';
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

  it('searches settings, outlines, and chapter text with qualified results', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '断碑回响');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    await author.agent
      .put(`${base}/chapter-outlines/1`)
      .send({
        chapterGoal: '沈砚在荒寺断碑前查清旧案。',
        pov: '沈砚',
        sceneBeats: ['踏入荒寺', '辨认断碑'],
        chapterEndHook: '山门外的脚步声越来越近。',
      })
      .expect(200);

    await author.agent
      .post(`${base}/entities`)
      .send({
        name: '沈砚',
        aliases: ['断碑客'],
        type: 'character',
        subtype: '',
        summary: '在荒寺断碑前追查旧案的年轻剑客。',
        description: '左手留有旧伤。',
        tags: ['主角'],
        scope: 'work',
        status: 'locked',
        customFields: {},
      })
      .expect(201);

    await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '沈砚按住断碑。山门外的脚步声停在雨里。' })
      .expect(201);

    await author.agent
      .get(`${base}/search`)
      .query({ q: '断碑' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.query).toBe('断碑');
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'setting',
              title: '沈砚',
              snippet: expect.stringContaining('断碑'),
            }),
            expect.objectContaining({
              type: 'outline',
              chapterNumber: 1,
              snippet: expect.stringContaining('断碑'),
            }),
          ]),
        );
      });

    await author.agent
      .get(`${base}/search`)
      .query({ q: '脚步声' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'chapter',
              chapterNumber: 1,
              title: '第 1 章',
              snippet: expect.stringContaining('脚步声'),
            }),
          ]),
        );
      });

    await author.agent.get(`${base}/search`).query({ q: '   ' }).expect(400);
  });

  it('keeps chapter opening bounded when a chapter has a long version history', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '长版本史');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    await author.agent
      .put(`${base}/chapter-outlines/1`)
      .send({
        chapterGoal: '沈砚在荒寺断碑前查清旧案。',
        pov: '沈砚',
        sceneBeats: ['踏入荒寺'],
        chapterEndHook: '山门外传来脚步声。',
      })
      .expect(200);

    for (let version = 1; version <= 55; version += 1) {
      await author.agent
        .post(`${base}/chapters/1/versions`)
        .send({ content: `第 ${version} 版正文。` })
        .expect(201);
    }

    await author.agent
      .get(`${base}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.versionCount).toBe(55);
        expect(body.versions).toHaveLength(50);
        expect(body.versions[0]).toMatchObject({ version: 55 });
        expect(body.versions.at(-1)).toMatchObject({ version: 6 });
        expect(body.currentVersion).toMatchObject({
          version: 55,
          content: '第 55 版正文。',
        });
      });
  });

  it('opens and searches a three-million-character, one-thousand-chapter work', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '三百万字长篇');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    await seedLargeWork(app, author.userId, work.id, work.mainBranchId);

    const startOpen = performance.now();
    await author.agent
      .get(`${base}/chapters`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(CHAPTER_COUNT);
        expect(body.items[776]).toMatchObject({
          chapterNumber: 777,
          wordCount: CHAPTER_TARGET_CHARACTERS,
        });
        expect(body.items[0]).not.toHaveProperty('content');
      });
    const openMs = performance.now() - startOpen;
    expect(openMs).toBeLessThan(1_000);

    await author.agent
      .get(`${base}/chapters/777`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.chapterNumber).toBe(777);
        expect(body.content).toContain(SEARCH_MARKER);
        expect(body.versions).toHaveLength(1);
        expect(body.versions[0].content).toContain(SEARCH_MARKER);
      });

    const startSearch = performance.now();
    await author.agent
      .get(`${base}/search`)
      .query({ q: SEARCH_MARKER })
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'chapter',
              chapterNumber: 777,
              snippet: expect.stringContaining(SEARCH_MARKER),
            }),
          ]),
        );
      });
    const searchMs = performance.now() - startSearch;
    expect(searchMs).toBeLessThan(1_000);

    await otherAuthor.agent.get(`${base}/search`).query({ q: SEARCH_MARKER }).expect(404);
  });
});
