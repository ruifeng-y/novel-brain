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

test('an author can save and reopen a story bible and chapter outline', async ({ page }) => {
  const email = `story-planning-e2e-${Date.now()}@example.com`;
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
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);

  await expect(page.getByRole('heading', { name: '故事圣经' })).toBeVisible();
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

  await page.getByRole('link', { name: '返回作品列表' }).click();
  await page.getByRole('link', { name: `打开《${title}》` }).click();
  await expect(page.getByRole('heading', { name: '故事圣经' })).toBeVisible();
  await expect(page.getByLabel('一句话故事')).toHaveValue(storyBible.oneSentenceStory);
  await expect(page.getByLabel('主角')).toHaveValue(storyBible.protagonist);
  await expect(page.getByLabel('世界铁律')).toHaveValue(storyBible.worldIronLaw);
  await expect(page.getByLabel('章目标')).toHaveValue(chapterOutline.chapterGoal);
  await expect(page.getByLabel('叙事视角')).toHaveValue(chapterOutline.pov);
  await expect(page.getByLabel('场景节拍')).toHaveValue(chapterOutline.sceneBeats);
  await expect(page.getByLabel('章末钩子')).toHaveValue(chapterOutline.chapterEndHook);

  await expect(page.getByText(/Canon|Context Pack|Agent|正史/)).toHaveCount(0);
});

test('an author can complete, lock, and confirm changes to every story bible card', async ({
  page,
}) => {
  const email = `full-story-bible-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `九门残卷${Date.now()}`;
  const cards = [
    {
      label: '一句话故事',
      summary: '守碑少年为找回被天门吞掉的母亲，带着残剑踏遍九州。',
      details: '故事从边城荒寺起笔，母亲留下的半句剑诀贯穿全书。',
    },
    {
      label: '核心卖点',
      summary: '记忆作剑、师门反目、每卷推开一座天门。',
      details: '每卷兑现一次记忆代价，并在卷末揭开一层身世真相。',
    },
    {
      label: '主角',
      summary: '沈砚，外冷内热的边城剑客。',
      details: '他嘴上不信任何人，却总会替陌生人挡下最后一剑。',
    },
    {
      label: '金手指',
      summary: '残剑能借来亡者的最后一剑，但每借一次就会忘掉一个活人的名字。',
      details: '借剑只持续九息；同一个人不能连续借剑两次；忘掉的名字无法补回。',
    },
    {
      label: '世界铁律',
      summary: '天门只认记忆，不认血脉。',
      details: '想越过天门必须留下真实经历，伪造的记忆会被原样反噬。',
    },
    {
      label: '主线',
      summary: '沈砚沿九座天门追查母亲下落，并阻止仙门献祭人间记忆。',
      details: '主线按九卷推进，每卷解决一座天门，同时付出一个无法挽回的代价。',
    },
    {
      label: '支线',
      summary: '守碑人旧案、同门师姐的背叛、边城百姓的存亡。',
      details: '三条支线分别对应真相、情感和家园，必须在天门全开前收束。',
    },
    {
      label: '结局方向',
      summary: '沈砚守住最后一道天门，却主动忘记母亲，让边城所有人记住彼此。',
      details: '结局让沈砚做一个仍会遗忘、也仍会牵挂的人。',
    },
    {
      label: '读者承诺',
      summary: '每章有明确推进，每卷有一座天门和一次记忆代价，绝不用失忆拖延感情线。',
      details: '爽点来自破局与兑现承诺，情感克制，不写无意义后宫和重复打脸。',
    },
  ];

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
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);

  await expect(page.locator('.story-bible-card')).toHaveCount(9);
  for (const [index, card] of cards.entries()) {
    await page.getByLabel(card.label, { exact: true }).fill(card.summary);
    await page.getByRole('button', { name: `展开第 ${index + 1} 张卡片详细设定` }).click();
    await expect(page.getByLabel(`${card.label}详细设定`)).toBeVisible();
    await page.getByLabel(`${card.label}详细设定`).fill(card.details);
  }

  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('故事圣经已保存')).toBeVisible();

  const reminderRail = page.getByRole('complementary', { name: '提醒与变化' });
  await expect(reminderRail.getByRole('heading', { name: '连续性提醒' })).toBeVisible();
  await expect(reminderRail.getByRole('heading', { name: '未回收伏笔' })).toBeVisible();
  await expect(reminderRail.getByRole('heading', { name: '最近修改' })).toBeVisible();
  await expect(reminderRail.getByText('保存故事圣经').first()).toBeVisible();
  await expect(page.getByText('九张卡片都已填写，可以锁定。')).toBeVisible();

  await page.getByRole('button', { name: '锁定故事圣经' }).click();
  await expect(page.getByText('故事圣经已锁定')).toBeVisible();
  await expect(page.getByText('这本故事圣经已经锁定')).toBeVisible();

  await page
    .getByLabel('结局方向', { exact: true })
    .fill('沈砚守住天门，却把成仙的机会留给边城百姓。');
  await page.getByRole('button', { name: '保存故事圣经' }).click();
  await expect(page.getByText('这次保存会修改已锁定的故事圣经')).toBeVisible();
  const changeReason = '结局与已写章节对齐，保留边城百姓记得彼此的落点。';
  await page.getByLabel('修改原因').fill(changeReason);
  await page.getByRole('button', { name: '确认并保存修改' }).click();
  await expect(page.getByText('故事圣经修改已确认并记录')).toBeVisible();
  await expect(reminderRail.getByText('确认后修改')).toBeVisible();
  await expect(reminderRail.getByText(changeReason)).toBeVisible();
  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);

  for (const index of cards.keys()) {
    await page.getByRole('button', { name: `收起第 ${index + 1} 张卡片详细设定` }).click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/ticket-11-story-bible-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary', { name: '提醒与变化' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-11-story-bible-mobile.png',
    fullPage: true,
  });
});
