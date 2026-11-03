import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the story bible route shows nine cards and saves edits', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-bible-${Date.now()}@example.com`;
  const title = `故事圣经测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-2);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/bible`);
  await expect(page.getByRole('heading', { name: '故事圣经' })).toBeVisible();
  await expect(page.locator('.story-bible-card')).toHaveCount(9);

  const nav = page.getByRole('complementary', { name: '故事圣经九卡导航' });
  await expect(nav.getByRole('link', { name: /主角/ })).toBeVisible();
  await nav.getByRole('link', { name: /主角/ }).click();
  await expect(page).toHaveURL(/#bible-card-protagonist$/);

  const firstCard = page.locator('.story-bible-card').first();
  await firstCard
    .getByLabel('一句话故事', { exact: true })
    .fill('边城少年以残剑问仙，最终守住人间最后一道天门。');
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();
});
