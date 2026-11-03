'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import {
  GENRE_LABELS,
  SCALE_LABELS,
  formatWorkDate,
  type Work,
} from '../../../../lib/works-api';
import {
  loadOutlineNodes,
  loadOutlineReadiness,
  loadStoryBible,
  loadStoryBibleInsights,
  type OutlineNode,
  type OutlineReadiness,
  type StoryBible,
  type StoryBibleInsights,
} from '../../../../lib/story-planning-api';

type OverviewState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      storyBible: StoryBible | null;
      readiness: OutlineReadiness | null;
      insights: StoryBibleInsights | null;
      outlineNodes: OutlineNode[];
    }
  | { status: 'error'; message: string; notFound: boolean };

const QUICK_LINKS = [
  { href: 'bible', label: '故事圣经', detail: '九卡、读者承诺与修改记录' },
  { href: 'settings', label: '设定中心', detail: '世界、人物、势力、地图与已确认设定' },
  { href: 'outline', label: '大纲工作台', detail: '五层结构、看板和剧情账本' },
  { href: 'foreshadows', label: '伏笔账本', detail: '埋设、回收与风险检查' },
  { href: 'write', label: '写作台', detail: '正文、连续性、事实确认和质量报告' },
  { href: 'batch', label: '批量生产', detail: '按章、按卷或全本生成' },
  { href: 'changes', label: '修改与版本', detail: '影响分析、平行版本和回滚' },
  { href: 'export', label: '导出与发布', detail: '正文、设定、发布检查和历史版本' },
] as const;

