'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import { loadStoryLedger, type StoryLedger } from '../../../../lib/story-ledger-api';
import type { Work } from '../../../../lib/works-api';
import { StoryLedgerPanel } from '../story-ledger-panel';

type ForeshadowsState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; work: Work; ledger: StoryLedger }
  | { status: 'error'; message: string };

export function ForeshadowsPage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ForeshadowsState>({ status: 'loading' });

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
        const ledger = await loadStoryLedger(work.id, work.mainBranch.id);
        if (active) {
          setState({ status: 'ready', user, work, ledger });
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
                : '暂时无法打开伏笔账本。',
        });
      });
    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开伏笔账本…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开伏笔账本</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { user, work, ledger } = state;

  return (
    <WorkShell active="foreshadows" user={user} work={work} workId={work.id}>
      <main className="workspace-shell foreshadows-page-shell">
        <section className="settings-page-hero">
          <p className="workspace-step">长线线索</p>
          <h1>伏笔账本</h1>
          <p>埋下的线索都要有回收计划；过期、重复和没有埋设就回收的伏笔会在这里暴露。</p>
        </section>
        <StoryLedgerPanel
          branchId={work.mainBranch!.id}
          initialLedger={ledger}
          initialTab="foreshadows"
          workId={work.id}
        />
      </main>
    </WorkShell>
  );
}
