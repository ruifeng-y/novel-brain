import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import {
  AI_GATEWAY,
  FakeAiGateway,
  buildDeterministicChineseChapter,
} from '@novel/ai';
import { countCjkCharacters } from '@novel/contracts';
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

function chapterForPrompt(prompt: string): string {
  const match = prompt.match(/目标汉字数：(\d+)\s*到\s*(\d+)/);
  const target = match
    ? Number(match[1]) + Math.floor((Number(match[2]) - Number(match[1])) / 2)
    : 2_500;
  return buildDeterministicChineseChapter(target);
}

function chapterWithLeftArmConflict(prompt: string): string {
  return [
    '沈砚忍着左臂的疼，缓缓抬起手。他双手结印，借残剑之力压住翻涌的碑文。',
    chapterForPrompt(prompt),
  ].join('\n\n');
}

async function saveStoryBible(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
) {
  await agent
    .put(`/api/v1/works/${workId}/branches/${branchId}/story-bible`)
    .send({
      oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
      protagonist: '沈砚，外冷内热的边城剑客',
      worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
    })
    .expect(200);
}

async function saveOutline(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  chapterNumberOrOverrides: number | Record<string, unknown> = 1,
  overrides: Record<string, unknown> = {},
) {
  const chapterNumber =
    typeof chapterNumberOrOverrides === 'number' ? chapterNumberOrOverrides : 1;
  const payloadOverrides =
    typeof chapterNumberOrOverrides === 'number' ? overrides : chapterNumberOrOverrides;
  await agent
    .put(
      `/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/${chapterNumber}`,
    )
    .send(chapterOutlinePayload(payloadOverrides))
    .expect(200);
}

