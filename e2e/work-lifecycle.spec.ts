import { expect, test, type Page } from '@playwright/test';
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
  if (response.status() === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

test('an author manages the work lifecycle, library filters, import, and read-only completion', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `书架子午线${stamp}`;
  const importedTitle = `旧稿归来${stamp}`;
  await registerAuthor(page, `work-lifecycle-${stamp}@example.com`);

  const work = await apiJson<{ id: string; mainBranch: { id: string } }>(
    page,
    'POST',
    '/api/v1/works',
    {
      title,
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'long',
      targetPlatform: '起点中文网',
    },
  );
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  await apiJson(page, 'PUT', `${base}/chapter-outlines/1`, {
    chapterGoal: '沈砚在断碑前找到旧案线索。',
    pov: '沈砚',
    sceneBeats: ['辨认断碑'],
    chapterEndHook: '碑后传来剑鸣。',
  });
  await apiJson(page, 'POST', `${base}/chapters/1/versions`, {
    content: '沈砚按住断碑，听见雨里的剑鸣。',
  });
  await apiJson(page, 'POST', `${base}/foreshadows`, {
    title: '旧家纹',
    description: '断碑后的家纹',
    plantChapter: 1,
    plannedPayoffChapter: 4,
    status: 'planted',
    importance: 'must',
  });

  await page.goto('/workspace');
  await page.getByLabel('搜索作品').fill(title);
  await page.getByLabel('搜索作品').press('Enter');
  const card = page.locator('.work-card', { hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText('质量分')).toBeVisible();
  await expect(card.getByText('未回收')).toBeVisible();
  await expect(card.getByText('1', { exact: true })).toBeVisible();

  await card.getByRole('button', { name: '归档', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('tab', { name: '已归档' }).click();
  const archivedCard = page.locator('.work-card', { hasText: title });
  await expect(archivedCard).toBeVisible();
  await archivedCard.getByRole('button', { name: '恢复作品' }).click();
  await expect(archivedCard).toHaveCount(0);

  await page.getByRole('tab', { name: '进行中的作品' }).click();
  await page.getByLabel('搜索作品').fill(title);
  await page.getByLabel('搜索作品').press('Enter');
  const activeCard = page.locator('.work-card', { hasText: title });
  await activeCard.getByRole('button', { name: '复制作品' }).click();
  await expect(page.getByText(`已复制为《${title}副本》`, { exact: false })).toBeVisible();
  const copiedCard = page.locator('.work-card', { hasText: `${title}副本` });
  await expect(copiedCard).toBeVisible();

  await copiedCard.getByRole('button', { name: '删除', exact: true }).click();
  await copiedCard.getByRole('button', { name: '确认删除' }).click();
  await expect(copiedCard).toHaveCount(0);
  await page.getByRole('tab', { name: '回收站' }).click();
  const trashedCard = page.locator('.work-card', { hasText: `${title}副本` });
  await expect(trashedCard).toBeVisible();
  await trashedCard.getByRole('button', { name: '恢复作品' }).click();
  await expect(trashedCard).toHaveCount(0);

  await page.getByRole('tab', { name: '导入旧稿' }).click();
  await page.goto('/workspace?quick=1');
  await page.getByLabel('书名').fill(importedTitle);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('旧稿文件').setInputFiles({
    name: '旧稿.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 第一章 旧城\n风从城门下吹过。\n\n# 第二章 来客\n陌生人递来一封旧信。'),
  });
  await page.getByRole('button', { name: '导入并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole('heading', { name: importedTitle, exact: true })).toBeVisible();
  await expect(page.getByText('连载中', { exact: true })).toBeVisible();

  await apiJson(page, 'PATCH', `/api/v1/works/${work.id}`, { status: 'completed' });
  await page.goto(`/workspace/${work.id}/overview`);
  await expect(page.getByText('写作台只读')).toBeVisible();
  await page.getByRole('button', { name: '恢复连载' }).first().click();
  await expect(page.getByRole('link', { name: '继续写作' })).toBeVisible();
  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await expect(page.getByLabel('章节正文')).toBeEditable();

  await apiJson(page, 'PATCH', `/api/v1/works/${work.id}`, { status: 'completed' });
  await page.reload();
  await expect(page.getByText('已完本作品当前为只读状态')).toBeVisible();
  await expect(page.getByLabel('章节正文')).not.toBeEditable();
  const blocked = await page.request.post(`${base}/chapters/1/versions`, {
    data: { content: '试图直接修改完本作品。' },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()) as { code: string }).toMatchObject({
    code: 'WORK_COMPLETED_READ_ONLY',
  });

  await page.getByRole('link', { name: '作品与章纲' }).click();
  await expect(page.getByText('写作台只读')).toBeVisible();
  await page.getByRole('button', { name: '恢复连载' }).first().click();
  await expect(page.getByRole('link', { name: '继续写作' })).toBeVisible();
});
