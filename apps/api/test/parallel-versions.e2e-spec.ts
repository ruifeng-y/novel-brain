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

const CLONE_TABLES = [
  'story_bibles',
  'entities',
  'entity_custom_fields',
  'entity_relations',
  'character_profiles',
  'character_states',
  'character_state_revisions',
  'power_system_profiles',
  'golden_fingers',
  'item_technique_profiles',
  'item_ownerships',
  'timeline_eras',
  'timeline_event_nodes',
  'chapter_outlines',
  'chapters',
  'chapter_versions',
  'fact_proposals',
  'facts',
  'canon_commits',
  'canon_snapshots',
  'story_bible_revisions',
  'threads',
  'foreshadows',
  'character_arcs',
  'map_nodes',
  'map_connections',
  'map_images',
  'map_markers',
  'character_presences',
] as const;

function uniqueEmail(): string {
  return `parallel-versions-${randomUUID()}@example.com`;
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
  return { agent, userId: login.body.id as string };
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

async function insertEntity(
  database: DatabaseService,
  workId: string,
  branchId: string,
  name: string,
  type: string,
  summary: string,
) {
  const result = await database.pool.query<{ id: string }>(
    `insert into entities
       (work_id, branch_id, name, type, summary, description, tags, scope, status, source,
        aliases, custom_fields)
     values ($1, $2, $3, $4, $5, '', '[]'::jsonb, 'work', 'draft', '作者录入',
             '["旧称"]'::jsonb, '{}'::jsonb)
     returning id`,
    [workId, branchId, name, type, summary],
  );
  return result.rows[0].id;
}

async function seedCompleteState(
  app: INestApplication,
  workId: string,
  branchId: string,
  userId: string,
) {
  const database = app.get(DatabaseService);
  await database.pool.query(
    `insert into chapter_outlines
       (work_id, branch_id, level, order_index, title, summary, details, chapter_number,
        chapter_goal)
     values ($1, $2, 'chapter', 0, '断碑', '', '', 1, '沈砚第一次听见残剑回鸣。')`,
    [workId, branchId],
  );
  const chapter = await database.pool.query<{ id: string }>(
    `insert into chapters
       (work_id, branch_id, chapter_number, title, status, word_count)
     values ($1, $2, 1, '断碑', 'writing', 0)
     returning id`,
    [workId, branchId],
  );
  const chapterId = chapter.rows[0].id;

  const characterId = await insertEntity(
    database,
    workId,
    branchId,
    '沈砚',
    'character',
    '外冷内热的边城剑客。',
  );
  const cityId = await insertEntity(
    database,
    workId,
    branchId,
    '临渊城',
    'map',
    '东荒边境的小城。',
  );
  const secondCityId = await insertEntity(
    database,
    workId,
    branchId,
    '荒寺',
    'map',
    '城外山中的荒寺。',
  );
  const itemId = await insertEntity(
    database,
    workId,
    branchId,
    '残剑',
    'item_technique',
    '一柄只剩裂纹的旧剑。',
  );
  const powerId = await insertEntity(
    database,
    workId,
    branchId,
    '九境剑道',
    'power_system',
    '以记忆换取剑意。',
  );
  const timelineId = await insertEntity(
    database,
    workId,
    branchId,
    '九州纪年',
    'timeline',
    '断碑前后的纪年。',
  );
  const factionId = await insertEntity(
    database,
    workId,
    branchId,
    '沈氏旧部',
    'faction',
    '仍在边城活动的旧军。',
  );

  const bible = await database.pool.query<{ id: string }>(
    `insert into story_bibles
       (work_id, branch_id, one_sentence_story, protagonist, world_iron_law, cards)
     values ($1, $2, '边城少年以残剑问仙。', '沈砚', '借剑必须以记忆为代价。',
             '[]'::jsonb)
     returning id`,
    [workId, branchId],
  );
  await database.pool.query(
    `insert into story_bible_revisions
       (work_id, branch_id, story_bible_id, user_id, kind, reason, changed_cards,
        before_cards, after_cards)
     values ($1, $2, $3, $4, 'saved', '初始故事方向', '[]'::jsonb, '[]'::jsonb,
             '[]'::jsonb)`,
    [workId, branchId, bible.rows[0].id, userId],
  );
  await database.pool.query(
    `insert into entity_custom_fields
       (work_id, branch_id, key, label, type, options)
     values ($1, $2, 'bloodline', '血脉', 'text', '[]'::jsonb)`,
    [workId, branchId],
  );
  await database.pool.query(
    `insert into entity_relations
       (work_id, branch_id, from_entity_id, predicate, to_entity_id, source)
     values ($1, $2, $3, 'located_at', $4, '作者录入')`,
    [workId, branchId, characterId, cityId],
  );
  await database.pool.query(
    `insert into character_profiles
       (work_id, branch_id, entity_id, desire, fear, secret, voice, arc)
     values ($1, $2, $3, '找回母亲', '忘记所有人', '听见亡者回音', '寡言', '从独行到守人')`,
    [workId, branchId, characterId],
  );
  await database.pool.query(
    `insert into character_states
       (work_id, branch_id, character_id, body, power, location, possessions, disguise,
        knowledge, version, updated_by)
     values ($1, $2, $3, '左臂旧伤', '炼气', '临渊城', '残剑', '', '[]'::jsonb, 1, $4)`,
    [workId, branchId, characterId, userId],
  );
  await database.pool.query(
    `insert into character_state_revisions
       (work_id, branch_id, character_id, user_id, version, reason, source, changed_fields,
        before_state, after_state)
     values ($1, $2, $3, $4, 1, '初始状态', '作者录入', '["body","location"]'::jsonb,
             null, '{"body":"左臂旧伤","power":"炼气","location":"临渊城","possessions":"残剑","disguise":"","knowledge":[]}'::jsonb)`,
    [workId, branchId, characterId, userId],
  );
  await database.pool.query(
    `insert into power_system_profiles
       (work_id, branch_id, entity_id, levels, paths, breakthroughs)
     values ($1, $2, $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [workId, branchId, powerId],
  );
  await database.pool.query(
    `insert into golden_fingers
       (work_id, branch_id, owner_entity_id, name, rules, costs, limits, growth_curve)
     values ($1, $2, $3, '残剑借命', '["借亡者一剑"]'::jsonb, '["忘记名字"]'::jsonb,
             '["九息"]'::jsonb, '[]'::jsonb)`,
    [workId, branchId, characterId],
  );
  await database.pool.query(
    `insert into item_technique_profiles
       (work_id, branch_id, entity_id, kind, grade, effects, costs, restrictions)
     values ($1, $2, $3, 'item', '天阶', '["斩断护体真气"]'::jsonb,
             '["消耗记忆"]'::jsonb, '["非剑修不可用"]'::jsonb)`,
    [workId, branchId, itemId],
  );
  await database.pool.query(
    `insert into item_ownerships
       (work_id, branch_id, item_entity_id, owner_entity_id, from_time, source)
     values ($1, $2, $3, $4, '第 1 章', '断碑认主')`,
    [workId, branchId, itemId, characterId],
  );
  const era = await database.pool.query<{ id: string }>(
    `insert into timeline_eras
       (work_id, branch_id, timeline_entity_id, name, summary, start_date, end_date)
     values ($1, $2, $3, '玄元', '天门初开后纪年', null, null)
     returning id`,
    [workId, branchId, timelineId],
  );
  await database.pool.query(
    `insert into timeline_event_nodes
       (work_id, branch_id, timeline_entity_id, era_id, title, summary, relative_time,
        order_index)
     values ($1, $2, $3, $4, '断碑初鸣', '沈砚第一次听见剑鸣。', '', 0)`,
    [workId, branchId, timelineId, era.rows[0].id],
  );

  const proposal = await database.pool.query<{ id: string }>(
    `insert into fact_proposals
       (work_id, branch_id, chapter_id, type, statement, source_sentence, status)
     values ($1, $2, $3, 'event', '沈砚在断碑前听见剑鸣。', '断碑深处传来一声剑鸣。',
             'confirmed')
     returning id`,
    [workId, branchId, chapterId],
  );
  const fact = await database.pool.query<{ id: string }>(
    `insert into facts
       (work_id, branch_id, chapter_id, source_proposal_id, type, statement, source_sentence)
     values ($1, $2, $3, $4, 'event', '沈砚在断碑前听见剑鸣。',
             '断碑深处传来一声剑鸣。')
     returning id`,
    [workId, branchId, chapterId, proposal.rows[0].id],
  );
  const commit = await database.pool.query<{ id: string; snapshot_id: string }>(
    `insert into canon_commits
       (work_id, branch_id, chapter_id, snapshot_id, message, event_log, created_by)
     values ($1, $2, $3, gen_random_uuid(), '确认断碑事实', '[]'::jsonb, $4)
     returning id, snapshot_id`,
    [workId, branchId, chapterId, userId],
  );
  await database.pool.query(
    `insert into canon_snapshots
       (id, work_id, branch_id, commit_id, snapshot)
     values ($4, $1, $2, $3, $5::jsonb)`,
    [
      workId,
      branchId,
      commit.rows[0].id,
      commit.rows[0].snapshot_id,
      JSON.stringify({ facts: [{ id: fact.rows[0].id }] }),
    ],
  );
  const thread = await database.pool.query<{ id: string }>(
    `insert into threads
       (work_id, branch_id, name, type, summary, stakes, participant_ids,
        planned_payoff_chapter, milestones, tension_curve)
     values ($1, $2, '找回母亲', 'main', '追查母亲失踪', '失去最后线索',
             $3::jsonb, 9, '[]'::jsonb, '[]'::jsonb)
     returning id`,
    [workId, branchId, JSON.stringify([characterId])],
  );
  await database.pool.query(
    `insert into foreshadows
       (work_id, branch_id, title, description, setup_chapter, planned_payoff_chapter,
        status, importance)
     values ($1, $2, '母亲旧宅家纹', '袖口出现旧宅家纹。', 1, 9, 'planted', 'must')`,
    [workId, branchId],
  );
  await database.pool.query(
    `insert into character_arcs
       (work_id, branch_id, character_id, start_state, desire, fear, lie, truth, turn,
        end_state, status)
     values ($1, $2, $3, '独行', '找回母亲', '忘记所有人', '没人会留下', '有人愿意同行',
             '为救同伴放弃记忆', '守人', 'active')`,
    [workId, branchId, characterId],
  );

  const cityNode = await database.pool.query<{ id: string }>(
    `insert into map_nodes (work_id, branch_id, entity_id, level)
     values ($1, $2, $3, 'city')
     returning id`,
    [workId, branchId, cityId],
  );
  const templeNode = await database.pool.query<{ id: string }>(
    `insert into map_nodes (work_id, branch_id, entity_id, parent_node_id, level)
     values ($1, $2, $3, $4, 'location')
     returning id`,
    [workId, branchId, secondCityId, cityNode.rows[0].id],
  );
  await database.pool.query(
    `insert into map_connections
       (work_id, branch_id, from_node_id, to_node_id, travel_minutes, label)
     values ($1, $2, $3, $4, 30, '山道')`,
    [workId, branchId, cityNode.rows[0].id, templeNode.rows[0].id],
  );
  const image = await database.pool.query<{ id: string }>(
    `insert into map_images
       (work_id, branch_id, node_id, storage_key, mime_type, width, height, size, created_by)
     values ($1, $2, $3, 'test/map.png', 'image/png', 100, 100, 100, $4)
     returning id`,
    [workId, branchId, cityNode.rows[0].id, userId],
  );
  await database.pool.query(
    `insert into map_markers
       (work_id, branch_id, image_id, node_id, x_percent, y_percent)
     values ($1, $2, $3, $4, 25, 75)`,
    [workId, branchId, image.rows[0].id, templeNode.rows[0].id],
  );
  await database.pool.query(
    `insert into character_presences
       (work_id, branch_id, character_entity_id, location_node_id, story_time, source)
     values ($1, $2, $3, $4, '玄元十二年', '作者录入')`,
    [workId, branchId, characterId, cityNode.rows[0].id],
  );

  return {
    chapterId,
    characterId,
    cityId,
    cityNodeId: cityNode.rows[0].id,
    factId: fact.rows[0].id,
    threadId: thread.rows[0].id,
    factionId,
  };
}

async function saveChapterVersion(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  content: string,
  chapterNumber = 1,
) {
  const response = await agent
    .post(`/api/v1/works/${workId}/branches/${branchId}/chapters/${chapterNumber}/versions`)
    .send({ content })
    .expect(201);
  return response.body as { id: string; version: number };
}

async function countTable(
  database: DatabaseService,
  table: (typeof CLONE_TABLES)[number],
  branchId: string,
) {
  if (table === 'chapter_versions') {
    return database.pool.query<{ count: string }>(
      `select count(*) from chapter_versions version_row
       join chapters chapter_row on chapter_row.id = version_row.chapter_id
       where chapter_row.branch_id = $1`,
      [branchId],
    );
  }
  return database.pool.query<{ count: string }>(
    `select count(*) from ${table} where branch_id = $1`,
    [branchId],
  );
}

async function mutateCurrentState(
  app: INestApplication,
  workId: string,
  branchId: string,
  characterId: string,
  cityNodeId: string,
  factId: string,
) {
  const database = app.get(DatabaseService);
  await database.pool.query(
    `update story_bibles set protagonist = '沈砚（记忆受损）' where work_id = $1 and branch_id = $2`,
    [workId, branchId],
  );
  await database.pool.query(
    `update entities set summary = '断碑以东的小城。' where work_id = $1 and branch_id = $2 and name = '临渊城'`,
    [workId, branchId],
  );
  await database.pool.query(
    `update character_states set location = '荒寺' where work_id = $1 and branch_id = $2 and character_id = $3`,
    [workId, branchId, characterId],
  );
  await database.pool.query(
    `update map_nodes set level = 'region' where work_id = $1 and branch_id = $2 and id = $3`,
    [workId, branchId, cityNodeId],
  );
  await database.pool.query(
    `update facts set source_sentence = '断碑深处传来母亲的声音。' where work_id = $1 and branch_id = $2 and id = $3`,
    [workId, branchId, factId],
  );
  await database.pool.query(
    `update chapter_outlines set chapter_goal = '沈砚在断碑前追查母亲旧事。'
     where work_id = $1 and branch_id = $2 and chapter_number = 1`,
    [workId, branchId],
  );
  await database.pool.query(
    `insert into chapter_outlines
       (work_id, branch_id, level, order_index, title, summary, details, chapter_number,
        chapter_goal)
     values ($1, $2, 'chapter', 1, '旧城门', '', '', 2, '主线后来才写到的第二章。')`,
    [workId, branchId],
  );
}

describe('parallel version API', () => {
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

  it('forks a historical point without copying payload and reproduces that complete state', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const state = await seedCompleteState(app, work.id, work.mainBranchId, author.userId);
    const first = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    await mutateCurrentState(
      app,
      work.id,
      work.mainBranchId,
      state.characterId,
      state.cityNodeId,
      state.factId,
    );
    const second = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚在断碑前听见了母亲的回音。',
    );

    const versionPoints = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/version-points`)
      .expect(200);
    expect(versionPoints.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'current', chapterNumber: null }),
        expect.objectContaining({ id: first.id, version: 1 }),
        expect.objectContaining({ id: second.id, version: 2 }),
      ]),
    );

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: first.id,
        name: '母亲回音的另一版',
        reason: '回到第一次断碑时的完整故事状态。',
        kind: 'alternate_ending',
      })
      .expect(201);

    const database = app.get(DatabaseService);
    for (const table of CLONE_TABLES) {
      const result = await countTable(database, table, created.body.id);
      expect(Number(result.rows[0].count), `${table} should be copy-on-write`).toBe(0);
    }

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${created.body.id}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚听见剑鸣。');
      });
    const forkEntities = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${created.body.id}/entities`)
      .expect(200);
    expect(
      forkEntities.body.items.find((item: { name: string }) => item.name === '临渊城'),
    ).toMatchObject({ summary: '东荒边境的小城。' });
    const forkOutlines = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${created.body.id}/outlines`)
      .expect(200);
    expect(forkOutlines.body.items).toHaveLength(1);
    expect(forkOutlines.body.items[0].chapterGoal).toBe('沈砚第一次听见残剑回鸣。');

    const baseline = await database.pool.query<{ baseline_branch_id: string }>(
      `select baseline_branch_id from work_branches where id = $1`,
      [created.body.id],
    );
    const baselineBranchId = baseline.rows[0].baseline_branch_id;

    const forkCity = forkEntities.body.items.find(
      (item: { name: string }) => item.name === '临渊城',
    );
    await author.agent
      .patch(`/api/v1/works/${work.id}/branches/${created.body.id}/entities/${forkCity.id}`)
      .send({ summary: '平行版本里的断碑东城。' })
      .expect(200);

    for (const table of CLONE_TABLES) {
      const [forkCount, baselineCount] = await Promise.all([
        countTable(database, table, created.body.id),
        countTable(database, table, baselineBranchId),
      ]);
      expect(Number(forkCount.rows[0].count), `${table} should materialize`).toBe(
        Number(baselineCount.rows[0].count),
      );
    }

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/entities`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.find((item: { name: string }) => item.name === '临渊城').summary).toBe(
          '断碑以东的小城。',
        );
      });
  });

  it('compares non-prose facts, character state, and maps from the forked point', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const state = await seedCompleteState(app, work.id, work.mainBranchId, author.userId);
    const first = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    await mutateCurrentState(
      app,
      work.id,
      work.mainBranchId,
      state.characterId,
      state.cityNodeId,
      state.factId,
    );
    await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚在断碑前听见了母亲的回音。',
    );

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: first.id,
        name: '只比较旧状态',
        reason: '验证非正文状态也随版本点一起分叉。',
        kind: 'what_if',
      })
      .expect(201);

    const compared = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(201);
    expect(compared.body.facts).toEqual([
      expect.objectContaining({
        status: 'changed',
        fields: expect.arrayContaining([
          expect.objectContaining({
            field: 'sourceSentence',
            before: '断碑深处传来母亲的声音。',
            after: '断碑深处传来一声剑鸣。',
          }),
        ]),
      }),
    ]);
    expect(compared.body.characters).toEqual([
      expect.objectContaining({
        label: '沈砚',
        status: 'changed',
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'location', before: '荒寺', after: '临渊城' }),
        ]),
      }),
    ]);
    expect(compared.body.maps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('临渊城'),
          status: 'changed',
          fields: expect.arrayContaining([
            expect.objectContaining({ field: 'level', before: 'region', after: 'city' }),
          ]),
        }),
      ]),
    );
    expect(compared.body.summary).toMatchObject({
      factsChanged: 1,
      charactersChanged: 1,
      mapsChanged: 1,
    });
  });

  it('cherry-picks only selected chapter, setting, and outline into main', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    await seedCompleteState(app, work.id, work.mainBranchId, author.userId);
    const first = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send({
        chapterGoal: '主线后来才改的大纲。',
        pov: '沈砚',
        sceneBeats: ['断碑回鸣'],
        chapterEndHook: '母亲的声音。',
      })
      .expect(200);
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/entities/${
          (
            await author.agent.get(
              `/api/v1/works/${work.id}/branches/${work.mainBranchId}/entities`,
            )
          ).body.items.find((item: { name: string }) => item.name === '临渊城').id
        }`,
      )
      .send({ summary: '主线后来改过的临渊城。' })
      .expect(200);
    await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚在断碑前听见了母亲的回音。',
    );

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: first.id,
        name: '只摘断碑',
        reason: '只取回旧版本里的三样内容。',
        kind: 'rewrite',
      })
      .expect(201);

    const comparison = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(201);
    const branchChapter = comparison.body.chapters.find((item: { label: string }) =>
      item.label.includes('第 1 章'),
    );
    const branchSetting = comparison.body.settings.find(
      (item: { label: string }) => item.label === '临渊城',
    );
    const branchOutline = comparison.body.outlines.find((item: { label: string }) =>
      item.label.includes('第 1 章'),
    );

    const picked = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${created.body.id}/cherry-pick`)
      .send({
        targetBranchId: work.mainBranchId,
        items: [
          { type: 'chapter', id: branchChapter.comparedId },
          { type: 'setting', id: branchSetting.comparedId },
          { type: 'outline', id: branchOutline.comparedId },
        ],
      })
      .expect(201);
    expect(picked.body.summary).toEqual({ applied: 3, pending: 0, skipped: 0 });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚听见剑鸣。');
      });
  });

  it('isolates parallel versions by author and work', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    await seedCompleteState(app, work.id, work.mainBranchId, author.userId);
    const first = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: first.id,
        name: '只属于作者',
        reason: '验证作品之间互不影响。',
        kind: 'experiment',
      })
      .expect(201);

    await otherAuthor.agent
      .get(`/api/v1/works/${work.id}/branches`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await author.agent
      .post(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('BRANCH_NOT_FOUND');
      });
  });
});
