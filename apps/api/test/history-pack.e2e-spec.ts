import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { AI_GATEWAY, FakeAiGateway } from '@novel/ai';
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
  return `history-pack-${randomUUID()}@example.com`;
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

async function createWork(
  agent: ReturnType<typeof request.agent>,
  title: string,
  genrePack: 'xianxia' | 'history' = 'history',
) {
  const response = await agent
    .post('/api/v1/works')
    .send({
      title,
      penName: '朔风客',
      genrePack,
      ...(genrePack === 'history' ? { genreVariant: 'alternate_ancient' } : {}),
      scale: 'long',
      targetPlatform: '起点中文网',
    })
    .expect(201);

  return {
    id: response.body.id as string,
    mainBranchId: response.body.mainBranch.id as string,
  };
}

async function createSetting(
  agent: ReturnType<typeof request.agent>,
  centerPath: string,
  input: Record<string, unknown>,
) {
  return (
    await agent
      .post(`${centerPath}/entities`)
      .send({
        aliases: [],
        summary: '',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
        ...input,
      })
      .expect(201)
  ).body as { id: string; name: string };
}

describe('history pack API', () => {
  let app: INestApplication;
  let workerApp: INestApplication;
  let fakeGateway: FakeAiGateway;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/9';
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

    fakeGateway = new FakeAiGateway({ mode: 'chapter', chunkSize: 120, delayMs: 1 });
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

  it('requires a signed-in author', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/works/00000000-0000-4000-8000-000000000001/branches/00000000-0000-4000-8000-000000000002/history/checks')
      .send({})
      .expect(401);
  });

  it('checks anachronisms, official hierarchy, army movement, provisions, and distance', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '北境争鼎');
    const xianxiaWork = await createWork(author.agent, '天门残卷', 'xianxia');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const mapPath = `${centerPath}/maps`;

    const minister = await createSetting(author.agent, centerPath, {
      name: '尚书令',
      type: 'faction',
      subtype: 'bureaucracy',
      customFields: { history_rank: 2 },
    });
    const vice = await createSetting(author.agent, centerPath, {
      name: '侍郎',
      type: 'faction',
      subtype: 'bureaucracy',
      customFields: { history_rank: 4 },
    });
    await author.agent
      .post(`${centerPath}/relations`)
      .send({
        fromEntityId: vice.id,
        predicate: 'subordinate',
        toEntityId: minister.id,
        source: '官制表',
      })
      .expect(201);
    const army = await createSetting(author.agent, centerPath, {
      name: '朔州军',
      type: 'faction',
      subtype: 'military',
      customFields: {
        history_troops: 3_000,
        history_provisions_shi: 50,
      },
    });

    const world = await author.agent
      .post(`${mapPath}/nodes`)
      .send({ name: '大朔', level: 'world', summary: '架空王朝疆域。' })
      .expect(201);
    const capital = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '京城',
        level: 'city',
        parentNodeId: world.body.id,
        summary: '王朝都城。',
      })
      .expect(201);
    const frontier = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '朔州',
        level: 'city',
        parentNodeId: world.body.id,
        summary: '北境边城。',
      })
      .expect(201);
    await author.agent
      .post(`${mapPath}/connections`)
      .send({
        fromNodeId: capital.body.id,
        toNodeId: frontier.body.id,
        travelMinutes: 2_880,
        label: '官道',
      })
      .expect(201);

    const checked = await author.agent
      .post(`${centerPath}/history/checks`)
      .send({
        text: '他掏出手机，命人给京城的公司送信。',
        armyMovement: {
          armyEntityId: army.id,
          fromNodeId: capital.body.id,
          toNodeId: frontier.body.id,
          plannedDays: 1,
        },
      })
      .expect(201);

    expect(checked.body.checks).toEqual([
      expect.objectContaining({ key: 'anachronism', label: '时代错置' }),
      expect.objectContaining({ key: 'official_hierarchy', label: '官制层级' }),
      expect.objectContaining({ key: 'army_movement', label: '军队调动' }),
      expect.objectContaining({ key: 'provisions', label: '粮草' }),
      expect.objectContaining({ key: 'geographic_distance', label: '地理距离' }),
    ]);
    expect(
      checked.body.checks.find((check: { key: string }) => check.key === 'official_hierarchy'),
    ).toMatchObject({ status: 'passed', issueCount: 0 });
    expect(
      checked.body.checks.find((check: { key: string }) => check.key === 'geographic_distance'),
    ).toMatchObject({ status: 'needs_attention', issueCount: 1 });
    expect(
      checked.body.checks.find((check: { key: string }) => check.key === 'provisions'),
    ).toMatchObject({ status: 'needs_attention', issueCount: 1 });
    expect(checked.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'anachronism', sourceText: '手机' }),
        expect.objectContaining({ category: 'anachronism', sourceText: '公司' }),
        expect.objectContaining({ category: 'geographic_distance' }),
        expect.objectContaining({ category: 'provisions' }),
      ]),
    );

    await otherAuthor.agent
      .post(`${centerPath}/history/checks`)
      .send({ text: '手机' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });

    await author.agent
      .post(
        `/api/v1/works/${xianxiaWork.id}/branches/${xianxiaWork.mainBranchId}/history/checks`,
      )
      .send({ text: '手机' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('HISTORY_PACK_REQUIRED');
      });
  });

  it('generates a chapter with the history main template and pack context', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '北境争鼎');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    await createSetting(author.agent, centerPath, {
      name: '朔州军',
      type: 'faction',
      subtype: 'military',
      summary: '驻守北境的边军，军纪严整。',
      customFields: {
        history_troops: 3_000,
        history_provisions_shi: 2_000,
      },
    });
    await author.agent
      .put(`${centerPath}/story-bible`)
      .send({
        oneSentenceStory: '现代军校生穿越到架空乱世，从边城小卒一路止战定鼎。',
        protagonist: '顾行舟，现代军校生，穿越后成为朔州军中的什长',
        worldIronLaw: '军队调动必须遵守道路、粮草和官制层级，不能凭空出现在远方。',
      })
      .expect(200);
    await author.agent
      .put(`${centerPath}/chapter-outlines/1`)
      .send({
        chapterGoal: '顾行舟在朔州军中识破一次不合常理的调令，并设法拖延行军。',
        pov: '顾行舟',
        sceneBeats: ['雪夜点卯', '核对官印和粮册', '发现调令越过三级官署', '决定先稳住军心'],
        chapterEndHook: '真正的监军使在城门外亮出了第二道圣旨。',
      })
      .expect(200);
    await author.agent
      .post('/api/v1/model-configs')
      .send({
        name: '历史正文模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: 'sk-history-test-never-used',
        purpose: 'prose',
        isDefault: true,
      })
      .expect(201);

    const started = await author.agent
      .post(`${centerPath}/chapters/1/generate`)
      .send({})
      .expect(202);
    const job = await waitForJob(
      author.agent,
      work.id,
      work.mainBranchId,
      started.body.jobId as string,
    );

    expect(job.status).toBe('completed');
    expect(job.context.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'historyPack',
          title: '历史题材规则',
          content: expect.objectContaining({
            mainTemplate: '架空古代',
            variant: 'alternate_ancient',
            variantLabel: '架空古代',
          }),
        }),
      ]),
    );
    expect(job.draft.content).toContain('朔州');
    expect(countCjkCharacters(job.draft.content)).toBeGreaterThanOrEqual(2_000);

    const saved = await author.agent
      .post(`${centerPath}/chapters/1/versions`)
      .send({ title: '雪夜调令', content: job.draft.content })
      .expect(201);
    expect(saved.body).toMatchObject({ chapterNumber: 1, source: 'manual' });
  }, 20_000);
});

async function waitForJob(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  jobId: string,
) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await agent
      .get(`/api/v1/works/${workId}/branches/${branchId}/jobs/${jobId}`)
      .expect(200);
    if (response.body.status === 'completed' || response.body.status === 'failed') {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Job ${jobId} did not finish`);
}
