import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('settings center tabs work and a faction can be created', async ({ page }) => {
  test.setTimeout(180_000);

  const email = `ui-settings-${Date.now()}@example.com`;
  const title = `设定中心测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-2);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/settings`);
  await expect(page.getByRole('heading', { name: '设定中心' })).toBeVisible();
  const sectionNav = page.getByRole('navigation', { name: '设定中心栏目' });
  for (const label of [
    '世界规则',
    '人物档案',
    '势力',
    '地图',
    '力量体系',
    '物品功法',
    '金手指',
    '时间线',
    '已确认设定',
    '自定义字段',
  ]) {
    await expect(sectionNav.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await sectionNav.getByRole('button', { name: '势力', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设定档案' })).toBeVisible();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('太玄门');
  await page.getByLabel('一句话摘要', { exact: true }).fill('正道魁首，控制东境三十六城。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();
  await expect(page.getByText('太玄门').first()).toBeVisible();

  await sectionNav.getByRole('button', { name: '已确认设定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已确认设定' })).toBeVisible();
  await expect(page.getByText('还没有符合条件的已确认设定。')).toBeVisible();

  await sectionNav.getByRole('button', { name: '自定义字段', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '自定义字段', level: 2 }),
  ).toBeVisible();

  await page.getByLabel('字段名称').fill('旧伤备注');
  await page.getByLabel('字段类型').selectOption('long_text');
  const applicable = page.locator('.settings-field-applicable');
  await applicable.getByLabel('人物').click();
  await page.getByLabel('必填').click();
  await page.getByRole('button', { name: '添加字段' }).click();
  await expect(page.getByText('字段已添加')).toBeVisible();
  await expect(page.getByText('旧伤备注').first()).toBeVisible();

  await sectionNav.getByRole('button', { name: '人物档案', exact: true }).click();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('沈砚');
  await page.getByLabel('旧伤备注').fill('左臂旧伤，阴雨天会疼。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();
  await expect(page.getByRole('heading', { name: '自定义字段值' })).toBeVisible();
  await expect(
    page.getByRole('definition').getByText('左臂旧伤，阴雨天会疼。'),
  ).toBeVisible();

  await sectionNav.getByRole('button', { name: '自定义字段', exact: true }).click();
  await page.getByRole('button', { name: '编辑' }).click();
  await page.getByLabel('字段名称').fill('人物旧伤');
  await page.getByRole('button', { name: '保存字段' }).click();
  await expect(page.getByText('字段已更新')).toBeVisible();
  await page.getByRole('button', { name: '停用' }).click();
  await expect(page.getByText('字段已停用，已有数据保留')).toBeVisible();
  await expect(page.getByText('已停用，已有数据保留', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
