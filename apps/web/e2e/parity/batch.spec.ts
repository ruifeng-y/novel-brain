import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  batchCostReportResponseSchema,
  batchPlanItemListResponseSchema,
  batchPlanResponseSchema,
  batchReviewQueueListResponseSchema,
  outlineNodeMutationResponseSchema,
} from "@novel-brain/contracts";
import { randomUUID } from "node:crypto";

import { createWork, getCsrf, registerUser, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { seedM0Work } from "../helpers/m0";
import {
  expectAuthorFacingLanguage,
  expectNoPrototypeOnlyLeakage,
  productionScreenshotOptions,
} from "../helpers/ui";
import { startWorker } from "../helpers/worker";

const itemId = "019c1e8c-8e1c-7000-8000-000000000001";
const chapterId = "019c1e8c-8e1c-7000-8000-000000000002";
const planId = "019c1e8c-8e1c-7000-8000-000000000003";
const workItemId = "019c1e8c-8e1c-7000-8000-000000000004";
const userId = "019c1e8c-8e1c-7000-8000-000000000005";
const pausedCursor = "019c1e8c-8e1c-7000-8000-000000000012";
const origin = "http://localhost:3000";

type BatchWork = {
  id: string;
  title: string;
  mainBranch: { id: string };
};

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("batch-review");
  const session = await registerUser(page.request, email, "StrongPassword123", "批量作者");
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

function branchPathOf(work: BatchWork) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

function planControlApi(
  work: BatchWork,
  plan: { id: string },
  action: "start" | "pause" | "resume" | "cancel" | "retry",
) {
  switch (action) {
    case "start":
      return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/batch-plans/${plan.id}/start`;
    case "pause":
      return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/batch-plans/${plan.id}/pause`;
    case "resume":
      return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/batch-plans/${plan.id}/resume`;
    case "cancel":
      return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/batch-plans/${plan.id}/cancel`;
    case "retry":
      return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/batch-plans/${plan.id}/retry`;
  }
}

function planCostReportApi(work: BatchWork, plan: { id: string }) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/batch-plans/${plan.id}/cost-report?groupBy=volume`;
}

function reviewQueueDecisionsApi(work: BatchWork) {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/review-queue/decisions`;
}

async function createOutlineChapter(page: Page, work: BatchWork): Promise<string> {
  const token = await getCsrf(page.request);
  const outlinePath = `${branchPathOf(work)}/outline/nodes`;
  const createNode = async (body: Record<string, unknown>) => {
    const response = await page.request.post(outlinePath, {
      headers: { Origin: origin, "X-CSRF-Token": token },
      data: body,
    });
    expect(response.status()).toBe(201);
    return outlineNodeMutationResponseSchema.parse(await response.json()).data.node;
  };
  const book = await createNode({ level: "book", parentId: null, title: "批量控制测试书" });
  const volume = await createNode({
    level: "volume",
    parentId: book.id,
    title: "第一卷",
  });
  const act = await createNode({
    level: "act",
    parentId: volume.id,
    title: "第一幕",
  });
  const chapter = await createNode({
    level: "chapter",
    parentId: act.id,
    chapterCreate: {
      number: 1,
      title: "批量控制章节",
      brief: {
        goal: "验证批量任务控制与持久化。",
        pov: "沈砚",
        location: "山门",
        sceneBeats: ["发现异常", "作出选择"],
        requiredFacts: ["沈砚左臂受伤"],
      },
    },
  });
  return chapter.chapter!.id;
}

async function createBatchPlan(page: Page, work: BatchWork, chapterId: string) {
  const token = await getCsrf(page.request);
  const response = await page.request.post(`${branchPathOf(work)}/batch-plans`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": `batch-e2e-${randomUUID()}`,
    },
    data: {
      scope: { type: "chapter", chapterIds: [chapterId] },
      approvalMode: "per_volume",
      priorityClass: "batch",
      maxConcurrency: 2,
    },
  });
  expect(response.status()).toBe(202);
  return batchPlanResponseSchema.parse(await response.json()).data;
}

async function getPersistedPlan(page: Page, work: BatchWork, planId: string) {
  const response = await page.request.get(`${branchPathOf(work)}/batch-plans/${planId}`);
  expect(response.status()).toBe(200);
  return batchPlanResponseSchema.parse(await response.json()).data;
}

async function expectPersistedPlanStatus(
  page: Page,
  work: BatchWork,
  planId: string,
  status: "running" | "paused" | "waiting_review" | "failed" | "cancelled",
) {
  await expect
    .poll(async () => (await getPersistedPlan(page, work, planId)).status, { timeout: 60_000 })
    .toBe(status);
}

async function getPersistedPlanSteps(page: Page, work: BatchWork, planId: string) {
  const response = await page.request.get(
    `${branchPathOf(work)}/batch-plans/${planId}/items?type=step&limit=100`,
  );
  expect(response.status()).toBe(200);
  return batchPlanItemListResponseSchema.parse(await response.json()).data;
}

async function createWorkerReadyPlan(page: Page, title: string) {
  const work = (await seedM0Work(page.request, { title })) as BatchWork;
  const chapterId = await createOutlineChapter(page, work);
  return { work, plan: await createBatchPlan(page, work, chapterId) };
}

function queueResponse(status: "pending" | "claimed" | "rejected", version: number) {
  return {
    data: [
      {
        id: itemId,
        planId,
        workItemId,
        targetType: "chapter",
        targetId: chapterId,
        chapterId,
        chapterNumber: 12,
        chapterTitle: "雪夜问路",
        volumeTitle: "第一卷",
        status,
        risk: "high",
        riskReasons: [
          {
            code: "QUALITY_REPORT_MISSING",
            message: "尚未生成当前章节版本的质量报告。",
          },
        ],
        quality: {
          reportState: "missing",
          canApprove: false,
          scoreAverage: null,
          blockerCount: 0,
        },
        findings: [],
        claimedBy: status === "claimed" ? userId : null,
        claimedAt: status === "claimed" ? "2026-11-11T05:00:00.000Z" : null,
        version,
        createdAt: "2026-11-11T05:00:00.000Z",
        updatedAt: "2026-11-11T05:00:00.000Z",
      },
    ],
    requestId: "req_batch_review_queue",
    meta: {
      nextCursor: null,
      counts: {
        total: 1,
        pending: status === "pending" ? 1 : 0,
        claimed: status === "claimed" ? 1 : 0,
        highRisk: 1,
        stale: 0,
      },
    },
  };
}

function pausedPlanResponse() {
  return {
    data: {
      id: planId,
      jobId: planId,
      workId: "019c1e8c-8e1c-7000-8000-000000000010",
      branchId: "019c1e8c-8e1c-7000-8000-000000000011",
      userId,
      status: "paused",
      scope: { type: "chapter", chapterIds: [chapterId] },
      approvalMode: "auto",
      costBudgetPolicy: {
        chapterMaxCostCny: 2.5,
        volumeMaxCostCny: 80,
        taskMaxCostCny: 200,
        perTenThousandCharsMaxCostCny: 12,
      },
      priorityClass: "batch",
      idempotencyKey: "batch-e2e-paused",
      counts: {
        total: 1,
        book: 0,
        volume: 0,
        chapter: 1,
        step: 0,
        pending: 0,
        ready: 0,
        running: 0,
        paused: 1,
        waiting_review: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
      },
      scheduling: {
        caps: { global: 4, perWork: 2, perUser: 2 },
        effectivePerWork: 2,
        priority: 1_000,
        initialRunnableKeys: [],
      },
      createdAt: "2026-11-11T05:00:00.000Z",
      updatedAt: "2026-11-11T05:00:00.000Z",
    },
    requestId: "req_batch_paused_plan",
    meta: {},
  };
}

function pausedCostReportResponse(workId: string) {
  return {
    data: {
      planId,
      workId,
      currency: "CNY",
      generatedAt: "2026-11-11T06:00:00.000Z",
      totals: {
        chapters: 1,
        completedChapters: 0,
        statusCounts: {
          queued: 0,
          preparing: 0,
          running: 0,
          paused: 1,
          waitingReview: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          skipped: 0,
          budgetExceeded: 1,
        },
        calls: 3,
        failedCalls: 1,
        inputTokens: 4_000,
        outputTokens: 2_000,
        reservedCostCny: 1.2,
        settledCostCny: 0.84,
        durationMs: 18_000,
        chaptersPerHour: null,
      },
      budget: {
        policy: {
          chapterMaxCostCny: 2.5,
          volumeMaxCostCny: 80,
          taskMaxCostCny: 200,
          perTenThousandCharsMaxCostCny: 12,
        },
        projectedCharacters: 3_000,
        perTenThousandCharactersLimitCny: 3.6,
        remainingCostCny: 0,
        status: "exhausted",
      },
      groups: [],
      hardStops: [
        {
          jobId: "019c1e8c-8e1c-7000-8000-000000000008",
          chapterId,
          code: "JOB_BUDGET_EXCEEDED",
          message: "第一卷已达到成本上限，草稿和检查点已保留",
          scope: "volume",
          occurredAt: "2026-11-11T05:59:00.000Z",
        },
      ],
    },
    requestId: "req_batch_paused_cost",
    meta: {},
  };
}

test.beforeEach(async () => {
  await resetRateLimits();
});

test("starts, pauses, resumes, cancels and reports a batch plan through persisted APIs", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = (await createWork(page.request, {
    mode: "blank",
    title: "批量任务控制",
  })) as BatchWork;
  const chapterId = await createOutlineChapter(page, work);
  const plan = await createBatchPlan(page, work, chapterId);

  await page.goto(`/workspace/${work.id}/batch`);
  const planCard = page.locator(`[data-plan-id="${plan.id}"]`);
  await expect(planCard).toContainText("待开始");

  const startResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planControlApi(work, plan, "start")}` &&
      response.status() === 202,
  );
  await planCard.getByRole("button", { name: "开始任务" }).click();
  await startResponse;
  await expectPersistedPlanStatus(page, work, plan.id, "running");

  const pauseResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planControlApi(work, plan, "pause")}` &&
      response.status() === 200,
  );
  await planCard.getByRole("button", { name: "暂停任务" }).click();
  await pauseResponse;
  await expectPersistedPlanStatus(page, work, plan.id, "paused");

  const resumeResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planControlApi(work, plan, "resume")}` &&
      response.status() === 202,
  );
  await planCard.getByRole("button", { name: "恢复任务" }).click();
  await resumeResponse;
  await expectPersistedPlanStatus(page, work, plan.id, "running");

  const cancelResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planControlApi(work, plan, "cancel")}` &&
      response.status() === 200,
  );
  await planCard.getByRole("button", { name: "取消任务" }).click();
  await cancelResponse;
  await expectPersistedPlanStatus(page, work, plan.id, "cancelled");

  const reportResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planCostReportApi(work, plan)}` && response.status() === 200,
  );
  await planCard.getByRole("button", { name: "查看报告" }).click();
  const reportResponse = await reportResponsePromise;
  const report = batchCostReportResponseSchema.parse(await reportResponse.json()).data;
  expect(report).toMatchObject({ planId: plan.id, currency: "CNY" });
  await expect(page.getByLabel("批量任务报告")).toContainText("任务报告");
});

