import { createHash } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import {
  chapterCreateRequestSchema,
  chapterVersionCreateRequestSchema,
  chapterVersionSaveResponseSchema,
  chapterWorkspaceResponseSchema,
  goldenThreeCandidateBatchRequestSchema,
  goldenThreeReviewBatchRequestSchema,
  goldenThreeSelectionRequestSchema,
  goldenThreeWorkspaceResponseSchema,
} from "@novel-brain/contracts";

import { getCsrf } from "./auth";
import { createConfirmedSettings, createModelConfig, lockStoryBible } from "./m0";

const origin = "http://localhost:3000";
const dimensions = [
  "opening_hook",
  "protagonist_appeal",
  "world_rules",
  "core_conflict",
  "reader_promise",
  "chapter_end_hook",
] as const;

function branchPath(work: { id: string; mainBranch: { id: string } }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

export async function seedGoldenThree(
  page: Page,
  token: string,
  work: { id: string; mainBranch: { id: string } },
) {
  const basePath = branchPath(work);
  await createModelConfig(page.request);
  await lockStoryBible(page.request, basePath);
  await createConfirmedSettings(page.request, basePath);
  const apiToken = await getCsrf(page.request);
  const chapters: Array<{ id: string; versionId: string; contentHash: string; content: string }> =
    [];
  for (let number = 1; number <= 3; number += 1) {
    const content = [
      "残剑割掌，血逆流上碑，碑文里浮出他母亲的名字。",
      "铜牌背面刻着沈砚自己的名字，追兵已经进了山门。",
      "他记得自己赢了，却忘了为什么要赢。",
    ][number - 1]!;
    const chapterPayload = chapterCreateRequestSchema.parse({
      number,
      title: ["断碑夜雨", "铜牌背面", "忘名之价"][number - 1],
      brief: {
        goal: `完成第 ${number} 章的开篇推进。`,
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: ["发现异常", "被迫行动"],
        requiredFacts: ["沈砚不能暴露忘川书"],
      },
    });
    const created = await page.request.post(`${basePath}/chapters`, {
      headers: { Origin: origin, "X-CSRF-Token": apiToken },
      data: chapterPayload,
    });
    expect(created.status()).toBe(201);
    const chapterId = chapterWorkspaceResponseSchema.parse(await created.json()).data.id;
    const versionPayload = chapterVersionCreateRequestSchema.parse({ version: 1, content });
    const version = await page.request.post(`${basePath}/chapters/${chapterId}/versions`, {
      headers: { Origin: origin, "X-CSRF-Token": apiToken },
      data: versionPayload,
    });
    expect(version.status()).toBe(201);
    const savedVersion = chapterVersionSaveResponseSchema.parse(await version.json()).data;
    chapters.push({
      id: chapterId,
      versionId: savedVersion.version.id,
      contentHash: createHash("sha256").update(content).digest("hex"),
      content,
    });
  }

  const candidatePayload = goldenThreeCandidateBatchRequestSchema.parse({
    candidates: [
      candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
      candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
    ],
  });
  const batch = await page.request.post(`${basePath}/golden-three/candidates`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": apiToken,
      "Idempotency-Key": "golden-three-e2e",
    },
    data: candidatePayload,
  });
  expect(batch.status()).toBe(201);
  const workspace = goldenThreeWorkspaceResponseSchema.parse(await batch.json()).data;
  const [candidateA, candidateB] = workspace.candidates;
  expect(candidateA && candidateB).toBeTruthy();

  await putReviews(page, apiToken, basePath, candidateA!, 3);
  await putReviews(page, apiToken, basePath, candidateB!, 4);
  const selectionPayload = goldenThreeSelectionRequestSchema.parse({
    version: candidateA!.version + 1,
  });
  const selected = await page.request.post(
    `${basePath}/golden-three/candidates/${candidateA!.id}/select`,
    {
      headers: { Origin: origin, "X-CSRF-Token": apiToken },
      data: selectionPayload,
    },
  );
  expect(selected.status()).toBe(200);
  goldenThreeWorkspaceResponseSchema.parse(await selected.json());
  return { candidateA: candidateA!, candidateB: candidateB! };
}

async function putReviews(
  page: Page,
  token: string,
  basePath: string,
  candidate: {
    id: string;
    version: number;
    pins: Array<{ chapterId: string; chapterVersionId: string; content: string }>;
  },
  failedScore: number | null,
) {
  const payload = goldenThreeReviewBatchRequestSchema.parse({
    version: candidate.version,
    reviews: dimensions.map((dimension, index) => {
      const pin = candidate.pins[index % candidate.pins.length]!;
      return {
        dimension,
        score: dimension === "world_rules" && failedScore === 3 ? 3 : 4,
        evidence: {
          chapterId: pin.chapterId,
          chapterVersionId: pin.chapterVersionId,
          passage: pin.content,
          locator: `第 ${index + 1} 章 · 首句`,
        },
        reviewerOrigin: "model",
      };
    }),
  });
  const response = await page.request.put(
    `${basePath}/golden-three/candidates/${candidate.id}/reviews`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: payload,
    },
  );
  expect(response.status()).toBe(200);
  goldenThreeWorkspaceResponseSchema.parse(await response.json());
}

function candidateInput(
  label: string,
  strategy: "hook_focus" | "character_focus",
  chapters: Array<{ id: string; versionId: string; contentHash: string }>,
  hashSeed: string,
) {
  return {
    label,
    strategy,
    prompt: {
      key: "golden-three-opening",
      version: 3,
      hash: hashSeed.repeat(64).slice(0, 64),
    },
    model: {
      provider: "deepseek",
      model: "deepseek-chat",
      parameters: { temperature: 0.7 },
    },
    context: {
      packVersionId: null,
      manifestHash: "c".repeat(64),
    },
    pins: [
      {
        chapterId: chapters[0]!.id,
        chapterVersionId: chapters[0]!.versionId,
        expectedContentHash: chapters[0]!.contentHash,
      },
    ],
  };
}
