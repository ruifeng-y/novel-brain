import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { workResponseSchema } from "@novel-brain/contracts";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage, productionScreenshotOptions } from "../helpers/ui";

const origin = "http://localhost:3000";
const viewportWidths = [390, 900, 1180, 1440];

test.beforeEach(async () => {
  await resetRateLimits();
});

for (const width of viewportWidths) {
  test(`shows the change center at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const work = await seedChangesPage(page, context, width);
    await page.goto(`/workspace/${work.workId}/changes`);
    await expect(page.getByRole("heading", { name: "修改中心" })).toBeVisible();
    await expect(page.getByText("调整角色伤势")).toBeVisible();
    await expect(
      page.getByLabel("当前创作线").getByRole("option", { name: "what-if" }),
    ).toBeAttached();
    await expectNoOverflow(page);
    await expectAuthorFacingLanguage(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page).toHaveScreenshot(
      ["changes", `changes-${width}.png`],
      productionScreenshotOptions,
    );
  });
}

test("searches indexed Chinese settings from the shell", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  const token = await getCsrf(page.request);
  await page.request
    .post(`/api/v1/works/${seeded.workId}/branches/${seeded.branchId}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        type: "character",
        name: "沈砚",
        aliases: ["小砚"],
        summary: "隐藏忘川书的外门杂役。",
        description: "左臂骨折，仍然坚持调查真相。",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折",
          knowledgeBoundary: "不知道父母死于仇杀",
          relationshipSummary: "与顾青互相试探",
        },
      },
    })
    .then(async (response) => {
      expect(response.status(), await response.text()).toBe(201);
    });
  const rebuildResponse = await page.request.post(
    `/api/v1/works/${seeded.workId}/branches/${seeded.branchId}/search/rebuild`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {},
    },
  );
  expect(rebuildResponse.status()).toBe(202);
  let rebuild = (await rebuildResponse.json()).data as {
    runId: string;
    status: "queued" | "running" | "completed" | "failed";
  };
  while (rebuild.status === "queued" || rebuild.status === "running") {
    const next = await page.request.post(
      `/api/v1/works/${seeded.workId}/branches/${seeded.branchId}/search/rebuilds/${rebuild.runId}/process`,
      {
        headers: { Origin: origin, "X-CSRF-Token": token },
        data: {},
      },
    );
    expect(next.status()).toBe(200);
    rebuild = (await next.json()).data as typeof rebuild;
  }
  expect(rebuild.status).toBe("completed");
  const apiSearch = await page.request.get(
    `/api/v1/works/${seeded.workId}/branches/${seeded.branchId}/search?q=${encodeURIComponent("沈砚")}&limit=20`,
  );
  expect(apiSearch.status()).toBe(200);
  const apiSearchBody = await apiSearch.json();
  expect(apiSearchBody.data.length, JSON.stringify(apiSearchBody)).toBeGreaterThan(0);

  await page.goto(`/workspace/${seeded.workId}/changes`);
  await page.getByRole("button", { name: "搜索" }).click();
  await page.getByRole("button", { name: "当前作品" }).click();
  await page.getByPlaceholder("搜索设定、事实、地点和时间线").fill("沈砚");
  await page.getByRole("button", { name: "搜索", exact: true }).last().click();
  await expect(page.getByText("沈砚")).toBeVisible();
});

