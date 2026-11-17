export type PublishPlatformPreset = "generic" | "qidian" | "fanqie";
export type PublishCheckStatus = "pass" | "warning" | "blocked";
export type PublishReadinessStatus = "ready" | "warning" | "blocked";
export type PublishGenre = "xianxia" | "history" | "urban";

export interface PublishMetadataInput {
  title?: string;
  author?: string;
  summary?: string;
  tags?: string[];
  coverHeadline?: string;
  coverSubline?: string;
  coverTone?: "cinnabar" | "jade" | "gold" | "blue";
  aiDisclosure?: boolean;
  copyrightAcknowledged?: boolean;
}

export interface ResolvedPublishMetadata {
  title: string;
  author: string;
  summary: string;
  tags: string[];
  genre: PublishGenre;
  coverHeadline: string;
  coverSubline: string;
  coverTone: "cinnabar" | "jade" | "gold" | "blue";
  aiDisclosure: boolean;
  copyrightAcknowledged: boolean;
}

export interface PublishChapterSource {
  chapterId: string;
  chapterNumber: number;
  title: string;
  chapterVersionId: string;
  versionNodeId: string;
  content: string;
  characterCount: number;
  volumeNodeId: string | null;
  volumeNumber: number | null;
  volumeTitle: string | null;
}

export interface PublishPreviewInput {
  platformPreset: PublishPlatformPreset;
  metadata: PublishMetadataInput;
  work: {
    id: string;
    title: string;
    penName: string;
    genre: PublishGenre;
  };
  export: {
    id: string;
    format: "txt" | "markdown" | "docx" | "epub";
    completed: boolean;
    manifestHash: string;
    sourceVersionNodeId: string;
    requestedVersionNodeId: string | null;
  };
  chapters: PublishChapterSource[];
  goldenThree: {
    locked: boolean;
    openingHookScore: number | null;
    chapterEndHookScore: number | null;
  };
}

export interface PublishCheckResult {
  code: string;
  label: string;
  status: PublishCheckStatus;
  message: string;
  ruleVersion: string;
  evidence: Array<{ label: string; value: string | number | boolean | null }>;
}

const PLATFORM_PRESETS = {
  generic: {
    label: "通用网文",
    minChapterCharacters: 2_000,
    maxChapterCharacters: 6_000,
    tagLimit: 10,
    chapterTitleFormat: "{number}. {title}",
  },
  qidian: {
    label: "起点中文网",
    minChapterCharacters: 2_000,
    maxChapterCharacters: 5_000,
    tagLimit: 10,
    chapterTitleFormat: "第{number}章 {title}",
  },
  fanqie: {
    label: "番茄小说",
    minChapterCharacters: 1_500,
    maxChapterCharacters: 4_000,
    tagLimit: 8,
    chapterTitleFormat: "第{number}章 {title}",
  },
} as const;

const GENRE_LABELS: Record<PublishGenre, string> = {
  xianxia: "仙侠",
  history: "历史",
  urban: "都市",
};

const CONTENT_REVIEW_TERMS = ["毒品制作", "儿童色情", "自杀方法"] as const;
const PUBLISH_RULE_VERSION = "publish-check-v1";

export function buildPublishPreview(input: PublishPreviewInput) {
  const platform = PLATFORM_PRESETS[input.platformPreset];
  const metadata = resolveMetadata(input.metadata, input.work);
  const chapters = [...input.chapters].sort(
    (left, right) => left.chapterNumber - right.chapterNumber,
  );
  const checks = buildChecks({ input, metadata, platform, chapters });
  const blocked = checks.some((check) => check.status === "blocked");
  const warning = checks.some((check) => check.status === "warning");
  const status: PublishReadinessStatus = blocked ? "blocked" : warning ? "warning" : "ready";
  return {
    status,
    publishReady: !blocked,
    platform: {
      key: input.platformPreset,
      label: platform.label,
      tagLimit: platform.tagLimit,
      minChapterCharacters: platform.minChapterCharacters,
      maxChapterCharacters: platform.maxChapterCharacters,
    },
    metadata,
    checks,
    catalog: buildCatalog(chapters),
    readerPreview: {
      title: metadata.title,
      author: metadata.author,
      summary: metadata.summary,
      tags: metadata.tags,
      chapters: chapters.slice(0, 3).map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        excerpt: excerpt(chapter.content, 500),
      })),
    },
    publishCopy: buildPublishCopy({
      metadata,
      platform,
      chapters,
    }),
  };
}

