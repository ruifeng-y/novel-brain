'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../lib/auth-api';

type LoadState =
  { status: 'loading' } | { status: 'ready'; user: User } | { status: 'error'; message: string };

export function WorkspaceHome() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [leaving, setLeaving] = useState<'current' | 'all'>();

  useEffect(() => {
    apiRequest<User>('/api/v1/auth/me')
      .then((user) => setState({ status: 'ready', user }))
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

      <section className="workspace-welcome">
        <p>你的写作空间</p>
        <h1>准备好写下第一章了吗？</h1>
        <p className="workspace-email">{state.user.email}</p>
      </section>

      <section className="workspace-empty">
        <div>
          <p className="workspace-step">第一步</p>
          <h2>从一句想法开始</h2>
          <p>作品创建、故事圣经和大纲会在这里出现。当前账号已经可以安全登录和退出。</p>
        </div>
        <div className="workspace-session">
          <p>登录状态正常</p>
          <button
            className="secondary-button"
            disabled={Boolean(leaving)}
            onClick={() => signOut(true)}
            type="button"
          >
            {leaving === 'all' ? '正在退出…' : '退出所有设备'}
          </button>
        </div>
      </section>
    </main>
  );
}
