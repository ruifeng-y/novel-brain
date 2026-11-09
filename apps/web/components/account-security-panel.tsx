"use client";

import {
  CheckCircle2,
  Laptop,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  authorPenNameDeleteResponseSchema,
  authorPenNameListResponseSchema,
  authorPenNameResponseSchema,
  authDeviceSessionsResponseSchema,
  profileResponseSchema,
  type AuthDeviceSession,
  type AuthUser,
  type AuthorPenName,
} from "@novel-brain/contracts";

import { clearCsrfCache, getCsrfToken } from "../lib/csrf-client";
import { fetchAllCursorPages } from "../lib/cursor-pagination";

export function AccountSecurityPanel({ initialUser }: { initialUser: AuthUser }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialUser);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [bio, setBio] = useState(initialUser.bio);
  const [avatarUrl, setAvatarUrl] = useState(initialUser.avatarUrl ?? "");
  const [penNames, setPenNames] = useState<AuthorPenName[]>([]);
  const [sessions, setSessions] = useState<AuthDeviceSession[]>([]);
  const [newPenName, setNewPenName] = useState("");
  const [newPenBio, setNewPenBio] = useState("");
  const [newPenDefault, setNewPenDefault] = useState(false);
  const [editing, setEditing] = useState<AuthorPenName | null>(null);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editDefault, setEditDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const handleAuthFailure = useCallback(
    (response: Response) => {
      if (response.status === 401) {
        router.replace("/login?reason=session-expired");
        router.refresh();
        return true;
      }
      if (response.status === 403) {
        router.replace("/login?reason=permission");
        router.refresh();
        return true;
      }
      return false;
    },
    [router],
  );

  const loadPenNames = useCallback(async () => {
    const data = await fetchAllCursorPages(
      "/api/v1/users/me/pen-names",
      authorPenNameListResponseSchema.parse,
      "笔名加载失败。",
      (response) => {
        if (handleAuthFailure(response)) {
          throw new Error("登录状态已变化。");
        }
      },
    );
    setPenNames(
      [...data].sort(
        (left, right) =>
          Number(right.isDefault) - Number(left.isDefault) ||
          right.createdAt.localeCompare(left.createdAt),
      ),
    );
  }, [handleAuthFailure]);

  const loadSessions = useCallback(async () => {
    const data = await fetchAllCursorPages(
      "/api/v1/auth/sessions",
      authDeviceSessionsResponseSchema.parse,
      "登录设备加载失败。",
      (response) => {
        if (handleAuthFailure(response)) {
          throw new Error("登录状态已变化。");
        }
      },
    );
    setSessions(data);
  }, [handleAuthFailure]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPenNames(), loadSessions()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号资料加载失败。");
    } finally {
      setLoading(false);
    }
  }, [loadPenNames, loadSessions]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("profile");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          version: profile.version,
          displayName: displayName.trim(),
          bio: bio.trim(),
          avatarUrl: avatarUrl.trim() || null,
        }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) {
          return;
        }
        throw new Error(await readError(response, "账号资料保存失败。"));
      }
      const updated = profileResponseSchema.parse(await response.json()).data;
      setProfile(updated);
      setDisplayName(updated.displayName);
      setBio(updated.bio);
      setAvatarUrl(updated.avatarUrl ?? "");
      setNotice("账号资料已保存。");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号资料保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function createPenName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("pen-create");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/v1/users/me/pen-names", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          name: newPenName.trim(),
          bio: newPenBio.trim(),
          isDefault: newPenDefault,
        }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) {
          return;
        }
        throw new Error(await readError(response, "笔名创建失败。"));
      }
      authorPenNameResponseSchema.parse(await response.json());
      setNewPenName("");
      setNewPenBio("");
      setNewPenDefault(false);
      await loadPenNames();
      setNotice("笔名已创建。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "笔名创建失败。");
    } finally {
      setBusy("");
    }
  }

  function beginEdit(penName: AuthorPenName) {
    setEditing(penName);
    setEditName(penName.name);
    setEditBio(penName.bio);
    setEditDefault(penName.isDefault);
    setError("");
    setNotice("");
  }

  async function savePenName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setBusy(`pen-save-${editing.id}`);
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/users/me/pen-names/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          version: editing.version,
          name: editName.trim(),
          bio: editBio.trim(),
          isDefault: editDefault,
        }),
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) {
          return;
        }
        throw new Error(await readError(response, "笔名保存失败。"));
      }
      authorPenNameResponseSchema.parse(await response.json());
      setEditing(null);
      await loadPenNames();
      setNotice("笔名已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "笔名保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function deletePenName(penName: AuthorPenName) {
    if (!window.confirm(`确定删除笔名“${penName.name}”吗？`)) {
      return;
    }
    setBusy(`pen-delete-${penName.id}`);
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/users/me/pen-names/${penName.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) {
          return;
        }
        throw new Error(await readError(response, "笔名删除失败。"));
      }
      authorPenNameDeleteResponseSchema.parse(await response.json());
      if (editing?.id === penName.id) {
        setEditing(null);
      }
      await loadPenNames();
      setNotice("笔名已删除。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "笔名删除失败。");
    } finally {
      setBusy("");
    }
  }

  async function revokeDevice(session: AuthDeviceSession) {
    setBusy(`session-${session.id}`);
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/auth/sessions/${session.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) {
          return;
        }
        throw new Error(await readError(response, "退出设备失败。"));
      }
      if (session.current) {
        clearCsrfCache();
        router.replace("/login");
        router.refresh();
        return;
      }
      setSessions((current) => current.filter((candidate) => candidate.id !== session.id));
      setNotice("已退出该设备。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出设备失败。");
    } finally {
      setBusy("");
    }
  }

  async function revokeOtherDevices() {
    const others = sessions.filter((session) => !session.current);
    if (others.length === 0) {
      return;
    }
    setBusy("sessions-others");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const responses = await Promise.all(
        others.map((session) =>
          fetch(`/api/v1/auth/sessions/${session.id}`, {
            method: "DELETE",
            headers: { "x-csrf-token": csrfToken },
          }),
        ),
      );
      const failure = responses.find((response) => !response.ok);
      if (failure) {
        if (handleAuthFailure(failure)) {
          return;
        }
        throw new Error(await readError(failure, "退出其他设备失败。"));
      }
      setSessions((current) => current.filter((session) => session.current));
      setNotice("已退出其他设备。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出其他设备失败。");
    } finally {
      setBusy("");
    }
  }

  async function logoutEverywhere() {
    setBusy("sessions-all");
    setError("");
    setNotice("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/v1/auth/logout-all", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        if (handleAuthFailure(response)) {
          return;
        }
        throw new Error(await readError(response, "退出全部设备失败。"));
      }
      clearCsrfCache();
      router.replace("/login");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出全部设备失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="account-security-grid">
      <section className="panel account-settings-card" aria-labelledby="account-profile-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">账号与安全</span>
            <h2 id="account-profile-title">{profile.displayName}</h2>
          </div>
          <span className="badge">
            <UserRound size={13} aria-hidden="true" />
            个人作者
          </span>
        </div>

        {error ? (
          <div className="account-security-notice danger" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button className="text-btn small" onClick={load} type="button">
              重试
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="account-security-notice success" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        ) : null}
        {loading ? (
          <div className="account-security-loading" role="status">
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
            正在加载账号资料
          </div>
        ) : null}

        <div className="account-identity-row">
          <span className="account-avatar" aria-hidden="true">
            {profile.displayName.slice(0, 1)}
          </span>
          <div>
            <strong>{profile.emailMasked}</strong>
            <small>注册邮箱只对自己的账号可见</small>
          </div>
          <button className="btn btn-ghost btn-small" onClick={load} type="button">
            <RefreshCw size={14} aria-hidden="true" />
            刷新
          </button>
        </div>

        <form className="account-profile-form" onSubmit={saveProfile}>
          <label className="auth-field">
            <span>显示名称</span>
            <input
              disabled={busy === "profile"}
              maxLength={50}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>
          <label className="auth-field">
            <span>头像链接</span>
            <input
              disabled={busy === "profile"}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://example.com/avatar.png"
              type="url"
              value={avatarUrl}
            />
          </label>
          <label className="auth-field account-profile-bio">
            <span>个人简介</span>
            <textarea
              disabled={busy === "profile"}
              maxLength={500}
              onChange={(event) => setBio(event.target.value)}
              placeholder="写下你的创作方向，方便回顾。"
              rows={3}
              value={bio}
            />
          </label>
          <div className="account-form-actions">
            <button className="btn btn-primary" disabled={busy === "profile"} type="submit">
              {busy === "profile" ? (
                <>
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                  保存中
                </>
              ) : (
                "保存资料"
              )}
            </button>
          </div>
        </form>
      </section>

      <section className="panel account-settings-card" aria-labelledby="pen-name-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">多笔名</span>
            <h2 id="pen-name-title">让不同作品使用不同署名</h2>
          </div>
          <span className="badge">{penNames.length} 个笔名</span>
        </div>

        {penNames.length === 0 && !loading ? (
          <div className="account-empty">
            <Pencil size={18} aria-hidden="true" />
            <div>
              <strong>还没有笔名</strong>
              <p>先添加一个，之后可以为每部作品选择署名。</p>
            </div>
          </div>
        ) : (
          <div className="pen-name-list">
            {penNames.map((penName) => (
              <article className="pen-name-row" key={penName.id}>
                <span className="model-logo">{penName.name.slice(0, 1)}</span>
                <div>
                  <strong>
                    {penName.name}
                    {penName.isDefault ? <span className="badge jade-badge">默认</span> : null}
                  </strong>
                  <small>{penName.bio || "还没有填写笔名简介"}</small>
                </div>
                <button
                  aria-label={`编辑笔名 ${penName.name}`}
                  className="icon-btn small"
                  onClick={() => beginEdit(penName)}
                  title="编辑笔名"
                  type="button"
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label={`删除笔名 ${penName.name}`}
                  className="icon-btn small"
                  disabled={busy === `pen-delete-${penName.id}`}
                  onClick={() => deletePenName(penName)}
                  title="删除笔名"
                  type="button"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        )}

        {editing ? (
          <form className="pen-name-editor" onSubmit={savePenName}>
            <div className="panel-head">
              <strong>编辑笔名</strong>
              <button className="text-btn small" onClick={() => setEditing(null)} type="button">
                取消
              </button>
            </div>
            <label className="auth-field">
              <span>笔名名称</span>
              <input
                disabled={busy === `pen-save-${editing.id}`}
                maxLength={50}
                onChange={(event) => setEditName(event.target.value)}
                required
                value={editName}
              />
            </label>
            <label className="auth-field">
              <span>笔名简介</span>
              <textarea
                disabled={busy === `pen-save-${editing.id}`}
                maxLength={500}
                onChange={(event) => setEditBio(event.target.value)}
                rows={2}
                value={editBio}
              />
            </label>
            <label className="model-check">
              <input
                checked={editDefault}
                disabled={busy === `pen-save-${editing.id}`}
                onChange={(event) => setEditDefault(event.target.checked)}
                type="checkbox"
              />
              设为默认笔名
            </label>
            <button
              className="btn btn-primary btn-small"
              disabled={busy === `pen-save-${editing.id}`}
            >
              {busy === `pen-save-${editing.id}` ? "保存中" : "保存笔名"}
            </button>
          </form>
        ) : (
          <form className="pen-name-form" onSubmit={createPenName}>
            <div className="two-col-fields">
              <label className="auth-field">
                <span>新笔名</span>
                <input
                  disabled={busy === "pen-create"}
                  maxLength={50}
                  onChange={(event) => setNewPenName(event.target.value)}
                  placeholder="例如：青舟"
                  required
                  value={newPenName}
                />
              </label>
              <label className="auth-field">
                <span>新笔名简介</span>
                <input
                  disabled={busy === "pen-create"}
                  maxLength={500}
                  onChange={(event) => setNewPenBio(event.target.value)}
                  placeholder="这个笔名写什么"
                  value={newPenBio}
                />
              </label>
            </div>
            <label className="model-check">
              <input
                checked={newPenDefault}
                disabled={busy === "pen-create"}
                onChange={(event) => setNewPenDefault(event.target.checked)}
                type="checkbox"
              />
              设为默认笔名
            </label>
            <button className="btn btn-ghost btn-small" disabled={busy === "pen-create"}>
              {busy === "pen-create" ? (
                <>
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                  创建中
                </>
              ) : (
                <>
                  <Plus size={14} aria-hidden="true" />
                  新增笔名
                </>
              )}
            </button>
          </form>
        )}
      </section>

      <section
        className="panel account-settings-card account-sessions-card"
        aria-labelledby="account-sessions-title"
      >
        <div className="panel-head">
          <div>
            <span className="panel-kicker">登录设备</span>
            <h2 id="account-sessions-title">只保留你正在使用的设备</h2>
          </div>
          <div className="account-session-actions">
            <button
              className="btn btn-ghost btn-small"
              disabled={
                busy !== "" ||
                loading ||
                sessions.filter((session) => !session.current).length === 0
              }
              onClick={revokeOtherDevices}
              type="button"
            >
              退出其他设备
            </button>
            <button
              className="btn btn-ghost btn-small danger-button"
              disabled={busy !== "" || loading}
              onClick={logoutEverywhere}
              type="button"
            >
              <LogOut size={14} aria-hidden="true" />
              退出所有设备
            </button>
          </div>
        </div>

        {loading ? (
          <div className="account-security-loading" role="status">
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
            正在加载登录设备
          </div>
        ) : sessions.length === 0 ? (
          <div className="account-empty">
            <Laptop size={18} aria-hidden="true" />
            <div>
              <strong>没有可显示的登录设备</strong>
              <p>重新登录后会在这里看到当前设备。</p>
            </div>
          </div>
        ) : (
          <div className="account-session-list">
            {sessions.map((session) => {
              const label = deviceLabel(session.userAgent);
              return (
                <article className="account-session-row" key={session.id}>
                  <span className="model-logo">
                    <Laptop size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>
                      {label}
                      {session.current ? <span className="badge jade-badge">当前设备</span> : null}
                    </strong>
                    <small>
                      最近活动 {formatDateTime(session.lastSeenAt)} · 登录于{" "}
                      {formatDateTime(session.createdAt)}
                    </small>
                  </div>
                  <button
                    aria-label={`退出设备 ${label}`}
                    className="text-btn small"
                    disabled={busy === `session-${session.id}`}
                    onClick={() => revokeDevice(session)}
                    type="button"
                  >
                    {busy === `session-${session.id}` ? "退出中" : "退出此设备"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function deviceLabel(userAgent: string): string {
  const browser = /Edg\//u.test(userAgent)
    ? "Edge"
    : /Chrome\//u.test(userAgent)
      ? "Chrome"
      : /Safari\//u.test(userAgent)
        ? "Safari"
        : /Firefox\//u.test(userAgent)
          ? "Firefox"
          : "浏览器设备";
  const system = /Windows/u.test(userAgent)
    ? "Windows"
    : /Mac OS X|Macintosh/u.test(userAgent)
      ? "macOS"
      : /iPhone|iPad/u.test(userAgent)
        ? "iOS"
        : /Android/u.test(userAgent)
          ? "Android"
          : /Linux/u.test(userAgent)
            ? "Linux"
            : "";
  return system ? `${browser} · ${system}` : browser;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
