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

async function createOutlineBook(page: Page, workId: string, branchId: string) {
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
  for (const [chapterNumber, title] of [
    [1, '断碑'],
    [2, '旧城门'],
    [3, '剑鸣'],
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
      chapterEndHook: '',
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

test('an author previews, exports, and downloads a book in the selected platform format', async ({
  page,
}) => {
  await registerAuthor(page, `exports-e2e-${Date.now()}@example.com`);
  await page.getByLabel('书名').fill(`导出验收${Date.now()}`);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  const { workId, branchId } = await currentWorkAndBranch(page);
  await createOutlineBook(page, workId, branchId);
  await writeChapter(page, workId, branchId, 1, '沈砚听见剑鸣。');
  await writeChapter(page, workId, branchId, 2, '城门下站着一个陌生人。');
  await writeChapter(page, workId, branchId, 3, '残剑在雨里醒来。');

  await page.goto(`/workspace/${workId}`);
  const panel = page.getByRole('region', { name: '导出与平台预设' });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('导出格式').locator('option')).toHaveText([
    'TXT',
    'Markdown',
    'Word 文档',
    'EPUB 电子书',
  ]);
  await expect(panel.getByLabel('格式预设').locator('option')).toHaveText([
    '通用网文',
    '起点',
    '番茄',
  ]);
  await expect(panel.getByLabel('导出分支').locator('option').first()).toContainText('主线');

  await panel.getByRole('button', { name: '全本', exact: true }).click();
  await panel.getByRole('button', { name: '预览导出' }).click();
  const preview = panel.getByLabel('导出预览');
  await expect(preview.getByText('3 章', { exact: true })).toBeVisible();
  await expect(preview.getByText('第一卷 天门初开').first()).toBeVisible();
  await expect(preview.getByText(/第 1 章 · 断碑/).first()).toBeVisible();
  await expect(preview.locator('pre')).toContainText('沈砚听见剑鸣。');

  await panel.getByLabel('格式预设').selectOption('fanqie');
  await panel.getByRole('button', { name: '开始导出' }).click();
  await expect(panel.getByText('导出完成，可以下载了。')).toBeVisible();
  const history = panel.getByLabel('下载历史');
  await expect(history.getByText(/全本 · 3 章 · 番茄/)).toBeVisible();
  const downloadLink = history.getByRole('link', { name: '下载 TXT' }).first();
  const href = await downloadLink.getAttribute('href');
  expect(href).toBeTruthy();
  const downloaded = await page.request.get(href as string);
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()['content-disposition']).toContain('attachment');
  expect(await downloaded.text()).toContain('第1章 断碑');

  await panel.getByLabel('导出格式').selectOption('docx');
  await panel.getByRole('button', { name: '开始导出' }).click();
  await expect(history.getByRole('link', { name: '下载 Word 文档' })).toBeVisible();

  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
