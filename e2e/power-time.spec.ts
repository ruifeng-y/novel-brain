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

async function signUp(page: import('@playwright/test').Page): Promise<void> {
  const email = `power-time-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  await useIsolatedClientIp(page);
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('验证码').fill(await readVerificationCode(email));
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.goto('/workspace?quick=1');

  await page.getByLabel('书名').fill(`九境残卷${Date.now()}`);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);
  await page.getByRole('link', { name: '设定中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设定中心' })).toBeVisible();
}

async function createSetting(
  page: import('@playwright/test').Page,
  name: string,
  type: '人物' | '力量体系' | '物品功法' | '时间线',
): Promise<void> {
  const section =
    type === '人物'
      ? '人物档案'
      : type === '力量体系'
        ? '力量体系'
        : type === '物品功法'
          ? '物品功法'
          : '时间线';
  await page
    .getByRole('navigation', { name: '设定中心栏目' })
    .getByRole('button', { name: section, exact: true })
    .click();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill(name);
  await page.getByLabel('类型', { exact: true }).selectOption({ label: type });
  await page.getByLabel('一句话摘要').fill(`${name}的摘要。`);
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByText('设定已保存')).toBeVisible();
}

test('an author can maintain power growth, golden fingers, item ownership, and story time', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUp(page);

  await createSetting(page, '沈砚', '人物');
  await createSetting(page, '裴照', '人物');

  await createSetting(page, '九境剑道', '力量体系');
  await expect(page.getByRole('heading', { name: '力量体系规则' })).toBeVisible();
  await page.getByLabel('力量层级').fill('炼气|引气入体\n筑基|道基初成\n金丹|结成金丹');
  await page.getByLabel('力量路径').fill('剑修|以剑意破境|炼气、筑基、金丹');
  await page
    .getByLabel('突破规则')
    .fill('炼气→筑基|剑意初成、心境无隙|十年寿元|经脉未固|雷法、镇魂钟|下品灵石:3');
  await page.getByRole('button', { name: '保存力量体系' }).click();
  await expect(page.getByText('力量体系规则已保存')).toBeVisible();

  await page.getByLabel('当前层级').selectOption('炼气');
  await page.getByLabel('目标层级').selectOption('筑基');
  await page.getByLabel('已满足条件').fill('剑意初成');
  await page.getByLabel('现有资源').fill('下品灵石:2');
  await page.getByRole('button', { name: '检查突破' }).click();
  await expect(page.getByText('还差一些条件')).toBeVisible();
  await expect(page.getByText('缺条件：心境无隙')).toBeVisible();
  await expect(page.getByText('缺资源：下品灵石（还差 1）')).toBeVisible();
  await page.getByLabel('已满足条件').fill('剑意初成\n心境无隙');
  await page.getByLabel('现有资源').fill('下品灵石:3');
  await page.getByRole('button', { name: '检查突破' }).click();
  await expect(page.getByText('可以突破')).toBeVisible();

  await page.getByLabel('金手指名称').fill('残剑借命');
  await page.getByLabel('金手指规则').fill('借来亡者最后一剑\n借剑必须说出亡者姓名');
  await page.getByLabel('金手指代价').fill('忘掉一个活人的名字');
  await page.getByLabel('金手指限制').fill('只持续九息\n同一个人不能连续借剑');
  await page
    .getByLabel('金手指成长曲线')
    .fill('初醒|只能借炼气修士的最后一剑\n共鸣|可以借筑基修士的最后一剑');
  await page.getByRole('button', { name: '添加金手指' }).click();
  await expect(page.getByText('金手指已保存')).toBeVisible();
  await expect(page.getByText('残剑借命')).toBeVisible();

  await createSetting(page, '残剑', '物品功法');
  await expect(page.getByRole('heading', { name: '物品功法规则' })).toBeVisible();
  await page.getByLabel('物品功法类别').selectOption('item');
  await page.getByLabel('物品品阶').fill('天阶');
  await page.getByLabel('物品效果').fill('可斩断护体真气\n剑鸣时能唤醒亡者残念');
  await page.getByLabel('物品代价').fill('每次出鞘消耗一段记忆');
  await page.getByLabel('物品限制').fill('非剑修不可拔剑\n月圆之夜无法出鞘');
  await page.getByRole('button', { name: '保存物品功法' }).click();
  await expect(page.getByText('物品功法已保存')).toBeVisible();

  await page.getByLabel('归属对象').selectOption({ label: '沈砚 · 人物' });
  await page.getByLabel('归属起始').fill('第 1 章');
  await page.getByLabel('归属来源').fill('断碑认主');
  await page.getByRole('button', { name: '添加归属' }).click();
  await expect(page.getByText('归属已记录')).toBeVisible();
  await expect(page.getByText('断碑认主')).toBeVisible();

  await page.getByLabel('归属对象').selectOption({ label: '裴照 · 人物' });
  await page.getByLabel('归属起始').fill('第 4 章');
  await page.getByLabel('归属来源').fill('强行夺剑');
  await page.getByRole('button', { name: '添加归属' }).click();
  await expect(page.getByText('这件物品已有当前归属，先结束上一段归属再添加。')).toBeVisible();

  await page.getByLabel('当前归属结束时间').fill('第 3 章');
  await page.getByRole('button', { name: '结束归属' }).click();
  await expect(page.getByText('这段归属已结束')).toBeVisible();
  await page.getByLabel('归属对象').selectOption({ label: '裴照 · 人物' });
  await page.getByLabel('归属起始').fill('第 4 章');
  await page.getByLabel('归属来源').fill('强行夺剑');
  await page.getByRole('button', { name: '添加归属' }).click();
  await expect(page.getByText('归属已记录')).toBeVisible();

  await createSetting(page, '九州纪年', '时间线');
  await expect(page.getByRole('heading', { name: '时间线', exact: true })).toBeVisible();
  await page.getByLabel('纪元名称').fill('玄元');
  await page.getByLabel('纪元说明').fill('天门初开后的纪年。');
  await page.getByLabel('纪元起始').fill('1-1-1');
  await page.getByLabel('纪元结束').fill('120-12-31');
  await page.getByRole('button', { name: '添加纪元' }).click();
  await expect(page.getByText('纪元已添加')).toBeVisible();

  await page.getByLabel('事件标题').fill('断碑初鸣');
  await page.getByLabel('所属纪元').selectOption({ label: '玄元' });
  await page.getByLabel('事件说明').fill('沈砚在荒寺发现残剑。');
  await page.getByLabel('事件绝对日期').fill('12-4-9');
  await page.getByLabel('持续时长').fill('3');
  await page.getByLabel('时长单位').selectOption('day');
  await page.getByRole('button', { name: '添加事件节点' }).click();
  await expect(page.getByText('事件节点已添加')).toBeVisible();
  await expect(page.getByText('12年4月9日 · 3天')).toBeVisible();

  await page.getByLabel('事件标题').fill('边城戒严');
  await page.getByLabel('所属纪元').selectOption({ label: '玄元' });
  await page.getByLabel('事件说明').fill('沈砚三日后抵达边城。');
  await page.getByLabel('事件相对时间').fill('三日后');
  await page.getByLabel('相对哪个事件').selectOption({ label: '断碑初鸣' });
  await page.getByLabel('持续时长').fill('9');
  await page.getByLabel('时长单位').selectOption('hour');
  await page.getByRole('button', { name: '添加事件节点' }).click();
  await expect(page.getByText('事件节点已添加')).toBeVisible();
  await expect(page.getByText('玄元 · 三日后 · 9小时')).toBeVisible();

  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ticket-15-power-time-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '时间线', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-15-power-time-mobile.png',
    fullPage: true,
  });
});
