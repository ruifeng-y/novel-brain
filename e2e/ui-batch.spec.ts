import { expect, test } from '@playwright/test';
import {
  createFirstChapterOutline,
  createWork,
  currentWorkAndBranch,
  registerAuthor,
  useIsolatedClientIp,
} from './support';

test('the batch route exposes scopes, task history, and review queue', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-batch-${Date.now()}@example.com`;
  const title = `批量生产测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const { workId, branchId } = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, workId, branchId, {
    chapterGoal: '沈砚在雨夜断碑前确认母亲留下的天门线索。',
    pov: '沈砚',
    sceneBeats: '追兵逼近\n断碑显字\n沈砚以记忆换取线索',
    chapterEndHook: '碑上浮出母亲的名字。',
  });

  await page.goto(`/workspace/${workId}/batch`);
  await expect(page.getByRole('heading', { name: '把长跑拆成可管理的段落' })).toBeVisible();
  for (const label of ['按章', '按卷', '自定义区间', '全本']) {
    const tab = page.getByRole('tab', { name: label, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('heading', { name: '安排下一批章节' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '创作任务', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: /逐章审批/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /逐卷审批/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /自动通过/ })).toBeVisible();
  await expect(page.getByText('预计 token')).toBeVisible();
  await expect(page.getByText('预计费用')).toBeVisible();

  await page.getByRole('tab', { name: /审核队列/ }).click();
  await expect(page.getByRole('heading', { name: '待我确认' })).toBeVisible();
  await expect(page.getByLabel('风险筛选')).toBeVisible();

  await page.getByRole('tab', { name: '任务列表' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const desktopLayout = await page.evaluate(() => {
    const layout = document.querySelector('.task-layout');
    const estimate = document.querySelector('.task-estimate');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      layoutColumns: layout
        ? getComputedStyle(layout).gridTemplateColumns.split(' ').filter(Boolean).length
        : 0,
      estimateColumns: estimate
        ? getComputedStyle(estimate).gridTemplateColumns.split(' ').filter(Boolean).length
        : 0,
    };
  });
  expect(desktopLayout.overflow).toBeLessThanOrEqual(1);
  expect(desktopLayout.layoutColumns).toBe(2);
  expect(desktopLayout.estimateColumns).toBe(4);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
