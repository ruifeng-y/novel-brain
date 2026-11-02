'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { countCjkCharacters } from '@novel/contracts';
import { ApiError, apiRequest, friendlyError, type User } from '../../../../lib/auth-api';
import {
  generationErrorMessage,
  generationEventsUrl,
  ignoreContinuityIssue,
  loadChapter,
  loadChapters,
  loadContinuityIssues,
  loadGenerationJob,
  saveChapterVersion,
  startChapterGeneration,
  type ChapterDetail,
  type ChapterListItem,
  type ContinuityIssue,
  type GenerationEvent,
  type GenerationJob,
} from '../../../../lib/chapter-generation-api';
import { loadStoryBible, type StoryBible } from '../../../../lib/story-planning-api';
import { GENRE_LABELS, type Work } from '../../../../lib/works-api';
import { ContinuityReviewPanel } from './continuity-review-panel';
import { FactReviewPanel } from './fact-review-panel';

type BootState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      branchId: string;
      storyBible: StoryBible | null;
      chapters: ChapterListItem[];
    }
  | { status: 'error'; message: string; notFound: boolean };

type GenerationState = 'idle' | 'preparing' | 'streaming' | 'completed' | 'failed';

const STEP_MESSAGES: Record<string, string> = {
  readiness: '正在核对章纲和故事设定…',
  brief: '正在整理本章写作任务…',
  context: '正在准备本章参考资料…',
  draft: '正在起草正文…',
  verify: '正在检查前后设定…',
};

