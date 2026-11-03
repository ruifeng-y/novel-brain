'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../../../lib/auth-api';
import {
  chapterOptionsFromOutlines,
  controlBatchJob,
  createBatchJob,
  decideReviewItem,
  estimateBatchJob,
  loadBatchJob,
  loadBatchJobs,
  loadBatchReport,
  loadReviewQueue,
  type BatchApprovalMode,
  type BatchJobDetail,
  type BatchJobEstimate,
  type BatchJobReport,
  type BatchJobSummary,
  type BatchChapterOption,
  type BatchScope,
  type ReviewQueueItem,
} from '../../../../lib/batch-jobs-api';
import { loadOutlineNodes, type OutlineNode } from '../../../../lib/story-planning-api';
import { GENRE_LABELS, type Work } from '../../../../lib/works-api';

type ScopeMode = 'chapter' | 'volume' | 'range' | 'book';
type TaskView = 'tasks' | 'review' | 'report';
type RiskFilter = 'all' | 'high' | 'medium' | 'low';

type BootState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      branchId: string;
      chapters: BatchChapterOption[];
      outlines: OutlineNode[];
      volumes: OutlineNode[];
    }
  | { status: 'error'; message: string; notFound: boolean };

const SCOPE_LABELS: Record<ScopeMode, string> = {
  chapter: '按章',
  volume: '按卷',
  range: '自定义区间',
  book: '全本',
};

const QUALITY_LABELS = {
  fast: '快速 · 先出草稿，后统一润色',
  standard: '标准 · 日常章节稳定产出',
  premium: '精品 · 重点章节多轮打磨',
} as const;

const APPROVAL_LABELS: Record<BatchApprovalMode, { label: string; hint: string }> = {
  chapter: { label: '逐章审批', hint: '质量优先，每章都要作者确认' },
  volume: { label: '逐卷审批', hint: '推荐，卷末必须人工确认' },
  auto: { label: '自动通过', hint: '仅限已锁定章纲、标准质量且无高风险' },
};

