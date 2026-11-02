import { expect, test, type Page } from '@playwright/test';
import { createFirstChapterOutline, currentWorkAndBranch, useIsolatedClientIp } from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

const SCREENSHOT_DIR = process.env.M0_SCREENSHOT_DIR ?? 'test-results/m0-acceptance';

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

async function signInThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText(email)).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({
    fullPage: true,
    path: `${SCREENSHOT_DIR}/${name}`,
  });
}

test('M0 acceptance: one author journey reaches confirmed facts and visible continuity', async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `m0-acceptance-${stamp}@example.com`;
  const password = 'correct horse battery staple';
  const title = `天门残卷·验收${stamp}`;
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
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signInThroughUi(page, email, password);

  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('link', { name: '模型设置' }).click();
  await expect(page.getByRole('heading', { name: '模型设置' })).toBeVisible();
  await page.getByLabel('配置名称').fill('M0 本地验收模型');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:9/openai-compatible');
  await page.getByLabel('模型名').fill('deepseek-chat');
  await page.getByLabel('API Key').fill('sk-m0-local-only');
  await page.getByLabel('用途', { exact: true }).selectOption('prose');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已保存')).toBeVisible();
  await expect(page.getByText('••••••••', { exact: true })).toBeVisible();
  await expect(page.getByText('sk-m0-local-only')).toHaveCount(0);
  await capture(page, '01-model-settings.png');

  await page.getByRole('link', { name: '作品书架' }).click();
  await page.getByRole('link', { name: `打开《${title}》` }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByLabel('一句话故事').fill(storyBible.oneSentenceStory);
  await page.getByLabel('主角').fill(storyBible.protagonist);
  await page.getByLabel('世界铁律').fill(storyBible.worldIronLaw);
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  const work = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, work.workId, work.branchId, chapterOutline);
  await page.reload();
  await expect(page.getByRole('heading', { name: '完整大纲' })).toBeVisible();
  await capture(page, '02-story-bible-and-outline.png');

  await page.getByRole('link', { name: '写作台', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/write$/);
  await expect(page.getByRole('heading', { name: '写作进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本章参考' })).toBeVisible();
  await page.getByRole('tab', { name: '连续性' }).click();
  await expect(page.getByRole('heading', { name: '连续性提示' })).toBeVisible();

  await page.getByRole('button', { name: '根据章纲生成' }).click();
  await expect(page.getByRole('button', { name: '正在生成…' })).toBeVisible();
  await expect
    .poll(async () => (await page.getByLabel('章节正文').inputValue()).length)
    .toBeGreaterThan(0);
  await capture(page, '03-streaming-chapter.png');

  await expect(page.getByText('初稿已生成', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('2,500 字', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText('版本 1 已保存')).toBeVisible();

  const factPanel = page.getByRole('region', { name: '本章事实' });
  await expect(factPanel.getByText('来源原句')).toHaveCount(3);
  for (const type of ['事件', '身体状况', '角色认知']) {
    const proposal = factPanel.getByTestId(
      `fact-proposal-${type === '事件' ? 'event' : type === '身体状况' ? 'body_state' : 'character_knowledge'}`,
    );
    await proposal.getByRole('button', { name: '确认采用' }).click();
    await expect(proposal.getByText('已确认')).toBeVisible();
  }
  await expect(factPanel.getByText('3 条已确认')).toBeVisible();
  await expect(factPanel.getByText('已加入已确认设定，下一章会继续遵守。').last()).toBeVisible();
  await capture(page, '04-confirmed-facts.png');

  const continuityPanel = page.getByRole('region', { name: '连续性提示' });
  await expect(continuityPanel).toBeVisible();
  await expect(continuityPanel.getByText('这一章暂时没有发现前后设定冲突。')).toBeVisible();
  await expect(page.getByText('已确认设定', { exact: true })).toHaveCount(0);
  await continuityPanel.screenshot({
    path: `${SCREENSHOT_DIR}/05-continuity-state.png`,
  });

  const savedContent = await page.getByLabel('章节正文').inputValue();
  await page.reload();
  await expect(page.getByLabel('章节正文')).toHaveValue(savedContent);
  await expect(page.getByTestId('fact-proposal-event').getByText('已确认')).toBeVisible();
  await expect(
    page.getByTestId('fact-proposal-character_knowledge').getByText('已确认'),
  ).toBeVisible();
  await page.getByRole('tab', { name: '连续性' }).click();
  await expect(page.getByRole('heading', { name: '连续性提示' })).toBeVisible();

  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);
});
