import { expect, test } from '@playwright/test';

test('landing page invites an author to sign in or register', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /把故事写到最后一行/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '创建作者账号' })).toBeVisible();
  await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible();
});

test('health page renders without a client crash', async ({ page }) => {
  await page.goto('/health');
  await expect(page.getByRole('heading', { name: /系统健康/i })).toBeVisible();
});
