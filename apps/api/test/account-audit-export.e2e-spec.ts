import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import JSZip from 'jszip';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/redis/redis.service';

const DATABASE_NAME = 'novel_account_audit_export_test';
const OWNER_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
const TEST_DATABASE_URL = `postgres://novel:novel@127.0.0.1:5432/${DATABASE_NAME}`;
const APP_DATABASE_URL = `postgres://novel_app:novel_app@127.0.0.1:5432/${DATABASE_NAME}`;

describe('account audit and complete data export', () => {
  let owner: Pool;
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
    passwordHash = await hash('correct horse battery staple', {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = APP_DATABASE_URL;
    process.env.DATABASE_ADMIN_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/8';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-16-characters';
    process.env.MODEL_KEY_ENCRYPTION_KEY =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    process.env.AI_PROVIDER = 'fake';
    process.env.MINIO_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.MINIO_ACCESS_KEY = 'minio';
    process.env.MINIO_SECRET_KEY = 'minio123';
    process.env.MINIO_BUCKET = 'novel-brain';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    const redis = app.get(RedisService).client;
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => redis.once('ready', resolve));
    }

    const { WorkerModule } = await import('../../worker/src/worker.module');
    const workerRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    workerApp = workerRef.createNestApplication();
    await workerApp.init();
  });

  afterAll(async () => {
    await workerApp.close();
    await app.close();
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

  async function createAuthor(email: string) {
    const inserted = await owner.query<{ id: string }>(
      `insert into users (email, password_hash, display_name)
       values ($1, $2, $3)
       returning id`,
      [email, passwordHash, email.slice(0, email.indexOf('@'))],
    );
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);
    return { id: inserted.rows[0].id, agent };
  }

  it('records sign-in and sign-out events that can be searched and exported per author', async () => {
    const email = `audit-${randomUUID()}@example.com`;
    const alice = await createAuthor(email);
    const bob = await createAuthor(`bob-${randomUUID()}@example.com`);

    await alice.agent.post('/api/v1/auth/logout').expect(204);
    await alice.agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);

    const login = await alice.agent
      .get('/api/v1/users/me/audit')
      .query({ action: 'auth.login_succeeded', limit: 20 })
      .expect(200);
    expect(login.body.items).toHaveLength(2);
    expect(login.body.items[0]).toMatchObject({
      action: 'auth.login_succeeded',
      actionLabel: '登录',
      actorName: email.slice(0, email.indexOf('@')),
    });
    expect(login.body.items[0].metadata).toMatchObject({ email });

    const logout = await alice.agent
      .get('/api/v1/users/me/audit')
      .query({ q: '退出', limit: 20 })
      .expect(200);
    expect(logout.body.items.map((item: { action: string }) => item.action)).toContain(
      'auth.logout',
    );

    const bobAudit = await bob.agent.get('/api/v1/users/me/audit').expect(200);
    expect(bobAudit.body.items).toHaveLength(1);
    expect(JSON.stringify(bobAudit.body)).not.toContain(email);

    const csv = await alice.agent
      .get('/api/v1/users/me/audit/export')
      .query({ q: '退出' })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.text).toContain('退出当前设备');
    expect(csv.text).not.toContain('correct horse battery staple');
  });

  it('audits model key changes, generation requests, and generation decisions without secrets', async () => {
    const alice = await createAuthor(`decisions-${randomUUID()}@example.com`);
    const work = await alice.agent
      .post('/api/v1/works')
      .send({
        title: '审计之书',
        penName: '青灯',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);
    const workId = work.body.id as string;
    const branchId = work.body.mainBranch.id as string;
    await owner.query(
      `insert into chapter_outlines
         (work_id, branch_id, level, title, summary, details, chapter_number)
       values ($1, $2, 'chapter', '第一章', '', '', 1)`,
      [workId, branchId],
    );
    const chapter = await owner.query<{ id: string }>(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, word_count)
       values ($1, $2, 1, '第一章', 'writing', 0)
       returning id`,
      [workId, branchId],
    );

    const key = 'sk-audit-must-not-leak';
    const created = await alice.agent
      .post('/api/v1/model-configs')
      .send({
        name: '正文 Key',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: key,
        purpose: 'prose',
        isDefault: true,
      })
      .expect(201);
    await alice.agent
      .patch(`/api/v1/model-configs/${created.body.id}`)
      .send({ apiKey: `${key}-rotated` })
      .expect(200);
    await alice.agent
      .post(`/api/v1/works/${workId}/branches/${branchId}/chapters/1/generate`)
      .send({})
      .expect(202);

    const proposal = await owner.query<{ id: string }>(
      `insert into fact_proposals
         (work_id, branch_id, chapter_id, type, statement, source_sentence, status)
       values ($1, $2, $3, 'event', '沈砚抵达断碑。', '沈砚抵达断碑。', 'proposed')
       returning id`,
      [workId, branchId, chapter.rows[0].id],
    );
    await alice.agent
      .post(
        `/api/v1/works/${workId}/branches/${branchId}/chapters/1/fact-proposals/${proposal.rows[0].id}/reject`,
      )
      .expect(201);

    await alice.agent.delete(`/api/v1/model-configs/${created.body.id}`).expect(204);

    const audit = await alice.agent
      .get('/api/v1/users/me/audit')
      .query({ q: 'Key', limit: 50 })
      .expect(200);
    expect(audit.body.items.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining([
        'model_key.created',
        'model_key.updated',
        'model_key.deleted',
      ]),
    );
    expect(JSON.stringify(audit.body)).not.toContain(key);

    const all = await alice.agent
      .get('/api/v1/users/me/audit')
      .query({ limit: 100 })
      .expect(200);
    expect(all.body.items.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining(['generation.requested', 'fact.rejected']),
    );
    const generation = all.body.items.find(
      (item: { action: string }) => item.action === 'generation.requested',
    );
    expect(generation.metadata).toMatchObject({ workId, branchId, chapterNumber: 1 });
    expect(JSON.stringify(all.body)).not.toContain(key);
  });

  it('packages every author data area in the background and serves it through a signed download', async () => {
    const email = `account-export-${randomUUID()}@example.com`;
    const alice = await createAuthor(email);
    const work = await alice.agent
      .post('/api/v1/works')
      .send({
        title: '完整导出的书',
        penName: '归舟',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);
    const workId = work.body.id as string;
    const branchId = work.body.mainBranch.id as string;

    await alice.agent
      .put(`/api/v1/works/${workId}/branches/${branchId}/story-bible`)
      .send({
        oneSentenceStory: '少年持残剑守住最后一道天门。',
        protagonist: '沈砚',
        worldIronLaw: '借天门之力必须付出真实记忆。',
      })
      .expect(200);

    const key = 'sk-complete-export-must-not-leak';
    await alice.agent
      .post('/api/v1/model-configs')
      .send({
        name: '导出模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: key,
        purpose: 'prose',
        isDefault: true,
      })
      .expect(201);

    const setting = await owner.query<{ id: string }>(
      `insert into entities
         (work_id, branch_id, name, type, subtype, summary, description, status)
       values ($1, $2, '断碑', 'setting', 'location', '旧日剑痕', '残剑认主之地', 'confirmed')
       returning id`,
      [workId, branchId],
    );
    await owner.query(
      `insert into entity_custom_fields (work_id, branch_id, key, label, type)
       values ($1, $2, 'climate', '气候', 'text')`,
      [workId, branchId],
    );
    const character = await owner.query<{ id: string }>(
      `insert into entities
         (work_id, branch_id, name, type, subtype, summary, description, status)
       values ($1, $2, '沈砚', 'character', 'protagonist', '边城剑客', '外冷内热', 'confirmed')
       returning id`,
      [workId, branchId],
    );
    await owner.query(
      `insert into character_profiles
         (work_id, branch_id, entity_id, desire, fear, secret, voice, arc)
       values ($1, $2, $3, '守住天门', '失去记忆', '母亲还活着', '寡言', '从独行到守护')`,
      [workId, branchId, character.rows[0].id],
    );
    await owner.query(
      `insert into character_states
         (work_id, branch_id, character_id, body, power, location, possessions,
          disguise, knowledge, version, updated_by)
       values ($1, $2, $3, '左臂受伤', '炼气三层', '断碑', '残剑',
               '无', '[{"id":"k1","title":"天门","objectiveTruth":"天门存在","characterBelief":"天门是骗局","validFrom":"第一章","validTo":null,"source":"第一章"}]'::jsonb,
               1, $4)`,
      [workId, branchId, character.rows[0].id, alice.id],
    );
    await owner.query(
      `insert into map_nodes (work_id, branch_id, entity_id, level)
       values ($1, $2, $3, 'city')`,
      [workId, branchId, setting.rows[0].id],
    );

    await owner.query(
      `insert into chapter_outlines
         (work_id, branch_id, level, title, summary, details, chapter_number)
       values ($1, $2, 'chapter', '第一章 断碑', '', '', 1)`,
      [workId, branchId],
    );
    const chapter = await owner.query<{ id: string }>(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, word_count)
       values ($1, $2, 1, '第一章 断碑', 'writing', 12)
       returning id`,
      [workId, branchId],
    );
    const version = await owner.query<{ id: string }>(
      `insert into chapter_versions
         (chapter_id, version, content, content_hash, word_count, created_by, source)
       values ($1, 1, '沈砚踏上断碑。', md5('沈砚踏上断碑。'), 7, $2, 'manual')
       returning id`,
      [chapter.rows[0].id, alice.id],
    );
    await owner.query('update chapters set current_version_id = $2 where id = $1', [
      chapter.rows[0].id,
      version.rows[0].id,
    ]);
    const proposal = await owner.query<{ id: string }>(
      `insert into fact_proposals
         (work_id, branch_id, chapter_id, type, statement, source_sentence, status)
       values ($1, $2, $3, 'event', '沈砚踏上断碑。', '沈砚踏上断碑。', 'confirmed')
       returning id`,
      [workId, branchId, chapter.rows[0].id],
    );
    await owner.query(
      `insert into facts
         (work_id, branch_id, chapter_id, source_proposal_id, type, statement, source_sentence)
       values ($1, $2, $3, $4, 'event', '沈砚踏上断碑。', '沈砚踏上断碑。')`,
      [workId, branchId, chapter.rows[0].id, proposal.rows[0].id],
    );
    await owner.query(
      `insert into change_requests
         (work_id, branch_id, target_type, target_id, title, reason, old_value,
          new_value, diff, source, risk, status, created_by)
       values ($1, $2, 'entity', $3, '调整断碑设定', '补全旧日剑痕',
               '{"summary":"旧日剑痕"}'::jsonb, '{"summary":"残剑认主之地"}'::jsonb,
               '[{"field":"summary","before":"旧日剑痕","after":"残剑认主之地"}]'::jsonb,
               'author', 'low', 'applied', $4)`,
      [workId, branchId, setting.rows[0].id, alice.id],
    );
    await owner.query(
      `insert into audit_logs
         (user_id, work_id, branch_id, action, target_type, title, detail, metadata)
       values ($1, $2, $3, 'version_created', 'chapter', '保存版本',
               '第一章初稿', '{"chapterNumber":1}'::jsonb)`,
      [alice.id, workId, branchId],
    );

    const started = await alice.agent.post('/api/v1/users/me/export').expect(202);
    expect(started.body.id).toBeTruthy();
    expect(started.body.status).toBe('queued');

    let job = started.body as {
      id: string;
      status: string;
      downloadUrl: string | null;
      downloadExpiresAt: string | null;
    };
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await alice.agent
        .get(`/api/v1/users/me/export/${job.id}`)
        .expect(200);
      job = response.body;
      if (job.status === 'completed' || job.status === 'failed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(job.status).toBe('completed');
    expect(job.downloadUrl).toContain('expires=');
    expect(job.downloadUrl).toContain('signature=');
    expect(job.downloadExpiresAt).toBeTruthy();

    const downloaded = await alice.agent
      .get(job.downloadUrl as string)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(downloaded.headers['content-type']).toContain('application/zip');
    const archive = await JSZip.loadAsync(downloaded.body);
    for (const file of [
      'manifest.json',
      'account.json',
      'model-configs.json',
      'works.json',
      'settings.json',
      'characters.json',
      'maps.json',
      'text.json',
      'facts.json',
      'changes.json',
      'generation.json',
      'audit.json',
    ]) {
      expect(archive.file(file), file).not.toBeNull();
    }
    const readJson = async (file: string) =>
      JSON.parse(await archive.file(file)!.async('string')) as Record<string, unknown>;
    const manifest = await readJson('manifest.json');
    const settings = await readJson('settings.json');
    const characters = await readJson('characters.json');
    const maps = await readJson('maps.json');
    const facts = await readJson('facts.json');
    const changes = await readJson('changes.json');
    const audit = await readJson('audit.json');

    expect(manifest).toMatchObject({ exportVersion: 2, accountId: alice.id });
    expect((settings.storyBibles as Array<{ oneSentenceStory: string }>)[0].oneSentenceStory).toBe(
      '少年持残剑守住最后一道天门。',
    );
    expect((settings.entities as Array<{ name: string }>).map((item) => item.name)).toEqual(
      expect.arrayContaining(['断碑', '沈砚']),
    );
    expect((characters.states as Array<{ body: string }>)[0].body).toBe('左臂受伤');
    expect((maps.nodes as Array<{ level: string }>)[0].level).toBe('city');
    expect((facts.confirmed as Array<{ statement: string }>)[0].statement).toBe('沈砚踏上断碑。');
    expect((changes.requests as Array<{ title: string }>)[0].title).toBe('调整断碑设定');
    expect((audit.work as Array<{ title: string }>).map((item) => item.title)).toEqual(
      expect.arrayContaining(['保存版本']),
    );
    expect((audit.account as Array<{ action: string }>).map((item) => item.action)).toEqual(
      expect.arrayContaining(['auth.login_succeeded', 'export.requested']),
    );
    expect(JSON.stringify(await readJson('works.json'))).toContain('完整导出的书');
    expect(JSON.stringify(await readJson('model-configs.json'))).not.toContain(key);
    expect(JSON.stringify(await readJson('account.json'))).not.toContain(passwordHash);

    const history = await alice.agent.get('/api/v1/users/me/export').expect(200);
    expect(history.body.items.map((item: { id: string }) => item.id)).toContain(job.id);

    const bob = await createAuthor(`export-bob-${randomUUID()}@example.com`);
    await bob.agent.get(`/api/v1/users/me/export/${job.id}`).expect(404);
    await bob.agent.get(job.downloadUrl as string).expect(403);

    const tampered = new URL(job.downloadUrl as string, 'http://localhost');
    tampered.searchParams.set('signature', '0'.repeat(43));
    await alice.agent
      .get(`${tampered.pathname}${tampered.search}`)
      .expect(403);
  });
});
