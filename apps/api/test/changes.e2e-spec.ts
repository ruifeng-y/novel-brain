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
  return `changes-${randomUUID()}@example.com`;
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

async function createEntity(
  agent: ReturnType<typeof request.agent>,
  centerPath: string,
  input: {
    name: string;
    type: 'character' | 'faction' | 'map' | 'world';
    summary?: string;
  },
) {
  const response = await agent
    .post(`${centerPath}/entities`)
    .send({
      name: input.name,
      aliases: [],
      type: input.type,
      summary: input.summary ?? '',
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
    })
    .expect(201);
  return response.body as { id: string; name: string; summary: string };
}

describe('change request and impact analysis API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
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

  it('requires a signed-in author', async () => {
    const workId = randomUUID();
    const branchId = randomUUID();

    await request(app.getHttpServer())
      .get(`/api/v1/works/${workId}/branches/${branchId}/changes`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
    await request(app.getHttpServer())
      .post(`/api/v1/works/${workId}/branches/${branchId}/changes`)
      .send({})
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('creates, analyzes, and applies a safe setting change', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const changesPath = `${centerPath}/changes`;
    const entity = await createEntity(author.agent, centerPath, {
      name: '临渊城',
      type: 'map',
      summary: '东荒边境的小城。',
    });

    const created = await author.agent
      .post(changesPath)
      .send({
        title: '补充临渊城的旧称',
        reason: '旧称在前文里出现过，需要写进设定。',
        targetType: 'map',
        targetId: entity.id,
        oldValue: { summary: '东荒边境的小城。' },
        newValue: { summary: '东荒边境的小城，旧称落霞城。' },
        source: 'author',
        risk: 'low',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      workId: work.id,
      branchId: work.mainBranchId,
      title: '补充临渊城的旧称',
      reason: '旧称在前文里出现过，需要写进设定。',
      source: 'author',
      sourceLabel: '作者直接修改',
      risk: 'low',
      riskLabel: '低风险',
      status: 'draft',
      statusLabel: '草稿',
    });
    expect(created.body.diff).toEqual([
      {
        field: 'summary',
        before: '东荒边境的小城。',
        after: '东荒边境的小城，旧称落霞城。',
      },
    ]);

    const analyzed = await author.agent
      .post(`${changesPath}/${created.body.id}/analyze`)
      .expect(201);

    expect(analyzed.body).toMatchObject({
      status: 'waiting_confirmation',
      impact: {
        classification: 'safe',
        classificationLabel: '可以直接应用',
        confidence: expect.any(Number),
      },
    });
    expect(analyzed.body.impact.checks.map((check: { step: string }) => check.step)).toEqual([
      'structure',
      'hard_rules',
      'fact_diff',
      'knowledge_pov',
      'narrative',
      'downstream',
    ]);
    expect(analyzed.body.impact.affected).toEqual({
      entities: [],
      facts: [],
      chapters: [],
      outlines: [],
      plotLines: [],
      knowledge: [],
      maps: [],
      factions: [],
      powerItems: [],
      timeline: [],
    });

    const applied = await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'apply' })
      .expect(201);
    expect(applied.body).toMatchObject({
      status: 'applied',
      statusLabel: '已应用',
      appliedAt: expect.any(String),
    });

    await author.agent
      .get(`${centerPath}/entities/${entity.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary).toBe('东荒边境的小城，旧称落霞城。');
      });
  });

  it('requires and records a repair before applying a repairable change', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const changesPath = `${centerPath}/changes`;
    const entity = await createEntity(author.agent, centerPath, {
      name: '沈砚',
      type: 'character',
      summary: '左臂完好。',
    });
    await app.get(DatabaseService).pool.query(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, autosave_content)
       values ($1, $2, 3, '断碑', 'review', '沈砚忍着左臂的疼，单手结印。')`,
      [work.id, work.mainBranchId],
    );

    const created = await author.agent
      .post(changesPath)
      .send({
        title: '改写沈砚的伤势',
        reason: '第 3 章已经写成左臂骨折，设定需要同步。',
        targetType: 'entity',
        targetId: entity.id,
        oldValue: { summary: '左臂完好。' },
        newValue: { summary: '左臂骨折，尚未痊愈。' },
        source: 'author',
        risk: 'medium',
      })
      .expect(201);

    const analyzed = await author.agent
      .post(`${changesPath}/${created.body.id}/analyze`)
      .expect(201);
    expect(analyzed.body.impact).toMatchObject({
      classification: 'repairable',
      classificationLabel: '修复后应用',
    });
    expect(analyzed.body.impact.affected.chapters).toEqual([
      expect.objectContaining({
        chapterNumber: 3,
        status: 'review',
      }),
    ]);
    expect(
      analyzed.body.impact.checks.find((check: { step: string }) => check.step === 'downstream'),
    ).toMatchObject({ status: 'warning' });

    await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'apply' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('CHANGE_REPAIR_REQUIRED');
      });
    await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'repair' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    const repairNotes = '已核对第 3 章，正文与左臂骨折一致，不需要改写正文。';
    await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'repair', repairNotes })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'applied',
          statusLabel: '已应用',
          decisionReason: repairNotes,
        });
      });

    await author.agent
      .get(`${centerPath}/entities/${entity.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary).toBe('左臂骨折，尚未痊愈。');
      });
  });

  it('lets the author ignore a false positive with a reason and then apply', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const changesPath = `${centerPath}/changes`;
    const entity = await createEntity(author.agent, centerPath, {
      name: '临渊城',
      type: 'map',
      summary: '东荒边境的小城。',
    });
    await app.get(DatabaseService).pool.query(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, autosave_content)
       values ($1, $2, 2, '旧城', 'writing', '临渊城外的雨一直没停。')`,
      [work.id, work.mainBranchId],
    );

    const created = await author.agent
      .post(changesPath)
      .send({
        title: '补充临渊城的方位',
        reason: '新一章里已经写到城市方位。',
        targetType: 'map',
        targetId: entity.id,
        oldValue: { summary: '东荒边境的小城。' },
        newValue: { summary: '东荒边境的小城，位于断碑古寺以东。' },
        source: 'author',
        risk: 'low',
      })
      .expect(201);
    const analyzed = await author.agent
      .post(`${changesPath}/${created.body.id}/analyze`)
      .expect(201);
    const downstream = analyzed.body.impact.checks.find(
      (check: { step: string }) => check.step === 'downstream',
    );
    expect(downstream).toMatchObject({
      status: 'warning',
      ignored: false,
    });

    const ignored = await author.agent
      .post(`${changesPath}/${created.body.id}/false-positive`)
      .send({
        validationId: downstream.id,
        reason: '第 2 章只提到雨，没有写方位冲突，这是误报。',
      })
      .expect(201);

    expect(ignored.body.impact).toMatchObject({
      classification: 'safe',
      classificationLabel: '可以直接应用',
      checks: expect.arrayContaining([
        expect.objectContaining({
          step: 'downstream',
          ignored: true,
          ignoredReason: '第 2 章只提到雨，没有写方位冲突，这是误报。',
        }),
      ]),
    });

    await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'apply' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('applied');
      });
  });

  it('requires a parallel version for a structural change and records its parent', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const changesPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/changes`;
    const chapter = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, autosave_content)
       values ($1, $2, 3, '断碑', 'published', '沈砚第一次听见残剑回响。')
       returning id`,
      [work.id, work.mainBranchId],
    );

    const created = await author.agent
      .post(changesPath)
      .send({
        title: '把忘名代价补进第 3 章',
        reason: '新设定要求借剑必须忘掉一个名字。',
        targetType: 'chapter',
        targetId: chapter.rows[0].id,
        oldValue: { content: '沈砚第一次听见残剑回响。' },
        newValue: { content: '沈砚第一次借用残剑，随后忘了母亲的名字。' },
        source: 'author',
        risk: 'high',
      })
      .expect(201);

    await author.agent
      .post(`${changesPath}/${created.body.id}/analyze`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.impact).toMatchObject({
          classification: 'structural',
          classificationLabel: '需要另开版本',
        });
      });

    await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'apply' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('CHANGE_STRUCTURAL_BRANCH_REQUIRED');
      });

    const branched = await author.agent
      .post(`${changesPath}/${created.body.id}/branch`)
      .send({ name: '断碑修正版' })
      .expect(201);
    expect(branched.body).toMatchObject({
      status: 'branched',
      statusLabel: '已拉平行版本',
      branchedBranchId: expect.any(String),
    });

    const branch = await app
      .get(DatabaseService)
      .pool.query<{ parent_branch_id: string; is_main: boolean }>(
        `select parent_branch_id, is_main from work_branches where id = $1`,
        [branched.body.branchedBranchId],
      );
    expect(branch.rows[0]).toEqual({
      parent_branch_id: work.mainBranchId,
      is_main: false,
    });
  });

  it('keeps a canceled change terminal and records the author decision', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const changesPath = `${centerPath}/changes`;
    const entity = await createEntity(author.agent, centerPath, {
      name: '残剑',
      type: 'map',
      summary: '一柄断剑。',
    });
    const created = await author.agent
      .post(changesPath)
      .send({
        title: '暂时不改残剑描述',
        reason: '先保留现在的写法。',
        targetType: 'map',
        targetId: entity.id,
        oldValue: { summary: '一柄断剑。' },
        newValue: { summary: '一柄会借来亡者剑意的断剑。' },
        source: 'ai',
        risk: 'medium',
      })
      .expect(201);

    const canceled = await author.agent
      .post(`${changesPath}/${created.body.id}/cancel`)
      .send({ reason: '作者决定保留原设定。' })
      .expect(201);
    expect(canceled.body).toMatchObject({
      status: 'canceled',
      statusLabel: '已取消',
      decisionReason: '作者决定保留原设定。',
    });

    await author.agent
      .post(`${changesPath}/${created.body.id}/apply`)
      .send({ mode: 'apply' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('CHANGE_ALREADY_SETTLED');
      });
  });

  it('isolates change requests by author, work, and story branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'what-if-change', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const changesPath = `${centerPath}/changes`;
    const entity = await createEntity(author.agent, centerPath, {
      name: '临渊城',
      type: 'map',
      summary: '东荒边境的小城。',
    });
    const created = await author.agent
      .post(changesPath)
      .send({
        title: '补充旧称',
        reason: '与前文称呼保持一致。',
        targetType: 'map',
        targetId: entity.id,
        oldValue: { summary: '东荒边境的小城。' },
        newValue: { summary: '东荒边境的小城，旧称落霞城。' },
        source: 'author',
        risk: 'low',
      })
      .expect(201);

    await author.agent
      .get(changesPath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
      });
    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranch.rows[0].id}/changes`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
    await author.agent
      .get(
        `/api/v1/works/${work.id}/branches/${parallelBranch.rows[0].id}/changes/${created.body.id}`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('CHANGE_NOT_FOUND');
      });
    await author.agent
      .get(
        `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/changes/${created.body.id}`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('CHANGE_NOT_FOUND');
      });
    await otherAuthor.agent
      .get(changesPath)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .post(changesPath)
      .send({
        title: '越权修改',
        reason: '不应成功。',
        targetType: 'map',
        targetId: entity.id,
        oldValue: { summary: '东荒边境的小城。' },
        newValue: { summary: '被改掉的小城。' },
        source: 'author',
        risk: 'low',
      })
      .expect(404);
  });
});
