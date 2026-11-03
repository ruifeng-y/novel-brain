'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, type User } from '../../lib/auth-api';
import type { Work } from '../../lib/works-api';

type ShellUser = Pick<User, 'displayName' | 'email'>;
type ShellWork = Pick<Work, 'id' | 'title'>;

type AccountNavKey = 'dashboard' | 'settings';

export type WorkNavKey =
  | 'overview'
  | 'bible'
  | 'settings'
  | 'outline'
  | 'foreshadows'
  | 'writing'
  | 'batch'
  | 'changes'
  | 'export'
  | 'work-settings';

type Crumb = {
  label: string;
  href?: string;
};

const WORK_NAV: Array<{
  key: WorkNavKey;
  label: string;
  path: (workId: string) => string;
}> = [
  { key: 'overview', label: '作品总览', path: (workId) => `/workspace/${workId}/overview` },
  { key: 'bible', label: '故事圣经', path: (workId) => `/workspace/${workId}/bible` },
  { key: 'settings', label: '设定中心', path: (workId) => `/workspace/${workId}/settings` },
  { key: 'outline', label: '大纲工作台', path: (workId) => `/workspace/${workId}/outline` },
  {
    key: 'foreshadows',
    label: '伏笔账本',
    path: (workId) => `/workspace/${workId}/foreshadows`,
  },
  { key: 'writing', label: '写作台', path: (workId) => `/workspace/${workId}/write` },
  { key: 'batch', label: '批量生产', path: (workId) => `/workspace/${workId}/batch` },
  { key: 'changes', label: '修改与版本', path: (workId) => `/workspace/${workId}/changes` },
  { key: 'export', label: '导出与发布', path: (workId) => `/workspace/${workId}/export` },
];

const WORK_PAGE_LABELS: Record<WorkNavKey, string> = {
  overview: '作品总览',
  bible: '故事圣经',
  settings: '设定中心',
  outline: '大纲工作台',
  foreshadows: '伏笔账本',
  writing: '写作台',
  batch: '批量生产',
  changes: '修改与版本',
  export: '导出与发布',
  'work-settings': '作品设置',
};

