import { expect, test } from '@playwright/test';
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

test('an author can build and search a linked settings center', async ({ page }) => {
  const email = `entity-center-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `九门设定${Date.now()}`;

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

  const work = await currentWorkAndBranch(page);
  await createFirstChapterOutline(page, work.workId, work.branchId, {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: '沈砚逃入荒寺避雨\n断碑浮现旧日剑痕',
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  });

  await expect(page.getByRole('heading', { name: '设定中心' })).toBeVisible();
  await page.getByRole('button', { name: '字段设置' }).click();
  const customFields = [
    { label: '旧伤备注', type: '文本', options: '', assertion: 'label' },
    { label: '年龄', type: '数字', options: '', assertion: 'label' },
    { label: '生辰', type: '日期', options: '', assertion: 'label' },
    { label: '境界', type: '单选', options: '炼气，筑基', assertion: 'label' },
    { label: '常用剑术', type: '多选', options: '御剑，符箓', assertion: 'group' },
    { label: '仍在追踪母亲', type: '布尔', options: '', assertion: 'label' },
    { label: '宿敌', type: '关系引用', options: '', assertion: 'label' },
  ] as const;
  for (const field of customFields) {
    await page.getByLabel('字段名称').fill(field.label);
    await page.getByLabel('字段类型').selectOption({ label: field.type });
    if (field.options) {
      await page.getByLabel('可选值').fill(field.options);
    }
    await page.getByRole('button', { name: '添加字段' }).click();
    if (field.assertion === 'group') {
      await expect(page.getByRole('group', { name: field.label })).toBeVisible();
    } else {
      await expect(page.getByLabel(field.label)).toBeVisible();
    }
  }
  await expect(page.getByLabel('旧伤备注')).toBeVisible();

  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('沈砚');
  await page.getByLabel('别名').fill('守碑少年，残剑客');
  await page.getByLabel('类型', { exact: true }).selectOption({ label: '人物' });
  await page.getByLabel('一句话摘要').fill('外冷内热的边城剑客。');
  await page.getByLabel('详细描述').fill('为找回被天门吞掉的母亲，带着残剑踏遍九州。');
  await page.getByLabel('标签', { exact: true }).fill('主角，剑修');
  await page.getByLabel('作用域').selectOption({ label: '全书' });
  await page.getByLabel('状态', { exact: true }).selectOption({ label: '锁定' });
  await page.getByLabel('旧伤备注').fill('左臂有旧伤，阴雨天会疼。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();

  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('裴照');
  await page.getByLabel('类型', { exact: true }).selectOption({ label: '人物' });
  await page.getByLabel('一句话摘要').fill('天门另一侧的守门人。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();

  await page.getByRole('button', { name: /沈砚/ }).click();
  await expect(page.getByLabel('旧伤备注')).toHaveValue('左臂有旧伤，阴雨天会疼。');
  await page.getByLabel('关系起点').selectOption({ label: '沈砚 · 人物' });
  await page.getByLabel('关系类型').selectOption({ label: '敌对' });
  await page.getByLabel('关系终点').selectOption({ label: '裴照 · 人物' });
  await page.getByLabel('有效起点').fill('第 2 章');
  await page.getByLabel('关系来源').fill('第 2 章手稿');
  await page.getByRole('button', { name: '添加关系' }).click();
  await expect(page.getByText('沈砚 敌对 裴照')).toBeVisible();

  await page.getByLabel('搜索设定').fill('守碑少年');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByRole('button', { name: /沈砚/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /裴照/ })).toHaveCount(0);

  await page.getByRole('button', { name: /沈砚/ }).click();
  await expect(page.getByRole('heading', { name: '被哪些内容引用' })).toBeVisible();
  await expect(page.getByText('第 1 章章纲')).toBeVisible();
  await expect(page.getByText('章目标、叙事视角、场景节拍')).toBeVisible();

  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ticket-12-settings-center-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '设定中心' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-12-settings-center-mobile.png',
    fullPage: true,
  });
});
