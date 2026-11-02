import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
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

test('an author can save, test, mask, and delete a model configuration', async ({ page }) => {
  const providerHost = process.env.MODEL_PROVIDER_STUB_HOST ?? 'host.docker.internal';
  const provider = createServer((request, response) => {
    if (request.url === '/models' && request.headers.authorization === 'Bearer sk-e2e-secret') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }));
      return;
    }

    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Invalid key' } }));
  });
  await new Promise<void>((resolve) => provider.listen(0, '0.0.0.0', resolve));
  const address = provider.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not start the local model provider stub');
  }

  try {
    const email = `model-settings-e2e-${Date.now()}@example.com`;
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

    await page.getByRole('link', { name: '模型设置' }).click();
    await expect(page).toHaveURL(/\/workspace\/settings$/);
    await expect(page.getByRole('heading', { name: '模型设置' })).toBeVisible();

    await page.getByLabel('配置名称').fill('DeepSeek 正文');
    await page.getByLabel('Base URL').fill(`http://${providerHost}:${address.port}`);
    await page.getByLabel('模型名').fill('deepseek-chat');
    await page.getByLabel('API Key').fill('sk-e2e-secret');
    await page.getByLabel('用途', { exact: true }).selectOption('prose');
    await page.getByRole('button', { name: '保存配置' }).click();

    await expect(page.getByText('配置已保存')).toBeVisible();
    await expect(page.getByText('••••••••', { exact: true })).toBeVisible();
    await expect(page.getByText('sk-e2e-secret')).toHaveCount(0);
    await expect(page.getByText('默认配置', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('••••••••', { exact: true })).toBeVisible();
    await expect(page.getByText('sk-e2e-secret')).toHaveCount(0);

    await page.getByRole('button', { name: '测试连接' }).click();
    await expect(page.getByText('连接成功')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '删除配置' }).click();
    await expect(page.getByText('配置已删除')).toBeVisible();
    await expect(page.getByText('还没有模型配置')).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
