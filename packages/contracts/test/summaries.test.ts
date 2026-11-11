import { describe, expect, it } from "vitest";

import {
  SUMMARY_REBUILD_JOB,
  contextSourceRefSchema,
  summaryRebuildJobSchema,
  summaryRebuildRequestSchema,
  summaryRecordSchema,
  workerJobSchema,
} from "../src";

const ids = {
  summary: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1001",
  work: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1002",
  branch: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1003",
  scope: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1004",
  chapter: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1005",
  version: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1006",
  actor: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1007",
};

const hash = "a".repeat(64);

describe("summary contracts", () => {
  it("retains source node/version ranges, compiler/model versions and content hashes", () => {
    const parsed = summaryRecordSchema.parse({
      id: ids.summary,
      workId: ids.work,
      branchId: ids.branch,
      level: "volume",
      scopeId: ids.scope,
      chapterId: null,
      title: "第一卷",
      content: "第一卷概要",
      status: "fresh",
      version: 3,
      contentHash: hash,
      inputHash: hash,
      compilerVersion: "summary-compiler-v1",
      modelVersion: "deterministic-summary-v1",
      sourceRanges: [
        {
          nodeId: ids.scope,
          versionNodeId: ids.version,
          objectVersion: 2,
          chapterFrom: 1,
          chapterTo: 8,
        },
      ],
      fromChapter: 1,
      toChapter: 8,
      generatedAt: "2026-11-06T10:00:00.000Z",
      invalidatedAt: null,
      invalidationReason: null,
    });

    expect(parsed.sourceRanges[0]).toMatchObject({
      versionNodeId: ids.version,
      chapterFrom: 1,
      chapterTo: 8,
    });
    expect(parsed).toMatchObject({
      compilerVersion: "summary-compiler-v1",
      modelVersion: "deterministic-summary-v1",
      contentHash: hash,
    });
  });

  it("rejects stale summaries without invalidation evidence and unknown fields", () => {
    const base = {
      id: ids.summary,
      workId: ids.work,
      branchId: ids.branch,
      level: "chapter",
      scopeId: ids.scope,
      chapterId: ids.chapter,
      title: "第一章",
      content: "第一章概要",
      status: "stale",
      version: 1,
      contentHash: hash,
      inputHash: hash,
      compilerVersion: "summary-compiler-v1",
      modelVersion: "deterministic-summary-v1",
      sourceRanges: [
        {
          nodeId: ids.scope,
          versionNodeId: ids.version,
          objectVersion: 1,
          chapterFrom: 1,
          chapterTo: 1,
        },
      ],
      fromChapter: 1,
      toChapter: 1,
      generatedAt: "2026-11-06T10:00:00.000Z",
      invalidatedAt: null,
      invalidationReason: null,
    };

    expect(summaryRecordSchema.safeParse(base).success).toBe(false);
    expect(
      summaryRecordSchema.safeParse({
        ...base,
        status: "fresh",
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it("accepts summary context sources and typed rebuild jobs", () => {
    expect(
      contextSourceRefSchema.parse({
        sourceType: "summary",
        sourceId: ids.summary,
        label: "第一卷概要",
        citation: "第 1-8 章 · 摘要",
      }),
    ).toMatchObject({ sourceType: "summary" });

    const request = summaryRebuildRequestSchema.parse({});
    expect(request.levels).toEqual(["chapter", "stage", "volume", "book"]);

    const job = summaryRebuildJobSchema.parse({
      jobType: SUMMARY_REBUILD_JOB,
      runId: ids.summary,
      workId: ids.work,
      branchId: ids.branch,
      actorId: ids.actor,
      idempotencyKey: "rebuild-summaries",
    });
    expect(workerJobSchema.parse(job)).toEqual(job);
  });
});
