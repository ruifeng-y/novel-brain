import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the changes route exposes requests, parallel versions, and rollback', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-changes-${Date.now()}@example.com`;
  const title = `修改版本测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-2);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/changes`);
  await expect(page.getByRole('heading', { name: '修改与版本' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '修改与版本栏目' });
  await expect(nav.getByRole('button', { name: '修改请求', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: '修改请求' })).toBeVisible();

  await nav.getByRole('button', { name: '平行版本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '平行版本' })).toBeVisible();

  await nav.getByRole('button', { name: '版本与回滚', exact: true }).click();
  await expect(page.getByRole('heading', { name: '版本图' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