function buildChecks(input: {
  input: PublishPreviewInput;
  metadata: ResolvedPublishMetadata;
  platform: (typeof PLATFORM_PRESETS)[PublishPlatformKey];
  chapters: PublishChapterSource[];
}): PublishCheckResult[] {
  const { metadata, platform, chapters } = input;
  const openingScores = [
    input.input.goldenThree.openingHookScore,
    input.input.goldenThree.chapterEndHookScore,
  ];
  const hookPassed =
    input.input.goldenThree.locked &&
    openingScores.every((score) => typeof score === "number" && score >= 4);
  const reviewTerm = CONTENT_REVIEW_TERMS.find((term) =>
    chapters.some((chapter) => chapter.content.includes(term)),
  );
  return [
    check(
      "title_present",
      "书名完整",
      metadata.title.trim().length > 0 ? "pass" : "blocked",
      metadata.title.trim().length > 0 ? "书名已填写。" : "发布前必须填写书名。",
      [{ label: "书名", value: metadata.title }],
    ),
    check(
      "author_present",
      "作者笔名完整",
      metadata.author.trim().length > 0 ? "pass" : "blocked",
      metadata.author.trim().length > 0 ? "作者笔名已填写。" : "发布前必须填写作者笔名。",
      [{ label: "作者", value: metadata.author }],
    ),
    check(
      "summary_present",
      "简介完整",
      [...metadata.summary.trim()].length >= 10 ? "pass" : "blocked",
      [...metadata.summary.trim()].length >= 10
        ? "简介已达到可预览长度。"
        : "发布前至少需要 10 个字符的作品简介。",
      [{ label: "简介字符数", value: [...metadata.summary.trim()].length }],
    ),
    check(
      "tags_present",
      "标签完整",
      metadata.tags.length > 0 ? "pass" : "blocked",
      metadata.tags.length > 0 ? "已填写发布标签。" : "发布前至少需要一个标签。",
      [{ label: "标签数", value: metadata.tags.length }],
    ),
    check("genre_present", "题材完整", "pass", "题材已由作品设定确定。", [
      { label: "题材", value: GENRE_LABELS[metadata.genre] },
    ]),
    check(
      "cover_present",
      "封面元数据完整",
      metadata.coverHeadline.trim() && metadata.coverSubline.trim() ? "pass" : "blocked",
      metadata.coverHeadline.trim() && metadata.coverSubline.trim()
        ? "封面标题和副标题已填写。"
        : "发布前需要填写封面标题和副标题。",
      [
        { label: "封面标题", value: metadata.coverHeadline },
        { label: "封面副标题", value: metadata.coverSubline },
      ],
    ),
    check(
      "first_three_chapters_present",
      "前三章完整",
      chapters.length >= 3 ? "pass" : "blocked",
      chapters.length >= 3 ? "前三章已纳入预览。" : "发布检查至少需要前三章。",
      [{ label: "预览章节数", value: chapters.length }],
    ),
    check(
      "golden_three_hook",
      "前三章钩子",
      hookPassed ? "pass" : "warning",
      hookPassed ? "黄金三章钩子检查已通过。" : "黄金三章钩子检查尚未完成或未达标。",
      [
        { label: "已锁定", value: input.input.goldenThree.locked },
        { label: "开篇钩子", value: input.input.goldenThree.openingHookScore },
        { label: "章末钩子", value: input.input.goldenThree.chapterEndHookScore },
      ],
    ),
    check(
      "chapter_length",
      "章节字数",
      chapters
        .slice(0, 3)
        .every(
          (chapter) =>
            chapter.characterCount >= platform.minChapterCharacters &&
            chapter.characterCount <= platform.maxChapterCharacters,
        )
        ? "pass"
        : "warning",
      `平台建议单章 ${platform.minChapterCharacters}-${platform.maxChapterCharacters} 字符。`,
      [
        { label: "最小字符数", value: platform.minChapterCharacters },
        { label: "最大字符数", value: platform.maxChapterCharacters },
        {
          label: "前三章字符数",
          value: chapters
            .slice(0, 3)
            .map((chapter) => chapter.characterCount)
            .join(","),
        },
      ],
    ),
    check(
      "content_safety_review",
      "内容安全提示",
      reviewTerm ? "warning" : "pass",
      reviewTerm
        ? "预览中发现需要作者复核的安全提示，不会自动封禁。"
        : "未发现需要作者额外复核的内容安全提示。",
      [{ label: "复核提示", value: reviewTerm ?? null }],
    ),
    check(
      "ai_disclosure",
      "AI 生成内容标识",
      metadata.aiDisclosure ? "pass" : "warning",
      metadata.aiDisclosure ? "已确认需要保留 AI 生成内容说明。" : "尚未确认 AI 生成内容标识。",
      [{ label: "已确认", value: metadata.aiDisclosure }],
    ),
    check(
      "copyright_notice",
      "原创与版权提醒",
      metadata.copyrightAcknowledged ? "pass" : "warning",
      metadata.copyrightAcknowledged ? "已确认原创与版权提醒。" : "尚未确认原创与版权提醒。",
      [{ label: "已确认", value: metadata.copyrightAcknowledged }],
    ),
    check(
      "export_format",
      "导出格式",
      input.input.export.completed && /^[a-f0-9]{64}$/u.test(input.input.export.manifestHash)
        ? "pass"
        : "blocked",
      input.input.export.completed
        ? `已固定 ${input.input.export.format.toUpperCase()} 导出清单。`
        : "发布检查需要已完成的导出文件。",
      [
        { label: "格式", value: input.input.export.format },
        { label: "导出完成", value: input.input.export.completed },
        { label: "清单哈希", value: input.input.export.manifestHash },
      ],
    ),
  ];
}

