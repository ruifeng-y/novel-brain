import { expect, test } from '@playwright/test';
import {
  createFirstChapterOutline,
  createWork,
  currentWorkAndBranch,
  registerAuthor,
  useIsolatedClientIp,
} from './support';

test('writing desk exposes insight tabs, facts, and focus mode', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-writing-aux-${Date.now()}@example.com`;
  const title = `写作辅助测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);
  const work = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, work.workId, work.branchId, {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '逃入荒寺避雨\n断碑浮现剑痕\n残剑认主并反噬记忆',
    chapterEndHook: '他想起的母亲，从未在自己的记忆里活过。',
  });

  await page.goto(`/workspace/${work.workId}/write`);
  for (const label of ['建议', '连续性', '质量', '伏笔', '人物', '版本']) {
    const tab = page.getByRole('tab', { name: label, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('heading', { name: '本章事实' })).toBeVisible();

  await expect(page.locator('.writing-chapters')).toBeVisible();
  await expect(page.locator('.writing-context')).toBeVisible();
  await page.getByRole('button', { name: '专注模式' }).click();
  await expect(page.locator('.writing-chapters')).toBeHidden();
  await expect(page.locator('.writing-context')).toBeHidden();
  await page.getByRole('button', { name: '退出专注' }).click();
  await expect(page.locator('.writing-chapters')).toBeVisible();
  await expect(page.locator('.writing-context')).toBeVisible();
});