test("retries a failed batch plan through the production control", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const { work, plan } = await createWorkerReadyPlan(page, "批量任务重试");
  const worker = await startWorker({ failStep: "verify" });
  try {
    await page.goto(`/workspace/${work.id}/batch`);
    const startResponse = page.waitForResponse(
      (response) =>
        response.url() === `${origin}${planControlApi(work, plan, "start")}` &&
        response.status() === 202,
    );
    await page
      .locator(`[data-plan-id="${plan.id}"]`)
      .getByRole("button", { name: "开始任务" })
      .click();
    await startResponse;
    await expectPersistedPlanStatus(page, work, plan.id, "failed");
    const failedSteps = await getPersistedPlanSteps(page, work, plan.id);
    expect(failedSteps.find((item) => item.key.endsWith(":draft"))?.status).toBe("succeeded");
    expect(failedSteps.find((item) => item.key.endsWith(":verify"))?.status).toBe("failed");
  } finally {
    await worker.stop();
  }

  await page.getByRole("button", { name: "刷新队列" }).click();
  const planCard = page.locator(`[data-plan-id="${plan.id}"]`);
  await expect(planCard).toContainText("执行失败");

  const retryResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planControlApi(work, plan, "retry")}` &&
      response.status() === 202,
  );
  await planCard.getByRole("button", { name: "重试任务" }).click();
  await retryResponse;
  await expectPersistedPlanStatus(page, work, plan.id, "running");
  const retriedSteps = await getPersistedPlanSteps(page, work, plan.id);
  expect(retriedSteps.find((item) => item.key.endsWith(":draft"))?.status).toBe("succeeded");
  expect(retriedSteps.find((item) => item.key.endsWith(":verify"))?.status).toBe("ready");
});

test("claims and rejects a persisted batch review item through production controls", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const { work, plan } = await createWorkerReadyPlan(page, "批量审核持久化");
  const worker = await startWorker();
  try {
    await page.goto(`/workspace/${work.id}/batch`);
    const planCard = page.locator(`[data-plan-id="${plan.id}"]`);
    const startResponse = page.waitForResponse(
      (response) =>
        response.url() === `${origin}${planControlApi(work, plan, "start")}` &&
        response.status() === 202,
    );
    await planCard.getByRole("button", { name: "开始任务" }).click();
    await startResponse;
    await expectPersistedPlanStatus(page, work, plan.id, "waiting_review");
  } finally {
    await worker.stop();
  }

  const reportResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${planCostReportApi(work, plan)}` && response.status() === 200,
  );
  await page
    .locator(`[data-plan-id="${plan.id}"]`)
    .getByRole("button", { name: "查看报告" })
    .click();
  const reportResponse = await reportResponsePromise;
  const report = batchCostReportResponseSchema.parse(await reportResponse.json()).data;
  expect(report.totals.calls).toBeGreaterThan(0);
  expect(report.totals.chapters).toBe(plan.counts.chapter);

  await page.getByRole("button", { name: "刷新队列" }).click();
  const reviewItem = page.locator(".batch-review-item").first();
  await expect(reviewItem).toBeVisible();
  await reviewItem.click();

  const claimResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${branchPathOf(work)}/review-queue/claim` &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "领取所选" }).click();
  await claimResponse;

  await page.getByRole("textbox", { name: "驳回原因" }).fill("卷末证据不足，需要重新生成。");
  const decisionResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${reviewQueueDecisionsApi(work)}` && response.status() === 200,
  );
  await page.getByRole("button", { name: "驳回", exact: true }).click();
  await decisionResponse;

  const reviewedResponse = await page.request.get(
    `${branchPathOf(work)}/review-queue?status=rejected&limit=100`,
  );
  expect(reviewedResponse.status()).toBe(200);
  const reviewedPage = batchReviewQueueListResponseSchema.parse(await reviewedResponse.json());
  expect(reviewedPage.data.some((item) => item.status === "rejected")).toBe(true);
});

