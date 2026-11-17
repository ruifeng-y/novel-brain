import { describe, expect, it } from "vitest";

import { assessModeration } from "../src";

describe("moderation assessment", () => {
  it("keeps clear chapters clear while recording the rule version", () => {
    expect(
      assessModeration([
        {
          chapterId: "01910000-0000-7000-8000-000000000011",
          chapterNumber: 1,
          content: "山门在夜里关闭，沈砚听见有人叫出了他的旧名。",
        },
      ]),
    ).toEqual({
      status: "clear",
      ruleVersion: "content-safety-v1",
      evidence: [
        { label: "本地复核提示", value: null },
        { label: "涉及章节编号", value: null },
        { label: "检查范围", value: "本地内容安全提示" },
      ],
      matchedChapterIds: [],
    });
  });

  it("flags review terms without copying manuscript text into evidence", () => {
    const content = "这段正文包含毒品制作步骤，但证据不能保存整段正文。";
    const result = assessModeration([
      {
        chapterId: "01910000-0000-7000-8000-000000000011",
        chapterNumber: 7,
        content,
      },
    ]);

    expect(result.status).toBe("needs_review");
    expect(result.ruleVersion).toBe("content-safety-v1");
    expect(result.matchedChapterIds).toEqual(["01910000-0000-7000-8000-000000000011"]);
    expect(result.evidence).toEqual([
      { label: "本地复核提示", value: "毒品制作" },
      { label: "涉及章节编号", value: "7" },
      { label: "检查范围", value: "本地内容安全提示" },
    ]);
    expect(JSON.stringify(result.evidence)).not.toContain(content);
  });

  it("records every matched rule and chapter without duplicating evidence", () => {
    const result = assessModeration([
      {
        chapterId: "01910000-0000-7000-8000-000000000011",
        chapterNumber: 2,
        content: "这一章包含毒品制作和儿童色情提示。",
      },
      {
        chapterId: "01910000-0000-7000-8000-000000000012",
        chapterNumber: 3,
        content: "另一章也提到毒品制作。",
      },
    ]);

    expect(result.evidence).toEqual([
      { label: "本地复核提示", value: "毒品制作、儿童色情" },
      { label: "涉及章节编号", value: "2,3" },
      { label: "检查范围", value: "本地内容安全提示" },
    ]);
    expect(result.matchedChapterIds).toEqual([
      "01910000-0000-7000-8000-000000000011",
      "01910000-0000-7000-8000-000000000012",
    ]);
  });
});
