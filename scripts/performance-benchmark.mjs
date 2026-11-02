import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const config = {
  databaseUrl:
    process.env.PERF_DATABASE_ADMIN_URL ??
    'postgres://novel:novel@127.0.0.1:55432/novel',
  apiBaseUrl: process.env.PERF_API_BASE_URL ?? 'http://127.0.0.1:13001',
  sessionSecret: process.env.PERF_SESSION_SECRET ?? 'development-session-secret',
  chapterCount: numberEnv('PERF_CHAPTER_COUNT', 1_000),
  chapterCharacters: numberEnv('PERF_CHAPTER_CHARACTERS', 3_000),
  entityCount: numberEnv('PERF_ENTITY_COUNT', 200),
  samples: numberEnv('PERF_SAMPLES', 30),
  output:
    process.env.PERF_OUTPUT ??
    path.resolve(process.cwd(), 'docs/acceptance/m3/performance/metrics.json'),
};

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
const marker = '唯一回响标记';
const commonQuery = '沈砚';
const generatedAt = new Date().toISOString();

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    minMs: round(sorted[0] ?? 0),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
    meanMs: round(sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length)),
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function timed(callback) {
  const start = performance.now();
  const value = await callback();
  return { value, ms: performance.now() - start };
}

async function measure(callback, samples = config.samples) {
  await callback();
  const times = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await callback();
    times.push(performance.now() - start);
  }
  return summarize(times);
}

function sessionToken() {
  return randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
}

function hashSessionToken(token) {
  return createHmac('sha256', config.sessionSecret).update(`session:${token}`).digest('hex');
}

async function waitForApi() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // The stack may still be starting.
    }
    await sleep(1_000);
  }
  throw new Error(`API did not become ready at ${config.apiBaseUrl}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createBenchmarkAuthor(label) {
  const userId = randomUUID();
  const token = sessionToken();
  const email = `${label}-${userId}@example.com`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  await pool.query(
    `insert into users (id, email, password_hash, display_name, status)
     values ($1, $2, 'benchmark-only', $3, 'active')`,
    [userId, email, label],
  );
  await pool.query(
    `insert into sessions (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [userId, hashSessionToken(token), expiresAt],
  );
  return { userId, email, token };
}

