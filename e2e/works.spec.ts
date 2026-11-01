import { expect, test } from '@playwright/test';

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

  // Keep parallel E2E registrations out of the shared per-IP code limiter.
  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `203.0.113.${(Date.now() % 250) + 1}`,
  });
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible();

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

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('筹备中')).toBeVisible();
  await expect(page.getByText('主创作线已就绪')).toBeVisible();

  await page.getByRole('link', { name: '返回作品列表' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('进度', { exact: true })).toBeVisible();
  await expect(page.getByText('字数', { exact: true })).toBeVisible();
  await expect(page.getByText('最近编辑', { exact: true })).toBeVisible();
  await expect(page.getByText('筹备中')).toBeVisible();

  await page.getByRole('link', { name: `打开《${title}》` }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
