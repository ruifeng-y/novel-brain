"use client";

import {
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  FileCode2,
  FileText,
  FileType2,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  chapterWorkspaceListResponseSchema,
  chapterWorkspaceResponseSchema,
  moderationCaseListResponseSchema,
  moderationCaseResponseSchema,
  publishCheckRequestSchema,
  publishPreviewListResponseSchema,
  publishPreviewResponseSchema,
  workExportReceiptListResponseSchema,
  workExportReceiptResponseSchema,
  type ChapterWorkspace,
  type ModerationCase,
  type PublishCheck,
  type PublishMetadataInput,
  type PublishPlatformPreset,
  type PublishPreview,
  type WorkExportReceipt,
  type WorkExportRequest,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { fetchAllCursorPages } from "../lib/cursor-pagination";
import { fetchWorkOverview } from "../lib/work-api";

type ExportFormat = WorkExportRequest["format"];
type ExportScopeKind = WorkExportRequest["scope"]["kind"];
type ExportOptionToggleKey =
  | "includeStoryBible"
  | "includeSettingsAppendix"
  | "includeOutline"
  | "includeForeshadowLedger"
  | "includeChangeHistory";

interface MetadataForm {
  title: string;
  author: string;
  summary: string;
  tags: string;
  coverHeadline: string;
  coverSubline: string;
  coverTone: "cinnabar" | "jade" | "gold" | "blue";
  aiDisclosure: boolean;
  copyrightAcknowledged: boolean;
}

const formatOptions: Array<{
  value: ExportFormat;
  label: string;
  hint: string;
  icon: typeof FileText;
}> = [
  { value: "txt", label: "TXT", hint: "纯文本", icon: FileText },
  { value: "markdown", label: "Markdown", hint: "保留结构", icon: FileCode2 },
  { value: "docx", label: "DOCX", hint: "投稿格式", icon: FileType2 },
  { value: "epub", label: "EPUB", hint: "电子书", icon: BookOpen },
];

const scopeOptions: Array<{ value: ExportScopeKind; label: string }> = [
  { value: "current_chapter", label: "当前章" },
  { value: "selected_chapters", label: "选中章节" },
  { value: "chapter_range", label: "章节区间" },
  { value: "volume", label: "整卷" },
  { value: "book", label: "全本" },
];

const exportOptionToggles: Array<{ key: ExportOptionToggleKey; label: string }> = [
  { key: "includeStoryBible", label: "故事圣经" },
  { key: "includeSettingsAppendix", label: "设定附录" },
  { key: "includeOutline", label: "大纲" },
  { key: "includeForeshadowLedger", label: "伏笔账本" },
  { key: "includeChangeHistory", label: "修改记录" },
];

const presetLabels: Record<PublishPlatformPreset, string> = {
  generic: "通用网文",
  qidian: "起点中文网",
  fanqie: "番茄小说",
};

const genreLabels: Record<WorkOverview["genre"], string> = {
  xianxia: "仙侠",
  history: "历史",
  urban: "都市",
};

const exportStatusLabels: Record<WorkExportReceipt["status"], string> = {
  queued: "排队中",
  running: "生成中",
  completed: "可下载",
  failed: "失败",
  expired: "已过期",
};

export function ExportPublishWorkspace({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [chapters, setChapters] = useState<ChapterWorkspace[]>([]);
  const [exports, setExports] = useState<WorkExportReceipt[]>([]);
  const [selectedExportId, setSelectedExportId] = useState("");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [previewHistory, setPreviewHistory] = useState<PublishPreview[]>([]);
  const [moderationCases, setModerationCases] = useState<ModerationCase[]>([]);
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [scopeKind, setScopeKind] = useState<ExportScopeKind>("book");
  const [currentChapterId, setCurrentChapterId] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [volumeNodeId, setVolumeNodeId] = useState("");
  const [sourceVersionNodeId, setSourceVersionNodeId] = useState("");
  const [platformPreset, setPlatformPreset] = useState<PublishPlatformPreset>("generic");
  const [options, setOptions] = useState({
    includeStoryBible: true,
    includeSettingsAppendix: true,
    includeOutline: true,
    includeForeshadowLedger: true,
    includeChangeHistory: false,
    chapterTitleFormat: "第{number}章 {title}",
    volumeTitleFormat: "第{number}卷 {title}",
    paragraphBlankLine: true,
    firstLineIndent: false,
  });
  const [metadata, setMetadata] = useState<MetadataForm>({
    title: "",
    author: "",
    summary: "",
    tags: "",
    coverHeadline: "",
    coverSubline: "",
    coverTone: "cinnabar",
    aiDisclosure: true,
    copyrightAcknowledged: false,
  });
  const [expandedCheck, setExpandedCheck] = useState("");
  const [expandedCatalog, setExpandedCatalog] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [publishCopyExpanded, setPublishCopyExpanded] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [appealCorrection, setAppealCorrection] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"export" | "check" | "refresh" | "download" | "appeal" | "">("");
  const [error, setError] = useState("");
  const [partialError, setPartialError] = useState("");
  const [notice, setNotice] = useState("");
  const readerDialogRef = useRef<HTMLElement>(null);
  const readerReturnFocusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setLoading(true);
      }
      setError("");
      setPartialError("");
      setNotice("");
      let workData: WorkOverview;
      try {
        workData = await fetchWorkOverview(workId);
        setWork(workData);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "导出与发布页加载失败。");
        setLoading(false);
        return;
      }

      const branchPath = `/api/v1/works/${workId}/branches/${workData.mainBranch.id}`;
      const partialMessages: string[] = [];
      const [chapterResult, exportResult, previewResult, moderationResult] =
        await Promise.allSettled([
          fetchAllCursorPages(
            `${branchPath}/chapters`,
            chapterWorkspaceListResponseSchema.parse,
            "章节目录加载失败。",
          ),
          fetchAllCursorPages(
            `${branchPath}/exports`,
            parseExportReceiptPage,
            "导出历史加载失败。",
          ),
          fetch(`${branchPath}/publish-check`, { cache: "no-store" }).then(async (response) => {
            if (!response.ok) {
              throw new Error(await readError(response, "发布预览加载失败。"));
            }
            return publishPreviewListResponseSchema.parse(await response.json()).data;
          }),
          fetch(`${branchPath}/moderation-cases`, { cache: "no-store" }).then(async (response) => {
            if (!response.ok) {
              throw new Error(await readError(response, "内容安全记录加载失败。"));
            }
            return moderationCaseListResponseSchema.parse(await response.json()).data;
          }),
        ]);

      const chapterData = chapterResult.status === "fulfilled" ? chapterResult.value : [];
      if (chapterResult.status === "rejected") {
        partialMessages.push("章节目录暂不可用，当前只能使用全本范围。");
      }
      setChapters([...chapterData].sort((left, right) => left.number - right.number));
      if (chapterData.length > 0) {
        setCurrentChapterId((current) =>
          current && chapterData.some((chapter) => chapter.id === current)
            ? current
            : chapterData[0]!.id,
        );
        setSelectedChapterIds((current) =>
          current.length > 0 ? current : chapterData.slice(0, 3).map((chapter) => chapter.id),
        );
        setRangeStart((current) =>
          chapterData.some((chapter) => chapter.number === current)
            ? current
            : chapterData[0]!.number,
        );
        setRangeEnd((current) =>
          chapterData.some((chapter) => chapter.number === current)
            ? current
            : chapterData.at(-1)!.number,
        );
      }

      const exportData = exportResult.status === "fulfilled" ? exportResult.value : [];
      if (exportResult.status === "rejected") {
        partialMessages.push("导出历史暂不可用，请稍后刷新。");
      }
      setExports(exportData);
      const preferredExport =
        exportData.find(
          (receipt) =>
            receipt.status === "completed" && new Date(receipt.expiresAt).getTime() > Date.now(),
        ) ?? exportData[0];
      setSelectedExportId((current) =>
        current && exportData.some((receipt) => receipt.id === current)
          ? current
          : (preferredExport?.id ?? ""),
      );

      const previews = previewResult.status === "fulfilled" ? previewResult.value : [];
      if (previewResult.status === "rejected") {
        partialMessages.push("已有发布预览暂不可用，仍可重新运行检查。");
      }
      setPreviewHistory(previews);
      setPreview(
        previews.find((item) => item.exportId === preferredExport?.id) ?? previews[0] ?? null,
      );
      const cases = moderationResult.status === "fulfilled" ? moderationResult.value : [];
      if (moderationResult.status === "rejected") {
        partialMessages.push("内容安全与申诉记录暂不可用，请稍后刷新。");
      }
      setModerationCases(cases);
      setPartialError(partialMessages.join(" "));

      setMetadata((current) =>
        current.title
          ? current
          : {
              title: workData.title,
              author: workData.penName,
              summary: workData.idea?.trim() || "",
              tags: genreLabels[workData.genre],
              coverHeadline: workData.title,
              coverSubline: chapterData[0]?.title ?? "等待补充封面副标题",
              coverTone: "cinnabar",
              aiDisclosure: true,
              copyrightAcknowledged: false,
            },
      );
      setLoading(false);
    },
    [workId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!readerOpen) {
      return;
    }
    const dialog = readerDialogRef.current;
    const previousFocus = readerReturnFocusRef.current;
    const focusable = dialog
      ? [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ]
      : [];
    (focusable[0] ?? dialog)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setReaderOpen(false);
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [readerOpen]);

  const branchPath = work && `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  const selectedExport = exports.find((receipt) => receipt.id === selectedExportId) ?? null;
  const completedExports = exports.filter(
    (receipt) =>
      receipt.status === "completed" && new Date(receipt.expiresAt).getTime() > Date.now(),
  );
  const activeExport = isUsableReceipt(selectedExport) ? selectedExport : completedExports[0];
  const volumeChoices = collectVolumes(exports);
  const versionChoices = collectVersions(exports);
  const selectedPreview =
    preview?.exportId === activeExport?.id
      ? preview
      : (previewHistory.find((item) => item.exportId === activeExport?.id) ?? preview);
  const activeModerationCase = selectedPreview
    ? moderationCases.find((item) => item.publishPreviewId === selectedPreview.id)
    : undefined;
  const activeSubmittedAppeal = activeModerationCase?.appeals.find(
    (appeal) => appeal.status === "submitted",
  );
  const catalog = selectedPreview?.catalog ?? buildCatalogFallback(chapters);
  const visibleCatalogChapters = expandedCatalog ? catalog.chapters : catalog.chapters.slice(0, 5);
  const readerPreview = selectedPreview?.readerPreview ?? {
    title: metadata.title || work?.title || "未命名作品",
    author: metadata.author || work?.penName || "未填写作者",
    summary: metadata.summary || "完成一次导出后即可生成读者预览。",
    tags: splitTags(metadata.tags),
    chapters: chapters.slice(0, 3).map((chapter) => ({
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      title: chapter.title,
      excerpt: excerpt(chapter.currentVersion?.content ?? "", 240),
    })),
  };
  const currentCopyChapterId =
    selectedPreview?.catalog.chapters[0]?.chapterId ?? (currentChapterId || chapters[0]?.id);
  const pendingChecks = selectedPreview?.checks.filter((check) => check.status !== "pass") ?? [];
  const blockedChecks = selectedPreview?.checks.filter((check) => check.status === "blocked") ?? [];

  async function startExportAction() {
    if (!branchPath || busy) {
      return;
    }
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const request = buildExportRequest();
      const started = await createExport(branchPath, request);
      setSelectedExportId(started.id);
      setNotice("导出任务已创建，文件生成后可在这里下载。");
      const completed = await waitForExport(branchPath, started);
      if (completed.status === "completed") {
        setNotice("导出完成，已写入导出历史。");
      } else if (completed.status === "expired") {
        setError("导出文件已过期，请重新导出。");
      } else if (completed.status === "failed") {
        setError(completed.error?.message ?? "导出失败，请重试。");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  function buildExportRequest(): WorkExportRequest {
    let scope: WorkExportRequest["scope"];
    if (scopeKind === "current_chapter") {
      if (!currentChapterId) {
        throw new Error("请先选择要导出的章节。");
      }
      scope = { kind: "current_chapter", chapterId: currentChapterId };
    } else if (scopeKind === "selected_chapters") {
      if (selectedChapterIds.length === 0) {
        throw new Error("请至少选择一个章节。");
      }
      scope = { kind: "selected_chapters", chapterIds: selectedChapterIds };
    } else if (scopeKind === "chapter_range") {
      if (
        !Number.isInteger(rangeStart) ||
        !Number.isInteger(rangeEnd) ||
        rangeStart < 1 ||
        rangeEnd < rangeStart
      ) {
        throw new Error("章节区间无效，请检查起始和结束章节。");
      }
      scope = {
        kind: "chapter_range",
        fromChapter: rangeStart,
        toChapter: rangeEnd,
      };
    } else if (scopeKind === "volume") {
      if (!volumeNodeId) {
        throw new Error("请先完成一次全本导出，再选择要复用的卷。");
      }
      scope = { kind: "volume", volumeNodeId };
    } else {
      scope = { kind: "book" };
    }
    return {
      format,
      scope,
      sourceVersionNodeId: sourceVersionNodeId || null,
      options: {
        ...options,
        preset: platformPreset,
        encoding: "utf-8",
      },
    };
  }

  async function createExport(path: string, request: WorkExportRequest) {
    const response = await fetch(`${path}/exports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-csrf-token": await getCsrfToken(),
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(await readError(response, "创建导出任务失败。"));
    }
    const receipt = workExportReceiptResponseSchema.parse(await response.json()).data;
    setExports((current) => mergeReceipt(current, receipt));
    return receipt;
  }

  async function waitForExport(path: string, initial: WorkExportReceipt) {
    let current = initial;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (isTerminalReceipt(current)) {
        return current;
      }
      await delay(750);
      const response = await fetch(`${path}/exports/${current.id}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "导出状态加载失败。"));
      }
      current = workExportReceiptResponseSchema.parse(await response.json()).data;
      setExports((items) => mergeReceipt(items, current));
      if (current.id === selectedExportId) {
        setSelectedExportId(current.id);
      }
    }
    throw new Error("导出仍在后台生成，可稍后刷新导出历史。");
  }

  async function runPublishCheck(): Promise<PublishPreview | null> {
    if (!branchPath || busy !== "") {
      return null;
    }
    const target = activeExport ?? completedExports[0];
    if (!target) {
      setError("请先完成一次导出，再运行发布检查。");
      return null;
    }
    setBusy("check");
    setError("");
    setNotice("");
    try {
      const request = publishCheckRequestSchema.parse({
        exportId: target.id,
        platformPreset,
        metadata: toPublishMetadata(metadata),
      });
      const response = await fetch(`${branchPath}/publish-check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        if (response.status === 409 || response.status === 410) {
          await load(false);
        }
        throw new Error(await readError(response, "发布检查失败。"));
      }
      const created = publishPreviewResponseSchema.parse(await response.json()).data;
      setPreview(created);
      setPreviewHistory((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
      setSelectedExportId(created.exportId);
      await refreshModerationCases(branchPath).catch(() => {
        setPartialError("内容安全记录刷新失败，请稍后刷新页面。");
      });
      setNotice(
        created.publishReady
          ? "发布检查完成，可以继续核对发布文案。"
          : "发布检查完成，先处理阻断项再继续。",
      );
      return created;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布检查失败。");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function refreshModerationCases(path: string) {
    const response = await fetch(`${path}/moderation-cases`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response, "内容安全记录加载失败。"));
    }
    setModerationCases(moderationCaseListResponseSchema.parse(await response.json()).data);
  }

  async function submitAppeal() {
    if (!branchPath || !activeModerationCase || busy) {
      return;
    }
    setBusy("appeal");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${branchPath}/moderation-cases/${activeModerationCase.id}/appeals`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            reason: appealReason.trim(),
            ...(appealCorrection.trim() ? { correction: appealCorrection.trim() } : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "提交申诉失败。"));
      }
      const updated = moderationCaseResponseSchema.parse(await response.json()).data;
      setModerationCases((current) => [
        updated,
        ...current.filter((item) => item.id !== updated.id),
      ]);
      setAppealOpen(false);
      setAppealReason("");
      setAppealCorrection("");
      setNotice("申诉已提交，状态和证据已写入审计记录。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交申诉失败。");
    } finally {
      setBusy("");
    }
  }

  async function withdrawAppeal() {
    if (!branchPath || !activeModerationCase || !activeSubmittedAppeal || busy) {
      return;
    }
    setBusy("appeal");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${branchPath}/moderation-cases/${activeModerationCase.id}/appeals/${activeSubmittedAppeal.id}/withdraw`,
        {
          method: "POST",
          headers: { "x-csrf-token": await getCsrfToken() },
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "撤回申诉失败。"));
      }
      const updated = moderationCaseResponseSchema.parse(await response.json()).data;
      setModerationCases((current) => [
        updated,
        ...current.filter((item) => item.id !== updated.id),
      ]);
      setNotice("申诉已撤回，内容仍保持待复核状态。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤回申诉失败。");
    } finally {
      setBusy("");
    }
  }

  async function openReaderPreview() {
    readerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = selectedPreview ?? (await runPublishCheck());
    if (target) {
      setReaderOpen(true);
    }
  }

  async function generatePublishCopy() {
    const target = selectedPreview ?? (await runPublishCheck());
    if (!target) {
      return;
    }
    setPublishCopyExpanded(true);
    setNotice("发布文案已生成，可复制到发布平台。");
  }

  async function copyPublishCopy() {
    const target = selectedPreview ?? (await runPublishCheck());
    if (!target) {
      return;
    }
    const copy = target.publishCopy;
    await copyText(
      [
        `书名备选：${copy.titleOptions.join(" / ")}`,
        `简介：${copy.summary}`,
        `标签：${copy.tags.join("、")}`,
        `章节名建议：${copy.chapterTitleSuggestions.join(" / ")}`,
        ...(copy.aiDisclosureMetadata?.required
          ? [`AI 内容说明：${copy.aiDisclosureMetadata.label}`]
          : []),
        copy.platformNote,
      ].join("\n"),
    );
    setPublishCopyExpanded(true);
    setNotice("发布文案已复制到剪贴板。");
  }

  async function downloadExport(receipt: WorkExportReceipt) {
    if (!branchPath || busy) {
      return;
    }
    setBusy("download");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${branchPath}/exports/${receipt.id}/download`);
      if (!response.ok) {
        throw new Error(await readError(response, "下载导出文件失败。"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = receipt.fileName ?? `${work?.title ?? "作品"}_导出文件`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("导出文件已开始下载。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下载导出文件失败。");
    } finally {
      setBusy("");
    }
  }

  async function reuseExport(receipt: WorkExportReceipt) {
    if (!branchPath || busy) {
      return;
    }
    const receiptManifest = receipt.manifest;
    if (!receiptManifest) {
      setError("该导出记录缺少版本清单，无法复用设置。");
      return;
    }
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const started = await createExport(branchPath, {
        format: receipt.format,
        scope: receiptManifest.scope,
        sourceVersionNodeId: receiptManifest.branch.requestedVersionNodeId,
        options: receiptManifest.options,
      });
      setSelectedExportId(started.id);
      const completed = await waitForExport(branchPath, started);
      if (completed.status === "completed") {
        setNotice("已按原设置重新导出。");
      } else if (completed.status === "failed") {
        setError(completed.error?.message ?? "重新导出失败。");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新导出失败。");
    } finally {
      setBusy("");
    }
  }

  async function copyCurrentChapter() {
    if (!branchPath || !currentCopyChapterId) {
      setError("当前导出中没有可复制的章节。");
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${branchPath}/chapters/${currentCopyChapterId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "章节正文加载失败。"));
      }
      const chapter = chapterWorkspaceResponseSchema.parse(await response.json()).data;
      if (!chapter.currentVersion?.content.trim()) {
        throw new Error("当前章节还没有正文。");
      }
      await copyText(chapter.currentVersion.content);
      setNotice(`已复制第 ${chapter.number} 章正文。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "章节正文复制失败。");
    }
  }

  function updateMetadata<Key extends keyof MetadataForm>(key: Key, value: MetadataForm[Key]) {
    setMetadata((current) => ({ ...current, [key]: value }));
  }

  function refreshHistory() {
    setBusy("refresh");
    void load(false).finally(() => setBusy(""));
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载导出与发布">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载导出与发布
      </section>
    );
  }

  if (error && !work) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error}</span>
        <button className="text-btn small" onClick={() => void load()} type="button">
          重试
        </button>
      </section>
    );
  }

  if (!work) {
    return null;
  }

  return (
    <section className="export-publish-page" aria-labelledby="export-publish-title">
      <div className="page-head">
        <div>
          <p className="eyebrow">导出与发布</p>
          <h1 id="export-publish-title">把故事带出去</h1>
          <p className="page-sub">导出正文、设定和版本记录；发布前先做完检查。</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => void openReaderPreview()} type="button">
            <Eye size={15} aria-hidden="true" />
            读者预览
          </button>
          <button
            className="btn btn-primary"
            disabled={busy !== ""}
            onClick={() => void startExportAction()}
            type="button"
          >
            {busy === "export" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Download size={15} aria-hidden="true" />
            )}
            {busy === "export" ? "正在导出" : "开始导出"}
          </button>
        </div>
      </div>

      {partialError ? (
        <div className="export-inline-note warning" role="status">
          <Info size={16} aria-hidden="true" />
          <span>{partialError}</span>
          <button className="text-btn small" onClick={refreshHistory} type="button">
            刷新
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="export-inline-note danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
          <button className="text-btn small" onClick={() => setError("")} type="button">
            关闭
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="export-inline-note success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="export-layout">
        <section className="panel export-form-panel" aria-labelledby="export-settings-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">导出设置</span>
              <h2 id="export-settings-title">选择范围和格式</h2>
            </div>
            <span className="badge">UTF-8</span>
          </div>

          <fieldset className="export-fieldset">
            <legend className="field-label">导出范围</legend>
            <div className="export-scope-segments">
              {scopeOptions.map((option) => (
                <button
                  aria-pressed={scopeKind === option.value}
                  className={`seg${scopeKind === option.value ? " active" : ""}`}
                  disabled={option.value === "volume" && volumeChoices.length === 0}
                  key={option.value}
                  onClick={() => setScopeKind(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="export-scope-fields">
            {scopeKind === "current_chapter" ? (
              <label className="export-field">
                <span className="field-label">当前章</span>
                <select
                  className="select"
                  onChange={(event) => setCurrentChapterId(event.target.value)}
                  value={currentChapterId}
                >
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      第 {chapter.number} 章 · {chapter.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {scopeKind === "selected_chapters" ? (
              <fieldset className="export-chapter-picker">
                <legend className="field-label">选择章节</legend>
                <div className="export-chapter-picker-list">
                  {chapters.map((chapter) => (
                    <label className="export-check-row" key={chapter.id}>
                      <input
                        checked={selectedChapterIds.includes(chapter.id)}
                        onChange={(event) =>
                          setSelectedChapterIds((current) =>
                            event.target.checked
                              ? [...current, chapter.id]
                              : current.filter((id) => id !== chapter.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        第 {chapter.number} 章 · {chapter.title}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {scopeKind === "chapter_range" ? (
              <div className="two-col-fields">
                <label className="export-field">
                  <span className="field-label">起始章</span>
                  <input
                    className="input"
                    min={1}
                    onChange={(event) => setRangeStart(Number(event.target.value))}
                    type="number"
                    value={rangeStart}
                  />
                </label>
                <label className="export-field">
                  <span className="field-label">结束章</span>
                  <input
                    className="input"
                    min={rangeStart}
                    onChange={(event) => setRangeEnd(Number(event.target.value))}
                    type="number"
                    value={rangeEnd}
                  />
                </label>
              </div>
            ) : null}
            {scopeKind === "volume" ? (
              <label className="export-field">
                <span className="field-label">整卷</span>
                <select
                  className="select"
                  onChange={(event) => setVolumeNodeId(event.target.value)}
                  value={volumeNodeId}
                >
                  <option value="">选择已导出的卷</option>
                  {volumeChoices.map((volume) => (
                    <option key={volume.id} value={volume.id}>
                      {volume.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {scopeKind === "book" ? (
              <p className="export-scope-summary">
                将导出当前创作线的全部 {chapters.length.toLocaleString("zh-CN")} 个章节。
              </p>
            ) : null}
          </div>

          <fieldset className="export-fieldset">
            <legend className="field-label">文件格式</legend>
            <div className="format-grid">
              {formatOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    aria-pressed={format === option.value}
                    className={`format-card${format === option.value ? " active" : ""}`}
                    key={option.value}
                    onClick={() => setFormat(option.value)}
                    type="button"
                  >
                    <Icon size={18} aria-hidden="true" />
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="two-col-fields export-select-grid">
            <label className="export-field">
              <span className="field-label">平台预设</span>
              <select
                className="select"
                onChange={(event) => setPlatformPreset(event.target.value as PublishPlatformPreset)}
                value={platformPreset}
              >
                {Object.entries(presetLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="export-field">
              <span className="field-label">章节标题格式</span>
              <select
                className="select"
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    chapterTitleFormat: event.target.value,
                  }))
                }
                value={options.chapterTitleFormat}
              >
                <option value="第{number}章 {title}">第 1 章 章节名</option>
                <option value="{number}. {title}">1. 章节名</option>
                <option value="第{number}章 · {title}">第 1 章 · 章节名</option>
              </select>
            </label>
          </div>
          <div className="two-col-fields export-select-grid">
            <label className="export-field">
              <span className="field-label">卷标题格式</span>
              <select
                className="select"
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    volumeTitleFormat: event.target.value,
                  }))
                }
                value={options.volumeTitleFormat}
              >
                <option value="第{number}卷 {title}">第 1 卷 卷名</option>
                <option value="{number}. {title}">1. 卷名</option>
                <option value="{title}">{"{title}"}</option>
              </select>
            </label>
            <label className="export-field">
              <span className="field-label">历史版本</span>
              <select
                className="select"
                onChange={(event) => setSourceVersionNodeId(event.target.value)}
                value={sourceVersionNodeId}
              >
                <option value="">当前创作线版本</option>
                {versionChoices.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="export-fieldset">
            <legend className="field-label">附带内容</legend>
            <div className="export-check-grid">
              {exportOptionToggles.map((option) => (
                <label className="export-check-row" key={option.key}>
                  <input
                    checked={options[option.key]}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        [option.key]: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              <label className="export-check-row">
                <input checked disabled type="checkbox" />
                <span>版本清单</span>
              </label>
            </div>
          </fieldset>

          <div className="two-col-fields export-select-grid">
            <label className="export-field">
              <span className="field-label">首行缩进</span>
              <select
                className="select"
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    firstLineIndent: event.target.value === "indent",
                  }))
                }
                value={options.firstLineIndent ? "indent" : "none"}
              >
                <option value="indent">两个全角空格</option>
                <option value="none">不缩进</option>
              </select>
            </label>
            <label className="export-field">
              <span className="field-label">段落空行</span>
              <select
                className="select"
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    paragraphBlankLine: event.target.value === "blank",
                  }))
                }
                value={options.paragraphBlankLine ? "blank" : "compact"}
              >
                <option value="blank">段间空一行</option>
                <option value="compact">不空行</option>
              </select>
            </label>
          </div>

          <div className="settings-note">
            <Info size={15} aria-hidden="true" />
            <span>大文件会进入后台任务；完成后可在导出历史重新下载，文件保留 7 天。</span>
          </div>
        </section>

        <aside className="panel export-preview-panel" aria-labelledby="export-catalog-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">目录预览</span>
              <h2 id="export-catalog-title">{work.title}</h2>
            </div>
            <span className="badge">{catalog.volumes[0]?.title ?? "当前作品"}</span>
          </div>
          <div className="export-book-preview">
            <div className={`export-cover export-cover-${metadata.coverTone}`}>
              <span>
                {catalog.volumes[0]?.volumeNumber
                  ? `卷 ${catalog.volumes[0].volumeNumber}`
                  : "作品"}
              </span>
              <strong>{metadata.coverHeadline || work.title}</strong>
              <em>{metadata.coverSubline || "等待补充封面副标题"}</em>
            </div>
            <div className="export-book-meta">
              <strong>{work.title}</strong>
              <small>
                {work.penName} · {genreLabels[work.genre]} · 约{" "}
                {catalog.characterCount.toLocaleString("zh-CN")} 字
              </small>
              <small>
                {catalog.volumes.length > 0
                  ? `${catalog.volumes.length} 卷 · ${catalog.chapterCount} 章`
                  : `${catalog.chapterCount} 章`}
              </small>
            </div>
          </div>
          <div className="export-toc" data-expanded={expandedCatalog}>
            {visibleCatalogChapters.length > 0 ? (
              visibleCatalogChapters.map((chapter) => (
                <div key={chapter.chapterId}>
                  <span>第 {chapter.chapterNumber} 章</span>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.characterCount.toLocaleString("zh-CN")} 字</small>
                </div>
              ))
            ) : (
              <div className="export-toc-empty">还没有可预览的章节。</div>
            )}
          </div>
          {catalog.truncated && !expandedCatalog ? (
            <p className="export-catalog-note">
              目录较长，当前仅显示前 {catalog.chapters.length} 章。
            </p>
          ) : null}
          <div className="export-excerpt">
            <span>正文预览</span>
            <p>
              {visibleCatalogChapters[0]?.excerpt || "完成章节正文后，这里会显示发布前的读者预览。"}
            </p>
          </div>
          <button
            className="btn btn-ghost export-block-btn"
            onClick={() => setExpandedCatalog((current) => !current)}
            type="button"
          >
            <BookOpen size={15} aria-hidden="true" />
            {expandedCatalog ? "收起目录" : "查看完整目录"}
          </button>
          <button
            className="btn btn-ghost export-block-btn"
            onClick={() => void copyCurrentChapter()}
            type="button"
          >
            <Clipboard size={15} aria-hidden="true" />
            复制当前章
          </button>
        </aside>
      </div>

      <div className="export-bottom-grid">
        <section className="panel export-history-panel" aria-labelledby="export-history-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">导出历史</span>
              <h2 id="export-history-title">最近生成的文件</h2>
            </div>
            <button
              className="text-btn small"
              disabled={busy !== ""}
              onClick={refreshHistory}
              type="button"
            >
              <RefreshCw className={busy === "refresh" ? "spin" : ""} size={13} />
              刷新
            </button>
          </div>
          <div className="export-history-list">
            {exports.length > 0 ? (
              exports.slice(0, 12).map((receipt) => {
                const receiptExpired =
                  receipt.status === "completed" &&
                  new Date(receipt.expiresAt).getTime() <= Date.now();
                const displayStatus = receiptExpired ? "expired" : receipt.status;
                return (
                  <div
                    className={`export-history-row export-history-${displayStatus}`}
                    data-export-id={receipt.id}
                    key={receipt.id}
                  >
                    <label className="export-history-select">
                      <input
                        aria-label={`选择 ${receipt.fileName ?? formatLabel(receipt.format)} 作为当前导出`}
                        checked={selectedExportId === receipt.id}
                        onChange={() => {
                          setSelectedExportId(receipt.id);
                          setPreview(
                            previewHistory.find((item) => item.exportId === receipt.id) ??
                              (preview?.exportId === receipt.id ? preview : null),
                          );
                        }}
                        type="radio"
                      />
                    </label>
                    <FormatIcon format={receipt.format} />
                    <div>
                      <strong>
                        {receipt.fileName ?? `${work.title}_${formatLabel(receipt.format)}`}
                      </strong>
                      <small>
                        {formatDateTime(receipt.createdAt)} ·{" "}
                        {receipt.byteSize === null ? "等待生成" : formatBytes(receipt.byteSize)} ·{" "}
                        {receipt.status === "completed" && !receiptExpired
                          ? expiryLabel(receipt.expiresAt)
                          : exportStatusLabels[displayStatus]}
                      </small>
                      {receipt.error ? <small>{receipt.error.message}</small> : null}
                    </div>
                    {receipt.status === "completed" && !receiptExpired ? (
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={busy !== ""}
                        onClick={() => void downloadExport(receipt)}
                        type="button"
                      >
                        下载
                      </button>
                    ) : displayStatus === "expired" || displayStatus === "failed" ? (
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={busy !== ""}
                        onClick={() => void reuseExport(receipt)}
                        type="button"
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                        重新导出
                      </button>
                    ) : (
                      <span className={`export-status export-status-${displayStatus}`}>
                        {exportStatusLabels[displayStatus]}
                      </span>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="export-empty-state">
                还没有导出记录。选择范围和格式后即可生成第一份文件。
              </div>
            )}
          </div>
        </section>

        <section className="panel publish-check-panel" aria-labelledby="publish-check-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">发布检查</span>
              <h2 id="publish-check-title">上传平台之前</h2>
            </div>
            <span className={`badge ${readinessBadgeClass(selectedPreview)}`}>
              {selectedPreview
                ? selectedPreview.status === "ready"
                  ? "可以发布"
                  : `${pendingChecks.length} 项待处理`
                : "等待检查"}
            </span>
          </div>

          <div className="publish-check-list">
            {selectedPreview ? (
              selectedPreview.checks.map((check) => (
                <div className={`publish-check ${check.status}`} key={check.code}>
                  <CheckIcon status={check.status} />
                  <button
                    className="publish-check-copy"
                    onClick={() =>
                      setExpandedCheck((current) => (current === check.code ? "" : check.code))
                    }
                    type="button"
                  >
                    <strong>{check.label}</strong>
                    <small>{check.message}</small>
                    {expandedCheck === check.code ? (
                      <span className="publish-check-evidence">
                        {check.evidence.map((evidence) => (
                          <span key={`${check.code}:${evidence.label}`}>
                            <span>{evidence.label}</span>
                            <strong>{evidenceValue(evidence.value)}</strong>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                </div>
              ))
            ) : (
              <div className="export-empty-state">
                完成一次导出后，运行发布检查以查看书名、标签、钩子、字数和格式结果。
              </div>
            )}
          </div>

          {selectedPreview?.stale ? (
            <div className="export-inline-note warning compact" role="status">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>{selectedPreview.staleReason}</span>
            </div>
          ) : null}
          {selectedPreview ? (
            <div className="publish-readiness-summary">
              <ShieldAlert size={15} aria-hidden="true" />
              <span>
                {blockedChecks.length > 0
                  ? `${blockedChecks.length} 个阻断项，修复后需要重新运行检查。`
                  : selectedPreview.publishReady
                    ? "没有阻断项；提醒项可由作者复核后保留。"
                    : "当前预览不可发布。"}
              </span>
            </div>
          ) : null}
          <div className="export-button-row">
            <button
              className="btn btn-ghost"
              disabled={busy !== ""}
              onClick={() => void generatePublishCopy()}
              type="button"
            >
              <Sparkles size={15} aria-hidden="true" />
              生成发布文案
            </button>
            <button
              className="btn btn-primary"
              disabled={busy !== "" || !activeExport}
              onClick={() => void runPublishCheck()}
              type="button"
            >
              {busy === "check" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <ShieldCheck size={15} aria-hidden="true" />
              )}
              {busy === "check" ? "正在检查" : "重新检查"}
            </button>
          </div>

          {selectedPreview && publishCopyExpanded ? (
            <div className="publish-copy-card">
              <div>
                <span className="panel-kicker">发布文案</span>
                <strong>{selectedPreview.publishCopy.titleOptions[0]}</strong>
              </div>
              <p>{selectedPreview.publishCopy.summary}</p>
              {selectedPreview.publishCopy.aiDisclosureMetadata?.required ? (
                <div className="publish-copy-disclosure">
                  <Sparkles size={14} aria-hidden="true" />
                  <span>{selectedPreview.publishCopy.aiDisclosureMetadata.label}</span>
                </div>
              ) : null}
              <div className="publish-copy-tags">
                {selectedPreview.publishCopy.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <button
                className="text-btn small"
                onClick={() => void copyPublishCopy()}
                type="button"
              >
                <Clipboard size={13} aria-hidden="true" />
                复制文案
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {selectedPreview && activeModerationCase ? (
        <section className="panel moderation-panel" aria-labelledby="moderation-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">内容安全与申诉</span>
              <h2 id="moderation-title">规则依据与处理记录</h2>
            </div>
            <span className={`badge ${moderationBadgeClass(activeModerationCase.status)}`}>
              {moderationStatusLabel(activeModerationCase.status)}
            </span>
          </div>

          <div className="moderation-summary">
            <ShieldAlert size={20} aria-hidden="true" />
            <div>
              <strong>
                {activeModerationCase.status === "clear"
                  ? "本地规则未发现需要处理的提示"
                  : activeModerationCase.status === "appeal_submitted"
                    ? "申诉或纠正说明已提交"
                    : "发现需要作者复核的提示"}
              </strong>
              <span>
                规则版本 {activeModerationCase.ruleVersion} · 记录时间{" "}
                {formatDateTime(activeModerationCase.createdAt)}
              </span>
            </div>
          </div>

          <div className="moderation-evidence" aria-label="内容安全证据">
            {activeModerationCase.evidence.map((evidence) => (
              <div key={evidence.label}>
                <span>{evidence.label}</span>
                <strong>{evidenceValue(evidence.value)}</strong>
              </div>
            ))}
          </div>

          {activeModerationCase.status === "clear" ? (
            <p className="moderation-guidance">
              本地提示不等同于平台审核结论。正式发布前仍需按目标平台规则复核。
            </p>
          ) : null}

          {activeModerationCase.status === "needs_review" ? (
            <div className="moderation-actions">
              {appealOpen ? (
                <form
                  className="moderation-appeal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAppeal();
                  }}
                >
                  <label className="export-field">
                    <span className="field-label">申诉或纠正说明</span>
                    <textarea
                      className="input"
                      maxLength={2000}
                      minLength={10}
                      onChange={(event) => setAppealReason(event.target.value)}
                      placeholder="说明已经修正的内容，或为什么这条提示需要人工复核。"
                      required
                      rows={4}
                      value={appealReason}
                    />
                  </label>
                  <label className="export-field">
                    <span className="field-label">修正内容（可选）</span>
                    <textarea
                      className="input"
                      maxLength={4000}
                      onChange={(event) => setAppealCorrection(event.target.value)}
                      placeholder="记录删除、改写或重新核对的具体位置。"
                      rows={3}
                      value={appealCorrection}
                    />
                  </label>
                  <div className="export-button-row">
                    <button
                      className="btn btn-ghost"
                      onClick={() => setAppealOpen(false)}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy !== "" || appealReason.trim().length < 10}
                      type="submit"
                    >
                      {busy === "appeal" ? (
                        <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <ShieldCheck size={15} aria-hidden="true" />
                      )}
                      提交申诉
                    </button>
                  </div>
                </form>
              ) : (
                <button className="btn btn-ghost" onClick={() => setAppealOpen(true)} type="button">
                  <ShieldAlert size={15} aria-hidden="true" />
                  提交申诉或纠正说明
                </button>
              )}
            </div>
          ) : null}

          {activeModerationCase.status === "appeal_submitted" && activeSubmittedAppeal ? (
            <div className="moderation-submitted">
              <div>
                <strong>已提交说明</strong>
                <p>{activeSubmittedAppeal.reason}</p>
                {activeSubmittedAppeal.correction ? (
                  <p>{activeSubmittedAppeal.correction}</p>
                ) : null}
              </div>
              <button
                className="btn btn-ghost btn-small"
                disabled={busy !== ""}
                onClick={() => void withdrawAppeal()}
                type="button"
              >
                撤回申诉
              </button>
            </div>
          ) : null}

          <details className="moderation-history">
            <summary>查看状态记录（{activeModerationCase.events.length}）</summary>
            <ol>
              {activeModerationCase.events.map((event) => (
                <li key={event.id}>
                  <strong>{moderationEventLabel(event.type)}</strong>
                  <span>{moderationStatusLabel(event.toStatus)}</span>
                  <small>{formatDateTime(event.createdAt)}</small>
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}

      <section className="panel export-metadata-panel" aria-labelledby="publish-metadata-title">
        <details>
          <summary>
            <span>
              <span className="panel-kicker">发布信息</span>
              <strong id="publish-metadata-title">编辑书名、简介、标签与封面元数据</strong>
            </span>
            <span className="badge">{presetLabels[platformPreset]}</span>
          </summary>
          <div className="export-metadata-grid">
            <label className="export-field">
              <span className="field-label">书名</span>
              <input
                className="input"
                maxLength={120}
                onChange={(event) => updateMetadata("title", event.target.value)}
                value={metadata.title}
              />
            </label>
            <label className="export-field">
              <span className="field-label">作者笔名</span>
              <input
                className="input"
                maxLength={50}
                onChange={(event) => updateMetadata("author", event.target.value)}
                value={metadata.author}
              />
            </label>
            <label className="export-field export-field-wide">
              <span className="field-label">作品简介</span>
              <textarea
                className="input"
                maxLength={2000}
                onChange={(event) => updateMetadata("summary", event.target.value)}
                rows={4}
                value={metadata.summary}
              />
            </label>
            <label className="export-field">
              <span className="field-label">标签</span>
              <input
                className="input"
                onChange={(event) => updateMetadata("tags", event.target.value)}
                placeholder="仙侠、记忆代价"
                value={metadata.tags}
              />
            </label>
            <label className="export-field">
              <span className="field-label">封面色调</span>
              <select
                className="select"
                onChange={(event) =>
                  updateMetadata("coverTone", event.target.value as MetadataForm["coverTone"])
                }
                value={metadata.coverTone}
              >
                <option value="cinnabar">朱砂</option>
                <option value="jade">青玉</option>
                <option value="gold">鎏金</option>
                <option value="blue">靛蓝</option>
              </select>
            </label>
            <label className="export-field">
              <span className="field-label">封面标题</span>
              <input
                className="input"
                maxLength={60}
                onChange={(event) => updateMetadata("coverHeadline", event.target.value)}
                value={metadata.coverHeadline}
              />
            </label>
            <label className="export-field">
              <span className="field-label">封面副标题</span>
              <input
                className="input"
                maxLength={100}
                onChange={(event) => updateMetadata("coverSubline", event.target.value)}
                value={metadata.coverSubline}
              />
            </label>
            <label className="export-confirm-row">
              <input
                checked={metadata.aiDisclosure}
                onChange={(event) => updateMetadata("aiDisclosure", event.target.checked)}
                type="checkbox"
              />
              <span>发布页保留 AI 辅助生成说明</span>
            </label>
            <label className="export-confirm-row">
              <input
                checked={metadata.copyrightAcknowledged}
                onChange={(event) => updateMetadata("copyrightAcknowledged", event.target.checked)}
                type="checkbox"
              />
              <span>已阅读原创与版权提醒，作品版权归作者所有</span>
            </label>
          </div>
          <div className="export-metadata-actions">
            <span>修改后会生成一份新的发布预览，不覆盖已有检查记录。</span>
            <button
              className="btn btn-primary"
              disabled={busy !== "" || !activeExport}
              onClick={() => void runPublishCheck()}
              type="button"
            >
              <ShieldCheck size={15} aria-hidden="true" />
              应用并重新检查
            </button>
          </div>
        </details>
      </section>

      {readerOpen ? (
        <div
          className="export-reader-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setReaderOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="reader-preview-title"
            aria-modal="true"
            className="export-reader-modal"
            ref={readerDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="export-reader-head">
              <div>
                <span className="panel-kicker">读者预览</span>
                <h2 id="reader-preview-title">{readerPreview.title}</h2>
                <p>{readerPreview.author}</p>
              </div>
              <button
                aria-label="关闭读者预览"
                className="icon-btn small"
                onClick={() => setReaderOpen(false)}
                type="button"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="export-reader-tags">
              {readerPreview.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <p className="export-reader-summary">{readerPreview.summary}</p>
            <div className="export-reader-chapters">
              {readerPreview.chapters.map((chapter) => (
                <article key={chapter.chapterId}>
                  <span>第 {chapter.chapterNumber} 章</span>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.excerpt}</p>
                </article>
              ))}
            </div>
            <div className="export-reader-foot">
              <span>{selectedPreview?.publishCopy.platformNote}</span>
              <button className="btn btn-ghost" onClick={() => setReaderOpen(false)} type="button">
                返回编辑
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function FormatIcon({ format }: { format: ExportFormat }) {
  const option = formatOptions.find((item) => item.value === format) ?? formatOptions[0]!;
  const Icon = option.icon;
  return <Icon size={17} aria-hidden="true" />;
}

function CheckIcon({ status }: { status: PublishCheck["status"] }) {
  if (status === "blocked") {
    return <X size={15} aria-hidden="true" />;
  }
  if (status === "warning") {
    return <TriangleAlert size={15} aria-hidden="true" />;
  }
  return <Check size={15} aria-hidden="true" />;
}

function isTerminalReceipt(receipt: WorkExportReceipt): boolean {
  return ["completed", "failed", "expired"].includes(receipt.status);
}

function isUsableReceipt(receipt: WorkExportReceipt | null): receipt is WorkExportReceipt {
  return Boolean(
    receipt && receipt.status === "completed" && new Date(receipt.expiresAt).getTime() > Date.now(),
  );
}

function mergeReceipt(
  receipts: WorkExportReceipt[],
  receipt: WorkExportReceipt,
): WorkExportReceipt[] {
  return [receipt, ...receipts.filter((item) => item.id !== receipt.id)].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function collectVolumes(receipts: WorkExportReceipt[]): Array<{ id: string; label: string }> {
  const volumes = new Map<string, { id: string; label: string }>();
  for (const receipt of receipts) {
    for (const volume of receipt.manifest?.chapters ?? []) {
      if (volume.volumeNodeId) {
        volumes.set(volume.volumeNodeId, {
          id: volume.volumeNodeId,
          label: volume.volumeNumber
            ? `第 ${volume.volumeNumber} 卷 · ${volume.volumeTitle ?? "未命名卷"}`
            : (volume.volumeTitle ?? "未命名卷"),
        });
      }
    }
  }
  return [...volumes.values()];
}

function collectVersions(receipts: WorkExportReceipt[]): Array<{ id: string; label: string }> {
  const versions = new Map<string, { id: string; label: string }>();
  for (const receipt of receipts) {
    const versionNodeId = receipt.manifest?.branch.resolvedVersionNodeId;
    if (!versionNodeId) {
      continue;
    }
    const dateLabel = formatDateTime(receipt.completedAt ?? receipt.createdAt);
    versions.set(versionNodeId, {
      id: versionNodeId,
      label: `${dateLabel} · ${formatLabel(receipt.format)}`,
    });
  }
  return [...versions.values()].slice(0, 20);
}

function buildCatalogFallback(chapters: ChapterWorkspace[]) {
  return {
    chapterCount: chapters.length,
    characterCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    volumes: [
      {
        volumeNodeId: null,
        volumeNumber: null,
        title: "当前作品",
        chapterNumbers: chapters.map((chapter) => chapter.number),
      },
    ],
    chapters: chapters.slice(0, 200).map((chapter) => ({
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      title: chapter.title,
      chapterVersionId: chapter.currentVersionId ?? chapter.id,
      versionNodeId: chapter.currentVersion?.versionNodeId ?? chapter.id,
      characterCount: chapter.wordCount,
      excerpt: excerpt(chapter.currentVersion?.content ?? "", 120),
      volumeNodeId: null,
      volumeNumber: null,
      volumeTitle: "当前作品",
    })),
    truncated: chapters.length > 200,
  };
}

function toPublishMetadata(metadata: MetadataForm): PublishMetadataInput {
  return {
    title: metadata.title.trim(),
    author: metadata.author.trim(),
    summary: metadata.summary.trim(),
    tags: splitTags(metadata.tags),
    coverHeadline: metadata.coverHeadline.trim(),
    coverSubline: metadata.coverSubline.trim(),
    coverTone: metadata.coverTone,
    aiDisclosure: metadata.aiDisclosure,
    copyrightAcknowledged: metadata.copyrightAcknowledged,
  };
}

function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[，,、\n]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function excerpt(content: string, limit: number): string {
  const normalized = content.replaceAll(/\s+/gu, " ").trim();
  const characters = [...normalized];
  return characters.length <= limit ? normalized : `${characters.slice(0, limit).join("")}…`;
}

function formatLabel(format: ExportFormat): string {
  return formatOptions.find((option) => option.value === format)?.label ?? format.toUpperCase();
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryLabel(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) {
    return "已过期";
  }
  return `有效至 ${formatDateTime(expiresAt)}`;
}

function readinessBadgeClass(preview: PublishPreview | null): string {
  if (!preview) {
    return "";
  }
  if (preview.status === "blocked") {
    return "alert-badge";
  }
  if (preview.status === "warning") {
    return "gold-badge";
  }
  return "jade-badge";
}

function moderationBadgeClass(status: ModerationCase["status"]): string {
  if (status === "needs_review") {
    return "alert-badge";
  }
  if (status === "appeal_submitted") {
    return "gold-badge";
  }
  return "jade-badge";
}

function moderationStatusLabel(status: ModerationCase["status"]): string {
  if (status === "needs_review") {
    return "待作者复核";
  }
  if (status === "appeal_submitted") {
    return "申诉已提交";
  }
  return "本地未发现提示";
}

function moderationEventLabel(type: ModerationCase["events"][number]["type"]): string {
  if (type === "appeal_submitted") {
    return "提交申诉";
  }
  if (type === "appeal_withdrawn") {
    return "撤回申诉";
  }
  return "创建内容安全记录";
}

function evidenceValue(value: string | number | boolean | null): string {
  if (value === null) {
    return "未提供";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return String(value);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function parseExportReceiptPage(input: unknown) {
  const envelope = workExportReceiptListResponseSchema.parse(input);
  const nextCursor = envelope.meta.nextCursor;
  return {
    data: envelope.data,
    meta: {
      nextCursor: typeof nextCursor === "string" ? nextCursor : null,
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}
