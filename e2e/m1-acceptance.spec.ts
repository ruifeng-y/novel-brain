import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { useIsolatedClientIp } from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

type EntityRecord = {
  id: string;
  name: string;
  type: string;
};

type CustomFieldRecord = {
  key: string;
  label: string;
};

type MapNodeRecord = {
  id: string;
  entityId: string;
  name: string;
};

type MapOverviewRecord = {
  nodes: MapNodeRecord[];
  connections: unknown[];
  factionControls: unknown[];
  presences: unknown[];
};

type StoryBibleRecord = {
  locked: boolean;
  completion: {
    complete: boolean;
    filledCards: number;
    totalCards: number;
  };
};

type OutlineNodeRecord = {
  id: string;
  level: string;
  chapterNumber: number | null;
};

type ChapterDetailRecord = {
  title: string;
  context: {
    sections: Array<{
      key: string;
      content: {
        facts?: Array<{
          chapterNumber: number;
          statement: string;
        }>;
      };
    }>;
    sourceRefs: string[];
  } | null;
  versions: unknown[];
};

type QualityReportRecord = {
  dimensions: Array<{
    key: string;
    label: string;
    statusLabel: string;
  }>;
};

type ConfirmedFactsRecord = {
  items: Array<{
    id: string;
    chapterNumber: number;
    type: string;
    statement: string;
  }>;
};

type ReadinessRecord = {
  ready: boolean;
  checks: Record<string, { ready: boolean; label: string; missing: string[] }>;
};

type StoryLedgerRecord = {
  threads: unknown[];
  foreshadows: unknown[];
  characterArcs: unknown[];
};

const SCREENSHOT_DIR = process.env.M1_SCREENSHOT_DIR ?? 'test-results/m1-acceptance';

function countCjkCharacters(text: string): number {
  return text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]/gu)?.length ?? 0;
}

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
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function branchPath(workId: string, branchId: string): string {
  return `/api/v1/works/${workId}/branches/${branchId}`;
}

async function createEntity(
  page: Page,
  basePath: string,
  input: {
    name: string;
    type: string;
    summary: string;
    description: string;
    aliases?: string[];
    tags?: string[];
    customFields?: Record<string, unknown>;
  },
): Promise<EntityRecord> {
  return apiJson<EntityRecord>(page, 'POST', `${basePath}/entities`, {
    name: input.name,
    aliases: input.aliases ?? [],
    type: input.type,
    summary: input.summary,
    description: input.description,
    tags: input.tags ?? [],
    scope: 'work',
    status: 'locked',
    customFields: input.customFields ?? {},
  });
}

async function createOutlineNode(
  page: Page,
  basePath: string,
  input: Record<string, unknown>,
): Promise<OutlineNodeRecord> {
  return apiJson<OutlineNodeRecord>(page, 'POST', `${basePath}/outlines`, {
    summary: '',
    details: '',
    ...input,
  });
}

async function generateChapterInDesk(page: Page, chapterNumber: number): Promise<number> {
  const chapterButton = page
    .locator('.writing-chapter-list .writing-chapter-item')
    .nth(chapterNumber - 1);
  await expect(chapterButton).toBeVisible();
  await chapterButton.click();
  await expect(page.locator('.writing-chapter-number').nth(chapterNumber - 1)).toHaveText(
    String(chapterNumber),
  );

  const startedAt = performance.now();
  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  const editor = page.getByLabel('章节正文');
  await expect
    .poll(async () => countCjkCharacters(await editor.inputValue()), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2_000);
  await expect
    .poll(async () => countCjkCharacters(await editor.inputValue()))
    .toBeLessThanOrEqual(3_000);

  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();

  const factPanel = page.getByRole('region', { name: '本章事实' });
  await expect(factPanel.getByText('来源原句')).toHaveCount(3);
  for (const type of ['event', 'body_state', 'character_knowledge']) {
    const proposal = factPanel.getByTestId(`fact-proposal-${type}`);
    await expect(proposal).toBeVisible();
    await proposal.getByRole('button', { name: '确认采用' }).click();
    await expect(proposal.getByText('已确认')).toBeVisible();
  }
  await expect(factPanel.getByText('3 条已确认')).toBeVisible();

  await page.getByRole('tab', { name: '质量' }).click();
  const qualityPanel = page.getByRole('region', { name: '本章质量报告' });
  await expect(qualityPanel).toBeVisible();
  await expect(qualityPanel.locator('[data-testid^="quality-"]')).toHaveCount(6);
  await expect(qualityPanel.getByTestId('quality-continuity')).toContainText('连续性');

  await page.getByRole('tab', { name: '连续性' }).click();
  const continuityPanel = page.getByRole('region', { name: '连续性提示' });
  await expect(continuityPanel).toBeVisible();
  await expect(continuityPanel.getByText('这一章暂时没有发现前后设定冲突。')).toBeVisible();

  return elapsedMs;
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

async function measureLatency(
  page: Page,
  paths: string[],
  iterations: number,
): Promise<{ p50Ms: number; p95Ms: number; maxMs: number; samples: number }> {
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const path of paths) {
      const startedAt = performance.now();
      const response = await page.request.get(path);
      if (!response.ok()) {
        throw new Error(`Latency probe ${path} returned ${response.status()}`);
      }
      samples.push(performance.now() - startedAt);
    }
  }

  return {
    p50Ms: Math.round(percentile(samples, 0.5)),
    p95Ms: Math.round(percentile(samples, 0.95)),
    maxMs: Math.round(Math.max(...samples)),
    samples: samples.length,
  };
}

