import { expect, test, type Page } from '@playwright/test';
import {
  createFirstChapterOutline,
  currentWorkAndBranch,
  openWorkBible,
  useIsolatedClientIp,
} from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

async function readVerificationCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const payload = (await response.json()) as { messages: MailpitMessage[] };
    const message = payload.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address === email),
    );
    if (message) {
      const detailResponse = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as { Text: string; Snippet: string };
      const code = `${detail.Text}\n${detail.Snippet}`.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
      if (code) {
        return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification email arrived for ${email}`);
}

async function registerAuthor(page: Page, email: string): Promise<void> {
  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill('correct horse battery staple');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function configureProseModel(page: Page): Promise<void> {
  await page.getByRole('link', { name: '模型设置' }).click();
  await page.getByLabel('配置名称').fill('DeepSeek 正文');
  await page.getByLabel('API Key').fill('sk-e2e-fake-provider');
  await page.getByLabel('用途', { exact: true }).selectOption('prose');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已保存')).toBeVisible();
}

async function createWorkWithOutline(page: Page, title: string): Promise<void> {
  if (new URL(page.url()).pathname !== '/workspace') {
    await page.getByRole('link', { name: '作品书架' }).click();
  }
  await page.goto('/workspace?quick=1');
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);

  await openWorkBible(page);
  await page.getByLabel('一句话故事').fill('边城少年以残剑问仙，最终守住人间最后一道天门。');
  await page.getByLabel('主角').fill('沈砚，外冷内热的边城剑客');
  await page.getByLabel('世界铁律').fill('任何人借天门之力，都必须以一段真实记忆作为代价。');
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  const work = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, work.workId, work.branchId, {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '沈砚逃入荒寺避雨\n断碑浮现旧日剑痕\n残剑认主并反噬记忆',
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  });
  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/write$/);
}

test('an author can drive the full writing desk with generation controls and annotations', async ({
  page,
}) => {
  const email = `full-desk-actions-${Date.now()}@example.com`;
  await registerAuthor(page, email);
  await configureProseModel(page);
  await createWorkWithOutline(page, `完整写作台${Date.now()}`);

  await expect(page.locator('.writing-chapters')).toBeVisible();
  await expect(page.locator('.writing-editor')).toBeVisible();
  await expect(page.locator('.writing-context')).toBeVisible();
  await expect(page.getByRole('heading', { name: '生成设置' })).toBeVisible();

  await page.getByLabel('质量档位').selectOption('premium');
  await page.getByLabel('目标字数').fill('2500');
  await page.getByLabel('叙事视角').fill('沈砚');
  await page.getByLabel('必须包含').fill('断碑');
  await page.getByLabel('必须避免').fill('天降神迹');
  await page.getByLabel('禁忌词').fill('血');
  await page.getByLabel('参考章节').selectOption(['1']);
  await page.getByLabel('补充要求').fill('放慢节奏，保留悬念。');

  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="inline-continuity-mark"]').first()).toBeVisible();

  const suggestionPanel = page.getByRole('region', { name: '编辑建议' });
  await expect(suggestionPanel).toBeVisible();
  await expect(suggestionPanel.getByText('禁忌词')).toBeVisible();
  await suggestionPanel.getByRole('button', { name: '定位原文' }).first().click();
  const selectedCharacters = await page.getByLabel('章节正文').evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    return textarea.selectionEnd - textarea.selectionStart;
  });
  expect(selectedCharacters).toBeGreaterThan(0);

  await suggestionPanel.getByLabel('忽略原因').fill('这里的“血”是记忆反噬的意象，保留。');
  await suggestionPanel.getByRole('button', { name: '忽略这条建议' }).click();
  await expect(suggestionPanel.getByText('已忽略', { exact: true })).toBeVisible();

  const body = page.getByLabel('章节正文');
  const beforeRewrite = await body.inputValue();
  await body.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(20, 90);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.getByRole('button', { name: '重写选中' }).click();
  await expect(page.getByText('改写已生成', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const afterRewrite = await body.inputValue();
  expect(afterRewrite.startsWith(beforeRewrite.slice(0, 20))).toBe(true);
  expect(afterRewrite.endsWith(beforeRewrite.slice(90))).toBe(true);

  const beforeContinue = await body.inputValue();
  await body.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(180, 180);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.getByRole('button', { name: '从光标续写' }).click();
  await expect(page.getByText('续写已经接在光标处，可以继续打磨。')).toBeVisible({
    timeout: 20_000,
  });
  const afterContinue = await body.inputValue();
  expect(afterContinue.startsWith(beforeContinue.slice(0, 180))).toBe(true);
  expect(afterContinue.endsWith(beforeContinue.slice(180))).toBe(true);

  await page.getByRole('button', { name: '生成章末钩子' }).click();
  await expect(page.getByText('章末钩子备选')).toBeVisible({ timeout: 20_000 });
  const hookPanel = page.getByRole('region', { name: '编辑建议' });
  await expect(hookPanel.locator('.hook-option-list li')).toHaveCount(3);
  await hookPanel.getByRole('button', { name: '放到章末' }).first().click();
  await expect(body).toHaveValue(/有人用他母亲的声音叫了他的名字/);

  await page.getByRole('button', { name: '生成标题' }).click();
  await expect(page.getByText('断碑问心', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '使用这个标题' }).click();
  await expect(page.getByRole('heading', { name: '断碑问心' })).toBeVisible();

  await page.getByRole('button', { name: '生成摘要' }).click();
  await expect(page.getByText('本章摘要已生成，可在建议面板里保存。')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '保存摘要' }).click();
  await expect(page.getByText('本章摘要已保存。')).toBeVisible();

  const work = await currentWorkAndBranchFromWritePage(page);
  const chapter = await page.request.get(
    `/api/v1/works/${work.workId}/branches/${work.branchId}/chapters/1`,
  );
  const chapterBody = (await chapter.json()) as { title: string; summary: string };
  expect(chapterBody.title).toBe('断碑问心');
  expect(chapterBody.summary).toContain('沈砚在荒寺断碑前');

  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);
});

test('an author can autosave, compare versions, restore, and open every context panel', async ({
  page,
}) => {
  const email = `full-desk-version-${Date.now()}@example.com`;
  await registerAuthor(page, email);
  await createWorkWithOutline(page, `版本写作台${Date.now()}`);

  const body = page.getByLabel('章节正文');
  await body.fill('第一版正文。\n沈砚走进荒寺。');
  await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel('章节正文')).toHaveValue('第一版正文。\n沈砚走进荒寺。');

  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();

  await page.getByLabel('章节正文').fill('第二版正文。\n沈砚在断碑前停下。\n门外有人叫他的名字。');
  await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 2 已保存')).toBeVisible();

  await page.getByRole('tab', { name: '版本' }).click();
  const versionPanel = page.getByRole('region', { name: '版本历史' });
  await expect(versionPanel).toBeVisible();
  await versionPanel.getByRole('button', { name: /版本 1/ }).click();
  const versionDiff = page.getByTestId('version-diff');
  await expect(versionDiff.locator('.version-diff-removed').first()).toContainText('第一版正文');
  await expect(versionDiff.locator('.version-diff-added').first()).toContainText('第二版正文');

  await versionPanel.getByRole('button', { name: '恢复版本 1' }).click();
  await expect(page.getByText(/已恢复版本 1/)).toBeVisible();
  await expect(page.getByLabel('章节正文')).toHaveValue('第一版正文。\n沈砚走进荒寺。');

  await page.getByRole('tab', { name: '连续性' }).click();
  await expect(page.getByRole('region', { name: '连续性提示' })).toBeVisible();
  await page.getByRole('tab', { name: '伏笔' }).click();
  await expect(page.getByRole('region', { name: '伏笔' })).toBeVisible();
  await page.getByRole('tab', { name: '人物' }).click();
  await expect(page.getByRole('region', { name: '人物状态' })).toBeVisible();
  await page.getByRole('tab', { name: '建议' }).click();
  await expect(page.getByRole('region', { name: '编辑建议' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);
});

async function currentWorkAndBranchFromWritePage(
  page: Page,
): Promise<{ workId: string; branchId: string }> {
  const workId = new URL(page.url()).pathname.split('/').at(-2);
  if (!workId) {
    throw new Error('The current page is not a writing desk page');
  }
  const response = await page.request.get(`/api/v1/works/${workId}`);
  if (!response.ok()) {
    throw new Error(`Could not read the current work: ${response.status()}`);
  }
  const work = (await response.json()) as { mainBranch: { id: string } };
  return { workId, branchId: work.mainBranch.id };
}
