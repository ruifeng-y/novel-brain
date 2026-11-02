import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { AI_GATEWAY, FakeAiGateway, buildDeterministicChineseChapter } from '@novel/ai';
import { countCjkCharacters } from '@novel/contracts';
import {
  characterStates,
  createDatabase,
  entities,
  foreshadows,
  itemOwnerships,
  users as usersTable,
  workBranches,
} from '@novel/db';
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

function chapterWithQualityAuditConflicts(prompt: string): string {
  return [
    '沈砚忍着左臂的疼，双手结印压住碑文。',
    '沈砚知道父母是被仇家所杀的。',
    '沈砚握住残剑，催动剑上的寒光。',
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
  const chapterNumber = typeof chapterNumberOrOverrides === 'number' ? chapterNumberOrOverrides : 1;
  const payloadOverrides =
    typeof chapterNumberOrOverrides === 'number' ? overrides : chapterNumberOrOverrides;
  await agent
    .put(`/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/${chapterNumber}`)
    .send(chapterOutlinePayload(payloadOverrides))
    .expect(200);
}

async function saveProseModel(agent: ReturnType<typeof request.agent>, name = '正文模型') {
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
        if (input.prompt.includes('【续写要求】')) {
          return chapterForPrompt(input.prompt);
        }
        if (input.prompt.includes('【改写要求】')) {
          return '他缓缓抬起头，望向雨幕深处，指节仍压在断碑冰凉的字痕上。';
        }
        if (input.prompt.includes('【扩写要求】')) {
          return '他先是停住呼吸，随后缓缓抬起头，望向雨幕深处。风从断碑间穿过，卷走檐下的水声，也把他未说出口的名字压回喉咙里。';
        }
        if (input.prompt.includes('【缩写要求】')) {
          return '他抬头望向雨幕。';
        }
        if (input.prompt.includes('【改视角要求】')) {
          return '苏晚看见他抬起头，雨水顺着下颌落下，断碑却在他掌下亮起一线微光。';
        }
        if (input.prompt.includes('【钩子要求】')) {
          return [
            '1. 断碑后的黑暗里，有人用他母亲的声音叫了他的名字。',
            '2. 山门外亮起火光，来人的袖口绣着早已焚毁的家纹。',
            '3. 他低头时，发现碑上多了一行自己刚刚才写下的字。',
          ].join('\n');
        }
        if (input.prompt.includes('【标题要求】')) {
          return '断碑问心';
        }
        if (input.prompt.includes('【摘要要求】')) {
          return '沈砚在荒寺断碑前引动残剑，以一段记忆为代价窥见母亲失踪的线索，也在追兵逼近时发现碑文正在回应他的名字。';
        }
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
        if (input.prompt.includes('[[QUALITY_AUDIT]]')) {
          return chapterWithQualityAuditConflicts(input.prompt);
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
    expect(job.steps.every((step: { status: string }) => step.status === 'succeeded')).toBe(true);
    expect(job.context.sections.map((section: { key: string }) => section.key)).toEqual(
      expect.arrayContaining(['storyBible', 'chapterOutline', 'writingGuidance']),
    );
    expect(
      job.context.sections.find((section: { key: string }) => section.key === 'writingGuidance')
        .content,
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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`)
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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`)
      .expect(200);
    const event = proposals.body.items.find((item: { type: string }) => item.type === 'event') as {
      id: string;
    };
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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`)
      .expect(200);
    const event = proposals.body.items.find((item: { type: string }) => item.type === 'event') as {
      id: string;
      sourceSentence: string;
    };
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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`)
      .expect(200);
    const event = proposals.body.items.find((item: { type: string }) => item.type === 'event') as {
      id: string;
      statement: string;
    };
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
    expect(secondJob.context.sourceRefs).toContain(`fact:${confirmed.body.fact.id}`);

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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`)
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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/fact-proposals`)
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

  it('persists multiple continuity classes and a six-part quality report for one branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '群像校验');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId, {
      chapterGoal: '沈砚在断碑前引动残剑，并面对旧日真相。[[QUALITY_AUDIT]]',
    });
    await saveProseModel(author.agent);

    const database = app.get(DatabaseService).db;
    const [shen] = await database
      .insert(entities)
      .values({
        workId: work.id,
        branchId: work.mainBranchId,
        name: '沈砚',
        type: 'character',
        summary: '边城剑客',
      })
      .returning();
    const [su] = await database
      .insert(entities)
      .values({
        workId: work.id,
        branchId: work.mainBranchId,
        name: '苏晚',
        type: 'character',
        summary: '持剑人',
      })
      .returning();
    const [sword] = await database
      .insert(entities)
      .values({
        workId: work.id,
        branchId: work.mainBranchId,
        name: '残剑',
        type: 'item_technique',
        summary: '会吞噬记忆的旧剑',
      })
      .returning();
    await database.insert(characterStates).values({
      workId: work.id,
      branchId: work.mainBranchId,
      characterId: shen.id,
      body: '左臂骨折',
      power: '炼气三层',
      location: '荒寺',
      possessions: '',
      disguise: '',
      knowledge: [
        {
          id: randomUUID(),
          title: '父母之死',
          objectiveTruth: '父母是被仇家所杀的',
          characterBelief: '父母是自尽',
          validFrom: '第一章',
          validTo: null,
          source: '作者录入',
        },
      ],
      updatedBy: author.userId,
    });
    await database.insert(itemOwnerships).values({
      workId: work.id,
      branchId: work.mainBranchId,
      itemEntityId: sword.id,
      ownerEntityId: su.id,
      fromTime: '第一章',
      source: '作者录入',
    });
    const [parallelBranch] = await database
      .insert(workBranches)
      .values({
        workId: work.id,
        name: '校验支线',
        isMain: false,
        status: 'active',
        createdBy: author.userId,
      })
      .returning();

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

    const annotations = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/annotations`)
      .expect(200);
    expect(annotations.body.items.map((item: { category: string }) => item.category)).toEqual(
      expect.arrayContaining(['body_state', 'knowledge', 'item']),
    );
    for (const issue of annotations.body.items as Array<{
      sourceSentence: string;
      suggestion: string;
    }>) {
      expect(job.draft.content).toContain(issue.sourceSentence);
      expect(issue.suggestion.length).toBeGreaterThan(0);
    }

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/quality`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.chapterNumber).toBe(1);
        expect(body.generatedAt).toEqual(expect.any(String));
        expect(body.dimensions.map((item: { key: string }) => item.key)).toEqual([
          'hook',
          'pacing',
          'information_density',
          'character_voice',
          'prose',
          'continuity',
        ]);
        expect(body.issueCounts).toMatchObject({
          body_state: expect.any(Number),
          knowledge: expect.any(Number),
          item: expect.any(Number),
        });
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/insights`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.qualityReport.dimensions).toHaveLength(6);
        expect(body.continuity).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ category: 'body_state' }),
            expect.objectContaining({ category: 'knowledge' }),
            expect.objectContaining({ category: 'item' }),
          ]),
        );
      });

    const knowledgeIssue = (
      annotations.body.items as Array<{ id: string; category: string }>
    ).find((item) => item.category === 'knowledge');
    expect(knowledgeIssue).toBeDefined();
    const reason = '这是主角误信旧案的梦境，下一章会明确写出认知反转。';
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/annotations/${knowledgeIssue?.id}`,
      )
      .send({ reason })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ignored',
          ignoredReason: reason,
        });
      });

    await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${parallelBranch.id}/chapters/1/quality`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('CHAPTER_OUTLINE_NOT_FOUND');
      });
    await otherAuthor.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/quality`)
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
      job.context.sections.find((section: { key: string }) => section.key === 'writingGuidance')
        .content,
    ).toMatchObject({
      targetMinCharacters: 2_100,
      targetMaxCharacters: 2_200,
    });
    const characterCount = countCjkCharacters(job.draft.content);
    expect(characterCount).toBeGreaterThanOrEqual(2_100);
    expect(characterCount).toBeLessThanOrEqual(2_200);
  });

  it('continues from the cursor with quality, model, constraints, references, and taboo feedback', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '续写控制');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    const model = await saveProseModel(author.agent);
    const existingContent = '沈砚按住断碑，雨声忽然停了。';

    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/versions`)
      .send({ content: existingContent })
      .expect(201);

    const started = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/continue`)
      .send({
        content: existingContent,
        cursorOffset: existingContent.length,
        qualityTier: 'premium',
        modelConfigId: model.body.id,
        targetMinCharacters: 300,
        targetMaxCharacters: 400,
        pov: '苏晚',
        mustInclude: ['断碑'],
        mustAvoid: ['天降神迹'],
        referenceChapters: [1],
        tabooWords: ['血'],
        instruction: '放慢节奏，保留悬念。',
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
      action: 'continue',
      outputKind: 'segment',
      modelConfigId: model.body.id,
      settings: {
        qualityTier: 'premium',
        targetMinCharacters: 300,
        targetMaxCharacters: 400,
        pov: '苏晚',
        mustInclude: ['断碑'],
        mustAvoid: ['天降神迹'],
        referenceChapters: [1],
        tabooWords: ['血'],
        cursorOffset: existingContent.length,
      },
    });
    expect(job.context.sections.map((section: { key: string }) => section.key)).toEqual(
      expect.arrayContaining(['writingControls', 'referenceChapters']),
    );
    expect(
      job.context.sections.find(
        (section: { key: string }) => section.key === 'writingControls',
      ).content,
    ).toMatchObject({
      qualityTierLabel: '精品',
      pov: '苏晚',
      mustInclude: ['断碑'],
      mustAvoid: ['天降神迹'],
      tabooWords: ['血'],
    });
    expect(job.draft.content.length).toBeGreaterThan(0);

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/annotations`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              category: 'taboo',
              message: expect.stringContaining('血'),
              sourceSentence: expect.stringContaining('血'),
            }),
          ]),
        );
      });
  });

  it('supports selection rewrite, expand, condense, perspective change, hooks, title, and summary', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '精细改写');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);
    await saveProseModel(author.agent);
    const content = '沈砚按住断碑。他抬起头。山门外传来脚步声。';
    const selection = '他抬起头。';
    const selectionStart = content.indexOf(selection);
    const selectionEnd = selectionStart + selection.length;

    const actions = [
      { path: 'rewrite', action: 'rewrite', outputKind: 'segment' },
      { path: 'expand', action: 'expand', outputKind: 'segment' },
      { path: 'condense', action: 'condense', outputKind: 'segment' },
      { path: 'change-pov', action: 'change_pov', outputKind: 'segment' },
      { path: 'hooks', action: 'hooks', outputKind: 'hook_options' },
      { path: 'title', action: 'title', outputKind: 'title' },
      { path: 'summary', action: 'summary', outputKind: 'summary' },
    ] as const;

    for (const item of actions) {
      const isSegment = item.outputKind === 'segment';
      const started = await author.agent
        .post(
          `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/${item.path}`,
        )
        .send({
          content,
          ...(isSegment
            ? {
                selection,
                selectionStart,
                selectionEnd,
                targetMinCharacters: 1,
                targetMaxCharacters: 300,
              }
            : {}),
          ...(item.action === 'change_pov' ? { targetPov: '苏晚' } : {}),
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
        action: item.action,
        outputKind: item.outputKind,
      });
      expect(job.draft.content.trim().length).toBeGreaterThan(0);
      if (item.action === 'hooks') {
        expect(job.draft.content.split('\n').filter(Boolean)).toHaveLength(3);
      }
    }
  });

  it('autosaves, keeps version history, restores an older version, and saves chapter metadata', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '版本回廊');
    await saveOutline(author.agent, work.id, work.mainBranchId);

    const first = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/versions`)
      .send({ content: '第一版正文。' })
      .expect(201);
    const second = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/versions`)
      .send({ content: '第二版正文，多了一段。' })
      .expect(201);

    const autosaved = await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/autosave`)
      .send({ content: '自动保存中的第三版正文。' })
      .expect(200);
    expect(autosaved.body).toMatchObject({
      content: '自动保存中的第三版正文。',
      wordCount: 11,
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('第二版正文，多了一段。');
        expect(body.autosave).toMatchObject({
          content: '自动保存中的第三版正文。',
        });
        expect(body.versions).toHaveLength(2);
      });

    const restored = await author.agent
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/versions/${first.body.id}/restore`,
      )
      .send({})
      .expect(201);
    expect(restored.body).toMatchObject({
      version: 3,
      source: 'restored',
      content: '第一版正文。',
    });

    await author.agent
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .send({
        title: '第一章 断碑问心',
        summary: '沈砚在断碑前付出记忆代价。',
        hook: '门外的人叫出了他母亲的名字。',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          title: '第一章 断碑问心',
          summary: '沈砚在断碑前付出记忆代价。',
          hook: '门外的人叫出了他母亲的名字。',
        });
      });
    expect(second.body.version).toBe(2);
  });

  it('returns editorial suggestions, continuity, foreshadows, and character state for the chapter', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '写作上下文');
    await saveStoryBible(author.agent, work.id, work.mainBranchId);
    await saveOutline(author.agent, work.id, work.mainBranchId);

    const database = app.get(DatabaseService).db;
    const [character] = await database
      .insert(entities)
      .values({
        workId: work.id,
        branchId: work.mainBranchId,
        name: '沈砚',
        type: 'character',
        summary: '边城剑客',
      })
      .returning();
    await database.insert(foreshadows).values({
      workId: work.id,
      branchId: work.mainBranchId,
      title: '母亲留下的旧家纹',
      description: '追兵袖口会出现同样的纹样。',
      setupChapter: 1,
      plannedPayoffChapter: 4,
      importance: 'must',
      status: 'planted',
    });
    await database.insert(characterStates).values({
      workId: work.id,
      branchId: work.mainBranchId,
      characterId: character.id,
      body: '左臂骨折',
      power: '炼气三层',
      location: '荒寺',
      possessions: '残剑',
      disguise: '',
      updatedBy: author.userId,
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1/insights`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.foreshadows).toEqual([
          expect.objectContaining({
            title: '母亲留下的旧家纹',
            importanceLabel: '必须回收',
          }),
        ]);
        expect(body.characters).toEqual([
          expect.objectContaining({
            name: '沈砚',
            body: '左臂骨折',
            power: '炼气三层',
            location: '荒寺',
            possessions: '残剑',
          }),
        ]);
        expect(body).toHaveProperty('suggestions');
        expect(body).toHaveProperty('continuity');
      });
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
  }, 20_000);

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
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/jobs/${started.body.jobId}`)
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
  for (let attempt = 0; attempt < 400; attempt += 1) {
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

async function readSse(agent: ReturnType<typeof request.agent>, path: string): Promise<string> {
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
