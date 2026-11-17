import { describe, expect, it } from "vitest";

import {
  PUBLISH_PLATFORM_PRESETS,
  publishCheckRequestSchema,
  publishPreviewListQuerySchema,
  publishPreviewSchema,
} from "../src";

const exportId = "01910000-0000-7000-8000-000000000001";
const workId = "01910000-0000-7000-8000-000000000002";
const branchId = "01910000-0000-7000-8000-000000000003";
const sourceVersionNodeId = "01910000-0000-7000-8000-000000000004";

describe("publish preview contracts", () => {
  it("accepts all platform presets and optional publish metadata", () => {
    expect(PUBLISH_PLATFORM_PRESETS).toEqual(["generic", "qidian", "fanqie"]);
    expect(
      PUBLISH_PLATFORM_PRESETS.map((platformPreset) =>
        publishCheckRequestSchema.parse({
          exportId,
          platformPreset,
          metadata: {
            tags: ["仙侠"],
            aiDisclosure: true,
          },
        }),
      ),
    ).toHaveLength(3);
  });

  it("rejects unknown presets and unstable preview states", () => {
    expect(() =>
      publishCheckRequestSchema.parse({
        exportId,
        platformPreset: "unknown",
      }),
    ).toThrow();
    expect(() =>
      publishPreviewSchema.parse({
        ...previewFixture(),
        status: "pending",
      }),
    ).toThrow();
  });

  it("uses cursor pagination for pinned preview history", () => {
    expect(
      publishPreviewListQuerySchema.parse({
        limit: "20",
        cursor: sourceVersionNodeId,
      }),
    ).toEqual({
      limit: 20,
      cursor: sourceVersionNodeId,
    });
    expect(() => publishPreviewListQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

function previewFixture() {
  return {
    id: "01910000-0000-7000-8000-000000000005",
    exportId,
    workId,
    branchId,
    platformPreset: "generic",
    status: "warning",
    publishReady: true,
    stale: false,
    staleReason: null,
    sourceVersionNodeId,
    requestedVersionNodeId: null,
    manifestHash: "a".repeat(64),
    platform: {
      key: "generic",
      label: "通用网文",
      tagLimit: 10,
      minChapterCharacters: 2000,
      maxChapterCharacters: 6000,
    },
    metadata: {
      title: "忘川书",
      author: "林见鹿",
      summary: "一个杂役追查自己被抹去的旧名。",
      tags: ["仙侠"],
      genre: "xianxia",
      coverHeadline: "忘川书",
      coverSubline: "被抹去的名字",
      coverTone: "cinnabar",
      aiDisclosure: true,
      copyrightAcknowledged: true,
    },
    checks: [
      {
        code: "summary_present",
        label: "简介完整",
        status: "pass",
        message: "简介已达到可预览长度。",
        ruleVersion: "publish-check-v1",
        evidence: [{ label: "简介字符数", value: 18 }],
      },
    ],
    catalog: {
      chapterCount: 3,
      characterCount: 90,
      volumes: [
        {
          volumeNodeId: null,
          volumeNumber: 1,
          title: "第一卷",
          chapterNumbers: [1, 2, 3],
        },
      ],
      chapters: [],
      truncated: false,
    },
    readerPreview: {
      title: "忘川书",
      author: "林见鹿",
      summary: "一个杂役追查自己被抹去的旧名。",
      tags: ["仙侠"],
      chapters: [],
    },
    publishCopy: {
      titleOptions: ["忘川书"],
      summary: "一个杂役追查自己被抹去的旧名。",
      tags: ["仙侠"],
      chapterTitleSuggestions: [],
      platformNote: "仅生成发布预览和导出元数据，不会上传到第三方平台。",
    },
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
  };
}
