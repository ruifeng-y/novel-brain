import { expect, type APIRequestContext } from "@playwright/test";

import { createWork, getCsrf } from "./auth";

const origin = "http://localhost:3000";

export interface M0WorkFixture {
  id: string;
  title: string;
  mainBranch: { id: string };
}

export async function seedM0Work(
  request: APIRequestContext,
  options: { title?: string } = {},
): Promise<M0WorkFixture> {
  const work = await createWork(request, {
    mode: "idea",
    title: options.title ?? "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  await createModelConfig(request);
  await lockStoryBible(request, branchPath);
  await createConfirmedSettings(request, branchPath);
  return work;
}

export async function createM0Chapter(
  request: APIRequestContext,
  work: M0WorkFixture,
): Promise<{ id: string }> {
  const token = await getCsrf(request);
  const response = await request.post(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        order: 1,
        title: "一只手也能结印",
        brief: {
          goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: [
            "沈砚藏起断臂，被顾青撞见。",
            "血河宗追兵逼近，两人被迫联手。",
            "沈砚单手结印，忘川书短暂显形。",
            "顾青看见书页一角，但没有点破。",
          ],
          requiredFacts: ["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"],
        },
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string };
}

export async function createModelConfig(request: APIRequestContext): Promise<void> {
  const token = await getCsrf(request);
  const response = await request.post("/api/v1/model-configs", {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      provider: "deepseek",
      label: "DeepSeek 正文",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-fake-generation-1234",
      purposes: ["writing"],
      isDefault: true,
    },
  });
  expect(response.status()).toBe(200);
}

export async function lockStoryBible(
  request: APIRequestContext,
  branchPath: string,
): Promise<void> {
  const token = await getCsrf(request);
  const generated = await request.post(`${branchPath}/story-bible/generate`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {},
  });
  expect(generated.status()).toBe(200);
  const locked = await request.post(`${branchPath}/story-bible/lock`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { version: (await generated.json()).data.version },
  });
  expect(locked.status()).toBe(200);
}

export async function createConfirmedSettings(
  request: APIRequestContext,
  branchPath: string,
): Promise<void> {
  const settings = [
    {
      type: "world_rule",
      name: "天门只认完整记忆",
      aliases: [],
      summary: "失去关键记忆的人无法通过天门。",
      description: "",
      tags: [],
      data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
    },
    {
      type: "character",
      name: "沈砚",
      aliases: [],
      summary: "隐藏忘川书的外门杂役。",
      description: "",
      tags: [],
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀。",
        relationshipSummary: "与顾青互相试探。",
      },
    },
    {
      type: "golden_finger",
      name: "忘川书",
      aliases: [],
      summary: "以记忆换取前人经验。",
      description: "",
      tags: [],
      data: {
        rules: "每次只能借用一位前人的经验。",
        cost: "永久失去一段重要记忆。",
        limits: "每次使用消耗一页。",
        growth: "缺失记忆会拼成完整人格。",
      },
    },
  ] as const;
  for (const setting of settings) {
    const token = await getCsrf(request);
    const created = await request.post(`${branchPath}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: setting,
    });
    expect(created.status()).toBe(201);
    const createdData = (await created.json()).data;
    const lockToken = await getCsrf(request);
    const locked = await request.post(`${branchPath}/entities/${createdData.id}/lock`, {
      headers: { Origin: origin, "X-CSRF-Token": lockToken },
      data: { version: createdData.version },
    });
    expect(locked.status()).toBe(200);
  }
}
