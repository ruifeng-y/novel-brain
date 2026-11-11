"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type AuthTab = "login" | "register" | "forgot";

const tabs: Array<{ key: AuthTab; href: string; label: string }> = [
  { key: "login", href: "/login", label: "登录" },
  { key: "register", href: "/register", label: "注册" },
  { key: "forgot", href: "/forgot-password", label: "找回密码" },
];

export function AuthShell({
  activeTab,
  children,
}: {
  activeTab: AuthTab | "reset";
  children: ReactNode;
}) {
  const selectedTab = activeTab === "reset" ? "forgot" : activeTab;
  const visibleTabs = selectedTab === "forgot" ? tabs : tabs.filter((tab) => tab.key !== "forgot");

  return (
    <main className="auth-shell">
      <aside className="auth-brand-panel">
        <Link className="brand auth-brand" href="/health">
          <span className="brand-mark" aria-hidden="true">
            墨
          </span>
          <span className="brand-copy">
            <strong>墨舟</strong>
            <span>NovelBrain</span>
          </span>
        </Link>

        <div className="auth-brand-copy">
          <p className="eyebrow">写给认真写长篇的人</p>
          <h1>把故事写到最后一行，也让它始终站得住。</h1>
          <p>从一句想法开始，照看人物的选择、世界的规则和每一次伏笔。</p>
        </div>

        <div className="auth-points">
          <span>
            <Check size={14} aria-hidden="true" />
            故事圣经与设定中心
          </span>
          <span>
            <Check size={14} aria-hidden="true" />
            五层大纲与写作台
          </span>
          <span>
            <Check size={14} aria-hidden="true" />
            连续性、事实与版本
          </span>
        </div>
      </aside>

      <section className="auth-main">
        <div className="auth-card panel">
          <div className="auth-top">
            <span className="panel-kicker">账号入口</span>
            <Link className="text-link" href="/health">
              服务状态
            </Link>
          </div>

          <div
            className={`auth-tabs${visibleTabs.length === 3 ? " auth-tabs-recovery" : ""}`}
            role="tablist"
            aria-label="账号入口"
          >
            {visibleTabs.map((tab) => (
              <Link
                className={`auth-tab${selectedTab === tab.key ? " active" : ""}`}
                href={tab.href}
                key={tab.key}
                role="tab"
                aria-selected={selectedTab === tab.key}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}
