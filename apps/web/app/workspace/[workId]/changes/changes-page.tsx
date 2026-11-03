'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import type { Work } from '../../../../lib/works-api';
import { ChangeRequestPanel } from '../change-request-panel';
import { ParallelVersionsPanel } from '../parallel-versions-panel';
import { VersionHistoryPanel } from '../version-history-panel';

type ChangesTab = 'requests' | 'parallel' | 'versions';

type ChangesState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; work: Work }
  | { status: 'error'; message: string };

const TABS: Array<{ key: ChangesTab; label: string }> = [
  { key: 'requests', label: '修改请求' },
  { key: 'parallel', label: '平行版本' },
  { key: 'versions', label: '版本与回滚' },
];

export function ChangesPage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ChangesState>({ status: 'loading' });
  const [tab, setTab] = useState<ChangesTab>('requests');

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
            error instanceof ApiError
              ? error.message
              : '暂时无法打开修改与版本。',
        });
      });
    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开修改与版本…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开修改与版本</h1>
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
    <WorkShell active="changes" user={user} work={work} workId={work.id}>
      <main className="workspace-shell changes-page-shell">
        <section className="settings-page-hero">
          <p className="workspace-step">版本</p>
          <h1>修改与版本</h1>
          <p>改故事，不改历史。已写部分锁定，大修拉平行版本，所有修改保留原因和回滚点。</p>
        </section>

        <nav aria-label="修改与版本栏目" className="settings-section-tabs">
          {TABS.map((item) => (
            <button
              aria-current={tab === item.key ? 'page' : undefined}
              key={item.key}
              onClick={() => setTab(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        {tab === 'requests' ? (
          <ChangeRequestPanel branchId={work.mainBranch!.id} workId={work.id} />
        ) : tab === 'parallel' ? (
          <ParallelVersionsPanel branchId={work.mainBranch!.id} workId={work.id} />
        ) : (
          <VersionHistoryPanel branchId={work.mainBranch!.id} workId={work.id} />
        )}
      </main>
    </WorkShell>
  );
}
