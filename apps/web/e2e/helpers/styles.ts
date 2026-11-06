import { expect, type Page } from "@playwright/test";

import { getCsrf } from "./auth";

const origin = "http://localhost:3000";

export type WorkRef = {
  id: string;
  mainBranch: { id: string };
};

export function styleBranchPath(work: WorkRef): string {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

export async function createStyleChapter(
  page: Page,
  work: WorkRef,
  number: number,
  title: string,
  content: string,
) {
  const token = await getCsrf(page.request);
  const base = styleBranchPath(work);
  const created = await page.request.post(`${base}/chapters`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      number,
      title,
      brief: {
        goal: "保持沈砚的声音变化有清楚的事件触发。",
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: ["发现异常", "被迫行动"],
        requiredFacts: ["沈砚不能暴露忘川书"],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const chapter = (await created.json()).data as { id: string; version: number };
  const saved = await page.request.post(`${base}/chapters/${chapter.id}/versions`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: chapter.version, content },
  });
  expect(saved.status(), await saved.text()).toBe(201);
  const savedData = (await saved.json()).data as {
    chapter: { version: number };
    version: { id: string; content: string };
  };
  return {
    id: chapter.id,
    version: savedData.chapter.version,
    versionId: savedData.version.id,
    content,
  };
}

export async function findCharacterId(page: Page, work: WorkRef, name: string): Promise<string> {
  const response = await page.request.get(`${styleBranchPath(work)}/entities`);
  expect(response.ok()).toBe(true);
  const entities = (await response.json()).data as Array<{
    id: string;
    name: string;
    type: string;
  }>;
  const character = entities.find((entity) => entity.type === "character" && entity.name === name);
  expect(character, `character ${name}`).toBeTruthy();
  return character!.id;
}

export async function createStyleCharacter(page: Page, work: WorkRef): Promise<string> {
  const token = await getCsrf(page.request);
  const response = await page.request.post(`${styleBranchPath(work)}/characters`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      name: "沈砚",
      aliases: ["小砚"],
      summary: "被宗门抛弃的外门杂役。",
      description: "",
      tags: [],
      profile: {
        desire: "找回被抹去的记忆",
        fear: "成为忘川书的下一个祭品",
        goal: "进入天门",
        voiceSample: "风停了。他没有回头。",
        voiceGuide: "句子短，少用感叹。",
        disguise: "藏起左臂伤势",
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data.character.id as string;
}

export async function createStyleProfile(
  page: Page,
  work: WorkRef,
  characterId: string,
  sourceVersionId: string,
  name = "沈砚 · 克制声线",
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(`${styleBranchPath(work)}/style/profiles`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      scope: "character",
      scopeId: characterId,
      dimension: "character_voice",
      name,
      source: {
        type: "author_sample",
        id: sourceVersionId,
        versionId: sourceVersionId,
        label: "第 1 章 · 作者样本",
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as { id: string; version: number };
}

export async function approveStyleProfile(
  page: Page,
  work: WorkRef,
  profile: { id: string; version: number },
  rationale = "作者确认这份样本代表稳定声线。",
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(
    `${styleBranchPath(work)}/style/profiles/${profile.id}/approve`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: profile.version, rationale },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}

export async function createStyleArc(
  page: Page,
  work: WorkRef,
  characterId: string,
  sourceChapterId: string,
) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(`${styleBranchPath(work)}/ledger/entries`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      kind: "character_arc",
      title: "沈砚不再压住情绪",
      summary: "第一次主动释放忘川书的力量。",
      responsibleRole: "protagonist",
      targetWindow: { fromChapter: 3, toChapter: 3 },
      characterId,
      startState: "克制，压住情绪",
      desire: "护住同行者。",
      fear: "再次失去重要的人。",
      lie: "只要不流露情绪就不会被看穿。",
      truth: "真正力量来自承认愤怒。",
      endState: "不再克制，情绪转为热烈",
      sourceChapterId,
      status: "planted",
      reason: "第三章第一次情绪爆发。",
      evidence: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}
