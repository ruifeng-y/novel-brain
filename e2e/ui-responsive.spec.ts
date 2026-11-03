import { expect, test } from '@playwright/test';
import {
  createFirstChapterOutline,
  createWork,
  currentWorkAndBranch,
  registerAuthor,
  useIsolatedClientIp,
} from './support';

test('eighteen primary pages hold at 1440, 1180, 900, and 390', async ({ page }) => {
  test.setTimeout(300_000);

  const email = `ui-responsive-${Date.now()}@example.com`;
  const title = `响应式测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);
  const { workId, branchId } = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, workId, branchId, {
    chapterGoal: '沈砚在断碑前确认母亲留下的线索。',
    pov: '沈砚',
    sceneBeats: '追兵逼近\n断碑显字',
    chapterEndHook: '碑上浮出母亲的名字。',
  });

  const routes = [
    '/workspace',
    '/workspace/new-project',
    '/workspace/settings',
    '/workspace/settings/account',
    '/workspace/settings/privacy',
    '/help',
    '/legal/privacy',
    '/legal/terms',
    '/legal/ai-content',
    `/workspace/${workId}/overview`,
    `/workspace/${workId}/bible`,
    `/workspace/${workId}/settings`,
    `/workspace/${workId}/outline`,
    `/workspace/${workId}/foreshadows`,
    `/workspace/${workId}/write`,
    `/workspace/${workId}/batch`,
    `/workspace/${workId}/changes`,
    `/workspace/${workId}/export`,
    `/workspace/${workId}/states`,
  ];

  for (const width of [1440, 1180, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(120);
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        iconButtons: [...document.querySelectorAll('.app-icon-button')]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { width: Math.round(rect.width), height: Math.round(rect.height) };
          })
          .filter((button) => button.width > 0 && button.height > 0),
      }));
      expect(metrics.overflow, `${route} overflows at ${width}px`).toBeLessThanOrEqual(1);
      for (const button of metrics.iconButtons) {
        expect(button.width, `${route} icon button width at ${width}px`).toBeGreaterThanOrEqual(24);
        expect(button.height, `${route} icon button height at ${width}px`).toBeGreaterThanOrEqual(24);
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${workId}/states`);
  for (const label of ['正常', '空状态', '加载', '错误', '锁定', '只读', '冲突']) {
    await expect(page.locator('.state-demo-card > span').filter({ hasText: label })).toBeVisible();
  }
});
