import { expect, test } from '@playwright/test';

test('an author can review how data, model services, and deletion are handled', async ({
  page,
}) => {
  await page.goto('/legal/privacy');

  await expect(page.getByRole('heading', { level: 1, name: '隐私政策' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '我们处理的数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '模型服务与正文传输' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '保存期限与账号删除' })).toBeVisible();
  await expect(page.getByText('不会使用你的作品训练模型')).toBeVisible();
  await expect(page.getByText(/30 天/)).toBeVisible();
  await expect(page.getByText(/永久删除/)).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: '用户协议' })).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: 'AI 生成内容标识' })).toBeVisible();
});

test('the user agreement covers ownership, model services, and account deletion', async ({
  page,
}) => {
  await page.goto('/legal/terms');

  await expect(page.getByRole('heading', { level: 1, name: '用户协议' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '作品与版权' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '第三方模型服务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '数据导出与账号删除' })).toBeVisible();
  await expect(page.getByText('你保留作品的著作权')).toBeVisible();
  await expect(page.getByText(/30 天可恢复保留期/)).toBeVisible();
});

test('an author can find practical AI-generated content labeling guidance', async ({ page }) => {
  await page.goto('/legal/ai-content');

  await expect(page.getByRole('heading', { level: 1, name: 'AI 生成内容标识说明' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '什么时候需要标识' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '推荐标识写法' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '发布到平台时怎么填' })).toBeVisible();
  await expect(
    page.getByText('本文使用 AI 辅助生成，经作者编辑、校对并承担内容责任。'),
  ).toBeVisible();
  await expect(page.getByText(/不要依赖不可见的自动识别或水印/)).toBeVisible();
});

test('the author settings page collects privacy, export, deletion, and labeling links', async ({
  page,
}) => {
  await page.goto('/workspace/settings/privacy');

  await expect(page.getByRole('heading', { level: 1, name: '隐私与合规' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '你的数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '模型服务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '导出、恢复与删除' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI 创作标识' })).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: '查看隐私政策' })).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: '查看用户协议' })).toBeVisible();
  await expect(
    page.getByRole('complementary').getByRole('link', {
      exact: true,
      name: '查看 AI 标识说明',
    }),
  ).toBeVisible();
  await expect(page.getByText(/30 天可恢复期/)).toBeVisible();
});

test('legal documents are discoverable before signing in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { exact: true, name: '隐私政策' }).click();
  await expect(page).toHaveURL(/\/legal\/privacy$/);

  await page.goto('/register');
  await expect(page.getByRole('link', { exact: true, name: '隐私政策' })).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: '用户协议' })).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: 'AI 生成内容标识' })).toBeVisible();
});

test('public compliance pages do not expose internal implementation terms', async ({ page }) => {
  for (const path of ['/legal/privacy', '/legal/terms', '/legal/ai-content']) {
    await page.goto(path);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\b(?:Canon|ContextPack|Agent|BYOK|RLS)\b/i);
    expect(text).not.toContain('信封加密');
    expect(text).not.toContain('行级安全');
  }
});

test.describe('mobile legal documents', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keep long legal pages within the viewport', async ({ page }) => {
    for (const path of [
      '/legal/privacy',
      '/legal/terms',
      '/legal/ai-content',
      '/workspace/settings/privacy',
    ]) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, `${path} should not overflow horizontally`).toBe(false);
    }
  });
});
