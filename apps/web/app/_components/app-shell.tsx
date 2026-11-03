'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, type User } from '../../lib/auth-api';
import { loadChanges } from '../../lib/changes-api';
import type { Work, WorkListResponse } from '../../lib/works-api';
import { GlobalSearchPanel } from './global-search-panel';
import { NotificationCenter } from './notification-center';

type ShellUser = Pick<User, 'displayName' | 'email'>;
type ShellWork = Pick<
  Work,
  | 'id'
  | 'title'
  | 'completedChapters'
  | 'totalChapters'
  | 'progressPercent'
  | 'unresolvedForeshadowCount'
  | 'mainBranch'
>;

type AccountNavKey = 'dashboard' | 'settings' | 'help';

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
  icon: SidebarIconName;
}> = [
  {
    key: 'overview',
    label: '作品总览',
    path: (workId) => `/workspace/${workId}/overview`,
    icon: 'book-open',
  },
  {
    key: 'bible',
    label: '故事圣经',
    path: (workId) => `/workspace/${workId}/bible`,
    icon: 'book-marked',
  },
  {
    key: 'settings',
    label: '设定中心',
    path: (workId) => `/workspace/${workId}/settings`,
    icon: 'network',
  },
  {
    key: 'outline',
    label: '大纲工作台',
    path: (workId) => `/workspace/${workId}/outline`,
    icon: 'list-tree',
  },
  {
    key: 'foreshadows',
    label: '伏笔账本',
    path: (workId) => `/workspace/${workId}/foreshadows`,
    icon: 'git-commit',
  },
  {
    key: 'writing',
    label: '写作台',
    path: (workId) => `/workspace/${workId}/write`,
    icon: 'pen',
  },
  {
    key: 'batch',
    label: '批量生产',
    path: (workId) => `/workspace/${workId}/batch`,
    icon: 'layers',
  },
  {
    key: 'changes',
    label: '修改与版本',
    path: (workId) => `/workspace/${workId}/changes`,
    icon: 'git-branch',
  },
  {
    key: 'export',
    label: '导出与发布',
    path: (workId) => `/workspace/${workId}/export`,
    icon: 'send',
  },
];

const CREATION_NAV_KEYS: WorkNavKey[] = [
  'overview',
  'bible',
  'settings',
  'outline',
  'foreshadows',
  'writing',
];

const PRODUCTION_NAV_KEYS: WorkNavKey[] = ['batch', 'changes', 'export'];

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
        <small>NovelBrain</small>
      </span>
      <span className="app-beta-badge">BETA</span>
    </Link>
  );
}

type SidebarIconName =
  | 'dashboard'
  | 'book-open'
  | 'book-marked'
  | 'network'
  | 'list-tree'
  | 'git-commit'
  | 'pen'
  | 'layers'
  | 'git-branch'
  | 'send'
  | 'help'
  | 'settings'
  | 'logout'
  | 'chevrons-left';