test('M1 acceptance: one xianxia work reaches an internally serializable state', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const email = `m1-acceptance-${stamp}@example.com`;
  const password = 'correct horse battery staple';
  const title = `九门问心·M1验收${stamp}`;
  const journeyStartedAt = performance.now();

  const storyBibleCards = [
    {
      key: 'oneSentence',
      summary: '守碑少年为找回被天门吞掉的母亲，带着残剑踏遍九州。',
      details: '故事从边城荒寺起笔，母亲留下的半句剑诀贯穿全书。',
    },
    {
      key: 'sellingPoints',
      summary: '记忆作剑、师门反目、每卷推开一座天门。',
      details: '每卷兑现一次记忆代价，并在卷末揭开一层身世真相。',
    },
    {
      key: 'protagonist',
      summary: '沈砚，外冷内热的边城剑客。',
      details: '他嘴上不信任何人，却总会替陌生人挡下最后一剑。',
    },
    {
      key: 'goldenFinger',
      summary: '残剑能借来亡者的最后一剑，但每借一次就会忘掉一个活人的名字。',
      details: '借剑只持续九息；同一个人不能连续借剑两次；忘掉的名字无法补回。',
    },
    {
      key: 'worldIronLaws',
      summary: '天门只认记忆，不认血脉。',
      details: '想越过天门必须留下真实经历，伪造的记忆会被原样反噬。',
    },
    {
      key: 'mainPlot',
      summary: '沈砚沿九座天门追查母亲下落，并阻止仙门献祭人间记忆。',
      details: '主线按九卷推进，每卷解决一座天门，同时付出一个无法挽回的代价。',
    },
    {
      key: 'subplots',
      summary: '守碑人旧案、同门师姐的背叛、边城百姓的存亡。',
      details: '三条支线分别对应真相、情感和家园，必须在天门全开前收束。',
    },
    {
      key: 'ending',
      summary: '沈砚守住最后一道天门，却主动忘记母亲，让边城所有人记住彼此。',
      details: '结局让沈砚做一个仍会遗忘、也仍会牵挂的人。',
    },
    {
      key: 'readerPromise',
      summary: '每章有明确推进，每卷有一座天门和一次记忆代价，绝不用失忆拖延感情线。',
      details: '爽点来自破局与兑现承诺，情感克制，不写无意义后宫和重复打脸。',
    },
  ];

  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('验证码').fill(await readVerificationCode(email));
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);

  const workId = new URL(page.url()).pathname.split('/').at(-2);
  if (!workId) {
    throw new Error('The new work page did not include a work id');
  }
  const work = await apiJson<{ mainBranch: { id: string } }>(
    page,
    'GET',
    `/api/v1/works/${workId}`,
  );
  const branchId = work.mainBranch.id;
  const basePath = branchPath(workId, branchId);

  await apiJson(page, 'POST', '/api/v1/model-configs', {
    name: 'M1 规划模型',
    provider: 'deepseek',
    baseUrl: 'http://127.0.0.1:9/openai-compatible',
    model: 'deepseek-reasoner',
    apiKey: 'sk-m1-local-only',
    purpose: 'planning',
  });
  await apiJson(page, 'POST', '/api/v1/model-configs', {
    name: 'M1 正文模型',
    provider: 'deepseek',
    baseUrl: 'http://127.0.0.1:9/openai-compatible',
    model: 'deepseek-chat',
    apiKey: 'sk-m1-local-only',
    purpose: 'prose',
    isDefault: true,
  });

  await apiJson(page, 'PUT', `${basePath}/story-bible`, { cards: storyBibleCards });
  const lockedBible = await apiJson<StoryBibleRecord>(page, 'POST', `${basePath}/story-bible/lock`);
  expect(lockedBible.locked).toBe(true);
  expect(lockedBible.completion).toMatchObject({
    complete: true,
    filledCards: 9,
    totalCards: 9,
  });

  const fieldDefinitions = [
    { label: '旧伤备注', type: 'text' },
    { label: '年龄', type: 'number' },
    { label: '生辰', type: 'date' },
    { label: '境界', type: 'single_select', options: ['炼气', '筑基', '金丹'] },
    { label: '常用剑术', type: 'multi_select', options: ['御剑', '符箓', '剑阵'] },
    { label: '仍在追踪母亲', type: 'boolean' },
    { label: '宿敌', type: 'relation_ref' },
  ] as const;
  const customFields: CustomFieldRecord[] = [];
  for (const definition of fieldDefinitions) {
    customFields.push(
      await apiJson<CustomFieldRecord>(page, 'POST', `${basePath}/custom-fields`, definition),
    );
  }
  expect(customFields).toHaveLength(7);
  const fieldsByLabel = new Map(customFields.map((field) => [field.label, field.key]));

  await createEntity(page, basePath, {
    name: '九洲',
    type: 'world',
    summary: '九座天门分隔的人间与仙域。',
    description: '每次天门开启都会吞掉一段人间共同记忆。',
    aliases: ['九洲人间'],
    tags: ['世界'],
  });
  const faction = await createEntity(page, basePath, {
    name: '玄天宗',
    type: 'faction',
    summary: '以献祭记忆换取飞升的东荒大宗。',
    description: '控制临渊城与断碑古道，暗中收集守碑人的记忆。',
    tags: ['势力', '反派'],
  });
  const rival = await createEntity(page, basePath, {
    name: '裴照',
    type: 'character',
    summary: '奉命追捕沈砚的玄天宗执法弟子。',
    description: '他知道母亲失踪的一部分真相，却选择替宗门隐瞒。',
    aliases: ['裴执法'],
    tags: ['宿敌'],
  });
  const character = await createEntity(page, basePath, {
    name: '沈砚',
    type: 'character',
    summary: '外冷内热的边城剑客。',
    description: '为找回被天门吞掉的母亲，带着残剑踏遍九州。',
    aliases: ['守碑少年', '残剑客'],
    tags: ['主角', '剑修'],
  });
  const powerSystem = await createEntity(page, basePath, {
    name: '天门剑道',
    type: 'power_system',
    summary: '以记忆为薪、以剑意为路的修炼体系。',
    description: '境界越高，越要付出不可逆的记忆代价。',
    tags: ['力量体系'],
  });
  const item = await createEntity(page, basePath, {
    name: '残剑',
    type: 'item_technique',
    summary: '断碑下醒来的无名残剑。',
    description: '能借来亡者最后一剑，却会夺走持剑人的名字。',
    tags: ['金手指', '武器'],
  });
  const timeline = await createEntity(page, basePath, {
    name: '玄元纪年',
    type: 'timeline',
    summary: '天门初开后的纪年。',
    description: '以第一道天门开启为玄元元年。',
    tags: ['时间线'],
  });

  await apiJson<EntityRecord>(page, 'PATCH', `${basePath}/entities/${character.id}`, {
    customFields: {
      [fieldsByLabel.get('旧伤备注') ?? '']: '阴雨天左臂旧伤发麻，但当前不影响持剑。',
      [fieldsByLabel.get('年龄') ?? '']: 19,
      [fieldsByLabel.get('生辰') ?? '']: '1203-04-09',
      [fieldsByLabel.get('境界') ?? '']: '炼气',
      [fieldsByLabel.get('常用剑术') ?? '']: ['御剑', '剑阵'],
      [fieldsByLabel.get('仍在追踪母亲') ?? '']: true,
      [fieldsByLabel.get('宿敌') ?? '']: rival.id,
    },
  });

  await apiJson(page, 'PATCH', `${basePath}/characters/${character.id}/profile`, {
    desire: '找回被天门吞掉的母亲。',
    fear: '发现自己也是天门伪造出来的记忆。',
    secret: '他曾在断碑前主动交出过一段童年。',
    voice: '句子短，少用反问；提到母亲时会停顿。',
    arc: '从只信手中剑，到愿意把真相交给同行者。',
  });
  await apiJson(page, 'PUT', `${basePath}/characters/${character.id}/state`, {
    body: '左臂完好，能双手持剑；阴雨天旧伤会发麻。',
    power: '炼气三层，残剑认主后可短暂借剑意。',
    location: '荒寺',
    possessions: '残剑、母亲留下的半枚铜钱。',
    disguise: '披旧斗篷，不显露左手剑茧。',
    knowledge: [
      {
        title: '父母之死',
        objectiveTruth: '父母被仇家灭口，现场被伪造成双双自尽。',
        characterBelief: '父母因欠债羞愧而自杀。',
        validFrom: '第 1 章',
        validTo: '第 119 章',
        source: '第 1 章手稿',
      },
    ],
    reason: '录入 M1 验收初始状态',
    source: '第 1 章手稿',
  });

  await apiJson(page, 'POST', `${basePath}/relations`, {
    fromEntityId: character.id,
    predicate: 'subordinate',
    toEntityId: faction.id,
    validFrom: '玄元三年',
    validTo: null,
    source: '作者录入',
  });
  await apiJson(page, 'POST', `${basePath}/relations`, {
    fromEntityId: character.id,
    predicate: 'hostile',
    toEntityId: rival.id,
    validFrom: '第 2 章',
    validTo: null,
    source: '第 2 章手稿',
  });
  await apiJson(page, 'POST', `${basePath}/relations`, {
    fromEntityId: character.id,
    predicate: 'owns',
    toEntityId: item.id,
    validFrom: '第 1 章',
    validTo: null,
    source: '断碑认主',
  });

  await apiJson(page, 'PUT', `${basePath}/power-systems/${powerSystem.id}`, {
    levels: [
      { name: '炼气', order: 1, description: '引气入体，初闻剑意。' },
      { name: '筑基', order: 2, description: '道基初成，能以记忆养剑。' },
      { name: '金丹', order: 3, description: '金丹自照，可短暂改写一段记忆。' },
    ],
    paths: [
      {
        name: '剑修',
        description: '以剑意破境，以记忆偿付。',
        levels: ['炼气', '筑基', '金丹'],
      },
    ],
    breakthroughs: [
      {
        fromLevel: '炼气',
        toLevel: '筑基',
        conditions: ['剑意初成', '心境无隙'],
        costs: ['一段真实记忆'],
        bottlenecks: ['经脉未固'],
        counters: ['雷法', '镇魂钟'],
        resources: [{ name: '下品灵石', amount: 3 }],
      },
    ],
  });
  await apiJson(page, 'POST', `${basePath}/golden-fingers`, {
    ownerEntityId: character.id,
    name: '残剑借忆',
    rules: ['可借来亡者最后一剑，持续九息。'],
    costs: ['每次借剑忘掉一个活人的名字。'],
    limits: ['同一人不能连续借两次。', '忘掉的名字无法补回。'],
    growthCurve: [
      { stage: '初醒', description: '只能借来一道剑意。' },
      { stage: '共鸣', description: '可以听见剑主最后一句话。' },
    ],
  });
  await apiJson(page, 'PUT', `${basePath}/items-techniques/${item.id}`, {
    kind: 'item',
    grade: '天阶残品',
    effects: ['斩断护体真气', '唤醒亡者残念'],
    costs: ['每次出鞘消耗一段记忆'],
    restrictions: ['非剑修不可拔剑', '月圆之夜无法出鞘'],
  });
  await apiJson(page, 'POST', `${basePath}/items-techniques/${item.id}/ownerships`, {
    ownerEntityId: character.id,
    fromTime: '第 1 章',
    source: '断碑认主',
  });

  const era = await apiJson<{ id: string }>(
    page,
    'POST',
    `${basePath}/timelines/${timeline.id}/eras`,
    {
      name: '玄元',
      summary: '第一道天门开启后的纪年。',
      startDate: { year: 1, month: 1, day: 1, note: '' },
      endDate: { year: 120, month: 12, day: 31, note: '' },
    },
  );
  await apiJson(page, 'POST', `${basePath}/timelines/${timeline.id}/nodes`, {
    title: '断碑初鸣',
    summary: '沈砚在荒寺第一次听见残剑剑鸣。',
    eraId: era.id,
    absoluteDate: { year: 12, month: 4, day: 9, note: '' },
    relativeTime: '',
    relativeToNodeId: null,
    duration: { amount: 3, unit: 'day' },
    orderIndex: 0,
  });

  await apiJson(page, 'POST', `${basePath}/threads`, {
    name: '追查母亲失踪真相',
    type: 'main',
    summary: '沈砚沿着九座天门的线索追查母亲下落。',
    stakes: '每错过一条线索，母亲留在人间的记忆就会少一段。',
    participantIds: [character.id, rival.id],
    plannedPayoffChapter: 18,
    status: 'active',
    milestones: [
      { chapterNumber: 1, description: '残剑认主' },
      { chapterNumber: 3, description: '认出母亲旧宅家纹' },
    ],
    tensionCurve: [
      { chapterNumber: 1, tension: 3 },
      { chapterNumber: 3, tension: 7 },
      { chapterNumber: 18, tension: 10 },
    ],
  });
  await apiJson(page, 'POST', `${basePath}/foreshadows`, {
    title: '母亲留下的半句剑诀',
    description: '剑诀缺失的后半句指向天门真正代价。',
    plantChapter: 1,
    plannedPayoffChapter: 18,
    importance: 'must',
    status: 'planted',
  });
  await apiJson(page, 'POST', `${basePath}/character-arcs`, {
    characterId: character.id,
    startState: '只信手中剑，把所有人情都当作债。',
    desire: '找回被天门吞掉的母亲。',
    fear: '发现自己也是天门伪造出来的记忆。',
    lie: '只要足够强，就不必再失去任何人。',
    truth: '真正能留住人的不是力量，而是愿意把真相交给同行者。',
    turn: '在第 12 章主动承认自己一直错怪了守碑人。',
    endState: '愿意带着残缺的记忆继续守护边城。',
    status: 'active',
  });

  const worldNode = await apiJson<MapNodeRecord>(page, 'POST', `${basePath}/maps/nodes`, {
    name: '九洲',
    level: 'world',
    parentNodeId: null,
    summary: '故事发生的世界。',
  });
  const realmNode = await apiJson<MapNodeRecord>(page, 'POST', `${basePath}/maps/nodes`, {
    name: '人间界',
    level: 'realm',
    parentNodeId: worldNode.id,
    summary: '天门之内的人间。',
  });
  const continentNode = await apiJson<MapNodeRecord>(page, 'POST', `${basePath}/maps/nodes`, {
    name: '东荒',
    level: 'continent',
    parentNodeId: realmNode.id,
    summary: '玄天宗势力盘踞的大陆。',
  });
  const regionNode = await apiJson<MapNodeRecord>(page, 'POST', `${basePath}/maps/nodes`, {
    name: '青岚郡',
    level: 'region',
    parentNodeId: continentNode.id,
    summary: '断碑古道所在的郡。',
  });
  const cityNode = await apiJson<MapNodeRecord>(page, 'POST', `${basePath}/maps/nodes`, {
    name: '临渊城',
    level: 'city',
    parentNodeId: regionNode.id,
    summary: '玄天宗控制下的边城。',
  });
  const templeNode = await apiJson<MapNodeRecord>(page, 'POST', `${basePath}/maps/nodes`, {
    name: '荒寺',
    level: 'location',
    parentNodeId: cityNode.id,
    summary: '断碑与残剑醒来的地方。',
  });
  await apiJson(page, 'POST', `${basePath}/maps/connections`, {
    fromNodeId: templeNode.id,
    toNodeId: cityNode.id,
    travelMinutes: 45,
    label: '沿河官道',
  });
  await apiJson(page, 'POST', `${basePath}/relations`, {
    fromEntityId: faction.id,
    predicate: 'controls',
    toEntityId: cityNode.entityId,
    validFrom: '玄元三年',
    validTo: null,
    source: '作者录入',
  });
  await apiJson(page, 'POST', `${basePath}/maps/presences`, {
    characterEntityId: character.id,
    locationNodeId: templeNode.id,
    storyTime: '第一章雨夜',
    source: '第 1 章',
  });

  const book = await createOutlineNode(page, basePath, {
    level: 'book',
    title: '九门总纲',
    summary: '沈砚沿九座天门追查母亲失踪的真相。',
    details: '全书以记忆代价推进，每卷解决一座天门。',
  });
  const volume = await createOutlineNode(page, basePath, {
    level: 'volume',
    parentId: book.id,
    title: '第一卷 天门初开',
    summary: '沈砚从边城进入荒寺，第一次借来亡者之剑。',
  });
  const act = await createOutlineNode(page, basePath, {
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '沈砚在追兵围堵下触发断碑。',
  });

  const chapterOutlines = [
    {
      title: '第一章 断碑',
      chapterGoal: '沈砚在断碑前第一次引动残剑。',
      pov: '沈砚',
      sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
      chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
    },
    {
      title: '第二章 旧名',
      chapterGoal: '沈砚在追兵围困中查问母亲旧名。',
      pov: '沈砚',
      sceneBeats: ['山道被灯笼封住', '沈砚借残剑逼问旧名', '碑文反噬引来旧敌'],
      chapterEndHook: '来人的袖口绣着母亲旧宅的家纹。',
    },
    {
      title: '第三章 家纹',
      chapterGoal: '沈砚从碑文里认出母亲旧宅的家纹。',
      pov: '沈砚',
      sceneBeats: ['沈砚比对碑文与家纹', '旧敌承认见过母亲', '残剑指向下一座天门'],
      chapterEndHook: '碑上的名字忽然少了一个，正是他自己。',
    },
  ];
  for (const [index, outline] of chapterOutlines.entries()) {
    await createOutlineNode(page, basePath, {
      level: 'chapter',
      parentId: act.id,
      chapterNumber: index + 1,
      summary: outline.chapterGoal,
      ...outline,
    });
  }
  const outlineNodes = await apiJson<{ items: OutlineNodeRecord[] }>(
    page,
    'GET',
    `${basePath}/outlines`,
  );
  const firstChapterNode = outlineNodes.items.find(
    (node) => node.level === 'chapter' && node.chapterNumber === 1,
  );
  if (!firstChapterNode) {
    throw new Error('The first chapter outline was not created');
  }
  await createOutlineNode(page, basePath, {
    level: 'scene',
    parentId: firstChapterNode.id,
    title: '荒寺听雨',
    summary: '沈砚在断碑前躲避追兵。',
    details: '从雨声切入，以第一次剑鸣收束。',
  });

  const readiness = await apiJson<ReadinessRecord>(
    page,
    'GET',
    `${basePath}/outline/readiness?chapterNumber=1`,
  );
  expect(readiness.ready).toBe(true);
  expect(Object.values(readiness.checks).every((check) => check.ready)).toBe(true);

  const ledger = await apiJson<StoryLedgerRecord>(page, 'GET', `${basePath}/story-ledger`);
  expect(ledger.threads).toHaveLength(1);
  expect(ledger.foreshadows).toHaveLength(1);
  expect(ledger.characterArcs).toHaveLength(1);

  const map = await apiJson<MapOverviewRecord>(page, 'GET', `${basePath}/maps`);
  expect(map.nodes).toHaveLength(6);
  expect(map.connections).toHaveLength(1);
  expect(map.factionControls).toHaveLength(1);
  expect(map.presences).toHaveLength(1);

  await page.goto(`/workspace/${workId}/bible`);
  await expect(page.getByRole('heading', { name: '故事圣经' })).toBeVisible();
  await expect(page.getByText('九张卡片都已填写，可以锁定。')).toBeVisible();
  await expect(page.getByText('这本故事圣经已经锁定')).toBeVisible();
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.locator('.story-bible-layout').screenshot({
    path: `${SCREENSHOT_DIR}/01-story-bible-locked.png`,
  });

  await page.goto(`/workspace/${workId}/outline`);
  const outlineSection = page.getByRole('region', { name: '完整大纲' });
  await expect(outlineSection.getByText('第一章 断碑')).toBeVisible();
  await expect(outlineSection.getByText('第二章 旧名')).toBeVisible();
  await expect(outlineSection.getByText('第三章 家纹')).toBeVisible();
  await expect(outlineSection.getByText('荒寺听雨')).toBeVisible();
  await outlineSection.screenshot({
    path: `${SCREENSHOT_DIR}/02-five-level-outline.png`,
  });
  await page.getByRole('region', { name: '生成准备度' }).screenshot({
    path: `${SCREENSHOT_DIR}/03-generation-readiness.png`,
  });

  await page.goto(`/workspace/${workId}/settings?tab=faction`);
  await expect(page.getByRole('button', { name: /玄天宗/ }).first()).toBeVisible();
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/04-settings-center.png`,
  });
  await page.goto(`/workspace/${workId}/settings?tab=map`);
  await expect(page.getByRole('button', { name: /荒寺/ }).first()).toBeVisible();
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/05-map-and-faction.png`,
  });

  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workId}/write$`));
  await expect(page.locator('.writing-chapter-item')).toHaveCount(3);

  const generationDurations: Record<number, number> = {};
  generationDurations[1] = await generateChapterInDesk(page, 1);
  generationDurations[2] = await generateChapterInDesk(page, 2);

  const chapterTwo = await apiJson<ChapterDetailRecord>(page, 'GET', `${basePath}/chapters/2`);
  const chapterTwoFacts = chapterTwo.context?.sections.find(
    (section) => section.key === 'confirmedFacts',
  )?.content.facts;
  expect(chapterTwoFacts?.some((fact) => fact.chapterNumber === 1)).toBe(true);
  expect(chapterTwo.context?.sourceRefs.some((reference) => reference.startsWith('fact:'))).toBe(
    true,
  );

  generationDurations[3] = await generateChapterInDesk(page, 3);
  const chapterThree = await apiJson<ChapterDetailRecord>(page, 'GET', `${basePath}/chapters/3`);
  const chapterThreeFacts = chapterThree.context?.sections.find(
    (section) => section.key === 'confirmedFacts',
  )?.content.facts;
  expect(
    chapterThreeFacts?.filter((fact) => fact.chapterNumber <= 2).length,
  ).toBeGreaterThanOrEqual(6);

  const confirmedFacts = await apiJson<ConfirmedFactsRecord>(page, 'GET', `${basePath}/facts`);
  expect(confirmedFacts.items).toHaveLength(9);
  expect(new Set(confirmedFacts.items.map((fact) => fact.chapterNumber))).toEqual(
    new Set([1, 2, 3]),
  );

  const quality = await apiJson<QualityReportRecord>(page, 'GET', `${basePath}/chapters/3/quality`);
  expect(quality.dimensions.map((dimension) => dimension.key)).toEqual([
    'hook',
    'pacing',
    'information_density',
    'character_voice',
    'prose',
    'continuity',
  ]);
  expect(quality.dimensions.find((dimension) => dimension.key === 'continuity')?.statusLabel).toBe(
    '良好',
  );
  const annotations = await apiJson<{ items: unknown[] }>(
    page,
    'GET',
    `${basePath}/chapters/3/annotations`,
  );
  expect(annotations.items).toHaveLength(0);

  await page.getByRole('tab', { name: '质量' }).click();
  await page.getByRole('region', { name: '本章质量报告' }).screenshot({
    path: `${SCREENSHOT_DIR}/06-six-part-quality-report.png`,
  });
  await page.getByRole('region', { name: '本章事实' }).screenshot({
    path: `${SCREENSHOT_DIR}/07-confirmed-facts.png`,
  });
  await page.screenshot({
    fullPage: true,
    path: `${SCREENSHOT_DIR}/08-three-chapter-writing-desk.png`,
  });

  const readPaths = [
    '/api/v1/health',
    `/api/v1/works/${workId}`,
    `${basePath}/story-bible`,
    `${basePath}/outlines`,
    `${basePath}/chapters`,
    `${basePath}/chapters/3/insights`,
  ];
  const readLatency = await measureLatency(page, readPaths, 10);
  const searchLatency = await measureLatency(page, [`${basePath}/entities?q=沈砚`], 20);
  expect(readLatency.p95Ms).toBeLessThan(300);
  expect(searchLatency.p95Ms).toBeLessThan(1_000);

  const totalJourneyMs = Math.round(performance.now() - journeyStartedAt);
  const metrics = {
    measuredAt: new Date().toISOString(),
    runtime: 'Windows Docker Compose, fake AI provider',
    workId,
    branchId,
    chapterGenerationMs: generationDurations,
    totalJourneyMs,
    readLatency,
    searchLatency,
    confirmedFacts: confirmedFacts.items.length,
    qualityDimensions: quality.dimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      status: dimension.statusLabel,
    })),
  };
  await writeFile(`${SCREENSHOT_DIR}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
  await test.info().attach('m1-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    fullPage: true,
    path: `${SCREENSHOT_DIR}/09-writing-desk-mobile.png`,
  });

  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);
});
