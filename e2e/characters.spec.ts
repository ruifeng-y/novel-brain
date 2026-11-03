import { expect, test } from '@playwright/test';
import { useIsolatedClientIp } from './support';

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

test('an author can maintain a character profile, state, and knowledge history', async ({
  page,
}) => {
  const email = `character-state-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `断碑人物${Date.now()}`;

  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });

  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await page.getByRole('link', { name: '设定中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设定中心' })).toBeVisible();

  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('沈砚');
  await page.getByLabel('类型', { exact: true }).selectOption({ label: '人物' });
  await page.getByLabel('一句话摘要').fill('外冷内热的边城剑客。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();
  await expect(page.locator('#character-panel-title')).toBeVisible();

  await page.getByLabel('欲望').fill('找回被天门吞掉的母亲。');
  await page.getByLabel('恐惧').fill('发现自己也是天门留下的记忆。');
  await page.getByLabel('秘密').fill('他曾在断碑前主动交出过一段童年。');
  await page.getByLabel('声纹').fill('句子短，少用反问；提到母亲时会停顿。');
  await page.getByLabel('弧光').fill('从只信手中剑，到愿意把真相交给同行者。');
  await page.getByRole('button', { name: '保存人物档案' }).click();
  await expect(page.getByText('人物档案已保存')).toBeVisible();

  await page.getByLabel('身体状态').fill('左臂完好，能双手持剑。');
  await page.getByLabel('力量状态').fill('筑基初期，残剑认主后可短暂借剑意。');
  await page.getByLabel('所在地').fill('边城荒寺');
  await page.getByLabel('持有物').fill('残剑、母亲留下的半枚铜钱。');
  await page.getByLabel('伪装').fill('披旧斗篷，不显露左手剑茧。');
  await page.getByRole('button', { name: '添加知识' }).click();
  await page.getByLabel('知识主题 1').fill('父母之死');
  await page.getByLabel('实际发生 1').fill('父母被仇家灭口，现场被伪造成双双自尽。');
  await page.getByLabel('人物以为 1').fill('父母因欠债羞愧而自杀。');
  await page.getByLabel('有效期起点 1').fill('第 1 章');
  await page.getByLabel('有效期终点 1').fill('第 119 章');
  await page.getByLabel('知识来源 1').fill('第 1 章手稿');
  await page.getByLabel('状态变更原因').fill('录入初始状态');
  await page.getByLabel('状态来源').fill('第 1 章手稿');
  await page.getByRole('button', { name: '保存当前状态' }).click();
  await expect(page.getByText('当前状态已保存')).toBeVisible();
  await expect(page.getByText('第 1 版状态')).toBeVisible();
  await expect(page.getByText('第 1 次更新')).toBeVisible();
  await expect(page.getByText('录入初始状态 · 第 1 章手稿')).toBeVisible();

  await page.getByLabel('身体状态').fill('左臂骨折，吊在胸前，暂时无法双手结印。');
  await page.getByLabel('状态变更原因').fill('断碑机关发动，左臂被石门压断');
  await page.getByLabel('状态来源').fill('第 3 章手稿');
  await page.getByRole('button', { name: '保存当前状态' }).click();
  await expect(page.getByText('第 2 版状态')).toBeVisible();
  await expect(page.getByText('第 2 次更新')).toBeVisible();
  await expect(page.getByText('断碑机关发动，左臂被石门压断 · 第 3 章手稿')).toBeVisible();
  await expect(page.getByLabel('身体状态')).toHaveValue('左臂骨折，吊在胸前，暂时无法双手结印。');

  await expect(
    page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV|objectiveTruth|characterBelief/),
  ).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ticket-13-character-state-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#character-panel-title')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-13-character-state-mobile.png',
    fullPage: true,
  });
});
