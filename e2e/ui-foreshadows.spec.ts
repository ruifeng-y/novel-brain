import { expect, test } from '@playwright/test';
import { createWork, registerAuthor, useIsolatedClientIp } from './support';

test('the foreshadow ledger route opens on the foreshadow tab and saves a clue', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const email = `ui-foreshadows-${Date.now()}@example.com`;
  const title = `伏笔账本测试${Date.now()}`;

  await useIsolatedClientIp(page);
  await registerAuthor(page, email, 'correct horse battery staple');
  await createWork(page, title);

  const workId = new URL(page.url()).pathname.split('/').at(-1);
  if (!workId) {
    throw new Error('The created work did not have an id');
  }

  await page.goto(`/workspace/${workId}/foreshadows`);
  await expect(page.getByRole('heading', { name: '伏笔账本' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '伏笔', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('button', { name: '记录新伏笔' }).click();
  await page.getByLabel('伏笔名称').fill('半枚青玉');
  await page.getByLabel('伏笔内容').fill('顾青带着半枚青玉，与沈砚身世有关。');
  await page.getByLabel('埋设章').fill('46');
  await page.getByLabel('计划回收章').fill('64');
  await page.getByRole('button', { name: '保存伏笔' }).click();
  await expect(page.getByText('伏笔已保存')).toBeVisible();
  await expect(page.getByText('半枚青玉').first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
