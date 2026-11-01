import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { AI_GATEWAY, FakeAiGateway } from '@novel/ai';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(): string {
  return `chapter-generation-${randomUUID()}@example.com`;
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

function chapterOutlinePayload(overrides: Record<string, unknown> = {}) {
  return {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
    ...overrides,
  };
}

describe('chapter generation API', () => {
  let app: INestApplication;
  let workerApp: INestApplication;
  let fakeGateway: FakeAiGateway;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/11';
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
    const queueKeys = await redis.keys('bull:generation:*');
    if (queueKeys.length > 0) {
      await redis.del(...queueKeys);
    }

    fakeGateway = new FakeAiGateway({
      mode: 'chapter',
      chunkSize: 120,
      delayMs: 2,
    });
    const { WorkerModule } = await import('../../worker/src/worker.module');
    const workerRef = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(AI_GATEWAY)
      .useValue(fakeGateway)
      .compile();
    workerApp = workerRef.createNestApplication();
    await workerApp.init();
  });

  afterAll(async () => {
    if (workerApp) {
      await workerApp.close();
    }
    await app.close();
  });

  beforeEach(async () => {
    await clearAuthRateLimits(app);
  });

  it('lists the saved outline chapters and opens one for writing', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const outline = chapterOutlinePayload();

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(outline)
      .expect(200);

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({
            chapterNumber: 1,
            title: '第 1 章',
            goal: outline.chapterGoal,
            status: 'planned',
            wordCount: 0,
            hasContent: false,
          }),
        ]);
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          chapterNumber: 1,
          title: '第 1 章',
          status: 'planned',
          content: '',
          outline,
          currentVersion: null,
          latestDraft: null,
        });
        expect(body.versions).toEqual([]);
      });
  });

  it('generates a chapter through the task pipeline, streams it, and saves a version', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const outline = chapterOutlinePayload();

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`)
      .send({
        oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
        protagonist: '沈砚，外冷内热的边城剑客',
        worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
      })
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(outline)
      .expect(200);
    const modelConfig = await author.agent
      .post('/api/v1/model-configs')
      .send({
        name: '正文模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: 'sk-test-never-used',
        purpose: 'prose',
        isDefault: true,
      })
      .expect(201);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    expect(started.body).toMatchObject({
      chapterNumber: 1,
      generationRequestId: expect.any(String),
      jobId: expect.any(String),
    });

    const job = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'completed',
    );
    expect(job.status).toBe('completed');
    expect(job.modelConfigId).toBe(modelConfig.body.id);
    expect(job.steps.map((step: { key: string }) => step.key)).toEqual([
      'readiness',
      'brief',
      'context',
      'draft',
    ]);
    expect(job.steps.every((step: { status: string }) => step.status === 'succeeded')).toBe(
      true,
    );
    expect(job.context.sections.map((section: { key: string }) => section.key)).toEqual(
      expect.arrayContaining(['storyBible', 'chapterOutline', 'writingGuidance']),
    );
    expect(job.draft.status).toBe('ready');
    expect(job.draft.content.length).toBeGreaterThanOrEqual(2000);
    expect(job.draft.content.length).toBeLessThanOrEqual(3000);

    const chapter = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200);
    expect(chapter.body.latestDraft).toMatchObject({
      jobId: started.body.jobId,
      status: 'ready',
      content: job.draft.content,
    });
    expect(chapter.body.context.sections).toEqual(job.context.sections);

    const sse = await readSse(
      author.agent,
      `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.jobId}/events`,
    );
    expect(sse).toContain('event: job.draft.delta');
    expect(sse).toContain('event: job.completed');
    expect(sse).toContain('"delta"');

    const manualContent = `${job.draft.content}\n\n作者补写的一句。`;
    const saved = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/versions`)
      .send({
        content: manualContent,
      })
      .expect(201);
    expect(saved.body).toMatchObject({
      chapterNumber: 1,
      version: 1,
      source: 'manual',
      wordCount: manualContent.length,
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('writing');
        expect(body.content).toBe(manualContent);
        expect(body.currentVersion).toMatchObject({
          id: saved.body.id,
          version: 1,
        });
        expect(body.versions).toHaveLength(1);
      });
  });

  it('keeps the partial draft and reports a recoverable error when generation fails', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '断碑旧梦');

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`)
      .send({
        oneSentenceStory: '守碑人每忘掉一个名字，天门就向人间近一步。',
        protagonist: '沈砚，守着断碑的年轻剑客',
        worldIronLaw: '残剑每次出鞘，都会带走持剑人的一段记忆。',
      })
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(
        chapterOutlinePayload({
          chapterGoal: '沈砚在断碑前引动残剑。[[FAIL_AFTER_PARTIAL]]',
        }),
      )
      .expect(200);
    await author.agent
      .post('/api/v1/model-configs')
      .send({
        name: '正文模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: 'sk-test-never-used',
        purpose: 'prose',
      })
      .expect(201);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    const job = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'failed',
    );

    expect(job.error).toMatchObject({
      code: 'MODEL_GENERATION_FAILED',
      recoverable: true,
    });
    expect(job.draft.status).toBe('failed');
    expect(job.draft.content.length).toBeGreaterThan(0);
    expect(job.draft.content.length).toBeLessThan(2000);
    expect(job.steps.find((step: { key: string }) => step.key === 'draft')).toMatchObject({
      status: 'failed',
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.latestDraft).toMatchObject({
          status: 'failed',
          content: job.draft.content,
        });
      });
  });
});

async function waitForJob(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  jobId: string,
  expectedStatus: 'completed' | 'failed',
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await agent
      .get(`/api/v1/works/${workId}/branches/${branchId}/jobs/${jobId}`)
      .expect(200);
    if (response.body.status === expectedStatus) {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Job ${jobId} did not reach ${expectedStatus}`);
}

async function readSse(
  agent: ReturnType<typeof request.agent>,
  path: string,
): Promise<string> {
  const response = await agent
    .get(path)
    .buffer(true)
    .parse((res, callback) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
      });
      res.on('end', () => callback(null, text));
    })
    .expect(200);
  return response.body as string;
}
