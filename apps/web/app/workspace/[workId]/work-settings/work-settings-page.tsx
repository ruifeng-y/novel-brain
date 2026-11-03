'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WorkShell } from '../../../_components/app-shell';
import { ApiError, apiRequest, type User } from '../../../../lib/auth-api';
import type { Work } from '../../../../lib/works-api';
import { WorkProfilePanel } from '../work-profile-panel';

type SettingsState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; work: Work }
  | { status: 'error'; message: string };

type ConfirmAction = 'archive' | 'trash' | null;

export function WorkSettingsPage({ workId }: { workId: string }) {
  const router = useRouter();
  const [state, setState] = useState<SettingsState>({ status: 'loading' });
  const [busy, setBusy] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest<User>('/api/v1/auth/me'),
      apiRequest<Work>(`/api/v1/works/${workId}`),
    ])
      .then(([user, work]) => setState({ status: 'ready', user, work }))
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          router.replace('/login');
          return;
        }
        setState({
          status: 'error',
          message:
            requestError instanceof ApiError
              ? requestError.message
              : '暂时无法打开作品设置。',
        });
      });
  }, [router, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开作品设置…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开作品设置</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const { work } = state;

  async function run(action: string, callback: () => Promise<void>) {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await callback();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : '操作失败，请稍后再试。',
      );
    } finally {
      setBusy('');
      setConfirmAction(null);
    }
  }

  async function setStatus(status: 'serializing' | 'completed') {
    await run(status, async () => {
      const updated = await apiRequest<Work>(`/api/v1/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setState((current) =>
        current.status === 'ready' ? { ...current, work: updated } : current,
      );
      setNotice(status === 'completed' ? '作品已标记完本。' : '作品已恢复连载。');
    });
  }

  async function copyWork() {
    await run('copy', async () => {
      const copied = await apiRequest<Work>(`/api/v1/works/${work.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      router.push(`/workspace/${copied.id}/overview`);
    });
  }

  async function archiveWork() {
    await run('archive', async () => {
      await apiRequest(`/api/v1/works/${work.id}/archive`, { method: 'POST' });
      router.push('/workspace');
    });
  }

  async function trashWork() {
    await run('trash', async () => {
      await apiRequest(`/api/v1/works/${work.id}`, { method: 'DELETE' });
      router.push('/workspace');
    });
  }

  return (
    <WorkShell active="work-settings" user={state.user} work={work} workId={work.id}>
      <main className="workspace-shell work-settings-shell">
        <div className="work-settings-back">
          <Link className="text-button" href={`/workspace/${work.id}/overview`}>
            返回作品总览
          </Link>
        </div>

        <section className="settings-hero">
          <div>
            <p className="workspace-step">作品边界</p>
            <h1>作品设置</h1>
          </div>
          <p>书名、读者、更新节奏和不能碰的边界会影响后续生成；模型配置仍在账号级。</p>
        </section>

        <WorkProfilePanel
          onWorkChange={(updated) =>
            setState((current) =>
              current.status === 'ready' ? { ...current, work: updated } : current,
            )
          }
          work={work}
        />

        <section className="work-lifecycle-panel" aria-labelledby="work-lifecycle-title">
          <div className="works-section-heading">
            <div>
              <p className="workspace-step">作品操作</p>
              <h2 id="work-lifecycle-title">生命周期</h2>
            </div>
          </div>
          <div className="work-lifecycle-actions">
            {work.readOnly ? (
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => void setStatus('serializing')}
                type="button"
              >
                {busy === 'serializing' ? '正在恢复…' : '恢复连载'}
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => void setStatus('completed')}
                type="button"
              >
                {busy === 'completed' ? '正在处理…' : '标记完本'}
              </button>
            )}
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => void copyWork()}
              type="button"
            >
              {busy === 'copy' ? '正在复制…' : '复制作品'}
            </button>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => setConfirmAction('archive')}
              type="button"
            >
              归档
            </button>
            <button
              className="text-button danger-text"
              disabled={Boolean(busy)}
              onClick={() => setConfirmAction('trash')}
              type="button"
            >
              移入回收站
            </button>
          </div>

          {confirmAction === 'archive' ? (
            <div className="work-confirm-bar" role="alert">
              <p>确认归档这部作品？归档后会从进行中的书架移走。</p>
              <div>
                <button
                  className="danger-button"
                  disabled={busy === 'archive'}
                  onClick={() => void archiveWork()}
                  type="button"
                >
                  {busy === 'archive' ? '正在归档…' : '确认归档'}
                </button>
                <button
                  className="text-button"
                  onClick={() => setConfirmAction(null)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {confirmAction === 'trash' ? (
            <div className="work-confirm-bar" role="alert">
              <p>确认把这部作品移入回收站？30 天内可以恢复。</p>
              <div>
                <button
                  className="danger-button"
                  disabled={busy === 'trash'}
                  onClick={() => void trashWork()}
                  type="button"
                >
                  {busy === 'trash' ? '正在移入…' : '确认移入回收站'}
                </button>
                <button
                  className="text-button"
                  onClick={() => setConfirmAction(null)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {notice ? (
            <p className="form-message form-message-success" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="form-message form-message-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </main>
    </WorkShell>
  );
}
