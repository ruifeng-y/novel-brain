import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('an author gets the account and work shell with a responsive drawer', async ({ page }) => {
  test.setTimeout(120_000);

  const email = `ui-shell-${Date.now()}@example.com`;
  const title = `壳层测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');

  await expect(page.getByRole('navigation', { name: '账号导航' })).toBeVisible();
  await expect(page.getByRole('link', { name: '工作台', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全局搜索' })).toBeVisible();
  await expect(page.getByRole('button', { name: '通知' })).toBeVisible();
  await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible();
  await expect(page.getByRole('link', { name: '故事圣经' })).toHaveCount(0);

  await page.getByRole('button', { name: '折叠侧栏' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-collapsed', 'true');
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-collapsed', 'false');

  await createWork(page, title);
  await expect(page.getByRole('navigation', { name: '作品导航' })).toBeVisible();

  for (const name of [
    '作品总览',
    '故事圣经',
    '设定中心',
    '大纲工作台',
    '伏笔账本',
    '写作台',
    '批量生产',
    '修改与版本',
    '导出与发布',
  ]) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: '作品总览', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('link', { name: '故事圣经', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/bible$/);
  await expect(page.getByRole('heading', { name: '故事圣经', exact: true })).toBeVisible();

  await page.getByRole('link', { name: '设定中心', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/settings$/);
  await expect(page.getByRole('heading', { name: '设定中心', exact: true })).toBeVisible();

  await page.getByRole('link', { name: '大纲工作台', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/outline$/);
  await expect(page.getByRole('heading', { name: '大纲工作台', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '作品导航' })).toBeHidden();

  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('navigation', { name: '作品导航' })).toBeVisible();
  await page.getByRole('link', { name: '伏笔账本', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/foreshadows$/);
  await expect(page.getByRole('navigation', { name: '作品导航' })).toBeHidden();

  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('link', { name: '返回我的作品', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();

  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace');
    await expect(
      page
        .getByRole('navigation', { name: '账号导航' })
        .or(page.getByRole('button', { name: '打开导航' })),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
