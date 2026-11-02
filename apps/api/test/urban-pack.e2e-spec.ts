import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { AI_GATEWAY, FakeAiGateway } from '@novel/ai';
import { countCjkCharacters, URBAN_FIELD_KEYS } from '@novel/contracts';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(): string {
  return `urban-pack-${randomUUID()}@example.com`;
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

describe('urban genre pack API', () => {
  let app: INestApplication;
  let workerApp: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/7';
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
    const queuedGenerationKeys = await redis.keys('bull:generation:*');
    if (queuedGenerationKeys.length > 0) {
      await redis.del(...queuedGenerationKeys);
    }

    const { WorkerModule } = await import('../../worker/src/worker.module');
    const workerRef = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(AI_GATEWAY)
      .useValue(
        new FakeAiGateway({
          mode: 'chapter',
          chunkSize: 120,
          delayMs: 1,
        }),
      )
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

  it('creates an urban work with the urban master template and seven setting subtypes', async () => {
    const author = await createAuthor(app, passwordHash);

    const created = await author.agent
      .post('/api/v1/works')
      .send({
        title: '深夜便利店',
        penName: '南城',
        genrePack: 'urban',
        scale: 'long',
        targetPlatform: '番茄小说',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      title: '深夜便利店',
      genrePack: 'urban',
      genrePackLabel: '都市',
      genreTemplate: {
        key: 'urban-contemporary',
        name: '都市主模板',
      },
    });
    expect(created.body.genreTemplate.checkCategories).toEqual([
      'real_world',
      'relationship',
      'money',
      'law',
    ]);
    expect(created.body.genreTemplate.subtypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'city', label: '城市', entityType: 'map' }),
        expect.objectContaining({ key: 'company', label: '公司', entityType: 'faction' }),
        expect.objectContaining({ key: 'family', label: '家族', entityType: 'faction' }),
        expect.objectContaining({ key: 'class', label: '阶层', entityType: 'world' }),
        expect.objectContaining({ key: 'law', label: '法律', entityType: 'world' }),
        expect.objectContaining({ key: 'money', label: '金钱', entityType: 'world' }),
        expect.objectContaining({ key: 'connections', label: '人脉', entityType: 'faction' }),
      ]),
    );

    await author.agent
      .get(`/api/v1/works/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.genrePack).toBe('urban');
        expect(body.genreTemplate.key).toBe('urban-contemporary');
      });
  });

  it('stores every urban setting subtype with template fields and keeps works isolated', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await author.agent
      .post('/api/v1/works')
      .send({
        title: '南城旧事',
        penName: '南城',
        genrePack: 'urban',
        scale: 'long',
        targetPlatform: '番茄小说',
      })
      .expect(201);
    const centerPath = `/api/v1/works/${work.body.id}/branches/${work.body.mainBranch.id}`;

    const settings = [
      {
        name: '江城',
        type: 'map',
        subtype: 'city',
        summary: '故事发生的新一线城市。',
        customFields: {
          [URBAN_FIELD_KEYS.city.region]: '江南',
          [URBAN_FIELD_KEYS.city.population]: 1_200,
          [URBAN_FIELD_KEYS.city.tier]: '新一线城市',
          [URBAN_FIELD_KEYS.city.commute]: '早高峰跨江通勤至少四十分钟',
        },
      },
      {
        name: '远山资本',
        type: 'faction',
        subtype: 'company',
        summary: '陈默任职的投资公司。',
        customFields: {
          [URBAN_FIELD_KEYS.company.industry]: '投资管理',
          [URBAN_FIELD_KEYS.company.legalRepresentative]: '周启明',
          [URBAN_FIELD_KEYS.company.registeredCapital]: 5_000,
          [URBAN_FIELD_KEYS.company.cashBalance]: 350,
          [URBAN_FIELD_KEYS.company.ownership]: '有限责任公司',
          [URBAN_FIELD_KEYS.company.employees]: 86,
        },
      },
      {
        name: '陈氏家族',
        type: 'faction',
        subtype: 'family',
        summary: '从旧城批发市场起家的家族。',
        customFields: {
          [URBAN_FIELD_KEYS.family.head]: '陈国梁',
          [URBAN_FIELD_KEYS.family.members]: '陈国梁、陈默、陈雪',
          [URBAN_FIELD_KEYS.family.assets]: 2_800,
          [URBAN_FIELD_KEYS.family.influence]: '旧城商会',
          [URBAN_FIELD_KEYS.family.succession]: '长子继承，但必须保住商会席位',
        },
      },
      {
        name: '城市中产',
        type: 'world',
        subtype: 'class',
        summary: '有房贷、有稳定工作但缺少上层资源的人群。',
        customFields: {
          [URBAN_FIELD_KEYS.class.tier]: '中产阶层',
          [URBAN_FIELD_KEYS.class.income]: '家庭年收入 30 至 80 万元',
          [URBAN_FIELD_KEYS.class.assets]: '一套自住房和少量投资',
          [URBAN_FIELD_KEYS.class.access]: '医院、学校和行业协会的普通渠道',
          [URBAN_FIELD_KEYS.class.mobility]: '依赖职业晋升和婚姻',
        },
      },
      {
        name: '公司法资金边界',
        type: 'world',
        subtype: 'law',
        summary: '资金调动必须经过股东会和财务负责人。',
        customFields: {
          [URBAN_FIELD_KEYS.law.jurisdiction]: '中华人民共和国',
          [URBAN_FIELD_KEYS.law.prohibitedActions]: ['挪用公司资金', '伪造合同'],
          [URBAN_FIELD_KEYS.law.requirements]: '大额转账需要股东会决议和双人复核',
          [URBAN_FIELD_KEYS.law.penalty]: '承担民事赔偿，情节严重时追究刑事责任',
        },
      },
      {
        name: '陈默账户',
        type: 'world',
        subtype: 'money',
        summary: '陈默个人可动用资金。',
        customFields: {
          [URBAN_FIELD_KEYS.money.holder]: '陈默',
          [URBAN_FIELD_KEYS.money.currency]: '人民币',
          [URBAN_FIELD_KEYS.money.balance]: 3.5,
          [URBAN_FIELD_KEYS.money.monthlyIncome]: 2.2,
          [URBAN_FIELD_KEYS.money.source]: '工资与项目奖金',
        },
      },
      {
        name: '周警官这条线',
        type: 'faction',
        subtype: 'connections',
        summary: '陈默能求助的少数体制内关系。',
        customFields: {
          [URBAN_FIELD_KEYS.connections.target]: '周警官',
          [URBAN_FIELD_KEYS.connections.relation]: '盟友',
          [URBAN_FIELD_KEYS.connections.trust]: 75,
          [URBAN_FIELD_KEYS.connections.obligation]: '陈默曾帮她处理过一次舆情危机',
          [URBAN_FIELD_KEYS.connections.influence]: '可以调阅公开案件流程信息',
        },
      },
    ] as const;

    for (const setting of settings) {
      await author.agent
        .post(`${centerPath}/entities`)
        .send({
          aliases: [],
          description: '',
          tags: [],
          scope: 'work',
          status: 'draft',
          ...setting,
        })
        .expect(201)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            name: setting.name,
            type: setting.type,
            subtype: setting.subtype,
            customFields: setting.customFields,
          });
        });
    }

    await author.agent
      .get(`${centerPath}/entities?subtype=law`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({
            name: '公司法资金边界',
            subtype: 'law',
            subtypeLabel: '法律',
          }),
        ]);
      });

    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '错栏目的法律设定',
        aliases: [],
        type: 'faction',
        subtype: 'law',
        summary: '',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
        customFields: {},
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('URBAN_SUBTYPE_INVALID');
      });

    await otherAuthor.agent.get(`${centerPath}/entities`).expect(404);
  });

  it('generates an urban chapter with the pack and reports its four constraint checks', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await author.agent
      .post('/api/v1/works')
      .send({
        title: '南城清单',
        penName: '南城',
        genrePack: 'urban',
        scale: 'long',
        targetPlatform: '番茄小说',
      })
      .expect(201);
    const workId = work.body.id as string;
    const branchId = work.body.mainBranch.id as string;
    const centerPath = `/api/v1/works/${workId}/branches/${branchId}`;

    const chenMo = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '陈默',
        aliases: [],
        type: 'character',
        subtype: '',
        summary: '被资金链逼到墙角的项目经理。',
        description: '',
        tags: ['主角'],
        scope: 'work',
        status: 'locked',
        customFields: {},
      })
      .expect(201);
    const suWan = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '苏晚',
        aliases: [],
        type: 'character',
        subtype: '',
        summary: '与陈默争夺公司控制权的投资人。',
        description: '',
        tags: ['对手'],
        scope: 'work',
        status: 'locked',
        customFields: {},
      })
      .expect(201);
    await author.agent
      .post(`${centerPath}/relations`)
      .send({
        fromEntityId: chenMo.body.id,
        predicate: 'hostile',
        toEntityId: suWan.body.id,
        validFrom: '第 1 章',
        validTo: null,
        source: '作者录入',
      })
      .expect(201);

    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '陈默账户',
        aliases: [],
        type: 'world',
        subtype: 'money',
        summary: '陈默个人可动用资金。',
        description: '',
        tags: [],
        scope: 'work',
        status: 'locked',
        customFields: {
          [URBAN_FIELD_KEYS.money.holder]: '陈默',
          [URBAN_FIELD_KEYS.money.currency]: '人民币',
          [URBAN_FIELD_KEYS.money.balance]: 3.5,
          [URBAN_FIELD_KEYS.money.monthlyIncome]: 2.2,
          [URBAN_FIELD_KEYS.money.source]: '工资与项目奖金',
        },
      })
      .expect(201);
    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '公司法资金边界',
        aliases: [],
        type: 'world',
        subtype: 'law',
        summary: '资金调动必须经过股东会和财务负责人。',
        description: '',
        tags: [],
        scope: 'work',
        status: 'locked',
        customFields: {
          [URBAN_FIELD_KEYS.law.jurisdiction]: '中华人民共和国',
          [URBAN_FIELD_KEYS.law.prohibitedActions]: ['挪用公司资金', '伪造合同'],
          [URBAN_FIELD_KEYS.law.requirements]: '大额转账需要股东会决议和双人复核',
          [URBAN_FIELD_KEYS.law.penalty]: '承担民事赔偿，情节严重时追究刑事责任',
        },
      })
      .expect(201);

    const cityMap = await author.agent
      .post(`${centerPath}/maps/nodes`)
      .send({
        name: '南城',
        level: 'world',
        summary: '故事发生的现代都市。',
        description: '',
      })
      .expect(201);
    const east = await author.agent
      .post(`${centerPath}/maps/nodes`)
      .send({
        name: '城东',
        level: 'city',
        parentNodeId: cityMap.body.id,
        summary: '旧工业园区。',
        description: '',
      })
      .expect(201);
    const west = await author.agent
      .post(`${centerPath}/maps/nodes`)
      .send({
        name: '城西',
        level: 'city',
        parentNodeId: cityMap.body.id,
        summary: '公司总部所在的新商务区。',
        description: '',
      })
      .expect(201);
    await author.agent
      .post(`${centerPath}/maps/connections`)
      .send({
        fromNodeId: east.body.id,
        toNodeId: west.body.id,
        travelMinutes: 45,
        label: '跨城高架',
      })
      .expect(201);

    await author.agent
      .put(`${centerPath}/story-bible`)
      .send({
        oneSentenceStory: '被资金链逼到墙角的项目经理，用一份旧合同掀开公司控制权争夺。',
        protagonist: '陈默，远山资本项目经理',
        worldIronLaw: '每一次资金调动都必须有授权、凭证和可承担的法律后果。',
      })
      .expect(200);
    await author.agent
      .put(`${centerPath}/chapter-outlines/1`)
      .send({
        chapterGoal: '陈默赶去城西堵住供应商围堵。[[URBAN_CONFLICTS]]',
        pov: '陈默',
        sceneBeats: ['接到供应商电话', '从城东赶去城西', '在会议室面对苏晚'],
        chapterEndHook: '供应商拿出另一份合同，签名栏写着陈默从未见过的名字。',
      })
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
        isDefault: true,
      })
      .expect(201);

    const started = await author.agent
      .post(`${centerPath}/chapters/1/generate`)
      .send({})
      .expect(202);
    const job = await waitForJob(author.agent, workId, branchId, started.body.jobId as string);

    expect(job.status).toBe('completed');
    expect(job.draft.status).toBe('ready');
    expect(countCjkCharacters(job.draft.content)).toBeGreaterThanOrEqual(2_000);
    expect(job.context.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'genrePack',
          content: expect.objectContaining({
            key: 'urban',
            templateName: '都市主模板',
          }),
        }),
        expect.objectContaining({
          key: 'urbanSettings',
        }),
      ]),
    );
    expect(job.draft.content).toContain('陈默从城东开车到城西只用了五分钟。');

    await author.agent
      .get(`${centerPath}/chapters/1/annotations`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              category: 'real_world',
              categoryLabel: '现实逻辑',
            }),
            expect.objectContaining({
              category: 'relationship',
              categoryLabel: '社会关系',
            }),
            expect.objectContaining({
              category: 'money',
              categoryLabel: '金钱约束',
            }),
            expect.objectContaining({
              category: 'law',
              categoryLabel: '法律约束',
            }),
          ]),
        );
      });
  });
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
