import { expect, test, type Page } from '@playwright/test';
import { useIsolatedClientIp } from './support';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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

async function addPlace(
  page: Page,
  name: string,
  level: string,
  parentLabel?: string,
): Promise<void> {
  await page.getByLabel('地点名称').fill(name);
  await page.getByLabel('地点层级').selectOption({ label: level });
  if (parentLabel) {
    await page.getByLabel('上级地点').selectOption({ label: parentLabel });
  }
  await page.getByRole('button', { name: '添加地点' }).click();
  await expect(
    page
      .getByRole('complementary', { name: '地点树' })
      .getByRole('button', { name: new RegExp(name) }),
  ).toBeVisible();
}

test('an author can build a layered map and resolve a two-place conflict', async ({ page }) => {
  const email = `map-faction-e2e-${Date.now()}@example.com`;
  const password = 'correct horse battery staple';
  const title = `九洲地图${Date.now()}`;

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
  await page
    .getByRole('navigation', { name: '设定中心栏目' })
    .getByRole('button', { name: '势力', exact: true })
    .click();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('无宗');
  await page.getByLabel('类型', { exact: true }).selectOption({ label: '势力' });
  await page.getByLabel('一句话摘要').fill('盘踞东荒的宗门。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByRole('button', { name: /无宗/ })).toBeVisible();

  await page
    .getByRole('navigation', { name: '设定中心栏目' })
    .getByRole('button', { name: '人物档案', exact: true })
    .click();
  await page.getByRole('button', { name: '新建设定' }).click();
  await page.getByLabel('名称', { exact: true }).fill('沈砚');
  await page.getByLabel('类型', { exact: true }).selectOption({ label: '人物' });
  await page.getByLabel('一句话摘要').fill('外冷内热的边城剑客。');
  await page.getByRole('button', { name: '保存设定' }).click();
  await expect(page.getByRole('button', { name: /沈砚/ })).toBeVisible();

  const workId = new URL(page.url()).pathname.split('/').at(-2);
  await page.goto(`/workspace/${workId}/settings?tab=map`);
  await expect(page.getByRole('heading', { name: '地图与势力' })).toBeVisible();

  await addPlace(page, '九洲', '世界');
  await addPlace(page, '人间界', '界面', '九洲 · 世界');
  await addPlace(page, '东荒', '大陆', '九洲 / 人间界 · 界面');
  await addPlace(page, '青岚郡', '区域', '九洲 / 人间界 / 东荒 · 大陆');
  await addPlace(page, '临渊城', '城市', '九洲 / 人间界 / 东荒 / 青岚郡 · 区域');
  await addPlace(page, '断碑古寺', '地点', '九洲 / 人间界 / 东荒 / 青岚郡 / 临渊城 · 城市');
  await addPlace(page, '落霞城', '城市', '九洲 / 人间界 / 东荒 / 青岚郡 · 区域');

  const placeTree = page.getByRole('complementary', { name: '地点树' });
  await expect(placeTree.getByRole('button', { name: '九洲 世界' })).toBeVisible();
  await expect(placeTree.getByRole('button', { name: '人间界 界面' })).toBeVisible();
  await expect(placeTree.getByRole('button', { name: '东荒 大陆' })).toBeVisible();
  await expect(placeTree.getByRole('button', { name: '青岚郡 区域' })).toBeVisible();
  await expect(placeTree.getByRole('button', { name: '临渊城 城市' })).toBeVisible();
  await expect(placeTree.getByRole('button', { name: '断碑古寺 地点' })).toBeVisible();

  await page
    .getByLabel('连接起点')
    .selectOption({ label: '九洲 / 人间界 / 东荒 / 青岚郡 / 临渊城 / 断碑古寺 · 地点' });
  await page
    .getByLabel('连接终点')
    .selectOption({ label: '九洲 / 人间界 / 东荒 / 青岚郡 / 临渊城 · 城市' });
  await page.getByLabel('旅行时间').fill('45');
  await page.getByLabel('路线说明').fill('沿河官道');
  await page.getByRole('button', { name: '添加连接' }).click();
  await expect(page.getByText('断碑古寺 至 临渊城')).toBeVisible();
  await expect(page.getByText('45 分钟')).toBeVisible();

  await page.getByLabel('控制势力').selectOption({ label: '无宗' });
  await page
    .getByLabel('控制地点')
    .selectOption({ label: '九洲 / 人间界 / 东荒 / 青岚郡 / 临渊城 · 城市' });
  await page.getByLabel('控制起点').fill('玄元三年');
  await page.getByLabel('控制终点').fill('玄元五年');
  await page.getByRole('button', { name: '添加控制范围' }).click();
  await expect(page.getByText('无宗 控制 临渊城')).toBeVisible();
  await expect(page.getByText('玄元三年 至 玄元五年')).toBeVisible();

  await placeTree.getByRole('button', { name: /临渊城/ }).click();
  await page.getByLabel('上传地图图片').setInputFiles({
    name: 'linyuan.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(page.getByRole('img', { name: '临渊城地图' })).toBeVisible();
  await page
    .getByLabel('要标记的地点')
    .selectOption({ label: '九洲 / 人间界 / 东荒 / 青岚郡 / 临渊城 / 断碑古寺 · 地点' });
  await page.getByLabel('临渊城地图标记区').click({ position: { x: 120, y: 120 } });
  await expect(page.getByRole('button', { name: '断碑古寺标记点' })).toBeVisible();

  await page.getByLabel('行踪人物').selectOption({ label: '沈砚' });
  await page
    .getByLabel('行踪地点')
    .selectOption({ label: '九洲 / 人间界 / 东荒 / 青岚郡 / 临渊城 · 城市' });
  await page.getByLabel('行踪故事时间').fill('第三章清晨');
  await page.getByRole('button', { name: '记录所在地' }).click();
  await expect(page.getByText('沈砚 · 临渊城')).toBeVisible();

  await page.getByLabel('行踪人物').selectOption({ label: '沈砚' });
  await page
    .getByLabel('行踪地点')
    .selectOption({ label: '九洲 / 人间界 / 东荒 / 青岚郡 / 落霞城 · 城市' });
  await page.getByLabel('行踪故事时间').fill('第三章清晨');
  await page.getByRole('button', { name: '记录所在地' }).click();
  await expect(page.getByText('沈砚 在 第三章清晨 同时出现在 临渊城、落霞城')).toBeVisible();

  await page.getByRole('button', { name: '删除 沈砚 在 临渊城 的记录' }).click();
  await expect(page.getByText('目前没有人物同时出现在两地的记录。')).toBeVisible();

  await expect(page.getByText(/Canon|Context Pack|Agent|正史|Branch|POV/)).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ticket-14-map-faction-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '地图与势力' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'test-results/ticket-14-map-faction-mobile.png',
    fullPage: true,
  });
});