export function WritingDesk({ workId }: { workId: string }) {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [chapterNumber, setChapterNumber] = useState<number>();
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [content, setContent] = useState('');
  const [chapterLoading, setChapterLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previousContent, setPreviousContent] = useState('');
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [continuityLoading, setContinuityLoading] = useState(false);
  const [continuityBusyId, setContinuityBusyId] = useState<string>();
  const [continuityError, setContinuityError] = useState('');
  const [continuityNotice, setContinuityNotice] = useState('');
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([apiRequest<User>('/api/v1/auth/me'), apiRequest<Work>(`/api/v1/works/${workId}`)])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          throw new Error('这部作品还没有可用的创作线。');
        }
        const [storyBible, chapterList] = await Promise.all([
          loadStoryBible(work.id, work.mainBranch.id),
          loadChapters(work.id, work.mainBranch.id),
        ]);
        if (!active) {
          return;
        }

        setBoot({
          status: 'ready',
          user,
          work,
          branchId: work.mainBranch.id,
          storyBible,
          chapters: chapterList.items,
        });
        setChapters(chapterList.items);
        if (chapterList.items.length > 0) {
          const first = chapterList.items[0];
          setChapterNumber(first.chapterNumber);
          const opened = await loadChapter(work.id, work.mainBranch.id, first.chapterNumber);
          if (active) {
            setDetail(opened);
            setContent(initialChapterContent(opened));
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
    };
  }, [router, workId]);

  useEffect(() => {
    if (boot.status !== 'ready' || !chapterNumber) {
      setContinuityIssues([]);
      return;
    }

    let active = true;
    setContinuityLoading(true);
    setContinuityError('');
    loadContinuityIssues(boot.work.id, boot.branchId, chapterNumber)
      .then((result) => {
        if (active) {
          setContinuityIssues(result.items);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setContinuityError(friendlyError(loadError));
        }
      })
      .finally(() => {
        if (active) {
          setContinuityLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [boot, chapterNumber, generationState]);

  async function openChapter(nextChapterNumber: number) {
    if (!boot || boot.status !== 'ready' || generating) {
      return;
    }
    closeStream();
    setChapterLoading(true);
    setError('');
    setNotice('');
    setGenerationState('idle');
    setStatusMessage('');
    setContinuityNotice('');
    setContinuityError('');

    try {
      const opened = await loadChapter(boot.work.id, boot.branchId, nextChapterNumber);
      setChapterNumber(nextChapterNumber);
      setDetail(opened);
      setContent(initialChapterContent(opened));
    } catch (loadError) {
      setError(friendlyError(loadError));
    } finally {
      setChapterLoading(false);
    }
  }

  async function generateChapter() {
    if (!boot || boot.status !== 'ready' || !chapterNumber || generating) {
      return;
    }

    closeStream();
    setPreviousContent(content);
    setGenerating(true);
    setGenerationState('preparing');
    setStatusMessage('正在准备这一章…');
    setError('');
    setNotice('');
    setContent('');

    try {
      const started = await startChapterGeneration(
        boot.work.id,
        boot.branchId,
        chapterNumber,
      );
      connectToEvents(started.jobId, boot.work.id, boot.branchId);
    } catch (startError) {
      setGenerating(false);
      setGenerationState('failed');
      setContent(previousContent);
      setStatusMessage('');
      setError(generationErrorMessage(startError));
    }
  }

  function connectToEvents(jobId: string, workIdValue: string, branchId: string) {
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
        setContent((current) => current + delta);
        setGenerationState('streaming');
        setStatusMessage('正在起草正文…');
        return;
      }

      if (type === 'job.draft.reset') {
        setContent('');
        setGenerationState('streaming');
        setStatusMessage('正在按目标汉字数重新生成…');
        return;
      }

      if (type === 'job.draft.correcting') {
        setStatusMessage('正在校正本章篇幅…');
        return;
      }

      if (type === 'job.step.started' && typeof data.stepKey === 'string') {
        setStatusMessage(STEP_MESSAGES[data.stepKey] ?? '正在推进这一章…');
        return;
      }

      if (type === 'job.completed') {
        void finishFromJob(jobId, workIdValue, branchId, 'completed');
        return;
      }

      if (type === 'job.failed') {
        void finishFromJob(jobId, workIdValue, branchId, 'failed');
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
      if (generating) {
        setStatusMessage('连接有些慢，正在恢复生成进度…');
      }
    };
  }

  async function finishFromJob(
    jobId: string,
    workIdValue: string,
    branchId: string,
    expected: 'completed' | 'failed',
  ) {
    closeStream();
    try {
      const job = await loadGenerationJob(workIdValue, branchId, jobId);
      applyJobResult(job, expected);
    } catch {
      setGenerating(false);
      setGenerationState('failed');
      setStatusMessage('');
      setError('暂时无法确认生成结果，已经写出的内容仍留在编辑器里。');
    }
  }

  function applyJobResult(job: GenerationJob, expected: 'completed' | 'failed') {
    const draftContent = job.draft?.content ?? '';
    if (draftContent) {
      setContent(draftContent);
    } else if (expected === 'failed') {
      setContent(previousContent);
    }
    setGenerating(false);

    if (job.status === 'completed' || expected === 'completed') {
      setGenerationState('completed');
      setStatusMessage('');
      setNotice('初稿已生成。你可以继续修改，满意后保存为新版本。');
      void refreshChapterSummary(job);
      return;
    }

    setGenerationState('failed');
    setStatusMessage('');
    setError(jobFailureMessage(job));
    void refreshChapterSummary(job);
  }

  async function refreshChapterSummary(job: GenerationJob) {
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
                job.draft
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

  async function saveVersion() {
    if (!boot || boot.status !== 'ready' || !chapterNumber) {
      return;
    }
    if (!content.trim()) {
      setError('正文还是空的，先写一点内容再保存。');
      return;
    }

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
      setNotice(`版本 ${saved.version} 已保存`);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  function restorePrevious() {
    setContent(previousContent);
    setError('');
    setGenerationState('idle');
    setNotice('已恢复生成前的内容。');
  }

  async function ignoreIssue(issue: ContinuityIssue, reason: string) {
    if (!boot || boot.status !== 'ready' || !chapterNumber) {
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
      setContinuityNotice('已忽略这条提示，并记录了你填写的原因。');
    } catch (ignoreError) {
      setContinuityError(friendlyError(ignoreError));
    } finally {
      setContinuityBusyId(undefined);
    }
  }

  function closeStream() {
    streamRef.current?.close();
    streamRef.current = null;
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
                  disabled={generating || chapterLoading}
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
              <p>先从章纲生成整章，再在正文里逐句修改。</p>
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
                {generationState === 'preparing'
                  ? '准备中'
                  : generationState === 'streaming'
                    ? '生成中'
                    : generationState === 'completed'
                      ? '初稿已生成'
                      : generationState === 'failed'
                        ? '等待处理'
                        : '可编辑'}
              </span>
            </div>

            <div className="writing-toolbar">
              <button
                className="primary-button"
                disabled={generating || chapterLoading}
                onClick={() => void generateChapter()}
                type="button"
              >
                {generating ? '正在生成…' : '根据章纲生成'}
              </button>
              <button
                className="secondary-button"
                disabled={saving || generating || !content.trim()}
                onClick={() => void saveVersion()}
                type="button"
              >
                {saving ? '正在保存…' : '保存版本'}
              </button>
              <span aria-live="polite" className="writing-live-status">
                {statusMessage || (generating ? '正在连接写作服务…' : '')}
              </span>
            </div>

            {error ? (
              <div className="writing-error" role="alert">
                <p>{error}</p>
                <div>
                  <button
                    className="secondary-button"
                    disabled={generating}
                    onClick={() => void generateChapter()}
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
            <textarea
              aria-label="章节正文"
              className="writing-textarea"
              id="chapter-content"
              onChange={(event) => {
                setContent(event.target.value);
                if (notice) {
                  setNotice('');
                }
              }}
              placeholder="正文会在这里出现，也可以直接开始写。"
              spellCheck={false}
              value={content}
            />

            {continuityIssues.some((issue) => issue.status === 'open') ? (
              <section
                aria-label="正文中的连续性冲突"
                className="continuity-highlight"
              >
                <div>
                  <span>正文中的冲突</span>
                  <small>标出的原句需要你确认或修改。</small>
                </div>
                {continuityIssues
                  .filter((issue) => issue.status === 'open')
                  .map((issue) => (
                    <p key={issue.id}>
                      <mark>{issue.sourceSentence}</mark>
                    </p>
                  ))}
              </section>
            ) : null}

            <footer className="writing-editor-footer">
              <span>{countCjkCharacters(content).toLocaleString('zh-CN')} 字</span>
              <span>
                {countCjkCharacters(content) > 0
                  ? `预计阅读 ${Math.max(1, Math.ceil(countCjkCharacters(content) / 500))} 分钟`
                  : '还没有正文'}
              </span>
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
            </div>

            {detail ? (
              <>
                <section className="writing-context-section">
                  <h3>章纲</h3>
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
                      <dt>场景节拍</dt>
                      <dd>{detail.outline.sceneBeats.join(' / ')}</dd>
                    </div>
                    <div>
                      <dt>章末钩子</dt>
                      <dd>{detail.outline.chapterEndHook}</dd>
                    </div>
                  </dl>
                </section>

                <section className="writing-context-section">
                  <h3>故事方向</h3>
                  {boot.storyBible ? (
                    <dl>
                      <div>
                        <dt>一句话故事</dt>
                        <dd>{boot.storyBible.oneSentenceStory}</dd>
                      </div>
                      <div>
                        <dt>主角</dt>
                        <dd>{boot.storyBible.protagonist}</dd>
                      </div>
                      <div>
                        <dt>世界铁律</dt>
                        <dd>{boot.storyBible.worldIronLaw}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p>故事圣经还没有保存，补充后本章参考会更完整。</p>
                  )}
                </section>

                {chapterNumber ? (
                  <ContinuityReviewPanel
                    busyId={continuityBusyId}
                    error={continuityError}
                    issues={continuityIssues}
                    loading={continuityLoading}
                    notice={continuityNotice}
                    onIgnore={ignoreIssue}
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

                <section className="writing-context-section">
                  <h3>写作要求</h3>
                  <p>整章 2000 到 3000 字，从章纲进入，落在章末钩子上。</p>
                  <p>生成内容会先进入草稿，不会自动覆盖已保存版本。</p>
                </section>
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

function initialChapterContent(detail: ChapterDetail): string {
  const draft = detail.latestDraft;
  if (!draft?.content) {
    return detail.content;
  }
  if (!detail.currentVersion) {
    return draft.content;
  }
  return new Date(draft.updatedAt).getTime() >=
    new Date(detail.currentVersion.createdAt).getTime()
    ? draft.content
    : detail.content;
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
