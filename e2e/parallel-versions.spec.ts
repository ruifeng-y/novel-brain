import { expect, test, type Page } from '@playwright/test';
import { createFirstChapterOutline, currentWorkAndBranch, useIsolatedClientIp } from './support';

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
  await page.getByLabel('验证码').fill(await readVerificationCode(email));
  await page.getByLabel('密码').fill('correct horse battery staple');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

test('an author can fork a saved version, compare it, and pick one chapter back to main', async ({
  page,
}) => {
  await registerAuthor(page, `parallel-versions-e2e-${Date.now()}@example.com`);
  await page.getByLabel('书名').fill(`平行版本${Date.now()}`);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);

  await page.getByLabel('一句话故事').fill('边城少年以残剑问仙，最终守住人间最后一道天门。');
  await page.getByLabel('主角').fill('沈砚，外冷内热的边城剑客');
  await page.getByLabel('世界铁律').fill('任何人借天门之力，都必须以一段真实记忆作为代价。');
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  const { workId, branchId } = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, workId, branchId, {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '沈砚逃入荒寺避雨\n断碑浮现旧日剑痕\n残剑认主并反噬记忆',
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  });

  await page.getByRole('link', { name: '写作台', exact: true }).click();
  const body = page.getByLabel('章节正文');
  await body.fill('沈砚听见剑鸣。');
  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();
  await body.fill('沈砚在断碑前听见了母亲的回音。');
  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 2 已保存')).toBeVisible();

  await page.goto(`/workspace/${workId}`);
  const panel = page.getByRole('region', { name: '平行版本' });
  await expect(panel).toBeVisible();
  await page.getByLabel('平行版本名称').fill('母亲回音的另一版');
  await page.getByLabel('创建原因').fill('试试让沈砚更早听见母亲的声音。');
  await page.getByLabel('版本类型').selectOption('alternate_ending');
  const versionOne = panel
    .getByLabel('分叉版本点')
    .locator('option')
    .filter({ hasText: '版本 1' })
    .first();
  await page
    .getByLabel('分叉版本点')
    .selectOption((await versionOne.getAttribute('value')) as string);
  await panel.getByRole('button', { name: '创建平行版本' }).click();
  await expect(page.getByText('平行版本已创建')).toBeVisible();

  const comparison = panel.getByRole('region', { name: '并排比较' });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByText('沈砚听见剑鸣。')).toBeVisible();
  await expect(comparison.getByText('沈砚在断碑前听见了母亲的回音。')).toBeVisible();
  await comparison.getByRole('checkbox', { name: /摘取第 1 章/ }).check();
  await comparison.getByRole('button', { name: '摘取选中内容到主线' }).click();
  await expect(page.getByText('已写入主线')).toBeVisible();

  await page.goto(`/workspace/${workId}/write`);
  await expect(page.getByLabel('章节正文')).toHaveValue('沈砚听见剑鸣。');
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
