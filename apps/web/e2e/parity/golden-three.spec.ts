import { createHash } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";
const viewports = [390, 900, 1180, 1440];
const dimensions = [
  "opening_hook",
  "protagonist_appeal",
  "world_rules",
  "core_conflict",
  "reader_promise",
  "chapter_end_hook",
] as const;

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("golden-three");
  const session = await registerUser(page.request, email, "StrongPassword123", "黄金三章作者");
  await context.addCookies([
    {
      name: "nb_session",
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

function branchPath(work: { id: string; mainBranch: { id: string } }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

async function seedGoldenThree(
  page: Page,
  token: string,
  work: { id: string; mainBranch: { id: string } },
) {
  const basePath = branchPath(work);
  const chapters: Array<{ id: string; versionId: string; contentHash: string; content: string }> =
    [];
  for (let number = 1; number <= 3; number += 1) {
    const content = [
      "残剑割掌，血逆流上碑，碑文里浮出他母亲的名字。",
      "铜牌背面刻着沈砚自己的名字，追兵已经进了山门。",
      "他记得自己赢了，却忘了为什么要赢。",
    ][number - 1]!;
    const created = await page.request.post(`${basePath}/chapters`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        number,
        title: ["断碑夜雨", "铜牌背面", "忘名之价"][number - 1],
        brief: {
          goal: `完成第 ${number} 章的开篇推进。`,
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["发现异常", "被迫行动"],
          requiredFacts: ["沈砚不能暴露忘川书"],
        },
      },
    });
    expect(created.status()).toBe(201);
    const chapterId = (await created.json()).data.id as string;
    const version = await page.request.post(`${basePath}/chapters/${chapterId}/versions`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: 1, content },
    });
    expect(version.status()).toBe(201);
    chapters.push({
      id: chapterId,
      versionId: (await version.json()).data.version.id as string,
      contentHash: createHash("sha256").update(content).digest("hex"),
      content,
    });
  }

  const batch = await page.request.post(`${basePath}/golden-three/candidates`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": "golden-three-e2e",
    },
    data: {
      candidates: [
        candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
        candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
      ],
    },
  });
  expect(batch.status()).toBe(201);
  const workspace = (await batch.json()).data as {
    candidates: Array<{
      id: string;
      version: number;
      pins: Array<{ chapterId: string; chapterVersionId: string; content: string }>;
    }>;
  };
  const [candidateA, candidateB] = workspace.candidates;
  expect(candidateA && candidateB).toBeTruthy();

  await putReviews(page, token, basePath, candidateA!, 3);
  await putReviews(page, token, basePath, candidateB!, 4);
  const selected = await page.request.post(
    `${basePath}/golden-three/candidates/${candidateA!.id}/select`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: { version: candidateA!.version + 1 },
    },
  );
  expect(selected.status()).toBe(200);
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
  const response = await page.request.put(
    `${basePath}/golden-three/candidates/${candidate.id}/reviews`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
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
      },
    },
  );
  expect(response.status()).toBe(200);
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
    pins: chapters.map((chapter) => ({
      chapterId: chapter.id,
      chapterVersionId: chapter.versionId,
      expectedContentHash: chapter.contentHash,
    })),
  };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("compares candidates, blocks a failed dimension, selects and locks at four viewports", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const token = await getCsrf(page.request);
  const fixture = await seedGoldenThree(page, token, work);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${work.id}/outline`);
  await expect(page.getByRole("heading", { name: "黄金三章候选" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "候选 A · 钩子优先" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "候选 B · 人物优先" })).toBeVisible();
  await expect(page.getByText("碑文里浮出他母亲的名字").first()).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText("世界规则展示未达标")).toBeVisible();
    await expect(page.getByRole("button", { name: "六维评审未达标 · 暂不可锁定" })).toBeDisabled();
    await expectNoOverflow(page);
    await testInfo.attach(`golden-three-failure-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const candidateBCard = page.locator(`[data-golden-candidate-id="${fixture.candidateB.id}"]`);
  await candidateBCard.getByRole("button", { name: "选定这个方向" }).click();
  await expect(candidateBCard.getByText("已选定")).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "锁定黄金三章" })).toBeEnabled();
    await expectNoOverflow(page);
    await testInfo.attach(`golden-three-selected-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "锁定黄金三章" }).click();
  await expect(page.getByText("黄金三章已锁定")).toBeVisible();
  await expect(page.getByText("风格基线已保存")).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText("黄金三章已锁定")).toBeVisible();
    await expectNoOverflow(page);
    await testInfo.attach(`golden-three-locked-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }

  await expectAuthorFacingLanguage(page);
});
