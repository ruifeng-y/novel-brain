import { expect, test } from '@playwright/test';
import { registerAuthor, useIsolatedClientIp } from './support';

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

test('an author can register, sign out everywhere, and sign back in', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';

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
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole('button', { name: '退出所有设备' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText(email)).toBeVisible();
});

test('login failures and expired reset links show clear errors', async ({ page }) => {
  const email = `auth-errors-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, password);
  await page.getByRole('button', { name: '退出所有设备' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('邮箱').fill(email);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    await page.getByLabel('密码').fill('wrong password');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  }
  await expect(page.getByText('操作太频繁，请稍后再试。')).toBeVisible();

  await page.goto('/reset-password?token=00000000-0000-4000-8000-000000000000');
  await page.getByLabel('新密码', { exact: true }).fill('another long password');
  await page.getByLabel('再次输入新密码').fill('another long password');
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page.getByText('重置链接无效或已过期，请重新获取。')).toBeVisible();
});
