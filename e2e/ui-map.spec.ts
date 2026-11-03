import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the settings map tab supports layered places and travel controls', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-map-${Date.now()}@example.com`;
  const title = `地图测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-1);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/settings`);
  const sectionNav = page.getByRole('navigation', { name: '设定中心栏目' });
  await sectionNav.getByRole('button', { name: '地图', exact: true }).click();
  await expect(page.getByRole('heading', { name: '地图与势力' })).toBeVisible();

  await page.getByLabel('地点名称').fill('人界');
  await page.getByLabel('地点层级').selectOption('world');
  await page.getByRole('button', { name: '添加地点' }).click();
  await expect(page.getByText('地点已添加')).toBeVisible();
  await expect(page.getByText('人界').first()).toBeVisible();

  await page.getByLabel('地点名称').fill('东境');
  await page.getByLabel('地点层级').selectOption('continent');
  await page.getByLabel('上级地点').selectOption({ index: 1 });
  await page.getByRole('button', { name: '添加地点' }).click();
  await expect(page.getByText('东境').first()).toBeVisible();

  await expect(page.getByRole('heading', { name: '路程与旅行时间' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '势力控制范围' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
