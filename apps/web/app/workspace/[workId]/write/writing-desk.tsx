'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { CONTINUITY_ISSUE_CATEGORIES, countCjkCharacters } from '@novel/contracts';
import { ApiError, apiRequest, friendlyError, type User } from '../../../../lib/auth-api';
import {
  generationErrorMessage,
  generationEventsUrl,
  ignoreContinuityIssue,
  loadChapter,
  loadChapters,
  loadContinuityIssues,
  loadGenerationJob,
  loadWritingInsights,
  restoreChapterVersion,
  saveChapterAutosave,
  saveChapterVersion,
  startChapterAction,
  updateChapterMetadata,
  type ChapterDetail,
  type ChapterListItem,
  type ChapterVersion,
  type ContinuityIssue,
  type GenerationEvent,
  type GenerationJob,
  type WritingAction,
  type WritingInsights,
  type WritingOutputKind,
  type WritingQualityTier,
  type WritingRequest,
} from '../../../../lib/chapter-generation-api';
import {
  type ModelConfig,
  type ModelConfigListResponse,
} from '../../../../lib/model-configs-api';
import { loadStoryBible, type StoryBible } from '../../../../lib/story-planning-api';
import { GENRE_LABELS, type Work } from '../../../../lib/works-api';
import { ContinuityReviewPanel } from './continuity-review-panel';
import { FactReviewPanel } from './fact-review-panel';
import {
  CharacterStatePanel,
  ForeshadowPanel,
  QualityReportPanel,
  SuggestionsPanel,
  VersionHistoryPanel,
  type AssistantOutput,
} from './writing-insight-panels';

type BootState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      branchId: string;
      storyBible: StoryBible | null;
      chapters: ChapterListItem[];
      models: ModelConfig[];
    }
  | { status: 'error'; message: string; notFound: boolean };

type GenerationState = 'idle' | 'preparing' | 'streaming' | 'completed' | 'failed';
type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type InsightTab =
  | 'suggestions'
  | 'continuity'
  | 'quality'
  | 'foreshadows'
  | 'characters'
  | 'versions';

type WritingControls = {
  qualityTier: WritingQualityTier;
  modelConfigId: string;
  targetWordCount: number;
  pov: string;
  mustInclude: string;
  mustAvoid: string;
  referenceChapters: number[];
  tabooWords: string;
  instruction: string;
};

type SelectionRange = {
  start: number;
  end: number;
};

type GenerationRun = {
  action: WritingAction;
  outputKind: WritingOutputKind;
  baseContent: string;
  start: number;
  end: number;
  streamText: string;
};

const STEP_MESSAGES: Record<string, string> = {
  readiness: '正在核对章纲和故事设定…',
  brief: '正在整理本次写作任务…',
  context: '正在准备本章参考资料…',
  draft: '正在起草正文…',
  verify: '正在检查前后设定…',
};

const QUALITY_LABELS: Record<WritingQualityTier, string> = {
  fast: '快速',
  standard: '标准',
  premium: '精品',
};

const ACTION_LABELS: Record<WritingAction, string> = {
  chapter: '整章',
  continue: '续写',
  rewrite: '选中重写',
  expand: '扩写',
  condense: '缩写',
  change_pov: '转换视角',
  hooks: '章末钩子',
  title: '标题',
  summary: '摘要',
};

const DEFAULT_TARGET_WORDS = 2_500;

