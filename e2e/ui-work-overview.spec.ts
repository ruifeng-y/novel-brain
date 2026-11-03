import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('work overview shows readiness, quick links, and work settings', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-work-overview-${Date.now()}@example.com`;
  const title = `作品总览测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-1);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/overview`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('heading', { name: '准备度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近章节' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近修改' })).toBeVisible();

  await page.getByRole('link', { name: '作品设置' }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workId}/work-settings$`));
  await expect(page.getByRole('heading', { name: '作品设置' })).toBeVisible();
  await page.getByLabel('目标读者').fill('偏爱长线伏笔的读者');
  await page.getByRole('button', { name: '保存作品资料' }).click();
  await expect(page.getByText('作品资料已保存')).toBeVisible();

  await page.getByRole('link', { name: '返回作品总览' }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workId}/overview$`));
  await page.getByRole('button', { name: '归档' }).click();
  await expect(page.getByText('确认归档这部作品？')).toBeVisible();
  await page.getByRole('button', { name: '确认归档' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
});
