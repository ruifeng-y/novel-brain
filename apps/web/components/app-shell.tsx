"use client";

import {
  Activity,
  BookMarked,
  BookOpen,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  Layers3,
  ListTree,
  LogOut,
  Milestone,
  PenLine,
  Settings,
} from "lucide-react";
import { workResponseSchema, type AuthUser, type Work } from "@novel-brain/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearCsrfCache, getCsrfToken } from "../lib/csrf-client";
import { subscribeWorkContextRefresh } from "../lib/work-context-events";
import { branchLabel, isWorkReadonly, readonlyScopeLabel } from "../lib/work-presentation";

const navigation = [
  { href: "/workspace", label: "工作台", icon: LayoutDashboard },
  { href: "/health", label: "服务状态", icon: Activity },
];

const workNavigation = [
  { suffix: "overview", label: "作品总览", icon: BookOpen },
  { suffix: "bible", label: "故事圣经", icon: BookMarked },
  { suffix: "settings", label: "设定中心", icon: Settings },
  { suffix: "outline", label: "大纲工作台", icon: ListTree },
  { suffix: "foreshadows", label: "伏笔账本", icon: Milestone },
  { suffix: "write", label: "写作台", icon: PenLine },
  { suffix: "batch", label: "批量生产", icon: Layers3 },
];

interface ActiveWorkContext {
  title: string;
  branchName: string;
  branchStatus: "active" | "archived";
  workStatus: Work["status"];
}

export function AppShell({
  children,
  user,
}: Readonly<{ children: React.ReactNode; user?: AuthUser }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeWork, setActiveWork] = useState<ActiveWorkContext | null>(null);
  const workPathMatch = pathname.match(/^\/workspace\/([^/]+)\/([^/]+)/u);
  const workId = workPathMatch?.[1];
  const workSection = workPathMatch?.[2];
  const showWorkContext = workSection === "overview";
  const current = pathname.endsWith("/overview")
    ? "作品总览"
    : pathname.endsWith("/bible")
      ? "故事圣经"
      : pathname.endsWith("/settings") && pathname.startsWith("/workspace/")
        ? "设定中心"
        : pathname.endsWith("/outline")
          ? "大纲工作台"
          : pathname.endsWith("/foreshadows")
            ? "伏笔账本"
            : pathname.endsWith("/write")
              ? "写作台"
              : pathname.endsWith("/batch")
                ? "批量生产"
                : pathname === "/workspace/new-project"
                  ? "新建作品"
                  : pathname.startsWith("/workspace/settings")
                    ? "账号与模型"
                    : pathname.startsWith("/workspace")
                      ? "工作台"
                      : "服务状态";

  useEffect(() => {
    if (!workId || !showWorkContext) {
      setActiveWork(null);
      return;
    }
    let cancelled = false;
    setActiveWork(null);
    const loadActiveWork = () => {
      void fetch(`/api/v1/works/${workId}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }
          return workResponseSchema.parse(await response.json()).data;
        })
        .then((work) => {
          if (cancelled || !work) {
            return;
          }
          setActiveWork({
            title: work.title,
            branchName: branchLabel(work.mainBranch.name),
            branchStatus: work.mainBranch.status,
            workStatus: work.status,
          });
        })
        .catch(() => {
          if (!cancelled) {
            setActiveWork(null);
          }
        });
    };
    loadActiveWork();
    const unsubscribe = subscribeWorkContextRefresh(loadActiveWork);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [showWorkContext, workId]);

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
            <strong title={activeWork?.title}>{activeWork?.title ?? "个人工作区"}</strong>
            <small>
              {activeWork
                ? `创作线 ${activeWork.branchName} · ${activeWorkStateLabel(activeWork)}`
                : "长篇创作"}
            </small>
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
          {workId ? (
            <>
              <p className="nav-label">当前作品</p>
              {workNavigation.map((item) => {
                const Icon = item.icon;
                const active = workSection === item.suffix;
                if (item.suffix !== "overview" && activeWork && activeWorkIsReadonly(activeWork)) {
                  return (
                    <div
                      aria-disabled="true"
                      className="nav-item"
                      key={item.suffix}
                      title={readonlyScopeLabel(activeWork.workStatus, activeWork.branchStatus)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{item.label}</span>
                    </div>
                  );
                }
                return (
                  <Link
                    className={`nav-item${active ? " active" : ""}`}
                    href={`/workspace/${workId}/${item.suffix}`}
                    key={item.suffix}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </>
          ) : null}
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

        {showWorkContext && activeWork ? (
          <div className="work-context-bar" aria-label="当前作品与创作线">
            <strong>{activeWork.title}</strong>
            <span>
              创作线 {activeWork.branchName} · {activeWorkStateLabel(activeWork)}
            </span>
          </div>
        ) : null}

        <main className="page-container">{children}</main>
      </div>
    </div>
  );
}

function activeWorkStateLabel(activeWork: ActiveWorkContext): string {
  if (activeWork.workStatus === "archived") {
    return "作品已归档 · 只读";
  }
  if (activeWork.workStatus === "completed") {
    return "作品已完本 · 只读";
  }
  return activeWork.branchStatus === "active" ? "可写作" : "创作线已归档";
}

function activeWorkIsReadonly(activeWork: ActiveWorkContext): boolean {
  return isWorkReadonly(activeWork.workStatus, activeWork.branchStatus);
}