function NavIcon({ name }: { name: 'menu' | 'close' | 'search' | 'bell' | 'chevron' }) {
  if (name === 'menu') {
    return (
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
        <path
          d="M4 7h16M4 12h16M4 17h16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  if (name === 'close') {
    return (
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  if (name === 'search') {
    return (
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M16 16l4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === 'bell') {
    return (
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
        <path
          d="M6.5 9.5a5.5 5.5 0 0 1 11 0v3.7l1.5 2.3H5l1.5-2.3V9.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M10 19a2 2 0 0 0 4 0"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ShellBrand() {
  return (
    <Link className="app-brand" href="/workspace">
      <span className="app-brand-mark">墨</span>
      <span className="app-brand-copy">
        <strong>墨舟</strong>
        <small>NOVELBRAIN BETA</small>
      </span>
    </Link>
  );
}

function ShellShortcuts({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="app-sidebar-shortcuts">
      <Link href="/workspace">作品书架</Link>
      <Link href="/workspace/settings">模型设置</Link>
      <Link href="/workspace/settings/account">账号设置</Link>
      <button onClick={onLogout} type="button">
        退出登录
      </button>
    </div>
  );
}

function ShellSidebarFooter({ user }: { user: ShellUser }) {
  return (
    <div className="app-sidebar-footer">
      <strong>{user.displayName}</strong>
      <small>个人作者</small>
    </div>
  );
}

function useShellLogout() {
  const router = useRouter();

  return async () => {
    await apiRequest<void>('/api/v1/auth/logout', { method: 'POST' });
    router.replace('/login');
  };
}

function ShellFrame({
  mode,
  sidebar,
  crumbs,
  user,
  onLogout,
  children,
}: {
  mode: 'account' | 'work';
  sidebar: ReactNode;
  crumbs: Crumb[];
  user: ShellUser;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
    setSearchOpen(false);
    setNotificationsOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  function closePanels() {
    setSearchOpen(false);
    setNotificationsOpen(false);
    setUserMenuOpen(false);
  }

  return (
    <div
      className="app-shell"
      data-mode={mode}
      data-sidebar-collapsed={sidebarCollapsed}
      data-sidebar-open={sidebarOpen}
    >
      {sidebarOpen ? (
        <button
          aria-label="关闭导航"
          className="app-sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <aside className="app-sidebar">
        <div className="app-sidebar-inner">{sidebar}</div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <button
              aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
              className="app-icon-button app-collapse-button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              type="button"
            >
              <NavIcon name="menu" />
            </button>
            <button
              aria-label="打开导航"
              className="app-icon-button app-menu-button"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <NavIcon name="menu" />
            </button>

            <nav aria-label="面包屑" className="app-breadcrumbs">
              {crumbs.map((crumb, index) => (
                <span className="app-crumb" key={`${crumb.label}-${index}`}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="app-crumb-sep">
                      /
                    </span>
                  ) : null}
                  {crumb.href ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current="page">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </div>

          <div className="app-topbar-actions">
            <button
              aria-expanded={searchOpen}
              aria-label="全局搜索"
              className="app-icon-button"
              onClick={() => {
                setUserMenuOpen(false);
                setNotificationsOpen(false);
                setSearchOpen((current) => !current);
              }}
              type="button"
            >
              <NavIcon name="search" />
            </button>
            <button
              aria-expanded={notificationsOpen}
              aria-label="通知"
              className="app-icon-button"
              onClick={() => {
                setUserMenuOpen(false);
                setSearchOpen(false);
                setNotificationsOpen((current) => !current);
              }}
              type="button"
            >
              <NavIcon name="bell" />
            </button>
            <button
              aria-expanded={userMenuOpen}
              aria-label="账号菜单"
              className="app-icon-button app-user-button"
              onClick={() => {
                setSearchOpen(false);
                setNotificationsOpen(false);
                setUserMenuOpen((current) => !current);
              }}
              type="button"
            >
              {user.displayName.trim().slice(0, 1) || '作'}
            </button>
          </div>
        </header>

        {searchOpen ? (
          <section aria-label="全局搜索" className="app-popover app-search-panel" role="dialog">
            <label className="app-search-field">
              <span>全局搜索</span>
              <input autoFocus placeholder="搜索作品、设定、人物、大纲或章节" type="search" />
            </label>
            <p className="app-popover-empty">输入关键词开始搜索。搜索结果会在内容页接入后显示。</p>
          </section>
        ) : null}

        {notificationsOpen ? (
          <section aria-label="通知中心" className="app-popover" role="dialog">
            <p className="app-popover-kicker">通知中心</p>
            <h2>暂无新通知</h2>
            <p className="app-popover-empty">任务完成、待审核和连续性问题会出现在这里。</p>
          </section>
        ) : null}

        {userMenuOpen ? (
          <div aria-label="账号菜单" className="app-popover app-user-popover" role="menu">
            <div className="app-user-summary">
              <strong>{user.displayName}</strong>
              <small>{user.email}</small>
            </div>
            <Link href="/workspace/settings" onClick={closePanels} role="menuitem">
              账号与模型
            </Link>
            <Link href="/workspace/settings/account" onClick={closePanels} role="menuitem">
              账号设置
            </Link>
            <Link href="/workspace/settings/privacy" onClick={closePanels} role="menuitem">
              隐私与数据
            </Link>
            <button
              onClick={() => {
                closePanels();
                void onLogout();
              }}
              role="menuitem"
              type="button"
            >
              退出登录
            </button>
          </div>
        ) : null}

        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

export function AccountShell({
  user,
  active,
  children,
}: {
  user: ShellUser;
  active: AccountNavKey;
  children: ReactNode;
}) {
  const logout = useShellLogout();

  return (
    <ShellFrame
      crumbs={
        active === 'settings'
          ? [{ label: '工作台', href: '/workspace' }, { label: '设置' }]
          : [{ label: '工作台' }]
      }
      mode="account"
      onLogout={logout}
      sidebar={
        <>
          <ShellBrand />

          <nav aria-label="账号导航" className="app-nav">
            <Link aria-current={active === 'dashboard' ? 'page' : undefined} href="/workspace">
              工作台
            </Link>
            <Link
              aria-current={active === 'settings' ? 'page' : undefined}
              href="/workspace/settings"
            >
              设置
            </Link>
          </nav>

          <ShellShortcuts onLogout={() => void logout()} />
          <ShellSidebarFooter user={user} />
        </>
      }
      user={user}
    >
      {children}
    </ShellFrame>
  );
}

type WorkShellState =
  | { status: 'loading' }
  | { status: 'ready'; user: ShellUser; work: ShellWork }
  | { status: 'error'; message: string };

export function WorkShell({
  workId,
  active,
  user,
  work,
  children,
}: {
  workId: string;
  active: WorkNavKey;
  user?: ShellUser;
  work?: ShellWork;
  children: ReactNode;
}) {
  const router = useRouter();
  const logout = useShellLogout();
  const [state, setState] = useState<WorkShellState>(() =>
    user && work ? { status: 'ready', user, work } : { status: 'loading' },
  );

  useEffect(() => {
    if (user && work) {
      setState({ status: 'ready', user, work });
      return;
    }

    let mounted = true;
    setState({ status: 'loading' });
    Promise.all([apiRequest<User>('/api/v1/auth/me'), apiRequest<Work>(`/api/v1/works/${workId}`)])
      .then(([loadedUser, loadedWork]) => {
        if (mounted) {
          setState({ status: 'ready', user: loadedUser, work: loadedWork });
        }
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({ status: 'error', message: '暂时无法打开这部作品。' });
      });

    return () => {
      mounted = false;
    };
  }, [router, user, work, workId]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开作品…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开作品</h1>
          <p>{state.message}</p>
          <Link className="secondary-button" href="/workspace">
            返回作品列表
          </Link>
        </section>
      </main>
    );
  }

  const activeLabel = WORK_PAGE_LABELS[active];

  return (
    <ShellFrame
      crumbs={[
        { label: '我的作品', href: '/workspace' },
        { label: state.work.title, href: `/workspace/${workId}` },
        { label: activeLabel },
      ]}
      mode="work"
      onLogout={logout}
      sidebar={
        <>
          <ShellBrand />

          <div className="app-work-context">
            <span>当前作品</span>
            <strong>{state.work.title}</strong>
          </div>

          <nav aria-label="作品导航" className="app-nav">
            {WORK_NAV.map((item) => (
              <Link
                aria-current={active === item.key ? 'page' : undefined}
                href={item.path(workId)}
                key={item.key}
              >
                {item.label}
              </Link>
            ))}
            <Link aria-label="返回作品列表" className="app-nav-back" href="/workspace">
              返回工作台
            </Link>
          </nav>

          <ShellShortcuts onLogout={() => void logout()} />
          <ShellSidebarFooter user={state.user} />
        </>
      }
      user={state.user}
    >
      {children}
    </ShellFrame>
  );
}
