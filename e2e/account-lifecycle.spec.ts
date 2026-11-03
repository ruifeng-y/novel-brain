import { expect, test } from '@playwright/test';
import { useIsolatedClientIp } from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

type MailpitDetail = {
  Text: string;
  HTML: string;
  Snippet: string;
};

async function readMail(email: string, predicate: (body: string) => boolean): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const payload = (await response.json()) as { messages: MailpitMessage[] };
    for (const message of payload.messages) {
      if (!message.To.some((recipient) => recipient.Address === email)) {
        continue;
      }
      const detailResponse = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as MailpitDetail;
      const body = [detail.Text, detail.HTML, detail.Snippet].join('\n');
      if (predicate(body)) {
        return body;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No matching mail arrived for ${email}`);
}

async function readCode(email: string): Promise<string> {
  const body = await readMail(email, (text) => /(?<!\d)\d{6}(?!\d)/.test(text));
  const code = body.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
  if (!code) {
    throw new Error(`No verification code found for ${email}`);
  }
  return code;
}

async function readResetToken(email: string): Promise<string> {
  const body = await readMail(email, (text) => /reset-password\?token=/.test(text));
  const token = body.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) {
    throw new Error(`No reset token found for ${email}`);
  }
  return token;
}

async function registerAuthor(page: import('@playwright/test').Page, email: string): Promise<void> {
  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('验证码').fill(await readCode(email));
  await page.getByLabel('密码').fill('correct horse battery staple');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

test('an author can manage every account lifecycle step through the Chinese UI', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = `account-lifecycle-${Date.now()}@example.com`;
  const newEmail = `account-lifecycle-new-${Date.now()}@example.com`;
  const initialPassword = 'correct horse battery staple';
  const changedPassword = 'a changed long password';
  const resetPassword = 'a reset long password';

  await registerAuthor(page, email);

  await page.getByRole('link', { name: '账号设置' }).click();
  await expect(page).toHaveURL(/\/workspace\/settings\/account$/);
  await expect(page.getByRole('heading', { name: '你的写作身份' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录会话' })).toBeVisible();
  await expect(page.getByText('当前设备')).toBeVisible();

  const profileForm = page.getByRole('form', { name: '显示资料表单' });
  await profileForm.getByLabel('显示名').fill('青云客');
  await profileForm.getByLabel('简介', { exact: true }).fill('写仙侠，也写旧城故事。');
  await profileForm.getByRole('button', { name: '保存资料' }).click();
  await expect(page.getByText('账号资料已保存。')).toBeVisible();

  const penNameForm = page.getByRole('form', { name: '笔名表单' });
  await penNameForm.getByLabel('笔名', { exact: true }).fill('青衫客');
  await penNameForm.getByLabel('笔名简介').fill('写江湖，也写人心。');
  await penNameForm.getByRole('button', { name: '保存笔名' }).click();
  await expect(page.getByText('笔名已保存。')).toBeVisible();
  await expect(page.getByText('青衫客', { exact: true })).toBeVisible();

  const penNameRow = page.getByRole('article').filter({ hasText: '青衫客' });
  await penNameRow.getByRole('button', { name: '设为默认' }).click();
  await expect(page.getByText('“青衫客”已设为默认笔名。')).toBeVisible();

  const passwordForm = page.getByRole('form', { name: '修改密码表单' });
  await passwordForm.getByLabel('当前密码').fill(initialPassword);
  await passwordForm.getByLabel('新密码', { exact: true }).fill(changedPassword);
  await passwordForm.getByLabel('再次输入新密码').fill(changedPassword);
  await passwordForm.getByRole('button', { name: '修改密码' }).click();
  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
  await expect(page.getByText('密码已修改，请用新密码登录。')).toBeVisible();
  await login(page, email, changedPassword);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: '忘记密码' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel('注册邮箱').fill(email);
  await page.getByRole('button', { name: '发送重置邮件' }).click();
  await expect(page.getByText('如果这个邮箱已注册')).toBeVisible();

  const resetToken = await readResetToken(email);
  await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
  await page.getByLabel('新密码', { exact: true }).fill(resetPassword);
  await page.getByLabel('再次输入新密码').fill(resetPassword);
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page).toHaveURL(/\/login\?passwordReset=1$/, { timeout: 15_000 });
  await expect(page.getByText('密码已重置，请用新密码登录。')).toBeVisible();
  await login(page, email, resetPassword);

  await page.getByRole('link', { name: '账号设置' }).click();
  const emailForm = page.getByRole('form', { name: '邮箱变更表单' });
  await emailForm.getByLabel('新邮箱').fill(newEmail);
  await emailForm.getByLabel('当前密码').fill(resetPassword);
  await emailForm.getByRole('button', { name: '发送新邮箱验证码' }).click();
  await expect(page.getByText('验证码已发到新邮箱，请查收。')).toBeVisible();

  const verifyForm = page.getByRole('form', { name: '邮箱验证表单' });
  await verifyForm.getByLabel('验证码').fill(await readCode(newEmail));
  await verifyForm.getByRole('button', { name: '确认修改邮箱' }).click();
  await expect(page).toHaveURL(/\/login\?emailChanged=1$/);
  await expect(page.getByText('邮箱已修改，请用新邮箱登录。')).toBeVisible();
  await login(page, newEmail, resetPassword);

  await page.getByRole('link', { name: '账号设置' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部数据' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^novelbrain-account-/);
  await expect(page.getByText('账号数据已导出，可以继续申请注销。')).toBeVisible();

  const deleteForm = page.getByRole('form', { name: '注销申请表单' });
  await deleteForm.getByLabel('当前密码').fill(resetPassword);
  await deleteForm.getByLabel('输入“注销账号”').fill('注销账号');
  await deleteForm.getByRole('button', { name: '申请注销账号' }).click();
  await expect(page).toHaveURL(/\/login\?deletionRequested=1$/);
  await expect(page.getByText('注销申请已提交，30 天内可以恢复。')).toBeVisible();

  await page.getByLabel('邮箱').fill(newEmail);
  await page.getByLabel('密码').fill(resetPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText('账号正在注销恢复期内')).toBeVisible();
  await page.getByRole('link', { name: '恢复这个账号' }).click();
  await expect(page).toHaveURL(/\/recover-account\?email=/);
  await page.getByLabel('密码').fill(resetPassword);
  await page.getByRole('button', { name: '恢复账号' }).click();
  await expect(page).toHaveURL(/\/login\?recovered=1$/, { timeout: 15_000 });
  await expect(page.getByText('账号已恢复，请重新登录。')).toBeVisible();
  await login(page, newEmail, resetPassword);

  await page.getByRole('link', { name: '账号设置' }).click();
  await expect(page.getByLabel('显示名')).toHaveValue('青云客');
  await expect(page.getByText('青衫客', { exact: true })).toBeVisible();
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({
    fullPage: true,
    path: 'test-results/account-lifecycle-mobile.png',
  });
});
