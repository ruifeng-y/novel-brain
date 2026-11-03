import { expect, test } from '@playwright/test';
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

test('an author can create, list, and reopen a work', async ({ page }) => {
  const email = `works-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `仙途万里${Date.now()}`;

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
  await expect(page.getByRole('heading', { name: '书架还是空的' })).toBeVisible();

  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
  await expect(page.getByText('筹备中', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '继续写作' })).toBeVisible();

  await page.getByRole('link', { name: '返回作品列表' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
  await expect(page.getByText('进度', { exact: true })).toBeVisible();
  await expect(page.getByText('字数', { exact: true })).toBeVisible();
  await expect(page.getByText(/最近编辑/).first()).toBeVisible();
  await expect(page.getByText('筹备中', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: `打开《${title}》` }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('an author can start from one line, set writing conventions, and upload a cover', async ({
  page,
}) => {
  const email = `works-parameters-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const idea = '城门外最后一封信，写给二十年前失踪的父亲。';
  const title = '城门外最后一封信';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

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

  await page.getByRole('tab', { name: '一句话想法' }).click();
  await page.getByLabel('故事灵感').fill(idea);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.locator('summary', { hasText: '写作约定（可选）' }).click();
  await page.getByLabel('目标读者').fill('喜欢长线伏笔的读者');
  await page.getByLabel('章节字数').fill('2600');
  await page.getByLabel('更新节奏').selectOption('每周三更');
  await page.getByLabel('作品标签').fill('升级流，长线伏笔，群像');
  await page.getByLabel('简介').fill('守城人从一封旧信里翻出二十年前的真相。');
  await page.getByLabel('风格样本').fill('城门开时，风先一步进来。');
  await page.getByLabel('禁忌').fill('不写无代价复活。');
  await page.getByRole('button', { name: '创建并开始' }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const workId = new URL(page.url()).pathname.split('/').at(-2);
  await page.goto(`/workspace/${workId}/work-settings`);
  await expect(page.getByLabel('目标读者')).toHaveValue('喜欢长线伏笔的读者');
  await expect(page.getByLabel('章节字数')).toHaveValue('2600');
  await expect(page.getByLabel('更新节奏')).toHaveValue('每周三更');
  await expect(page.getByLabel('作品标签')).toHaveValue(/升级流/);

  await page.getByLabel('封面图片').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByText('封面已更新')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByAltText(`《${title}》封面`).first()).toBeVisible();

  await page.getByLabel('目标读者').fill('偏爱克制感情线的读者');
  await page.getByRole('button', { name: '保存作品资料' }).click();
  await expect(page.getByText('作品资料已保存')).toBeVisible();

  await page.getByRole('link', { name: '返回作品列表' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  const card = page.locator('.work-card', { hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByAltText(`《${title}》封面`)).toBeVisible();
  await expect(card.getByText('升级流', { exact: true })).toBeVisible();
});