test("searches indexed settings across works from the shell", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  const otherWork = await createWork(page.request, {
    mode: "blank",
    title: "跨作品搜索书",
  });
  const writeToken = await getCsrf(page.request);
  await page.request
    .post(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/entities`, {
      headers: { Origin: origin, "X-CSRF-Token": writeToken },
      data: {
        type: "character",
        name: "跨作品角色",
        aliases: ["远山客"],
        summary: "只存在于另一部作品。",
        description: "用于跨作品搜索。",
        tags: [],
        data: {
          bodyState: "正常",
          knowledgeBoundary: "不知道第一部作品的事件",
          relationshipSummary: "尚未与其他角色建立关系",
        },
      },
    })
    .then(async (response) => {
      expect(response.status(), await response.text()).toBe(201);
    });
  const rebuildResponse = await page.request.post(
    `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/search/rebuild`,
    {
      headers: { Origin: origin, "X-CSRF-Token": writeToken },
      data: {},
    },
  );
  expect(rebuildResponse.status()).toBe(202);
  let rebuild = (await rebuildResponse.json()).data as {
    runId: string;
    status: "queued" | "running" | "completed" | "failed";
  };
  while (rebuild.status === "queued" || rebuild.status === "running") {
    const response = await page.request.post(
      `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/search/rebuilds/${rebuild.runId}/process`,
      {
        headers: { Origin: origin, "X-CSRF-Token": writeToken },
        data: {},
      },
    );
    expect(response.status()).toBe(200);
    rebuild = (await response.json()).data as typeof rebuild;
  }

  await page.goto(`/workspace/${seeded.workId}/changes`);
  await page.getByRole("button", { name: "搜索" }).click();
  await page.getByRole("button", { name: "全部作品" }).click();
  await page.getByPlaceholder("搜索设定、事实、地点和时间线").fill("跨作品角色");
  await page.getByRole("button", { name: "搜索", exact: true }).last().click();
  await expect(page.getByText("跨作品角色")).toBeVisible();
});

test("shows a recoverable change load error", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  await page.route(
    `**/api/v1/works/${seeded.workId}/branches/${seeded.branchId}/changes?limit=50`,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "修改记录暂时无法加载",
            details: {},
            requestId: "req_change_error",
          },
        }),
      }),
  );
  await page.goto(`/workspace/${seeded.workId}/changes`);
  await expect(page.getByText("修改记录暂时无法加载")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
});

test("shows a loading state while change records load", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  await page.route(
    `**/api/v1/works/${seeded.workId}/branches/${seeded.branchId}/changes?limit=50`,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    },
  );
  await page.goto(`/workspace/${seeded.workId}/changes`);
  await expect(page.getByText("正在加载修改中心…")).toBeVisible();
  await expect(page.getByText("调整角色伤势")).toBeVisible();
});

test("shows object conflicts across parallel branches", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  const token = await getCsrf(page.request);
  for (const branchId of [seeded.mainBranchId, seeded.whatIfBranchId]) {
    await page.request
      .post(`/api/v1/works/${seeded.workId}/branches/${branchId}/entities`, {
        headers: { Origin: origin, "X-CSRF-Token": token },
        data: {
          type: "character",
          name: "沈砚",
          aliases: [],
          summary: branchId === seeded.mainBranchId ? "主线伤势未恢复。" : "平行线伤势已恢复。",
          description: "",
          tags: [],
          data: {
            bodyState: branchId === seeded.mainBranchId ? "左臂骨折" : "左臂恢复",
            knowledgeBoundary: "不知道父母死于仇杀",
            relationshipSummary: "与顾青互相试探",
          },
        },
      })
      .then(async (response) => {
        expect(response.status(), await response.text()).toBe(201);
      });
  }

  await page.goto(`/workspace/${seeded.workId}/changes`);
  await page.getByLabel("来源分支").selectOption(seeded.whatIfBranchId);
  await page.getByRole("button", { name: "比较" }).click();
  await expect(page.getByText("目标分支已有不同版本").first()).toBeVisible();
  await expect(page.getByText("变更 · 高风险 · 待决定")).toBeVisible();
});

test("rejects stale change versions without hiding the record", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  await page.route(
    `**/api/v1/works/${seeded.workId}/branches/${seeded.mainBranchId}/changes/*/apply`,
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "修改目标已变化，请重新分析。",
            details: {},
            requestId: "req_change_stale",
          },
        }),
      }),
  );
  await page.goto(`/workspace/${seeded.workId}/changes`);
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByText("修改目标已变化，请重新分析。")).toBeVisible();
  await expect(page.getByText("调整角色伤势")).toBeVisible();
});

test("disables apply after a change has been applied", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  const listResponse = await page.request.get(
    `/api/v1/works/${seeded.workId}/branches/${seeded.mainBranchId}/changes?limit=50`,
  );
  expect(listResponse.status()).toBe(200);
  const list = await listResponse.json();
  list.data[0].status = "applied";
  await page.route(
    `**/api/v1/works/${seeded.workId}/branches/${seeded.mainBranchId}/changes?limit=50`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(list),
      }),
  );
  await page.goto(`/workspace/${seeded.workId}/changes`);
  await expect(page.getByRole("button", { name: "应用", exact: true })).toBeDisabled();
  await expect(page.getByText("调整角色伤势")).toBeVisible();
});

test("keeps change records visible when comparison partially fails", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedChangesPage(page, context, 1440);
  await page.route(
    `**/api/v1/works/${seeded.workId}/branches/${seeded.mainBranchId}/compare/${seeded.whatIfBranchId}`,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "分支比较暂时不可用。",
            details: {},
            requestId: "req_change_compare_error",
          },
        }),
      }),
  );
  await page.goto(`/workspace/${seeded.workId}/changes`);
  await page.getByLabel("来源分支").selectOption(seeded.whatIfBranchId);
  await page.getByRole("button", { name: "比较" }).click();
  await expect(page.getByText("分支比较暂时不可用。")).toBeVisible();
  await expect(page.getByText("调整角色伤势")).toBeVisible();
});

async function seedChangesPage(page: Page, context: BrowserContext, width: number) {
  const email = uniqueEmail("changes");
  const session = await registerUser(page.request, email, "StrongPassword123", "修改作者");
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
  const work = await createWork(page.request, {
    mode: "idea",
    title: "修改与版本验收书",
    idea: "一个作者在修改旧稿时保持版本可追溯。",
    genre: "xianxia",
    scaleTarget: "long",
    chapterLengthTarget: 3000,
  });
  const detailResponse = await page.request.get(`/api/v1/works/${work.id}`);
  expect(detailResponse.status()).toBe(200);
  const detail = workResponseSchema.parse(await detailResponse.json()).data;
  const token = await getCsrf(page.request);
  const targetResponse = await page.request.post(
    `/api/v1/works/${work.id}/branches/${detail.mainBranch.id}/entities`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {
        type: "character",
        name: "修改目标角色",
        aliases: [],
        summary: "左臂骨折。",
        description: "等待修改。",
        tags: [],
        data: {
          bodyState: "左臂骨折",
          knowledgeBoundary: "不知道旧案真相",
          relationshipSummary: "尚未与主角接触",
        },
      },
    },
  );
  expect(targetResponse.status()).toBe(201);
  const target = (await targetResponse.json()).data as { id: string; version: number };
  const branchResponse = await page.request.post(`/api/v1/works/${work.id}/branches`, {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: {
      name: "what-if",
      sourceNodeId: detail.mainBranch.headNodeId,
      reason: "验证另一条剧情线",
    },
  });
  expect(branchResponse.status()).toBe(200);
  const branch = (await branchResponse.json()).data as { id: string };
  const changeResponse = await page.request.post(
    `/api/v1/works/${work.id}/branches/${detail.mainBranch.id}/changes`,
    {
      headers: {
        Origin: origin,
        "X-CSRF-Token": token,
        "Idempotency-Key": `changes-e2e-${width}-${Date.now()}`,
      },
      data: {
        title: "调整角色伤势",
        reason: "让后续战斗成立",
        targetVersion: target.version,
        targetType: "entity",
        targetId: target.id,
        objectType: "entity",
        before: { bodyState: "左臂骨折" },
        after: { bodyState: "左臂恢复" },
        risk: "medium",
        source: "author",
      },
    },
  );
  expect(changeResponse.status()).toBe(200);
  const change = (await changeResponse.json()).data as { id: string };
  const analysisResponse = await page.request.post(
    `/api/v1/works/${work.id}/branches/${detail.mainBranch.id}/changes/${change.id}/analyze`,
    {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: {},
    },
  );
  expect(analysisResponse.status()).toBe(200);
  return {
    workId: work.id,
    branchId: detail.mainBranch.id,
    mainBranchId: detail.mainBranch.id,
    whatIfBranchId: branch.id,
  };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
