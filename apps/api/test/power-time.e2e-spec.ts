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
  return `power-time-${randomUUID()}@example.com`;
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
  input: { name: string; type: 'character' | 'power_system' | 'item_technique' | 'timeline' },
) {
  const response = await agent
    .post(`${centerPath}/entities`)
    .send({
      name: input.name,
      aliases: [],
      type: input.type,
      summary: `${input.name}的摘要`,
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
    })
    .expect(201);
  return response.body as { id: string; name: string; type: string };
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

describe('power, golden finger, items, and timeline API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/13';
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

  it('saves a power hierarchy and explains what blocks a breakthrough', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const powerSystem = await createEntity(author.agent, centerPath, {
      name: '九境剑道',
      type: 'power_system',
    });

    const profileInput = {
      levels: [
        { name: '炼气', order: 1, description: '引气入体。' },
        { name: '筑基', order: 2, description: '道基初成。' },
        { name: '金丹', order: 3, description: '结成金丹。' },
      ],
      paths: [
        {
          name: '剑修',
          description: '以剑意破境，攻伐最盛。',
          levels: ['炼气', '筑基', '金丹'],
        },
        {
          name: '符修',
          description: '以符箓借天地之力。',
          levels: ['炼气', '筑基'],
        },
      ],
      breakthroughs: [
        {
          fromLevel: '炼气',
          toLevel: '筑基',
          conditions: ['剑意初成', '心境无隙'],
          costs: ['十年寿元'],
          bottlenecks: ['经脉未固'],
          counters: ['雷法', '镇魂钟'],
          resources: [{ name: '下品灵石', amount: 3 }],
        },
      ],
    };

    await author.agent
      .get(`${centerPath}/power-systems/${powerSystem.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.levels).toEqual([]);
        expect(body.paths).toEqual([]);
        expect(body.breakthroughs).toEqual([]);
      });

    await author.agent
      .put(`${centerPath}/power-systems/${powerSystem.id}`)
      .send(profileInput)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(profileInput);
        expect(body.totalLevels).toBe(3);
        expect(body.totalPaths).toBe(2);
      });

    await author.agent
      .post(`${centerPath}/power-systems/${powerSystem.id}/breakthrough-check`)
      .send({
        fromLevel: '炼气',
        toLevel: '筑基',
        conditionsMet: ['剑意初成'],
        resourcesAvailable: [{ name: '下品灵石', amount: 2 }],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.allowed).toBe(false);
        expect(body.missingConditions).toEqual(['心境无隙']);
        expect(body.missingResources).toEqual([{ name: '下品灵石', required: 3, available: 2 }]);
      });

    await author.agent
      .post(`${centerPath}/power-systems/${powerSystem.id}/breakthrough-check`)
      .send({
        fromLevel: '炼气',
        toLevel: '筑基',
        conditionsMet: ['剑意初成', '心境无隙'],
        resourcesAvailable: [{ name: '下品灵石', amount: 3 }],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.allowed).toBe(true);
        expect(body.missingConditions).toEqual([]);
        expect(body.missingResources).toEqual([]);
      });
  });

  it('keeps golden finger rules, costs, limits, and growth stages for a setting owner', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const powerSystem = await createEntity(author.agent, centerPath, {
      name: '九境剑道',
      type: 'power_system',
    });
    const protagonist = await createEntity(author.agent, centerPath, {
      name: '沈砚',
      type: 'character',
    });

    const created = await author.agent
      .post(`${centerPath}/golden-fingers`)
      .send({
        ownerEntityId: powerSystem.id,
        name: '残剑借命',
        rules: ['可以借来亡者最后一剑', '借剑必须说出亡者姓名'],
        costs: ['每借一次忘掉一个活人的名字'],
        limits: ['每次只持续九息', '同一个人不能连续借剑'],
        growthCurve: [
          { stage: '初醒', description: '只能借炼气修士的最后一剑。' },
          { stage: '共鸣', description: '可以借筑基修士的最后一剑。' },
        ],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      ownerEntityId: powerSystem.id,
      ownerEntity: { id: powerSystem.id, name: '九境剑道', type: 'power_system' },
      name: '残剑借命',
      rules: ['可以借来亡者最后一剑', '借剑必须说出亡者姓名'],
      costs: ['每借一次忘掉一个活人的名字'],
      limits: ['每次只持续九息', '同一个人不能连续借剑'],
      growthCurve: [
        { stage: '初醒', description: '只能借炼气修士的最后一剑。' },
        { stage: '共鸣', description: '可以借筑基修士的最后一剑。' },
      ],
    });

    await author.agent
      .post(`${centerPath}/golden-fingers`)
      .send({
        ownerEntityId: protagonist.id,
        name: '过目不忘',
        rules: ['看过一页就能复述'],
        costs: [],
        limits: ['每夜只能记住一页'],
        growthCurve: [{ stage: '入门', description: '每天一页。' }],
      })
      .expect(201);

    await author.agent
      .get(`${centerPath}/golden-fingers?ownerEntityId=${powerSystem.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          name: '残剑借命',
          ownerEntity: expect.objectContaining({ id: powerSystem.id }),
        });
      });

    await author.agent
      .patch(`${centerPath}/golden-fingers/${created.body.id}`)
      .send({
        limits: ['每次只持续九息', '同一个人不能连续借剑', '月圆之夜无法借剑'],
        growthCurve: [
          { stage: '初醒', description: '只能借炼气修士的最后一剑。' },
          { stage: '共鸣', description: '可以借筑基修士的最后一剑。' },
          { stage: '问心', description: '可借金丹修士的最后一剑，并保留一个名字。' },
        ],
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.limits).toHaveLength(3);
        expect(body.rules).toEqual(['可以借来亡者最后一剑', '借剑必须说出亡者姓名']);
        expect(body.costs).toEqual(['每借一次忘掉一个活人的名字']);
        expect(body.growthCurve.map((point: { stage: string }) => point.stage)).toEqual([
          '初醒',
          '共鸣',
          '问心',
        ]);
      });
  });

  it('blocks a second current owner until the item ownership is ended', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const item = await createEntity(author.agent, centerPath, {
      name: '残剑',
      type: 'item_technique',
    });
    const shenYan = await createEntity(author.agent, centerPath, {
      name: '沈砚',
      type: 'character',
    });
    const peiZhao = await createEntity(author.agent, centerPath, {
      name: '裴照',
      type: 'character',
    });

    const profileInput = {
      kind: 'item',
      grade: '天阶',
      effects: ['可斩断护体真气', '剑鸣时能唤醒亡者残念'],
      costs: ['每次出鞘消耗持剑者一段记忆'],
      restrictions: ['非剑修不可拔剑', '月圆之夜无法出鞘'],
    };
    await author.agent
      .put(`${centerPath}/items-techniques/${item.id}`)
      .send(profileInput)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(profileInput);
        expect(body.ownerships).toEqual([]);
      });

    const firstOwnership = await author.agent
      .post(`${centerPath}/items-techniques/${item.id}/ownerships`)
      .send({
        ownerEntityId: shenYan.id,
        fromTime: '第 1 章',
        source: '断碑认主',
      })
      .expect(201);
    expect(firstOwnership.body).toMatchObject({
      ownerEntity: { id: shenYan.id, name: '沈砚', type: 'character' },
      fromTime: '第 1 章',
      endedAt: null,
      current: true,
      source: '断碑认主',
    });

    await author.agent
      .post(`${centerPath}/items-techniques/${item.id}/ownerships`)
      .send({
        ownerEntityId: peiZhao.id,
        fromTime: '第 4 章',
        source: '强行夺剑',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('ITEM_OWNERSHIP_CONFLICT');
        expect(body.details.currentOwner).toMatchObject({
          ownerEntityId: shenYan.id,
          ownerName: '沈砚',
        });
      });

    await author.agent
      .patch(`${centerPath}/items-techniques/${item.id}/ownerships/${firstOwnership.body.id}/end`)
      .send({ endedAt: '第 3 章' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.endedAt).toBe('第 3 章');
        expect(body.current).toBe(false);
      });

    await author.agent
      .post(`${centerPath}/items-techniques/${item.id}/ownerships`)
      .send({
        ownerEntityId: peiZhao.id,
        fromTime: '第 4 章',
        source: '强行夺剑',
      })
      .expect(201);

    await author.agent
      .get(`${centerPath}/items-techniques/${item.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.ownerships).toHaveLength(2);
        expect(body.currentOwner).toMatchObject({
          ownerEntityId: peiZhao.id,
          ownerName: '裴照',
        });
      });
  });

  it('orders timeline eras, absolute dates, relative times, durations, and event nodes', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const timeline = await createEntity(author.agent, centerPath, {
      name: '九州纪年',
      type: 'timeline',
    });

    await author.agent
      .get(`${centerPath}/timelines/${timeline.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.eras).toEqual([]);
        expect(body.nodes).toEqual([]);
      });

    const era = await author.agent
      .post(`${centerPath}/timelines/${timeline.id}/eras`)
      .send({
        name: '玄元',
        summary: '天门初开后的纪年。',
        startDate: { year: 1, month: 1, day: 1, note: '开国之日' },
        endDate: { year: 120, month: 12, day: 31, note: '' },
      })
      .expect(201);
    expect(era.body).toMatchObject({
      name: '玄元',
      summary: '天门初开后的纪年。',
      startDate: { year: 1, month: 1, day: 1, note: '开国之日' },
      startDateLabel: '1年1月1日（开国之日）',
    });

    const firstNode = await author.agent
      .post(`${centerPath}/timelines/${timeline.id}/nodes`)
      .send({
        title: '断碑初鸣',
        summary: '沈砚在荒寺发现残剑。',
        eraId: era.body.id,
        absoluteDate: { year: 12, month: 4, day: 9, note: '' },
        relativeTime: '',
        relativeToNodeId: null,
        duration: { amount: 3, unit: 'day' },
        orderIndex: 1,
      })
      .expect(201);
    expect(firstNode.body).toMatchObject({
      title: '断碑初鸣',
      eraId: era.body.id,
      absoluteDate: { year: 12, month: 4, day: 9, note: '' },
      absoluteDateLabel: '12年4月9日',
      duration: { amount: 3, unit: 'day' },
      durationLabel: '3天',
    });

    const secondNode = await author.agent
      .post(`${centerPath}/timelines/${timeline.id}/nodes`)
      .send({
        title: '边城戒严',
        summary: '沈砚三日后回到边城。',
        eraId: era.body.id,
        absoluteDate: null,
        relativeTime: '三日后',
        relativeToNodeId: firstNode.body.id,
        duration: { amount: 9, unit: 'hour' },
        orderIndex: 2,
      })
      .expect(201);
    expect(secondNode.body).toMatchObject({
      relativeTime: '三日后',
      relativeToNodeId: firstNode.body.id,
      relativeToNode: { id: firstNode.body.id, title: '断碑初鸣' },
      durationLabel: '9小时',
    });

    await author.agent
      .patch(`${centerPath}/timelines/${timeline.id}/nodes/${secondNode.body.id}`)
      .send({ summary: '沈砚三日后抵达边城，城门已经戒严。' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary).toBe('沈砚三日后抵达边城，城门已经戒严。');
        expect(body.relativeToNode).toMatchObject({ id: firstNode.body.id });
      });

    await author.agent
      .get(`${centerPath}/timelines/${timeline.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.eras).toHaveLength(1);
        expect(body.nodes.map((node: { title: string }) => node.title)).toEqual([
          '断碑初鸣',
          '边城戒严',
        ]);
      });
  });

  it('isolates structured settings by work, branch, and author', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const branchId = await createParallelBranch(app, work.id, author.userId, 'what-if');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const parallelPath = `/api/v1/works/${work.id}/branches/${branchId}`;
    const powerSystem = await createEntity(author.agent, centerPath, {
      name: '九境剑道',
      type: 'power_system',
    });
    const item = await createEntity(author.agent, centerPath, {
      name: '残剑',
      type: 'item_technique',
    });
    const timeline = await createEntity(author.agent, centerPath, {
      name: '九州纪年',
      type: 'timeline',
    });

    await author.agent
      .put(`${centerPath}/power-systems/${powerSystem.id}`)
      .send({
        levels: [
          { name: '炼气', order: 1, description: '' },
          { name: '筑基', order: 2, description: '' },
        ],
        paths: [],
        breakthroughs: [],
      })
      .expect(200);
    await author.agent
      .post(`${centerPath}/golden-fingers`)
      .send({
        ownerEntityId: powerSystem.id,
        name: '残剑借命',
        rules: ['借亡者最后一剑'],
        costs: ['忘掉一个名字'],
        limits: ['九息'],
        growthCurve: [],
      })
      .expect(201);

    await author.agent
      .get(`${parallelPath}/power-systems/${powerSystem.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('SETTING_NOT_FOUND');
      });
    await author.agent.get(`${parallelPath}/items-techniques/${item.id}`).expect(404);
    await author.agent.get(`${parallelPath}/timelines/${timeline.id}`).expect(404);
    await author.agent
      .get(`${parallelPath}/golden-fingers?ownerEntityId=${powerSystem.id}`)
      .expect(404);

    await otherAuthor.agent
      .get(`${centerPath}/power-systems/${powerSystem.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .get(`${centerPath}/items-techniques/${item.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent.get(`${centerPath}/timelines/${timeline.id}`).expect(404);

    await author.agent.get(`${centerPath}/power-systems/${powerSystem.id}`).expect(200);
    await author.agent
      .get(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/golden-fingers`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
  });
});
