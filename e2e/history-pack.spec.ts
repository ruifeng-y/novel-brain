import { expect, test, type Page } from '@playwright/test';
import { currentWorkAndBranch, useIsolatedClientIp } from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

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
  method: 'GET' | 'POST' | 'PUT',
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

async function waitForJob(
  page: Page,
  workId: string,
  branchId: string,
  jobId: string,
): Promise<{
  status: string;
  context: { sections: Array<{ key: string }> };
  draft: { content: string };
}> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = await apiJson<{
      status: string;
      context: { sections: Array<{ key: string }> };
      draft: { content: string };
    }>(page, 'GET', `/api/v1/works/${workId}/branches/${branchId}/jobs/${jobId}`);
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

test('an author can create and validate a history work in the Chinese workspace', async ({
  page,
}) => {
  const email = `history-e2e-${Date.now()}@example.com`;
  const title = `北境争鼎${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email);
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('朔风客');
  await page.getByLabel('题材').selectOption('history');
  await page.getByLabel('历史方向').selectOption('transmigration_hegemony');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('历史 · 穿越争霸').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '设定中心' })).toBeVisible();
  for (const subtype of ['朝代', '官制', '军制', '地理', '世家']) {
    await expect(page.getByRole('button', { name: subtype, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: '官制', exact: true }).click();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('中书省');
  await page.getByLabel('官阶').fill('2');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();

  const { workId, branchId } = await currentWorkAndBranch(page);
  const centerPath = `/api/v1/works/${workId}/branches/${branchId}`;
  const army = await apiJson<{ id: string }>(page, 'POST', `${centerPath}/entities`, {
    name: '朔州军',
    aliases: [],
    type: 'faction',
    subtype: 'military',
    summary: '驻守北境的边军。',
    description: '',
    tags: [],
    scope: 'work',
    status: 'draft',
    customFields: {
      history_troops: 3_000,
      history_provisions_shi: 50,
    },
  });
  const world = await apiJson<{ id: string }>(
    page,
    'POST',
    `${centerPath}/maps/nodes`,
    {
      name: '大朔',
      level: 'world',
      parentNodeId: null,
      summary: '架空王朝疆域。',
      description: '',
    },
  );
  const capital = await apiJson<{ id: string }>(
    page,
    'POST',
    `${centerPath}/maps/nodes`,
    {
      name: '京城',
      level: 'city',
      parentNodeId: world.id,
      summary: '王朝都城。',
      description: '',
    },
  );
  const frontier = await apiJson<{ id: string }>(
    page,
    'POST',
    `${centerPath}/maps/nodes`,
    {
      name: '朔州',
      level: 'city',
      parentNodeId: world.id,
      summary: '北境边城。',
      description: '',
    },
  );
  await apiJson(page, 'POST', `${centerPath}/maps/connections`, {
    fromNodeId: capital.id,
    toNodeId: frontier.id,
    travelMinutes: 2_880,
    label: '官道',
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: '历史规则检查' })).toBeVisible();
  await page.getByLabel('试写片段').fill('他掏出手机，命人给京城的公司送信。');
  await page.getByLabel('调动军队').selectOption(army.id);
  await page.getByLabel('出发地').selectOption(capital.id);
  await page.getByLabel('目的地').selectOption(frontier.id);
  await page.getByLabel('计划行军天数').fill('1');
  await page.getByRole('button', { name: '开始检查' }).click();

  await expect(page.getByRole('heading', { name: '时代错置' })).toBeVisible();
  await expect(page.getByText('需确认').first()).toBeVisible();
  await expect(page.getByText(/正文出现了不属于架空古代的“手机”/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '地理距离' })).toBeVisible();
  await expect(page.getByText(/至少需要 2 天/)).toBeVisible();
  await page.screenshot({
    path: 'test-results/history-pack-checks.png',
    fullPage: true,
  });

  await apiJson(page, 'PUT', `${centerPath}/story-bible`, {
    oneSentenceStory: '现代军校生穿越到架空乱世，从边城小卒一路止战定鼎。',
    protagonist: '顾行舟，现代军校生，穿越后成为朔州军中的什长',
    worldIronLaw: '军队调动必须遵守道路、粮草和官制层级。',
  });
  await apiJson(page, 'PUT', `${centerPath}/chapter-outlines/1`, {
    chapterGoal: '顾行舟在朔州军中识破一次不合常理的调令。',
    pov: '顾行舟',
    sceneBeats: ['雪夜点卯', '核对粮册', '发现越级调令'],
    chapterEndHook: '监军使在城门外亮出了第二道圣旨。',
  });
  await apiJson(page, 'POST', '/api/v1/model-configs', {
    name: '历史正文模型',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: 'sk-history-e2e-never-used',
    purpose: 'prose',
    isDefault: true,
  });
  const started = await apiJson<{ jobId: string }>(
    page,
    'POST',
    `${centerPath}/chapters/1/generate`,
    {},
  );
  const job = await waitForJob(page, workId, branchId, started.jobId);
  expect(job.status).toBe('completed');
  expect(job.context.sections.map((section) => section.key)).toContain('historyPack');
  expect(job.draft.content).toContain('朔州');
});