export function WritingDesk({ workId }: { workId: string }) {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [chapterNumber, setChapterNumber] = useState<number>();
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [content, setContent] = useState('');
  const [chapterLoading, setChapterLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [currentAction, setCurrentAction] = useState<WritingAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [completionLabel, setCompletionLabel] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previousContent, setPreviousContent] = useState('');
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 });
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [continuityLoading, setContinuityLoading] = useState(false);
  const [continuityBusyId, setContinuityBusyId] = useState<string>();
  const [continuityError, setContinuityError] = useState('');
  const [continuityNotice, setContinuityNotice] = useState('');
  const [insights, setInsights] = useState<WritingInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [activePanel, setActivePanel] = useState<InsightTab>('suggestions');
  const [assistantOutputs, setAssistantOutputs] = useState<AssistantOutput[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [restoringVersionId, setRestoringVersionId] = useState<string>();
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [autosaveError, setAutosaveError] = useState('');
  const [lastAutosaveAt, setLastAutosaveAt] = useState('');
  const [writingControls, setWritingControls] = useState<WritingControls>({
    qualityTier: 'standard',
    modelConfigId: '',
    targetWordCount: DEFAULT_TARGET_WORDS,
    pov: '',
    mustInclude: '',
    mustAvoid: '',
    referenceChapters: [],
    tabooWords: '',
    instruction: '',
  });
  const [highlightScrollbarWidth, setHighlightScrollbarWidth] = useState(0);
  const streamRef = useRef<EventSource | null>(null);
  const runRef = useRef<GenerationRun | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightBackdropRef = useRef<HTMLDivElement | null>(null);
  const continuityCategories = new Set<string>(CONTINUITY_ISSUE_CATEGORIES);
  const continuityPanelIssues =
    insights?.continuity ??
    continuityIssues.filter((issue) => continuityCategories.has(issue.category));
  const openHighlights = continuityIssues.filter((issue) => issue.status === 'open');
  const bodyHighlightRanges = buildBodyHighlightRanges(content, openHighlights);
  const hasBodyHighlights = bodyHighlightRanges.length > 0;
  const hasSelection = selection.end > selection.start;
  const models = boot.status === 'ready' ? boot.models : [];
  const busy = generating || chapterLoading;

  useEffect(() => {
    let active = true;

    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<Work>(`/api/v1/works/${workId}`),
    ])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          throw new Error('这部作品还没有可用的创作线。');
        }
        const [storyBible, chapterList, modelList] = await Promise.all([
          loadStoryBible(work.id, work.mainBranch.id),
          loadChapters(work.id, work.mainBranch.id),
          apiRequest<ModelConfigListResponse>('/api/v1/model-configs'),
        ]);
        if (!active) {
          return;
        }

        const proseModels = modelList.items.filter((model) => model.purpose === 'prose');
        const defaultModelId =
          modelList.effectivePurposes.prose.configId ??
          proseModels[0]?.id ??
          modelList.items[0]?.id ??
          '';
        setBoot({
          status: 'ready',
          user,
          work,
          branchId: work.mainBranch.id,
          storyBible,
          chapters: chapterList.items,
          models: modelList.items,
        });
        setChapters(chapterList.items);
        setWritingControls((current) => ({
          ...current,
          modelConfigId: defaultModelId,
        }));
        if (chapterList.items.length > 0) {
          const first = chapterList.items[0];
          setChapterNumber(first.chapterNumber);
          const opened = await loadChapter(work.id, work.mainBranch.id, first.chapterNumber);
          if (active) {
            setDetail(opened);
            setContent(initialChapterContent(opened));
            setWritingControls((current) => ({
              ...current,
              pov: opened.outline.pov,
            }));
          }
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        if (loadError instanceof ApiError && loadError.status === 401) {
          router.replace('/login');
          return;
        }
        setBoot({
          status: 'error',
          message: friendlyError(loadError),
          notFound: loadError instanceof ApiError && loadError.code === 'WORK_NOT_FOUND',
        });
      });

    return () => {
      active = false;
      streamRef.current?.close();
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [router, workId]);

  useEffect(() => {
    if (boot.status !== 'ready' || !chapterNumber) {
      setContinuityIssues([]);
      setInsights(null);
      return;
    }

    let active = true;
    setContinuityLoading(true);
    setInsightsLoading(true);
    setContinuityError('');
    setInsightsError('');
    Promise.all([
      loadContinuityIssues(boot.work.id, boot.branchId, chapterNumber),
      loadWritingInsights(boot.work.id, boot.branchId, chapterNumber),
    ])
      .then(([issueResult, insightResult]) => {
        if (!active) {
          return;
        }
        setContinuityIssues(issueResult.items);
        setInsights(insightResult);
        if (
          issueResult.items.some(
            (issue) => continuityCategories.has(issue.category),
          ) &&
          insightResult.suggestions.length === 0
        ) {
          setActivePanel((current) =>
            current === 'suggestions' ? 'continuity' : current,
          );
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        const message = friendlyError(loadError);
        setContinuityError(message);
        setInsightsError(message);
      })
      .finally(() => {
        if (active) {
          setContinuityLoading(false);
          setInsightsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [boot, chapterNumber, generationState]);

  useEffect(() => {
    if (!hasBodyHighlights) {
      setHighlightScrollbarWidth(0);
      return;
    }

    const textarea = bodyTextareaRef.current;
    if (!textarea) {
      return;
    }

    const measure = () => {
      const styles = window.getComputedStyle(textarea);
      const borderWidth =
        Number.parseFloat(styles.borderLeftWidth) +
        Number.parseFloat(styles.borderRightWidth);
      setHighlightScrollbarWidth(
        Math.max(0, Math.round(textarea.offsetWidth - textarea.clientWidth - borderWidth)),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [hasBodyHighlights]);

  useEffect(() => {
    const textarea = bodyTextareaRef.current;
    const backdrop = highlightBackdropRef.current;
    if (!textarea || !backdrop) {
      return;
    }
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  }, [content, hasBodyHighlights]);

  async function openChapter(nextChapterNumber: number) {
    if (boot.status !== 'ready' || generating) {
      return;
    }
    closeStream();
    cancelAutosave();
    setChapterLoading(true);
    setError('');
    setNotice('');
    setGenerationState('idle');
    setCompletionLabel('');
    setStatusMessage('');
    setContinuityNotice('');
    setContinuityError('');
    setInsightsError('');
    setAssistantOutputs([]);
    setSelectedVersionId(undefined);
    setAutosaveState('idle');
    setAutosaveError('');
    setLastAutosaveAt('');

    try {
      const opened = await loadChapter(boot.work.id, boot.branchId, nextChapterNumber);
      setChapterNumber(nextChapterNumber);
      setDetail(opened);
      setContent(initialChapterContent(opened));
      setSelection({ start: 0, end: 0 });
      setWritingControls((current) => ({
        ...current,
        pov: opened.outline.pov,
      }));
    } catch (loadError) {
      setError(friendlyError(loadError));
    } finally {
      setChapterLoading(false);
    }
  }

  async function runWritingAction(action: WritingAction) {
    if (boot.status !== 'ready' || !chapterNumber || generating) {
      return;
    }

    const segmentActions: WritingAction[] = [
      'rewrite',
      'expand',
      'condense',
      'change_pov',
    ];
    const textarea = bodyTextareaRef.current;
    const selectedStart = textarea?.selectionStart ?? selection.start;
    const selectedEnd = textarea?.selectionEnd ?? selection.end;
    const selectedText = content.slice(selectedStart, selectedEnd);
    if (segmentActions.includes(action) && !selectedText.trim()) {
      setError('先在正文里选中一段文字，再使用这个改写动作。');
      return;
    }
    if (['hooks', 'title', 'summary'].includes(action) && !content.trim()) {
      setError('正文还是空的，先写一点内容再生成。');
      return;
    }

    const outputKind = outputKindForAction(action);
    const start = action === 'continue' ? selectedStart : selectedStart;
    const end = segmentActions.includes(action) ? selectedEnd : action === 'continue' ? selectedStart : 0;
    const run: GenerationRun = {
      action,
      outputKind,
      baseContent: content,
      start,
      end,
      streamText: '',
    };
    runRef.current = run;
    closeStream();
    setPreviousContent(content);
    setGenerating(true);
    setCurrentAction(action);
    setGenerationState('preparing');
    setCompletionLabel('');
    setStatusMessage(actionMessage(action));
    setError('');
    setNotice('');
    setActivePanel(
      action === 'hooks' || action === 'title' || action === 'summary'
        ? 'suggestions'
        : activePanel,
    );
    if (action === 'chapter') {
      setContent('');
    }

    try {
      const started = await startChapterAction(
        boot.work.id,
        boot.branchId,
        chapterNumber,
        action,
        buildWritingRequest(action, selectedText, selectedStart, selectedEnd),
      );
      connectToEvents(started.jobId, boot.work.id, boot.branchId, run);
    } catch (startError) {
      setGenerating(false);
      setCurrentAction(null);
      setGenerationState('failed');
      setContent(content);
      setStatusMessage('');
      setError(
        startError instanceof ApiError && startError.code === 'SELECTION_REQUIRED'
          ? '先在正文里选中一段文字，再使用这个改写动作。'
          : generationErrorMessage(startError),
      );
    }
  }

  function buildWritingRequest(
    action: WritingAction,
    selectedText: string,
    selectedStart: number,
    selectedEnd: number,
  ): WritingRequest {
    const targetWordCount = Math.min(
      20_000,
      Math.max(1, Number(writingControls.targetWordCount) || DEFAULT_TARGET_WORDS),
    );
    const selectionCharacters = Math.max(
      1,
      countCjkCharacters(selectedText) || selectedText.length,
    );
    let targetMinCharacters = targetWordCount;
    let targetMaxCharacters = targetWordCount;
    if (action === 'continue') {
      targetMinCharacters = Math.max(1, Math.floor(targetWordCount * 0.6));
      targetMaxCharacters = targetWordCount;
    } else if (action === 'expand') {
      targetMinCharacters = Math.ceil(selectionCharacters * 1.25);
      targetMaxCharacters = Math.max(targetMinCharacters + 20, Math.ceil(selectionCharacters * 2));
    } else if (action === 'condense') {
      targetMinCharacters = Math.max(1, Math.floor(selectionCharacters * 0.35));
      targetMaxCharacters = Math.max(targetMinCharacters, Math.ceil(selectionCharacters * 0.75));
    } else if (['rewrite', 'change_pov'].includes(action)) {
      targetMinCharacters = Math.max(1, Math.floor(selectionCharacters * 0.75));
      targetMaxCharacters = Math.max(targetMinCharacters, Math.ceil(selectionCharacters * 1.35));
    }

    return {
      qualityTier: writingControls.qualityTier,
      ...(writingControls.modelConfigId
        ? { modelConfigId: writingControls.modelConfigId }
        : {}),
      targetMinCharacters,
      targetMaxCharacters,
      pov: writingControls.pov.trim(),
      ...(action === 'change_pov' ? { targetPov: writingControls.pov.trim() } : {}),
      mustInclude: splitWritingList(writingControls.mustInclude),
      mustAvoid: splitWritingList(writingControls.mustAvoid),
      referenceChapters: writingControls.referenceChapters,
      tabooWords: splitWritingList(writingControls.tabooWords),
      ...(writingControls.instruction.trim()
        ? { instruction: writingControls.instruction.trim() }
        : {}),
      content,
      ...(action === 'rewrite' || action === 'expand' || action === 'condense' || action === 'change_pov'
        ? {
            selection: selectedText,
            selectionStart: selectedStart,
            selectionEnd: selectedEnd,
          }
        : {}),
      ...(action === 'continue' ? { cursorOffset: selectedStart } : {}),
    };
  }

  function connectToEvents(
    jobId: string,
    workIdValue: string,
    branchId: string,
    run: GenerationRun,
  ) {
    const source = new EventSource(generationEventsUrl(workIdValue, branchId, jobId));
    streamRef.current = source;

    const onEvent = (event: MessageEvent<string>) => {
      const parsed = parseGenerationEvent(event);
      if (!parsed) {
        return;
      }
      const { type, data } = parsed;

      if (type === 'job.draft.delta') {
        const delta = typeof data.delta === 'string' ? data.delta : '';
        run.streamText += delta;
        applyLivePreview(run);
        setGenerationState('streaming');
        setStatusMessage(actionMessage(run.action));
        return;
      }

      if (type === 'job.draft.reset') {
        run.streamText = '';
        applyLivePreview(run);
        setGenerationState('streaming');
        setStatusMessage('正在按新的篇幅要求重新生成…');
        return;
      }

      if (type === 'job.draft.correcting') {
        setStatusMessage('正在校正篇幅…');
        return;
      }

      if (type === 'job.step.started' && typeof data.stepKey === 'string') {
        setStatusMessage(STEP_MESSAGES[data.stepKey] ?? '正在推进这一章…');
        return;
      }

      if (type === 'job.completed') {
        void finishFromJob(jobId, workIdValue, branchId, run, 'completed');
        return;
      }

      if (type === 'job.failed') {
        void finishFromJob(jobId, workIdValue, branchId, run, 'failed');
      }
    };

    for (const eventType of [
      'job.created',
      'job.preparing',
      'job.step.started',
      'job.step.succeeded',
      'job.draft.delta',
      'job.draft.reset',
      'job.draft.correcting',
      'job.completed',
      'job.failed',
    ]) {
      source.addEventListener(eventType, onEvent as EventListener);
    }

    source.onerror = () => {
      if (runRef.current) {
        setStatusMessage('连接有些慢，正在恢复生成进度…');
      }
    };
  }

  function applyLivePreview(run: GenerationRun) {
    if (run.outputKind === 'chapter' || run.outputKind === 'segment') {
      setContent(previewContent(run, run.streamText));
    }
  }

  async function finishFromJob(
    jobId: string,
    workIdValue: string,
    branchId: string,
    run: GenerationRun,
    expected: 'completed' | 'failed',
  ) {
    closeStream();
    try {
      const job = await loadGenerationJob(workIdValue, branchId, jobId);
      applyJobResult(job, run, expected);
    } catch {
      setGenerating(false);
      setCurrentAction(null);
      setGenerationState('failed');
      setStatusMessage('');
      setError('暂时无法确认生成结果，已经写出的内容仍留在编辑器里。');
    }
  }

  function applyJobResult(
    job: GenerationJob,
    run: GenerationRun,
    expected: 'completed' | 'failed',
  ) {
    const draftContent = job.draft?.content ?? run.streamText;
    const completed = job.status === 'completed' || expected === 'completed';
    setGenerating(false);
    setCurrentAction(null);
    runRef.current = null;

    if (completed) {
      if (run.outputKind === 'chapter' || run.outputKind === 'segment') {
        const nextContent = previewContent(run, draftContent || run.baseContent);
        setContent(nextContent);
        scheduleAutosave(nextContent);
      } else if (draftContent.trim()) {
        const outputKind = run.outputKind;
        setAssistantOutputs((current) => [
          {
            id: `${job.id}-${outputKind}`,
            kind: outputKind,
            content: draftContent.trim(),
            createdAt: new Date().toISOString(),
          },
          ...current.filter((output) => output.kind !== outputKind),
        ]);
      }
      setGenerationState('completed');
      setCompletionLabel(completionText(run));
      setStatusMessage('');
      setNotice(completionNotice(run));
      void refreshChapterSummary(job, run);
      return;
    }

    if (run.outputKind === 'chapter' || run.outputKind === 'segment') {
      const preserved = draftContent.trim()
        ? previewContent(run, draftContent)
        : run.baseContent;
      setContent(preserved);
      if (draftContent.trim()) {
        scheduleAutosave(preserved);
      }
    }
    setGenerationState('failed');
    setCompletionLabel('等待处理');
    setStatusMessage('');
    setError(jobFailureMessage(job));
    void refreshChapterSummary(job, run);
  }

  async function refreshChapterSummary(job: GenerationJob, run: GenerationRun) {
    if (boot.status !== 'ready') {
      return;
    }
    try {
      const refreshed = await loadChapters(boot.work.id, boot.branchId);
      setChapters(refreshed.items);
      setDetail((current) =>
        current
          ? {
              ...current,
              latestDraft:
                job.draft && run.outputKind === 'chapter'
                  ? {
                      id: job.draft.id,
                      jobId: job.id,
                      status: job.draft.status,
                      content: job.draft.content,
                      error: job.error,
                      updatedAt: job.draft.updatedAt,
                    }
                  : current.latestDraft,
            }
          : current,
      );
    } catch {
      // The editor already has the recoverable draft; refreshing the list is best effort.
    }
  }

  function scheduleAutosave(nextContent: string) {
    if (boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    cancelAutosave();
    setAutosaveError('');
    setAutosaveState('pending');
    const targetChapter = chapterNumber;
    autosaveTimerRef.current = setTimeout(() => {
      setAutosaveState('saving');
      saveChapterAutosave(boot.work.id, boot.branchId, targetChapter, nextContent)
        .then((saved) => {
          setAutosaveState('saved');
          setLastAutosaveAt(saved.updatedAt);
          setDetail((current) =>
            current && chapterNumber === targetChapter
              ? {
                  ...current,
                  autosave: {
                    content: saved.content,
                    wordCount: saved.wordCount,
                    updatedAt: saved.updatedAt,
                  },
                }
              : current,
          );
        })
        .catch((saveError: unknown) => {
          setAutosaveState('error');
          setAutosaveError(friendlyError(saveError));
        });
    }, 1_100);
  }

  function cancelAutosave() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }

  async function saveVersion() {
    if (boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    if (!content.trim()) {
      setError('正文还是空的，先写一点内容再保存。');
      return;
    }

    cancelAutosave();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveChapterVersion(
        boot.work.id,
        boot.branchId,
        chapterNumber,
        content,
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              status: 'writing',
              statusLabel: '写作中',
              wordCount: saved.wordCount,
              content,
              currentVersion: saved,
              versions: [
                saved,
                ...current.versions.filter((version) => version.id !== saved.id),
              ],
            }
          : current,
      );
      setChapters((current) =>
        current.map((chapter) =>
          chapter.chapterNumber === chapterNumber
            ? {
                ...chapter,
                status: 'writing',
                statusLabel: '写作中',
                wordCount: saved.wordCount,
                hasContent: true,
              }
            : chapter,
        ),
      );
      setAutosaveState('saved');
      setLastAutosaveAt(saved.createdAt);
      setNotice(`版本 ${saved.version} 已保存`);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion(version: ChapterVersion) {
    if (boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    cancelAutosave();
    setRestoringVersionId(version.id);
    setError('');
    setNotice('');
    try {
      const restored = await restoreChapterVersion(
        boot.work.id,
        boot.branchId,
        chapterNumber,
        version.id,
      );
      setContent(restored.content);
      setSelection({ start: 0, end: 0 });
      setSelectedVersionId(restored.id);
      setDetail((current) =>
        current
          ? {
              ...current,
              status: 'writing',
              statusLabel: '写作中',
              wordCount: restored.wordCount,
              content: restored.content,
              currentVersion: restored,
              versions: [
                restored,
                ...current.versions.filter((item) => item.id !== restored.id),
              ],
              autosave: null,
            }
          : current,
      );
      setChapters((current) =>
        current.map((chapter) =>
          chapter.chapterNumber === chapterNumber
            ? {
                ...chapter,
                status: 'writing',
                statusLabel: '写作中',
                wordCount: restored.wordCount,
                hasContent: true,
              }
            : chapter,
        ),
      );
      setAutosaveState('saved');
      setLastAutosaveAt(restored.createdAt);
      setNotice(`已恢复版本 ${version.version}，并保留为新版本 ${restored.version}`);
    } catch (restoreError) {
      setError(friendlyError(restoreError));
    } finally {
      setRestoringVersionId(undefined);
    }
  }

  function restorePrevious() {
    setContent(previousContent);
    setSelection({ start: 0, end: 0 });
    setError('');
    setGenerationState('idle');
    setCompletionLabel('');
    setNotice('已恢复生成前的内容。');
    scheduleAutosave(previousContent);
  }

  async function ignoreIssue(issue: ContinuityIssue, reason: string) {
    if (boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    setContinuityBusyId(issue.id);
    setContinuityError('');
    setContinuityNotice('');
    try {
      const updated = await ignoreContinuityIssue(
        boot.work.id,
        boot.branchId,
        chapterNumber,
        issue.id,
        reason,
      );
      setContinuityIssues((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setInsights((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.map((item) =>
                item.id === updated.id ? updated : item,
              ),
              continuity: current.continuity.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      setContinuityNotice('已忽略这条提示，并记录了你填写的原因。');
    } catch (ignoreError) {
      setContinuityError(friendlyError(ignoreError));
    } finally {
      setContinuityBusyId(undefined);
    }
  }

  function locateIssue(issue: ContinuityIssue) {
    const textarea = bodyTextareaRef.current;
    if (!textarea) {
      return;
    }
    let start = issue.startOffset;
    let end = issue.endOffset;
    if (content.slice(start, end) !== issue.sourceSentence) {
      const index = content.indexOf(issue.sourceSentence);
      if (index < 0) {
        setError('正文已经改动，这条批注对应的原句暂时找不到了。');
        return;
      }
      start = index;
      end = index + issue.sourceSentence.length;
    }
    textarea.focus();
    textarea.setSelectionRange(start, end);
    setSelection({ start, end });
    setActivePanel(
      continuityCategories.has(issue.category) ? 'continuity' : 'suggestions',
    );
  }

  async function applyTitle(title: string) {
    if (boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    try {
      const updated = await updateChapterMetadata(
        boot.work.id,
        boot.branchId,
        chapterNumber,
        { title },
      );
      setDetail((current) => (current ? { ...current, title: updated.title } : current));
      setChapters((current) =>
        current.map((chapter) =>
          chapter.chapterNumber === chapterNumber
            ? { ...chapter, title: updated.title }
            : chapter,
        ),
      );
      setNotice('章名已更新。');
    } catch (updateError) {
      setError(friendlyError(updateError));
    }
  }

  async function saveSummary(summary: string) {
    if (boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    try {
      const updated = await updateChapterMetadata(
        boot.work.id,
        boot.branchId,
        chapterNumber,
        { summary },
      );
      setDetail((current) => (current ? { ...current, summary: updated.summary } : current));
      setNotice('本章摘要已保存。');
    } catch (updateError) {
      setError(friendlyError(updateError));
    }
  }

  function appendHook(hook: string) {
    const nextContent = `${content.trimEnd()}\n\n${hook}`;
    setContent(nextContent);
    scheduleAutosave(nextContent);
    setNotice('章末钩子已放到正文末尾。');
  }

  function closeStream() {
    streamRef.current?.close();
    streamRef.current = null;
  }

  function updateSelectionFromTextarea(textarea: HTMLTextAreaElement) {
    setSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }

  function syncHighlightScroll(event: UIEvent<HTMLTextAreaElement>) {
    updateSelectionFromTextarea(event.currentTarget);
    const backdrop = highlightBackdropRef.current;
    if (!backdrop) {
      return;
    }
    backdrop.scrollTop = event.currentTarget.scrollTop;
    backdrop.scrollLeft = event.currentTarget.scrollLeft;
  }

  if (boot.status === 'loading') {
    return (
      <main className="writing-shell">
        <p className="workspace-loading">正在打开写作台…</p>
      </main>
    );
  }

  if (boot.status === 'error') {
    return (
      <main className="writing-shell">
        <section className="workspace-error">
          <h1>{boot.notFound ? '没有找到这部作品' : '暂时无法打开写作台'}</h1>
          <p>{boot.message}</p>
          <Link className="secondary-button back-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="writing-shell">
      <header className="writing-header">
        <div className="writing-header-main">
          <Link className="workspace-brand" href="/workspace">
            NovelBrain
          </Link>
          <span className="writing-header-divider" aria-hidden="true" />
          <div>
            <p>{GENRE_LABELS[boot.work.genrePack] ?? boot.work.genrePack}</p>
            <strong>{boot.work.title}</strong>
          </div>
        </div>
        <nav className="workspace-nav" aria-label="写作台导航">
          <Link href={`/workspace/${boot.work.id}`}>作品与章纲</Link>
          <Link href="/workspace/settings">模型设置</Link>
        </nav>
      </header>

      {chapters.length === 0 ? (
        <section className="writing-empty">
          <p className="workspace-step">写作台</p>
          <h1>还没有可写的章节</h1>
          <p>先在作品页保存第一章的章纲，写作台就会在这里等你。</p>
          <Link className="primary-button back-button" href={`/workspace/${boot.work.id}`}>
            去准备章纲
          </Link>
        </section>
      ) : (
        <div className="writing-desk">
          <aside className="writing-chapters" aria-labelledby="writing-chapters-title">
            <div className="writing-panel-heading">
              <p className="workspace-step">章节</p>
              <h2 id="writing-chapters-title">写作进度</h2>
              <span>{chapters.length} 章</span>
            </div>
            <div className="writing-chapter-list">
              {chapters.map((chapter) => (
                <button
                  aria-current={chapter.chapterNumber === chapterNumber ? 'page' : undefined}
                  className="writing-chapter-item"
                  disabled={busy}
                  key={chapter.chapterNumber}
                  onClick={() => void openChapter(chapter.chapterNumber)}
                  type="button"
                >
                  <span className="writing-chapter-number">{chapter.chapterNumber}</span>
                  <span className="writing-chapter-copy">
                    <strong>{chapter.title}</strong>
                    <small>{chapter.goal}</small>
                  </span>
                  <span className="writing-chapter-meta">
                    {chapter.wordCount > 0
                      ? `${chapter.wordCount.toLocaleString('zh-CN')} 字`
                      : chapter.statusLabel}
                  </span>
                </button>
              ))}
            </div>
            <div className="writing-chapter-foot">
              <p>章节、正文和参考面板同屏工作，改动会自动保存。</p>
              <Link href={`/workspace/${boot.work.id}`}>调整章纲</Link>
            </div>
          </aside>

          <section className="writing-editor" aria-labelledby="writing-editor-title">
            <div className="writing-editor-heading">
              <div>
                <p className="workspace-step">
                  {detail?.statusLabel ?? '已规划'} · {boot.work.penName}
                </p>
                <h1 id="writing-editor-title">{detail?.title ?? `第 ${chapterNumber} 章`}</h1>
                <p>{detail?.outline.chapterGoal}</p>
              </div>
              <span className={`writing-status writing-status-${generationState}`}>
                {currentAction
                  ? `正在${ACTION_LABELS[currentAction]}`
                  : generationState === 'preparing'
                    ? '准备中'
                    : generationState === 'streaming'
                      ? '生成中'
                      : generationState === 'completed'
                        ? completionLabel || '已完成'
                        : generationState === 'failed'
                          ? completionLabel || '等待处理'
                          : detail?.statusLabel ?? '可编辑'}
              </span>
            </div>

            <WritingControlsPanel
              chapters={chapters}
              models={models}
              onChange={(next) => setWritingControls(next)}
              controls={writingControls}
            />

            <div className="writing-action-grid" aria-label="写作动作">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void runWritingAction('chapter')}
                type="button"
              >
                {generating && currentAction === 'chapter' ? '正在生成…' : '根据章纲生成'}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void runWritingAction('continue')}
                type="button"
              >
                从光标续写
              </button>
              <button
                className="secondary-button"
                disabled={busy || !hasSelection}
                onClick={() => void runWritingAction('rewrite')}
                type="button"
              >
                重写选中
              </button>
              <button
                className="secondary-button"
                disabled={busy || !hasSelection}
                onClick={() => void runWritingAction('expand')}
                type="button"
              >
                扩写选中
              </button>
              <button
                className="secondary-button"
                disabled={busy || !hasSelection}
                onClick={() => void runWritingAction('condense')}
                type="button"
              >
                缩写选中
              </button>
              <button
                className="secondary-button"
                disabled={busy || !hasSelection}
                onClick={() => void runWritingAction('change_pov')}
                type="button"
              >
                转换选中视角
              </button>
              <button
                className="secondary-button"
                disabled={busy || !content.trim()}
                onClick={() => void runWritingAction('hooks')}
                type="button"
              >
                生成章末钩子
              </button>
              <button
                className="secondary-button"
                disabled={busy || !content.trim()}
                onClick={() => void runWritingAction('title')}
                type="button"
              >
                生成标题
              </button>
              <button
                className="secondary-button"
                disabled={busy || !content.trim()}
                onClick={() => void runWritingAction('summary')}
                type="button"
              >
                生成摘要
              </button>
              <button
                className="secondary-button"
                disabled={saving || generating || !content.trim()}
                onClick={() => void saveVersion()}
                type="button"
              >
                {saving ? '正在保存…' : '保存版本'}
              </button>
            </div>

            <div className="writing-toolbar">
              <span aria-live="polite" className="writing-live-status">
                {statusMessage || (generating ? '正在连接写作服务…' : '')}
              </span>
              <span className={`writing-autosave writing-autosave-${autosaveState}`}>
                {autosaveState === 'pending'
                  ? '等待自动保存…'
                  : autosaveState === 'saving'
                    ? '正在自动保存…'
                    : autosaveState === 'saved'
                      ? `已自动保存${lastAutosaveAt ? ` · ${formatClock(lastAutosaveAt)}` : ''}`
                      : autosaveState === 'error'
                        ? '自动保存暂时失败'
                        : '自动保存已开启'}
              </span>
            </div>

            {autosaveError ? (
              <p className="form-message form-message-error" role="status">
                {autosaveError}
              </p>
            ) : null}
            {error ? (
              <div className="writing-error" role="alert">
                <p>{error}</p>
                <div>
                  <button
                    className="secondary-button"
                    disabled={generating}
                    onClick={() =>
                      void runWritingAction(currentAction ?? 'chapter')
                    }
                    type="button"
                  >
                    再试一次
                  </button>
                  <button
                    className="text-button"
                    disabled={generating || !previousContent}
                    onClick={restorePrevious}
                    type="button"
                  >
                    恢复生成前内容
                  </button>
                </div>
              </div>
            ) : null}
            {notice ? (
              <p className="form-message form-message-success writing-notice" role="status">
                {notice}
              </p>
            ) : null}

            <label className="writing-editor-label" htmlFor="chapter-content">
              正文
            </label>
            <div
              className={`writing-editor-surface${
                hasBodyHighlights ? ' writing-editor-surface-highlighted' : ''
              }`}
            >
              {hasBodyHighlights ? (
                <div
                  aria-hidden="true"
                  className="writing-highlight-backdrop"
                  ref={highlightBackdropRef}
                  style={{ right: `${highlightScrollbarWidth}px` }}
                >
                  <div className="writing-highlight-content">
                    {renderBodyWithHighlights(content, bodyHighlightRanges)}
                  </div>
                </div>
              ) : null}
              <textarea
                aria-label="章节正文"
                className={`writing-textarea${
                  hasBodyHighlights ? ' writing-textarea-highlighted' : ''
                }`}
                id="chapter-content"
                onChange={(event) => {
                  const nextContent = event.target.value;
                  setContent(nextContent);
                  updateSelectionFromTextarea(event.currentTarget);
                  scheduleAutosave(nextContent);
                  if (notice) {
                    setNotice('');
                  }
                }}
                onKeyUp={(event) => updateSelectionFromTextarea(event.currentTarget)}
                onMouseUp={(event) => updateSelectionFromTextarea(event.currentTarget)}
                onScroll={syncHighlightScroll}
                onSelect={(event) => updateSelectionFromTextarea(event.currentTarget)}
                placeholder="正文会在这里出现，也可以直接开始写。"
                ref={bodyTextareaRef}
                spellCheck={false}
                value={content}
              />
            </div>

            <footer className="writing-editor-footer">
              <span>{countCjkCharacters(content).toLocaleString('zh-CN')} 字</span>
              <span>
                {countCjkCharacters(content) > 0
                  ? `预计阅读 ${Math.max(1, Math.ceil(countCjkCharacters(content) / 500))} 分钟`
                  : '还没有正文'}
              </span>
              {hasSelection ? (
                <span>已选中 {countCjkCharacters(content.slice(selection.start, selection.end))} 字</span>
              ) : null}
              <span>
                {detail?.versions.length
                  ? `已保存 ${detail.versions.length} 个版本`
                  : '尚未保存版本'}
              </span>
            </footer>
          </section>

          <aside className="writing-context" aria-labelledby="writing-context-title">
            <div className="writing-panel-heading">
              <p className="workspace-step">随手查</p>
              <h2 id="writing-context-title">本章参考</h2>
              <span>建议、连续性、伏笔、人物与版本</span>
            </div>

            {detail ? (
              <>
                <details className="writing-outline-reference">
                  <summary>章纲与故事方向</summary>
                  <dl>
                    <div>
                      <dt>章目标</dt>
                      <dd>{detail.outline.chapterGoal}</dd>
                    </div>
                    <div>
                      <dt>叙事视角</dt>
                      <dd>{detail.outline.pov}</dd>
                    </div>
                    <div>
                      <dt>章末钩子</dt>
                      <dd>{detail.outline.chapterEndHook}</dd>
                    </div>
                    <div>
                      <dt>本章摘要</dt>
                      <dd>{detail.summary || '尚未保存'}</dd>
                    </div>
                  </dl>
                </details>

                <div className="writing-tabs" role="tablist" aria-label="本章参考面板">
                  {[
                    ['suggestions', '建议'],
                    ['continuity', '连续性'],
                    ['quality', '质量'],
                    ['foreshadows', '伏笔'],
                    ['characters', '人物'],
                    ['versions', '版本'],
                  ].map(([key, label]) => (
                    <button
                      aria-selected={activePanel === key}
                      className="writing-tab"
                      key={key}
                      onClick={() => setActivePanel(key as InsightTab)}
                      role="tab"
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {activePanel === 'suggestions' ? (
                  <SuggestionsPanel
                    busyId={continuityBusyId}
                    error={insightsError || continuityError}
                    loading={insightsLoading}
                    notice={continuityNotice}
                    onAppendHook={appendHook}
                    onApplyTitle={applyTitle}
                    onIgnore={ignoreIssue}
                    onLocate={locateIssue}
                    onSaveSummary={saveSummary}
                    outputs={assistantOutputs}
                    suggestions={insights?.suggestions ?? []}
                  />
                ) : null}
                {activePanel === 'continuity' ? (
                  <ContinuityReviewPanel
                    busyId={continuityBusyId}
                    error={continuityError}
                    issues={continuityPanelIssues}
                    loading={continuityLoading}
                    notice={continuityNotice}
                    onIgnore={ignoreIssue}
                  />
                ) : null}
                {activePanel === 'quality' ? (
                  <QualityReportPanel
                    loading={insightsLoading}
                    report={insights?.qualityReport ?? null}
                  />
                ) : null}
                {activePanel === 'foreshadows' ? (
                  <ForeshadowPanel insights={insights} loading={insightsLoading} />
                ) : null}
                {activePanel === 'characters' ? (
                  <CharacterStatePanel insights={insights} loading={insightsLoading} />
                ) : null}
                {activePanel === 'versions' ? (
                  <VersionHistoryPanel
                    currentContent={content}
                    onRestore={restoreVersion}
                    onSelect={setSelectedVersionId}
                    restoringId={restoringVersionId}
                    selectedVersionId={selectedVersionId}
                    versions={detail.versions}
                  />
                ) : null}

                {chapterNumber ? (
                  <FactReviewPanel
                    branchId={boot.branchId}
                    chapterNumber={chapterNumber}
                    refreshKey={generationState}
                    workId={boot.work.id}
                  />
                ) : null}
              </>
            ) : (
              <p className="writing-context-loading">
                {chapterLoading ? '正在打开这一章…' : '选择章节后查看参考资料。'}
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function WritingControlsPanel({
  controls,
  models,
  chapters,
  onChange,
}: {
  controls: WritingControls;
  models: ModelConfig[];
  chapters: ChapterListItem[];
  onChange: (controls: WritingControls) => void;
}) {
  const update = <Key extends keyof WritingControls>(
    key: Key,
    value: WritingControls[Key],
  ) => onChange({ ...controls, [key]: value });

  return (
    <section aria-labelledby="writing-controls-title" className="writing-controls">
      <div className="writing-controls-heading">
        <div>
          <h2 id="writing-controls-title">生成设置</h2>
          <p>这些要求会随每一次生成一起交给正文模型。</p>
        </div>
      </div>

      <div className="writing-control-grid">
        <label className="writing-control-field">
          <span>质量档位</span>
          <select
            onChange={(event) =>
              update('qualityTier', event.target.value as WritingQualityTier)
            }
            value={controls.qualityTier}
          >
            {Object.entries(QUALITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="writing-control-field">
          <span>模型</span>
          <select
            onChange={(event) => update('modelConfigId', event.target.value)}
            value={controls.modelConfigId}
          >
            <option value="">沿用默认正文模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.model}
              </option>
            ))}
          </select>
        </label>
        <label className="writing-control-field">
          <span>目标字数</span>
          <input
            max={20_000}
            min={1}
            onChange={(event) =>
              update('targetWordCount', Number(event.target.value))
            }
            step={100}
            type="number"
            value={controls.targetWordCount}
          />
        </label>
        <label className="writing-control-field">
          <span>叙事视角</span>
          <input
            maxLength={120}
            onChange={(event) => update('pov', event.target.value)}
            placeholder="例如：沈砚"
            type="text"
            value={controls.pov}
          />
        </label>
        <label className="writing-control-field">
          <span>参考章节</span>
          <select
            multiple
            onChange={(event) =>
              update(
                'referenceChapters',
                Array.from(event.target.selectedOptions, (option) => Number(option.value)),
              )
            }
            value={controls.referenceChapters.map(String)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.chapterNumber} value={chapter.chapterNumber}>
                第 {chapter.chapterNumber} 章 · {chapter.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="writing-control-textareas">
        <label className="writing-control-field">
          <span>必须包含</span>
          <textarea
            onChange={(event) => update('mustInclude', event.target.value)}
            placeholder="每行一项，例如：断碑、母亲的家纹"
            rows={2}
            value={controls.mustInclude}
          />
        </label>
        <label className="writing-control-field">
          <span>必须避免</span>
          <textarea
            onChange={(event) => update('mustAvoid', event.target.value)}
            placeholder="每行一项，例如：天降神迹、无代价突破"
            rows={2}
            value={controls.mustAvoid}
          />
        </label>
        <label className="writing-control-field">
          <span>禁忌词</span>
          <textarea
            onChange={(event) => update('tabooWords', event.target.value)}
            placeholder="每行一项，正文会检查是否出现"
            rows={2}
            value={controls.tabooWords}
          />
        </label>
        <label className="writing-control-field">
          <span>补充要求</span>
          <textarea
            onChange={(event) => update('instruction', event.target.value)}
            placeholder="例如：放慢节奏，保留悬念。"
            rows={2}
            value={controls.instruction}
          />
        </label>
      </div>
    </section>
  );
}

type BodyHighlightRange = {
  issueId: string;
  start: number;
  end: number;
};

function buildBodyHighlightRanges(
  content: string,
  issues: ContinuityIssue[],
): BodyHighlightRange[] {
  const ranges = issues
    .map((issue) => {
      let start = issue.startOffset;
      let end = issue.endOffset;
      if (content.slice(start, end) !== issue.sourceSentence) {
        const sourceIndex = content.indexOf(issue.sourceSentence);
        if (sourceIndex < 0) {
          return null;
        }
        start = sourceIndex;
        end = sourceIndex + issue.sourceSentence.length;
      }
      if (start < 0 || end <= start || end > content.length) {
        return null;
      }
      return {
        issueId: issue.id,
        start,
        end,
      };
    })
    .filter((range): range is BodyHighlightRange => range !== null)
    .sort((left, right) => left.start - right.start);

  const nonOverlapping: BodyHighlightRange[] = [];
  for (const range of ranges) {
    const previous = nonOverlapping.at(-1);
    if (!previous || range.start >= previous.end) {
      nonOverlapping.push(range);
    }
  }
  return nonOverlapping;
}

function renderBodyWithHighlights(
  content: string,
  ranges: BodyHighlightRange[],
): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(content.slice(cursor, range.start));
    }
    parts.push(
      <mark
        data-continuity-issue-id={range.issueId}
        data-testid="inline-continuity-mark"
        key={range.issueId}
      >
        {content.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }

  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }
  return parts;
}

function initialChapterContent(detail: ChapterDetail): string {
  const candidates: Array<{ content: string; updatedAt: string }> = [];
  if (detail.autosave?.content) {
    candidates.push({
      content: detail.autosave.content,
      updatedAt: detail.autosave.updatedAt,
    });
  }
  if (detail.latestDraft?.content) {
    candidates.push({
      content: detail.latestDraft.content,
      updatedAt: detail.latestDraft.updatedAt,
    });
  }
  if (detail.currentVersion?.content) {
    candidates.push({
      content: detail.currentVersion.content,
      updatedAt: detail.currentVersion.createdAt,
    });
  }
  candidates.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
  return candidates[0]?.content ?? detail.content;
}

function parseGenerationEvent(event: MessageEvent<string>): GenerationEvent | null {
  try {
    const data = JSON.parse(event.data) as Record<string, unknown>;
    return {
      id: event.lastEventId,
      type: event.type,
      data,
    };
  } catch {
    return null;
  }
}

function previewContent(run: GenerationRun, streamText: string): string {
  if (run.outputKind === 'chapter') {
    return streamText;
  }
  if (run.outputKind !== 'segment') {
    return run.baseContent;
  }
  return `${run.baseContent.slice(0, run.start)}${streamText}${run.baseContent.slice(run.end)}`;
}

function outputKindForAction(action: WritingAction): WritingOutputKind {
  if (action === 'chapter') {
    return 'chapter';
  }
  if (action === 'hooks') {
    return 'hook_options';
  }
  if (action === 'title') {
    return 'title';
  }
  if (action === 'summary') {
    return 'summary';
  }
  return 'segment';
}

function actionMessage(action: WritingAction): string {
  switch (action) {
    case 'chapter':
      return '正在准备这一章…';
    case 'continue':
      return '正在从光标处续写…';
    case 'rewrite':
      return '正在重写选中文字…';
    case 'expand':
      return '正在扩写选中文字…';
    case 'condense':
      return '正在缩写选中文字…';
    case 'change_pov':
      return '正在转换叙事视角…';
    case 'hooks':
      return '正在生成章末钩子…';
    case 'title':
      return '正在生成章名…';
    case 'summary':
      return '正在整理本章摘要…';
  }
}

function completionText(run: GenerationRun): string {
  if (run.outputKind === 'chapter') {
    return '初稿已生成';
  }
  if (run.outputKind === 'segment') {
    return '改写已生成';
  }
  return '建议已生成';
}

function completionNotice(run: GenerationRun): string {
  switch (run.action) {
    case 'chapter':
      return '初稿已生成。你可以继续修改，满意后保存为新版本。';
    case 'continue':
      return '续写已经接在光标处，可以继续打磨。';
    case 'rewrite':
      return '选中文字已经重写，可以对比后继续修改。';
    case 'expand':
      return '选中文字已经扩写。';
    case 'condense':
      return '选中文字已经缩写。';
    case 'change_pov':
      return '选中文字已经转换视角。';
    case 'hooks':
      return '三个章末钩子已经生成，可在建议面板里选用。';
    case 'title':
      return '章名建议已经生成，可在建议面板里采用。';
    case 'summary':
      return '本章摘要已生成，可在建议面板里保存。';
  }
}

function jobFailureMessage(job: GenerationJob): string {
  const code = typeof job.error?.code === 'string' ? job.error.code : '';
  if (code === 'MODEL_CONFIG_REQUIRED') {
    return '还没有可用的正文模型，请先到模型设置里完成配置。已写出的内容不会丢。';
  }
  if (code === 'INVALID_MODEL_KEY') {
    return '正文模型的 API Key 已失效，请到模型设置里更新后再试。已写出的内容不会丢。';
  }
  if (code === 'MODEL_NETWORK_ERROR') {
    return '暂时连不上正文模型，已经写出的内容已保留，可以稍后重试。';
  }
  if (code === 'STORY_BIBLE_REQUIRED') {
    return '故事圣经还没有保存，补全后就能生成这一章。';
  }
  return '这次生成没有完成，已经写出的内容已保留。你可以继续修改，或稍后再试。';
}

function splitWritingList(value: string): string[] {
  return value
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
