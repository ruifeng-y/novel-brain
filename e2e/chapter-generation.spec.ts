import { expect, test } from '@playwright/test';

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

test('an author can generate, edit, save, and recover a chapter in the writing desk', async ({
  page,
}) => {
  const email = `chapter-generation-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `天门残卷${Date.now()}`;
  const storyBible = {
    oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
    protagonist: '沈砚，外冷内热的边城剑客',
    worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
  };
  const chapterOutline = {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '沈砚逃入荒寺避雨\n断碑浮现旧日剑痕\n残剑认主并反噬记忆',
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  };

  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `192.0.2.${(Date.now() % 250) + 1}`,
  });
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible();

  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole('link', { name: '模型设置' }).click();
  await page.getByLabel('配置名称').fill('DeepSeek 正文');
  await page.getByLabel('API Key').fill('sk-e2e-fake-provider');
  await page.getByLabel('用途', { exact: true }).selectOption('prose');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已保存')).toBeVisible();

  await page.getByRole('link', { name: '作品书架' }).click();
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);

  await page.getByLabel('一句话故事').fill(storyBible.oneSentenceStory);
  await page.getByLabel('主角').fill(storyBible.protagonist);
  await page.getByLabel('世界铁律').fill(storyBible.worldIronLaw);
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  await page.getByLabel('章目标').fill(chapterOutline.chapterGoal);
  await page.getByLabel('叙事视角').fill(chapterOutline.pov);
  await page.getByLabel('场景节拍').fill(chapterOutline.sceneBeats);
  await page.getByLabel('章末钩子').fill(chapterOutline.chapterEndHook);
  await page.getByRole('button', { name: '保存章纲' }).click();
  await expect(page.getByText('章纲已保存')).toBeVisible();

  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/write$/);
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本章参考' })).toBeVisible();
  await expect(page.getByLabel('章节正文')).toBeVisible();
  await expect(page.getByText('第 1 章').first()).toBeVisible();

  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await page.getByLabel('章节正文').inputValue()).length)
    .toBeGreaterThanOrEqual(2000);
  await expect
    .poll(async () => (await page.getByLabel('章节正文').inputValue()).length)
    .toBeLessThanOrEqual(3000);
  await expect(page.getByText('2,400 字', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();
  const savedContent = await page.getByLabel('章节正文').inputValue();

  await page.reload();
  await expect(page.getByLabel('章节正文')).toHaveValue(savedContent);
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();

  await page.getByRole('link', { name: '作品与章纲' }).click();
  await page
    .getByLabel('章目标')
    .fill(`${chapterOutline.chapterGoal} [[FAIL_AFTER_PARTIAL]]`);
  await page.getByRole('button', { name: '保存章纲' }).click();
  await expect(page.getByText('章纲已保存')).toBeVisible();
  await page.getByRole('link', { name: '写作台', exact: true }).click();

  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.locator('.writing-error[role="alert"]')).toContainText('已经写出的内容');
  const partialDraft = await page.getByLabel('章节正文').inputValue();
  expect(partialDraft.length).toBeGreaterThan(0);
  expect(partialDraft.length).toBeLessThan(savedContent.length);
  await expect(page.getByRole('button', { name: '恢复生成前内容' })).toBeVisible();

  await page.getByRole('button', { name: '恢复生成前内容' }).click();
  await expect(page.getByLabel('章节正文')).toHaveValue(savedContent);

  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(
    0,
  );
});
