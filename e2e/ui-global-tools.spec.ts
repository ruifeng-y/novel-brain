import { expect, test } from '@playwright/test';
import {
  createFirstChapterOutline,
  createWork,
  currentWorkAndBranch,
  registerAuthor,
  useIsolatedClientIp,
} from './support';

test('global search, notifications, and help work together', async ({ page }) => {
  test.setTimeout(120_000);

  const email = `ui-global-${Date.now()}@example.com`;
  const title = `全局工具测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);
  const { workId, branchId } = await currentWorkAndBranch(page);

  await page.request.post(`/api/v1/works/${workId}/branches/${branchId}/entities`, {
    data: {
      name: '沈砚',
      aliases: ['守碑少年'],
      type: 'character',
      summary: '边城剑客。',
      description: '在断碑前追查母亲失踪的真相。',
      tags: ['主角'],
      scope: 'work',
      status: 'draft',
      customFields: {},
    },
  });
  await page.request.post(`/api/v1/works/${workId}/branches/${branchId}/entities`, {
    data: {
      name: '太玄门',
      aliases: [],
      type: 'faction',
      summary: '正道魁首。',
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
      customFields: {},
    },
  });
  await createFirstChapterOutline(page, workId, branchId, {
    chapterGoal: '沈砚在断碑前确认母亲留下的线索。',
    pov: '沈砚',
    sceneBeats: '追兵逼近\n断碑显字',
    chapterEndHook: '碑上浮出母亲的名字。',
  });
  await page.request.post(`/api/v1/works/${workId}/branches/${branchId}/jobs`, {
    data: {
      scope: { type: 'chapter', chapterNumber: 1 },
      settings: {
        approvalMode: 'chapter',
        targetMinCharacters: 1200,
        targetMaxCharacters: 1400,
      },
    },
  });

  await page.goto(`/workspace/${workId}/overview`);
  await page.getByRole('button', { name: '全局搜索' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索' });
  await search.getByPlaceholder(/搜索作品/).fill('沈砚');
  await expect(search.locator('.app-search-group-title').filter({ hasText: '人物' })).toBeVisible();
  await expect(search.locator('mark').first()).toBeVisible();
  await search.getByRole('link', { name: /沈砚/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workId}/settings\\?tab=character`));
  await expect(page.getByText('沈砚').first()).toBeVisible();

  await page.goto(`/workspace/${workId}/overview`);
  await page.getByRole('button', { name: '全局搜索' }).click();
  await page.getByRole('dialog', { name: '全局搜索' }).getByPlaceholder(/搜索作品/).fill('断碑');
  await expect(
    page
      .getByRole('dialog', { name: '全局搜索' })
      .locator('.app-search-group-title')
      .filter({ hasText: '大纲' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '通知' }).click();
  const notifications = page.getByRole('dialog', { name: '通知中心' });
  await expect(notifications).toBeVisible();
  await expect(notifications.getByText(/创作任务/).first()).toBeVisible();
  await expect(notifications.getByText('未读').first()).toBeVisible();
  await notifications.locator('.app-notification-list a').first().click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workId}/batch$`));

  await page.goto('/help');
  await expect(page.getByRole('heading', { name: '帮助与快捷键' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '快捷键', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '术语表' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FAQ' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
