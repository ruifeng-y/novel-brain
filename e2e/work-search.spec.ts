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
  method: 'POST' | 'PUT',
  path: string,
  data: unknown,
): Promise<T> {
  const response = await page.request.fetch(path, { method, data });
  if (!response.ok()) {
    throw new Error(`${method} ${path} returned ${response.status()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

test('an author can search settings, outlines, and chapter text across the work', async ({
  page,
}) => {
  const email = `work-search-${Date.now()}@example.com`;
  await registerAuthor(page, email);

  const work = await apiJson<{ id: string; mainBranch: { id: string } }>(
    page,
    'POST',
    '/api/v1/works',
    {
      title: `全书搜索${Date.now()}`,
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'long',
      targetPlatform: '起点中文网',
    },
  );
  const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  await apiJson(page, 'PUT', `${base}/chapter-outlines/1`, {
    chapterGoal: '沈砚在荒寺断碑前查清旧案。',
    pov: '沈砚',
    sceneBeats: ['踏入荒寺', '辨认断碑'],
    chapterEndHook: '山门外传来脚步声。',
  });
  await apiJson(page, 'POST', `${base}/entities`, {
    name: '沈砚',
    aliases: ['断碑客'],
    type: 'character',
    subtype: '',
    summary: '在荒寺断碑前追查旧案的年轻剑客。',
    description: '左手留有旧伤。',
    tags: ['主角'],
    scope: 'work',
    status: 'locked',
    customFields: {},
  });
  await apiJson(page, 'POST', `${base}/chapters/1/versions`, {
    content: '沈砚按住断碑。山门外的脚步声停在雨里。',
  });

  await page.goto(`/workspace/${work.id}`);
  await expect(page.getByRole('heading', { name: '全书搜索', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '全书搜索' }).fill('断碑');
  await page.getByRole('button', { name: '搜索全书', exact: true }).click();

  const results = page.getByRole('list', { name: '搜索结果' });
  await expect(results).toBeVisible();
  await expect(results.getByText('沈砚', { exact: true })).toBeVisible();
  await expect(results.getByText(/第 1 章/).first()).toBeVisible();

  await page.getByRole('textbox', { name: '全书搜索' }).fill('脚步声');
  await page.getByRole('button', { name: '搜索全书', exact: true }).click();
  await expect(results.getByText('正文', { exact: true })).toBeVisible();
  await results.getByRole('link', { name: /第 1 章/ }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${work.id}/write\\?chapter=1`));
  await expect(page.getByLabel('章节正文')).toHaveValue(/山门外的脚步声/);
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);
});
