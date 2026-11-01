'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../lib/auth-api';
import {
  GENRE_LABELS,
  SCALE_LABELS,
  TARGET_PLATFORMS,
  formatWorkDate,
  type Work,
  type WorkListResponse,
} from '../../lib/works-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; works: Work[] }
  | { status: 'error'; message: string };

export function WorkspaceHome() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [leaving, setLeaving] = useState<'current' | 'all'>();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    Promise.all([apiRequest<User>('/api/v1/auth/me'), apiRequest<WorkListResponse>('/api/v1/works')])
      .then(([user, works]) => setState({ status: 'ready', user, works: works.items }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({ status: 'error', message: friendlyError(error) });
      });
  }, [router]);

  async function signOut(allDevices: boolean) {
    setLeaving(allDevices ? 'all' : 'current');
    try {
      await apiRequest<void>(allDevices ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', {
        method: 'POST',
      });
      router.replace('/login');
    } catch (error) {
      setState({ status: 'error', message: friendlyError(error) });
      setLeaving(undefined);
    }
  }

  async function createWork(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreating(true);
    setCreateError('');

    try {
      const work = await apiRequest<Work>('/api/v1/works', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          penName: form.get('penName'),
          genrePack: form.get('genrePack'),
          scale: form.get('scale'),
          targetPlatform: form.get('targetPlatform'),
        }),
      });
      router.push(`/workspace/${work.id}`);
    } catch (error) {
      setCreateError(friendlyError(error));
      setCreating(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <main className="workspace-shell">
        <p className="workspace-loading">正在打开你的工作台…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="workspace-shell">
        <section className="workspace-error">
          <h1>暂时无法打开工作台</h1>
          <p>{state.message}</p>
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
          <span>{state.user.displayName}</span>
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
          <p className="workspace-step">作品书架</p>
          <h1>你的作品</h1>
        </div>
        <p className="workspace-email">共 {state.works.length} 部作品</p>
      </section>

      <div className="workspace-layout">
        <section className="works-list-section" aria-labelledby="works-list-title">
          <div className="works-section-heading">
            <h2 id="works-list-title">全部作品</h2>
            <span>{state.works.length} 部</span>
          </div>

          {state.works.length === 0 ? (
            <div className="works-empty">
              <p className="workspace-step">从第一本书开始</p>
              <h2>书架还是空的</h2>
              <p>在右侧填好作品信息，第一段旅程就会从这里开始。</p>
            </div>
          ) : (
            <div className="work-list">
              {state.works.map((work) => (
                <Link
                  aria-label={`打开《${work.title}》`}
                  className="work-card"
                  href={`/workspace/${work.id}`}
                  key={work.id}
                >
                  <article>
                    <div className="work-card-heading">
                      <div>
                        <p className="work-card-genre">
                          {GENRE_LABELS[work.genrePack] ?? work.genrePack}
                        </p>
                        <h3>{work.title}</h3>
                      </div>
                      <span className={`work-status work-status-${work.status}`}>
                        {work.statusLabel}
                      </span>
                    </div>
                    <p className="work-card-meta">
                      {work.penName} · {SCALE_LABELS[work.scale] ?? work.scale} ·{' '}
                      {work.targetPlatform}
                    </p>
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
                      <div className="work-stat work-stat-date">
                        <span>最近编辑</span>
                        <strong>{formatWorkDate(work.lastEditedAt)}</strong>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="create-panel" aria-labelledby="create-work-title">
          <div className="create-panel-heading">
            <p className="workspace-step">新建作品</p>
            <h2 id="create-work-title">开始一本新书</h2>
          </div>

          <form className="auth-form create-form" onSubmit={createWork}>
            <label className="field">
              <span>书名</span>
              <input
                autoComplete="off"
                maxLength={120}
                name="title"
                placeholder="例如：仙途万里"
                required
              />
            </label>
            <label className="field">
              <span>笔名</span>
              <input
                autoComplete="off"
                maxLength={60}
                name="penName"
                placeholder="这本书使用的笔名"
                required
              />
            </label>
            <div className="create-field-row">
              <label className="field">
                <span>题材</span>
                <select defaultValue="xianxia" name="genrePack">
                  <option value="xianxia">仙侠</option>
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

            {createError ? (
              <p className="form-message form-message-error" role="alert">
                {createError}
              </p>
            ) : null}

            <button className="primary-button create-submit" disabled={creating} type="submit">
              {creating ? '正在创建…' : '创建并开始'}
            </button>
          </form>

          <div className="create-panel-foot">
            <p>账号</p>
            <span>{state.user.email}</span>
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
