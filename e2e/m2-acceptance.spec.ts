import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { useIsolatedClientIp } from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

type WorkRecord = {
  id: string;
  title: string;
  genrePack: 'xianxia' | 'history' | 'urban';
  mainBranch: { id: string };
};

type ChapterJobRecord = {
  id: string;
  status: string;
  context: {
    sections: Array<{
      key: string;
      content: Record<string, unknown>;
    }>;
  } | null;
  draft: { content: string } | null;
};

type VersionPointRecord = {
  id: string;
  chapterNumber: number | null;
  version: number | null;
};

const SCREENSHOT_DIR = process.env.M2_SCREENSHOT_DIR ?? 'test-results/m2-acceptance';

async function readVerificationCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const payload = (await response.json()) as { messages: MailpitMessage[] };
    const message = payload.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address === email),
    );
    if (message) {
      const detailResponse = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as { Text: string; Snippet: string };
      const code = `${detail.Text}\n${detail.Snippet}`.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
      if (code) {
        return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification email arrived for ${email}`);
}

async function registerAuthor(page: Page, email: string): Promise<void> {
  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('验证码').fill(await readVerificationCode(email));
  await page.getByLabel('密码').fill('correct horse battery staple');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function apiJson<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(path, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  if (!response.ok()) {
    throw new Error(`${method} ${path} returned ${response.status()}: ${await response.text()}`);
  }
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function createWork(
  page: Page,
  input: {
    title: string;
    penName: string;
    genrePack: WorkRecord['genrePack'];
    genreVariant?: string;
  },
): Promise<WorkRecord> {
  return apiJson<WorkRecord>(page, 'POST', '/api/v1/works', {
    title: input.title,
    penName: input.penName,
    genrePack: input.genrePack,
    ...(input.genreVariant ? { genreVariant: input.genreVariant } : {}),
    scale: 'long',
    targetPlatform: '起点中文网',
  });
}

async function prepareWork(
  page: Page,
  work: WorkRecord,
  input: {
    storyBible: {
      oneSentenceStory: string;
      protagonist: string;
      worldIronLaw: string;
    };
    chapters: Array<{
      chapterNumber: number;
      chapterGoal: string;
      pov: string;
      sceneBeats: string[];
      chapterEndHook: string;
    }>;
  },
): Promise<void> {
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  await apiJson(page, 'PUT', `${base}/story-bible`, input.storyBible);
  for (const chapter of input.chapters) {
    await apiJson(page, 'PUT', `${base}/chapter-outlines/${chapter.chapterNumber}`, {
      chapterGoal: chapter.chapterGoal,
      pov: chapter.pov,
      sceneBeats: chapter.sceneBeats,
      chapterEndHook: chapter.chapterEndHook,
    });
  }
}

async function waitForChapterJob(
  page: Page,
  work: WorkRecord,
  jobId: string,
): Promise<ChapterJobRecord> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = await apiJson<ChapterJobRecord>(
      page,
      'GET',
      `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/jobs/${jobId}`,
    );
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Chapter job ${jobId} did not finish`);
}

