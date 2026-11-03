import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the export route exposes export and publish preparation', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-export-${Date.now()}@example.com`;
  const title = `导出发布测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-1);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/export`);
  await expect(page.getByRole('heading', { name: '导出与发布' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '导出与发布栏目' });
  await expect(nav.getByRole('button', { name: '导出', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: '导出与平台预设' })).toBeVisible();

  await nav.getByRole('button', { name: '发布准备', exact: true }).click();
  await expect(page.getByRole('heading', { name: '发布准备' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
