import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the character tab shows profile, state, knowledge, relations, and history', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const email = `ui-character-${Date.now()}@example.com`;
  const title = `人物档案测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-1);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/settings`);
  const sectionNav = page.getByRole('navigation', { name: '设定中心栏目' });
  await sectionNav.getByRole('button', { name: '人物档案', exact: true }).click();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('沈砚');
  await page.getByLabel('一句话摘要', { exact: true }).fill('外门杂役，害怕再次被抛弃。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();

  await expect(page.locator('#character-panel-title')).toHaveText('沈砚');
  await expect(page.getByRole('heading', { name: '人物档案' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前状态' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '知识状态' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '人物关系' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '状态变更记录' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
