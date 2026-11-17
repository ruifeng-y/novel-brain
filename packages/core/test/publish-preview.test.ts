import { describe, expect, it } from "vitest";

import { buildPublishPreview } from "../src";

describe("publish preview", () => {
  it("blocks publish readiness on missing metadata while preserving warning severity", () => {
    const preview = buildPublishPreview({
      platformPreset: "qidian",
      metadata: {
        title: "忘川书",
        author: "林见鹿",
        summary: "",
        tags: [],
        coverHeadline: "",
        coverSubline: "",
        aiDisclosure: false,
        copyrightAcknowledged: false,
      },
      work: {
        id: "01910000-0000-7000-8000-000000000001",
        title: "忘川书",
        penName: "林见鹿",
        genre: "xianxia",
      },
      export: {
        id: "01910000-0000-7000-8000-000000000002",
        format: "txt",
        completed: true,
        manifestHash: "a".repeat(64),
        sourceVersionNodeId: "01910000-0000-7000-8000-000000000003",
        requestedVersionNodeId: null,
      },
      chapters: [
        publishChapter(1, "山门", "山门在夜里关闭，沈砚却听见门外有人叫出了他的旧名。"),
        publishChapter(2, "钟声", "钟声响了三次，每一声都让沈砚忘记一件往事。"),
        publishChapter(3, "旧名", "他在纸上写下自己的名字，墨迹却自行变成了另一个人的姓。"),
      ],
      goldenThree: {
        locked: false,
        openingHookScore: null,
        chapterEndHookScore: null,
      },
    });

    expect(preview.status).toBe("blocked");
    expect(preview.publishReady).toBe(false);
    expect(preview.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "summary_present", status: "blocked" }),
        expect.objectContaining({ code: "tags_present", status: "blocked" }),
        expect.objectContaining({ code: "cover_present", status: "blocked" }),
        expect.objectContaining({ code: "golden_three_hook", status: "warning" }),
        expect.objectContaining({ code: "ai_disclosure", status: "warning" }),
        expect.objectContaining({ code: "copyright_notice", status: "warning" }),
      ]),
    );
  });

  it("changes only presentation and preview copy when the platform preset changes", () => {
    const common = publishInput();
    const generic = buildPublishPreview({ ...common, platformPreset: "generic" });
    const fanqie = buildPublishPreview({ ...common, platformPreset: "fanqie" });

    expect(generic.catalog.chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3]);
    expect(generic.catalog.volumes).toEqual([
      expect.objectContaining({ title: "第一卷", chapterNumbers: [1, 2, 3] }),
    ]);
    expect(generic.readerPreview.chapters).toHaveLength(3);
    expect(generic.publishCopy.chapterTitleSuggestions[0]).toBe("1. 山门");
    expect(fanqie.publishCopy.chapterTitleSuggestions[0]).toBe("第1章 山门");
    expect(fanqie.publishCopy.platformNote).toContain("不会上传");
  });
});

function publishInput() {
  return {
    metadata: {
      title: "忘川书",
      author: "林见鹿",
      summary: "一个杂役追查自己被抹去的旧名，也追查一本会吞噬记忆的古书。",
      tags: ["仙侠", "记忆"],
      coverHeadline: "忘川书",
      coverSubline: "被抹去的名字",
      aiDisclosure: true,
      copyrightAcknowledged: true,
    },
    work: {
      id: "01910000-0000-7000-8000-000000000001",
      title: "忘川书",
      penName: "林见鹿",
      genre: "xianxia" as const,
    },
    export: {
      id: "01910000-0000-7000-8000-000000000002",
      format: "txt" as const,
      completed: true,
      manifestHash: "a".repeat(64),
      sourceVersionNodeId: "01910000-0000-7000-8000-000000000003",
      requestedVersionNodeId: null,
    },
    chapters: [
      publishChapter(1, "山门", "山门在夜里关闭，沈砚却听见门外有人叫出了他的旧名。"),
      publishChapter(2, "钟声", "钟声响了三次，每一声都让沈砚忘记一件往事。"),
      publishChapter(3, "旧名", "他在纸上写下自己的名字，墨迹却自行变成了另一个人的姓。"),
    ],
    goldenThree: {
      locked: true,
      openingHookScore: 5,
      chapterEndHookScore: 4,
    },
  };
}

function publishChapter(number: number, title: string, content: string) {
  return {
    chapterId: `01910000-0000-7000-8000-${String(number).padStart(12, "0")}`,
    chapterNumber: number,
    title,
    chapterVersionId: `01910000-0000-7001-8000-${String(number).padStart(12, "0")}`,
    versionNodeId: `01910000-0000-7002-8000-${String(number).padStart(12, "0")}`,
    content,
    characterCount: [...content].length,
    volumeNodeId: null,
    volumeNumber: 1,
    volumeTitle: "第一卷",
  };
}
