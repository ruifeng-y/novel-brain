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
  await expect(page.getByRole('heading', { name: '把连续章节交给创作任务' })).toBeVisible();
  for (const label of ['按章', '按卷', '自定义区间', '全本']) {
    const tab = page.getByRole('tab', { name: label, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('heading', { name: '安排下一批章节' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '创作任务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '待我确认' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
