'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import {
  loadOutlineNodes,
  loadOutlineReadiness,
  type OutlineNode,
  type OutlineReadiness,
} from '../../../../lib/story-planning-api';
import { loadStoryLedger, type StoryLedger } from '../../../../lib/story-ledger-api';
import type { Work } from '../../../../lib/works-api';
import { StoryLedgerPanel } from '../story-ledger-panel';
import { OutlineWorkspacePanel } from '../outline-workspace-panel';
import { GoldenThreePanel } from './golden-three-panel';
import { OutlineBoard } from './outline-board';

type OutlineTab = 'structure' | 'board' | 'ledger' | 'golden';

type OutlineState =
  | { status: 'loading' }
  | {
      status: 'ready';
      user: User;
      work: Work;
      nodes: OutlineNode[];
      readiness: OutlineReadiness;
      ledger: StoryLedger;
    }
  | { status: 'error'; message: string };

const TABS: Array<{ key: OutlineTab; label: string }> = [
  { key: 'structure', label: '结构树' },
  { key: 'board', label: '章节看板' },
  { key: 'ledger', label: '账本与张力' },
  { key: 'golden', label: '黄金三章' },
];

export function OutlinePage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<OutlineState>({ status: 'loading' });
  const [tab, setTab] = useState<OutlineTab>('structure');

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
        const [outlineResponse, readiness, ledger] = await Promise.all([
          loadOutlineNodes(work.id, work.mainBranch.id),
          loadOutlineReadiness(work.id, work.mainBranch.id),
          loadStoryLedger(work.id, work.mainBranch.id),
        ]);
        if (active) {
          setState({
            status: 'ready',
            user,
            work,
            nodes: outlineResponse.items,
            readiness,
            ledger,
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
          message:
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : '暂时无法打开大纲工作台。',
        });
      });
    return () => {
      active = false;
    };
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开大纲工作台…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开大纲工作台</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { user, work, nodes, readiness, ledger } = state;
  const branchId = work.mainBranch!.id;

  return (
    <WorkShell active="outline" user={user} work={work} workId={work.id}>
      <main className="workspace-shell outline-page-shell">
        <section className="settings-page-hero">
          <p className="workspace-step">创作骨架</p>
          <h1>大纲工作台</h1>
          <p>先看全局，再写一章。全书、卷、幕、章、场景逐层展开；已写部分锁定，未写部分可改。</p>
        </section>

        <nav aria-label="大纲栏目" className="settings-section-tabs">
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

        {tab === 'structure' ? (
          <OutlineWorkspacePanel
            branchId={branchId}
            initialNodes={nodes}
            initialReadiness={readiness}
            workId={work.id}
          />
        ) : tab === 'board' ? (
          <OutlineBoard nodes={nodes} workId={work.id} />
        ) : tab === 'ledger' ? (
          <StoryLedgerPanel
            branchId={branchId}
            initialLedger={ledger}
            initialTab="threads"
            workId={work.id}
          />
        ) : (
          <GoldenThreePanel branchId={branchId} nodes={nodes} workId={work.id} />
        )}
      </main>
    </WorkShell>
  );
}