test("shows empty and error states for the batch review queue", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "批量审核空状态",
  });
  const queuePath = `**/api/v1/works/${work.id}/branches/${work.mainBranch.id}/review-queue?**`;

  await page.route(queuePath, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        requestId: "req_batch_review_empty",
        meta: {
          nextCursor: null,
          counts: { total: 0, pending: 0, claimed: 0, highRisk: 0, stale: 0 },
        },
      }),
    });
  });

  await page.goto(`/workspace/${work.id}/batch`);
  await expect(page.getByRole("heading", { name: "审核队列" })).toBeVisible();
  await expect(page.getByText("当前没有待处理的审核项")).toBeVisible();
  await expect(
    page.locator(".main-nav").getByRole("link", { name: "批量生产", exact: true }),
  ).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);

  await page.unroute(queuePath);
  await page.route(queuePath, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "审核队列加载失败。",
          details: {},
          requestId: "req_batch_review_error",
        },
      }),
    });
  });
  await page.reload();
  await expect(page.getByText("审核队列加载失败。")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新队列" })).toBeVisible();
});

test("claims a review item and shows partial decision feedback", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "批量审核交互",
  });
  const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/review-queue`;
  const queuePath = `**${basePath}?**`;
  let queueVersion = 1;
  let claimed = false;

  await page.route(queuePath, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        claimed ? queueResponse("claimed", queueVersion) : queueResponse("pending", queueVersion),
      ),
    });
  });
  await page.route(`**${basePath}/claim`, async (route) => {
    claimed = true;
    queueVersion = 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: queueResponse("claimed", queueVersion).data,
        requestId: "req_batch_review_claim",
        meta: {},
      }),
    });
  });
  await page.route(`**${basePath}/decisions`, async (route) => {
    const current = queueResponse("claimed", queueVersion).data[0]!;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          results: [
            {
              itemId,
              status: "rejected",
              errorCode: null,
              message: "审核项已驳回，后续可进入修改或重新生成",
              item: {
                ...current,
                status: "rejected",
                version: 3,
              },
            },
            {
              itemId: "019c1e8c-8e1c-7000-8000-000000000006",
              status: "failed",
              errorCode: "VERSION_CONFLICT",
              message: "审核项已被其他操作更新，请刷新后重试",
              item: null,
            },
          ],
          succeeded: 1,
          failed: 1,
        },
        requestId: "req_batch_review_decisions",
        meta: { replayed: false },
      }),
    });
  });

  await page.goto(`/workspace/${work.id}/batch`);
  await expect(page.locator(".batch-review-item")).toContainText("第 12 章");
  await page.locator(".batch-review-item").click();
  await page.getByRole("button", { name: "领取所选" }).click();
  await expect(page.getByText("已领取 1 个审核项。")).toBeVisible();
  await page.getByRole("textbox", { name: "驳回原因" }).fill("本章主线偏离锁定大纲。");
  await page.getByRole("button", { name: "驳回", exact: true }).click();
  await expect(page.getByText("已处理 1 项，1 项需要刷新后重试。")).toBeVisible();
});

test("discovers a paused budget plan when the review queue is empty", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "暂停计划发现",
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  await page.route(`**${branchPath}/review-queue?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        requestId: "req_batch_review_empty_for_paused_plan",
        meta: {
          nextCursor: null,
          counts: { total: 0, pending: 0, claimed: 0, highRisk: 0, stale: 0 },
        },
      }),
    });
  });
  await page.route(`**${branchPath}/batch-plans?status=paused&limit=20**`, async (route) => {
    const hasCursor = new URL(route.request().url()).searchParams.has("cursor");
    const response = pausedPlanResponse();
    response.data.workId = work.id;
    response.data.branchId = work.mainBranch.id;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: hasCursor ? [response.data] : [],
        requestId: response.requestId,
        meta: { nextCursor: hasCursor ? null : pausedCursor },
      }),
    });
  });
  await page.route(`**${branchPath}/batch-plans/${planId}`, async (route) => {
    const response = pausedPlanResponse();
    response.data.workId = work.id;
    response.data.branchId = work.mainBranch.id;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.route(`**${branchPath}/batch-plans/${planId}/cost-report?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pausedCostReportResponse(work.id)),
    });
  });

  await page.goto(`/workspace/${work.id}/batch`);
  await expect(page.getByText("已暂停")).toBeVisible();
  await page
    .locator(`[data-plan-id="${planId}"]`)
    .getByRole("button", { name: "查看报告" })
    .click();
  await expect(page.getByText("任务报告")).toBeVisible();
  await expect(page.getByText("¥0.84", { exact: true })).toBeVisible();
  await expect(page.getByText("¥0.00", { exact: true })).toBeVisible();
  await expect(page.getByText("单卷预算已耗尽")).toBeVisible();
  await expect(page.getByText("第一卷已达到成本上限，草稿和检查点已保留")).toBeVisible();
  await expect(page.getByText("当前没有待处理的审核项")).toBeVisible();
  await expectAuthorFacingLanguage(page);
  await expectNoPrototypeOnlyLeakage(page);
});

test("keeps the review queue usable when paused plan discovery fails", async ({
  page,
  context,
}) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "暂停计划部分失败",
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  await page.route(`**${branchPath}/review-queue?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        requestId: "req_batch_review_empty_for_plan_failure",
        meta: {
          nextCursor: null,
          counts: { total: 0, pending: 0, claimed: 0, highRisk: 0, stale: 0 },
        },
      }),
    });
  });
  await page.route(`**${branchPath}/batch-plans?status=paused&limit=20**`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "暂停计划加载失败。",
          details: {},
          requestId: "req_batch_plan_discovery_error",
        },
      }),
    });
  });

  await page.goto(`/workspace/${work.id}/batch`);
  await expect(page.getByText("部分批量任务状态加载失败，请刷新重试。")).toBeVisible();
  await expect(page.getByText("当前没有待处理的审核项")).toBeVisible();
});

