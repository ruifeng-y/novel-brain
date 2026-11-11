import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { createWork, getCsrf, resetRateLimits, uniqueEmail } from "../helpers/auth";
import { expectAuthorFacingLanguage, expectNoPrototypeOnlyLeakage } from "../helpers/ui";

const itemId = "019c1e8c-8e1c-7000-8000-000000000001";
const chapterId = "019c1e8c-8e1c-7000-8000-000000000002";
const planId = "019c1e8c-8e1c-7000-8000-000000000003";
const workItemId = "019c1e8c-8e1c-7000-8000-000000000004";
const userId = "019c1e8c-8e1c-7000-8000-000000000005";

async function authenticatedPage(page: Page, context: BrowserContext) {
  const email = uniqueEmail("batch-review");
  const session = await registerBatchUser(page.request, email);
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

async function registerBatchUser(request: APIRequestContext, email: string): Promise<string> {
  const origin = "http://localhost:3000";
  const csrf = await getCsrf(request);
  await request
    .post("/api/v1/auth/register/send-code", {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: { email },
    })
    .then((response) => expect(response.status()).toBe(200));
  const code = await maildevCode(email);
  const registerCsrf = await getCsrf(request);
  const response = await request.post("/api/v1/auth/register", {
    headers: { Origin: origin, "X-CSRF-Token": registerCsrf },
    data: {
      email,
      code,
      password: "StrongPassword123",
      displayName: "批量作者",
    },
  });
  expect(response.status()).toBe(200);
  const session = /nb_session=([^;]+)/.exec(response.headers()["set-cookie"] ?? "")?.[1];
  if (!session) {
    throw new Error("Registration did not return nb_session");
  }
  return session;
}

async function maildevCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch("http://127.0.0.1:8025/api/email");
    const messages = (await response.json()) as Array<{
      to?: Array<{ address?: string }>;
      text?: string;
      html?: string;
    }>;
    const message = messages.find((item) => item.to?.[0]?.address === email);
    const code = `${message?.text ?? ""}\n${message?.html ?? ""}`.match(/\d{6}/)?.[0];
    if (code) {
      return code;
    }
  }
  throw new Error(`Verification code not found for ${email}`);
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

test.beforeEach(async () => {
  await resetRateLimits();
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
  await page.route(`**${branchPath}/batch-plans/${planId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
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
        },
        requestId: "req_batch_plan",
        meta: {},
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
            calls: 3,
            failedCalls: 1,
            inputTokens: 4_000,
            outputTokens: 2_000,
            reservedCostCny: 1.2,
            settledCostCny: 0.84,
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
            remainingCostCny: 199.16,
            status: "ok",
          },
          groups: [],
          hardStops: [],
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
    await expect(page.getByText("¥0.84 · 剩余 ¥199.16")).toBeVisible();
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
  }
});
