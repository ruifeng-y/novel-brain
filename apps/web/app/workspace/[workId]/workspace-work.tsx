'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../../lib/auth-api';
import { GENRE_LABELS, SCALE_LABELS, formatWorkDate, type Work } from '../../../lib/works-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; work: Work }
  | { status: 'error'; message: string; notFound: boolean };

export function WorkspaceWork({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([apiRequest<User>('/api/v1/auth/me'), apiRequest<Work>(`/api/v1/works/${workId}`)])
      .then(([user, work]) => setState({ status: 'ready', user, work }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({
          status: 'error',
          message: friendlyError(error),
          notFound: error instanceof ApiError && error.code === 'WORK_NOT_FOUND',
        });
      });
  }, [router, workId]);

  if (state.status === 'loading') {
    return (
      <main className="workspace-shell">
        <p className="workspace-loading">正在打开作品…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="workspace-shell">
        <section className="workspace-error">
          <h1>{state.notFound ? '没有找到这部作品' : '暂时无法打开作品'}</h1>
          <p>{state.message}</p>
          <Link className="secondary-button back-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { work } = state;

  return (
    <main className="workspace-shell work-detail-shell">
      <header className="workspace-header">
        <Link className="workspace-brand" href="/workspace">
          NovelBrain
        </Link>
        <div className="workspace-account">
          <span>{state.user.displayName}</span>
          <Link className="text-button" href="/workspace">
            返回作品列表
          </Link>
        </div>
      </header>

      <nav className="work-breadcrumb" aria-label="作品导航">
        <Link href="/workspace">作品</Link>
        <span>/</span>
        <span>{work.title}</span>
      </nav>

      <section className="work-detail-hero">
        <div>
          <p className="workspace-step">{GENRE_LABELS[work.genrePack] ?? work.genrePack}</p>
          <h1>{work.title}</h1>
          <p>
            {work.penName} · {SCALE_LABELS[work.scale] ?? work.scale} · {work.targetPlatform}
          </p>
        </div>
        <span className={`work-status work-status-${work.status}`}>{work.statusLabel}</span>
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
      </section>

      <div className="work-detail-grid">
        <section className="work-detail-section">
          <p className="workspace-step">作品信息</p>
          <h2>这本书的起点</h2>
          <dl className="work-facts">
            <div>
              <dt>笔名</dt>
              <dd>{work.penName}</dd>
            </div>
            <div>
              <dt>题材</dt>
              <dd>{GENRE_LABELS[work.genrePack] ?? work.genrePack}</dd>
            </div>
            <div>
              <dt>规模</dt>
              <dd>{SCALE_LABELS[work.scale] ?? work.scale}</dd>
            </div>
            <div>
              <dt>目标平台</dt>
              <dd>{work.targetPlatform}</dd>
            </div>
          </dl>
        </section>

        <section className="work-readiness">
          <p className="workspace-step">当前状态</p>
          <h2>主创作线已就绪</h2>
          <p>作品已经建立。接下来可以准备故事圣经、大纲和第一章。</p>
        </section>
      </div>
    </main>
  );
}
