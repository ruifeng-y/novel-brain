import { describe, expect, it } from "vitest";

import {
  branchCreateRequestSchema,
  changeApplyRequestSchema,
  changeRequestCreateRequestSchema,
  chunkedImportCreateRequestSchema,
  mergeApplyRequestSchema,
  searchQuerySchema,
} from "../src";

describe("M2 change, search and chunked import contracts", () => {
  it("validates version-pinned changes and high-risk apply requests", () => {
    expect(
      changeRequestCreateRequestSchema.parse({
        title: "调整角色伤势",
        reason: "让后续战斗成立",
        targetVersion: 3,
        targetType: "entity",
        targetId: "01a1b4ed-6396-73e2-9c10-01530a818ed7",
        objectType: "entity",
        before: { bodyState: "左臂骨折" },
        after: { bodyState: "左臂恢复" },
        risk: "high",
        source: "author",
      }),
    ).toMatchObject({ risk: "high" });
    expect(
      changeApplyRequestSchema.parse({
        version: 2,
        expectedTargetVersion: 4,
        confirmHighRisk: true,
        reason: "作者确认",
      }),
    ).toMatchObject({ version: 2, confirmHighRisk: true });
  });

  it("validates branch comparison and per-object merge selection", () => {
    expect(
      branchCreateRequestSchema.parse({
        name: "what-if",
        sourceNodeId: "01a1b4ed-6396-73e2-9c10-01530a818ed7",
        reason: "验证另一条剧情线",
      }),
    ).toMatchObject({ name: "what-if" });
    expect(
      mergeApplyRequestSchema.parse({
        itemIds: ["01a1b4ed-6396-73e2-9c10-01530a818ed8"],
        expectedTargetHeadNodeId: "01a1b4ed-6396-73e2-9c10-01530a818ed9",
        confirmHighRisk: true,
      }),
    ).toMatchObject({ confirmHighRisk: true });
  });

  it("validates Chinese search and chunked import inputs", () => {
    expect(searchQuerySchema.parse({ q: "沈砚", limit: "20" })).toEqual({
      q: "沈砚",
      limit: 20,
    });
    expect(
      chunkedImportCreateRequestSchema.parse({
        sourceName: "大文件.txt",
        chunks: ["第一章", "第二章"],
      }),
    ).toMatchObject({ chunks: ["第一章", "第二章"] });
  });
});
