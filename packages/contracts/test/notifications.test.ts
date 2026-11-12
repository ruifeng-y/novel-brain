import { describe, expect, it } from "vitest";

import {
  notificationListQuerySchema,
  notificationPayloadSchema,
  notificationSchema,
  notificationTypeSchema,
} from "../src";

describe("notification contracts", () => {
  it("parses unread filters and bounded cursor pages", () => {
    expect(notificationListQuerySchema.parse({ unreadOnly: "true", limit: "8" })).toEqual({
      unreadOnly: true,
      limit: 8,
    });
    expect(notificationListQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it("accepts author-facing task and review notifications", () => {
    expect(notificationTypeSchema.parse("job_completed")).toBe("job_completed");
    expect(
      notificationSchema.parse({
        id: "01a1b4ed-6396-73e2-9c10-01530a818ed7",
        userId: "01a1b4ed-6396-73e2-9c10-01530a818ed8",
        workId: "01a1b4ed-6396-73e2-9c10-01530a818ed9",
        branchId: "01a1b4ed-6396-73e2-9c10-01530a818eda",
        type: "job_completed",
        targetType: "job",
        targetId: "01a1b4ed-6396-73e2-9c10-01530a818edb",
        payload: {
          title: "批量任务已完成",
          message: "第一卷已完成批量生成。",
          href: "/workspace/01a1b4ed-6396-73e2-9c10-01530a818ed9/batch",
        },
        dedupeKey: "job:01a1b4ed-6396-73e2-9c10-01530a818edb:completed",
        readAt: null,
        createdAt: "2026-11-12T00:00:00.000Z",
      }),
    ).toMatchObject({ type: "job_completed", readAt: null });
  });

  it("rejects notification links that leave the application", () => {
    expect(() =>
      notificationPayloadSchema.parse({
        title: "任务完成",
        message: "可查看结果。",
        href: "https://example.com/workspace",
      }),
    ).toThrow();
    expect(() =>
      notificationPayloadSchema.parse({
        title: "任务完成",
        message: "可查看结果。",
        href: "//example.com/workspace",
      }),
    ).toThrow();
    expect(() =>
      notificationPayloadSchema.parse({
        title: "任务完成",
        message: "可查看结果。",
        href: "/\\example.com/workspace",
      }),
    ).toThrow();
    expect(() =>
      notificationPayloadSchema.parse({
        title: "任务完成",
        message: "可查看结果。",
        href: "/%5cexample.com/workspace",
      }),
    ).toThrow();
  });
});
