import { expect, test } from '@playwright/test';

test('landing page shows the M0 scaffold', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /NovelBrain/i })).toBeVisible();
  await expect(page.getByText('M0 平台底座', { exact: true })).toBeVisible();
});

test('health page renders without a client crash', async ({ page }) => {
  await page.goto('/health');
  await expect(page.getByRole('heading', { name: /系统健康/i })).toBeVisible();
});
