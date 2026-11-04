"use client";

import {
  Activity,
  BookOpen,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Settings,
} from "lucide-react";
import type { AuthUser } from "@novel-brain/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { clearCsrfCache, getCsrfToken } from "../lib/csrf-client";

const navigation = [
  { href: "/workspace", label: "工作台", icon: LayoutDashboard },
  { href: "/health", label: "服务状态", icon: Activity },
];

export function AppShell({
  children,
  user,
}: Readonly<{ children: React.ReactNode; user?: AuthUser }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const current = pathname.startsWith("/workspace") ? "工作台" : "服务状态";

  async function logout() {
    setLoggingOut(true);
    try {
      const csrfToken = await getCsrfToken();
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
    } finally {
      clearCsrfCache();
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            墨
          </div>
          <div className="brand-copy">
            <strong>墨舟</strong>
            <span>NovelBrain</span>
          </div>
          <span className="beta-badge">BETA</span>
        </div>

        <div className="workspace-switch" aria-label="当前工作区">
          <span className="workspace-avatar">墨</span>
          <span className="workspace-copy">
            <strong>个人工作区</strong>
            <small>长篇创作</small>
          </span>
          <ChevronDown className="workspace-chevron" size={15} aria-hidden="true" />
        </div>

        <nav className="main-nav" aria-label="主导航">
          <p className="nav-label">创作</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/workspace"
                ? pathname.startsWith("/workspace")
                : pathname === "/health";

            return (
              <Link
                className={`nav-item${active ? " active" : ""}`}
                href={item.href}
                key={item.href}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="nav-item quiet" aria-disabled="true">
            <CircleHelp size={18} aria-hidden="true" />
            <span>帮助</span>
          </div>
          <Link className="nav-item quiet" href="/workspace/settings/account">
            <Settings size={18} aria-hidden="true" />
            <span>设置</span>
          </Link>
          <div className="user-card">
            <span className="avatar" aria-hidden="true">
              {user?.displayName.slice(0, 1) ?? "作"}
            </span>
            <span className="user-copy">
              <strong>{user?.displayName ?? "个人作者"}</strong>
              <small>{user?.emailMasked ?? "长篇创作"}</small>
            </span>
            {user ? (
              <button
                aria-label="退出登录"
                className="icon-btn small user-logout"
                disabled={loggingOut}
                onClick={logout}
                title="退出登录"
                type="button"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            ) : (
              <BookOpen size={16} aria-hidden="true" />
            )}
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="crumbs" aria-label="面包屑">
            <span>墨舟</span>
            <span aria-hidden="true">/</span>
            <strong>{current}</strong>
          </div>
          <div className="topbar-note">NovelBrain</div>
        </header>

        <main className="page-container">{children}</main>
      </div>
    </div>
  );
}
