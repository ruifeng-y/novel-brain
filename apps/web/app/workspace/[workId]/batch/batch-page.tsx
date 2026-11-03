'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import type { Work } from '../../../../lib/works-api';
import { TaskCenter } from '../jobs/task-center';

type BatchState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; work: Work }
  | { status: 'error'; message: string };

export function BatchPage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<BatchState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<Work>(`/api/v1/works/${workId}`),
    ])
      .then(([user, work]) => {
        if (active) {
          setState({ status: 'ready', user, work });
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
            error instanceof ApiError ? error.message : '暂时无法打开批量生产。',
        });
      });
    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开批量生产…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开批量生产</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { user, work } = state;

  return (
    <WorkShell active="batch" user={user} work={work} workId={work.id}>
      <div className="workspace-shell batch-page-shell">
        <TaskCenter showHeader={false} workId={work.id} />
      </div>
    </WorkShell>
  );
}