async function generateChapter(
  page: Page,
  work: WorkRecord,
  chapterNumber: number,
): Promise<{ job: ChapterJobRecord; elapsedMs: number }> {
  const startedAt = performance.now();
  const started = await apiJson<{ jobId: string }>(
    page,
    'POST',
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${chapterNumber}/generate`,
    {},
  );
  const job = await waitForChapterJob(page, work, started.jobId);
  if (job.status !== 'completed' || !job.draft) {
    throw new Error(`Chapter ${chapterNumber} generation did not complete`);
  }
  return { job, elapsedMs: Math.round(performance.now() - startedAt) };
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

test('M2 acceptance: three genres, batch review, changes, versions, and rollback work together', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const email = `m2-acceptance-${stamp}@example.com`;
  const journeyStartedAt = performance.now();

  await registerAuthor(page, email);

  const xianxiaTitle = `九门问心·M2验收${stamp}`;
  await page.goto('/workspace?quick=1');
  await page.getByLabel('书名').fill(xianxiaTitle);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  const xianxiaId = new URL(page.url()).pathname.split('/').at(-2);
  if (!xianxiaId) {
    throw new Error('The xianxia work page did not include a work id');
  }
  const xianxia = await apiJson<WorkRecord>(page, 'GET', `/api/v1/works/${xianxiaId}`);

  await page.goto('/workspace?quick=1');
  const historyTitle = `北境争鼎·M2验收${stamp}`;
  await page.getByLabel('书名').fill(historyTitle);
  await page.getByLabel('笔名').fill('朔风客');
  await page.getByLabel('题材').selectOption('history');
  await page.getByLabel('历史方向').selectOption('transmigration_hegemony');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  const historyId = new URL(page.url()).pathname.split('/').at(-2);
  if (!historyId) {
    throw new Error('The history work page did not include a work id');
  }
  const history = await apiJson<WorkRecord>(page, 'GET', `/api/v1/works/${historyId}`);
  await expect(page.getByText('历史 · 穿越争霸').first()).toBeVisible();
  await page.goto(`/workspace/${historyId}/settings`);
  await expect(page.getByRole('heading', { name: '历史规则检查' })).toBeVisible();

  const urban = await createWork(page, {
    title: `南城资本·M2验收${stamp}`,
    penName: '城南客',
    genrePack: 'urban',
  });

  await apiJson(page, 'POST', '/api/v1/model-configs', {
    name: 'M2 验收正文模型',
    provider: 'deepseek',
    baseUrl: 'http://127.0.0.1:9/openai-compatible',
    model: 'deepseek-chat',
    apiKey: 'sk-m2-local-only',
    purpose: 'prose',
    isDefault: true,
  });

  await prepareWork(page, history, {
    storyBible: {
      oneSentenceStory: '现代军校生穿越到架空乱世，从边城小卒一路止战定鼎。',
      protagonist: '顾行舟，现代军校生，穿越后成为朔州军中的什长。',
      worldIronLaw: '军队调动必须遵守道路、粮草和官制层级。',
    },
    chapters: [
      {
        chapterNumber: 1,
        chapterGoal: '顾行舟在朔州军中识破一次不合常理的越级调令。',
        pov: '顾行舟',
        sceneBeats: ['雪夜点卯', '核对粮册', '发现越级调令'],
        chapterEndHook: '监军使在城门外亮出了第二道圣旨。',
      },
    ],
  });
  await prepareWork(page, urban, {
    storyBible: {
      oneSentenceStory: '家族公司现金流断裂时，陈默必须在法律、金钱和人脉之间找到活路。',
      protagonist: '陈默，临危接手的家族公司负责人。',
      worldIronLaw: '每一笔资金、授权和法律程序都必须留下真实可追溯的依据。',
    },
    chapters: [
      {
        chapterNumber: 1,
        chapterGoal: '陈默核对付款授权和现金流，拒绝一笔说不清来源的转账。',
        pov: '陈默',
        sceneBeats: ['早高峰赶往公司', '核对供应商合同', '拒绝越权付款'],
        chapterEndHook: '旧城商会的人带着一份股东会决议出现在前台。',
      },
    ],
  });
  await prepareWork(page, xianxia, {
    storyBible: {
      oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
      protagonist: '沈砚，外冷内热的边城剑客。',
      worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
    },
    chapters: [
      {
        chapterNumber: 1,
        chapterGoal: '沈砚在断碑前第一次引动残剑。',
        pov: '沈砚',
        sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
        chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
      },
      {
        chapterNumber: 2,
        chapterGoal: '沈砚在追兵围困中查问母亲旧名。',
        pov: '沈砚',
        sceneBeats: ['山道被灯笼封住', '沈砚借残剑逼问旧名', '碑文反噬引来旧敌'],
        chapterEndHook: '来人的袖口绣着母亲旧宅的家纹。',
      },
    ],
  });

  const historyGeneration = await generateChapter(page, history, 1);
  expect(historyGeneration.job.draft?.content).toContain('朔州');
  expect(historyGeneration.job.context?.sections.map((section) => section.key)).toContain(
    'historyPack',
  );

  const urbanGeneration = await generateChapter(page, urban, 1);
  expect(urbanGeneration.job.draft?.content).toContain('南城');
  expect(urbanGeneration.job.context?.sections.map((section) => section.key)).toContain(
    'genrePack',
  );
  const urbanContext = urbanGeneration.job.context?.sections.find(
    (section) => section.key === 'genrePack',
  );
  expect(urbanContext?.content).toMatchObject({ key: 'urban', templateKey: 'urban-contemporary' });

  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.goto('/workspace');
  for (const title of [xianxiaTitle, historyTitle, urban.title]) {
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
  }
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/01-three-genre-bookshelf.png`,
    fullPage: true,
  });

  await page.goto(`/workspace/${history.id}/settings`);
  await expect(page.getByRole('heading', { name: '历史规则检查' })).toBeVisible();
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/02-history-rules.png`,
    fullPage: true,
  });

  await page.goto(`/workspace/${xianxia.id}/write`);
  await page.goto(`/workspace/${xianxia.id}/batch`);
  await expect(page).toHaveURL(new RegExp(`/workspace/${xianxia.id}/batch$`));
  await expect(page.getByRole('heading', { name: '把长跑拆成可管理的段落' })).toBeVisible();
  await page.getByRole('radio', { name: /逐章审批/ }).check();
  await page.getByRole('tab', { name: '自定义区间' }).click();
  await page.getByLabel('起始章').fill('1');
  await page.getByLabel('结束章').fill('2');
  await page.getByLabel('单章最少字数').fill('1200');
  await page.getByLabel('单章最多字数').fill('1400');

  const batchStartedAt = performance.now();
  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByText('已创建 2 章的创作任务。')).toBeVisible();
  await page.getByRole('tab', { name: /审核队列/ }).click();
  await expect(page.locator('.task-review-item')).toHaveCount(2, { timeout: 45_000 });
  const batchReviewMs = Math.round(performance.now() - batchStartedAt);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/03-batch-task-center.png`,
    fullPage: true,
  });
  await page.getByRole('region', { name: '待我确认' }).screenshot({
    path: `${SCREENSHOT_DIR}/04-review-queue.png`,
  });

  const firstReview = page.locator('.task-review-item').filter({ hasText: '第 1 章' }).first();
  await firstReview.getByRole('button', { name: '批准并锁定' }).click();
  await expect(page.getByText('这一章已批准并锁定。')).toBeVisible();
  const secondReview = page.locator('.task-review-item').filter({ hasText: '第 2 章' }).first();
  await secondReview.getByRole('button', { name: '送写作台' }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${xianxia.id}/write\\?chapter=2`));
  await expect(page.getByLabel('章节正文')).not.toHaveValue('');

  const xianxiaBase = `/api/v1/works/${xianxia.id}/branches/${xianxia.mainBranch.id}`;
  const entity = await apiJson<{ id: string; name: string }>(
    page,
    'POST',
    `${xianxiaBase}/entities`,
    {
      name: '临渊城',
      aliases: [],
      type: 'map',
      summary: '东荒边境的小城。',
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
    },
  );
  const change = await apiJson<{ id: string }>(page, 'POST', `${xianxiaBase}/changes`, {
    title: '补充临渊城的旧称',
    reason: '旧称在前文里出现过，需要写进设定。',
    targetType: 'map',
    targetId: entity.id,
    oldValue: { summary: '东荒边境的小城。' },
    newValue: { summary: '东荒边境的小城，旧称落霞城。' },
    source: 'author',
    risk: 'low',
  });
  const changeAnalysisStartedAt = performance.now();
  const analyzed = await apiJson<{
    status: string;
    impact: {
      classification: string;
      checks: Array<{ step: string }>;
    };
  }>(page, 'POST', `${xianxiaBase}/changes/${change.id}/analyze`);
  const changeAnalysisMs = Math.round(performance.now() - changeAnalysisStartedAt);
  expect(analyzed.status).toBe('waiting_confirmation');
  expect(analyzed.impact.classification).toBe('safe');
  expect(analyzed.impact.checks.map((check) => check.step)).toEqual([
    'structure',
    'hard_rules',
    'fact_diff',
    'knowledge_pov',
    'narrative',
    'downstream',
  ]);

  await page.goto(`/workspace/${xianxia.id}/changes`);
  const changePanel = page.getByRole('region', { name: '修改请求' });
  await expect(changePanel.getByText('可以直接应用')).toBeVisible();
  await expect(changePanel.getByText('六项检查')).toBeVisible();
  await changePanel.screenshot({
    path: `${SCREENSHOT_DIR}/05-change-impact.png`,
  });
  await changePanel.getByRole('button', { name: '应用这次修改' }).click();
  await expect(page.getByText('修改已应用，版本记录已保留。')).toBeVisible();
  await apiJson(page, 'GET', `${xianxiaBase}/entities/${entity.id}`).then((updatedEntity) => {
    expect(updatedEntity).toMatchObject({ summary: '东荒边境的小城，旧称落霞城。' });
  });

  await changePanel.getByLabel('撤销原因（可选）').fill('验收确认撤销也会保留历史。');
  await changePanel.getByRole('button', { name: '撤销这次修改' }).click();
  await expect(page.getByText('修改已撤销，撤销记录已保留。')).toBeVisible();

  const firstVersion = await apiJson<{ id: string; version: number }>(
    page,
    'POST',
    `${xianxiaBase}/chapters/2/versions`,
    { content: '沈砚在旧城外听见第二声剑鸣。' },
  );
  await apiJson(page, 'POST', `${xianxiaBase}/chapters/2/versions`, {
    content: '沈砚决定把残剑留在旧城，独自沿着雪路追下去。',
  });
  const versionPoints = await apiJson<{ items: VersionPointRecord[] }>(
    page,
    'GET',
    `${xianxiaBase}/version-points`,
  );
  const forkPoint = versionPoints.items.find(
    (point) => point.chapterNumber === 2 && point.version === firstVersion.version,
  );
  if (!forkPoint) {
    throw new Error('The requested chapter version point was not returned');
  }

  await page.reload();
  await page.getByRole('button', { name: '平行版本', exact: true }).click();
  const parallelPanel = page.getByRole('region', { name: '平行版本' });
  await expect(parallelPanel).toBeVisible();
  await page.getByLabel('平行版本名称').fill('旧城回响另一版');
  await page.getByLabel('分叉版本点').selectOption(forkPoint.id);
  await page.getByLabel('创建原因').fill('验收从已保存正文版本拉出独立故事线。');
  await page.getByLabel('版本类型').selectOption('alternate_ending');
  await parallelPanel.getByRole('button', { name: '创建平行版本' }).click();
  await expect(page.getByText('平行版本已创建')).toBeVisible();
  const comparison = parallelPanel.getByRole('region', { name: '并排比较' });
  await expect(comparison.getByText('沈砚在旧城外听见第二声剑鸣。')).toBeVisible();
  await expect(comparison.getByText('沈砚决定把残剑留在旧城，独自沿着雪路追下去。')).toBeVisible();
  await parallelPanel.screenshot({
    path: `${SCREENSHOT_DIR}/06-parallel-version.png`,
  });

  await page.getByRole('button', { name: '版本与回滚', exact: true }).click();
  const versionPanel = page.getByRole('region', { name: '版本图' });
  await expect(versionPanel.getByRole('img', { name: '版本关系图' })).toBeVisible();
  const targetVersion = versionPanel
    .locator('.version-list-item')
    .filter({ hasText: '第 2 章' })
    .filter({ hasText: `版本 ${firstVersion.version}` })
    .first();
  await targetVersion.getByRole('button', { name: '回到这个版本' }).click();
  await versionPanel.getByLabel('回滚原因').fill('验收回到旧城剑鸣版本。');
  await versionPanel.getByRole('button', { name: '确认回滚' }).click();
  await expect(page.getByText('已回到这个版本，并保留了新的回滚记录。')).toBeVisible();
  await expect(versionPanel.getByText('回滚', { exact: true }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await versionPanel.getByRole('button', { name: '导出记录' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await versionPanel.screenshot({
    path: `${SCREENSHOT_DIR}/07-version-rollback.png`,
  });

  await page.goto(`/workspace/${xianxia.id}/write?chapter=2`);
  await expect(page.getByLabel('章节正文')).toHaveValue('沈砚在旧城外听见第二声剑鸣。');

  const readSamples: number[] = [];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    for (const path of [
      '/api/v1/health',
      `/api/v1/works/${xianxia.id}`,
      `${xianxiaBase}/chapters/2`,
      `${xianxiaBase}/versions`,
      `${xianxiaBase}/jobs`,
    ]) {
      const startedAt = performance.now();
      const response = await page.request.get(path);
      expect(response.ok()).toBe(true);
      readSamples.push(performance.now() - startedAt);
    }
  }

  const metrics = {
    measuredAt: new Date().toISOString(),
    runtime: process.env.M2_RUNTIME ?? 'Local services, deterministic fake AI provider',
    workIds: {
      xianxia: xianxia.id,
      history: history.id,
      urban: urban.id,
    },
    generationMs: {
      history: historyGeneration.elapsedMs,
      urban: urbanGeneration.elapsedMs,
    },
    batchReviewMs,
    changeAnalysisMs,
    readLatency: {
      p50Ms: Math.round(percentile(readSamples, 0.5)),
      p95Ms: Math.round(percentile(readSamples, 0.95)),
      maxMs: Math.round(Math.max(...readSamples)),
      samples: readSamples.length,
    },
    totalJourneyMs: Math.round(performance.now() - journeyStartedAt),
    acceptance: {
      genresGenerated: ['history', 'urban', 'xianxia'],
      batchReviewQueue: true,
      changeImpact: true,
      parallelVersion: true,
      rollback: true,
      auditExport: true,
    },
  };
  await writeFile(`${SCREENSHOT_DIR}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
  await test.info().attach('m2-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
});
