import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import {
  AI_GATEWAY,
  FakeAiGateway,
  buildDeterministicChineseChapter,
  type GenerateTextInput,
  type StreamTextChunk,
} from '@novel/ai';
import { countCjkCharacters } from '@novel/contracts';
import { createDatabase, jobs as jobsTable, users as usersTable } from '@novel/db';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(): string {
  return `batch-jobs-${randomUUID()}@example.com`;
}

class BlockingFakeAiGateway extends FakeAiGateway {
  started: Promise<void> = Promise.resolve();
  private shouldBlock = false;
  private startedResolve: (() => void) | undefined;
  private releaseGate: Promise<void> = Promise.resolve();
  private releaseResolve: (() => void) | undefined;

  blockNextStream(): void {
    this.shouldBlock = true;
    this.started = new Promise((resolve) => {
      this.startedResolve = resolve;
    });
    this.releaseGate = new Promise((resolve) => {
      this.releaseResolve = resolve;
    });
  }

  release(): void {
    this.releaseResolve?.();
  }

  async *streamText(input: GenerateTextInput): AsyncIterable<StreamTextChunk> {
    if (this.shouldBlock) {
      this.shouldBlock = false;
      this.startedResolve?.();
      await this.releaseGate;
    }
    yield* super.streamText(input);
  }
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

async function prepareWork(
  agent: ReturnType<typeof request.agent>,
  title: string,
  chapterNumbers: number[],
  options: { markers?: Record<number, string> } = {},
) {
  const work = await createWork(agent, title);
  await agent
    .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`)
    .send({
      oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
      protagonist: '沈砚，外冷内热的边城剑客',
      worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
    })
    .expect(200);
  await agent
    .post('/api/v1/model-configs')
    .send({
      name: '批量正文模型',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-test-never-used',
      purpose: 'prose',
      isDefault: true,
    })
    .expect(201);

  const book = await agent
    .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
    .send({
      level: 'book',
      title: '天门残卷',
      summary: '边城少年守住天门。',
    })
    .expect(201);
  const firstVolume = await agent
    .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
    .send({
      level: 'volume',
      parentId: book.body.id,
      title: '第一卷 残碑',
      summary: '沈砚在边城发现残剑。',
    })
    .expect(201);
  const secondVolume = await agent
    .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
    .send({
      level: 'volume',
      parentId: book.body.id,
      title: '第二卷 天门',
      summary: '沈砚踏上守门之路。',
    })
    .expect(201);
  const firstAct = await agent
    .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
    .send({
      level: 'act',
      parentId: firstVolume.body.id,
      title: '第一幕 雨夜',
      summary: '残剑认主。',
    })
    .expect(201);
  const secondAct = await agent
    .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
    .send({
      level: 'act',
      parentId: secondVolume.body.id,
      title: '第一幕 问门',
      summary: '天门开启。',
    })
    .expect(201);

  for (const chapterNumber of chapterNumbers) {
    await agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
      .send({
        level: 'chapter',
        parentId: chapterNumber <= 2 ? firstAct.body.id : secondAct.body.id,
        chapterNumber,
        title: `第 ${chapterNumber} 章`,
        summary: '沈砚追查残碑来历。',
        chapterGoal: `第 ${chapterNumber} 章：沈砚追查残碑，逼近天门真相。${
          options.markers?.[chapterNumber] ?? ''
        }`,
        pov: '沈砚',
        sceneBeats: ['雨夜追踪', '残剑示警', '新的选择'],
        chapterEndHook: '天门后传来一个熟悉的声音。',
      })
      .expect(201);
  }

  return {
    ...work,
    firstVolumeId: firstVolume.body.id as string,
  };
}

function createJob(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  scope: Record<string, unknown>,
) {
  return agent.post(`/api/v1/works/${workId}/branches/${branchId}/jobs`).send({
    scope,
    settings: {
      targetMinCharacters: 1_200,
      targetMaxCharacters: 1_400,
    },
  });
}

async function waitForJob(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  jobId: string,
  expectedStatus: string,
) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const response = await agent
      .get(`/api/v1/works/${workId}/branches/${branchId}/jobs/${jobId}`)
      .expect(200);
    if (response.body.status === expectedStatus) {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  throw new Error(`Batch job ${jobId} did not reach ${expectedStatus}`);
}

async function waitForReviewItem(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  jobId: string,
  chapterNumber: number,
) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const response = await agent
      .get(`/api/v1/works/${workId}/branches/${branchId}/jobs/${jobId}`)
      .expect(200);
    const item = response.body.items.find(
      (candidate: { chapterNumber: number; status: string }) =>
        candidate.chapterNumber === chapterNumber && candidate.status === 'waiting_review',
    );
    if (item) {
      return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  throw new Error(`Chapter ${chapterNumber} did not enter review`);
}

async function waitForCondition(check: () => Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(message);
}

async function generationJobsForChapter(
  app: INestApplication,
  workId: string,
  branchId: string,
  chapterNumber: number,
) {
  const rows = await app
    .get(DatabaseService)
    .db.select()
    .from(jobsTable)
    .where(and(eq(jobsTable.workId, workId), eq(jobsTable.branchId, branchId)));
  return rows.filter(
    (job) => job.type === 'generate_chapter' && Number(job.payload.chapterNumber) === chapterNumber,
  );
}

describe('batch jobs API', () => {
  let app: INestApplication;
  let workerApp: INestApplication;
  let passwordHash: string;
  let gateway: BlockingFakeAiGateway;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const databaseName = 'novel_batch_jobs_test';
    const admin = new Pool({
      connectionString: 'postgres://novel:novel@127.0.0.1:5432/postgres',
    });
    const existing = await admin.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`create database ${databaseName}`);
    }
    await admin.end();
    process.env.DATABASE_URL = `postgres://novel:novel@127.0.0.1:5432/${databaseName}`;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/12';
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
    await connection.pool.query('drop schema if exists drizzle cascade');
    await connection.pool.query('drop schema public cascade');
    await connection.pool.query('create schema public');
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

    gateway = new BlockingFakeAiGateway({
      responseFactory: (input) => {
        const match = input.prompt.match(/目标汉字数：(\d+)\s*到\s*(\d+)/);
        const target = match
          ? Number(match[1]) + Math.floor((Number(match[2]) - Number(match[1])) / 2)
          : 100;
        return buildDeterministicChineseChapter(target);
      },
      chunkSize: 40,
      delayMs: 3,
    });
    const { WorkerModule } = await import('../../worker/src/worker.module');
    const workerRef = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(AI_GATEWAY)
      .useValue(gateway)
      .compile();
    workerApp = workerRef.createNestApplication();
    await workerApp.init();
  });

  afterAll(async () => {
    if (workerApp) {
      await workerApp.close();
    }
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await clearAuthRateLimits(app);
  });

  it('creates batch jobs for one chapter, a volume, a custom range, and the whole book', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await prepareWork(author.agent, '批量范围', [1, 2, 3, 4, 5]);
    const outlineOnly = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters`)
      .expect(200);
    expect(outlineOnly.body.items).toHaveLength(5);
    expect(
      outlineOnly.body.items.every(
        (item: { status: string; hasContent: boolean }) =>
          item.status === 'planned' && item.hasContent === false,
      ),
    ).toBe(true);

    const chapter = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'chapter',
      chapterNumber: 2,
    }).expect(202);
    expect(chapter.body.chapterNumbers).toEqual([2]);

    const volume = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'volume',
      volumeId: work.firstVolumeId,
    }).expect(202);
    expect(volume.body.chapterNumbers).toEqual([1, 2]);

    const range = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'range',
      startChapter: 2,
      endChapter: 4,
    }).expect(202);
    expect(range.body.chapterNumbers).toEqual([2, 3, 4]);

    const book = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'book',
    }).expect(202);
    expect(book.body.chapterNumbers).toEqual([1, 2, 3, 4, 5]);

    for (const jobId of [
      chapter.body.id,
      volume.body.id,
      range.body.id,
      book.body.id,
    ] as string[]) {
      await author.agent
        .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${jobId}/cancel`)
        .send({})
        .expect(201);
    }
  }, 30_000);

  it('keeps a paused batch paused after the in-flight chapter finishes', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await prepareWork(author.agent, '暂停覆盖检查', [1, 2]);
    gateway.blockNextStream();
    const started = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'range',
      startChapter: 1,
      endChapter: 2,
    }).expect(202);

    await gateway.started;
    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/pause`)
      .send({})
      .expect(201);
    gateway.release();

    await waitForCondition(async () => {
      const detail = await author.agent
        .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}`)
        .expect(200);
      const [firstChapter] = await generationJobsForChapter(app, work.id, work.mainBranchId, 1);
      return (
        firstChapter?.status === 'completed' &&
        detail.body.status === 'paused' &&
        detail.body.items[0].status === 'waiting_review' &&
        detail.body.items[1].generationJobId === null
      );
    }, 'Paused batch did not settle after the in-flight chapter');

    expect(await generationJobsForChapter(app, work.id, work.mainBranchId, 2)).toHaveLength(0);
  }, 30_000);

  it('keeps a canceled batch canceled after the in-flight chapter finishes', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await prepareWork(author.agent, '取消覆盖检查', [1, 2]);
    gateway.blockNextStream();
    const started = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'range',
      startChapter: 1,
      endChapter: 2,
    }).expect(202);

    await gateway.started;
    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/cancel`)
      .send({})
      .expect(201);
    gateway.release();

    await waitForCondition(async () => {
      const [firstChapter] = await generationJobsForChapter(app, work.id, work.mainBranchId, 1);
      return firstChapter?.status === 'completed';
    }, 'Canceled in-flight chapter did not finish');

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('canceled');
        expect(body.items.map((item: { status: string }) => item.status)).toEqual([
          'canceled',
          'canceled',
        ]);
      });
    expect(await generationJobsForChapter(app, work.id, work.mainBranchId, 2)).toHaveLength(0);
  }, 30_000);

  it('pauses, resumes, cancels, and retries a failed chapter from its failed step', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await prepareWork(author.agent, '批量控制', [1, 2], {
      markers: { 1: '[[FAIL_AFTER_PARTIAL]]' },
    });

    const started = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'chapter',
      chapterNumber: 1,
    }).expect(202);
    const paused = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/pause`)
      .send({})
      .expect(201);
    expect(paused.body.status).toBe('paused');

    const resumed = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/resume`)
      .send({})
      .expect(201);
    expect(resumed.body.status).toBe('queued');

    const failed = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.id,
      'failed',
    );
    expect(failed.items[0]).toMatchObject({
      chapterNumber: 1,
      status: 'failed',
    });
    const failedGenerationJobId = failed.items[0].generationJobId as string;
    const failedChild = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${failedGenerationJobId}`)
      .expect(200);
    const readinessStartedAt = failedChild.body.steps.find(
      (step: { key: string }) => step.key === 'readiness',
    ).startedAt;
    const contextStartedAt = failedChild.body.steps.find(
      (step: { key: string }) => step.key === 'context',
    ).startedAt;

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send({
        chapterGoal: '第 1 章：沈砚追查残碑，逼近天门真相。',
        pov: '沈砚',
        sceneBeats: ['雨夜追踪', '残剑示警', '新的选择'],
        chapterEndHook: '天门后传来一个熟悉的声音。',
      })
      .expect(200);

    const retried = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/retry`)
      .send({})
      .expect(201);
    expect(retried.body.status).toBe('queued');

    const reviewed = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.id,
      'waiting_review',
    );
    expect(reviewed.items[0]).toMatchObject({
      chapterNumber: 1,
      status: 'waiting_review',
      generationJobId: failedGenerationJobId,
    });
    const retriedChild = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${failedGenerationJobId}`)
      .expect(200);
    expect(
      retriedChild.body.steps.find((step: { key: string }) => step.key === 'readiness').startedAt,
    ).toBe(readinessStartedAt);
    expect(
      retriedChild.body.steps.find((step: { key: string }) => step.key === 'context').startedAt,
    ).toBe(contextStartedAt);

    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/cancel`)
      .send({})
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('canceled');
      });
  }, 30_000);

  it('carries an earlier approved chapter into the next batch chapter context', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await prepareWork(author.agent, '批次上下文', [1, 2]);
    const firstBatch = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'chapter',
      chapterNumber: 1,
    }).expect(202);
    const firstReview = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      firstBatch.body.id,
      'waiting_review',
    );
    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${firstBatch.body.id}/review/${firstReview.items[0].id}`,
      )
      .send({ action: 'approve' })
      .expect(201);

    const secondBatch = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'chapter',
      chapterNumber: 2,
    }).expect(202);
    const secondReview = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      secondBatch.body.id,
      'waiting_review',
    );
    const generationJob = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${secondReview.items[0].generationJobId}`,
      )
      .expect(200);
    expect(generationJob.body.settings.referenceChapters).toContain(1);
    expect(generationJob.body.context.sourceRefs).toContain('chapter:1');
  }, 30_000);

  it('reviews generated chapters and reports completed and failed chapters with usage', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await prepareWork(author.agent, '批量审核', [1, 2, 3, 4], {
      markers: { 4: '[[FAIL_AFTER_PARTIAL]]' },
    });
    const started = await createJob(author.agent, work.id, work.mainBranchId, {
      type: 'book',
    }).expect(202);
    const waiting = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.id,
      'waiting_review',
    );
    expect(
      waiting.items.filter((item: { status: string }) => item.status === 'failed'),
    ).toHaveLength(1);

    const queue = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/review-queue`)
      .expect(200);
    expect(queue.body.items.map((item: { chapterNumber: number }) => item.chapterNumber)).toEqual([
      1, 2, 3,
    ]);

    const first = queue.body.items.find(
      (item: { chapterNumber: number }) => item.chapterNumber === 1,
    );
    const second = queue.body.items.find(
      (item: { chapterNumber: number }) => item.chapterNumber === 2,
    );
    const third = queue.body.items.find(
      (item: { chapterNumber: number }) => item.chapterNumber === 3,
    );

    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/review/${first.id}`,
      )
      .send({ action: 'approve' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.reviewStatus).toBe('approved');
      });
    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/review/${second.id}`,
      )
      .send({ action: 'send_to_desk' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.reviewStatus).toBe('sent_to_desk');
      });
    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/review/${third.id}`,
      )
      .send({ action: 'reject' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.reviewStatus).toBe('rejected');
        expect(body.status).toBe('pending');
      });
    await waitForReviewItem(author.agent, work.id, work.mainBranchId, started.body.id, 3);

    const regeneratedQueue = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/review-queue`)
      .expect(200);
    const regenerated = regeneratedQueue.body.items.find(
      (item: { chapterNumber: number }) => item.chapterNumber === 3,
    );
    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/review/${regenerated.id}`,
      )
      .send({ action: 'ignore', reason: '这一章的问题不影响后续主线。' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.reviewStatus).toBe('ignored');
        expect(body.reviewNote).toBe('这一章的问题不影响后续主线。');
      });

    const approvedChapter = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200);
    expect(approvedChapter.body.status).toBe('locked');
    expect(countCjkCharacters(approvedChapter.body.currentVersion.content)).toBeGreaterThan(0);

    const deskChapter = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2`)
      .expect(200);
    expect(deskChapter.body.status).toBe('writing');
    expect(countCjkCharacters(deskChapter.body.currentVersion.content)).toBeGreaterThan(0);

    const report = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/report`)
      .expect(200);
    expect(report.body).toMatchObject({
      jobId: started.body.id,
      completedChapterNumbers: [1, 2, 3],
      failedChapters: [
        {
          chapterNumber: 4,
          message: expect.any(String),
        },
      ],
    });
    expect(report.body.promptTokens).toBeGreaterThan(0);
    expect(report.body.completionTokens).toBeGreaterThan(0);
    expect(report.body.cost).toBeGreaterThanOrEqual(0);
    expect(report.body.continuity).toMatchObject({
      openIssueCount: expect.any(Number),
      ignoredIssueCount: expect.any(Number),
      summary: expect.any(String),
    });
  }, 30_000);

  it('keeps batch jobs, review items, controls, and reports isolated between authors', async () => {
    const owner = await createAuthor(app, passwordHash);
    const other = await createAuthor(app, passwordHash);
    const work = await prepareWork(owner.agent, '批量隔离', [1]);
    const started = await createJob(owner.agent, work.id, work.mainBranchId, {
      type: 'chapter',
      chapterNumber: 1,
    }).expect(202);
    const waiting = await waitForJob(
      owner.agent,
      work.id,
      work.mainBranchId,
      started.body.id,
      'waiting_review',
    );
    const itemId = waiting.items[0].id as string;

    await other.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs`)
      .expect(404);
    await other.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}`)
      .expect(404);
    await other.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/review/${itemId}`,
      )
      .send({ action: 'approve' })
      .expect(404);
    await other.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/review-queue`)
      .expect(404);
    await other.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.id}/report`)
      .expect(404);
  }, 30_000);
});