const RISK_LABELS: Record<RiskFilter, string> = {
  all: '全部风险',
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

export function TaskCenter({
  workId,
  showHeader = true,
}: {
  workId: string;
  showHeader?: boolean;
}) {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [jobs, setJobs] = useState<BatchJobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [detail, setDetail] = useState<BatchJobDetail | null>(null);
  const [report, setReport] = useState<BatchJobReport | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewQueueItem[]>([]);
  const [view, setView] = useState<TaskView>('tasks');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('book');
  const [chapterNumber, setChapterNumber] = useState('');
  const [volumeId, setVolumeId] = useState('');
  const [startChapter, setStartChapter] = useState('1');
  const [endChapter, setEndChapter] = useState('');
  const [qualityTier, setQualityTier] = useState<keyof typeof QUALITY_LABELS>('standard');
  const [approvalMode, setApprovalMode] = useState<BatchApprovalMode>('volume');
  const [targetMinCharacters, setTargetMinCharacters] = useState('2000');
  const [targetMaxCharacters, setTargetMaxCharacters] = useState('3000');
  const [estimate, setEstimate] = useState<BatchJobEstimate | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [ignoreItemId, setIgnoreItemId] = useState('');
  const [ignoreReason, setIgnoreReason] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const selectedJobRef = useRef<string | undefined>(undefined);
  const formRef = useRef<HTMLElement | null>(null);

  selectedJobRef.current = selectedJobId;

  useEffect(() => {
    let active = true;
    Promise.all([apiRequest<User>('/api/v1/auth/me'), apiRequest<Work>(`/api/v1/works/${workId}`)])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          throw new Error('这部作品还没有可用的创作线。');
        }
        const [outlineList, jobList, queue] = await Promise.all([
          loadOutlineNodes(work.id, work.mainBranch.id),
          loadBatchJobs(work.id, work.mainBranch.id),
          loadReviewQueue(work.id, work.mainBranch.id),
        ]);
        if (!active) {
          return;
        }
        const chapters = chapterOptionsFromOutlines(outlineList.items);
        const chapterNumbers = chapters.map((item) => item.chapterNumber);
        setBoot({
          status: 'ready',
          user,
          work,
          branchId: work.mainBranch.id,
          chapters,
          outlines: outlineList.items,
          volumes: outlineList.items.filter((node) => node.level === 'volume'),
        });
        setJobs(jobList.items);
        setReviewItems(queue.items);
        setChapterNumber(String(chapterNumbers[0] ?? 1));
        setEndChapter(String(chapterNumbers.at(-1) ?? 1));
        setVolumeId(outlineList.items.find((node) => node.level === 'volume')?.id ?? '');
        if (!selectedJobRef.current && jobList.items[0]) {
          setSelectedJobId(jobList.items[0].id);
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
    };
  }, [router, workId]);

  useEffect(() => {
    if (boot.status !== 'ready') {
      return;
    }
    const work = boot.work;
    const branchId = boot.branchId;
    let active = true;
    let refreshing = false;

    async function refresh() {
      if (refreshing) {
        return;
      }
      refreshing = true;
      try {
        const [jobList, queue] = await Promise.all([
          loadBatchJobs(work.id, branchId),
          loadReviewQueue(work.id, branchId),
        ]);
        if (!active) {
          return;
        }
        setJobs(jobList.items);
        setReviewItems(queue.items);
        const jobId = selectedJobRef.current;
        if (jobId) {
          const [jobDetail, jobReport] = await Promise.all([
            loadBatchJob(work.id, branchId, jobId),
            loadBatchReport(work.id, branchId, jobId),
          ]);
          if (active) {
            setDetail(jobDetail);
            setReport(jobReport);
          }
        } else {
          setDetail(null);
          setReport(null);
        }
      } catch {
        // The next refresh can recover from a transient read failure.
      } finally {
        refreshing = false;
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [boot.status, selectedJobId]);

  useEffect(() => {
    if (boot.status !== 'ready') {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      estimateBatchJob(boot.work.id, boot.branchId, {
        scope: buildScope({
          mode: scopeMode,
          chapterNumber,
          volumeId,
          startChapter,
          endChapter,
        }),
        settings: {
          qualityTier,
          approvalMode,
          targetMinCharacters: Number(targetMinCharacters),
          targetMaxCharacters: Number(targetMaxCharacters),
        },
      })
        .then((result) => {
          if (active) {
            setEstimate(result);
          }
        })
        .catch(() => {
          if (active) {
            setEstimate(null);
          }
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    approvalMode,
    boot,
    chapterNumber,
    endChapter,
    qualityTier,
    scopeMode,
    startChapter,
    targetMaxCharacters,
    targetMinCharacters,
    volumeId,
  ]);

  function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    setError('');
    setNotice('');
  }

  function focusForm() {
    setView('tasks');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function refreshSelected() {
    if (boot.status !== 'ready') {
      return;
    }
    const jobId = selectedJobId;
    const [jobList, queue] = await Promise.all([
      loadBatchJobs(boot.work.id, boot.branchId),
      loadReviewQueue(boot.work.id, boot.branchId),
    ]);
    setJobs(jobList.items);
    setReviewItems(queue.items);
    if (!jobId) {
      return;
    }
    const [jobDetail, jobReport] = await Promise.all([
      loadBatchJob(boot.work.id, boot.branchId, jobId),
      loadBatchReport(boot.work.id, boot.branchId, jobId),
    ]);
    setDetail(jobDetail);
    setReport(jobReport);
  }

  async function handleCreate() {
    if (boot.status !== 'ready' || creating) {
      return;
    }
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const scope = buildScope({
        mode: scopeMode,
        chapterNumber,
        volumeId,
        startChapter,
        endChapter,
      });
      const created = await createBatchJob(boot.work.id, boot.branchId, {
        scope,
        settings: {
          qualityTier,
          approvalMode,
          targetMinCharacters: Number(targetMinCharacters),
          targetMaxCharacters: Number(targetMaxCharacters),
        },
      });
      setSelectedJobId(created.id);
      setDetail(created);
      setReport(await loadBatchReport(boot.work.id, boot.branchId, created.id));
      const [jobList, queue] = await Promise.all([
        loadBatchJobs(boot.work.id, boot.branchId),
        loadReviewQueue(boot.work.id, boot.branchId),
      ]);
      setJobs(jobList.items);
      setReviewItems(queue.items);
      setNotice(`已创建 ${created.chapterNumbers.length} 章的创作任务。`);
    } catch (createError) {
      setError(batchErrorMessage(createError));
    } finally {
      setCreating(false);
    }
  }

  async function handleControl(action: 'pause' | 'resume' | 'cancel' | 'retry') {
    if (boot.status !== 'ready' || !selectedJobId) {
      return;
    }
    setBusyAction(action);
    setError('');
    setNotice('');
    try {
      await controlBatchJob(boot.work.id, boot.branchId, selectedJobId, action);
      setNotice(controlNotice(action));
      await refreshSelected();
    } catch (controlError) {
      setError(batchErrorMessage(controlError));
    } finally {
      setBusyAction('');
    }
  }

  async function handleDecision(
    item: ReviewQueueItem,
    action: 'approve' | 'send_to_desk' | 'reject' | 'send_to_parallel',
  ) {
    if (boot.status !== 'ready') {
      return;
    }
    setBusyAction(`${item.id}:${action}`);
    setError('');
    setNotice('');
    try {
      await decideReviewItem(boot.work.id, boot.branchId, item.jobId, item.id, { action });
      if (action === 'send_to_desk') {
        router.push(`/workspace/${boot.work.id}/write?chapter=${item.chapterNumber}`);
        return;
      }
      setNotice(reviewNotice(action));
      await refreshSelected();
    } catch (decisionError) {
      setError(batchErrorMessage(decisionError));
    } finally {
      setBusyAction('');
    }
  }

  async function handleApproveLowRisk() {
    if (boot.status !== 'ready') {
      return;
    }
    const targets = reviewItems.filter((item) => item.riskLevel === 'low');
    if (targets.length === 0) {
      setNotice('当前没有低风险章节可以批量批准。');
      return;
    }
    setBusyAction('bulk-approve');
    setError('');
    setNotice('');
    try {
      for (const item of targets) {
        await decideReviewItem(boot.work.id, boot.branchId, item.jobId, item.id, {
          action: 'approve',
        });
      }
      setNotice(`已批准 ${targets.length} 章低风险内容并锁定。`);
      await refreshSelected();
    } catch (decisionError) {
      setError(batchErrorMessage(decisionError));
    } finally {
      setBusyAction('');
    }
  }

  async function handleIgnore(item: ReviewQueueItem) {
    if (boot.status !== 'ready' || !ignoreReason.trim()) {
      setError('写一句忽略原因，之后回看时才知道为什么放过这个问题。');
      return;
    }
    setBusyAction(`${item.id}:ignore`);
    setError('');
    try {
      await decideReviewItem(boot.work.id, boot.branchId, item.jobId, item.id, {
        action: 'ignore',
        reason: ignoreReason.trim(),
      });
      setIgnoreItemId('');
      setIgnoreReason('');
      setNotice('已记录忽略原因。');
      await refreshSelected();
    } catch (decisionError) {
      setError(batchErrorMessage(decisionError));
    } finally {
      setBusyAction('');
    }
  }

  if (boot.status === 'loading') {
    return (
      <main className="task-shell">
        <p className="workspace-loading">正在整理创作任务…</p>
      </main>
    );
  }

  if (boot.status === 'error') {
    return (
      <main className="task-shell">
        <section className="workspace-error">
          <h1>{boot.notFound ? '没有找到这部作品' : '暂时无法打开创作任务'}</h1>
          <p>{boot.message}</p>
          <Link className="secondary-button back-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const selectedChapterNumbers = selectedNumbers(scopeMode, {
    chapterNumber,
    volumeId,
    startChapter,
    endChapter,
    chapters: boot.chapters,
    outlines: boot.outlines,
  });
  const outlineByChapter = new Map(
    boot.outlines
      .filter((node) => node.level === 'chapter' && node.chapterNumber !== null)
      .map((node) => [node.chapterNumber as number, node]),
  );
  const selectedOutlines = selectedChapterNumbers
    .map((number) => outlineByChapter.get(number))
    .filter((node): node is OutlineNode => Boolean(node));
  const completeOutlineCount = selectedOutlines.filter(
    (node) =>
      node.chapterGoal.trim() &&
      node.pov.trim() &&
      node.sceneBeats.length > 0 &&
      node.chapterEndHook.trim(),
  ).length;
  const lockedOutlineCount = selectedOutlines.filter((node) => node.lockedAt).length;
  const autoBlockedReasons = [
    qualityTier !== 'standard' ? '自动通过只允许标准质量档位' : '',
    selectedChapterNumbers.length === 0 ? '当前范围没有章节' : '',
    lockedOutlineCount < selectedChapterNumbers.length ? '还有章纲没有锁定' : '',
  ].filter(Boolean);
  const waitingReviewCount = reviewItems.length;
  const visibleReviewItems = reviewItems.filter(
    (item) => riskFilter === 'all' || item.riskLevel === riskFilter,
  );
  const activeJobs = jobs.filter((job) =>
    ['queued', 'preparing', 'running'].includes(job.status),
  ).length;

  return (
    <main className={`task-shell${showHeader ? '' : ' task-shell-embedded'}`}>
      {showHeader ? (
        <header className="task-header">
          <div className="task-header-main">
            <Link className="workspace-brand" href="/workspace">
              NovelBrain
            </Link>
            <span className="writing-header-divider" aria-hidden="true" />
            <div>
              <p>{GENRE_LABELS[boot.work.genrePack] ?? boot.work.genrePack}</p>
              <strong>{boot.work.title}</strong>
            </div>
          </div>
          <nav className="workspace-nav" aria-label="创作任务导航">
            <Link href={`/workspace/${boot.work.id}`}>作品与章纲</Link>
            <Link href={`/workspace/${boot.work.id}/write`}>写作台</Link>
            <Link href="/workspace/settings">模型设置</Link>
          </nav>
        </header>
      ) : null}

      <section className="task-hero">
        <div>
          <p className="workspace-step">批量生产</p>
          <h1>把长跑拆成可管理的段落</h1>
          <p>按章、按卷、按自定义区间或全本生成。每一步都可暂停、审批、回滚。</p>
        </div>
        <div className="task-hero-actions">
          <button className="secondary-button" onClick={() => void refreshSelected()} type="button">
            刷新
          </button>
          <button className="primary-button" onClick={focusForm} type="button">
            新建任务
          </button>
        </div>
      </section>

      <dl className="task-hero-stats" aria-label="任务概览">
        <div>
          <dt>运行中</dt>
          <dd>{activeJobs}</dd>
        </div>
        <div>
          <dt>待我确认</dt>
          <dd>{waitingReviewCount}</dd>
        </div>
        <div>
          <dt>历史任务</dt>
          <dd>{jobs.length}</dd>
        </div>
      </dl>

      <div className="task-view-tabs" role="tablist" aria-label="批量生产视图">
        {(
          [
            ['tasks', '任务列表'],
            ['review', `审核队列${waitingReviewCount > 0 ? ` ${waitingReviewCount}` : ''}`],
            ['report', '任务报告'],
          ] as Array<[TaskView, string]>
        ).map(([value, label]) => (
          <button
            aria-selected={view === value}
            className={view === value ? 'active' : ''}
            key={value}
            onClick={() => setView(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {notice ? (
        <p className="form-message form-message-success task-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-message form-message-error task-message" role="status">
          {error}
        </p>
      ) : null}

      {view === 'tasks' ? (
        <>
          <section className="task-create" aria-labelledby="task-create-title" ref={formRef}>
            <div className="task-section-heading">
              <div>
                <p className="workspace-step">新建生产任务</p>
                <h2 id="task-create-title">安排下一批章节</h2>
              </div>
              <p>系统会按章节顺序创作，遇到失败时保留已完成的内容。</p>
            </div>
            <div className="task-scope-tabs" role="tablist" aria-label="创作范围">
              {(Object.keys(SCOPE_LABELS) as ScopeMode[]).map((mode) => (
                <button
                  aria-selected={scopeMode === mode}
                  className={scopeMode === mode ? 'active' : ''}
                  disabled={mode === 'volume' && boot.volumes.length === 0}
                  key={mode}
                  onClick={() => setScopeMode(mode)}
                  role="tab"
                  type="button"
                >
                  {SCOPE_LABELS[mode]}
                </button>
              ))}
            </div>
            <div className="task-create-grid">
              {scopeMode === 'chapter' ? (
                <label className="field">
                  <span>从哪一章开始</span>
                  <select
                    onChange={(event) => setChapterNumber(event.target.value)}
                    value={chapterNumber}
                  >
                    {boot.chapters.map((chapter) => (
                      <option key={chapter.chapterNumber} value={chapter.chapterNumber}>
                        第 {chapter.chapterNumber} 章 · {chapter.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {scopeMode === 'volume' ? (
                <label className="field">
                  <span>选择一卷</span>
                  <select onChange={(event) => setVolumeId(event.target.value)} value={volumeId}>
                    {boot.volumes.map((volume) => (
                      <option key={volume.id} value={volume.id}>
                        {volume.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {scopeMode === 'range' ? (
                <>
                  <label className="field">
                    <span>起始章</span>
                    <input
                      min="1"
                      onChange={(event) => setStartChapter(event.target.value)}
                      type="number"
                      value={startChapter}
                    />
                  </label>
                  <label className="field">
                    <span>结束章</span>
                    <input
                      min="1"
                      onChange={(event) => setEndChapter(event.target.value)}
                      type="number"
                      value={endChapter}
                    />
                  </label>
                </>
              ) : null}
              {scopeMode === 'book' ? (
                <div className="task-book-scope">
                  <strong>{boot.chapters.length} 章</strong>
                  <span>从第一章按顺序创作到最后一章</span>
                </div>
              ) : null}
              <label className="field">
                <span>质量档位</span>
                <select
                  onChange={(event) =>
                    setQualityTier(event.target.value as keyof typeof QUALITY_LABELS)
                  }
                  value={qualityTier}
                >
                  {Object.entries(QUALITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>单章最少字数</span>
                <input
                  min="1"
                  onChange={(event) => setTargetMinCharacters(event.target.value)}
                  type="number"
                  value={targetMinCharacters}
                />
              </label>
              <label className="field">
                <span>单章最多字数</span>
                <input
                  min="1"
                  onChange={(event) => setTargetMaxCharacters(event.target.value)}
                  type="number"
                  value={targetMaxCharacters}
                />
              </label>
            </div>

            <fieldset className="task-approval">
              <legend>审批方式</legend>
              {(Object.keys(APPROVAL_LABELS) as BatchApprovalMode[]).map((mode) => {
                const disabled = mode === 'auto' && autoBlockedReasons.length > 0;
                return (
                  <label className={approvalMode === mode ? 'checked' : ''} key={mode}>
                    <input
                      checked={approvalMode === mode}
                      disabled={disabled}
                      name="approval-mode"
                      onChange={() => setApprovalMode(mode)}
                      type="radio"
                      value={mode}
                    />
                    <span>
                      <strong>{APPROVAL_LABELS[mode].label}</strong>
                      <small>{APPROVAL_LABELS[mode].hint}</small>
                    </span>
                  </label>
                );
              })}
              {autoBlockedReasons.length > 0 ? (
                <p className="task-hint">
                  自动通过暂不可用：{autoBlockedReasons.join('；')}。
                </p>
              ) : null}
            </fieldset>

            <div className="task-estimate">
              <div>
                <span>预计章节</span>
                <strong>{estimate ? `${estimate.chapterCount} 章` : '等待章纲'}</strong>
              </div>
              <div>
                <span>预计 token</span>
                <strong>{estimate ? approximateTokens(estimate.estimatedTotalTokens) : '—'}</strong>
              </div>
              <div>
                <span>预计费用</span>
                <strong>{estimate ? `约 $${estimate.estimatedCost.toFixed(4)}` : '—'}</strong>
              </div>
              <div>
                <span>预计耗时</span>
                <strong>{estimate ? `约 ${estimate.estimatedMinutes} 分钟` : '—'}</strong>
              </div>
              <small>费用按当前模型配置估算，实际以模型账单为准；平台不设额度。</small>
            </div>

            <div className="task-readiness">
              <div className="task-section-heading">
                <h3>生成前准备度</h3>
                <span>
                  {completeOutlineCount + (lockedOutlineCount === selectedChapterNumbers.length ? 1 : 0)}
                  {' / 3'}
                </span>
              </div>
              <ul>
                <li className={completeOutlineCount === selectedChapterNumbers.length ? 'done' : ''}>
                  <strong>本区间章纲完整</strong>
                  <small>
                    {completeOutlineCount} / {selectedChapterNumbers.length} 章
                  </small>
                </li>
                <li className={lockedOutlineCount === selectedChapterNumbers.length ? 'done' : ''}>
                  <strong>章纲已锁定</strong>
                  <small>
                    {lockedOutlineCount} / {selectedChapterNumbers.length} 章
                  </small>
                </li>
                <li className={selectedChapterNumbers.length > 0 ? 'done' : ''}>
                  <strong>范围可展开</strong>
                  <small>{selectedChapterNumbers.length} 章会进入任务</small>
                </li>
              </ul>
            </div>

            <div className="task-create-action">
              <button
                className="primary-button"
                disabled={creating || selectedChapterNumbers.length === 0}
                onClick={() => void handleCreate()}
                type="button"
              >
                {creating ? '正在创建…' : '开始生成'}
              </button>
            </div>
          </section>

          <div className="task-layout">
            <aside className="task-history" aria-labelledby="task-history-title">
              <div className="task-section-heading">
                <div>
                  <p className="workspace-step">历史</p>
                  <h2 id="task-history-title">创作任务</h2>
                </div>
                <span>{jobs.length} 条</span>
              </div>
              {jobs.length === 0 ? (
                <p className="task-empty">还没有创建过批量创作任务。</p>
              ) : (
                <div className="task-history-list">
                  {jobs.map((job) => (
                    <button
                      aria-current={job.id === selectedJobId ? 'true' : undefined}
                      className="task-history-item"
                      key={job.id}
                      onClick={() => selectJob(job.id)}
                      type="button"
                    >
                      <span className="task-history-copy">
                        <strong>{scopeLabel(job.scope, boot.volumes)}</strong>
                        <small>
                          {job.chapterNumbers.length} 章 · {job.statusLabel}
                        </small>
                      </span>
                      <span className="task-history-progress">{job.progress}%</span>
                      <span className="task-progress-track" aria-hidden="true">
                        <span style={{ width: `${job.progress}%` }} />
                      </span>
                      {job.waitingReviewChapterCount > 0 ? (
                        <span className="task-history-review">
                          {job.waitingReviewChapterCount} 章待确认
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </aside>

            <section className="task-detail" aria-labelledby="task-detail-title">
              {!detail ? (
                <div className="task-detail-empty">
                  <p className="workspace-step">任务详情</p>
                  <h2 id="task-detail-title">选择一条任务查看详情</h2>
                  <p>这里会显示流水线、当前章节、进度、错误和任务控制。</p>
                </div>
              ) : (
                <>
                  <div className="task-detail-heading">
                    <div>
                      <p className="workspace-step">任务详情</p>
                      <h2 id="task-detail-title">{scopeLabel(detail.scope, boot.volumes)}</h2>
                    </div>
                    <div className="task-detail-status">
                      <span className={`task-status task-status-${detail.status}`}>
                        {detail.statusLabel}
                      </span>
                      <strong>{detail.progress}%</strong>
                    </div>
                  </div>
                  <div className="task-progress-bar" aria-label={`进度 ${detail.progress}%`}>
                    <span style={{ width: `${detail.progress}%` }} />
                  </div>
                  <div className="task-dag" aria-label="任务流水线">
                    {pipelineNodes(detail).map((node) => (
                      <div className={`task-dag-node ${node.state}`} key={node.label}>
                        <span>{node.state === 'done' ? '✓' : node.state === 'active' ? '●' : '○'}</span>
                        <strong>{node.label}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="task-actions">
                    {['queued', 'preparing', 'running', 'waiting_review'].includes(
                      detail.status,
                    ) ? (
                      <button
                        className="secondary-button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleControl('pause')}
                        type="button"
                      >
                        暂停
                      </button>
                    ) : null}
                    {detail.status === 'paused' ? (
                      <button
                        className="secondary-button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleControl('resume')}
                        type="button"
                      >
                        继续
                      </button>
                    ) : null}
                    {detail.status === 'failed' ? (
                      <button
                        className="primary-button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleControl('retry')}
                        type="button"
                      >
                        从失败步骤重试
                      </button>
                    ) : null}
                    {!['completed', 'canceled'].includes(detail.status) ? (
                      <button
                        className="text-button task-danger"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleControl('cancel')}
                        type="button"
                      >
                        取消剩余章节
                      </button>
                    ) : null}
                  </div>
                  <div className="task-chapter-heading">
                    <h3>章节进度</h3>
                    <span>用量会在每章完成后更新</span>
                  </div>
                  <div className="task-chapter-list">
                    {detail.items.map((item) => (
                      <article className="task-chapter-item" key={item.id}>
                        <div className="task-chapter-title">
                          <span>{item.chapterNumber}</span>
                          <div>
                            <strong>{item.chapterTitle ?? `第 ${item.chapterNumber} 章`}</strong>
                            <small>{item.statusLabel}</small>
                          </div>
                        </div>
                        <div className="task-chapter-usage">
                          <span>输入 {item.promptTokens.toLocaleString('zh-CN')}</span>
                          <span>输出 {item.completionTokens.toLocaleString('zh-CN')}</span>
                          <span>费用 ${item.cost.toFixed(6)}</span>
                        </div>
                        {item.error ? (
                          <p className="task-chapter-error">
                            {chapterFailureMessage(item.error.message)}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      ) : null}

      {view === 'review' ? (
        <section className="task-review" aria-labelledby="task-review-title">
          <div className="task-section-heading">
            <div>
              <p className="workspace-step">审核队列</p>
              <h2 id="task-review-title">待我确认</h2>
            </div>
            <p>可以批准并锁定、送到写作台修改、驳回重写、送平行版本，或记下原因后忽略问题。</p>
          </div>
          <div className="task-review-toolbar">
            <label className="field">
              <span>风险筛选</span>
              <select
                onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}
                value={riskFilter}
              >
                {(Object.keys(RISK_LABELS) as RiskFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {RISK_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={Boolean(busyAction) || reviewItems.every((item) => item.riskLevel !== 'low')}
              onClick={() => void handleApproveLowRisk()}
              type="button"
            >
              批量批准低风险
            </button>
            <span>{visibleReviewItems.length} 章显示中</span>
          </div>
          <div className="task-review-rules">
            <div>
              <strong>低风险可批量批准</strong>
              <small>无连续性错误、无高风险事件、质量检查稳定</small>
            </div>
            <div>
              <strong>高风险必须逐章看</strong>
              <small>关键人物死亡、金手指升级、改已确认设定</small>
            </div>
            <div>
              <strong>卷末必须人工确认</strong>
              <small>自动通过也只到卷边界</small>
            </div>
          </div>
          {visibleReviewItems.length === 0 ? (
            <p className="task-empty">目前没有需要确认的章节。</p>
          ) : (
            <div className="task-review-list">
              {visibleReviewItems.map((item) => (
                <article className={`task-review-item risk-${item.riskLevel}`} key={item.id}>
                  <div className="task-review-main">
                    <div className="task-review-heading">
                      <div>
                        <p className="workspace-step">
                          第 {item.chapterNumber} 章
                          {item.volumeTitle ? ` · ${item.volumeTitle}` : ''}
                        </p>
                        <h3>{item.chapterTitle}</h3>
                      </div>
                      <div className="task-review-badges">
                        <span className={`task-risk task-risk-${item.riskLevel}`}>
                          {item.riskLabel}
                        </span>
                        {item.isVolumeEnd ? <span className="task-volume-end">卷末</span> : null}
                        {item.quality ? (
                          <span className="task-quality">
                            {item.quality.watchDimensions.length > 0
                              ? `${item.quality.watchDimensions.length} 项待留意`
                              : '质量稳定'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="task-review-reason">{item.riskReasons.join('；')}</p>
                    {item.quality ? <p>{item.quality.summary}</p> : null}
                    <blockquote>{item.draftPreview}…</blockquote>
                    {item.quality?.watchDimensions.length ? (
                      <ul className="task-review-watch">
                        {item.quality.watchDimensions.slice(0, 3).map((dimension) => (
                          <li key={`${item.id}-${dimension.label}`}>
                            <strong>{dimension.label}</strong>
                            <span>{dimension.suggestion || dimension.summary}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {item.continuityIssues.length > 0 ? (
                      <ul className="task-review-issues">
                        {item.continuityIssues.slice(0, 3).map((issue) => (
                          <li key={issue.id}>
                            <span className={issue.status === 'open' ? 'open' : ''}>
                              {issue.status === 'open' ? '待处理' : '已忽略'}
                            </span>
                            <p>{issue.message}</p>
                            <small>{issue.suggestion}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="task-review-clear">连续性检查没有发现需要处理的问题。</p>
                    )}
                  </div>
                  <div className="task-review-actions">
                    <button
                      className="primary-button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleDecision(item, 'approve')}
                      type="button"
                    >
                      批准并锁定
                    </button>
                    <button
                      className="secondary-button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleDecision(item, 'send_to_desk')}
                      type="button"
                    >
                      送写作台
                    </button>
                    <button
                      className="secondary-button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleDecision(item, 'send_to_parallel')}
                      type="button"
                    >
                      送平行版本
                    </button>
                    <button
                      className="secondary-button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleDecision(item, 'reject')}
                      type="button"
                    >
                      驳回重生成
                    </button>
                    {ignoreItemId === item.id ? (
                      <div className="task-ignore-form">
                        <label className="field">
                          <span>忽略原因</span>
                          <textarea
                            onChange={(event) => setIgnoreReason(event.target.value)}
                            placeholder="例如：这一处是角色的故意误判，后续会解释。"
                            value={ignoreReason}
                          />
                        </label>
                        <div>
                          <button
                            className="text-button"
                            disabled={Boolean(busyAction)}
                            onClick={() => void handleIgnore(item)}
                            type="button"
                          >
                            确认忽略
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              setIgnoreItemId('');
                              setIgnoreReason('');
                            }}
                            type="button"
                          >
                            收起
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="text-button"
                        onClick={() => {
                          setIgnoreItemId(item.id);
                          setIgnoreReason('');
                          setError('');
                        }}
                        type="button"
                      >
                        忽略并记录原因
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view === 'report' ? (
        <section className="task-report-view" aria-labelledby="task-report-view-title">
          <div className="task-section-heading">
            <div>
              <p className="workspace-step">任务报告</p>
              <h2 id="task-report-view-title">这一批发生了什么</h2>
            </div>
            <p>完成和失败章节、token、费用、连续性、质量摘要、未回收伏笔和下一步建议。</p>
          </div>
          {!report ? (
            <p className="task-empty">选择一条任务后查看报告。</p>
          ) : (
            <TaskReportPanel report={report} detail={detail} />
          )}
        </section>
      ) : null}
    </main>
  );
}

function TaskReportPanel({
  report,
  detail,
}: {
  report: BatchJobReport;
  detail: BatchJobDetail | null;
}) {
  const dimensions = report.quality?.dimensions ?? [];
  const foreshadows = report.foreshadows?.items ?? [];
  const nextActions = report.nextActions ?? [];
  return (
    <div className="task-report">
      <div className="task-report-heading">
        <div>
          <p className="workspace-step">{detail ? detail.statusLabel : '任务报告'}</p>
          <h3>{detail ? `${report.totalChapters} 章` : '任务报告'}</h3>
        </div>
        <span>{report.quality?.averageScore ?? 0} 分</span>
      </div>
      <div className="task-report-stats">
        <div>
          <span>完成章节</span>
          <strong>{report.completedChapterNumbers.length}</strong>
        </div>
        <div>
          <span>失败章节</span>
          <strong>{report.failedChapters.length}</strong>
        </div>
        <div>
          <span>输入用量</span>
          <strong>{report.promptTokens.toLocaleString('zh-CN')}</strong>
        </div>
        <div>
          <span>输出用量</span>
          <strong>{report.completionTokens.toLocaleString('zh-CN')}</strong>
        </div>
        <div>
          <span>预估费用</span>
          <strong>${report.cost.toFixed(6)}</strong>
        </div>
      </div>
      <div className="task-report-flow">
        <div>
          <strong>完成</strong>
          <span>
            {report.completedChapterNumbers.length > 0
              ? report.completedChapterNumbers
                  .map((chapterNumber) => `第 ${chapterNumber} 章`)
                  .join('、')
              : '还没有确认完成的章节'}
          </span>
        </div>
        <div>
          <strong>失败</strong>
          <span>
            {report.failedChapters.length > 0
              ? report.failedChapters
                  .map(
                    (chapter) =>
                      `第 ${chapter.chapterNumber} 章：${chapterFailureMessage(chapter.message)}`,
                  )
                  .join('；')
              : '没有失败章节'}
          </span>
        </div>
        <div>
          <strong>连续性摘要</strong>
          <span>{report.continuity.summary}</span>
        </div>
      </div>
      <div className="task-report-columns">
        <div className="task-report-quality">
          <h4>质量摘要</h4>
          <p>{report.quality?.summary ?? '还没有质量报告。'}</p>
          {dimensions.map((dimension) => (
            <div className="task-report-bar" key={dimension.key}>
              <span>{dimension.label}</span>
              <div className="task-progress-track" aria-hidden="true">
                <span style={{ width: `${dimension.score}%` }} />
              </div>
              <strong>{dimension.score}</strong>
            </div>
          ))}
        </div>
        <div className="task-report-foreshadows">
          <h4>未回收伏笔 · {report.foreshadows?.totalOpen ?? 0}</h4>
          {foreshadows.length === 0 ? (
            <p className="task-empty">当前没有未回收伏笔。</p>
          ) : (
            <ul>
              {foreshadows.map((item) => (
                <li className={item.overdue ? 'overdue' : ''} key={item.title}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.plannedPayoffChapter
                      ? `计划第 ${item.plannedPayoffChapter} 章回收`
                      : '还没有安排回收章节'}
                    {item.overdue ? ' · 已过期' : ''}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="task-report-next">
        <h4>下一步建议</h4>
        <ul>
          {nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function buildScope(input: {
  mode: ScopeMode;
  chapterNumber: string;
  volumeId: string;
  startChapter: string;
  endChapter: string;
}): BatchScope {
  if (input.mode === 'chapter') {
    return { type: 'chapter', chapterNumber: Number(input.chapterNumber) };
  }
  if (input.mode === 'volume') {
    return { type: 'volume', volumeId: input.volumeId };
  }
  if (input.mode === 'range') {
    return {
      type: 'range',
      startChapter: Number(input.startChapter),
      endChapter: Number(input.endChapter),
    };
  }
  return { type: 'book' };
}

function selectedNumbers(
  mode: ScopeMode,
  input: {
    chapterNumber: string;
    volumeId: string;
    startChapter: string;
    endChapter: string;
    chapters: BatchChapterOption[];
    outlines: OutlineNode[];
  },
): number[] {
  if (mode === 'chapter') {
    return [Number(input.chapterNumber)].filter((value) => Number.isInteger(value) && value > 0);
  }
  if (mode === 'volume') {
    return chaptersForVolume(input.volumeId, input.outlines).map(
      (node) => node.chapterNumber as number,
    );
  }
  if (mode === 'range') {
    const start = Number(input.startChapter);
    const end = Number(input.endChapter);
    return input.chapters
      .map((chapter) => chapter.chapterNumber)
      .filter((value) => value >= start && value <= end);
  }
  return input.chapters.map((chapter) => chapter.chapterNumber);
}

function chaptersForVolume(volumeId: string, outlines: OutlineNode[]): OutlineNode[] {
  if (!volumeId) {
    return [];
  }
  const byId = new Map(outlines.map((node) => [node.id, node]));
  return outlines
    .filter(
      (node) =>
        node.level === 'chapter' &&
        node.chapterNumber !== null &&
        isDescendantOf(node, volumeId, byId),
    )
    .sort((left, right) => (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0));
}

function isDescendantOf(
  node: OutlineNode,
  ancestorId: string,
  byId: Map<string, OutlineNode>,
): boolean {
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) {
      return true;
    }
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function pipelineNodes(detail: BatchJobDetail): Array<{
  label: string;
  state: 'done' | 'active' | 'pending';
}> {
  const started = !['queued', 'preparing'].includes(detail.status);
  const running = ['preparing', 'running'].includes(detail.status);
  const reviewing = detail.status === 'waiting_review';
  const done = detail.status === 'completed';
  return [
    { label: '准备', state: started ? 'done' : running ? 'active' : 'pending' },
    { label: '起草', state: started && !reviewing && !done ? 'active' : started ? 'done' : 'pending' },
    { label: '审核', state: reviewing ? 'active' : done ? 'done' : 'pending' },
    { label: '正史', state: done ? 'done' : 'pending' },
  ];
}

function approximateTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

function scopeLabel(scope: BatchScope | null, volumes: OutlineNode[]): string {
  if (!scope) {
    return '创作任务';
  }
  if (scope.type === 'chapter') {
    return `第 ${scope.chapterNumber} 章`;
  }
  if (scope.type === 'volume') {
    return volumes.find((volume) => volume.id === scope.volumeId)?.title ?? '按卷创作';
  }
  if (scope.type === 'range') {
    return `第 ${scope.startChapter} 至 ${scope.endChapter} 章`;
  }
  return '全本创作';
}

function controlNotice(action: 'pause' | 'resume' | 'cancel' | 'retry'): string {
  if (action === 'pause') {
    return '会在当前章节结束后暂停。';
  }
  if (action === 'resume') {
    return '已从上次停下的地方继续。';
  }
  if (action === 'cancel') {
    return '已取消剩余章节，完成的内容会保留。';
  }
  return '已从失败的那一步重新开始。';
}

function reviewNotice(
  action: 'approve' | 'send_to_desk' | 'send_to_parallel' | 'reject',
): string {
  if (action === 'approve') {
    return '这一章已批准并锁定。';
  }
  if (action === 'send_to_desk') {
    return '已送到写作台。';
  }
  if (action === 'send_to_parallel') {
    return '已创建平行版本，主线没有写入这一稿。';
  }
  return '已驳回，正在重新生成这一章。';
}

function batchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'BATCH_RANGE_HAS_GAPS') {
      return '区间里还有没写章纲的章节，先补齐再开始。';
    }
    if (error.code === 'BATCH_SCOPE_HAS_NO_CHAPTERS') {
      return '这个范围里还没有可创作的章节。';
    }
    if (error.code === 'BATCH_JOB_INVALID_TRANSITION') {
      return '这条任务现在的状态不能执行这个操作。';
    }
    if (error.code === 'BATCH_AUTO_APPROVAL_REQUIRES_STANDARD') {
      return '自动通过只允许标准质量档位。';
    }
    if (error.code === 'BATCH_AUTO_APPROVAL_REQUIRES_LOCKED_OUTLINES') {
      return '自动通过前需要先锁定本区间的全部章纲。';
    }
    if (error.code === 'BATCH_AUTO_APPROVAL_HAS_RISK') {
      return '这个范围里有高风险章节，请改用逐章或逐卷审批。';
    }
    if (error.code === 'MODEL_CONFIG_REQUIRED') {
      return '还没有可用的正文模型，请先到模型设置里完成配置。';
    }
    if (error.code === 'BATCH_QUEUE_UNAVAILABLE') {
      return '创作服务暂时忙碌，请稍后再试。';
    }
    if (error.code === 'BATCH_DRAFT_NOT_READY') {
      return '这一章的正文还没有准备好，请稍后再确认。';
    }
    return '这次操作没有完成，请检查创作范围后再试。';
  }
  return '这次操作没有完成，请稍后再试。';
}

function chapterFailureMessage(value: unknown): string {
  const message = typeof value === 'string' ? value : '';
  if (message.includes('invalid chapter facts')) {
    return '这一章的资料整理没有完成，可以直接重试。';
  }
  if (message.includes('length')) {
    return '这一章的篇幅没有达到要求，可以直接重试。';
  }
  if (message.includes('story bible')) {
    return '这一章还缺少故事圣经，补齐后可以直接重试。';
  }
  return '这一章没有完成，可以直接重试。';
}
