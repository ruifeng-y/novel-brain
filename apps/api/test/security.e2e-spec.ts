import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/redis/redis.service';

const DATABASE_NAME = 'novel_security_test';
const OWNER_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
const TEST_DATABASE_URL = `postgres://novel:novel@127.0.0.1:5432/${DATABASE_NAME}`;
const APP_DATABASE_URL = `postgres://novel_app:novel_app@127.0.0.1:5432/${DATABASE_NAME}`;

describe('security boundaries', () => {
  let owner: Pool;
  let appRole: Pool;
  let app: INestApplication;
  let workerApp: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: OWNER_URL });
    const existing = await admin.query('select 1 from pg_database where datname = $1', [
      DATABASE_NAME,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`create database ${DATABASE_NAME}`);
    }
    await admin.end();

    const migrated = createDatabase(TEST_DATABASE_URL);
    await migrated.pool.query('drop schema if exists drizzle cascade');
    await migrated.pool.query('drop schema public cascade');
    await migrated.pool.query('create schema public');
    await migrate(migrated.db, {
      migrationsFolder: path.resolve(process.cwd(), 'packages/db/migrations'),
    });
    await migrated.pool.end();

    owner = new Pool({ connectionString: TEST_DATABASE_URL });
    appRole = new Pool({ connectionString: APP_DATABASE_URL });

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = APP_DATABASE_URL;
    process.env.DATABASE_ADMIN_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/9';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-16-characters';
    process.env.MODEL_KEY_ENCRYPTION_KEY =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    process.env.AI_PROVIDER = 'fake';
    passwordHash = await hash('correct horse battery staple', {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

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

    const { WorkerModule } = await import('../../worker/src/worker.module');
    const workerRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    workerApp = workerRef.createNestApplication();
    await workerApp.init();
  });

  afterAll(async () => {
    await workerApp.close();
    await app.close();
    await appRole.end();
    await owner.end();
  });

  beforeEach(async () => {
    const redis = app.get(RedisService).client;
    const keys = await redis.keys('auth:*');
    const rateKeys = await redis.keys('rate:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    if (rateKeys.length > 0) {
      await redis.del(...rateKeys);
    }
  });

  it('hides and protects another author work through row-level security', async () => {
    const aliceId = '11111111-1111-4111-8111-111111111111';
    const bobId = '22222222-2222-4222-8222-222222222222';
    const aliceWorkId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const bobWorkId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    await owner.query(
      `insert into users (id, email, password_hash, display_name)
       values ($1, 'alice-security@example.com', 'unused', 'Alice'),
              ($2, 'bob-security@example.com', 'unused', 'Bob')
       on conflict (id) do nothing`,
      [aliceId, bobId],
    );
    await owner.query(
      `insert into works (id, user_id, title, pen_name, genre_pack, scale, target_platform)
       values ($1, $2, 'Alice 的书', 'Alice', 'xianxia', 'long', '起点中文网'),
              ($3, $4, 'Bob 的书', 'Bob', 'xianxia', 'long', '起点中文网')
       on conflict (id) do nothing`,
      [aliceWorkId, aliceId, bobWorkId, bobId],
    );

    const client = await appRole.connect();
    try {
      await client.query("select set_config('app.user_id', $1, false)", [aliceId]);

      const visible = await client.query<{ id: string }>('select id from works order by id');
      expect(visible.rows).toEqual([{ id: aliceWorkId }]);

      const protectedUpdate = await client.query(
        `update works set title = '被越权改了' where id = $1`,
        [bobWorkId],
      );
      expect(protectedUpdate.rowCount).toBe(0);
    } finally {
      await client.query("select set_config('app.user_id', '', false)");
      client.release();
    }
  });

  it('forces row-level security on every author-owned table', async () => {
    const tenantTables = [
      'users',
      'sessions',
      'pen_names',
      'model_configs',
      'works',
      'work_branches',
      'story_bibles',
      'story_bible_revisions',
      'foreshadows',
      'threads',
      'character_arcs',
      'chapter_outlines',
      'entity_custom_fields',
      'entities',
      'character_profiles',
      'character_states',
      'character_state_revisions',
      'entity_relations',
      'power_system_profiles',
      'golden_fingers',
      'item_technique_profiles',
      'item_ownerships',
      'timeline_eras',
      'timeline_event_nodes',
      'chapters',
      'chapter_versions',
      'generation_requests',
      'context_packs',
      'drafts',
      'fact_proposals',
      'facts',
      'annotations',
      'quality_reports',
      'canon_commits',
      'canon_snapshots',
      'jobs',
      'job_steps',
      'job_checkpoints',
      'job_events',
      'job_chapters',
      'job_reports',
      'change_requests',
      'change_impact_reports',
      'change_validations',
      'audit_logs',
      'map_nodes',
      'map_connections',
      'map_images',
      'map_markers',
      'character_presences',
      'branch_commits',
      'branch_id_mappings',
    ];
    const result = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relnamespace = 'public'::regnamespace
         and relname = any($1::text[])
       order by relname`,
      [tenantTables],
    );

    expect(result.rows.map((row) => row.relname)).toEqual([...tenantTables].sort());
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('keeps account data isolated through the API while using the restricted role', async () => {
    const createAuthor = async (email: string) => {
      const inserted = await owner.query<{ id: string }>(
        `insert into users (email, password_hash, display_name)
         values ($1, $2, $3)
         returning id`,
        [email, passwordHash, email.slice(0, email.indexOf('@'))],
      );
      const agent = request.agent(app.getHttpServer());
      const login = await agent
        .post('/api/v1/auth/login')
        .send({ email, password: 'correct horse battery staple' })
        .expect(200);
      return { id: inserted.rows[0].id, agent, login };
    };

    const alice = await createAuthor(`api-alice-${randomUUID()}@example.com`);
    const bob = await createAuthor(`api-bob-${randomUUID()}@example.com`);

    const created = await alice.agent
      .post('/api/v1/works')
      .send({
        title: 'Alice 的仙途',
        penName: 'Alice',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);

    await alice.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);
      });
    await alice.agent
      .get(`/api/v1/works/${created.body.id}/branches/${created.body.mainBranch.id}/version-points`)
      .expect(200);

    await bob.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await bob.agent.get(`/api/v1/works/${created.body.id}`).expect(404);
    await bob.agent
      .get(`/api/v1/works/${created.body.id}/branches/${created.body.mainBranch.id}/version-points`)
      .expect(404);
  });

  it('rate limits account exports and never includes a model key', async () => {
    const email = `export-${randomUUID()}@example.com`;
    await owner.query(
      `insert into users (email, password_hash, display_name)
       values ($1, $2, '导出作者')
       `,
      [email, passwordHash],
    );
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);

    await agent
      .post('/api/v1/works')
      .send({
        title: '导出之书',
        penName: '导出作者',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);

    const apiKey = 'sk-export-must-never-leak';
    await agent
      .post('/api/v1/model-configs')
      .send({
        name: '导出测试模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey,
        purpose: 'prose',
      })
      .expect(201);

    const first = await agent.post('/api/v1/users/me/export').expect(202);
    expect(first.body.status).toBe('queued');
    expect(first.body.id).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain(apiKey);

    await agent.post('/api/v1/users/me/export').expect(202);
    await agent.post('/api/v1/users/me/export').expect(202);
    await agent
      .post('/api/v1/users/me/export')
      .expect(429)
      .expect(({ body }) => {
        expect(body.code).toBe('RATE_LIMITED');
      });
  });

  it('rate limits chapter generation requests per author', async () => {
    const email = `generation-limit-${randomUUID()}@example.com`;
    await owner.query(
      `insert into users (email, password_hash, display_name)
       values ($1, $2, '限流作者')`,
      [email, passwordHash],
    );
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);

    const work = await agent
      .post('/api/v1/works')
      .send({
        title: '限流之书',
        penName: '限流作者',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await agent.post(
        `/api/v1/works/${work.body.id}/branches/${work.body.mainBranch.id}/chapters/1/generate`,
      );
      expect(response.status).not.toBe(429);
    }

    await agent
      .post(`/api/v1/works/${work.body.id}/branches/${work.body.mainBranch.id}/chapters/1/generate`)
      .expect(429)
      .expect(({ body }) => {
        expect(body.code).toBe('RATE_LIMITED');
      });
  });

  it('runs background generation inside the author tenant context', async () => {
    const email = `generation-worker-${randomUUID()}@example.com`;
    await owner.query(
      `insert into users (email, password_hash, display_name)
       values ($1, $2, '后台作者')`,
      [email, passwordHash],
    );
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);
    const work = await agent
      .post('/api/v1/works')
      .send({
        title: '后台生成之书',
        penName: '后台作者',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);
    const workId = work.body.id as string;
    const branchId = work.body.mainBranch.id as string;

    await agent
      .put(`/api/v1/works/${workId}/branches/${branchId}/story-bible`)
      .send({
        oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
        protagonist: '沈砚，外冷内热的边城剑客',
        worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
      })
      .expect(200);
    await agent
      .put(`/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/1`)
      .send({
        chapterGoal: '沈砚在断碑前第一次引动残剑。',
        pov: '沈砚',
        sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
        chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
      })
      .expect(200);
    await agent
      .post('/api/v1/model-configs')
      .send({
        name: '后台正文模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: 'sk-worker-context-test',
        purpose: 'prose',
        isDefault: true,
      })
      .expect(201);

    const started = await agent
      .post(`/api/v1/works/${workId}/branches/${branchId}/chapters/1/generate`)
      .send({})
      .expect(202);

    let completed = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const job = await agent
        .get(`/api/v1/works/${workId}/branches/${branchId}/jobs/${started.body.jobId}`)
        .expect(200);
      if (job.body.status === 'completed') {
        completed = true;
        break;
      }
      if (job.body.status === 'failed') {
        throw new Error(JSON.stringify(job.body.error));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(completed).toBe(true);
  });
});