async function seedWork({
  userId,
  title,
  chapterCount,
  chapterCharacters,
  entityCount,
  seedFacts,
}) {
  const workId = randomUUID();
  const branchId = randomUUID();
  const contentBlock = '沈砚走进荒寺，断碑上刻着旧名。';
  const repeats = Math.ceil(chapterCharacters / [...contentBlock].length);

  await pool.query(
    `insert into works (
       id, user_id, title, pen_name, genre_pack, scale, target_platform, status
     ) values ($1, $2, $3, '压测作者', 'xianxia', 'epic', '起点中文网', 'serializing')`,
    [workId, userId, title],
  );
  await pool.query(
    `insert into work_branches (id, work_id, name, is_main, status, created_by)
     values ($1, $2, 'main', true, 'active', $3)`,
    [branchId, workId, userId],
  );
  await pool.query(
    `insert into story_bibles (
       work_id, branch_id, one_sentence_story, protagonist, world_iron_law, cards, version
     ) values (
       $1, $2,
       '边城少年以残剑问仙，最终守住人间最后一道天门。',
       '沈砚，外冷内热的边城剑客',
       '任何人借天门之力，都必须以一段真实记忆作为代价。',
       '[]'::jsonb,
       1
     )`,
    [workId, branchId],
  );
  await pool.query(
    `insert into chapter_outlines (
       work_id, branch_id, level, order_index, title, summary, details,
       chapter_number, chapter_goal, pov, scene_beats, chapter_end_hook
     )
     select
       $1, $2, 'chapter', n,
       '第 ' || n || ' 章',
       '第 ' || n || ' 章摘要',
       '',
       n,
       case
         when n = 120 then '沈砚回到荒寺断碑前，确认母亲留下的剑痕。'
         else '第 ' || n || ' 章目标：推进主线并收束一个小悬念'
       end,
       '沈砚',
       '["进入荒寺", "辨认断碑", "听见山门外的脚步声"]'::jsonb,
       '第 ' || n || ' 章钩子：旧名之后还有第二个人。'
     from generate_series(1, $3) as n`,
    [workId, branchId, chapterCount],
  );
  await pool.query(
    `insert into chapters (
       work_id, branch_id, chapter_number, title, status, word_count, summary, hook
     )
     select
       $1, $2, n,
       '第 ' || n || ' 章',
       case when n <= 30 then 'locked'::chapter_status else 'writing'::chapter_status end,
       $3,
       '第 ' || n || ' 章摘要',
       '第 ' || n || ' 章钩子'
     from generate_series(1, $4) as n`,
    [workId, branchId, chapterCharacters, chapterCount],
  );
  await pool.query(
    `insert into chapter_versions (
       chapter_id, version, content, content_hash, word_count, created_by, source
     )
     select
       c.id,
       1,
       case when c.chapter_number = 777 then '${marker}。' else '' end ||
         repeat($1, $2),
       md5(c.id::text || ':1'),
       $3,
       $4,
       'manual'
     from chapters c
     where c.work_id = $5 and c.branch_id = $6`,
    [contentBlock, repeats, chapterCharacters, userId, workId, branchId],
  );
  await pool.query(
    `update chapters c
     set current_version_id = v.id
     from chapter_versions v
     where v.chapter_id = c.id
       and v.version = 1
       and c.work_id = $1
       and c.branch_id = $2`,
    [workId, branchId],
  );
  await pool.query(
    `insert into entities (
       work_id, branch_id, name, aliases, type, subtype, summary, description,
       tags, scope, status, source, custom_fields
     )
     select
       $1, $2,
       '设定 ' || n,
       jsonb_build_array('别称 ' || n),
       case when n % 7 = 0 then 'character' else 'map' end,
       '',
       '设定 ' || n || ' 的摘要：荒寺断碑附近的旧日记录。',
       '与断碑和沈砚有关的背景材料 ' || n,
       '["批量压测"]'::jsonb,
       'work',
       'locked',
       'benchmark',
       '{}'::jsonb
     from generate_series(1, $3) as n`,
    [workId, branchId, entityCount],
  );

  if (seedFacts) {
    await pool.query(
      `with proposals as (
         insert into fact_proposals (
           work_id, branch_id, chapter_id, type, statement, source_sentence, status
         )
         select
           c.work_id,
           c.branch_id,
           c.id,
           'event',
           case
             when c.chapter_number = 120 and k = 1
               then '沈砚在荒寺断碑前发现母亲留下的旧剑痕。'
             else '第 ' || c.chapter_number || ' 章第 ' || k || ' 条已确认事件。'
           end,
           case
             when c.chapter_number = 120 and k = 1
               then '沈砚在荒寺断碑前发现母亲留下的旧剑痕。'
             else '第 ' || c.chapter_number || ' 章已确认事件原句。'
           end,
           'confirmed'
         from chapters c
         cross join generate_series(1, 4) as k
         where c.work_id = $1
           and c.branch_id = $2
           and c.chapter_number <= least(500, $3)
         returning id, work_id, branch_id, chapter_id, type, statement, source_sentence
       )
       insert into facts (
         work_id, branch_id, chapter_id, source_proposal_id, type, statement, source_sentence
       )
       select
         work_id, branch_id, chapter_id, id, type, statement, source_sentence
       from proposals`,
      [workId, branchId, chapterCount],
    );
  }

  return { workId, branchId };
}