function SidebarIcon({ name }: { name: SidebarIconName }) {
  if (name === 'dashboard') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <rect
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.7"
          width="7"
          x="3.5"
          y="3.5"
        />
        <rect
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.7"
          width="7"
          x="13.5"
          y="3.5"
        />
        <rect
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.7"
          width="7"
          x="3.5"
          y="13.5"
        />
        <rect
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.7"
          width="7"
          x="13.5"
          y="13.5"
        />
      </svg>
    );
  }
  if (name === 'book-open') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 6.4C10.5 4.7 8.2 4 4.5 4v14.2c3.7 0 6 .7 7.5 2.4 1.5-1.7 3.8-2.4 7.5-2.4V4c-3.7 0-6 .7-7.5 2.4Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path d="M12 6.4v14.2" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === 'book-marked') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="M4.5 4.5A1.5 1.5 0 0 1 6 3h12a1.5 1.5 0 0 1 1.5 1.5V21l-7.5-4.3L4.5 21V4.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="M8 3v8l4-2.4L16 11V3"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (name === 'network') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="5" cy="18" r="2.3" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="19" cy="18" r="2.3" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M10.8 7 6.2 15.8M13.2 7l4.6 8.8M7.3 18h9.4"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (name === 'list-tree') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="M6 4v16M6 8h4.5M6 14h4.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <rect
          height="3.5"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.7"
          width="9.5"
          x="10.5"
          y="6.2"
        />
        <rect
          height="3.5"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.7"
          width="9.5"
          x="10.5"
          y="12.2"
        />
      </svg>
    );
  }
  if (name === 'git-commit') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M3 12h5.8M15.2 12H21"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (name === 'pen') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="m15.2 5.2 3.6 3.6M4.5 19.5l1-4.6L16 4.4a1.4 1.4 0 0 1 2 0l1.6 1.6a1.4 1.4 0 0 1 0 2L9.1 18.5l-4.6 1Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path d="M13 21h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === 'layers') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="m12 3 9 4.8-9 4.8-9-4.8L12 3Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="m3 12 9 4.8 9-4.8M3 16.2l9 4.8 9-4.8"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (name === 'git-branch') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="6" cy="19" r="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="18" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M6 7v10M8 8.5c4 0 4 3 8 3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === 'send') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="m21 3-7.2 18-3.4-7.4L3 10.2 21 3Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="m10.4 13.6 4.4-4.4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (name === 'help') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M9.6 9.2a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.3"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <path d="M12 17.3h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      </svg>
    );
  }
  if (name === 'settings') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M19.2 13.5a7.8 7.8 0 0 0 0-3l1.5-1.2-1.8-3.1-1.8.7a8 8 0 0 0-2.6-1.5L14.2 3h-3.6l-.3 2.4a8 8 0 0 0-2.6 1.5l-1.8-.7-1.8 3.1 1.5 1.2a7.8 7.8 0 0 0 0 3l-1.5 1.2 1.8 3.1 1.8-.7a8 8 0 0 0 2.6 1.5l.3 2.4h3.6l.3-2.4a8 8 0 0 0 2.6-1.5l1.8.7 1.8-3.1-1.5-1.2Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      </svg>
    );
  }
  if (name === 'logout') {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M14 8l4 4-4 4M9 12h9"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="m13 6-6 6 6 6M19 6l-6 6 6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ShellContextCard({
  avatar,
  title,
  subtitle,
  href,
  linkLabel,
  chevron,
}: {
  avatar: string;
  title: string;
  subtitle: string;
  href?: string;
  linkLabel?: string;
  chevron?: boolean;
}) {
  const content = (
    <>
      <span className="app-context-avatar">{avatar}</span>
      <span className="app-context-copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      {chevron ? (
        <span className="app-context-chevron">
          <SidebarIcon name="chevrons-left" />
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link
        aria-label={linkLabel}
        className="app-context-card app-context-work"
        href={href}
        title={linkLabel}
      >
        {content}
      </Link>
    );
  }

  return <div className="app-context-card">{content}</div>;
}

function ShellNavItem({
  active,
  badge,
  href,
  icon,
  label,
}: {
  active: boolean;
  badge?: { kind: 'count' | 'alert' | 'dot'; value?: number };
  href: string;
  icon: SidebarIconName;
  label: string;
}) {
  return (
    <Link aria-current={active ? 'page' : undefined} className="app-nav-item" href={href}>
      <span className="app-nav-icon">
        <SidebarIcon name={icon} />
      </span>
      <span className="app-nav-text">{label}</span>
      {badge?.kind === 'dot' ? <span aria-hidden="true" className="app-nav-dot" /> : null}
      {badge && badge.kind !== 'dot' && (badge.value ?? 0) > 0 ? (
        <span aria-hidden="true" className={`app-nav-badge app-nav-badge-${badge.kind}`}>
          {badge.value}
        </span>
      ) : null}
    </Link>
  );
}

