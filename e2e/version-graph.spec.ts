import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import {
  createFirstChapterOutline,
  currentWorkAndBranch,
  openWorkBible,
  useIsolatedClientIp,
} from './support';

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

test('an author can inspect versions, undo one change, export history, and roll back', async ({
  page,
}) => {
  await registerAuthor(page, `version-graph-e2e-${Date.now()}@example.com`);
  await page.getByLabel('书名').fill(`版本图${Date.now()}`);
  await page.getByLabel('笔名').fill('青云客');
  await page.getByRole('button', { name: '创建并开始' }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+\/overview$/);

  await openWorkBible(page);
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

  const base = `/api/v1/works/${workId}/branches/${branchId}`;
  const entity = await page.request.post(`${base}/entities`, {
    data: {
      name: '临渊城',
      aliases: [],
      type: 'map',
      summary: '东荒边境的小城。',
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
    },
  });
  expect(entity.ok()).toBe(true);
  const entityBody = (await entity.json()) as { id: string };
  const change = await page.request.post(`${base}/changes`, {
    data: {
      title: '补充临渊城的旧称',
      reason: '旧称在前文里出现过，需要写进设定。',
      targetType: 'map',
      targetId: entityBody.id,
      oldValue: { summary: '东荒边境的小城。' },
      newValue: { summary: '东荒边境的小城，旧称落霞城。' },
      source: 'author',
      risk: 'low',
    },
  });
  expect(change.ok()).toBe(true);
  const changeBody = (await change.json()) as { id: string };
  await page.request.post(`${base}/changes/${changeBody.id}/apply`, {
    data: { mode: 'apply' },
  });

  await page.goto(`/workspace/${workId}/changes`);
  await page.getByRole('button', { name: '版本与回滚', exact: true }).click();
  const versionPanel = page.getByRole('region', { name: '版本图' });
  await expect(versionPanel).toBeVisible();
  await expect(versionPanel.getByRole('img', { name: '版本关系图' })).toBeVisible();
  await expect(versionPanel.getByText(/版本 1/).first()).toBeVisible();
  await expect(versionPanel.getByText(/版本 2/).first()).toBeVisible();
  await expect(versionPanel.getByText('合并点').first()).toBeVisible();

  const firstHistoricalVersion = versionPanel
    .locator('.version-list-item')
    .filter({ hasText: '版本 1' })
    .first();
  const versionDownloadPromise = page.waitForEvent('download');
  await firstHistoricalVersion.getByRole('button', { name: '导出这个版本' }).click();
  const versionDownload = await versionDownloadPromise;
  expect(versionDownload.suggestedFilename()).toMatch(/\.zip$/);
  const versionDownloadPath = await versionDownload.path();
  expect(versionDownloadPath).toBeTruthy();
  const versionArchive = await JSZip.loadAsync(
    await readFile(versionDownloadPath as string),
  );
  expect(versionArchive.file('manifest.json')).not.toBeNull();
  expect(versionArchive.file('outline.json')).not.toBeNull();
  expect(versionArchive.file('version-history.json')).not.toBeNull();
  expect(await versionArchive.file('manuscript.md')?.async('string')).toContain(
    '沈砚听见剑鸣。',
  );

  await page.getByRole('button', { name: '修改请求', exact: true }).click();
  const changePanel = page.getByRole('region', { name: '修改请求' });
  await expect(changePanel.getByRole('button', { name: '撤销这次修改' })).toBeVisible();
  await changePanel.getByLabel('撤销原因（可选）').fill('先保留初版写法。');
  await changePanel.getByRole('button', { name: '撤销这次修改' }).click();
  await expect(page.getByText('修改已撤销，撤销记录已保留。')).toBeVisible();

  await page.getByRole('button', { name: '版本与回滚', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '版本与回滚', exact: true }).click();
  const refreshedVersions = page.getByRole('region', { name: '版本图' });
  await refreshedVersions.getByLabel('搜索操作记录').fill('撤销');
  await refreshedVersions.getByRole('button', { name: '查找' }).click();
  await expect(refreshedVersions.getByText('撤销修改', { exact: true }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await refreshedVersions.getByRole('button', { name: '导出记录' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  const firstVersion = refreshedVersions
    .locator('.version-list-item')
    .filter({ hasText: '版本 1' })
    .first();
  await firstVersion.getByRole('button', { name: '回到这个版本' }).click();
  await refreshedVersions.getByLabel('回滚原因').fill('回到第一次断碑时的完整故事状态。');
  await refreshedVersions.getByRole('button', { name: '确认回滚' }).click();
  await expect(page.getByText('已回到这个版本，并保留了新的回滚记录。')).toBeVisible();

  await page.goto(`/workspace/${workId}/write`);
  await expect(page.getByLabel('章节正文')).toHaveValue('沈砚听见剑鸣。');
  await expect(page.getByText(/Canon|Context Pack|Agent|POV|Branch|正史|上下文包/)).toHaveCount(0);

  await page.goto(`/workspace/${workId}/changes`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
