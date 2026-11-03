'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import type { Work } from '../../../../lib/works-api';
import {
  loadStoryBible,
  loadStoryBibleInsights,
  type StoryBible,
  type StoryBibleInsights,
} from '../../../../lib/story-planning-api';
import { StoryPlanningPanel } from '../story-planning-panel';

type BibleState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      storyBible: StoryBible;
      insights: StoryBibleInsights;
    }
  | { status: 'error'; message: string };

export function BiblePage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<BibleState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<Work>(`/api/v1/works/${workId}`),
    ])
      .then(async ([user, work]) => {
        if (!work.mainBranch) {
          throw new Error('这个故事还没有可编辑的创作线。');
        }
        const [storyBible, insights] = await Promise.all([
          loadStoryBible(work.id, work.mainBranch.id),
          loadStoryBibleInsights(work.id, work.mainBranch.id),
        ]);
        if (active) {
          setState({ status: 'ready', user, work, storyBible, insights });
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
          message:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : '暂时无法打开故事圣经。',
        });
      });

    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开故事圣经…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开故事圣经</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { user, work, storyBible, insights } = state;

  return (
    <WorkShell active="bible" user={user} work={work} workId={work.id}>
      <main className="workspace-shell bible-page-shell">
        <div className="bible-page-layout">
          <aside aria-label="故事圣经九卡导航" className="bible-page-nav">
            <p className="workspace-step">九卡导航</p>
            {storyBible.cards.map((card, index) => (
              <a href={`#bible-card-${card.key}`} key={card.key}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{card.title}</strong>
                <small>{card.summary.trim() ? '已填写' : '待补全'}</small>
              </a>
            ))}
          </aside>

          <section className="bible-page-main" aria-label="故事圣经内容">
            <StoryPlanningPanel
              branchId={work.mainBranch!.id}
              initialInsights={insights}
              storyBible={storyBible}
              workId={work.id}
            />
          </section>
        </div>
      </main>
    </WorkShell>
  );
}
