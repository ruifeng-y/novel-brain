import { expect, test } from '@playwright/test';
import {
  createFirstChapterOutline,
  createWork,
  currentWorkAndBranch,
  registerAuthor,
  useIsolatedClientIp,
} from './support';

test('the outline route exposes structure, board, ledger, and golden three chapters', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const email = `ui-outline-${Date.now()}@example.com`;
  const title = `大纲测试${Date.now()}`;

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

  await page.goto(`/workspace/${work.workId}/outline`);
  await expect(page.getByRole('heading', { name: '大纲工作台' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '大纲栏目' });
  await expect(nav.getByRole('button', { name: '结构树', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: '完整大纲' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '生成准备度' })).toBeVisible();

  await nav.getByRole('button', { name: '章节看板', exact: true }).click();
  await expect(page.getByRole('heading', { name: '章节看板' })).toBeVisible();
  await expect(page.getByText('第一卷 天门初开').first()).toBeVisible();
  await expect(page.getByText('第一章 断碑').first()).toBeVisible();

  await nav.getByRole('button', { name: '账本与张力', exact: true }).click();
  await expect(page.getByRole('heading', { name: '剧情线、伏笔与人物弧' })).toBeVisible();

  await nav.getByRole('button', { name: '黄金三章', exact: true }).click();
  await expect(page.getByRole('heading', { name: '黄金三章开篇策略' })).toBeVisible();
  await expect(page.getByLabel('第 1 章章目标')).toHaveValue(
    '沈砚在断碑前第一次引动残剑。',
  );
  await page.getByLabel('第 1 章章目标').fill('沈砚在断碑前第一次引动残剑，并付出记忆代价。');
  await page.getByRole('button', { name: '保存第 1 章' }).click();
  await expect(page.getByText('第 1 章黄金三章策略已保存')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
