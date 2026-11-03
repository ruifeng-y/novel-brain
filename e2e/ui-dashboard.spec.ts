import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the dashboard shows continue writing, today tasks, and recent changes', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-dashboard-${Date.now()}@example.com`;
  const title = `工作台测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');

  await expect(
    page.getByRole('heading', { name: '今天想把故事推进到哪里？' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '从第一本书开始' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日任务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近修改' })).toBeVisible();

  await createWork(page, title);
  await page.goto('/workspace');

  await expect(page.getByRole('heading', { name: `继续写《${title}》` })).toBeVisible();
  await expect(page.getByRole('link', { name: '继续写作' })).toHaveAttribute(
    'href',
    /\/workspace\/[0-9a-f-]+\/write$/,
  );
  await expect(page.getByText('未回收伏笔')).toBeVisible();
  await expect(page.locator('.dashboard-recent-list').getByText(title)).toBeVisible();

  const card = page.locator('.work-card', { hasText: title });
  await expect(card).toBeVisible();

  await page.getByLabel('分类').selectOption('xianxia');
  await expect(card).toBeVisible();

  await page.getByLabel('分类').selectOption('urban');
  await expect(page.getByRole('heading', { name: '书架还是空的' })).toBeVisible();

  await page.getByLabel('分类').selectOption('');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '归档' }).click();
  await expect(card).toHaveCount(0);

  await page.getByRole('tab', { name: '已归档' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '恢复作品' }).click();
  await page.getByRole('tab', { name: '进行中的作品' }).click();
  await expect(card).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
