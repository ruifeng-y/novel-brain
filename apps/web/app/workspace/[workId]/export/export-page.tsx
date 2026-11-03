'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import type { Work } from '../../../../lib/works-api';
import { ExportPanel } from '../export-panel';
import { PublishPanel } from '../publish-panel';

type ExportTab = 'export' | 'publish';

type ExportState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; work: Work }
  | { status: 'error'; message: string };

export function ExportPage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ExportState>({ status: 'loading' });
  const [tab, setTab] = useState<ExportTab>('export');

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
            error instanceof ApiError ? error.message : '暂时无法打开导出与发布。',
        });
      });
    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开导出与发布…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开导出与发布</h1>
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
    <WorkShell active="export" user={user} work={work} workId={work.id}>
      <main className="workspace-shell export-page-shell">
        <section className="settings-page-hero">
          <p className="workspace-step">交付</p>
          <h1>导出与发布</h1>
          <p>把正文和设定带出去；发布前先跑完检查清单，平台账号仍由作者自己管理。</p>
        </section>

        <nav aria-label="导出与发布栏目" className="settings-section-tabs">
          <button
            aria-current={tab === 'export' ? 'page' : undefined}
            onClick={() => setTab('export')}
            type="button"
          >
            导出
          </button>
          <button
            aria-current={tab === 'publish' ? 'page' : undefined}
            onClick={() => setTab('publish')}
            type="button"
          >
            发布准备
          </button>
        </nav>

        {tab === 'export' ? (
          <ExportPanel initialBranchId={work.mainBranch!.id} workId={work.id} />
        ) : (
          <PublishPanel initialBranchId={work.mainBranch!.id} workId={work.id} />
        )}
      </main>
    </WorkShell>
  );
}
