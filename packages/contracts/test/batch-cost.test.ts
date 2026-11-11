import { describe, expect, it } from "vitest";

import {
  batchCostBudgetPolicySchema,
  batchCostReportSchema,
  batchPlanCreateRequestSchema,
} from "../src";

const planId = "019c1e8c-8e1c-7000-8000-000000000001";
const workId = "019c1e8c-8e1c-7000-8000-000000000002";
const chapterId = "019c1e8c-8e1c-7000-8000-000000000003";
const volumeNodeId = "019c1e8c-8e1c-7000-8000-000000000004";

describe("batch cost contracts", () => {
  it("keeps budget policy and report evidence explicit", () => {
    expect(batchCostBudgetPolicySchema.parse({})).toEqual({
      chapterMaxCostCny: 2.5,
      volumeMaxCostCny: null,
      taskMaxCostCny: null,
      perTenThousandCharsMaxCostCny: null,
    });

    expect(
      batchPlanCreateRequestSchema.parse({
        scope: { type: "chapter", chapterIds: [chapterId] },
        costBudgetPolicy: {
          chapterMaxCostCny: 2,
          volumeMaxCostCny: 80,
          taskMaxCostCny: 200,
          perTenThousandCharsMaxCostCny: 12,
        },
      }).costBudgetPolicy,
    ).toMatchObject({ taskMaxCostCny: 200 });

    expect(
      batchCostReportSchema.parse({
        planId,
        workId,
        currency: "CNY",
        generatedAt: "2026-11-11T06:00:00.000Z",
        totals: {
          chapters: 3,
          completedChapters: 2,
          statusCounts: {
            queued: 0,
            preparing: 0,
            running: 0,
            paused: 0,
            waitingReview: 0,
            completed: 2,
            failed: 1,
            cancelled: 0,
            skipped: 0,
            budgetExceeded: 1,
          },
          calls: 9,
          failedCalls: 1,
          inputTokens: 12_000,
          outputTokens: 8_000,
          reservedCostCny: 1.2,
          settledCostCny: 0.84,
          durationMs: 18_000,
          chaptersPerHour: 400,
        },
        budget: {
          policy: {
            chapterMaxCostCny: 2,
            volumeMaxCostCny: 80,
            taskMaxCostCny: 200,
            perTenThousandCharsMaxCostCny: 12,
          },
          projectedCharacters: 30_000,
          perTenThousandCharactersLimitCny: 36,
          remainingCostCny: 199.16,
          status: "ok",
        },
        groups: [
          {
            key: volumeNodeId,
            label: "第一卷",
            chapters: 3,
            completedChapters: 2,
            calls: 9,
            failedCalls: 1,
            inputTokens: 12_000,
            outputTokens: 8_000,
            costCny: 0.84,
            durationMs: 6_000,
            chaptersPerHour: 1_200,
          },
        ],
        hardStops: [
          {
            jobId: "019c1e8c-8e1c-7000-8000-000000000005",
            chapterId,
            code: "JOB_BUDGET_EXCEEDED",
            message: "任务已达到成本上限，草稿和检查点已保留",
            scope: "volume",
            occurredAt: "2026-11-11T05:59:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ totals: { settledCostCny: 0.84 }, groups: [{ calls: 9 }] });
  });
});
