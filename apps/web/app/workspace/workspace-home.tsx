'use client';

import { HISTORY_VARIANT_LABELS } from '@novel/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../lib/auth-api';
import type { PenNameListResponse } from '../../lib/account-api';
import {
  buildWorksQuery,
  GENRE_LABELS,
  SCALE_LABELS,
  TARGET_PLATFORMS,
  UPDATE_CADENCE_OPTIONS,
  formatWorkDate,
  type Work,
  type WorkCreationMode,
  type WorkListResponse,
  type WorkListFilters,
  type WorkStatus,
} from '../../lib/works-api';

type UserState =
  { status: 'loading' } | { status: 'ready'; user: User } | { status: 'error'; message: string };

type ShelfView = 'active' | 'archived' | 'trash';
type CreateMode = 'create' | 'import';

const STATUS_FILTERS: Array<{ value: '' | Exclude<WorkStatus, 'archived'>; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'preparing', label: '准备期' },
  { value: 'serializing', label: '连载期' },
  { value: 'paused', label: '暂停期' },
  { value: 'completed', label: '完本期' },
];

const SORT_OPTIONS = [
  { value: 'updated_desc', label: '最近更新' },
  { value: 'word_count_desc', label: '字数从多到少' },
  { value: 'word_count_asc', label: '字数从少到多' },
  { value: 'progress_desc', label: '进度从高到低' },
  { value: 'quality_desc', label: '质量分从高到低' },
] as const;

const WORD_RANGES = [
  { value: 'all', label: '全部字数' },
  { value: 'under100k', label: '10 万字内' },
  { value: '100k-300k', label: '10–30 万字' },
  { value: '300k-1m', label: '30–100 万字' },
  { value: 'over1m', label: '100 万字以上' },
] as const;