export function WorkOverview({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<OverviewState>({ status: 'loading' });
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState('');
  const [lifecycleError, setLifecycleError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<Work>(`/api/v1/works/${workId}`),
    ])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          if (active) {
            setState({
              status: 'ready',
              user,
              work,
              storyBible: null,
              readiness: null,
              insights: null,
              outlineNodes: [],
            });
          }
          return;
        }

        const [storyBible, readiness, insights, outlineResponse] = await Promise.all([
          loadStoryBible(work.id, work.mainBranch.id),
          loadOutlineReadiness(work.id, work.mainBranch.id),
          loadStoryBibleInsights(work.id, work.mainBranch.id),
          loadOutlineNodes(work.id, work.mainBranch.id),
        ]);
        if (active) {
          setState({
            status: 'ready',
            user,
            work,
            storyBible,
            readiness,
            insights,
            outlineNodes: outlineResponse.items,
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({
          status: 'error',
          message: error instanceof ApiError ? error.message : '暂时无法打开作品总览。',
          notFound: error instanceof ApiError && error.code === 'WORK_NOT_FOUND',
        });
      });

    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开作品总览…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>{state.notFound ? '没有找到这部作品' : '暂时无法打开作品总览'}</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { work, storyBible, readiness, insights, outlineNodes } = state;
  const recentChapters = outlineNodes
    .filter((node) => node.level === 'chapter')
    .sort((left, right) => (right.chapterNumber ?? 0) - (left.chapterNumber ?? 0))
    .slice(0, 5);
  const recentChanges = insights?.recentChanges.slice(0, 3) ?? [];
  const continuityReminders = insights?.continuityReminders.slice(0, 2) ?? [];
  const readinessItems = [
    {
      label: '故事圣经',
      ready: storyBible?.completion.complete ?? false,
      detail: storyBible
        ? `${storyBible.completion.filledCards} / ${storyBible.completion.totalCards} 张卡已完成`
        : '尚未建立',
    },
    {
      label: '大纲',
      ready: readiness?.checks.outline.ready ?? false,
      detail: readiness?.checks.outline.detail ?? '尚未建立',
    },
    {
      label: '设定',
      ready: readiness?.checks.settings.ready ?? false,
      detail: readiness?.checks.settings.detail ?? '尚未建立',
    },
    {
      label: '正文',
      ready: work.totalChapters > 0,
      detail: `${work.completedChapters} / ${work.totalChapters} 章 · ${work.progressPercent}%`,
    },
  ];

  async function runLifecycle(action: string, callback: () => Promise<void>) {
    setLifecycleBusy(action);
    setLifecycleError('');
    try {
      await callback();
    } catch (error) {
      setLifecycleError(error instanceof ApiError ? error.message : '操作失败，请稍后再试。');
    } finally {
      setLifecycleBusy('');
    }
  }

  async function reopenWork() {
    await runLifecycle('reopen', async () => {
      const updated = await apiRequest<Work>(`/api/v1/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'serializing' }),
      });
      setState((current) =>
        current.status === 'ready' ? { ...current, work: updated } : current,
      );
    });
  }

  async function completeWork() {
    await runLifecycle('complete', async () => {
      const updated = await apiRequest<Work>(`/api/v1/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });
      setState((current) =>
        current.status === 'ready' ? { ...current, work: updated } : current,
      );
    });
  }

  async function copyWork() {
    await runLifecycle('copy', async () => {
      const copied = await apiRequest<Work>(`/api/v1/works/${work.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      router.push(`/workspace/${copied.id}/overview`);
    });
  }

  async function archiveWork() {
    await runLifecycle('archive', async () => {
      await apiRequest(`/api/v1/works/${work.id}/archive`, { method: 'POST' });
      router.push('/workspace');
    });
  }

  return (
    <WorkShell active="overview" user={state.user} work={work} workId={work.id}>
      <main className="workspace-shell work-overview-shell">
        <section className="work-detail-hero">
          <div className="work-detail-hero-main">
            {work.coverUrl ? (
              <img alt={`《${work.title}》封面`} className="work-detail-cover" src={work.coverUrl} />
            ) : null}
            <div>
              <p className="workspace-step">
                {GENRE_LABELS[work.genrePack] ?? work.genrePack}
                {work.genreVariantLabel ? ` · ${work.genreVariantLabel}` : ''}
              </p>
              <h1>{work.title}</h1>
              <p>
                {work.penName} · {SCALE_LABELS[work.scale] ?? work.scale} · {work.targetPlatform}
              </p>
              {work.synopsis ? <p className="work-detail-synopsis">{work.synopsis}</p> : null}
              {work.tags.length > 0 ? (
                <ul className="work-tag-list" aria-label="作品标签">
                  {work.tags.slice(0, 8).map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              ) : null}
              <div className="work-overview-actions">
                {work.readOnly ? (
                  <button
                    className="primary-button"
                    disabled={lifecycleBusy === 'reopen'}
                    onClick={() => void reopenWork()}
                    type="button"
                  >
                    {lifecycleBusy === 'reopen' ? '正在恢复…' : '恢复连载'}
                  </button>
                ) : (
                  <Link className="primary-button" href={`/workspace/${work.id}/write`}>
                    继续写作
                  </Link>
                )}
                <Link className="secondary-button" href={`/workspace/${work.id}/work-settings`}>
                  作品设置
                </Link>
                <button
                  className="text-button"
                  disabled={lifecycleBusy === 'copy'}
                  onClick={() => void copyWork()}
                  type="button"
                >
                  {lifecycleBusy === 'copy' ? '正在复制…' : '复制作品'}
                </button>
                {!work.readOnly ? (
                  <button
                    className="text-button"
                    disabled={lifecycleBusy === 'complete'}
                    onClick={() => void completeWork()}
                    type="button"
                  >
                    {lifecycleBusy === 'complete' ? '正在处理…' : '标记完本'}
                  </button>
                ) : null}
                <button
                  className="text-button danger-text"
                  onClick={() => setConfirmArchive(true)}
                  type="button"
                >
                  归档
                </button>
              </div>
              {lifecycleError ? (
                <p className="form-message form-message-error" role="alert">
                  {lifecycleError}
                </p>
              ) : null}
              {confirmArchive ? (
                <div className="work-confirm-bar" role="alert">
                  <p>确认归档这部作品？</p>
                  <div>
                    <button
                      className="danger-button"
                      disabled={lifecycleBusy === 'archive'}
                      onClick={() => void archiveWork()}
                      type="button"
                    >
                      {lifecycleBusy === 'archive' ? '正在归档…' : '确认归档'}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirmArchive(false)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="work-detail-hero-status">
            {work.readOnly ? <span className="work-readonly-link">写作台只读</span> : null}
            <span className={`work-status work-status-${work.status}`}>{work.statusLabel}</span>
          </div>
        </section>

        <section className="work-stat-strip" aria-label="作品数据">
          <div>
            <span>创作进度</span>
            <strong>{work.progressPercent}%</strong>
          </div>
          <div>
            <span>累计字数</span>
            <strong>{work.wordCount.toLocaleString('zh-CN')}</strong>
          </div>
          <div>
            <span>最近编辑</span>
            <strong>{formatWorkDate(work.lastEditedAt)}</strong>
          </div>
          <div>
            <span>质量分</span>
            <strong>{work.qualityScore === null ? '暂无' : work.qualityScore}</strong>
          </div>
          <div>
            <span>未回收伏笔</span>
            <strong>{work.unresolvedForeshadowCount}</strong>
          </div>
        </section>

        <section className="work-overview-section" aria-labelledby="readiness-title">
          <div className="works-section-heading">
            <div>
              <p className="workspace-step">生成准备</p>
              <h2 id="readiness-title">准备度</h2>
            </div>
            <Link className="text-button" href={`/workspace/${work.id}/outline`}>
              查看大纲
            </Link>
          </div>
          <div className="work-readiness-grid">
            {readinessItems.map((item) => (
              <article
                className={`work-readiness-card ${item.ready ? 'is-ready' : ''}`}
                key={item.label}
              >
                <span>{item.ready ? '已就绪' : '待补齐'}</span>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="work-overview-section" aria-labelledby="quick-links-title">
          <div className="works-section-heading">
            <div>
              <p className="workspace-step">工作区</p>
              <h2 id="quick-links-title">快捷入口</h2>
            </div>
          </div>
          <div className="work-quick-grid">
            {QUICK_LINKS.map((item) => (
              <Link
                className="work-quick-card"
                href={`/workspace/${work.id}/${item.href}`}
                key={item.href}
              >
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>

        <div className="work-overview-columns">
          <section className="work-overview-section" aria-labelledby="recent-chapters-title">
            <div className="works-section-heading">
              <div>
                <p className="workspace-step">正文</p>
                <h2 id="recent-chapters-title">最近章节</h2>
              </div>
              <Link className="text-button" href={`/workspace/${work.id}/write`}>
                打开写作台
              </Link>
            </div>
            {recentChapters.length > 0 ? (
              <div className="work-chapter-list">
                {recentChapters.map((chapter) => (
                  <Link
                    className="work-chapter-row"
                    href={`/workspace/${work.id}/write`}
                    key={chapter.id}
                  >
                    <span>第 {chapter.chapterNumber ?? '—'} 章</span>
                    <strong>{chapter.title}</strong>
                    <small>{chapter.locked ? '已锁定' : '可编辑'}</small>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">还没有章节。先在大纲里规划第一章。</p>
            )}
          </section>

          <section className="work-overview-section" aria-labelledby="recent-changes-title">
            <div className="works-section-heading">
              <div>
                <p className="workspace-step">版本</p>
                <h2 id="recent-changes-title">最近修改</h2>
              </div>
              <Link className="text-button" href={`/workspace/${work.id}/changes`}>
                查看版本
              </Link>
            </div>
            {recentChanges.length > 0 ? (
              <div className="work-change-list">
                {recentChanges.map((change) => (
                  <article className="work-change-row" key={change.id}>
                    <strong>{change.actionLabel}</strong>
                    <p>{change.reason}</p>
                    <small>
                      {change.authorName} · {formatWorkDate(change.createdAt)}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">还没有修改记录。</p>
            )}
          </section>
        </div>

        <section className="work-overview-section" aria-labelledby="reminders-title">
          <div className="works-section-heading">
            <div>
              <p className="workspace-step">连续性</p>
              <h2 id="reminders-title">待处理提醒</h2>
            </div>
          </div>
          {continuityReminders.length > 0 || work.unresolvedForeshadowCount > 0 ? (
            <div className="work-reminder-list">
              {continuityReminders.map((reminder) => (
                <article className="work-reminder-row" key={reminder.id}>
                  <span>{reminder.severityLabel}</span>
                  <div>
                    <strong>{reminder.message}</strong>
                    <p>{reminder.suggestion}</p>
                  </div>
                  <Link className="text-button" href={`/workspace/${work.id}/write`}>
                    去写作台
                  </Link>
                </article>
              ))}
              {work.unresolvedForeshadowCount > 0 ? (
                <article className="work-reminder-row">
                  <span>伏笔</span>
                  <div>
                    <strong>{work.unresolvedForeshadowCount} 条伏笔还没有回收</strong>
                    <p>先确认哪些线索会影响接下来三章。</p>
                  </div>
                  <Link className="text-button" href={`/workspace/${work.id}/foreshadows`}>
                    查看账本
                  </Link>
                </article>
              ) : null}
            </div>
          ) : (
            <p className="dashboard-empty">暂无待处理提醒。</p>
          )}
        </section>
      </main>
    </WorkShell>
  );
}
