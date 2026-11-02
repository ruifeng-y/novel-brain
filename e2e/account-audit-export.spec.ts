import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
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

test('an author exports every data area and searches the account audit trail', async ({ page }) => {
  const email = `account-tools-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';

  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('验证码').fill(await readVerificationCode(email));
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByLabel('书名').fill(`账号导出验收${Date.now()}`);
  await page.getByLabel('笔名').fill('归舟');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);

  await page.goto('/workspace/settings/privacy');
  await expect(page.getByRole('heading', { name: '导出与审计' })).toBeVisible();
  const audit = page.locator('.account-audit-tool');
  await expect(
    audit.locator('.account-audit-item').getByText('登录账号', { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: '导出全部数据' }).click();
  await expect(page.getByText('正在后台整理全部数据')).toBeVisible();
  const download = page.getByRole('link', { name: '下载数据包' });
  await expect(download).toBeVisible({ timeout: 30_000 });
  const href = await download.getAttribute('href');
  expect(href).toContain('signature=');
  expect(href).toContain('expires=');

  const archiveResponse = await page.request.get(href as string);
  expect(archiveResponse.status()).toBe(200);
  expect(archiveResponse.headers()['content-type']).toContain('application/zip');
  const archive = await JSZip.loadAsync(await archiveResponse.body());
  expect(archive.file('manifest.json')).not.toBeNull();
  expect(archive.file('works.json')).not.toBeNull();
  expect(archive.file('settings.json')).not.toBeNull();
  expect(archive.file('maps.json')).not.toBeNull();
  expect(archive.file('characters.json')).not.toBeNull();
  expect(archive.file('facts.json')).not.toBeNull();
  expect(archive.file('changes.json')).not.toBeNull();
  expect(archive.file('audit.json')).not.toBeNull();

  await audit.getByLabel('搜索审计记录').fill('登录');
  await audit.getByRole('button', { name: '搜索' }).click();
  await expect(audit.locator('.account-audit-item strong').first()).toContainText('登录账号');

  const csvHref = await audit.getByRole('link', { name: '导出 CSV' }).getAttribute('href');
  const csv = await page.request.get(csvHref as string);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('登录');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