export function WorkspaceHome() {
  const router = useRouter();
  const [userState, setUserState] = useState<UserState>({ status: 'loading' });
  const [works, setWorks] = useState<Work[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [penNames, setPenNames] = useState<PenNameListResponse['items']>([]);
  const [worksError, setWorksError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<ShelfView>('active');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Exclude<WorkStatus, 'archived'>>('');
  const [genreFilter, setGenreFilter] = useState('');
  const [wordRange, setWordRange] = useState<(typeof WORD_RANGES)[number]['value']>('all');
  const [recentDays, setRecentDays] = useState('');
  const [sort, setSort] = useState<WorkListFilters['sort']>('updated_desc');
  const [mode, setMode] = useState<CreateMode>('create');
  const [entryMode, setEntryMode] = useState<WorkCreationMode>('blank');
  const [genrePack, setGenrePack] = useState<'xianxia' | 'history' | 'urban'>('xianxia');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [leaving, setLeaving] = useState<'current' | 'all'>();

  useEffect(() => {
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<PenNameListResponse>('/api/v1/users/me/pen-names'),
    ])
      .then(([user, response]) => {
        setUserState({ status: 'ready', user });
        setPenNames(response.items);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setUserState({ status: 'error', message: friendlyError(error) });
      });
  }, [router]);

  useEffect(() => {
    if (userState.status !== 'ready') {
      return;
    }
    let active = true;
    setWorksLoading(true);
    setWorksError('');
    const filters: WorkListFilters = {
      search,
      view,
      sort,
      ...wordRangeFilters(wordRange),
      ...(recentDays ? { recentDays: Number(recentDays) } : {}),
      ...(view === 'active' && statusFilter ? { status: statusFilter } : {}),
      ...(genreFilter ? { genrePack: genreFilter as Work['genrePack'] } : {}),
    };
    apiRequest<WorkListResponse>(`/api/v1/works${buildWorksQuery(filters)}`)
      .then((response) => {
        if (active) {
          setWorks(response.items);
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
        setWorksError(friendlyError(error));
      })
      .finally(() => {
        if (active) {
          setWorksLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    genreFilter,
    recentDays,
    router,
    search,
    sort,
    statusFilter,
    userState.status,
    view,
    wordRange,
  ]);

  async function refreshWorks() {
    const filters: WorkListFilters = {
      search,
      view,
      sort,
      ...wordRangeFilters(wordRange),
      ...(recentDays ? { recentDays: Number(recentDays) } : {}),
      ...(view === 'active' && statusFilter ? { status: statusFilter } : {}),
      ...(genreFilter ? { genrePack: genreFilter as Work['genrePack'] } : {}),
    };
    const response = await apiRequest<WorkListResponse>(`/api/v1/works${buildWorksQuery(filters)}`);
    setWorks(response.items);
  }

  async function signOut(allDevices: boolean) {
    setLeaving(allDevices ? 'all' : 'current');
    try {
      await apiRequest<void>(allDevices ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', {
        method: 'POST',
      });
      router.replace('/login');
    } catch (error) {
      setUserState({ status: 'error', message: friendlyError(error) });
      setLeaving(undefined);
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormBusy(true);
    setFormError('');
    setNotice('');

    try {
      const work = await apiRequest<Work>('/api/v1/works', {
        method: 'POST',
        body: JSON.stringify(workPayload(form, entryMode)),
      });
      router.push(`/workspace/${work.id}`);
    } catch (error) {
      setFormError(friendlyError(error));
      setFormBusy(false);
    }
  }

  async function submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('manuscript');
    setFormBusy(true);
    setFormError('');
    setNotice('');
    if (!(file instanceof File) || file.size === 0) {
      setFormError('请选择要导入的旧稿文件。');
      setFormBusy(false);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFormError('旧稿文件不能超过 20 MB。');
      setFormBusy(false);
      return;
    }

    try {
      const manuscript = await readManuscript(file);
      const result = await apiRequest<{ workId: string; chapterCount: number }>(
        '/api/v1/works/import',
        {
          method: 'POST',
          body: JSON.stringify({
            ...workPayload(form, 'blank'),
            fileName: file.name,
            ...manuscript,
          }),
        },
      );
      router.push(`/workspace/${result.workId}`);
    } catch (error) {
      setFormError(friendlyError(error));
      setFormBusy(false);
    }
  }

  async function archiveWork(work: Work) {
    await runWorkAction(work.id, 'archive', async () => {
      await apiRequest(`/api/v1/works/${work.id}/archive`, { method: 'POST' });
      setNotice(`《${work.title}》已移至已归档。`);
    });
  }

  async function restoreWork(work: Work) {
    await runWorkAction(work.id, 'restore', async () => {
      await apiRequest(`/api/v1/works/${work.id}/restore`, { method: 'POST' });
      setNotice(`《${work.title}》已恢复到书架。`);
    });
  }

  async function recoverWork(work: Work) {
    await runWorkAction(work.id, 'recover', async () => {
      await apiRequest(`/api/v1/works/${work.id}/recover`, { method: 'POST' });
      setNotice(`《${work.title}》已从回收站恢复。`);
    });
  }

  async function removeWork(work: Work) {
    await runWorkAction(work.id, 'delete', async () => {
      await apiRequest(`/api/v1/works/${work.id}`, { method: 'DELETE' });
      setConfirmDeleteId(undefined);
      setNotice(`《${work.title}》已移入回收站，30 天内可以恢复。`);
    });
  }

  async function reopenWork(work: Work) {
    await runWorkAction(work.id, 'reopen', async () => {
      await apiRequest(`/api/v1/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'serializing' }),
      });
      setNotice(`《${work.title}》已重新开启为连载中。`);
    });
  }

  async function copyWork(work: Work) {
    await runWorkAction(work.id, 'copy', async () => {
      const copied = await apiRequest<Work>(`/api/v1/works/${work.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice(`已复制为《${copied.title}》，正文不会带入新作品。`);
    });
  }

  async function runWorkAction(workId: string, action: string, callback: () => Promise<void>) {
    setBusyAction(`${action}:${workId}`);
    setWorksError('');
    setNotice('');
    try {
      await callback();
      await refreshWorks();
    } catch (error) {
      setWorksError(friendlyError(error));
    } finally {
      setBusyAction('');
    }
  }

  if (userState.status === 'loading') {
    return (
      <main className="workspace-shell">
        <p className="workspace-loading">正在打开你的工作台…</p>
      </main>
    );
  }

  if (userState.status === 'error') {
    return (
      <main className="workspace-shell">
        <section className="workspace-error">
          <h1>暂时无法打开工作台</h1>
          <p>{userState.message}</p>
          <button
            className="secondary-button"
            onClick={() => window.location.reload()}
            type="button"
          >
            重新加载
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <span className="workspace-brand">NovelBrain</span>
        <div className="workspace-account">
          <Link href="/workspace/settings">模型设置</Link>
          <Link href="/workspace/settings/account">账号设置</Link>
          <Link href="/workspace/settings/privacy">隐私与合规</Link>
          <span>{userState.user.displayName}</span>
          <button
            className="text-button"
            disabled={Boolean(leaving)}
            onClick={() => signOut(false)}
            type="button"
          >
            {leaving === 'current' ? '正在退出…' : '退出登录'}
          </button>
        </div>
      </header>

      <section className="workspace-intro">
        <div>
          <div className="workspace-scope-line">
            <p className="workspace-step">作品书架</p>
            <span className="workspace-beta-badge">V1 验收候选</span>
          </div>
          <h1>你的作品</h1>
          <p className="workspace-beta-note">
            在这里管理连载中的书、已归档的作品和最近删除的旧稿。
          </p>
        </div>
        <p className="workspace-email">共 {works.length} 部作品</p>
      </section>

      <div className="workspace-layout">
        <section className="works-list-section" aria-labelledby="works-list-title">
          <div className="works-section-heading">
            <div>
              <h2 id="works-list-title">全部作品</h2>
              <p>按名称、状态和分类整理书架，也能按字数或质量分排序。</p>
            </div>
            <span>{works.length} 部</span>
          </div>

          <div className="library-tabs" role="tablist" aria-label="书架范围">
            {[
              ['active', '进行中的作品'],
              ['archived', '已归档'],
              ['trash', '回收站'],
            ].map(([value, label]) => (
              <button
                aria-selected={view === value}
                className={view === value ? 'active' : ''}
                key={value}
                onClick={() => {
                  setView(value as ShelfView);
                  setStatusFilter('');
                  setConfirmDeleteId(undefined);
                  setNotice('');
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <form
            className="library-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <label className="field library-search">
              <span>搜索作品</span>
              <input
                maxLength={120}
                onChange={(event) => setSearchInput(event.currentTarget.value)}
                placeholder="书名或笔名"
                value={searchInput}
              />
            </label>
            <label className="field">
              <span>状态</span>
              <select
                disabled={view !== 'active'}
                onChange={(event) =>
                  setStatusFilter(event.currentTarget.value as '' | Exclude<WorkStatus, 'archived'>)
                }
                value={statusFilter}
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>分类</span>
              <select
                onChange={(event) => setGenreFilter(event.currentTarget.value)}
                value={genreFilter}
              >
                <option value="">全部</option>
                {Object.entries(GENRE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>排序</span>
              <select
                onChange={(event) => setSort(event.currentTarget.value as WorkListFilters['sort'])}
                value={sort}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>字数范围</span>
              <select
                onChange={(event) =>
                  setWordRange(event.currentTarget.value as (typeof WORD_RANGES)[number]['value'])
                }
                value={wordRange}
              >
                {WORD_RANGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>编辑时间</span>
              <select
                onChange={(event) => setRecentDays(event.currentTarget.value)}
                value={recentDays}
              >
                <option value="">不限时间</option>
                <option value="7">最近 7 天</option>
                <option value="30">最近 30 天</option>
                <option value="90">最近 90 天</option>
              </select>
            </label>
            <button className="secondary-button" type="submit">
              搜索
            </button>
          </form>

          {worksError ? (
            <p className="form-message form-message-error" role="alert">
              {worksError}
            </p>
          ) : null}
          {notice ? (
            <p className="form-message form-message-success" role="status">
              {notice}
            </p>
          ) : null}

          {worksLoading && works.length === 0 ? (
            <p className="workspace-loading">正在整理书架…</p>
          ) : works.length === 0 ? (
            <div className="works-empty">
              <p className="workspace-step">
                {view === 'trash' ? '回收站' : view === 'archived' ? '已归档' : '从第一本书开始'}
              </p>
              <h2>
                {view === 'trash'
                  ? '回收站是空的'
                  : view === 'archived'
                    ? '还没有归档作品'
                    : '书架还是空的'}
              </h2>
              <p>
                {view === 'trash'
                  ? '删除的作品会在这里保留 30 天。'
                  : view === 'archived'
                    ? '暂时收起的作品会出现在这里，随时可以恢复。'
                    : '在右侧新建或导入一部作品，第一段旅程就会从这里开始。'}
              </p>
            </div>
          ) : (
            <div className="work-list">
              {works.map((work) => (
                <article className="work-card" key={work.id}>
                  <div className="work-card-heading">
                    <div className="work-card-heading-main">
                      {work.coverUrl && view !== 'trash' ? (
                        <img
                          alt={`《${work.title}》封面`}
                          className="work-card-cover"
                          src={work.coverUrl}
                        />
                      ) : null}
                      <div>
                        <p className="work-card-genre">
                          {GENRE_LABELS[work.genrePack] ?? work.genrePack}
                          {work.genreVariantLabel ? ` · ${work.genreVariantLabel}` : ''}
                        </p>
                        {view === 'trash' ? (
                          <h3>{work.title}</h3>
                        ) : (
                          <Link
                            aria-label={`打开《${work.title}》`}
                            className="work-card-title-link"
                            href={`/workspace/${work.id}`}
                          >
                            <h3>{work.title}</h3>
                          </Link>
                        )}
                      </div>
                    </div>
                    <span className={`work-status work-status-${work.status}`}>
                      {work.statusLabel}
                    </span>
                  </div>
                  <p className="work-card-meta">
                    {work.penName} · {SCALE_LABELS[work.scale] ?? work.scale} ·{' '}
                    {work.targetPlatform}
                  </p>
                  {work.tags.length > 0 ? (
                    <ul className="work-card-tags" aria-label="作品标签">
                      {work.tags.slice(0, 5).map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="work-card-stats">
                    <div className="work-stat">
                      <span>进度</span>
                      <strong>{work.progressPercent}%</strong>
                    </div>
                    <div className="work-progress-track" aria-hidden="true">
                      <span style={{ width: `${work.progressPercent}%` }} />
                    </div>
                    <div className="work-stat">
                      <span>字数</span>
                      <strong>{work.wordCount.toLocaleString('zh-CN')}</strong>
                    </div>
                    <div className="work-stat">
                      <span>质量分</span>
                      <strong>{work.qualityScore === null ? '暂无' : work.qualityScore}</strong>
                    </div>
                    <div className="work-stat">
                      <span>未回收</span>
                      <strong>{work.unresolvedForeshadowCount}</strong>
                    </div>
                    <div className="work-stat work-stat-date">
                      <span>最近编辑</span>
                      <strong>{formatWorkDate(work.lastEditedAt)}</strong>
                    </div>
                  </div>

                  <div className="work-card-actions">
                    {view === 'active' ? (
                      <>
                        {work.status === 'completed' ? (
                          <button
                            className="secondary-button"
                            disabled={busyAction === `reopen:${work.id}`}
                            onClick={() => void reopenWork(work)}
                            type="button"
                          >
                            {busyAction === `reopen:${work.id}` ? '正在恢复…' : '恢复连载'}
                          </button>
                        ) : null}
                        <button
                          className="text-button"
                          disabled={busyAction === `copy:${work.id}`}
                          onClick={() => void copyWork(work)}
                          type="button"
                        >
                          {busyAction === `copy:${work.id}` ? '正在复制…' : '复制作品'}
                        </button>
                        <button
                          className="text-button"
                          disabled={busyAction === `archive:${work.id}`}
                          onClick={() => void archiveWork(work)}
                          type="button"
                        >
                          {busyAction === `archive:${work.id}` ? '正在归档…' : '归档'}
                        </button>
                        <button
                          className="text-button danger-text"
                          onClick={() => setConfirmDeleteId(work.id)}
                          type="button"
                        >
                          删除
                        </button>
                      </>
                    ) : view === 'archived' ? (
                      <>
                        <button
                          className="secondary-button"
                          disabled={busyAction === `restore:${work.id}`}
                          onClick={() => void restoreWork(work)}
                          type="button"
                        >
                          {busyAction === `restore:${work.id}` ? '正在恢复…' : '恢复作品'}
                        </button>
                        <button
                          className="text-button danger-text"
                          onClick={() => setConfirmDeleteId(work.id)}
                          type="button"
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      <button
                        className="secondary-button"
                        disabled={busyAction === `recover:${work.id}`}
                        onClick={() => void recoverWork(work)}
                        type="button"
                      >
                        {busyAction === `recover:${work.id}` ? '正在恢复…' : '恢复作品'}
                      </button>
                    )}
                  </div>

                  {confirmDeleteId === work.id ? (
                    <div className="work-delete-confirm" role="alert">
                      <p>确认把《{work.title}》移入回收站？30 天内可以恢复。</p>
                      <div>
                        <button
                          className="danger-button"
                          disabled={busyAction === `delete:${work.id}`}
                          onClick={() => void removeWork(work)}
                          type="button"
                        >
                          {busyAction === `delete:${work.id}` ? '正在删除…' : '确认删除'}
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setConfirmDeleteId(undefined)}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="create-panel" aria-labelledby="create-work-title">
          <div className="create-panel-heading">
            <p className="workspace-step">开始写作</p>
            <h2 id="create-work-title">{mode === 'create' ? '开始一本新书' : '导入已有旧稿'}</h2>
          </div>

          <div className="create-mode-tabs" role="tablist" aria-label="新建或导入">
            <button
              aria-selected={mode === 'create'}
              className={mode === 'create' ? 'active' : ''}
              onClick={() => {
                setMode('create');
                setFormError('');
              }}
              role="tab"
              type="button"
            >
              新建作品
            </button>
            <button
              aria-selected={mode === 'import'}
              className={mode === 'import' ? 'active' : ''}
              onClick={() => {
                setMode('import');
                setFormError('');
              }}
              role="tab"
              type="button"
            >
              导入旧稿
            </button>
          </div>

          {mode === 'create' ? (
            <form className="auth-form create-form" onSubmit={submitCreate}>
              <div className="create-entry-tabs" role="tablist" aria-label="创建入口">
                <button
                  aria-selected={entryMode === 'idea'}
                  className={entryMode === 'idea' ? 'active' : ''}
                  onClick={() => {
                    setEntryMode('idea');
                    setFormError('');
                  }}
                  role="tab"
                  type="button"
                >
                  一句话想法
                </button>
                <button
                  aria-selected={entryMode === 'blank'}
                  className={entryMode === 'blank' ? 'active' : ''}
                  onClick={() => {
                    setEntryMode('blank');
                    setFormError('');
                  }}
                  role="tab"
                  type="button"
                >
                  空白作品
                </button>
              </div>
              <WorkFields
                entryMode={entryMode}
                genrePack={genrePack}
                onGenrePackChange={setGenrePack}
                penNames={penNames}
              />
              {formError ? (
                <p className="form-message form-message-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <button className="primary-button create-submit" disabled={formBusy} type="submit">
                {formBusy ? '正在创建…' : '创建并开始'}
              </button>
            </form>
          ) : (
            <form className="auth-form create-form" onSubmit={submitImport}>
              <WorkFields
                entryMode="blank"
                genrePack={genrePack}
                onGenrePackChange={setGenrePack}
                penNames={penNames}
              />
              <label className="field">
                <span>旧稿文件</span>
                <input accept=".txt,.md,.markdown,.docx" name="manuscript" type="file" />
              </label>
              <p className="field-hint">
                支持 TXT、Markdown 和 Word。系统会按章节标题切分，并保留原稿正文。
              </p>
              {formError ? (
                <p className="form-message form-message-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <button className="primary-button create-submit" disabled={formBusy} type="submit">
                {formBusy ? '正在导入…' : '导入并开始'}
              </button>
            </form>
          )}

          <div className="create-panel-foot">
            <p>账号</p>
            <span>{userState.user.email}</span>
            <button
              className="text-button create-signout"
              disabled={Boolean(leaving)}
              onClick={() => signOut(true)}
              type="button"
            >
              {leaving === 'all' ? '正在退出…' : '退出所有设备'}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function WorkFields({
  entryMode,
  genrePack,
  onGenrePackChange,
  penNames,
}: {
  entryMode: WorkCreationMode;
  genrePack: 'xianxia' | 'history' | 'urban';
  onGenrePackChange: (genrePack: 'xianxia' | 'history' | 'urban') => void;
  penNames: PenNameListResponse['items'];
}) {
  return (
    <>
      {entryMode === 'idea' ? (
        <label className="field">
          <span>故事灵感</span>
          <textarea
            maxLength={5_000}
            name="idea"
            placeholder="一句话写下最想讲的故事"
            required
            rows={4}
          />
        </label>
      ) : null}
      <label className="field">
        <span>{entryMode === 'idea' ? '书名（可选）' : '书名'}</span>
        <input
          autoComplete="off"
          maxLength={120}
          name="title"
          placeholder={entryMode === 'idea' ? '留空时从灵感里提炼' : '例如：仙途万里'}
          required={entryMode === 'blank'}
        />
      </label>
      <label className="field">
        <span>笔名</span>
        <input
          autoComplete="off"
          defaultValue={penNames.find((penName) => penName.isDefault)?.name ?? penNames[0]?.name}
          list="workspace-pen-names"
          maxLength={60}
          name="penName"
          placeholder="这本书使用的笔名"
          required
        />
        <datalist id="workspace-pen-names">
          {penNames.map((penName) => (
            <option key={penName.id} value={penName.name}>
              {penName.isDefault ? '默认笔名' : penName.bio || '已保存笔名'}
            </option>
          ))}
        </datalist>
      </label>
      <div className="create-field-row">
        <label className="field">
          <span>题材</span>
          <select
            name="genrePack"
            onChange={(event) =>
              onGenrePackChange(event.currentTarget.value as 'xianxia' | 'history' | 'urban')
            }
            value={genrePack}
          >
            {Object.entries(GENRE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>规模</span>
          <select defaultValue="long" name="scale">
            {Object.entries(SCALE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {genrePack === 'history' ? (
        <label className="field">
          <span>历史方向</span>
          <select defaultValue="alternate_ancient" name="genreVariant">
            {Object.entries(HISTORY_VARIANT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span>目标平台</span>
        <select defaultValue={TARGET_PLATFORMS[0]} name="targetPlatform">
          {TARGET_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
        </select>
      </label>
      <details className="create-workshop-details">
        <summary>写作约定（可选）</summary>
        <div className="create-field-row">
          <label className="field">
            <span>目标读者</span>
            <input maxLength={200} name="targetReader" placeholder="例如：喜欢长线伏笔的读者" />
          </label>
          <label className="field">
            <span>章节字数</span>
            <input
              defaultValue={3000}
              max={20_000}
              min={500}
              name="chapterWordCount"
              step={100}
              type="number"
            />
          </label>
        </div>
        <div className="create-field-row">
          <label className="field">
            <span>更新节奏</span>
            <select defaultValue="日更" name="updateCadence">
              {UPDATE_CADENCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>作品标签</span>
            <input maxLength={300} name="tags" placeholder="用逗号分隔，例如：升级流，群像" />
          </label>
        </div>
        <label className="field">
          <span>简介</span>
          <textarea maxLength={4_000} name="synopsis" placeholder="写给读者看的作品简介" rows={3} />
        </label>
        <label className="field">
          <span>风格样本</span>
          <textarea
            maxLength={20_000}
            name="styleSamples"
            placeholder="贴一段代表这本书语感的文字"
            rows={3}
          />
        </label>
        <label className="field">
          <span>禁忌</span>
          <textarea maxLength={2_000} name="taboos" placeholder="例如：不写无代价复活" rows={2} />
        </label>
      </details>
    </>
  );
}

function workPayload(form: FormData, entryMode: WorkCreationMode): Record<string, unknown> {
  const title = String(form.get('title') ?? '').trim();
  const idea = String(form.get('idea') ?? '').trim();
  const chapterWordCount = String(form.get('chapterWordCount') ?? '').trim();
  return {
    creationMode: entryMode,
    ...(title ? { title } : {}),
    ...(entryMode === 'idea' ? { idea } : {}),
    penName: String(form.get('penName') ?? ''),
    genrePack: String(form.get('genrePack') ?? ''),
    ...(form.get('genreVariant') ? { genreVariant: String(form.get('genreVariant')) } : {}),
    scale: String(form.get('scale') ?? ''),
    targetPlatform: String(form.get('targetPlatform') ?? ''),
    ...(chapterWordCount ? { chapterWordCount: Number(chapterWordCount) } : {}),
    ...(form.get('updateCadence') ? { updateCadence: String(form.get('updateCadence')) } : {}),
    ...(String(form.get('targetReader') ?? '').trim()
      ? { targetReader: String(form.get('targetReader')).trim() }
      : {}),
    ...(String(form.get('synopsis') ?? '').trim()
      ? { synopsis: String(form.get('synopsis')).trim() }
      : {}),
    ...(String(form.get('styleSamples') ?? '').trim()
      ? { styleSamples: String(form.get('styleSamples')).trim() }
      : {}),
    ...(String(form.get('taboos') ?? '').trim()
      ? { taboos: String(form.get('taboos')).trim() }
      : {}),
    ...(String(form.get('tags') ?? '').trim()
      ? {
          tags: splitCommaValues(String(form.get('tags'))),
        }
      : {}),
  };
}

function splitCommaValues(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

async function readManuscript(file: File): Promise<{ content?: string; contentBase64?: string }> {
  if (file.name.toLowerCase().endsWith('.docx')) {
    return { contentBase64: arrayBufferToBase64(await file.arrayBuffer()) };
  }
  return { content: await file.text() };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function wordRangeFilters(
  range: (typeof WORD_RANGES)[number]['value'],
): Pick<WorkListFilters, 'minWordCount' | 'maxWordCount'> {
  if (range === 'under100k') {
    return { maxWordCount: 99_999 };
  }
  if (range === '100k-300k') {
    return { minWordCount: 100_000, maxWordCount: 299_999 };
  }
  if (range === '300k-1m') {
    return { minWordCount: 300_000, maxWordCount: 999_999 };
  }
  if (range === 'over1m') {
    return { minWordCount: 1_000_000 };
  }
  return {};
}