async function saveProseModel(
  agent: ReturnType<typeof request.agent>,
  name = '正文模型',
) {
  return agent
    .post('/api/v1/model-configs')
    .send({
      name,
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-test-never-used',
      purpose: 'prose',
      isDefault: true,
    })
    .expect(201);
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
      responseFactory: (input) => {
        if (input.prompt.includes('[[ALWAYS_SHORT]]')) {
          return buildDeterministicChineseChapter(500);
        }
        if (input.prompt.includes('[[RETRY_LENGTH]]')) {
          return input.prompt.includes('【篇幅校正】')
            ? chapterForPrompt(input.prompt)
            : buildDeterministicChineseChapter(500);
        }
        if (input.prompt.includes('[[LEFT_ARM_CONFLICT]]')) {
          return chapterWithLeftArmConflict(input.prompt);
        }
        return chapterForPrompt(input.prompt);
      },
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
    expect(job).toMatchObject({
      targetMinCharacters: 2_000,
      targetMaxCharacters: 3_000,
    });
    expect(job.steps.map((step: { key: string }) => step.key)).toEqual([
      'readiness',
      'brief',
      'context',
      'draft',
      'extract_facts',
      'verify',
    ]);
    expect(job.steps.every((step: { status: string }) => step.status === 'succeeded')).toBe(
      true,
    );
    expect(job.context.sections.map((section: { key: string }) => section.key)).toEqual(
      expect.arrayContaining(['storyBible', 'chapterOutline', 'writingGuidance']),
    );
    expect(
      job.context.sections.find(
        (section: { key: string }) => section.key === 'writingGuidance',
      ).content,
    ).toMatchObject({
      targetMinCharacters: 2_000,
      targetMaxCharacters: 3_000,
    });
    expect(job.draft.status).toBe('ready');
    const draftCharacters = countCjkCharacters(job.draft.content);
    expect(draftCharacters).toBeGreaterThanOrEqual(2_000);
    expect(draftCharacters).toBeLessThanOrEqual(3_000);

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
      wordCount: countCjkCharacters(manualContent),
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

  it('extracts event, body-state, and character-knowledge proposals with exact source sentences after generation', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '本章事实');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    const job = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'completed',
    );

    const proposals = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`,
      )
      .expect(200);

    expect(proposals.body.items).toHaveLength(3);
    expect(proposals.body.items.map((item: { type: string }) => item.type)).toEqual(
      expect.arrayContaining(['event', 'body_state', 'character_knowledge']),
    );
    for (const proposal of proposals.body.items as Array<{
      status: string;
      sourceSentence: string;
    }>) {
      expect(proposal.status).toBe('proposed');
      expect(job.draft.content).toContain(proposal.sourceSentence);
    }
  });

  it('lets the author edit or reject fact proposals without adding them to confirmed facts', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '筛选本章事实');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'completed',
    );

    const proposals = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`,
      )
      .expect(200);
    const event = proposals.body.items.find(
      (item: { type: string }) => item.type === 'event',
    ) as { id: string };
    const bodyState = proposals.body.items.find(
      (item: { type: string }) => item.type === 'body_state',
    ) as { id: string };

    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${event.id}`,
      )
      .send({ statement: '沈砚以掌中血触发断碑，碑面浮出陌生文字。' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: event.id,
          statement: '沈砚以掌中血触发断碑，碑面浮出陌生文字。',
          status: 'proposed',
        });
      });

    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${bodyState.id}/reject`,
      )
      .send({})
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: bodyState.id,
          status: 'rejected',
        });
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/facts`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
  });

  it('confirms an edited proposal and records it in a canon commit and snapshot', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '确认本章事实');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'completed',
    );

    const proposals = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`,
      )
      .expect(200);
    const event = proposals.body.items.find(
      (item: { type: string }) => item.type === 'event',
    ) as { id: string; sourceSentence: string };
    const editedStatement = '沈砚用掌中血触发断碑，碑上出现从未见过的文字。';

    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${event.id}`,
      )
      .send({ statement: editedStatement })
      .expect(200);

    const confirmed = await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${event.id}/confirm`,
      )
      .send({})
      .expect(201);
    expect(confirmed.body).toMatchObject({
      proposal: {
        id: event.id,
        status: 'confirmed',
        statement: editedStatement,
      },
      fact: {
        type: 'event',
        statement: editedStatement,
        sourceSentence: event.sourceSentence,
      },
      canonCommit: {
        id: expect.any(String),
        snapshotId: expect.any(String),
      },
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/facts`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          type: 'event',
          statement: editedStatement,
          sourceSentence: event.sourceSentence,
          chapterNumber: 1,
        });
      });

    const commits = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/canon/commits`)
      .expect(200);
    expect(commits.body.items).toHaveLength(1);
    expect(commits.body.items[0]).toMatchObject({
      id: confirmed.body.canonCommit.id,
      chapterNumber: 1,
      snapshotId: confirmed.body.canonCommit.snapshotId,
    });

    await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/canon/snapshots/${confirmed.body.canonCommit.snapshotId}`,
      )
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: confirmed.body.canonCommit.snapshotId,
          commitId: confirmed.body.canonCommit.id,
          facts: [
            {
              type: 'event',
              statement: editedStatement,
              sourceSentence: event.sourceSentence,
              chapterNumber: 1,
            },
          ],
        });
      });
  });

  it('includes only confirmed facts in the next chapter generation context', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '续写只认已确认事实');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const firstStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      firstStarted.body.jobId as string,
      'completed',
    );

    const proposals = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`,
      )
      .expect(200);
    const event = proposals.body.items.find(
      (item: { type: string }) => item.type === 'event',
    ) as { id: string; statement: string };
    const rejected = proposals.body.items.find(
      (item: { type: string }) => item.type === 'body_state',
    ) as { id: string; statement: string };
    const pending = proposals.body.items.find(
      (item: { type: string }) => item.type === 'character_knowledge',
    ) as { id: string; statement: string };

    const confirmed = await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${event.id}/confirm`,
      )
      .send({})
      .expect(201);
    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${rejected.id}/reject`,
      )
      .send({})
      .expect(201);

    await saveOutline(author.agent, work.id, work.mainBranchId, 2, {
      chapterGoal: '沈砚带着断碑上的文字继续赶路。',
      sceneBeats: ['沈砚离开荒寺', '他在山道上核对碑文', '追兵赶到'],
      chapterEndHook: '追兵首领叫出了他母亲的名字。',
    });
    const secondStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/generate`)
      .send({})
      .expect(202);
    const secondJob = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      secondStarted.body.jobId as string,
      'completed',
    );

    const confirmedFacts = secondJob.context.sections.find(
      (section: { key: string }) => section.key === 'confirmedFacts',
    );
    expect(confirmedFacts).toMatchObject({
      title: '已确认设定',
      content: {
        facts: [
          {
            type: 'event',
            statement: event.statement,
            chapterNumber: 1,
          },
        ],
      },
    });
    expect(secondJob.context.sourceRefs).toContain(
      `fact:${confirmed.body.fact.id}`,
    );

    const serializedContext = JSON.stringify(secondJob.context);
    expect(serializedContext).not.toContain(rejected.statement);
    expect(serializedContext).not.toContain(pending.statement);
  });

  it('flags a confirmed left-arm injury when the next chapter uses both hands', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '断臂结印');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const firstStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      firstStarted.body.jobId as string,
      'completed',
    );

    const proposals = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`,
      )
      .expect(200);
    const bodyState = proposals.body.items.find(
      (item: { type: string }) => item.type === 'body_state',
    ) as { id: string };
    const confirmedStatement = '沈砚的左臂骨折，左手无法用力。';
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${bodyState.id}`,
      )
      .send({ statement: confirmedStatement })
      .expect(200);

    await saveOutline(author.agent, work.id, work.mainBranchId, 2, {
      chapterGoal: '沈砚在追兵围困中结印破局。[[LEFT_ARM_CONFLICT]]',
      sceneBeats: ['追兵封住山道', '沈砚催动残剑', '碑文反噬引来旧敌'],
      chapterEndHook: '来人的袖口绣着母亲旧宅的家纹。',
    });

    const pendingStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      pendingStarted.body.jobId as string,
      'completed',
    );

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${bodyState.id}/confirm`,
      )
      .send({})
      .expect(201);

    const confirmedStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/generate`)
      .send({})
      .expect(202);
    const confirmedJob = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      confirmedStarted.body.jobId as string,
      'completed',
    );

    expect(
      confirmedJob.context.sections.find(
        (section: { key: string }) => section.key === 'confirmedFacts',
      ),
    ).toMatchObject({
      content: {
        facts: expect.arrayContaining([
          expect.objectContaining({
            type: 'body_state',
            statement: confirmedStatement,
            chapterNumber: 1,
          }),
        ]),
      },
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          category: 'body_state',
          severity: 'warning',
          status: 'open',
          sourceSentence: expect.stringContaining('双手结印'),
          message: expect.stringContaining('左臂'),
          suggestion: expect.stringMatching(/右手|补写/),
          confirmedFact: {
            statement: confirmedStatement,
            chapterNumber: 1,
          },
        });
        const issue = body.items[0] as {
          sourceSentence: string;
          startOffset: number;
          endOffset: number;
        };
        expect(confirmedJob.draft.content.slice(issue.startOffset, issue.endOffset)).toBe(
          issue.sourceSentence,
        );
      });
  });

  it('records an author reason when ignoring a continuity issue and keeps it isolated', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '断续剑印');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const firstStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      firstStarted.body.jobId as string,
      'completed',
    );

    const proposals = await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`,
      )
      .expect(200);
    const bodyState = proposals.body.items.find(
      (item: { type: string }) => item.type === 'body_state',
    ) as { id: string };
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${bodyState.id}`,
      )
      .send({ statement: '沈砚的左臂骨折，左手无法用力。' })
      .expect(200);
    await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals/${bodyState.id}/confirm`,
      )
      .send({})
      .expect(201);

    await saveOutline(author.agent, work.id, work.mainBranchId, 2, {
      chapterGoal: '沈砚在追兵围困中结印破局。[[LEFT_ARM_CONFLICT]]',
      sceneBeats: ['追兵封住山道', '沈砚催动残剑', '碑文反噬引来旧敌'],
      chapterEndHook: '来人的袖口绣着母亲旧宅的家纹。',
    });
    const secondStarted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/generate`)
      .send({})
      .expect(202);
    await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      secondStarted.body.jobId as string,
      'completed',
    );

    const issues = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations`)
      .expect(200);
    const issue = issues.body.items[0] as {
      id: string;
      status: string;
    };
    expect(issue.status).toBe('open');

    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations/${issue.id}`,
      )
      .send({ reason: '   ' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    const reason = '这里用的是右手代左手的独门法印，后文会交代左臂已经恢复。';
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations/${issue.id}`,
      )
      .send({ reason })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: issue.id,
          status: 'ignored',
          statusLabel: '已忽略',
          ignoredReason: reason,
          ignoredAt: expect.any(String),
        });
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: issue.id,
          status: 'ignored',
          ignoredReason: reason,
        });
      });

    await otherAuthor.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/2/annotations/${issue.id}`,
      )
      .send({ reason })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
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
    expect(countCjkCharacters(job.draft.content)).toBeGreaterThan(0);
    expect(countCjkCharacters(job.draft.content)).toBeLessThan(2_000);
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

  it('honors custom target bounds through context, task state, and the final draft', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '窄幅天门');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({
        targetMinCharacters: 2_100,
        targetMaxCharacters: 2_200,
      })
      .expect(202);
    const job = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'completed',
    );

    expect(job).toMatchObject({
      targetMinCharacters: 2_100,
      targetMaxCharacters: 2_200,
    });
    expect(
      job.context.sections.find(
        (section: { key: string }) => section.key === 'writingGuidance',
      ).content,
    ).toMatchObject({
      targetMinCharacters: 2_100,
      targetMaxCharacters: 2_200,
    });
    const characterCount = countCjkCharacters(job.draft.content);
    expect(characterCount).toBeGreaterThanOrEqual(2_100);
    expect(characterCount).toBeLessThanOrEqual(2_200);
  });

  it('rejects target bounds when the minimum exceeds the maximum', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '倒置篇幅');

    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({
        targetMinCharacters: 2_600,
        targetMaxCharacters: 2_500,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });
  });

  it('counts only CJK ideographs when saving a chapter version', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '字数校准');
    await saveOutline(author.agent, work.id, work.mainBranchId);
    const content = '山河，\n大明 123 abc！';

    const saved = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/versions`)
      .send({ content })
      .expect(201);
    expect(saved.body.wordCount).toBe(4);

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.wordCount).toBe(4);
        expect(body.currentVersion.wordCount).toBe(4);
      });
  });

  it('performs one corrective retry when the first draft misses the target', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '重写篇幅');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId, {
      chapterGoal: '沈砚在断碑前引动残剑。[[RETRY_LENGTH]]',
    });
    await saveProseModel(author.agent);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);
    const job = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
      'completed',
    );
    const draftStep = job.steps.find((step: { key: string }) => step.key === 'draft');

    expect(draftStep.output).toMatchObject({
      attempts: 2,
      targetMinCharacters: 2_000,
      targetMaxCharacters: 3_000,
    });
    expect(countCjkCharacters(job.draft.content)).toBeGreaterThanOrEqual(2_000);
    expect(countCjkCharacters(job.draft.content)).toBeLessThanOrEqual(3_000);

    const sse = await readSse(
      author.agent,
      `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.jobId}/events`,
    );
    expect(sse).toContain('event: job.draft.correcting');
    expect(sse).toContain('event: job.draft.reset');
  });

  it('fails recoverably after one correction if the draft is still out of bounds', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '始终过短');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId, {
      chapterGoal: '沈砚在断碑前引动残剑。[[ALWAYS_SHORT]]',
    });
    await saveProseModel(author.agent);

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
      code: 'DRAFT_LENGTH_OUT_OF_BOUNDS',
      recoverable: true,
      details: {
        attempts: 2,
        targetMinCharacters: 2_000,
        targetMaxCharacters: 3_000,
      },
    });
    expect(countCjkCharacters(job.draft.content)).toBe(500);
    expect(job.draft.status).toBe('failed');
    expect(job.steps.find((step: { key: string }) => step.key === 'draft')).toMatchObject({
      status: 'failed',
    });
  });

  it('prevents another author from starting or reading generation jobs', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '私有天门');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(202);

    await otherAuthor.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/generate`)
      .send({})
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.jobId}`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .get(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.jobId}/events`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
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
