import type { ModerationCaseStatus, ModerationEvidence } from "@novel-brain/contracts";

export type ModerationStatus = Extract<ModerationCaseStatus, "clear" | "needs_review">;

export interface ModerationChapterSource {
  chapterId: string;
  chapterNumber: number;
  content: string;
}

export interface ModerationAssessment {
  status: ModerationStatus;
  ruleVersion: "content-safety-v1";
  evidence: ModerationEvidence[];
  matchedChapterIds: string[];
}

export const MODERATION_REVIEW_TERMS = ["毒品制作", "儿童色情", "自杀方法"] as const;

export function assessModeration(chapters: ModerationChapterSource[]): ModerationAssessment {
  const sorted = [...chapters].sort((left, right) => left.chapterNumber - right.chapterNumber);
  const matches = MODERATION_REVIEW_TERMS.map((term) => ({
    term,
    chapters: sorted.filter((chapter) => chapter.content.includes(term)),
  })).filter((match) => match.chapters.length > 0);
  const matchedByChapter = new Map<string, (typeof sorted)[number]>();
  for (const match of matches) {
    for (const chapter of match.chapters) {
      matchedByChapter.set(chapter.chapterId, chapter);
    }
  }
  const matched = [...matchedByChapter.values()].sort(
    (left, right) => left.chapterNumber - right.chapterNumber,
  );
  return {
    status: matches.length > 0 ? "needs_review" : "clear",
    ruleVersion: "content-safety-v1",
    evidence: [
      {
        label: "本地复核提示",
        value: matches.length > 0 ? matches.map((match) => match.term).join("、") : null,
      },
      {
        label: "涉及章节编号",
        value:
          matched.length > 0 ? matched.map((chapter) => chapter.chapterNumber).join(",") : null,
      },
      { label: "检查范围", value: "本地内容安全提示" },
    ],
    matchedChapterIds: matched.map((chapter) => chapter.chapterId),
  };
}
