"use client";

import {
  Expand,
  Bold,
  Check,
  ChevronLeft,
  Circle,
  Coins,
  FileText,
  Italic,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Quote,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Shrink,
  TriangleAlert,
  Users,
  WandSparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentRunTraceListResponseSchema,
  apiErrorSchema,
  canonCommitListResponseSchema,
  canonCommitResponseSchema,
  chapterVersionListResponseSchema,
  chapterVersionSaveResponseSchema,
  chapterReviewResponseSchema,
  chapterWorkspaceListResponseSchema,
  chapterWorkspaceResponseSchema,
  criticAnnotationResponseSchema,
  factProposalListResponseSchema,
  factProposalResponseSchema,
  generationJobListResponseSchema,
  generationJobResponseSchema,
  jobEventSchema,
  qualityWorkspaceResponseSchema,
  writingActionJobListResponseSchema,
  writingActionJobResponseSchema,
  workResponseSchema,
  type CanonCommit,
  type ChapterReadiness,
  type ChapterVersion,
  type ChapterWorkspace,
  type FactProposal,
  type AgentRunTrace,
  type GenerationJob,
  type QualityWorkspace,
  type WorkOverview,
  type WritingActionJob,
  type WritingActionRequest,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

const statusLabels: Record<ChapterWorkspace["status"], string> = {
  planned: "已规划",
  writing: "写作中",
  waiting_review: "待审",
  changes_requested: "要求修改",
  approved: "已批准",
  locked: "已锁定",
  published: "已发布",
  rejected: "已驳回",
};

const generationStatusLabels: Record<GenerationJob["status"], string> = {
  queued: "排队中",
  preparing: "准备中",
  running: "生成中",
  paused: "已暂停",
  waiting_review: "等待审阅",
  completed: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};

const failureClassLabels: Record<NonNullable<AgentRunTrace["run"]["failureClass"]>, string> = {
  provider: "模型服务异常",
  timeout: "模型响应超时",
  rate_limit: "模型服务限流",
  schema: "模型返回格式异常",
  policy: "模型拒绝请求",
  budget: "本章预算不足",
  cancelled: "生成已取消",
  unknown: "未知异常",
};

const writingActionLabels: Record<WritingActionJob["action"], string> = {
  continue: "续写",
  rewrite: "改写",
  expand: "扩写",
  condense: "缩写",
  change_pov: "改视角",
  add_hook: "补钩子",
  generate_title: "生成标题",
  generate_summary: "生成摘要",
  selection_rewrite: "改写选中",
};

const factStatusLabels: Record<FactProposal["status"], string> = {
  proposed: "待确认",
  confirmed: "已确认",
  modified_confirmed: "已修改确认",
  rejected: "已驳回",
  superseded: "已替代",
};

const factRiskLabels: Record<FactProposal["risk"], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

const criticSeverityLabels: Record<QualityWorkspace["findings"][number]["severity"], string> = {
  P0: "阻断",
  P1: "高风险",
  P2: "提醒",
  P3: "建议",
};

const criticStatusLabels: Record<QualityWorkspace["findings"][number]["status"], string> = {
  open: "待处理",
  dismissed: "已记录理由忽略",
  superseded: "已被新版本替代",
};

const criticDimensionLabels: Record<QualityWorkspace["findings"][number]["dimension"], string> = {
  continuity: "连续性",
  style: "文风",
  reader_experience: "读者体验",
};

const criticEvidenceLabels: Record<
  QualityWorkspace["findings"][number]["evidence"][number]["kind"],
  string
> = {
  fact: "事实",
  timeline: "时间线",
  knowledge: "角色认知",
  outline: "章纲",
  location: "地点",
  voice: "声线",
  text: "正文",
};

const jobEventTypes = [
  "job.created",
  "job.preparing",
  "job.step.started",
  "job.step.succeeded",
  "job.step.failed",
  "job.progress",
  "job.waiting_review",
  "job.paused",
  "job.resumed",
  "job.canceled",
  "job.completed",
  "job.failed",
] as const;

export function WritingWorkspace({
  initialChapterId,
  workId,
}: {
  initialChapterId: string | undefined;
  workId: string;
}) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [chapters, setChapters] = useState<ChapterWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialChapterId ?? null);
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [leftVersionId, setLeftVersionId] = useState<string>("");
  const [rightVersionId, setRightVersionId] = useState<string>("");
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [runTraces, setRunTraces] = useState<AgentRunTrace[]>([]);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [writingActionJob, setWritingActionJob] = useState<WritingActionJob | null>(null);
  const [writingActionBusy, setWritingActionBusy] = useState(false);
  const [writingActionMenuOpen, setWritingActionMenuOpen] = useState(false);
  const [povDraft, setPovDraft] = useState("顾青");
  const [factProposals, setFactProposals] = useState<FactProposal[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factBusyId, setFactBusyId] = useState<string | null>(null);
  const [canonCommit, setCanonCommit] = useState<CanonCommit | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [qualityWorkspace, setQualityWorkspace] = useState<QualityWorkspace | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [annotationBusyId, setAnnotationBusyId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const writingActionEventSourceRef = useRef<EventSource | null>(null);
  const submissionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse, "作品加载失败。"));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const chaptersResponse = await fetch(
        `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/chapters`,
        { cache: "no-store" },
      );
      if (!chaptersResponse.ok) {
        throw new Error(await readError(chaptersResponse, "写作台加载失败。"));
      }
      const chapterData = chapterWorkspaceListResponseSchema.parse(
        await chaptersResponse.json(),
      ).data;
      const nextSelectedId =
        chapterData.find((chapter) => chapter.id === selectedId)?.id ?? chapterData[0]?.id ?? null;
      const selectedChapter = chapterData.find((chapter) => chapter.id === nextSelectedId);
      setWork(workData);
      setChapters(chapterData);
      setSelectedId(nextSelectedId);
      setContent(selectedChapter?.currentVersion?.content ?? "");
      setSavedContent(selectedChapter?.currentVersion?.content ?? "");
      if (nextSelectedId && selectedChapter) {
        await Promise.all([
          loadVersions(workData, nextSelectedId),
          loadGenerationJob(workData, nextSelectedId),
          loadWritingActions(workData, nextSelectedId),
          loadFactProposals(workData, nextSelectedId),
          loadCanonCommit(workData, nextSelectedId),
          loadQuality(workData, nextSelectedId),
        ]);
      } else {
        setVersions([]);
        setGenerationJob(null);
        setWritingActionJob(null);
        setRunTraces([]);
        setFactProposals([]);
        setCanonCommit(null);
        setQualityWorkspace(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "写作台加载失败。");
    } finally {
      setLoading(false);
    }
  }, [selectedId, workId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      eventSourceRef.current?.close();
      writingActionEventSourceRef.current?.close();
    },
    [],
  );

  const selected = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedId) ?? null,
    [chapters, selectedId],
  );
  const dirty = content !== savedContent;
  const canSave = Boolean(selected && content.trim() && dirty && !saving);
  const generationActive = Boolean(
    generationJob && ["queued", "preparing", "running", "paused"].includes(generationJob.status),
  );
  const writingActionActive = Boolean(
    writingActionJob &&
    ["queued", "preparing", "running", "paused"].includes(writingActionJob.status),
  );
  const canUseWritingAction = Boolean(
    selected?.currentVersionId &&
    !dirty &&
    !writingActionActive &&
    !writingActionBusy &&
    !generationActive,
  );
  const canGenerate = Boolean(
    selected?.readiness.canStartWriting && !generationActive && !generationBusy,
  );
  const currentFactProposals = factProposals.filter(
    (proposal) =>
      proposal.sourceVersionId === selected?.currentVersionId && proposal.status !== "superseded",
  );
  const pendingRequiredFacts = currentFactProposals.filter(
    (proposal) =>
      proposal.required &&
      proposal.status !== "confirmed" &&
      proposal.status !== "modified_confirmed",
  );
  const unresolvedHighRiskFacts = currentFactProposals.filter(
    (proposal) => proposal.risk === "high" && proposal.status === "proposed",
  );
  const chapterApproved = selected?.status === "approved" || selected?.status === "locked";
  const factsSubmitted = Boolean(
    selected &&
    canonCommit &&
    canonCommit.chapterId === selected.id &&
    canonCommit.chapterVersionId === selected.currentVersionId,
  );
  const canApprove = Boolean(
    selected?.status === "waiting_review" &&
    !reviewBusy &&
    (qualityWorkspace?.gate.canApprove ?? true),
  );
  const canSubmit = Boolean(
    selected?.currentVersionId &&
    chapterApproved &&
    !factsSubmitted &&
    pendingRequiredFacts.length === 0 &&
    unresolvedHighRiskFacts.length === 0 &&
    !submissionBusy,
  );
  const comparisonLeft = versions.find((version) => version.id === leftVersionId);
  const comparisonRight = versions.find((version) => version.id === rightVersionId);
  const traceCalls = runTraces.flatMap((trace) => trace.modelCalls);
  const traceCost = traceCalls.reduce((sum, call) => sum + call.costCny, 0);
  const failedTrace = runTraces.find((trace) => trace.run.status === "failed");
  const canCheckQuality = Boolean(
    selected?.currentVersionId && !dirty && !qualityBusy && !generationActive,
  );

  async function selectChapter(chapter: ChapterWorkspace) {
    setSelectedId(chapter.id);
    setContent(chapter.currentVersion?.content ?? "");
    setSavedContent(chapter.currentVersion?.content ?? "");
    setActionError("");
    setSaved(false);
    if (work) {
      try {
        await Promise.all([
          loadVersions(work, chapter.id),
          loadGenerationJob(work, chapter.id),
          loadWritingActions(work, chapter.id),
          loadFactProposals(work, chapter.id),
          loadCanonCommit(work, chapter.id),
          loadQuality(work, chapter.id),
        ]);
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "章节资料加载失败。");
      }
    }
  }

  async function loadVersions(
    workData: WorkOverview,
    chapterId: string,
    preferredRightVersionId?: string,
  ) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/chapters/${chapterId}/versions`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(await readError(response, "版本加载失败。"));
    }
    const nextVersions = chapterVersionListResponseSchema.parse(await response.json()).data;
    setVersions(nextVersions);
    setLeftVersionId((current) =>
      nextVersions.some((version) => version.id === current)
        ? current
        : (nextVersions.at(-1)?.id ?? ""),
    );
    setRightVersionId((current) =>
      preferredRightVersionId &&
      nextVersions.some((version) => version.id === preferredRightVersionId)
        ? preferredRightVersionId
        : nextVersions.some((version) => version.id === current)
          ? current
          : (nextVersions[0]?.id ?? ""),
    );
  }

  async function loadGenerationJob(workData: WorkOverview, chapterId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/jobs?chapterId=${chapterId}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(await readError(response, "生成状态加载失败。"));
    }
    const jobs = generationJobListResponseSchema.parse(await response.json()).data;
    const latest = jobs[0] ?? null;
    setGenerationJob(latest);
    if (latest) {
      await loadRunTraces(workData, latest.id);
    } else {
      setRunTraces([]);
    }
    if (latest && isActiveGeneration(latest.status)) {
      watchGeneration(workData, latest.id);
    } else {
      closeGenerationStream();
    }
  }

  async function loadWritingActions(workData: WorkOverview, chapterId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/chapters/${chapterId}/write-actions`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(await readError(response, "写作动作状态加载失败。"));
    }
    const jobs = writingActionJobListResponseSchema.parse(await response.json()).data;
    const latest = jobs[0] ?? null;
    setWritingActionJob(latest);
    if (latest && isActiveGeneration(latest.status)) {
      watchWritingAction(workData, latest.id);
    } else {
      closeWritingActionStream();
    }
  }

  async function loadRunTraces(workData: WorkOverview, jobId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/agent-runs?jobId=${jobId}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return;
    }
    setRunTraces(agentRunTraceListResponseSchema.parse(await response.json()).data);
  }

  async function loadFactProposals(workData: WorkOverview, chapterId: string) {
    setFactsLoading(true);
    try {
      const response = await fetch(
        `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/chapters/${chapterId}/fact-proposals`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "本章事实加载失败。"));
      }
      setFactProposals(factProposalListResponseSchema.parse(await response.json()).data);
    } finally {
      setFactsLoading(false);
    }
  }

  async function loadCanonCommit(workData: WorkOverview, chapterId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/canon/commits`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(await readError(response, "事实提交记录加载失败。"));
    }
    const commits = canonCommitListResponseSchema.parse(await response.json()).data;
    setCanonCommit(commits.find((commit) => commit.chapterId === chapterId) ?? null);
  }

  async function loadQuality(workData: WorkOverview, chapterId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/chapters/${chapterId}/quality`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(await readError(response, "质量报告加载失败。"));
    }
    setQualityWorkspace(qualityWorkspaceResponseSchema.parse(await response.json()).data);
  }

  async function startGeneration() {
    if (!work || !selected || !canGenerate) {
      return;
    }
    setGenerationBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}/generate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            budget: {
              maxCostCny: 2.5,
              maxTokens: 30_000,
              maxRevisionRounds: 2,
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "生成任务创建失败。"));
      }
      const job = generationJobResponseSchema.parse(await response.json()).data;
      setGenerationJob(job);
      watchGeneration(work, job.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "生成任务创建失败。");
    } finally {
      setGenerationBusy(false);
    }
  }

  async function startWritingAction(action: WritingActionJob["action"]) {
    if (!work || !selected?.currentVersionId || !canUseWritingAction) {
      return;
    }
    const sourceVersionId = selected.currentVersionId;
    let selection: { start: number; end: number } | undefined;
    if (action === "selection_rewrite") {
      const editor = editorRef.current;
      if (!editor || editor.selectionStart === editor.selectionEnd) {
        setActionError("先在正文里选中要重写的片段。");
        return;
      }
      selection = { start: editor.selectionStart, end: editor.selectionEnd };
    }
    const currentLength = wordCount(content);
    const budget = {
      maxCostCny: 1.5,
      maxTokens: 20_000,
      maxRevisionRounds: 0,
    };
    const request: WritingActionRequest =
      action === "continue"
        ? {
            action,
            sourceVersionId,
            targetLength: 600,
            budget,
          }
        : action === "rewrite"
          ? {
              action,
              sourceVersionId,
              instruction: "保留章纲事实，收紧节奏和动作描写。",
              budget,
            }
          : action === "expand"
            ? {
                action,
                sourceVersionId,
                targetLength: Math.max(800, Math.ceil(currentLength * 1.5)),
                budget,
              }
            : action === "condense"
              ? {
                  action,
                  sourceVersionId,
                  targetLength: Math.max(200, Math.ceil(currentLength * 0.6)),
                  budget,
                }
              : action === "change_pov"
                ? {
                    action,
                    sourceVersionId,
                    pov: povDraft.trim(),
                    budget,
                  }
                : action === "add_hook"
                  ? {
                      action,
                      sourceVersionId,
                      hookStyle: "reversal",
                      count: 3,
                      budget,
                    }
                  : action === "generate_title"
                    ? {
                        action,
                        sourceVersionId,
                        count: 3,
                        budget,
                      }
                    : action === "generate_summary"
                      ? {
                          action,
                          sourceVersionId,
                          maxLength: 200,
                          budget,
                        }
                      : {
                          action,
                          sourceVersionId,
                          selection: selection as { start: number; end: number },
                          instruction: "保留原意，只增强这一段的紧张感。",
                          budget,
                        };
    setWritingActionBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}/write-actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "写作动作创建失败。"));
      }
      const job = writingActionJobResponseSchema.parse(await response.json()).data;
      setWritingActionJob(job);
      watchWritingAction(work, job.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "写作动作创建失败。");
    } finally {
      setWritingActionBusy(false);
    }
  }

  async function cancelWritingAction() {
    if (!work || !writingActionJob || !writingActionActive) {
      return;
    }
    setWritingActionBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/write-actions/${writingActionJob.id}/cancel`,
        {
          method: "POST",
          headers: { "x-csrf-token": await getCsrfToken() },
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "取消写作动作失败。"));
      }
      setWritingActionJob(writingActionJobResponseSchema.parse(await response.json()).data);
      closeWritingActionStream();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "取消写作动作失败。");
    } finally {
      setWritingActionBusy(false);
    }
  }

  async function retryWritingAction() {
    if (!work || !writingActionJob || !["failed", "cancelled"].includes(writingActionJob.status)) {
      return;
    }
    setWritingActionBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/write-actions/${writingActionJob.id}/retry`,
        {
          method: "POST",
          headers: { "x-csrf-token": await getCsrfToken() },
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "重试写作动作失败。"));
      }
      const job = writingActionJobResponseSchema.parse(await response.json()).data;
      setWritingActionJob(job);
      watchWritingAction(work, job.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "重试写作动作失败。");
    } finally {
      setWritingActionBusy(false);
    }
  }

  function watchWritingAction(workData: WorkOverview, actionJobId: string) {
    closeWritingActionStream();
    const source = new EventSource(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/write-actions/${actionJobId}/events`,
    );
    writingActionEventSourceRef.current = source;
    const handleEvent = () => {
      void refreshWritingAction(workData, actionJobId);
    };
    for (const eventType of jobEventTypes) {
      source.addEventListener(eventType, handleEvent);
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        closeWritingActionStream();
      }
    };
  }

  async function refreshWritingAction(workData: WorkOverview, actionJobId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/write-actions/${actionJobId}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return;
    }
    const job = writingActionJobResponseSchema.parse(await response.json()).data;
    setWritingActionJob(job);
    if (isActiveGeneration(job.status)) {
      return;
    }
    closeWritingActionStream();
    const chapterResponse = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/chapters/${job.chapterId}`,
      { cache: "no-store" },
    );
    if (!chapterResponse.ok) {
      return;
    }
    const chapter = chapterWorkspaceResponseSchema.parse(await chapterResponse.json()).data;
    setChapters((current) => current.map((item) => (item.id === chapter.id ? chapter : item)));
    setContent(chapter.currentVersion?.content ?? "");
    setSavedContent(chapter.currentVersion?.content ?? "");
    await loadVersions(workData, chapter.id, chapter.currentVersionId ?? undefined);
    await loadQuality(workData, chapter.id);
  }

  function closeWritingActionStream() {
    writingActionEventSourceRef.current?.close();
    writingActionEventSourceRef.current = null;
  }

  async function applyGeneratedTitle(title: string) {
    if (!work || !selected || dirty) {
      return;
    }
    setWritingActionBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({ version: selected.version, title }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "标题应用失败。"));
      }
      const chapter = chapterWorkspaceResponseSchema.parse(await response.json()).data;
      setChapters((current) => current.map((item) => (item.id === chapter.id ? chapter : item)));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "标题应用失败。");
    } finally {
      setWritingActionBusy(false);
    }
  }

  async function cancelGeneration() {
    if (!work || !generationJob || !generationActive) {
      return;
    }
    setGenerationBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/jobs/${generationJob.id}/cancel`,
        {
          method: "POST",
          headers: {
            "x-csrf-token": await getCsrfToken(),
          },
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "取消生成失败。"));
      }
      setGenerationJob(generationJobResponseSchema.parse(await response.json()).data);
      closeGenerationStream();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "取消生成失败。");
    } finally {
      setGenerationBusy(false);
    }
  }

  async function retryGeneration() {
    if (!work || !generationJob || generationJob.status !== "failed") {
      return;
    }
    setGenerationBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/jobs/${generationJob.id}/retry`,
        {
          method: "POST",
          headers: {
            "x-csrf-token": await getCsrfToken(),
          },
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "重试生成失败。"));
      }
      const job = generationJobResponseSchema.parse(await response.json()).data;
      setGenerationJob(job);
      watchGeneration(work, job.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "重试生成失败。");
    } finally {
      setGenerationBusy(false);
    }
  }

  function watchGeneration(workData: WorkOverview, jobId: string) {
    closeGenerationStream();
    const source = new EventSource(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/jobs/${jobId}/events`,
    );
    eventSourceRef.current = source;
    const handleEvent = (event: MessageEvent<string>) => {
      const parsed = jobEventSchema.safeParse(JSON.parse(event.data));
      if (!parsed.success) {
        return;
      }
      void refreshGenerationJob(workData, jobId);
    };
    for (const eventType of jobEventTypes) {
      source.addEventListener(eventType, handleEvent as EventListener);
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        closeGenerationStream();
      }
    };
  }

  async function refreshGenerationJob(workData: WorkOverview, jobId: string) {
    const response = await fetch(
      `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/jobs/${jobId}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return;
    }
    const job = generationJobResponseSchema.parse(await response.json()).data;
    setGenerationJob(job);
    await loadRunTraces(workData, job.id);
    if (!isActiveGeneration(job.status)) {
      closeGenerationStream();
      const chapterResponse = await fetch(
        `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}/chapters/${job.chapterId}`,
        { cache: "no-store" },
      );
      if (chapterResponse.ok) {
        const chapter = chapterWorkspaceResponseSchema.parse(await chapterResponse.json()).data;
        if (chapter) {
          setChapters((current) =>
            current.map((item) => (item.id === chapter.id ? chapter : item)),
          );
          setContent(chapter.currentVersion?.content ?? "");
          setSavedContent(chapter.currentVersion?.content ?? "");
          await loadVersions(workData, chapter.id, chapter.currentVersionId ?? undefined);
          await loadFactProposals(workData, chapter.id);
          await loadCanonCommit(workData, chapter.id);
          await loadQuality(workData, chapter.id);
        }
      }
    }
  }

  async function decideFact(
    proposal: FactProposal,
    body: {
      action: "confirm" | "modify_confirm" | "reject";
      reason?: string;
      modified?: {
        subject?: string;
        predicate?: string;
        object?: string;
        risk?: FactProposal["risk"];
      };
    },
  ) {
    if (!work || factBusyId) {
      return;
    }
    setFactBusyId(proposal.id);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/fact-proposals/${proposal.id}/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "事实决策保存失败。"));
      }
      const updated = factProposalResponseSchema.parse(await response.json()).data;
      setFactProposals((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "事实决策保存失败。");
    } finally {
      setFactBusyId(null);
    }
  }

  async function checkQuality() {
    if (!work || !selected?.currentVersionId || !canCheckQuality) {
      return;
    }
    setQualityBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}/verify`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({ chapterVersionId: selected.currentVersionId }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "本章检查失败。"));
      }
      setQualityWorkspace(qualityWorkspaceResponseSchema.parse(await response.json()).data);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "本章检查失败。");
    } finally {
      setQualityBusy(false);
    }
  }

  async function updateAnnotation(
    annotation: QualityWorkspace["annotations"][number],
    action: "dismiss" | "reopen",
  ) {
    if (!work || annotationBusyId) {
      return;
    }
    setAnnotationBusyId(annotation.findingId);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/annotations/${annotation.findingId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            action,
            version: annotation.version,
            ...(action === "dismiss" ? { reason: dismissReason.trim() } : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "问题状态更新失败。"));
      }
      criticAnnotationResponseSchema.parse(await response.json());
      setDismissingId(null);
      setDismissReason("");
      await loadQuality(work, annotation.chapterId);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "问题状态更新失败。");
    } finally {
      setAnnotationBusyId(null);
    }
  }

  async function approveChapter() {
    if (!work || !selected || !canApprove) {
      return;
    }
    setReviewBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}/review`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            action: "approve",
            version: selected.version,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "章节批准失败。"));
      }
      const reviewed = chapterReviewResponseSchema.parse(await response.json()).data;
      setChapters((current) =>
        current.map((chapter) => (chapter.id === reviewed.chapter.id ? reviewed.chapter : chapter)),
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "章节批准失败。");
    } finally {
      setReviewBusy(false);
    }
  }

  async function submitChapterFacts() {
    if (!work || !selected?.currentVersionId || !canSubmit) {
      return;
    }
    const submissionKey = `${selected.id}:${selected.currentVersionId}`;
    let idempotencyKey = submissionKeys.current.get(submissionKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      submissionKeys.current.set(submissionKey, idempotencyKey);
    }
    setSubmissionBusy(true);
    setActionError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}/canon/commit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            chapterVersionId: selected.currentVersionId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "本章事实提交失败。"));
      }
      const commit = canonCommitResponseSchema.parse(await response.json()).data;
      setCanonCommit(commit);
      submissionKeys.current.delete(submissionKey);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "本章事实提交失败。");
    } finally {
      setSubmissionBusy(false);
    }
  }

  function closeGenerationStream() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }

  async function saveVersion() {
    if (!work || !selected || !canSave) {
      return;
    }
    setSaving(true);
    setActionError("");
    setSaved(false);
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters/${selected.id}/versions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            version: selected.version,
            content,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "版本保存失败。"));
      }
      const result = chapterVersionSaveResponseSchema.parse(await response.json()).data;
      setChapters((current) =>
        current.map((chapter) => (chapter.id === result.chapter.id ? result.chapter : chapter)),
      );
      setSavedContent(content);
      setSaved(true);
      await loadVersions(work, result.chapter.id, result.version.id);
      await loadQuality(work, result.chapter.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "版本保存失败。");
    } finally {
      setSaving(false);
    }
  }

  function wrapSelection(prefix: string, suffix = prefix) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = content.slice(start, end);
    const next = `${content.slice(0, start)}${prefix}${selectedText}${suffix}${content.slice(end)}`;
    setContent(next);
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }

  function prefixLine(prefix: string) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const start = editor.selectionStart;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    setContent(`${content.slice(0, lineStart)}${prefix}${content.slice(lineStart)}`);
    requestAnimationFrame(() => editor.focus());
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载写作台">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载写作台
      </section>
    );
  }

  if (error || !work) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "写作台加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  if (!selected) {
    return (
      <>
        <section className="page-head">
          <div>
            <p className="eyebrow">章节写作</p>
            <h1>写作台</h1>
            <p className="page-sub">{work.title}</p>
          </div>
        </section>
        <section className="panel writing-empty-state" aria-labelledby="writing-empty-title">
          <span className="empty-icon">
            <FileText size={22} aria-hidden="true" />
          </span>
          <div>
            <h2 id="writing-empty-title">还没有章纲</h2>
            <p>先规划本章目标、POV、地点、场景节拍和必用事实，再开始写正文。</p>
            <Link className="btn btn-primary" href={`/workspace/${work.id}/outline`}>
              先去写章纲
            </Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="page-head writing-page-head">
        <div>
          <p className="eyebrow">章节写作</p>
          <h1>写作台</h1>
          <p className="page-sub">
            {work.title} · 第 {selected.number} 章 · {statusLabels[selected.status]}
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${work.id}/outline`}>
            <ChevronLeft size={15} aria-hidden="true" />
            返回章纲
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => setFocusMode((current) => !current)}
            type="button"
          >
            {focusMode ? (
              <Minimize2 size={15} aria-hidden="true" />
            ) : (
              <Maximize2 size={15} aria-hidden="true" />
            )}
            {focusMode ? "退出专注" : "专注模式"}
          </button>
          {generationActive ? (
            <button
              className="btn btn-ghost"
              disabled={generationBusy}
              onClick={() => void cancelGeneration()}
              type="button"
            >
              <XCircle size={15} aria-hidden="true" />
              取消生成
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!canGenerate}
              onClick={() => void startGeneration()}
              type="button"
            >
              {generationBusy ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Sparkles size={15} aria-hidden="true" />
              )}
              生成整章
            </button>
          )}
        </div>
      </section>

      {actionError ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className={`writing-workspace${focusMode ? " focus-mode" : ""}`}>
        <aside className="panel writing-chapter-rail" aria-label="章节列表">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">主创作线</span>
              <h2>章节</h2>
            </div>
            <span className="badge">{chapters.length}</span>
          </div>
          <div className="writing-chapter-list">
            {chapters.map((chapter) => (
              <button
                className={`writing-chapter-item${chapter.id === selected.id ? " active" : ""}`}
                key={chapter.id}
                onClick={() => void selectChapter(chapter)}
                type="button"
              >
                <span>{chapter.number}</span>
                <div>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.wordCount.toLocaleString("zh-CN")} 字</small>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel writing-editor" aria-labelledby="writing-chapter-title">
          <div className="writing-editor-toolbar">
            <div>
              <button
                aria-label="加粗"
                className="icon-btn small"
                onClick={() => wrapSelection("**")}
                title="加粗选中文字"
                type="button"
              >
                <Bold size={15} aria-hidden="true" />
              </button>
              <button
                aria-label="斜体"
                className="icon-btn small"
                onClick={() => wrapSelection("_")}
                title="斜体选中文字"
                type="button"
              >
                <Italic size={15} aria-hidden="true" />
              </button>
              <button
                aria-label="引用"
                className="icon-btn small"
                onClick={() => prefixLine("> ")}
                title="将当前行设为引用"
                type="button"
              >
                <Quote size={15} aria-hidden="true" />
              </button>
              <span className="writing-toolbar-divider" aria-hidden="true" />
              <button
                className="btn btn-ghost btn-small"
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("continue")}
                type="button"
              >
                <Sparkles size={14} aria-hidden="true" />
                续写
              </button>
              <button
                className="btn btn-ghost btn-small"
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("selection_rewrite")}
                type="button"
              >
                <WandSparkles size={14} aria-hidden="true" />
                改写选中
              </button>
              <button
                aria-expanded={writingActionMenuOpen}
                className="btn btn-ghost btn-small"
                disabled={!canUseWritingAction}
                onClick={() => setWritingActionMenuOpen((current) => !current)}
                type="button"
              >
                <Expand size={14} aria-hidden="true" />
                更多生成
              </button>
            </div>
            <span className={`writing-save-state${dirty ? " dirty" : ""}`}>
              {saving ? "保存中" : saved ? "已保存" : dirty ? "有未保存修改" : "版本已同步"}
            </span>
          </div>
          {writingActionMenuOpen ? (
            <div className="writing-action-menu" aria-label="更多写作动作">
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("rewrite")}
                type="button"
              >
                <WandSparkles size={15} aria-hidden="true" />
                <span>整章改写</span>
                <small>保留事实，重新组织整章表达</small>
              </button>
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("expand")}
                type="button"
              >
                <Maximize2 size={15} aria-hidden="true" />
                <span>扩写</span>
                <small>保留原意，补充动作与环境</small>
              </button>
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("condense")}
                type="button"
              >
                <Shrink size={15} aria-hidden="true" />
                <span>缩写</span>
                <small>压缩篇幅，保留关键事实</small>
              </button>
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("change_pov")}
                type="button"
              >
                <Users size={15} aria-hidden="true" />
                <span>改视角</span>
                <small>切换到指定人物视角</small>
              </button>
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("add_hook")}
                type="button"
              >
                <Quote size={15} aria-hidden="true" />
                <span>补钩子</span>
                <small>给出三个章末悬念候选</small>
              </button>
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("generate_title")}
                type="button"
              >
                <FileText size={15} aria-hidden="true" />
                <span>生成标题</span>
                <small>给出三个可选章名</small>
              </button>
              <button
                disabled={!canUseWritingAction}
                onClick={() => void startWritingAction("generate_summary")}
                type="button"
              >
                <FileText size={15} aria-hidden="true" />
                <span>生成摘要</span>
                <small>整理本章短摘要</small>
              </button>
              <label className="writing-action-pov">
                <span>改视角人物</span>
                <input
                  onChange={(event) => setPovDraft(event.target.value)}
                  placeholder="输入人物名"
                  value={povDraft}
                />
              </label>
            </div>
          ) : null}
          <div className="writing-paper">
            <div className="writing-chapter-heading">
              <span>
                第 {selected.number} 章 ·{" "}
                <em className={`chapter-status-${selected.status}`}>
                  {statusLabels[selected.status]}
                </em>
              </span>
              <h2 id="writing-chapter-title">{selected.title}</h2>
            </div>
            <label className="writing-editor-label">
              <span className="sr-only">章节正文</span>
              <textarea
                aria-label="章节正文"
                onChange={(event) => {
                  setContent(event.target.value);
                  setSaved(false);
                }}
                placeholder="从本章第一个场景开始写。"
                ref={editorRef}
                spellCheck={false}
                value={content}
              />
            </label>
          </div>
          <div className="writing-statusbar">
            <span>{wordCount(content).toLocaleString("zh-CN")} 字</span>
            <span>预计阅读 {Math.max(1, Math.ceil(wordCount(content) / 400))} 分钟</span>
            <button
              className="btn btn-primary btn-small"
              disabled={!canSave}
              onClick={() => void saveVersion()}
              type="button"
            >
              {saving ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              保存版本
            </button>
          </div>
        </section>

        <aside className="writing-notes" aria-label="章节信息">
          <section className="panel writing-generation" aria-labelledby="writing-generation-title">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">生成进度</span>
                <h2 id="writing-generation-title">
                  {generationJob ? generationStatusLabels[generationJob.status] : "尚未生成"}
                </h2>
              </div>
              {generationJob ? (
                <span className={`badge generation-status-${generationJob.status}`}>
                  {generationJob.progress}%
                </span>
              ) : null}
            </div>
            {generationJob ? (
              <>
                <div
                  aria-label={`生成进度 ${generationJob.progress}%`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={generationJob.progress}
                  className="writing-generation-progress"
                  role="progressbar"
                >
                  <span style={{ width: `${generationJob.progress}%` }} />
                </div>
                <div className="writing-generation-meta">
                  <div>
                    <span>当前步骤</span>
                    <strong>{generationStepLabel(generationJob.currentStep)}</strong>
                  </div>
                  <div>
                    <span>断点</span>
                    <strong>{generationStepLabel(generationJob.checkpoint.step)}</strong>
                  </div>
                  <div>
                    <span>费用</span>
                    <strong>{formatCost(generationJob.cost.costCny)}</strong>
                  </div>
                </div>
                {generationJob.error ? (
                  <div className="writing-generation-error" role="alert">
                    <TriangleAlert size={15} aria-hidden="true" />
                    <div>
                      <strong>{generationJob.error.message}</strong>
                      <small>
                        {failedTrace?.run.failureClass
                          ? `${failureClassLabels[failedTrace.run.failureClass]} · `
                          : ""}
                        {generationJob.error.code}
                      </small>
                    </div>
                  </div>
                ) : null}
                {traceCalls.length > 0 ? (
                  <div className="writing-run-trace" aria-label="生成记录">
                    <div className="writing-run-trace-head">
                      <span>
                        <Coins size={14} aria-hidden="true" />
                        生成记录
                      </span>
                      <strong>
                        {traceCalls.length} 次调用 · {formatCost(traceCost)}
                      </strong>
                    </div>
                    <div className="writing-run-trace-list">
                      {runTraces.map((trace) =>
                        trace.modelCalls.map((call) => (
                          <div className="writing-run-trace-item" key={call.id}>
                            <span>{traceStepLabel(call.stepKey)}</span>
                            <small>
                              {call.model} · 用量{" "}
                              {(call.inputTokens + call.outputTokens).toLocaleString("zh-CN")} ·{" "}
                              {formatCost(call.costCny)}
                            </small>
                          </div>
                        )),
                      )}
                    </div>
                    {failedTrace?.run.escalationReason ? (
                      <p className="writing-run-trace-note">{failedTrace.run.escalationReason}</p>
                    ) : null}
                  </div>
                ) : null}
                {generationJob.status === "failed" ? (
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={generationBusy}
                    onClick={() => void retryGeneration()}
                    type="button"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    从断点重试
                  </button>
                ) : null}
                {generationJob.contextPack ? (
                  <div className="writing-context-pack">
                    <div className="writing-context-pack-head">
                      <span>
                        <Coins size={14} aria-hidden="true" />
                        参考预算
                      </span>
                      <strong>
                        {generationJob.contextPack.tokenUsed.toLocaleString("zh-CN")} /{" "}
                        {generationJob.contextPack.tokenBudget.toLocaleString("zh-CN")}
                      </strong>
                    </div>
                    <div className="writing-source-list">
                      {generationJob.contextPack.sourceRefs.map((ref) => (
                        <div
                          className="writing-source-item"
                          key={`${ref.sourceType}-${ref.sourceId}`}
                        >
                          <span>{ref.label}</span>
                          <small>{ref.citation}</small>
                        </div>
                      ))}
                    </div>
                    {generationJob.contextPack.evicted.length > 0 ? (
                      <details className="writing-evictions">
                        <summary>未纳入 {generationJob.contextPack.evicted.length} 项参考</summary>
                        <ul>
                          {generationJob.contextPack.evicted.map((item) => (
                            <li key={item.key}>
                              <span>{item.label}</span>
                              <small>超出参考预算</small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="writing-generation-empty">本章还没有生成记录。</p>
            )}
          </section>

          <section className="panel writing-action-panel" aria-labelledby="writing-action-title">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">按需修改</span>
                <h2 id="writing-action-title">写作动作</h2>
              </div>
              {writingActionJob ? (
                <span className={`badge generation-status-${writingActionJob.status}`}>
                  {generationStatusLabels[writingActionJob.status]}
                </span>
              ) : (
                <span className="badge">待使用</span>
              )}
            </div>
            {!writingActionJob ? (
              <p className="writing-generation-empty">
                先保存当前版本，再用续写、改写选中或更多生成调整正文。
              </p>
            ) : (
              <>
                <div className="writing-action-summary">
                  <strong>{writingActionLabels[writingActionJob.action]}</strong>
                  <span>{generationStatusLabels[writingActionJob.status]}</span>
                </div>
                {writingActionActive ? (
                  <>
                    <div
                      aria-label={`写作动作进度 ${writingActionJob.progress}%`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={writingActionJob.progress}
                      className="writing-generation-progress"
                      role="progressbar"
                    >
                      <span style={{ width: `${writingActionJob.progress}%` }} />
                    </div>
                    <button
                      className="btn btn-ghost btn-small"
                      disabled={writingActionBusy}
                      onClick={() => void cancelWritingAction()}
                      type="button"
                    >
                      <XCircle size={14} aria-hidden="true" />
                      取消动作
                    </button>
                  </>
                ) : null}
                {writingActionJob.error ? (
                  <div className="writing-generation-error" role="alert">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <div>
                      <strong>{writingActionJob.error.message}</strong>
                      <small>{writingActionJob.error.code}</small>
                    </div>
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => void retryWritingAction()}
                      type="button"
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      从断点重试
                    </button>
                  </div>
                ) : null}
                {writingActionJob.output ? (
                  <div className="writing-action-output">
                    <div className="writing-action-output-head">
                      <span>第 {writingActionJob.output.version} 版结果</span>
                      <small>
                        {writingActionJob.output.chapterVersionId
                          ? "新版本已生成，原稿保留在版本历史"
                          : "产物已归档，不覆盖正文"}
                      </small>
                    </div>
                    {writingActionJob.output.kind === "chapter_text" ? (
                      <>
                        {writingActionJob.output.affectedRange ? (
                          <p className="writing-action-range">
                            改写范围：第 {writingActionJob.output.affectedRange.start + 1}–
                            {writingActionJob.output.affectedRange.end} 字
                          </p>
                        ) : null}
                        <pre>{writingActionJob.output.content.slice(0, 600)}</pre>
                      </>
                    ) : null}
                    {writingActionJob.output.kind === "title_options" ? (
                      <div className="writing-action-title-options">
                        {writingActionJob.output.titles.map((title) => (
                          <button
                            className="btn btn-ghost btn-small"
                            disabled={writingActionBusy || dirty}
                            key={title}
                            onClick={() => void applyGeneratedTitle(title)}
                            type="button"
                          >
                            <Check size={14} aria-hidden="true" />
                            {title}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {writingActionJob.output.kind === "summary" ? (
                      <p className="writing-action-summary-text">
                        {writingActionJob.output.summary}
                      </p>
                    ) : null}
                    {writingActionJob.output.kind === "hooks" ? (
                      <ul className="writing-action-hooks">
                        {writingActionJob.output.hooks.map((hook) => (
                          <li key={hook}>{hook}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="panel writing-quality" aria-labelledby="writing-quality-title">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">结构化审校</span>
                <h2 id="writing-quality-title">质量报告</h2>
              </div>
              <button
                className="btn btn-ghost btn-small"
                disabled={!canCheckQuality}
                onClick={() => void checkQuality()}
                type="button"
              >
                {qualityBusy ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : (
                  <Sparkles size={14} aria-hidden="true" />
                )}
                {qualityWorkspace?.report ? "重新检查" : "检查本章"}
              </button>
            </div>
            {!qualityWorkspace?.report ? (
              <p className="writing-generation-empty">
                保存当前版本后检查连续性、文风和读者体验，结果会定位到正文证据。
              </p>
            ) : (
              <>
                <p className="writing-quality-summary">{qualityWorkspace.report.summary}</p>
                <div className="quality-dimensions" aria-label="六维质量证据">
                  {qualityWorkspace.report.dimensions.map((dimension) => (
                    <article
                      className="quality-dimension"
                      data-quality-dimension={dimension.dimension}
                      key={dimension.dimension}
                    >
                      <div>
                        <strong>{dimension.label}</strong>
                        <span>{dimension.score}/5</span>
                      </div>
                      <p>{dimension.rationale}</p>
                      <blockquote>“{dimension.evidence[0]?.quote}”</blockquote>
                    </article>
                  ))}
                </div>
                {qualityWorkspace.gate.blockers.length > 0 ? (
                  <div className="writing-quality-gate" role="alert">
                    <TriangleAlert size={15} aria-hidden="true" />
                    <div>
                      <strong>
                        {qualityWorkspace.gate.canApprove
                          ? "仍有结构问题，暂不能提交本章事实"
                          : "仍有阻断问题，暂不能批准或提交本章事实"}
                      </strong>
                      <small>
                        {qualityWorkspace.gate.blockers
                          .map((blocker) => blocker.message)
                          .join("；")}
                      </small>
                    </div>
                  </div>
                ) : (
                  <p className="writing-quality-gate-ok">
                    <Check size={14} aria-hidden="true" />
                    当前版本没有阻断级质量问题。
                  </p>
                )}
                <div className="writing-quality-findings">
                  <h3>本章问题</h3>
                  {qualityWorkspace.findings.length === 0 ? (
                    <p className="writing-generation-empty">本次检查没有发现问题。</p>
                  ) : (
                    qualityWorkspace.findings.map((finding) => {
                      const evidence = finding.evidence[0];
                      const canDismiss =
                        finding.status === "open" &&
                        (finding.severity === "P2" || finding.severity === "P3") &&
                        !finding.structural;
                      return (
                        <article
                          className={`writing-quality-finding severity-${finding.severity.toLowerCase()}`}
                          data-critic-finding={finding.code}
                          data-critic-status={finding.status}
                          key={finding.id}
                        >
                          <div className="writing-quality-finding-head">
                            <span
                              className={`badge critic-severity-${finding.severity.toLowerCase()}`}
                            >
                              {criticSeverityLabels[finding.severity]}
                            </span>
                            <span>{criticDimensionLabels[finding.dimension]}</span>
                            <small>{criticStatusLabels[finding.status]}</small>
                          </div>
                          <h4>{finding.recommendation}</h4>
                          {evidence ? (
                            <blockquote>
                              <span>
                                {criticEvidenceLabels[evidence.kind]} · {evidence.locator}
                              </span>
                              “{evidence.quote}”<small>{evidence.explanation}</small>
                            </blockquote>
                          ) : null}
                          <div className="writing-quality-sources">
                            {finding.sourceRefs.slice(0, 3).map((source) => (
                              <span key={`${source.type}-${source.id}`}>{source.label}</span>
                            ))}
                          </div>
                          {finding.ignoredReason ? (
                            <p className="writing-quality-ignore-reason">
                              忽略理由：{finding.ignoredReason}
                            </p>
                          ) : null}
                          {canDismiss ? (
                            dismissingId === finding.id ? (
                              <form
                                className="writing-quality-dismiss"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const annotation = qualityWorkspace.annotations.find(
                                    (item) => item.findingId === finding.id,
                                  );
                                  if (annotation) {
                                    void updateAnnotation(annotation, "dismiss");
                                  }
                                }}
                              >
                                <label>
                                  <span>忽略理由</span>
                                  <textarea
                                    aria-label="忽略理由"
                                    onChange={(event) => setDismissReason(event.target.value)}
                                    placeholder="说明为什么这是误报或有意处理"
                                    value={dismissReason}
                                  />
                                </label>
                                <div>
                                  <button
                                    className="btn btn-primary btn-small"
                                    disabled={
                                      !dismissReason.trim() || annotationBusyId === finding.id
                                    }
                                    type="submit"
                                  >
                                    记录理由并忽略
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-small"
                                    onClick={() => {
                                      setDismissingId(null);
                                      setDismissReason("");
                                    }}
                                    type="button"
                                  >
                                    取消
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <button
                                className="btn btn-ghost btn-small"
                                onClick={() => {
                                  setDismissingId(finding.id);
                                  setDismissReason("");
                                }}
                                type="button"
                              >
                                <XCircle size={13} aria-hidden="true" />
                                忽略误报
                              </button>
                            )
                          ) : null}
                          {finding.status === "dismissed" ? (
                            <button
                              className="btn btn-ghost btn-small"
                              disabled={annotationBusyId === finding.id}
                              onClick={() => {
                                const annotation = qualityWorkspace.annotations.find(
                                  (item) => item.findingId === finding.id,
                                );
                                if (annotation) {
                                  void updateAnnotation(annotation, "reopen");
                                }
                              }}
                              type="button"
                            >
                              <RefreshCw size={13} aria-hidden="true" />
                              恢复问题
                            </button>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>

          <section className="panel writing-facts" aria-labelledby="writing-facts-title">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">逐条确认</span>
                <h2 id="writing-facts-title">本章事实</h2>
              </div>
              <span className="badge">{factProposals.length}</span>
            </div>
            {factsLoading ? (
              <div className="writing-facts-loading" role="status">
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
                正在加载本章事实
              </div>
            ) : factProposals.length === 0 ? (
              <p className="writing-generation-empty">
                生成正文后会在这里整理本章事实，等待你逐条确认。
              </p>
            ) : (
              <>
                <p className="writing-facts-summary">
                  待确认 {factProposals.filter((item) => item.status === "proposed").length} 条 ·
                  已处理 {factProposals.filter((item) => item.status !== "proposed").length} 条
                </p>
                <div className="writing-fact-list">
                  {factProposals.map((proposal) => (
                    <article
                      className={`writing-fact-card writing-fact-${proposal.status}`}
                      key={proposal.id}
                    >
                      <div className="writing-fact-head">
                        <span className={`badge writing-fact-status-${proposal.status}`}>
                          {factStatusLabels[proposal.status]}
                        </span>
                        <span className={`writing-fact-risk writing-fact-risk-${proposal.risk}`}>
                          {factRiskLabels[proposal.risk]}
                        </span>
                      </div>
                      <h3>{proposal.object}</h3>
                      <p>
                        {proposal.subject} · {proposal.predicate}
                      </p>
                      <small className="writing-fact-source">来源：第 {selected.number} 章</small>
                      <blockquote>来源句：“{proposal.sourceSentence}”</blockquote>
                      {proposal.decision ? (
                        <div className="writing-fact-decision">
                          <strong>{proposal.decision.actorName}</strong>
                          <span>{formatDateTime(proposal.decision.decidedAt)}</span>
                          <small>{proposal.decision.reason}</small>
                        </div>
                      ) : null}
                      {proposal.status === "proposed" ? (
                        <div className="writing-fact-actions">
                          <button
                            className="btn btn-primary btn-small"
                            disabled={factBusyId === proposal.id}
                            onClick={() => void decideFact(proposal, { action: "confirm" })}
                            type="button"
                          >
                            {factBusyId === proposal.id ? (
                              <LoaderCircle className="spin" size={13} aria-hidden="true" />
                            ) : (
                              <Check size={13} aria-hidden="true" />
                            )}
                            确认
                          </button>
                          <button
                            className="btn btn-ghost btn-small"
                            disabled={factBusyId === proposal.id}
                            onClick={() => void decideFact(proposal, { action: "reject" })}
                            type="button"
                          >
                            <XCircle size={13} aria-hidden="true" />
                            驳回
                          </button>
                          <details className="writing-fact-modify">
                            <summary>修改后确认</summary>
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                const modified: {
                                  subject?: string;
                                  predicate?: string;
                                  object?: string;
                                  risk?: FactProposal["risk"];
                                } = {
                                  risk: String(form.get("risk") ?? "") as FactProposal["risk"],
                                };
                                const subject = String(form.get("subject") ?? "").trim();
                                const predicate = String(form.get("predicate") ?? "").trim();
                                const object = String(form.get("object") ?? "").trim();
                                if (subject) {
                                  modified.subject = subject;
                                }
                                if (predicate) {
                                  modified.predicate = predicate;
                                }
                                if (object) {
                                  modified.object = object;
                                }
                                const decision: {
                                  action: "modify_confirm";
                                  reason?: string;
                                  modified: typeof modified;
                                } = {
                                  action: "modify_confirm",
                                  modified,
                                };
                                const reason = String(form.get("reason") ?? "").trim();
                                if (reason) {
                                  decision.reason = reason;
                                }
                                void decideFact(proposal, decision);
                              }}
                            >
                              <label>
                                <span>主体</span>
                                <input defaultValue={proposal.subject} name="subject" />
                              </label>
                              <label>
                                <span>关系</span>
                                <input defaultValue={proposal.predicate} name="predicate" />
                              </label>
                              <label>
                                <span>事实</span>
                                <textarea defaultValue={proposal.object} name="object" />
                              </label>
                              <label>
                                <span>风险</span>
                                <select defaultValue={proposal.risk} name="risk">
                                  <option value="low">低风险</option>
                                  <option value="medium">中风险</option>
                                  <option value="high">高风险</option>
                                </select>
                              </label>
                              <label>
                                <span>修改原因</span>
                                <input name="reason" placeholder="说明为什么需要修改" />
                              </label>
                              <button
                                className="btn btn-primary btn-small"
                                disabled={factBusyId === proposal.id}
                                type="submit"
                              >
                                保存修改并确认
                              </button>
                            </form>
                          </details>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
                <div className="writing-submit-gate" aria-label="提交本章事实">
                  <div>
                    <strong>提交本章事实</strong>
                    <small>
                      {factsSubmitted
                        ? "事实已提交，后续修改需要发起修改请求。"
                        : qualityWorkspace && !qualityWorkspace.gate.canApprove
                          ? "先处理阻断级质量问题，再批准本章。"
                          : !chapterApproved
                            ? pendingRequiredFacts.length > 0
                              ? `先批准本章，再确认剩余 ${pendingRequiredFacts.length} 条事实。`
                              : "先批准本章，才能提交事实。"
                            : pendingRequiredFacts.length > 0
                              ? `还有 ${pendingRequiredFacts.length} 条事实待确认。`
                              : unresolvedHighRiskFacts.length > 0
                                ? "还有高风险事实待处理。"
                                : "已满足提交条件，可以提交本章事实。"}
                    </small>
                  </div>
                  <div className="writing-submit-actions">
                    <button
                      className="btn btn-ghost btn-small"
                      disabled={!canApprove}
                      onClick={() => void approveChapter()}
                      type="button"
                    >
                      {reviewBusy ? (
                        <LoaderCircle className="spin" size={13} aria-hidden="true" />
                      ) : (
                        <ShieldCheck size={13} aria-hidden="true" />
                      )}
                      {chapterApproved ? "本章已批准" : "批准本章"}
                    </button>
                    <button
                      className="btn btn-primary btn-small"
                      disabled={!canSubmit}
                      onClick={() => void submitChapterFacts()}
                      type="button"
                    >
                      {submissionBusy ? (
                        <LoaderCircle className="spin" size={13} aria-hidden="true" />
                      ) : (
                        <Send size={13} aria-hidden="true" />
                      )}
                      {factsSubmitted ? "本章事实已提交" : "提交本章事实"}
                    </button>
                  </div>
                </div>
                {canonCommit && factsSubmitted ? (
                  <div className="writing-submit-summary">
                    <strong>摘要已更新</strong>
                    <span>{canonCommit.summary.text}</span>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="panel writing-readiness">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">写前检查</span>
                <h2>准备度</h2>
              </div>
              <span className={`badge outline-readiness-${selected.readiness.status}`}>
                {readinessLabel(selected.readiness)}
              </span>
            </div>
            <div className="outline-readiness-list">
              {selected.readiness.items.map((item) => (
                <div
                  className={`outline-readiness-item${item.ready ? " ready" : ""}`}
                  key={item.key}
                >
                  <span>
                    {item.ready ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <Circle size={11} aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.ready ? "已就绪" : item.missing.join("；")}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel writing-context">
            <span className="panel-kicker">本章参考</span>
            <h2>章纲与必用事实</h2>
            <div className="writing-brief-summary">
              <span>章目标</span>
              <p>{selected.brief?.goal}</p>
            </div>
            <div className="writing-brief-summary">
              <span>必用事实</span>
              <ul>
                {selected.brief?.requiredFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel writing-versions" aria-labelledby="writing-versions-title">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">手动保存</span>
                <h2 id="writing-versions-title">版本</h2>
              </div>
              <span className="badge">{versions.length}</span>
            </div>
            {versions.length === 0 ? (
              <p className="writing-versions-empty">保存后会在这里留下可恢复的版本。</p>
            ) : (
              <div className="writing-version-list">
                {versions.map((version) => (
                  <div
                    className={`writing-version-item${
                      version.id === selected.currentVersionId ? " current" : ""
                    }`}
                    key={version.id}
                  >
                    <div>
                      <strong>第 {version.version} 版</strong>
                      <small>{formatDateTime(version.createdAt)}</small>
                    </div>
                    {version.id === selected.currentVersionId ? (
                      <span className="badge">当前</span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {versions.length >= 2 ? (
              <div className="writing-version-compare">
                <h2>版本比较</h2>
                <div className="writing-version-selects">
                  <label>
                    <span>比较版本 A</span>
                    <select
                      onChange={(event) => setLeftVersionId(event.target.value)}
                      value={leftVersionId}
                    >
                      {versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          第 {version.version} 版
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>比较版本 B</span>
                    <select
                      onChange={(event) => setRightVersionId(event.target.value)}
                      value={rightVersionId}
                    >
                      {versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          第 {version.version} 版
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="writing-version-diff">
                  <div>
                    <span>版本 A</span>
                    <pre>{comparisonLeft?.content ?? "未选择版本"}</pre>
                  </div>
                  <div>
                    <span>版本 B</span>
                    <pre>{comparisonRight?.content ?? "未选择版本"}</pre>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

function readinessLabel(readiness: ChapterReadiness): string {
  if (readiness.status === "ready") {
    return "已就绪";
  }
  if (readiness.status === "partial") {
    return "部分就绪";
  }
  return "未就绪";
}

function isActiveGeneration(status: GenerationJob["status"]): boolean {
  return ["queued", "preparing", "running", "paused"].includes(status);
}

function generationStepLabel(step: GenerationJob["currentStep"]): string {
  const labels: Record<GenerationJob["currentStep"], string> = {
    prepare: "准备",
    compile_context: "整理参考",
    draft: "起草",
    verify: "检查",
    revise: "修订",
    extract_facts: "整理本章事实",
    await_review: "等待审阅",
  };
  return labels[step];
}

function traceStepLabel(step: string): string {
  const labels: Record<string, string> = {
    draft: "起草",
    verify: "检查",
    revise: "修订",
  };
  return labels[step] ?? step;
}

function formatCost(value: number): string {
  return `¥${value.toFixed(4)}`;
}

function wordCount(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