function ShellSidebarBottom({
  helpActive,
  onLogout,
  settingsActive,
  user,
}: {
  helpActive: boolean;
  onLogout: () => void;
  settingsActive: boolean;
  user: ShellUser;
}) {
  return (
    <div className="app-sidebar-bottom">
      <ShellNavItem active={helpActive} href="/help" icon="help" label="帮助" />
      <ShellNavItem
        active={settingsActive}
        href="/workspace/settings"
        icon="settings"
        label="设置"
      />
      <div className="app-user-card">
        <span className="app-user-avatar">{user.displayName.trim().slice(0, 1) || '作'}</span>
        <span className="app-user-copy">
          <strong>{user.displayName}</strong>
          <small>个人作者</small>
        </span>
        <button
          aria-label="退出登录"
          className="app-user-logout"
          onClick={onLogout}
          title="退出登录"
          type="button"
        >
          <SidebarIcon name="logout" />
        </button>
      </div>
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
  const [unreadNotifications, setUnreadNotifications] = useState(0);
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
            <Link className="app-new-work" href="/workspace/new-project">
              新建作品
            </Link>
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
              {unreadNotifications > 0 ? (
                <span
                  className="app-notification-badge"
                  aria-label={`${unreadNotifications} 条未读通知`}
                >
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              ) : null}
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

        {searchOpen ? <GlobalSearchPanel onClose={closePanels} /> : null}

        {notificationsOpen ? (
          <NotificationCenter onClose={closePanels} onUnreadChange={setUnreadNotifications} />
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
            <Link href="/help" onClick={closePanels} role="menuitem">
              帮助与快捷键
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
  breadcrumbLabel,
  children,
}: {
  user: ShellUser;
  active: AccountNavKey;
  breadcrumbLabel?: string;
  children: ReactNode;
}) {
  const logout = useShellLogout();
  const [workCount, setWorkCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<WorkListResponse>('/api/v1/works')
      .then((response) => {
        if (mounted) {
          setWorkCount(response.items.length);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const accountSubtitle =
    workCount === null ? user.displayName : `${user.displayName} · ${workCount} 部作品`;

  return (
    <ShellFrame
      crumbs={
        active === 'settings' && !breadcrumbLabel
          ? [{ label: '工作台', href: '/workspace' }, { label: '设置' }]
          : breadcrumbLabel
            ? [{ label: '工作台', href: '/workspace' }, { label: breadcrumbLabel }]
            : [{ label: '工作台' }]
      }
      mode="account"
      onLogout={logout}
      sidebar={
        <>
          <ShellBrand />
          <ShellContextCard
            avatar={user.displayName.trim().slice(0, 1) || '作'}
            subtitle={accountSubtitle}
            title="个人作者"
          />
          <nav aria-label="账号导航" className="app-nav">
            <div className="app-nav-label">创作</div>
            <ShellNavItem
              active={active === 'dashboard'}
              href="/workspace"
              icon="dashboard"
              label="工作台"
            />
          </nav>
          <ShellSidebarBottom
            helpActive={active === 'help'}
            onLogout={() => void logout()}
            settingsActive={active === 'settings'}
            user={user}
          />
        </>
      }
      user={user}
    >
      {children}
    </ShellFrame>
  );
}

type AccountPageState =
  { status: 'loading' } | { status: 'ready'; user: User } | { status: 'error' };

export function AccountPageShell({
  active,
  breadcrumbLabel,
  children,
}: {
  active: AccountNavKey;
  breadcrumbLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<AccountPageState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;
    apiRequest<User>('/api/v1/auth/me')
      .then((user) => {
        if (mounted) {
          setState({ status: 'ready', user });
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
        setState({ status: 'error' });
      });

    return () => {
      mounted = false;
    };
  }, [router]);

  if (state.status === 'loading') {
    return <main className="app-shell-loading">正在打开页面…</main>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-shell-error">
        <section>
          <h1>暂时无法打开页面</h1>
          <p>请稍后刷新重试。</p>
          <Link className="secondary-button" href="/workspace">
            返回工作台
          </Link>
        </section>
      </main>
    );
  }

  return (
    <AccountShell active={active} breadcrumbLabel={breadcrumbLabel} user={state.user}>
      {children}
    </AccountShell>
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
  const [changeCount, setChangeCount] = useState(0);

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

  useEffect(() => {
    if (state.status !== 'ready' || !state.work.mainBranch) {
      setChangeCount(0);
      return;
    }

    let mounted = true;
    loadChanges(state.work.id, state.work.mainBranch.id)
      .then((response) => {
        if (!mounted) {
          return;
        }
        const activeCount = response.items.filter((item) =>
          ['draft', 'analyzing', 'waiting_confirmation', 'applying'].includes(item.status),
        ).length;
        setChangeCount(activeCount);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [state]);

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
        { label: state.work.title, href: `/workspace/${workId}/overview` },
        { label: activeLabel },
      ]}
      mode="work"
      onLogout={logout}
      sidebar={
        <>
          <ShellBrand />
          <ShellContextCard
            avatar={state.work.title.trim().slice(0, 1) || '书'}
            chevron
            href="/workspace"
            linkLabel="返回我的作品"
            subtitle={
              state.work.totalChapters > 0
                ? `已写 ${state.work.completedChapters} 章 / 共 ${state.work.totalChapters} 章`
                : `已写 ${state.work.completedChapters} 章`
            }
            title={state.work.title}
          />
          <nav aria-label="作品导航" className="app-nav">
            <div className="app-nav-label">创作</div>
            {WORK_NAV.filter((item) => CREATION_NAV_KEYS.includes(item.key)).map((item) => (
              <ShellNavItem
                active={active === item.key}
                badge={
                  item.key === 'bible'
                    ? { kind: 'dot' }
                    : item.key === 'foreshadows'
                      ? { kind: 'alert', value: state.work.unresolvedForeshadowCount }
                      : item.key === 'writing'
                        ? { kind: 'count', value: state.work.completedChapters }
                        : undefined
                }
                href={item.path(workId)}
                icon={item.icon}
                key={item.key}
                label={item.label}
              />
            ))}
            <div className="app-nav-label app-nav-label-spaced">生产</div>
            {WORK_NAV.filter((item) => PRODUCTION_NAV_KEYS.includes(item.key)).map((item) => (
              <ShellNavItem
                active={active === item.key}
                badge={item.key === 'changes' ? { kind: 'alert', value: changeCount } : undefined}
                href={item.path(workId)}
                icon={item.icon}
                key={item.key}
                label={item.label}
              />
            ))}
          </nav>
          <ShellSidebarBottom
            helpActive={false}
            onLogout={() => void logout()}
            settingsActive={active === 'settings' || active === 'work-settings'}
            user={state.user}
          />
        </>
      }
      user={state.user}
    >
      {children}
    </ShellFrame>
  );
}