function createApi(author) {
  return async function request(method, urlPath, body) {
    const response = await fetch(`${config.apiBaseUrl}${urlPath}`, {
      method,
      headers: {
        Cookie: `nb_session=${author.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      throw new Error(
        `${method} ${urlPath} failed with ${response.status}: ${
          typeof data === 'string' ? data : JSON.stringify(data)
        }`,
      );
    }
    return data;
  };
}

async function ensureModelConfig(request) {
  return request('POST', '/api/v1/model-configs', {
    name: '性能压测正文模型',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: 'sk-performance-only',
    purpose: 'prose',
    isDefault: true,
  });
}

async function benchmarkCrud(request, base) {
  const create = [];
  const read = [];
  const update = [];
  const remove = [];

  for (let index = 0; index < config.samples; index += 1) {
    let entityId = '';
    const created = await timed(async () => {
      const entity = await request('POST', `${base}/entities`, {
        name: `性能条目 ${Date.now()}-${index}`,
        aliases: [`压测别名 ${index}`],
        type: 'map',
        subtype: '',
        summary: '用于接口延迟采样的设定条目。',
        description: '不对应任何真实业务数据。',
        tags: ['性能'],
        scope: 'work',
        status: 'draft',
        customFields: {},
      });
      entityId = entity.id;
      return entity;
    });
    create.push(created.ms);

    read.push(
      (
        await timed(() => request('GET', `${base}/entities/${entityId}`))
      ).ms,
    );
    update.push(
      (
        await timed(() =>
          request('PATCH', `${base}/entities/${entityId}`, {
            summary: `已更新的压测摘要 ${index}`,
          }),
        )
      ).ms,
    );
    remove.push(
      (
        await timed(() => request('DELETE', `${base}/entities/${entityId}`))
      ).ms,
    );
  }

  return {
    settingCreate: summarize(create),
    settingRead: summarize(read),
    settingUpdate: summarize(update),
    settingDelete: summarize(remove),
  };
}

async function consumeGeneration(request, author, work, chapterNumber) {
  const base = `/api/v1/works/${work.workId}/branches/${work.branchId}`;
  const startedAt = Date.now();
  const started = await request('POST', `${base}/chapters/${chapterNumber}/generate`, {});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const response = await fetch(
    `${config.apiBaseUrl}${base}/jobs/${started.jobId}/events`,
    {
      headers: {
        Accept: 'text/event-stream',
        Cookie: `nb_session=${author.token}`,
      },
      signal: controller.signal,
    },
  );
  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    throw new Error(`SSE failed with ${response.status}`);
  }

  const connectedAt = Date.now();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstDeltaAt = null;
  let completed = false;
  const events = [];

  try {
    while (!completed) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        if (!block.trim()) {
          continue;
        }
        const event = parseSseBlock(block);
        if (!event) {
          continue;
        }
        const arrivedAt = Date.now();
        if (event.type === 'job.draft.delta' && firstDeltaAt === null) {
          firstDeltaAt = arrivedAt;
        }
        if (event.id) {
          events.push({ sequence: event.id, arrivedAt });
        }
        if (event.type === 'job.completed' || event.type === 'job.failed') {
          completed = true;
          break;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  const finishedAt = Date.now();
  const sequences = [...new Set(events.map((event) => event.sequence))];
  const createdAtBySequence = new Map();
  if (sequences.length > 0) {
    const result = await pool.query(
      `select sequence::text, created_at
       from job_events
       where job_id = $1
         and sequence = any($2::bigint[])`,
      [started.jobId, sequences],
    );
    for (const row of result.rows) {
      createdAtBySequence.set(row.sequence, new Date(row.created_at).getTime());
    }
  }
  const latencies = events
    .filter((event) => {
      const createdAt = createdAtBySequence.get(event.sequence);
      return createdAt !== undefined && createdAt >= connectedAt;
    })
    .map((event) => event.arrivedAt - createdAtBySequence.get(event.sequence));

  return {
    jobId: started.jobId,
    firstTokenMs: firstDeltaAt === null ? null : firstDeltaAt - startedAt,
    generationWallMs: finishedAt - startedAt,
    eventLatenciesMs: latencies,
  };
}

function parseSseBlock(block) {
  let type = 'message';
  let id = null;
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join('\n');
  return { type, id, data };
}

async function waitForJob(request, base, jobId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const job = await request('GET', `${base}/jobs/${jobId}`);
    if (['completed', 'failed', 'canceled'].includes(job.status)) {
      return job;
    }
    await sleep(250);
  }
  throw new Error(`Generation job ${jobId} did not finish`);
}

function maxOverlap(intervals, key) {
  let max = 0;
  for (const interval of intervals) {
    const active = intervals.filter(
      (candidate) =>
        (!key || candidate[key] === interval[key]) &&
        candidate.start < interval.end &&
        interval.start < candidate.end,
    ).length;
    max = Math.max(max, active);
  }
  return max;
}

async function main() {
  await waitForApi();
  const authorOne = await createBenchmarkAuthor('性能作者甲');
  const authorTwo = await createBenchmarkAuthor('性能作者乙');
  const workOne = await seedWork({
    userId: authorOne.userId,
    title: '三百万字压测作品',
    chapterCount: config.chapterCount,
    chapterCharacters: config.chapterCharacters,
    entityCount: config.entityCount,
    seedFacts: true,
  });
  const workTwo = await seedWork({
    userId: authorTwo.userId,
    title: '并发压测作品乙',
    chapterCount: 100,
    chapterCharacters: config.chapterCharacters,
    entityCount: 20,
    seedFacts: false,
  });
  await pool.query(
    `analyze works, work_branches, chapters, chapter_outlines, chapter_versions,
       entities, facts, fact_proposals, story_bibles`,
  );
  const requestOne = createApi(authorOne);
  const requestTwo = createApi(authorTwo);
  await ensureModelConfig(requestOne);
  await ensureModelConfig(requestTwo);

  const baseOne = `/api/v1/works/${workOne.workId}/branches/${workOne.branchId}`;
  const baseTwo = `/api/v1/works/${workTwo.workId}/branches/${workTwo.branchId}`;
  const requestOneWithWork = createApi(authorOne);

  const openWork = await measure(() =>
    requestOneWithWork('GET', `/api/v1/works/${workOne.workId}`),
  );
  const workspaceBoot = await measure(async () => {
    await Promise.all([
      requestOne('GET', `${baseOne}/story-bible`),
      requestOne('GET', `${baseOne}/outlines`),
      requestOne('GET', `${baseOne}/outline/readiness`),
      requestOne('GET', `${baseOne}/story-bible/insights`),
      requestOne('GET', `${baseOne}/story-ledger`),
      requestOne('GET', `${baseOne}/entities`),
      requestOne('GET', `${baseOne}/custom-fields`),
      requestOne('GET', `${baseOne}/relations`),
      requestOne('GET', `${baseOne}/maps`),
    ]);
  });
  const chapterList = await measure(() => requestOne('GET', `${baseOne}/chapters`));
  const chapterOpen = await measure(() => requestOne('GET', `${baseOne}/chapters/777`));
  const autosaveContent = '沈砚按住断碑。'.repeat(180);
  const autosave = await measure(() =>
    requestOne('PUT', `${baseOne}/chapters/777/autosave`, {
      content: autosaveContent,
    }),
  );
  const chapterMetadata = await measure(() =>
    requestOne('PATCH', `${baseOne}/chapters/777`, {
      summary: `压测摘要 ${Date.now()}`,
    }),
  );
  const crud = await benchmarkCrud(requestOne, baseOne);
  const globalSearchMarker = await measure(() =>
    requestOne('GET', `${baseOne}/search?q=${encodeURIComponent(marker)}&limit=20`),
  );
  const globalSearchCommon = await measure(() =>
    requestOne('GET', `${baseOne}/search?q=${encodeURIComponent(commonQuery)}&limit=20`),
  );
  const settingSearch = await measure(() =>
    requestOne('GET', `${baseOne}/entities?q=${encodeURIComponent('断碑')}`),
  );

  const generationRuns = [];
  for (const chapterNumber of [901, 902, 903]) {
    generationRuns.push(await consumeGeneration(requestOne, authorOne, workOne, chapterNumber));
  }
  const firstToken = summarize(
    generationRuns
      .map((run) => run.firstTokenMs)
      .filter((value) => value !== null),
  );
  const sseLatency = summarize(generationRuns.flatMap((run) => run.eventLatenciesMs));
  const generationWall = summarize(generationRuns.map((run) => run.generationWallMs));

  const concurrentStarts = await Promise.all([
    requestOne('POST', `${baseOne}/chapters/911/generate`, {}),
    requestOne('POST', `${baseOne}/chapters/912/generate`, {}),
    requestTwo('POST', `${baseTwo}/chapters/50/generate`, {}),
    requestTwo('POST', `${baseTwo}/chapters/51/generate`, {}),
  ]);
  const concurrencyStart = Date.now();
  await Promise.all([
    waitForJob(requestOne, baseOne, concurrentStarts[0].jobId),
    waitForJob(requestOne, baseOne, concurrentStarts[1].jobId),
    waitForJob(requestTwo, baseTwo, concurrentStarts[2].jobId),
    waitForJob(requestTwo, baseTwo, concurrentStarts[3].jobId),
  ]);
  const concurrencyWallMs = Date.now() - concurrencyStart;
  const jobRows = await pool.query(
    `select id, user_id, work_id, started_at, finished_at
     from jobs
     where id = any($1::uuid[])`,
    [concurrentStarts.map((job) => job.jobId)],
  );
  const intervals = jobRows.rows.map((row) => ({
    userId: row.user_id,
    workId: row.work_id,
    start: new Date(row.started_at).getTime(),
    end: new Date(row.finished_at).getTime(),
  }));

  const indexRows = await pool.query(
    `select indexname
     from pg_indexes
     where schemaname = 'public'
       and indexname like '%trgm%'
     order by indexname`,
  );

  const modeledThroughput = modeledTargets();
  const metrics = {
    schemaVersion: 1,
    ticket: 31,
    measuredAt: generatedAt,
    environment: {
      runtime: 'Windows Docker Compose, deterministic fake AI provider',
      apiBaseUrl: config.apiBaseUrl,
      database: 'PostgreSQL 16 + pgvector image',
      workerConcurrency: 4,
      globalGenerationConcurrency: 4,
      perUserGenerationConcurrency: 2,
      perWorkGenerationConcurrency: 2,
      interactiveQueuePriority: 1,
      batchQueuePriority: 10,
    },
    fixture: {
      workId: workOne.workId,
      branchId: workOne.branchId,
      chapters: config.chapterCount,
      targetCharactersPerChapter: config.chapterCharacters,
      totalCharacters: config.chapterCount * config.chapterCharacters,
      settings: config.entityCount,
      confirmedFacts: config.chapterCount >= 500 ? 2_000 : 0,
      concurrentWorkId: workTwo.workId,
    },
    measured: {
      openWork,
      workspaceBoot,
      chapterList,
      chapterOpen,
      autosave,
      chapterMetadata,
      ...crud,
      globalSearchMarker,
      globalSearchCommon,
      settingSearch,
      firstToken,
      generationWall,
      sseEventLatency: sseLatency,
      concurrency: {
        jobs: 4,
        wallMs: concurrencyWallMs,
        maxGlobalOverlap: maxOverlap(intervals),
        maxPerUserOverlap: maxOverlap(intervals, 'userId'),
        maxPerWorkOverlap: maxOverlap(intervals, 'workId'),
      },
    },
    modeled: {
      generationThroughput: modeledThroughput,
      caveat:
        'The latency and SSE numbers above are measured with the deterministic fake AI provider. The 30-chapter and 1000-chapter durations are modeled from the requirements baseline and are not wall-clock measurements.',
    },
    searchIndexes: indexRows.rows.map((row) => row.indexname),
    bottlenecks: [
      'Chapter opening used to return every historical version body. It now returns the newest 50 versions plus versionCount, while autosave and current text stay separate.',
      'Global search previously did not exist, and setting/entity search used unindexed ILIKE scans. pg_trgm GIN indexes now cover settings, outlines, autosave, current chapter text, aliases, tags, and custom fields.',
      'Chapter context previously embedded every confirmed fact. The compiler now keeps recent canon plus outline-relevant facts within 240 facts and 16k characters.',
      'Generation previously ran at BullMQ default concurrency. The worker now runs 4 jobs globally with per-user and per-work limits of 2, and interactive chapter jobs are prioritized above batch jobs.',
      'SSE still uses indexed database polling at 100 ms, which stays under the 1 s target without adding a second event transport. Remaining latency is dominated by the model provider in production.',
    ],
  };

  await mkdir(path.dirname(config.output), { recursive: true });
  await writeFile(config.output, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

  console.log(`Performance metrics written to ${config.output}`);
  console.log(
    `open p95=${openWork.p95Ms}ms search p95=${globalSearchMarker.p95Ms}ms ` +
      `edit p95=${chapterOpen.p95Ms}ms first-token p95=${firstToken.p95Ms}ms ` +
      `sse p95=${sseLatency.p95Ms}ms overlap=${maxOverlap(intervals)}`,
  );
}

function modeledTargets() {
  const standards = [6, 8, 10];
  const concurrency = 2;
  const overhead = 1.25;
  const volume30 = standards.map((minutes) =>
    round(((30 * minutes) / concurrency) * overhead / 60),
  );
  const chapters1000 = standards.map((minutes) =>
    round(((1_000 * minutes) / concurrency) * overhead / 60 / 24),
  );
  return {
    assumptions: {
      standardChapterMinutes: standards,
      concurrencyPerWork: concurrency,
      retryAuditReviewOverheadFactor: overhead,
      note:
        'Modeled from the §12 baseline: 6-10 minutes per 3,000-character chapter, two chapters concurrently per work, and 25% overhead for retries, continuity checks, and human review.',
    },
    volume30HoursRange: [Math.min(...volume30), Math.max(...volume30)],
    chapters1000DaysRange: [Math.min(...chapters1000), Math.max(...chapters1000)],
    targets: {
      volume30Hours: [2, 4],
      chapters1000Days: [3, 5],
    },
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
