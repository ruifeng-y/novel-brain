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

async function createPublishBook(page: Page, workId: string, branchId: string) {
  const base = `/api/v1/works/${workId}/branches/${branchId}/outlines`;
  const post = async (body: Record<string, unknown>) => {
    const response = await page.request.post(base, { data: body });
    expect(response.ok()).toBe(true);
    return (await response.json()) as { id: string };
  };
  const book = await post({ level: 'book', title: '天门残卷', summary: '少年执剑问天。' });
  const volume = await post({
    level: 'volume',
    parentId: book.id,
    title: '第一卷 天门初开',
    summary: '边城断碑。',
  });
  const act = await post({
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '剑鸣初响。',
  });
  for (const [chapterNumber, title, hook] of [
    [1, '断碑', '黑暗里有人叫出了母亲的名字。'],
    [2, '旧城门', '陌生人袖口露出焚毁的家纹。'],
    [3, '剑鸣', '残剑在雨里叫出了第二声。'],
  ] as const) {
    await post({
      level: 'chapter',
      parentId: act.id,
      title,
      summary: '',
      chapterNumber,
      chapterGoal: '',
      pov: '沈砚',
      sceneBeats: [],
      chapterEndHook: hook,
    });
  }
}

async function writeChapter(
  page: Page,
  workId: string,
  branchId: string,
  chapterNumber: number,
  content: string,
) {
  const response = await page.request.post(
    `/api/v1/works/${workId}/branches/${branchId}/chapters/${chapterNumber}/versions`,
    { data: { content } },
  );
  expect(response.ok()).toBe(true);
}

test('an author prepares metadata, previews as a reader, and exports publish checks', async ({
  page,
}) => {
  await registerAuthor(page, `publish-e2e-${Date.now()}@example.com`);
  await page.getByLabel('书名').fill(`发布准备${Date.now()}`);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  const { workId, branchId } = await currentWorkAndBranch(page);
  await createPublishBook(page, workId, branchId);
  await writeChapter(page, workId, branchId, 1, '沈砚听见剑鸣。');
  await writeChapter(page, workId, branchId, 2, '城门下站着一个陌生人。');
  await writeChapter(page, workId, branchId, 3, '残剑在雨里醒来。');

  const modelConfig = await page.request.post('/api/v1/model-configs', {
    data: {
      name: '发布辅助模型',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-e2e-fake-provider',
      purpose: 'planning',
    },
  });
  expect(modelConfig.ok()).toBe(true);

  await page.goto(`/workspace/${workId}/export`);
  await page.getByRole('button', { name: '发布准备', exact: true }).click();
  const panel = page.getByRole('region', { name: '发布准备' });
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: '生成发布建议' }).click();
  await expect(panel.getByText('断碑问心', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel.getByText('雨夜残剑', { exact: true })).toBeVisible();
  await expect(panel.getByText('仙侠', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText(/第 1 章 · 断碑夜雨/)).toBeVisible();

  await panel.getByRole('button', { name: '打开读者预览' }).click();
  const reader = panel.getByRole('article', { name: '读者预览' });
  await expect(reader.getByRole('heading', { name: '断碑问心' })).toBeVisible();
  await expect(reader.getByText('沈砚在荒寺断碑前引动残剑', { exact: false })).toBeVisible();
  await expect(reader.getByRole('heading', { name: '断碑夜雨' })).toBeVisible();
  await expect(reader).toContainText('沈砚听见剑鸣。');

  await panel.getByLabel('检查导出格式').selectOption('epub');
  await panel.getByRole('button', { name: '运行发布检查' }).click();
  const checks = panel.getByLabel('发布检查结果');
  for (const label of [
    '前三章钩子',
    '章节字数',
    '敏感内容',
    'AI 内容标识',
    '版权与原创性',
    '导出格式',
  ]) {
    await expect(checks.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(checks).toContainText('V1 只导出文件，不会连接或上传到发布平台。');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel.getByRole('button', { name: '复制检查结果' }).click();
  await expect(panel.getByText('检查结果已复制。')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '下载检查结果' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('发布检查');

  await expect(panel.getByRole('button', { name: /上传|发布到/ })).toHaveCount(0);
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
