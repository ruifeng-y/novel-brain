import { expect, test } from '@playwright/test';
import {
  createFirstChapterOutline,
  createWork,
  currentWorkAndBranch,
  registerAuthor,
  useIsolatedClientIp,
} from './support';

test('the writing desk opens with chapter navigation, editor, and version save', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const email = `ui-writing-${Date.now()}@example.com`;
  const title = `写作台测试${Date.now()}`;

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
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本章参考' })).toBeVisible();
  await expect(page.getByLabel('章节正文')).toBeVisible();
  await expect(page.getByRole('link', { name: '返回作品总览' })).toBeVisible();

  await page.getByLabel('章节正文').fill('沈砚在断碑前停下脚步，雨水顺着残剑滑落。');
  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();

  await page.getByRole('link', { name: '返回作品总览' }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${work.workId}/overview$`));
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