test("discovers a failed batch plan and preserves its failure state", async ({ page, context }) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "失败计划发现",
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

  await page.route(`**${branchPath}/review-queue?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        requestId: "req_batch_review_empty_for_failed_plan",
        meta: {
          nextCursor: null,
          counts: { total: 0, pending: 0, claimed: 0, highRisk: 0, stale: 0 },
        },
      }),
    });
  });
  await page.route(`**${branchPath}/batch-plans?status=paused&limit=20**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        requestId: "req_batch_paused_empty",
        meta: { nextCursor: null },
      }),
    }),
  );
  await page.route(`**${branchPath}/batch-plans?status=failed&limit=20**`, async (route) => {
    const response = pausedPlanResponse();
    response.data.workId = work.id;
    response.data.branchId = work.mainBranch.id;
    response.data.status = "failed";
    response.data.counts.paused = 0;
    response.data.counts.failed = 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [response.data],
        requestId: "req_batch_failed_plan",
        meta: { nextCursor: null },
      }),
    });
  });
  await page.route(`**${branchPath}/batch-plans/${planId}`, async (route) => {
    const response = pausedPlanResponse();
    response.data.workId = work.id;
    response.data.branchId = work.mainBranch.id;
    response.data.status = "failed";
    response.data.counts.paused = 0;
    response.data.counts.failed = 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.route(`**${branchPath}/batch-plans/${planId}/cost-report?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pausedCostReportResponse(work.id)),
    });
  });

  await page.goto(`/workspace/${work.id}/batch`);
  await expect(page.getByText("执行失败")).toBeVisible();
  await expect(page.getByText("当前没有待处理的审核项")).toBeVisible();
  await expectAuthorFacingLanguage(page);
});

test("keeps the batch review workspace within four viewports", async ({
  page,
  context,
}, testInfo) => {
  await authenticatedPage(page, context);
  const work = await createWork(page.request, {
    mode: "blank",
    title: "批量审核响应式",
  });
  const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const responsivePlan = {
    id: planId,
    jobId: planId,
    workId: work.id,
    branchId: work.mainBranch.id,
    userId,
    status: "running",
    scope: { type: "chapter", chapterIds: [chapterId] },
    approvalMode: "auto",
    costBudgetPolicy: {
      chapterMaxCostCny: 2.5,
      volumeMaxCostCny: 80,
      taskMaxCostCny: 200,
      perTenThousandCharsMaxCostCny: 12,
    },
    priorityClass: "batch",
    idempotencyKey: "batch-e2e",
    counts: {
      total: 1,
      book: 0,
      volume: 0,
      chapter: 1,
      step: 0,
      pending: 0,
      ready: 0,
      running: 0,
      paused: 0,
      waiting_review: 1,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    },
    scheduling: {
      caps: { global: 4, perWork: 2, perUser: 2 },
      effectivePerWork: 2,
      priority: 1_000,
      initialRunnableKeys: [],
    },
    createdAt: "2026-11-11T05:00:00.000Z",
    updatedAt: "2026-11-11T05:00:00.000Z",
  };
  await page.route(`**${branchPath}/batch-plans?status=**`, async (route) => {
    const planStatus = new URL(route.request().url()).searchParams.get("status");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: planStatus === "running" ? [responsivePlan] : [],
        requestId: "req_batch_plan",
        meta: { nextCursor: null },
      }),
    });
  });
  await page.route(`**${branchPath}/batch-plans/${planId}/cost-report?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          planId,
          workId: work.id,
          currency: "CNY",
          generatedAt: "2026-11-11T06:00:00.000Z",
          totals: {
            chapters: 1,
            completedChapters: 0,
            statusCounts: {
              queued: 0,
              preparing: 0,
              running: 0,
              paused: 1,
              waitingReview: 0,
              completed: 0,
              failed: 0,
              cancelled: 0,
              skipped: 0,
              budgetExceeded: 1,
            },
            calls: 3,
            failedCalls: 1,
            inputTokens: 4_000,
            outputTokens: 2_000,
            reservedCostCny: 1.2,
            settledCostCny: 0.84,
            durationMs: 18_000,
            chaptersPerHour: null,
          },
          budget: {
            policy: {
              chapterMaxCostCny: 2.5,
              volumeMaxCostCny: 80,
              taskMaxCostCny: 200,
              perTenThousandCharsMaxCostCny: 12,
            },
            projectedCharacters: 3_000,
            perTenThousandCharactersLimitCny: 3.6,
            remainingCostCny: 0,
            status: "exhausted",
          },
          groups: [],
          hardStops: [
            {
              jobId: "019c1e8c-8e1c-7000-8000-000000000008",
              chapterId,
              code: "JOB_BUDGET_EXCEEDED",
              message: "第一卷已达到成本上限，草稿和检查点已保留",
              scope: "volume",
              occurredAt: "2026-11-11T05:59:00.000Z",
            },
            {
              jobId: "019c1e8c-8e1c-7000-8000-000000000009",
              chapterId: null,
              code: "JOB_BUDGET_EXCEEDED",
              message: "模型调用超过预留，生成已暂停",
              scope: null,
              occurredAt: "2026-11-11T05:58:00.000Z",
            },
          ],
        },
        requestId: "req_batch_cost",
        meta: {},
      }),
    });
  });
  await page.route(
    `**/api/v1/works/${work.id}/branches/${work.mainBranch.id}/review-queue?**`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(queueResponse("pending", 1)),
      });
    },
  );

  for (const width of [390, 900, 1180, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/${work.id}/batch`);
    await expect(page.getByRole("heading", { name: "审核队列" })).toBeVisible();
    await expect(page.getByLabel("审核队列摘要")).toBeVisible();
    const planCard = page.locator(`[data-plan-id="${planId}"]`);
    await expect(planCard).toContainText("执行中");
    await planCard.getByRole("button", { name: "查看报告" }).click();
    await expect(page.getByLabel("批量任务报告")).toContainText("任务报告");
    await expect(page.getByText("¥0.84", { exact: true })).toBeVisible();
    await expect(page.getByText("¥0.00", { exact: true })).toBeVisible();
    await expect(page.getByText("单卷预算已耗尽")).toBeVisible();
    await expect(page.getByText("任务预算已耗尽")).toBeVisible();
    await expect(page.getByText("第一卷已达到成本上限，草稿和检查点已保留")).toBeVisible();
    await expect(page.getByText("模型调用超过预留，生成已暂停")).toBeVisible();
    await expectNoPrototypeOnlyLeakage(page);
    await expectAuthorFacingLanguage(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach(`batch-review-${width}`, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true }),
      contentType: "image/png",
    });
    await expect
      .soft(page)
      .toHaveScreenshot(["batch", `batch-${width}.png`], productionScreenshotOptions);
  }
});
