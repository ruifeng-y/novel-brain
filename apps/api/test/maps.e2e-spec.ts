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
  return `map-faction-${randomUUID()}@example.com`;
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

describe('map and faction API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/10';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.MINIO_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.MINIO_ACCESS_KEY = 'minio';
    process.env.MINIO_SECRET_KEY = 'minio123';
    process.env.MINIO_BUCKET = 'novel-brain';
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
      .get(`/api/v1/works/${workId}/branches/${branchId}/maps`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('builds a six-level map and records travel time by work and creation line', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'what-if-map', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const mapPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/maps`;
    const otherMapPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/maps`;

    const createNode = async (
      path: string,
      input: { name: string; level: string; parentNodeId?: string; summary?: string },
    ) =>
      (
        await author.agent
          .post(`${path}/nodes`)
          .send({
            summary: '',
            ...input,
          })
          .expect(201)
      ).body as {
        id: string;
        entityId: string;
        name: string;
        level: string;
        levelLabel: string;
        parentNodeId: string | null;
      };

    const world = await createNode(mapPath, {
      name: '九洲',
      level: 'world',
      summary: '有九重天门的完整世界。',
    });
    const realm = await createNode(mapPath, {
      name: '人间界',
      level: 'realm',
      parentNodeId: world.id,
    });
    const continent = await createNode(mapPath, {
      name: '东荒',
      level: 'continent',
      parentNodeId: realm.id,
    });
    const region = await createNode(mapPath, {
      name: '青岚郡',
      level: 'region',
      parentNodeId: continent.id,
    });
    const city = await createNode(mapPath, {
      name: '临渊城',
      level: 'city',
      parentNodeId: region.id,
    });
    const location = await createNode(mapPath, {
      name: '断碑古寺',
      level: 'location',
      parentNodeId: city.id,
    });

    expect(world).toMatchObject({
      name: '九洲',
      level: 'world',
      levelLabel: '世界',
      parentNodeId: null,
    });
    expect([realm, continent, region, city, location].map((node) => node.levelLabel)).toEqual([
      '界面',
      '大陆',
      '区域',
      '城市',
      '地点',
    ]);

    await author.agent
      .get(`${mapPath}/nodes`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(6);
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: location.id, parentNodeId: city.id }),
            expect.objectContaining({ id: city.id, parentNodeId: region.id }),
          ]),
        );
      });

    const connection = await author.agent
      .post(`${mapPath}/connections`)
      .send({
        fromNodeId: location.id,
        toNodeId: city.id,
        travelMinutes: 45,
      })
      .expect(201);
    expect(connection.body).toMatchObject({
      fromNode: expect.objectContaining({ id: location.id, name: '断碑古寺' }),
      toNode: expect.objectContaining({ id: city.id, name: '临渊城' }),
      travelMinutes: 45,
    });

    await author.agent
      .get(`${mapPath}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nodes).toHaveLength(6);
        expect(body.connections).toEqual([
          expect.objectContaining({
            fromNode: expect.objectContaining({ id: location.id }),
            toNode: expect.objectContaining({ id: city.id }),
            travelMinutes: 45,
          }),
        ]);
      });

    await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '错位大陆',
        level: 'continent',
        parentNodeId: location.id,
        summary: '',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('MAP_PARENT_INVALID');
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/maps`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nodes).toEqual([]);
      });

    await otherAuthor.agent
      .get(mapPath)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });

    await author.agent
      .post(`${otherMapPath}/nodes`)
      .send({
        name: '另一片海',
        level: 'world',
        summary: '',
      })
      .expect(201);
  });

  it('surfaces time-valid faction control over places on the map', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'faction-what-if', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const mapPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/maps`;
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    const world = await author.agent
      .post(`${mapPath}/nodes`)
      .send({ name: '九洲', level: 'world', summary: '' })
      .expect(201);
    const region = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '青岚郡',
        level: 'region',
        parentNodeId: world.body.id,
        summary: '',
      })
      .expect(201);
    const city = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '临渊城',
        level: 'city',
        parentNodeId: region.body.id,
        summary: '',
      })
      .expect(201);
    const faction = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '无宗',
        aliases: [],
        type: 'faction',
        summary: '盘踞东荒的宗门。',
        description: '',
        tags: ['势力'],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);

    await author.agent
      .post(`${centerPath}/relations`)
      .send({
        fromEntityId: faction.body.id,
        predicate: 'controls',
        toEntityId: city.body.entityId,
        validFrom: '玄元三年',
        validTo: '玄元五年',
        source: '第一卷手稿',
      })
      .expect(201);

    await author.agent
      .get(mapPath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.factionControls).toEqual([
          expect.objectContaining({
            faction: expect.objectContaining({ id: faction.body.id, name: '无宗' }),
            place: expect.objectContaining({ id: city.body.id, name: '临渊城' }),
            validFrom: '玄元三年',
            validTo: '玄元五年',
            source: '第一卷手稿',
          }),
        ]);
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/maps`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.factionControls).toEqual([]);
      });
  });

  it('stores a re-encoded map image and places a marker point', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'image-what-if', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const mapPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/maps`;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    const world = await author.agent
      .post(`${mapPath}/nodes`)
      .send({ name: '九洲', level: 'world', summary: '' })
      .expect(201);
    const continent = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '东荒',
        level: 'continent',
        parentNodeId: world.body.id,
        summary: '',
      })
      .expect(201);

    const uploaded = await author.agent
      .post(`${mapPath}/images`)
      .field('nodeId', world.body.id)
      .attach('image', png, { filename: 'world.png', contentType: 'image/png' })
      .expect(201);
    expect(uploaded.body).toMatchObject({
      nodeId: world.body.id,
      mimeType: 'image/webp',
      width: 1,
      height: 1,
    });
    expect(uploaded.body.contentUrl).toMatch(
      new RegExp(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/maps/images/.+/content`),
    );

    await author.agent
      .get(uploaded.body.contentUrl)
      .expect(200)
      .expect('Content-Type', /image\/webp/);

    const marker = await author.agent
      .post(`${mapPath}/images/${uploaded.body.id}/markers`)
      .send({
        nodeId: continent.body.id,
        xPercent: 32.5,
        yPercent: 68,
      })
      .expect(201);
    expect(marker.body).toMatchObject({
      imageId: uploaded.body.id,
      node: expect.objectContaining({ id: continent.body.id, name: '东荒' }),
      xPercent: 32.5,
      yPercent: 68,
    });

    await author.agent
      .get(mapPath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.images).toEqual([
          expect.objectContaining({
            id: uploaded.body.id,
            nodeId: world.body.id,
            markers: [
              expect.objectContaining({
                id: marker.body.id,
                node: expect.objectContaining({ id: continent.body.id }),
              }),
            ],
          }),
        ]);
      });

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await author.agent
      .post(`${mapPath}/images`)
      .field('nodeId', continent.body.id)
      .attach('image', svg, { filename: 'map.svg', contentType: 'image/svg+xml' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('MAP_IMAGE_INVALID');
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/maps`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.images).toEqual([]);
      });
  });

  it('reports a character appearing in two places at the same story time', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'presence-what-if', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const mapPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/maps`;
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    const world = await author.agent
      .post(`${mapPath}/nodes`)
      .send({ name: '九洲', level: 'world', summary: '' })
      .expect(201);
    const region = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '东荒',
        level: 'region',
        parentNodeId: world.body.id,
        summary: '',
      })
      .expect(201);
    const cityA = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '临渊城',
        level: 'city',
        parentNodeId: region.body.id,
        summary: '',
      })
      .expect(201);
    const cityB = await author.agent
      .post(`${mapPath}/nodes`)
      .send({
        name: '落霞城',
        level: 'city',
        parentNodeId: region.body.id,
        summary: '',
      })
      .expect(201);
    const character = await author.agent
      .post(`${centerPath}/entities`)
      .send({
        name: '沈砚',
        aliases: [],
        type: 'character',
        summary: '边城剑客。',
        description: '',
        tags: ['主角'],
        scope: 'work',
        status: 'draft',
      })
      .expect(201);

    const first = await author.agent
      .post(`${mapPath}/presences`)
      .send({
        characterEntityId: character.body.id,
        locationNodeId: cityA.body.id,
        storyTime: '第三章清晨',
        source: '第三章草稿',
      })
      .expect(201);
    await author.agent
      .post(`${mapPath}/presences`)
      .send({
        characterEntityId: character.body.id,
        locationNodeId: cityB.body.id,
        storyTime: '第三章清晨',
        source: '第四章草稿',
      })
      .expect(201);
    await author.agent
      .post(`${mapPath}/presences`)
      .send({
        characterEntityId: character.body.id,
        locationNodeId: cityB.body.id,
        storyTime: '第三日黄昏',
        source: '第四章结尾',
      })
      .expect(201);

    await author.agent
      .get(`${mapPath}/conflicts`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({
            character: expect.objectContaining({ id: character.body.id, name: '沈砚' }),
            storyTime: '第三章清晨',
            locations: expect.arrayContaining([
              expect.objectContaining({ id: cityA.body.id, name: '临渊城' }),
              expect.objectContaining({ id: cityB.body.id, name: '落霞城' }),
            ]),
          }),
        ]);
      });

    await author.agent
      .delete(`${mapPath}/presences/${first.body.id}`)
      .expect(200)
      .expect({ deleted: true });
    await author.agent
      .get(`${mapPath}/conflicts`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/maps/conflicts`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
  });
});
