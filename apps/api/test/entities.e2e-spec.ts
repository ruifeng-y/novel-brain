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
  return `entity-center-${randomUUID()}@example.com`;
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
  genrePack: 'xianxia' | 'history' = 'xianxia',
  genreVariant?: 'alternate_ancient' | 'transmigration_hegemony',
) {
  const response = await agent
    .post('/api/v1/works')
    .send({
      title,
      penName: '青云客',
      genrePack,
      ...(genreVariant ? { genreVariant } : {}),
      scale: 'long',
      targetPlatform: '起点中文网',
    })
    .expect(201);

  return {
    id: response.body.id as string,
    mainBranchId: response.body.mainBranch.id as string,
  };
}

describe('entity center API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
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
      .get(`/api/v1/works/${workId}/branches/${branchId}/entities`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/works/${workId}/branches/${branchId}/custom-fields`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/works/${workId}/branches/${branchId}/relations`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('saves every entity field and every custom field type by work and branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'what-if', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const otherCenterPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}`;

    const fieldInputs = [
      { label: '旧伤备注', type: 'text' },
      { label: '年龄', type: 'number' },
      { label: '生辰', type: 'date' },
      { label: '境界', type: 'single_select', options: ['炼气', '筑基', '金丹'] },
      {
        label: '常用剑术',
        type: 'multi_select',
        options: ['御剑', '炼丹', '符箓'],
      },
      { label: '仍在追踪母亲', type: 'boolean' },
      { label: '宿敌', type: 'relation_ref' },
    ] as const;
    const fields: Array<{ id: string; key: string; label: string; type: string }> = [];
    for (const fieldInput of fieldInputs) {
      const response = await author.agent
        .post(`${centerPath}/custom-fields`)
        .send(fieldInput)
        .expect(201);
      fields.push(response.body);
    }

    await author.agent
      .get(`${centerPath}/custom-fields`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ label: '旧伤备注', type: 'text', typeLabel: '文本' }),
            expect.objectContaining({ label: '年龄', type: 'number', typeLabel: '数字' }),
            expect.objectContaining({ label: '生辰', type: 'date', typeLabel: '日期' }),
            expect.objectContaining({
              label: '境界',
              type: 'single_select',
              typeLabel: '单选',
              options: ['炼气', '筑基', '金丹'],
            }),
            expect.objectContaining({
              label: '常用剑术',
              type: 'multi_select',
              typeLabel: '多选',
            }),
            expect.objectContaining({
              label: '仍在追踪母亲',
              type: 'boolean',
              typeLabel: '布尔',
            }),
            expect.objectContaining({
              label: '宿敌',
              type: 'relation_ref',
              typeLabel: '关系引用',
            }),
          ]),
        );
      });

    const fieldByLabel = new Map(fields.map((field) => [field.label, field]));
    const rival = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '裴照',
        aliases: ['照夜刀'],
        type: 'character',
        summary: '天门另一侧的守门人。',
        description: '与沈砚同出一门，却选择了献祭人间记忆。',
        tags: ['反派', '守门人'],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);

    const entityPayload = {
      name: '沈砚',
      aliases: ['守碑少年', '残剑客'],
      type: 'character',
      summary: '外冷内热的边城剑客。',
      description: '为找回被天门吞掉的母亲，带着残剑踏遍九州。',
      tags: ['主角', '剑修'],
      scope: 'chapter',
      status: 'locked',
      customFields: {
        [fieldByLabel.get('旧伤备注')!.key]: '左臂有旧伤，阴雨天会疼。',
        [fieldByLabel.get('年龄')!.key]: 23,
        [fieldByLabel.get('生辰')!.key]: '1999-03-04',
        [fieldByLabel.get('境界')!.key]: '筑基',
        [fieldByLabel.get('常用剑术')!.key]: ['御剑', '符箓'],
        [fieldByLabel.get('仍在追踪母亲')!.key]: true,
        [fieldByLabel.get('宿敌')!.key]: rival.body.id,
      },
    };
    const created = await author.agent
      .post(`${centerPath}/entities`)
      .send(entityPayload)
      .expect(201);

    expect(created.body).toMatchObject({
      ...entityPayload,
      typeLabel: '人物',
      scopeLabel: '当前章',
      statusLabel: '锁定',
    });

    await author.agent
      .get(`${centerPath}/entities/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(entityPayload);
        expect(body.customFields).toEqual(entityPayload.customFields);
      });

    await author.agent
      .patch(`${centerPath}/entities/${created.body.id}`)
      .send({ summary: '守碑少年，后来成为守门人。', status: 'proposal' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          name: '沈砚',
          aliases: ['守碑少年', '残剑客'],
          summary: '守碑少年，后来成为守门人。',
          status: 'proposal',
          statusLabel: '提案',
          customFields: entityPayload.customFields,
        });
      });

    await author.agent
      .get(`${centerPath}/entities`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(2);
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: '沈砚', type: 'character' }),
            expect.objectContaining({ name: '裴照', type: 'character' }),
          ]),
        );
      });
    await author.agent
      .get(`${centerPath}/entities?q=阴雨天`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((entity: { name: string }) => entity.name)).toEqual(['沈砚']);
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/entities`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await otherAuthor.agent
      .get(`${centerPath}/entities`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await author.agent
      .post(`${otherCenterPath}/entities`)
      .send({
        name: '另一个作品的人物',
        aliases: [],
        type: 'character',
        summary: '独立作品里的设定。',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);
  });

  it('creates every typed relation and rejects untyped or cross-work links', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const otherCenterPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}`;

    const createEntity = async (
      path: string,
      name: string,
      type: 'character' | 'faction' | 'map' | 'item_technique',
    ) =>
      (
        await author.agent
          .post(`${path}/entities`)
          .send({
            name,
            aliases: [],
            type,
            summary: `${name}的摘要`,
            description: '',
            tags: [],
            scope: 'work',
            status: 'draft',
          })
          .expect(201)
      ).body as { id: string; name: string };

    const shenYan = await createEntity(centerPath, '沈砚', 'character');
    const tianMen = await createEntity(centerPath, '天门', 'map');
    const wuZong = await createEntity(centerPath, '无宗', 'faction');
    const canJian = await createEntity(centerPath, '残剑', 'item_technique');
    const outsider = await createEntity(otherCenterPath, '雾海来客', 'character');
    const relations = [
      { predicate: 'subordinate', label: '隶属', to: wuZong.id },
      { predicate: 'located_in', label: '位于', to: tianMen.id },
      { predicate: 'controls', label: '控制', to: wuZong.id },
      { predicate: 'owns', label: '拥有', to: canJian.id },
      { predicate: 'knows', label: '知道', to: wuZong.id },
      { predicate: 'believes', label: '相信', to: tianMen.id },
      { predicate: 'kin', label: '亲属', to: shenYan.id },
      { predicate: 'hostile', label: '敌对', to: wuZong.id },
      { predicate: 'mentor', label: '师承', to: tianMen.id },
    ] as const;

    for (const [index, relation] of relations.entries()) {
      await author.agent
        .post(`${centerPath}/relations`)
        .send({
          fromEntityId: shenYan.id,
          predicate: relation.predicate,
          toEntityId: relation.to,
          validFrom: `玄元${index + 1}年`,
          validTo: null,
          source: '第 2 章手稿',
        })
        .expect(201)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            fromEntity: expect.objectContaining({ id: shenYan.id, name: '沈砚' }),
            toEntity: expect.objectContaining({ id: relation.to }),
            predicate: relation.predicate,
            predicateLabel: relation.label,
            validFrom: `玄元${index + 1}年`,
            source: '第 2 章手稿',
          });
        });
    }

    await author.agent
      .get(`${centerPath}/relations`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(9);
        expect(
          body.items.map((relation: { predicateLabel: string }) => relation.predicateLabel),
        ).toEqual(
          expect.arrayContaining([
            '隶属',
            '位于',
            '控制',
            '拥有',
            '知道',
            '相信',
            '亲属',
            '敌对',
            '师承',
          ]),
        );
      });

    await author.agent
      .get(`${centerPath}/relations?entityId=${shenYan.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(9);
      });

    await author.agent
      .post(`${centerPath}/relations`)
      .send({
        fromEntityId: shenYan.id,
        predicate: 'friend',
        toEntityId: wuZong.id,
        source: '自由文本关系',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    await author.agent
      .post(`${centerPath}/relations`)
      .send({
        fromEntityId: shenYan.id,
        predicate: 'knows',
        toEntityId: outsider.id,
        source: '跨作品引用',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('RELATION_ENTITY_INVALID');
      });
  });

  it('provides history subtypes and keeps them isolated from other packs', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(
      author.agent,
      '北境争鼎',
      'history',
      'alternate_ancient',
    );
    const xianxiaWork = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const xianxiaCenterPath = `/api/v1/works/${xianxiaWork.id}/branches/${xianxiaWork.mainBranchId}`;

    const fields = await author.agent.get(`${centerPath}/custom-fields`).expect(200);
    expect(fields.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'history_rank', label: '官阶', type: 'number' }),
        expect.objectContaining({ key: 'history_troops', label: '兵力', type: 'number' }),
        expect.objectContaining({
          key: 'history_provisions_shi',
          label: '随军粮草（石）',
          type: 'number',
        }),
      ]),
    );

    const dynasty = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '大朔',
        type: 'world',
        subtype: 'dynasty',
        summary: '北境起家的架空王朝。',
      })
      .expect(201);
    expect(dynasty.body).toMatchObject({
      subtype: 'dynasty',
      subtypeLabel: '朝代',
      typeLabel: '世界',
    });

    const bureaucracy = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '中书省',
        type: 'faction',
        subtype: 'bureaucracy',
        summary: '总领政务的官署。',
        customFields: { history_rank: 2 },
      })
      .expect(201);
    const military = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '朔州军',
        type: 'faction',
        subtype: 'military',
        summary: '驻守北境的边军。',
        customFields: {
          history_troops: 3_000,
          history_provisions_shi: 2_000,
        },
      })
      .expect(201);
    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '雁门道',
        type: 'map',
        subtype: 'geography',
        summary: '连接京畿与北境的狭长通道。',
      })
      .expect(201);
    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '崔氏',
        type: 'faction',
        subtype: 'clan',
        summary: '三代出过两位尚书的北地世家。',
        customFields: { history_influence: 82 },
      })
      .expect(201);

    await author.agent
      .get(`${centerPath}/entities?subtype=bureaucracy`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: bureaucracy.body.id,
          subtype: 'bureaucracy',
          subtypeLabel: '官制',
        });
      });
    await author.agent
      .get(`${centerPath}/entities?subtype=military`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({
            id: military.body.id,
            subtypeLabel: '军制',
          }),
        ]);
      });

    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '错误子类型',
        type: 'faction',
        subtype: 'sect',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    await author.agent
      .post(`${xianxiaCenterPath}/entities`)
      .send({
        name: '仙门官署',
        type: 'faction',
        subtype: 'bureaucracy',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('SUBTYPE_NOT_ALLOWED');
      });
  });

  it('searches settings and reports chapter and outline references', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'parallel-notes', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;

    const shenYan = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '沈砚',
        aliases: ['守碑少年', '残剑客'],
        type: 'character',
        summary: '外冷内热的边城剑客。',
        description: '为找回被天门吞掉的母亲，带着残剑踏遍九州。',
        tags: ['主角', '剑修'],
        scope: 'work',
        status: 'locked',
      })
      .expect(201);
    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '天门',
        aliases: [],
        type: 'map',
        summary: '只认记忆、不认血脉的九重门户。',
        description: '',
        tags: ['禁地'],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);
    const shortAlias = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '天意',
        aliases: ['天'],
        type: 'world',
        summary: '一个只用于验证短别名不会误报的概念。',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);

    await author.agent
      .put(`${centerPath}/chapter-outlines/1`)
      .send({
        chapterGoal: '沈砚在断碑前第一次引动残剑。',
        pov: '沈砚',
        sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕'],
        chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
      })
      .expect(200);
    await author.agent
      .post(`${centerPath}/chapters/1/versions`)
      .send({
        title: '断碑',
        content: '守碑少年抬起头，看见天门在雨幕后面缓缓合拢。',
      })
      .expect(201);
    await author.agent
      .put(`${centerPath}/chapter-outlines/2`)
      .send({
        chapterGoal: '沈砚带着残剑回到边城。',
        pov: '守碑少年',
        sceneBeats: ['边城戒严', '旧友认不出沈砚'],
        chapterEndHook: '城门口贴着他的通缉令。',
      })
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${parallelBranchId}/chapter-outlines/3`)
      .send({
        chapterGoal: '另一条创作线里，守碑少年没有走进天门。',
        pov: '沈砚',
        sceneBeats: ['雨停', '断碑沉默'],
        chapterEndHook: '他转身离开。',
      })
      .expect(200);

    await author.agent
      .get(`${centerPath}/entities?q=守碑少年`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({
            id: shenYan.body.id,
            name: '沈砚',
            summary: '外冷内热的边城剑客。',
          }),
        ]);
      });
    await author.agent
      .get(`${centerPath}/entities?q=残剑&tag=主角&type=character&status=locked`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((entity: { name: string }) => entity.name)).toEqual(['沈砚']);
      });
    await author.agent
      .get(`${centerPath}/entities?q=天门&type=map`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((entity: { name: string }) => entity.name)).toEqual(['天门']);
      });
    await author.agent
      .get(`${centerPath}/entities?q=不存在的人`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await author.agent
      .get(`${centerPath}/entities/${shenYan.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.references.chapters).toEqual([
          expect.objectContaining({
            chapterNumber: 1,
            title: '断碑',
            statusLabel: '写作中',
          }),
        ]);
        expect(body.references.outlines).toEqual([
          expect.objectContaining({
            chapterNumber: 1,
            chapterGoal: '沈砚在断碑前第一次引动残剑。',
            matchedFields: ['章目标', '叙事视角', '场景节拍'],
          }),
          expect.objectContaining({
            chapterNumber: 2,
            chapterGoal: '沈砚带着残剑回到边城。',
            matchedFields: ['章目标', '叙事视角', '场景节拍'],
          }),
        ]);
      });
    await author.agent
      .get(`${centerPath}/entities/${shortAlias.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.references.chapters).toEqual([]);
        expect(body.references.outlines).toEqual([]);
      });
  });

  it('rejects custom field values that do not match their field type', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const otherCenterPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}`;

    const numberField = await author.agent
      .post(`${centerPath}/custom-fields`)
      .send({ label: '年龄', type: 'number' })
      .expect(201);
    const singleSelectField = await author.agent
      .post(`${centerPath}/custom-fields`)
      .send({ label: '境界', type: 'single_select', options: ['炼气', '筑基'] })
      .expect(201);
    const dateField = await author.agent
      .post(`${centerPath}/custom-fields`)
      .send({ label: '生辰', type: 'date' })
      .expect(201);
    const relationField = await author.agent
      .post(`${centerPath}/custom-fields`)
      .send({ label: '宿敌', type: 'relation_ref' })
      .expect(201);
    const outsider = await author.agent
      .post(`${otherCenterPath}/entities`)
      .send({
        name: '雾海来客',
        aliases: [],
        type: 'character',
        summary: '',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);

    await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '沈砚',
        aliases: [],
        type: 'character',
        summary: '',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
        customFields: {
          [numberField.body.key]: '二十三',
          [singleSelectField.body.key]: '金丹',
          [dateField.body.key]: '1999-02-31',
          [relationField.body.key]: outsider.body.id,
        },
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('CUSTOM_FIELD_INVALID');
        expect(body.details.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: '年龄' }),
            expect.objectContaining({ field: '境界' }),
            expect.objectContaining({ field: '生辰' }),
            expect.objectContaining({ field: '宿敌' }),
          ]),
        );
      });

    await otherAuthor.agent.get(`${centerPath}/entities`).expect(404);
  });
});
