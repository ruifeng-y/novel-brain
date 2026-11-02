import { expect, test } from '@playwright/test';
import { currentWorkAndBranch, useIsolatedClientIp } from './support';

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

test('an author manages plot lines, foreshadows, and a character arc', async ({ page }) => {
  const email = `story-ledger-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `九门账本${Date.now()}`;

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

  const { workId, branchId } = await currentWorkAndBranch(page);
  const characterResponse = await page.request.post(
    `/api/v1/works/${workId}/branches/${branchId}/entities`,
    {
      data: {
        name: '沈砚',
        aliases: [],
        type: 'character',
        summary: '外冷内热的边城剑客。',
        description: '',
        tags: [],
        scope: 'work',
        status: 'draft',
      },
    },
  );
  expect(characterResponse.ok()).toBe(true);

  await page.reload();
  const ledger = page.getByRole('region', { name: '剧情线、伏笔与人物弧' });
  await expect(ledger.getByRole('heading', { name: '剧情线、伏笔与人物弧' })).toBeVisible();
  await expect(ledger.getByRole('heading', { name: '剧情体检' })).toBeVisible();

  await ledger.getByRole('button', { name: '新建剧情线' }).click();
  await ledger.getByLabel('剧情线名称').fill('追查母亲失踪真相');
  await ledger.getByLabel('剧情类型').selectOption('main');
  await ledger.getByLabel('剧情线摘要').fill('沈砚沿着九座天门的线索追查母亲下落。');
  await ledger.getByLabel('赌注').fill('每错过一条线索，母亲留在人间的记忆就会少一段。');
  await ledger.getByLabel('计划收束章').fill('18');
  await ledger.getByLabel('里程碑').fill('第 1 章｜残剑认主\n第 12 章｜守碑人交出剑诀');
  await ledger.getByLabel('张力曲线').fill('第 1 章｜3\n第 8 章｜7\n第 18 章｜10');
  await ledger.getByRole('checkbox', { name: '沈砚' }).check();
  await ledger.getByRole('button', { name: '保存剧情线' }).click();
  await expect(ledger.getByText('剧情线已保存')).toBeVisible();
  await expect(ledger.getByRole('heading', { name: '追查母亲失踪真相' })).toBeVisible();
  await expect(ledger.getByText('主线', { exact: true })).toBeVisible();
  await expect(ledger.getByText('第 12 章：守碑人交出剑诀')).toBeVisible();

  await ledger.getByRole('tab', { name: '伏笔' }).click();
  await ledger.getByRole('button', { name: '记录新伏笔' }).click();
  await ledger.getByLabel('伏笔名称').fill('母亲留下的半句剑诀');
  await ledger.getByLabel('伏笔内容').fill('剑诀缺失的后半句指向天门真正代价。');
  await ledger.getByLabel('埋设章').fill('2');
  await ledger.getByLabel('计划回收章').fill('18');
  await ledger.getByLabel('重要程度').selectOption('must');
  await ledger.getByRole('button', { name: '保存伏笔' }).click();
  await expect(ledger.getByText('伏笔已保存')).toBeVisible();
  await expect(ledger.getByText('必须回收')).toBeVisible();
  await ledger.getByRole('button', { name: '标记已回收' }).click();
  await expect(ledger.getByText('伏笔已回收')).toBeVisible();
  await expect(ledger.getByText('已回收').first()).toBeVisible();

  await ledger.getByRole('tab', { name: '人物弧' }).click();
  await ledger.getByRole('button', { name: '新建人物弧' }).click();
  await ledger.getByLabel('人物', { exact: true }).selectOption({ label: '沈砚' });
  await ledger.getByLabel('起点').fill('只信手中剑，把所有人情都当作债。');
  await ledger.getByLabel('欲望').fill('找回被天门吞掉的母亲。');
  await ledger.getByLabel('恐惧').fill('发现自己也是天门伪造出来的记忆。');
  await ledger.getByLabel('谎言').fill('只要足够强，就不必再失去任何人。');
  await ledger.getByLabel('真相').fill('真正能留住人的不是力量，而是愿意把真相交给同行者。');
  await ledger.getByLabel('转折').fill('在第 12 章主动承认自己一直错怪了守碑人。');
  await ledger.getByLabel('终点').fill('愿意带着残缺的记忆继续守护边城。');
  await ledger.getByRole('button', { name: '保存人物弧' }).click();
  await expect(ledger.getByText('人物弧已保存')).toBeVisible();
  await expect(
    ledger.getByText('真正能留住人的不是力量，而是愿意把真相交给同行者。'),
  ).toBeVisible();

  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Ledger|Thread|Arc/)).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ticket-17-story-ledger-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(ledger).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-17-story-ledger-mobile.png',
    fullPage: true,
  });
});