type PublishPlatformKey = keyof typeof PLATFORM_PRESETS;

function check(
  code: string,
  label: string,
  status: PublishCheckStatus,
  message: string,
  evidence: PublishCheckResult["evidence"],
): PublishCheckResult {
  return { code, label, status, message, ruleVersion: PUBLISH_RULE_VERSION, evidence };
}

function resolveMetadata(
  metadata: PublishMetadataInput,
  work: PublishPreviewInput["work"],
): ResolvedPublishMetadata {
  return {
    title: metadata.title ?? work.title,
    author: metadata.author ?? work.penName,
    summary: metadata.summary ?? "",
    tags: uniqueStrings(metadata.tags ?? []),
    genre: work.genre,
    coverHeadline: metadata.coverHeadline ?? "",
    coverSubline: metadata.coverSubline ?? "",
    coverTone: metadata.coverTone ?? "cinnabar",
    aiDisclosure: metadata.aiDisclosure ?? false,
    copyrightAcknowledged: metadata.copyrightAcknowledged ?? false,
  };
}

function buildCatalog(chapters: PublishChapterSource[]) {
  const volumes = new Map<
    string,
    {
      volumeNodeId: string | null;
      volumeNumber: number | null;
      title: string;
      chapterNumbers: number[];
    }
  >();
  for (const chapter of chapters) {
    const key = chapter.volumeNodeId ?? "unassigned";
    const current = volumes.get(key) ?? {
      volumeNodeId: chapter.volumeNodeId,
      volumeNumber: chapter.volumeNumber,
      title: chapter.volumeTitle ?? "未分卷",
      chapterNumbers: [],
    };
    current.chapterNumbers.push(chapter.chapterNumber);
    volumes.set(key, current);
  }
  const visible = chapters.slice(0, 200);
  return {
    chapterCount: chapters.length,
    characterCount: chapters.reduce((total, chapter) => total + chapter.characterCount, 0),
    volumes: [...volumes.values()],
    chapters: visible.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      chapterVersionId: chapter.chapterVersionId,
      versionNodeId: chapter.versionNodeId,
      characterCount: chapter.characterCount,
      excerpt: excerpt(chapter.content, 120),
      volumeNodeId: chapter.volumeNodeId,
      volumeNumber: chapter.volumeNumber,
      volumeTitle: chapter.volumeTitle,
    })),
    truncated: visible.length < chapters.length,
  };
}

function buildPublishCopy(input: {
  metadata: ResolvedPublishMetadata;
  platform: (typeof PLATFORM_PRESETS)[PublishPlatformKey];
  chapters: PublishChapterSource[];
}) {
  const genreLabel = GENRE_LABELS[input.metadata.genre];
  const titleOptions = uniqueStrings([
    input.metadata.title,
    `${input.metadata.title}：${input.metadata.tags[0] ?? genreLabel}`,
    `${input.metadata.title}·${genreLabel}长篇`,
  ]).slice(0, 3);
  return {
    titleOptions,
    summary:
      input.metadata.summary.trim() ||
      `《${input.metadata.title}》是一部${genreLabel}长篇，等待作者补充发布简介。`,
    tags: uniqueStrings([...input.metadata.tags, genreLabel]).slice(0, input.platform.tagLimit),
    chapterTitleSuggestions: input.chapters
      .slice(0, 3)
      .map((chapter) =>
        formatTitle(input.platform.chapterTitleFormat, chapter.chapterNumber, chapter.title),
      ),
    platformNote: "仅生成发布预览和导出元数据，不会上传到第三方平台。",
  };
}

function formatTitle(format: string, number: number, title: string): string {
  return format.replaceAll("{number}", String(number)).replaceAll("{title}", title);
}

function excerpt(content: string, limit: number): string {
  const normalized = content.replaceAll(/\s+/gu, " ").trim();
  const characters = [...normalized];
  return characters.length <= limit ? normalized : `${characters.slice(0, limit).join("")}…`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
