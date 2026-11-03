import { expect, test } from '@playwright/test';
import { registerAuthor, useIsolatedClientIp } from './support';

test('an author can create a work through the six-step wizard', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-wizard-${Date.now()}@example.com`;
  const title = `向导测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await page.goto('/workspace/new-project');

  await expect(page.getByRole('heading', { name: '把一个想法，长成一本书' })).toBeVisible();
  await page.getByLabel('故事灵感').fill('一个被宗门抛弃的杂役，靠一本吞噬记忆的古书爬上仙途。');
  await page.getByLabel('书名').fill(title);
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByRole('heading', { name: '选择题材与规模' })).toBeVisible();
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByRole('heading', { name: '把写作目标定清楚' })).toBeVisible();
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByLabel('目标读者').fill('喜欢长线伏笔的读者');
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByRole('heading', { name: '告诉系统读者的期待和边界' })).toBeVisible();
  await page.getByLabel('简介').fill('杂役从一本古书里翻出自己的身世。');
  await page.getByLabel('作品标签').fill('升级流，长线伏笔，群像');
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByRole('heading', { name: '故事蓝图预览' })).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByRole('heading', { name: '确认创建' })).toBeVisible();
  await page.getByRole('button', { name: '创建作品并进入总览' }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('an author can preview, merge, and split imported chapters', async ({ page }) => {
  test.setTimeout(90_000);

  const email = `ui-import-${Date.now()}@example.com`;
  const title = `导入测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await page.goto('/workspace/new-project');
  await page.getByRole('tab', { name: '导入旧稿' }).click();

  const manuscript = [
    '# 第一章 断碑',
    '',
    '沈砚在雨里看见断碑。',
    '',
    '# 第二章 夜行',
    '',
    '他沿着河岸走进夜色。',
  ].join('\n');
  await page.getByLabel('旧稿文件').setInputFiles({
    name: '旧稿.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(manuscript),
  });

  await expect(page.getByLabel('章节标题 1')).toHaveValue('第一章 断碑');
  await expect(page.getByLabel('章节标题 2')).toHaveValue('第二章 夜行');
  await page.getByRole('button', { name: '合并下一章' }).first().click();
  await expect(page.getByLabel('章节标题 2')).toHaveCount(0);
  await page.getByRole('button', { name: '拆分' }).first().click();
  await expect(page.getByLabel('章节标题 2')).toBeVisible();

  await page.getByLabel('书名').fill(title);
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '导入作品并进入总览' }).click();

  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
