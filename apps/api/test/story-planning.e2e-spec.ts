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
  return `story-planning-${randomUUID()}@example.com`;
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
    userId: login.body.id as string,
  };
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

async function createParallelBranch(
  app: INestApplication,
  workId: string,
  userId: string,
  name: string,
): Promise<string> {
  const result = await app.get(DatabaseService).pool.query<{ id: string }>(
    `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, $2, false, 'active', $3)
       returning id`,
    [workId, name, userId],
  );
  return result.rows[0].id;
}

function storyBiblePayload(overrides: Record<string, unknown> = {}) {
  return {
    oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
    protagonist: '沈砚，外冷内热的边城剑客',
    worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
    ...overrides,
  };
}

function chapterOutlinePayload(overrides: Record<string, unknown> = {}) {
  return {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
    ...overrides,
  };
}

describe('story planning API', () => {
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

  it('requires a signed-in author', async () => {
    const workId = randomUUID();
    const branchId = randomUUID();

    await request(app.getHttpServer())
      .get(`/api/v1/works/${workId}/branches/${branchId}/story-bible`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .put(`/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/1`)
      .send(chapterOutlinePayload())
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('saves and reloads a story bible by work and branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const firstWork = await createWork(author.agent, '天门残卷');
    const secondWork = await createWork(author.agent, '雾海孤灯');
    const firstParallelBranch = await createParallelBranch(
      app,
      firstWork.id,
      author.userId,
      'another-ending',
    );

    await author.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: null,
          workId: firstWork.id,
          branchId: firstWork.mainBranchId,
          oneSentenceStory: '',
          protagonist: '',
          worldIronLaw: '',
          createdAt: null,
          updatedAt: null,
        });
      });

    const firstBible = storyBiblePayload();
    const parallelBible = storyBiblePayload({
      oneSentenceStory: '沈砚发现守住天门，才是真正打开天门。',
      protagonist: '沈砚，已经失去全部记忆的守门人',
      worldIronLaw: '每守住一次天门，人间就忘记一个名字。',
    });
    const secondWorkBible = storyBiblePayload({
      oneSentenceStory: '盲眼船娘循着灯火，驶向没有归途的雾海。',
      protagonist: '阿灯，能听见海底灯火的船娘',
      worldIronLaw: '雾海里每盏灯都对应一个尚未归来的人。',
    });

    const saved = await author.agent
      .put(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .send(firstBible)
      .expect(200);
    expect(saved.body).toMatchObject({
      workId: firstWork.id,
      branchId: firstWork.mainBranchId,
      ...firstBible,
    });

    await author.agent
      .put(`/api/v1/works/${firstWork.id}/branches/${firstParallelBranch}/story-bible`)
      .send(parallelBible)
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${secondWork.id}/branches/${secondWork.mainBranchId}/story-bible`)
      .send(secondWorkBible)
      .expect(200);

    await author.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(firstBible);
      });
    await author.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstParallelBranch}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(parallelBible);
      });
    await author.agent
      .get(`/api/v1/works/${secondWork.id}/branches/${secondWork.mainBranchId}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(secondWorkBible);
      });

    await otherAuthor.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .put(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .send(storyBiblePayload({ oneSentenceStory: '不该保存' }))
      .expect(404);
  });

  it('saves and reloads a chapter outline by work, branch, and chapter', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const parallelBranch = await createParallelBranch(app, work.id, author.userId, 'what-if');

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: null,
          workId: work.id,
          branchId: work.mainBranchId,
          chapterNumber: 1,
          chapterGoal: '',
          pov: '',
          sceneBeats: [],
          chapterEndHook: '',
          createdAt: null,
          updatedAt: null,
        });
      });

    const outline = chapterOutlinePayload();
    const parallelOutline = chapterOutlinePayload({
      chapterGoal: '沈砚在断碑前拒绝残剑认主。',
      pov: '守碑人',
      sceneBeats: ['守碑人拦住沈砚', '残剑发出第二次剑鸣'],
      chapterEndHook: '断碑背后的门，自己开了一道缝。',
    });
    const secondChapter = chapterOutlinePayload({
      chapterGoal: '沈砚带着残剑回到边城。',
      pov: '沈砚',
      sceneBeats: ['边城戒严', '旧友认不出沈砚'],
      chapterEndHook: '城门口贴着他的通缉令。',
    });

    const saved = await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(outline)
      .expect(200);
    expect(saved.body).toMatchObject({
      workId: work.id,
      branchId: work.mainBranchId,
      chapterNumber: 1,
      ...outline,
    });

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${parallelBranch}/chapter-outlines/1`)
      .send(parallelOutline)
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/2`)
      .send(secondChapter)
      .expect(200);

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(outline);
        expect(body.sceneBeats).toEqual(outline.sceneBeats);
      });
    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranch}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(parallelOutline);
      });
    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/2`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(secondChapter);
      });
  });

  it('rejects incomplete planning details', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`)
      .send(storyBiblePayload({ oneSentenceStory: '   ' }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(chapterOutlinePayload({ sceneBeats: [] }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });
  });
});
