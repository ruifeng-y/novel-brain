import { expect, test, type Locator, type Page } from '@playwright/test';
import { useIsolatedClientIp } from './support';

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

async function saveNewOutlineNode(outline: Locator): Promise<void> {
  await outline.getByRole('button', { name: '保存节点' }).click();
  await expect(outline.getByLabel('节点标题')).toHaveCount(0);
}

async function createOutlineNode(
  page: Page,
  workId: string,
  branchId: string,
  body: Record<string, unknown>,
) {
  const response = await page.request.post(
    `/api/v1/works/${workId}/branches/${branchId}/outlines`,
    { data: body },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { id: string };
}

test('an author can plan, reorder, lock, regenerate, and delete outline nodes', async ({
  page,
}) => {
  const email = `outlines-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `九门总纲${Date.now()}`;

  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });

  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  const workId = page.url().split('/').pop();
  const workResponse = await page.request.get(`/api/v1/works/${workId}`);
  const work = (await workResponse.json()) as { mainBranch: { id: string } };

  const modelResponse = await page.request.post('/api/v1/model-configs', {
    data: {
      name: '规划模型',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-reasoner',
      apiKey: 'planning-key',
      purpose: 'planning',
    },
  });
  expect(modelResponse.ok()).toBeTruthy();
  expect(work.mainBranch.id).toBeTruthy();

  const outline = page.getByRole('region', { name: '完整大纲' });
  await expect(outline.getByRole('heading', { name: '完整大纲' })).toBeVisible();
  await outline.getByRole('button', { name: '创建全书总纲' }).click();
  await outline.getByLabel('节点标题').fill('九门总纲');
  await outline.getByLabel('节点摘要').fill('沈砚沿九座天门追查母亲失踪的真相。');
  await outline.getByLabel('节点细节').fill('全书以记忆代价推进，每卷解决一座天门。');
  await saveNewOutlineNode(outline);
  await expect(outline.getByText('九门总纲')).toBeVisible();

  await outline.getByRole('button', { name: '为《九门总纲》添加卷' }).click();
  await outline.getByLabel('节点标题').fill('第一卷 天门初开');
  await outline.getByLabel('节点摘要').fill('沈砚从边城进入荒寺，第一次借来亡者之剑。');
  await saveNewOutlineNode(outline);
  await expect(outline.getByText('第一卷 天门初开')).toBeVisible();

  await outline.getByRole('button', { name: '为《九门总纲》添加卷' }).click();
  await outline.getByLabel('节点标题').fill('第二卷 雪海旧名');
  await outline.getByLabel('节点摘要').fill('沈砚在雪海寻找第二座天门。');
  await saveNewOutlineNode(outline);

  await outline.getByRole('button', { name: '为《第一卷 天门初开》添加幕' }).click();
  await outline.getByLabel('节点标题').fill('第一幕 断碑雨夜');
  await outline.getByLabel('节点摘要').fill('沈砚在追兵围堵下触发断碑。');
  await saveNewOutlineNode(outline);

  await outline.getByRole('button', { name: '为《第一幕 断碑雨夜》添加章' }).click();
  await outline.getByLabel('节点标题').fill('第一章 断碑');
  await outline.getByLabel('节点摘要').fill('沈砚第一次引动残剑，并付出记忆代价。');
  await outline.getByLabel('章目标').fill('沈砚在断碑前第一次引动残剑。');
  await outline.getByLabel('叙事视角').fill('沈砚');
  await outline.getByLabel('场景节拍').fill('荒寺避雨\n断碑剑鸣\n残剑认主');
  await outline.getByLabel('章末钩子').fill('他想起的母亲，竟从未在自己的记忆里活过。');
  await saveNewOutlineNode(outline);

  await outline.getByRole('button', { name: '为《第一章 断碑》添加场景' }).click();
  await outline.getByLabel('节点标题').fill('荒寺避雨');
  await outline.getByLabel('节点摘要').fill('沈砚在断碑前躲避追兵。');
  await outline.getByLabel('节点细节').fill('从雨声切入，以第一次剑鸣收束。');
  await saveNewOutlineNode(outline);

  await outline.getByRole('button', { name: '为《第一幕 断碑雨夜》添加章' }).click();
  await outline.getByLabel('节点标题').fill('第二章 归城');
  await outline.getByLabel('节点摘要').fill('沈砚带着残剑回到边城。');
  await outline.getByLabel('章目标').fill('沈砚发现边城已经无人记得母亲。');
  await outline.getByLabel('叙事视角').fill('沈砚');
  await outline.getByLabel('场景节拍').fill('城门戒严\n旧友认不出沈砚');
  await outline.getByLabel('章末钩子').fill('通缉令上的画像，画的是三年后的他。');
  await saveNewOutlineNode(outline);

  await outline.getByRole('button', { name: '编辑《荒寺避雨》' }).click();
  await outline.getByLabel('节点标题').fill('荒寺听雨');
  await outline.getByRole('button', { name: '保存修改' }).click();
  await expect(outline.getByText('荒寺听雨')).toBeVisible();

  await outline.getByRole('button', { name: '下移《第一卷 天门初开》' }).click();
  await expect(
    outline.locator('[data-outline-level="volume"] .outline-node-title').first(),
  ).toHaveText('第二卷 雪海旧名');

  await outline.getByRole('button', { name: '锁定《第一章 断碑》' }).click();
  await expect(outline.getByText('已锁定', { exact: true })).toBeVisible();
  await outline.getByRole('button', { name: '下移《第一章 断碑》' }).click();
  await expect(outline.getByText('这次调整会修改已锁定的大纲节点')).toBeVisible();
  await outline.getByLabel('修改原因').fill('第一章与第二章需要交换顺序，正文时间线才能对齐。');
  await outline.getByRole('button', { name: '确认并调整顺序' }).click();
  await expect(
    outline.locator('[data-outline-level="chapter"] .outline-node-title').first(),
  ).toHaveText('第二章 归城');
  await outline.getByRole('button', { name: '编辑《第一章 断碑》' }).click();
  await outline.getByLabel('节点标题').fill('第一章 改过的断碑');
  await outline.getByRole('button', { name: '保存修改' }).click();
  await expect(outline.getByText('这次保存会修改已锁定的大纲节点')).toBeVisible();
  await outline.getByLabel('修改原因').fill('已写正文把断碑改成了木牌，章纲需要同步。');
  await outline.getByRole('button', { name: '确认并保存修改' }).click();
  await expect(outline.getByText('第一章 改过的断碑')).toBeVisible();

  await outline.getByRole('button', { name: '解锁《第一章 改过的断碑》' }).click();
  await expect(outline.getByText('编辑中').first()).toBeVisible();

  await outline.getByRole('button', { name: '重新生成《第一章 改过的断碑》' }).click();
  await outline.getByLabel('重生成要求').fill('让本章的选择更残酷，保留章末钩子。');
  await outline.getByRole('button', { name: '开始重生成' }).click();
  await expect(
    outline.getByText('重生成后的章安排：冲突更集中，节点结束时留有新的悬念。'),
  ).toBeVisible();

  const readiness = page.getByRole('region', { name: '生成准备度' });
  await expect(readiness.getByText('大纲', { exact: true })).toBeVisible();
  await expect(readiness.getByText('设定', { exact: true })).toBeVisible();
  await expect(readiness.getByText('已确认设定', { exact: true })).toBeVisible();
  await expect(readiness.getByText('模型 Key', { exact: true })).toBeVisible();
  await expect(readiness.getByText('规划模型“规划模型”已配置。')).toBeVisible();

  await outline.getByRole('button', { name: '删除《荒寺听雨》' }).click();
  await outline.getByRole('button', { name: '确认删除' }).click();
  await expect(outline.getByText('荒寺听雨')).toHaveCount(0);

  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ticket-16-outline-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(outline.getByRole('heading', { name: '完整大纲' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-16-outline-mobile.png',
    fullPage: true,
  });
});

test('an author can drag chapters and scenes into a persisted order', async ({ page }) => {
  const email = `outline-drag-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `拖拽校验${Date.now()}`;

  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  const workId = page.url().split('/').pop() as string;
  const workResponse = await page.request.get(`/api/v1/works/${workId}`);
  const work = (await workResponse.json()) as { mainBranch: { id: string } };
  const branchId = work.mainBranch.id;

  const book = await createOutlineNode(page, workId, branchId, {
    level: 'book',
    title: '九门总纲',
    summary: '验证拖拽顺序。',
    details: '',
  });
  const volume = await createOutlineNode(page, workId, branchId, {
    level: 'volume',
    parentId: book.id,
    title: '第一卷 天门初开',
    summary: '第一卷。',
    details: '',
  });
  const act = await createOutlineNode(page, workId, branchId, {
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '第一幕。',
    details: '',
  });
  const chapterOne = await createOutlineNode(page, workId, branchId, {
    level: 'chapter',
    parentId: act.id,
    title: '第一章 断碑',
    summary: '第一章。',
    details: '',
    chapterGoal: '触发断碑。',
    pov: '沈砚',
    sceneBeats: ['荒寺避雨'],
    chapterEndHook: '断碑开口。',
  });
  await createOutlineNode(page, workId, branchId, {
    level: 'chapter',
    parentId: act.id,
    title: '第二章 归城',
    summary: '第二章。',
    details: '',
    chapterGoal: '回到边城。',
    pov: '沈砚',
    sceneBeats: ['城门戒严'],
    chapterEndHook: '画像画着三年后的他。',
  });
  await createOutlineNode(page, workId, branchId, {
    level: 'scene',
    parentId: chapterOne.id,
    title: '荒寺避雨',
    summary: '第一场。',
    details: '',
  });
  await createOutlineNode(page, workId, branchId, {
    level: 'scene',
    parentId: chapterOne.id,
    title: '断碑余响',
    summary: '第二场。',
    details: '',
  });

  await page.reload();
  const outline = page.getByRole('region', { name: '完整大纲' });
  await expect(outline.getByRole('heading', { name: '完整大纲' })).toBeVisible();

  await outline.getByLabel('拖动《第二章 归城》').dragTo(outline.getByLabel('拖动《第一章 断碑》'));
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/works/${workId}/branches/${branchId}/outlines`,
      );
      const payload = (await response.json()) as {
        items: Array<{ level: string; parentId: string | null; title: string }>;
      };
      return payload.items
        .filter((node) => node.level === 'chapter' && node.parentId === act.id)
        .map((node) => node.title);
    })
    .toEqual(['第二章 归城', '第一章 断碑']);

  await outline.getByLabel('拖动《断碑余响》').dragTo(outline.getByLabel('拖动《荒寺避雨》'));
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/works/${workId}/branches/${branchId}/outlines`,
      );
      const payload = (await response.json()) as {
        items: Array<{ level: string; parentId: string | null; title: string }>;
      };
      return payload.items
        .filter((node) => node.level === 'scene' && node.parentId === chapterOne.id)
        .map((node) => node.title);
    })
    .toEqual(['断碑余响', '荒寺避雨']);

  await page.reload();
  await expect(
    page
      .getByRole('region', { name: '完整大纲' })
      .locator('[data-outline-level="chapter"] .outline-node-title')
      .first(),
  ).toHaveText('第二章 归城');
  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);
});
