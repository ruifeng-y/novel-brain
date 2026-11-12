"use client";

import {
  Bell,
  CheckCheck,
  CircleAlert,
  GitBranch,
  Layers3,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  notificationListResponseSchema,
  notificationReadAllResponseSchema,
  notificationReadResponseSchema,
  type Notification,
} from "@novel-brain/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { getCsrfToken } from "../lib/csrf-client";

interface NotificationState {
  items: Notification[];
  unreadCount: number;
}

interface NotificationPresentation {
  icon: LucideIcon;
  label: string;
  tone: "alert" | "gold" | "jade";
}

const notificationPresentations: Record<Notification["type"], NotificationPresentation> = {
  job_completed: { icon: Layers3, label: "任务完成", tone: "jade" },
  job_failed: { icon: CircleAlert, label: "任务失败", tone: "alert" },
  review_required: { icon: Layers3, label: "等待审核", tone: "gold" },
  merge_completed: { icon: GitBranch, label: "合并完成", tone: "jade" },
  merge_conflict: { icon: GitBranch, label: "合并冲突", tone: "alert" },
};

export function NotificationCenter({ enabled }: Readonly<{ enabled: boolean }>) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState<NotificationState>({ items: [], unreadCount: 0 });

  const loadNotifications = useCallback(async () => {
    if (!enabled) {
      setState({ items: [], unreadCount: 0 });
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/notifications?limit=8", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("通知加载失败。");
      }
      const page = notificationListResponseSchema.parse(await response.json());
      setState({ items: page.data, unreadCount: page.meta.unreadCount });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "通知加载失败。");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const closeDrawer = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) {
        return;
      }
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDrawer, open]);

  async function markNotificationRead(notificationId: string): Promise<boolean> {
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/notifications/${notificationId}/read`, {
        method: "PATCH",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        throw new Error("标记已读失败，请重试。");
      }
      const updated = notificationReadResponseSchema.parse(await response.json()).data;
      setState((current) => {
        const previous = current.items.find((notification) => notification.id === updated.id);
        const wasUnread = previous?.readAt === null;
        const items = current.items.map((notification) =>
          notification.id === updated.id ? updated : notification,
        );
        return {
          items,
          unreadCount: wasUnread ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
        };
      });
      return true;
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "标记已读失败，请重试。");
      return false;
    }
  }

  async function openNotification(notification: Notification) {
    if (!notification.readAt) {
      await markNotificationRead(notification.id);
    }
    closeDrawer(false);
    router.push(notification.payload.href);
  }

  async function markAllNotificationsRead() {
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/v1/notifications/read-all", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        throw new Error("全部已读失败，请重试。");
      }
      notificationReadAllResponseSchema.parse(await response.json());
      setState((current) => ({
        items: current.items.map((notification) => ({
          ...notification,
          readAt: notification.readAt ?? new Date().toISOString(),
        })),
        unreadCount: 0,
      }));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "全部已读失败，请重试。");
    }
  }

  return (
    <div className="notification-shell">
      <button
        aria-controls="notification-drawer"
        aria-expanded={open}
        aria-label={state.unreadCount > 0 ? `通知，${state.unreadCount} 条未读` : "通知"}
        className="icon-btn small notification-trigger"
        onClick={() => {
          if (open) {
            closeDrawer();
            return;
          }
          setOpen(true);
          void loadNotifications();
        }}
        ref={triggerRef}
        title="通知"
        type="button"
      >
        <Bell size={17} aria-hidden="true" />
        {state.unreadCount > 0 ? <span className="notification-badge" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <aside
          aria-labelledby="notification-drawer-title"
          className="notification-drawer open"
          id="notification-drawer"
          ref={drawerRef}
          role="dialog"
        >
          <div className="notification-head">
            <div>
              <span className="panel-kicker">通知</span>
              <h2 id="notification-drawer-title">
                {state.unreadCount > 0 ? `${state.unreadCount} 条待处理` : "没有未读通知"}
              </h2>
            </div>
            <button
              aria-label="关闭通知"
              className="icon-btn small"
              onClick={() => closeDrawer()}
              ref={closeRef}
              title="关闭通知"
              type="button"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {loading ? (
            <div className="notification-state">正在加载通知</div>
          ) : error ? (
            <div className="notification-state error" role="alert">
              <span>{error}</span>
              <button className="text-btn small" onClick={() => void loadNotifications()}>
                重试
              </button>
            </div>
          ) : state.items.length === 0 ? (
            <div className="notification-state">暂无通知</div>
          ) : (
            <div className="notification-list">
              {state.items.map((notification) => {
                const presentation = notificationPresentations[notification.type];
                const Icon = presentation.icon;
                return (
                  <button
                    className={`notification-item${notification.readAt ? " read" : " unread"}`}
                    key={notification.id}
                    onClick={() => void openNotification(notification)}
                    type="button"
                  >
                    <span className={`notification-icon ${presentation.tone}`} aria-hidden="true">
                      <Icon size={14} />
                    </span>
                    <div className="notification-item-copy">
                      <div className="notification-item-title">
                        <strong>{notification.payload.title}</strong>
                        {!notification.readAt ? (
                          <span className="notification-unread-dot" aria-label="未读" />
                        ) : null}
                      </div>
                      <small>
                        {presentation.label} · {formatNotificationTime(notification.createdAt)}
                      </small>
                      <p>{notification.payload.message}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="notification-foot">
            <span>V1 只有站内通知</span>
            {state.unreadCount > 0 ? (
              <button
                className="text-btn small"
                onClick={() => void markAllNotificationsRead()}
                type="button"
              >
                <CheckCheck size={14} aria-hidden="true" />
                全部已读
              </button>
            ) : (
              <span>全部已读</span>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function formatNotificationTime(createdAt: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}
