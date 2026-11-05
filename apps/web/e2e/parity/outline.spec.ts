import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage } from "../helpers/ui";

const origin = "http://localhost:3000";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("outline");
  const session = await registerUser(page.request, email, "StrongPassword123", "大纲作者");
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

async function createOutlineWork(page: Page) {
  return (await createWork(page.request, {
    mode: "idea",
    title: "忘川书",
    idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  })) as {
    id: string;
    title: string;
    mainBranch: { id: string };
  };
}

function chaptersPath(work: { id: string; mainBranch: { id: string } }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`;
}

async function fillCompleteBrief(page: Page) {
  await page.getByRole("spinbutton", { name: "章节序号" }).fill("1");
  await page.getByRole("textbox", { name: "章节标题" }).fill("一只手也能结印");
  await page
    .getByRole("textbox", { name: "章目标" })
    .fill("让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。");
  await page.getByRole("textbox", { name: "POV" }).fill("沈砚");
  await page.getByRole("textbox", { name: "地点" }).fill("荒寺外山道");
  await page
    .getByRole("textbox", { name: "场景节拍（一行一个）" })
    .fill(
      [
        "沈砚藏起断臂，被顾青撞见。",
        "血河宗追兵逼近，两人被迫联手。",
        "沈砚单手结印，忘川书短暂显形。",
        "顾青看见书页一角，但没有点破。",
      ].join("\n"),
    );
  await page
    .getByRole("textbox", { name: "必用事实（一行一个）" })
    .fill(["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"].join("\n"));
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("creates a required chapter brief and shows partial readiness blockers", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);

  await page.goto(`/workspace/${work.id}/outline`);
  await expect(page.getByRole("heading", { name: "大纲工作台" })).toBeVisible();
  await expect(page.getByText(work.title)).toBeVisible();
  await expect(page.getByRole("heading", { name: "还没有章纲" })).toBeVisible();
  await expect(page.getByText("故事圣经尚未锁定")).toBeVisible();
  await expect(page.locator(".outline-readiness-list").getByText("还没有章纲")).toBeVisible();
  await expect(page.getByRole("button", { name: "创建章纲" })).toBeDisabled();
  await expectAuthorFacingLanguage(page);

  await fillCompleteBrief(page);
  await expect(page.getByRole("button", { name: "创建章纲" })).toBeEnabled();
  await page.getByRole("button", { name: "创建章纲" }).click();

  await expect(page.getByRole("heading", { name: "一只手也能结印" })).toBeVisible();
  await expect(page.locator(".outline-brief-detail .chapter-status-planned")).toHaveText("已规划");
  await expect(page.getByText("部分就绪")).toBeVisible();
  await expect(page.getByText("故事圣经尚未锁定")).toBeVisible();
  await expect(page.getByText("缺少已确认的世界规则")).toBeVisible();
  await expect(page.getByText("章纲已完整")).toBeVisible();
  await expect(page.getByRole("link", { name: "打开写作台" })).toBeVisible();

  const response = await page.request.get(chaptersPath(work));
  expect(response.ok()).toBe(true);
  expect((await response.json()).data).toEqual([
    expect.objectContaining({
      order: 1,
      title: "一只手也能结印",
      status: "planned",
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
    }),
  ]);
});

test("renders error and long-content states without horizontal overflow", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createOutlineWork(page);

  await page.route(`**${chaptersPath(work)}`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "章纲加载失败。",
          details: {},
          requestId: "req_outline_error",
        },
      }),
    });
  });
  await page.goto(`/workspace/${work.id}/outline`);
  await expect(page.getByText("章纲加载失败。")).toBeVisible();
  await page.unroute(`**${chaptersPath(work)}`);

  const token = await getCsrf(page.request);
  const created = await page.request.post(chaptersPath(work), {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      order: 1,
      title: "一只手也能结印",
      brief: {
        goal: `让沈砚在断臂后找到新的战斗方式。${"他必须只靠右手完成结印。".repeat(80)}`,
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 个场景节拍。`),
        requiredFacts: Array.from({ length: 12 }, (_, index) => `必用事实 ${index + 1}`),
      },
    },
  });
  expect(created.status()).toBe(201);

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/outline`);
    await expect(page.getByRole("heading", { name: "一只手也能结印" })).toBeVisible();
    await expect(page.getByText("第 12 个场景节拍。")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`outline-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
  }
});
