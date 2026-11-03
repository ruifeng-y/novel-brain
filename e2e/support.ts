import { randomBytes } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

export async function readVerificationCode(email: string): Promise<string> {
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

export async function registerAuthor(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible({ timeout: 15_000 });

  const code = await readVerificationCode(email);
  await page.getByLabel('验证码').fill(code);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

export async function createWork(
  page: Page,
  title: string,
  penName = '壳层测试作者',
): Promise<void> {
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('笔名').fill(penName);
  await page.getByLabel('题材').selectOption('xianxia');
  await page.getByLabel('规模').selectOption('long');
  await page.getByLabel('目标平台').selectOption('起点中文网');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
}

export async function useIsolatedClientIp(page: Page): Promise<void> {
  const [a, b, c] = randomBytes(3);
  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `10.${a}.${b}.${c}`,
  });
}

export async function createFirstChapterOutline(
  page: Page,
  workId: string,
  branchId: string,
  outline: {
    chapterGoal: string;
    pov: string;
    sceneBeats: string;
    chapterEndHook: string;
  },
): Promise<void> {
  const basePath = `/api/v1/works/${workId}/branches/${branchId}/outlines`;
  const post = async (body: Record<string, unknown>) => {
    const response = await page.request.post(basePath, { data: body });
    if (!response.ok()) {
      throw new Error(
        `Could not create outline node: ${response.status()} ${await response.text()}`,
      );
    }
    return (await response.json()) as { id: string };
  };

  const book = await post({
    level: 'book',
    title: '九门总纲',
    summary: '沈砚沿九座天门追查母亲失踪的真相。',
    details: '全书以记忆代价推进。',
  });
  const volume = await post({
    level: 'volume',
    parentId: book.id,
    title: '第一卷 天门初开',
    summary: '沈砚从边城进入荒寺。',
    details: '',
  });
  const act = await post({
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '沈砚在追兵围堵下触发断碑。',
    details: '',
  });
  await post({
    level: 'chapter',
    parentId: act.id,
    title: '第一章 断碑',
    summary: outline.chapterGoal,
    details: '',
    chapterGoal: outline.chapterGoal,
    pov: outline.pov,
    sceneBeats: outline.sceneBeats
      .split(/\r?\n/)
      .map((beat) => beat.trim())
      .filter(Boolean),
    chapterEndHook: outline.chapterEndHook,
  });
}

export async function currentWorkAndBranch(
  page: Page,
): Promise<{ workId: string; branchId: string }> {
  const workId = new URL(page.url()).pathname.split('/').at(-1);
  if (!workId) {
    throw new Error('The current page is not a work page');
  }
  const response = await page.request.get(`/api/v1/works/${workId}`);
  if (!response.ok()) {
    throw new Error(`Could not read the current work: ${response.status()}`);
  }
  const work = (await response.json()) as { mainBranch: { id: string } };
  return { workId, branchId: work.mainBranch.id };
}
