"use client";

import {
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
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiErrorSchema,
  chapterVersionListResponseSchema,
  chapterVersionSaveResponseSchema,
  chapterWorkspaceListResponseSchema,
  chapterWorkspaceResponseSchema,
  generationJobListResponseSchema,
  generationJobResponseSchema,
  jobEventSchema,
  workResponseSchema,
  type ChapterReadiness,
  type ChapterVersion,
  type ChapterWorkspace,
  type GenerationJob,
  type WorkOverview,
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
  const [generationBusy, setGenerationBusy] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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
        ]);
      } else {
        setVersions([]);
        setGenerationJob(null);
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
    generationJob &&
    ["queued", "preparing", "running", "paused", "waiting_review"].includes(generationJob.status),
  );
  const canGenerate = Boolean(
    selected?.readiness.canStartWriting && !generationActive && !generationBusy,
  );
  const comparisonLeft = versions.find((version) => version.id === leftVersionId);
  const comparisonRight = versions.find((version) => version.id === rightVersionId);

  async function selectChapter(chapter: ChapterWorkspace) {
    setSelectedId(chapter.id);
    setContent(chapter.currentVersion?.content ?? "");
    setSavedContent(chapter.currentVersion?.content ?? "");
    setActionError("");
    setSaved(false);
    if (work) {
      try {
        await loadVersions(work, chapter.id);
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "版本加载失败。");
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
    if (latest && isActiveGeneration(latest.status)) {
      watchGeneration(workData, latest.id);
    } else {
      closeGenerationStream();
    }
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
        }
      }
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
            {work.title} · 第 {selected.order} 章 · {statusLabels[selected.status]}
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
                <span>{chapter.order}</span>
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
            </div>
            <span className={`writing-save-state${dirty ? " dirty" : ""}`}>
              {saving ? "保存中" : saved ? "已保存" : dirty ? "有未保存修改" : "版本已同步"}
            </span>
          </div>
          <div className="writing-paper">
            <div className="writing-chapter-heading">
              <span>
                第 {selected.order} 章 ·{" "}
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
                      <small>{generationJob.error.code}</small>
                    </div>
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
  return ["queued", "preparing", "running", "paused", "waiting_review"].includes(status);
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
