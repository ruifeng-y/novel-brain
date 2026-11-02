import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';

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
