'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ApiError,
  apiRequest,
  friendlyError,
  loadAccountSessions,
  logoutAllDevices,
  type AccountSession,
  type User,
} from '../../../../lib/auth-api';
import {
  formatAccountDate,
  type PenName,
  type PenNameListResponse,
} from '../../../../lib/account-api';
import { loadAccountExport, startAccountExport } from '../../../../lib/account-data-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; user: User; penNames: PenName[] }
  | { status: 'error'; message: string };

type Notice = {
  kind: 'success' | 'error';
  text: string;
} | null;

type PenNameEditor = {
  id?: string;
  name: string;
  bio: string;
  avatarUrl: string;
  isDefault: boolean;
};

const EMPTY_PEN_NAME: PenNameEditor = {
  name: '',
  bio: '',
  avatarUrl: '',
  isDefault: false,
};

export function AccountSettings() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [notice, setNotice] = useState<Notice>(null);
  const [profile, setProfile] = useState({
    displayName: '',
    bio: '',
    avatarUrl: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [emailEditor, setEmailEditor] = useState({
    newEmail: '',
    currentPassword: '',
    code: '',
  });
  const [pendingEmail, setPendingEmail] = useState('');
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [passwordEditor, setPasswordEditor] = useState({
    currentPassword: '',
    newPassword: '',
    confirmation: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [penNameEditor, setPenNameEditor] = useState<PenNameEditor>(EMPTY_PEN_NAME);
  const [savingPenName, setSavingPenName] = useState(false);
  const [deletingPenNameId, setDeletingPenNameId] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [deletion, setDeletion] = useState({ password: '', confirmation: '' });
  const [requestingDeletion, setRequestingDeletion] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<User>('/api/v1/users/me'),
      apiRequest<PenNameListResponse>('/api/v1/users/me/pen-names'),
      loadAccountSessions(),
    ])
      .then(([user, penNames, sessionList]) => {
        if (!active) {
          return;
        }
        setState({ status: 'ready', user, penNames: penNames.items });
        setSessions(sessionList.items);
        setProfile({
          displayName: user.displayName,
          bio: user.bio,
          avatarUrl: user.avatarUrl ?? '',
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login');
          return;
        }
        setState({ status: 'error', message: friendlyError(error) });
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function refreshPenNames() {
    const response = await apiRequest<PenNameListResponse>('/api/v1/users/me/pen-names');
    setState((current) =>
      current.status === 'ready' ? { ...current, penNames: response.items } : current,
    );
  }

  async function signOutEverywhere() {
    if (!window.confirm('退出所有设备？当前页面也会退出，需要重新登录。')) {
      return;
    }
    setNotice(null);
    try {
      await logoutAllDevices();
      router.replace('/login');
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setNotice(null);
    try {
      const user = await apiRequest<User>('/api/v1/users/me', {
        method: 'PATCH',
        body: JSON.stringify(profile),
      });
      setState((current) => (current.status === 'ready' ? { ...current, user } : current));
      setProfile({
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl ?? '',
      });
      setNotice({ kind: 'success', text: '账号资料已保存。' });
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setSavingProfile(false);
    }
  }

  async function sendEmailCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendingEmailCode(true);
    setNotice(null);
    try {
      await apiRequest<{ expiresInSeconds: number }>('/api/v1/users/me/email/change', {
        method: 'POST',
        body: JSON.stringify({
          newEmail: emailEditor.newEmail,
          currentPassword: emailEditor.currentPassword,
        }),
      });
      setPendingEmail(emailEditor.newEmail.trim().toLowerCase());
      setNotice({ kind: 'success', text: '验证码已发到新邮箱，请查收。' });
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setSendingEmailCode(false);
    }
  }

  async function verifyEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifyingEmail(true);
    setNotice(null);
    try {
      await apiRequest<void>('/api/v1/users/me/email/verify', {
        method: 'POST',
        body: JSON.stringify({ newEmail: pendingEmail, code: emailEditor.code }),
      });
      router.replace('/login?emailChanged=1');
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setVerifyingEmail(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordEditor.newPassword !== passwordEditor.confirmation) {
      setNotice({ kind: 'error', text: '两次输入的新密码不一致。' });
      return;
    }
    setChangingPassword(true);
    setNotice(null);
    try {
      await apiRequest<void>('/api/v1/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: passwordEditor.currentPassword,
          newPassword: passwordEditor.newPassword,
        }),
      });
      router.replace('/login?passwordChanged=1');
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setChangingPassword(false);
    }
  }

  async function savePenName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPenName(true);
    setNotice(null);
    try {
      const body = {
        name: penNameEditor.name,
        bio: penNameEditor.bio,
        avatarUrl: penNameEditor.avatarUrl,
        ...(penNameEditor.isDefault ? { isDefault: true } : {}),
      };
      if (penNameEditor.id) {
        await apiRequest<PenName>(`/api/v1/users/me/pen-names/${penNameEditor.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await apiRequest<PenName>('/api/v1/users/me/pen-names', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setPenNameEditor(EMPTY_PEN_NAME);
      await refreshPenNames();
      setNotice({ kind: 'success', text: '笔名已保存。' });
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setSavingPenName(false);
    }
  }

  async function promotePenName(penName: PenName) {
    setNotice(null);
    try {
      await apiRequest<PenName>(`/api/v1/users/me/pen-names/${penName.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
      await refreshPenNames();
      setNotice({ kind: 'success', text: `“${penName.name}”已设为默认笔名。` });
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    }
  }

  async function removePenName(penName: PenName) {
    if (!window.confirm(`删除笔名“${penName.name}”？已有作品会保留原来的署名文字。`)) {
      return;
    }
    setDeletingPenNameId(penName.id);
    setNotice(null);
    try {
      await apiRequest<void>(`/api/v1/users/me/pen-names/${penName.id}`, {
        method: 'DELETE',
      });
      await refreshPenNames();
      setNotice({ kind: 'success', text: '笔名已删除。' });
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setDeletingPenNameId(undefined);
    }
  }

  async function exportAccount() {
    setExporting(true);
    setNotice(null);
    try {
      const created = await startAccountExport();
      let job = created;
      for (let attempt = 0; attempt < 120 && job.status !== 'completed'; attempt += 1) {
        if (job.status === 'failed') {
          throw new ApiError(500, 'ACCOUNT_EXPORT_FAILED', job.error ?? '账号数据导出失败');
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = await loadAccountExport(job.id);
      }
      if (job.status !== 'completed' || !job.downloadUrl) {
        throw new ApiError(504, 'ACCOUNT_EXPORT_TIMEOUT', '账号数据仍在打包，请稍后重试');
      }
      const response = await fetch(job.downloadUrl, { credentials: 'same-origin' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        throw new ApiError(response.status, payload.code, payload.message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = job.fileName ?? `novelbrain-account-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExported(true);
      setNotice({ kind: 'success', text: '账号数据已导出，可以继续申请注销。' });
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setExporting(false);
    }
  }

  async function requestDeletion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestingDeletion(true);
    setNotice(null);
    try {
      await apiRequest<{ deletionScheduledFor: string }>('/api/v1/users/me/delete', {
        method: 'POST',
        body: JSON.stringify(deletion),
      });
      router.replace('/login?deletionRequested=1');
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setRequestingDeletion(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <main className="workspace-shell">
        <p className="workspace-loading">正在打开账号设置…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="workspace-shell">
        <section className="workspace-error">
          <h1>暂时无法打开账号设置</h1>
          <p>{state.message}</p>
          <button className="secondary-button" onClick={() => window.location.reload()} type="button">
            重新加载
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-shell settings-shell account-shell">
      <header className="workspace-header">
        <Link className="workspace-brand" href="/workspace">
          NovelBrain
        </Link>
        <nav className="workspace-nav" aria-label="账号导航">
          <Link href="/workspace">作品书架</Link>
          <Link href="/workspace/settings">模型设置</Link>
          <Link aria-current="page" href="/workspace/settings/account">
            账号设置
          </Link>
          <Link href="/workspace/settings/privacy">隐私与合规</Link>
        </nav>
      </header>

      <section className="settings-hero account-hero">
        <div>
          <p className="workspace-step">账号与安全</p>
          <h1>你的写作身份</h1>
        </div>
        <p>管理显示资料、登录邮箱、密码和笔名。凭据一经修改，所有设备都会重新登录。</p>
      </section>

      {notice ? (
        <p className={`form-message form-message-${notice.kind} account-notice`} role="status">
          {notice.text}
        </p>
      ) : null}

      <div className="account-layout">
        <section className="account-section" aria-labelledby="account-profile-title">
          <div className="account-section-heading">
            <div>
              <p className="workspace-step">公开资料</p>
              <h2 id="account-profile-title">显示资料</h2>
            </div>
            <span>{state.user.email}</span>
          </div>
          <form aria-label="显示资料表单" className="auth-form settings-form" onSubmit={saveProfile}>
            <label className="field">
              <span>显示名</span>
              <input
                maxLength={80}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, displayName: event.target.value }))
                }
                required
                value={profile.displayName}
              />
            </label>
            <label className="field">
              <span>简介</span>
              <textarea
                maxLength={1000}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, bio: event.target.value }))
                }
                placeholder="写一点你关心的题材和创作方向"
                value={profile.bio}
              />
            </label>
            <label className="field">
              <span>头像链接</span>
              <input
                onChange={(event) =>
                  setProfile((current) => ({ ...current, avatarUrl: event.target.value }))
                }
                placeholder="https://example.com/avatar.png"
                type="url"
                value={profile.avatarUrl}
              />
            </label>
            <button className="primary-button account-submit" disabled={savingProfile} type="submit">
              {savingProfile ? '正在保存…' : '保存资料'}
            </button>
          </form>
        </section>

        <section className="account-section" aria-labelledby="account-security-title">
          <div className="account-section-heading">
            <div>
              <p className="workspace-step">登录凭据</p>
              <h2 id="account-security-title">邮箱与密码</h2>
            </div>
            <span>修改后需重新登录</span>
          </div>

          <form
            aria-label="邮箱变更表单"
            className="auth-form settings-form account-security-form"
            onSubmit={sendEmailCode}
          >
            <div className="account-current-email">
              <span>当前邮箱</span>
              <strong>{state.user.email}</strong>
            </div>
            <label className="field">
              <span>新邮箱</span>
              <input
                inputMode="email"
                onChange={(event) =>
                  setEmailEditor((current) => ({ ...current, newEmail: event.target.value }))
                }
                required
                type="email"
                value={emailEditor.newEmail}
              />
            </label>
            <label className="field">
              <span>当前密码</span>
              <input
                autoComplete="current-password"
                onChange={(event) =>
                  setEmailEditor((current) => ({
                    ...current,
                    currentPassword: event.target.value,
                  }))
                }
                required
                type="password"
                value={emailEditor.currentPassword}
              />
            </label>
            <button className="secondary-button" disabled={sendingEmailCode} type="submit">
              {sendingEmailCode ? '正在发送…' : '发送新邮箱验证码'}
            </button>
          </form>

          {pendingEmail ? (
            <form
              aria-label="邮箱验证表单"
              className="auth-form settings-form account-inline-verify"
              onSubmit={verifyEmail}
            >
              <p>验证码已发到 {pendingEmail}</p>
              <label className="field">
                <span>验证码</span>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setEmailEditor((current) => ({
                      ...current,
                      code: event.target.value.replace(/\D/g, ''),
                    }))
                  }
                  pattern="\d{6}"
                  required
                  value={emailEditor.code}
                />
              </label>
              <button className="primary-button" disabled={verifyingEmail} type="submit">
                {verifyingEmail ? '正在确认…' : '确认修改邮箱'}
              </button>
            </form>
          ) : null}

          <form
            aria-label="修改密码表单"
            className="auth-form settings-form account-password-form"
            onSubmit={changePassword}
          >
            <h3>修改密码</h3>
            <label className="field">
              <span>当前密码</span>
              <input
                autoComplete="current-password"
                onChange={(event) =>
                  setPasswordEditor((current) => ({
                    ...current,
                    currentPassword: event.target.value,
                  }))
                }
                required
                type="password"
                value={passwordEditor.currentPassword}
              />
            </label>
            <label className="field">
              <span>新密码</span>
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) =>
                  setPasswordEditor((current) => ({
                    ...current,
                    newPassword: event.target.value,
                  }))
                }
                required
                type="password"
                value={passwordEditor.newPassword}
              />
            </label>
            <label className="field">
              <span>再次输入新密码</span>
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) =>
                  setPasswordEditor((current) => ({
                    ...current,
                    confirmation: event.target.value,
                  }))
                }
                required
                type="password"
                value={passwordEditor.confirmation}
              />
            </label>
            <button className="secondary-button" disabled={changingPassword} type="submit">
              {changingPassword ? '正在修改…' : '修改密码'}
            </button>
          </form>
        </section>

        <section className="account-section account-section-wide" aria-labelledby="sessions-title">
          <div className="account-section-heading">
            <div>
              <p className="workspace-step">登录状态</p>
              <h2 id="sessions-title">登录会话</h2>
            </div>
            <span>{sessions.length} 个有效会话</span>
          </div>
          <p className="account-session-note">
            凭据修改后旧会话会失效。发现不认识的设备时，立即退出所有设备并更换密码。
          </p>
          <ul className="account-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.device}
                    {session.current ? <em>当前设备</em> : null}
                  </strong>
                  <small>
                    {session.ip} · 最近活跃 {formatAccountDate(session.lastSeenAt)}
                  </small>
                </div>
                <span>{formatAccountDate(session.expiresAt)} 到期</span>
              </li>
            ))}
          </ul>
          <button
            className="secondary-button"
            onClick={() => void signOutEverywhere()}
            type="button"
          >
            退出所有设备
          </button>
        </section>

        <section className="account-section account-section-wide" aria-labelledby="pen-names-title">
          <div className="account-section-heading">
            <div>
              <p className="workspace-step">作品署名</p>
              <h2 id="pen-names-title">笔名</h2>
            </div>
            <span>{state.penNames.length} 个笔名</span>
          </div>

          <div className="pen-name-list">
            {state.penNames.map((penName) => (
              <article className="pen-name-row" key={penName.id}>
                <div className="pen-name-avatar" aria-hidden="true">
                  {penName.name.slice(0, 1)}
                </div>
                <div className="pen-name-copy">
                  <div>
                    <strong>{penName.name}</strong>
                    {penName.isDefault ? <span className="default-tag">默认笔名</span> : null}
                  </div>
                  <p>{penName.bio || '还没有简介。'}</p>
                </div>
                <div className="pen-name-actions">
                  {!penName.isDefault ? (
                    <button
                      className="text-button"
                      onClick={() => promotePenName(penName)}
                      type="button"
                    >
                      设为默认
                    </button>
                  ) : null}
                  <button
                    className="text-button"
                    onClick={() => {
                      setPenNameEditor({
                        id: penName.id,
                        name: penName.name,
                        bio: penName.bio,
                        avatarUrl: penName.avatarUrl ?? '',
                        isDefault: penName.isDefault,
                      });
                    }}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={deletingPenNameId === penName.id}
                    onClick={() => removePenName(penName)}
                    type="button"
                  >
                    {deletingPenNameId === penName.id ? '正在删除…' : '删除'}
                  </button>
                </div>
              </article>
            ))}
          </div>

          <form
            aria-label="笔名表单"
            className="auth-form settings-form pen-name-form"
            onSubmit={savePenName}
          >
            <div className="account-section-heading pen-name-form-heading">
              <div>
                <p className="workspace-step">{penNameEditor.id ? '编辑笔名' : '新增笔名'}</p>
                <h3>{penNameEditor.id ? penNameEditor.name || '调整笔名' : '换一个署名'}</h3>
              </div>
              {penNameEditor.id ? (
                <button
                  className="text-button"
                  onClick={() => setPenNameEditor(EMPTY_PEN_NAME)}
                  type="button"
                >
                  取消编辑
                </button>
              ) : null}
            </div>
            <div className="pen-name-fields">
              <label className="field">
                <span>笔名</span>
                <input
                  maxLength={60}
                  onChange={(event) =>
                    setPenNameEditor((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="例如：青衫客"
                  required
                  value={penNameEditor.name}
                />
              </label>
              <label className="field">
                <span>头像链接</span>
                <input
                  onChange={(event) =>
                    setPenNameEditor((current) => ({
                      ...current,
                      avatarUrl: event.target.value,
                    }))
                  }
                  placeholder="可选"
                  type="url"
                  value={penNameEditor.avatarUrl}
                />
              </label>
            </div>
            <label className="field">
              <span>笔名简介</span>
              <textarea
                maxLength={1000}
                onChange={(event) =>
                  setPenNameEditor((current) => ({ ...current, bio: event.target.value }))
                }
                placeholder="这个署名下通常写什么？"
                value={penNameEditor.bio}
              />
            </label>
            <label className="checkbox-field">
              <input
                checked={penNameEditor.isDefault}
                disabled={penNameEditor.isDefault}
                onChange={(event) =>
                  setPenNameEditor((current) => ({
                    ...current,
                    isDefault: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>{penNameEditor.isDefault ? '当前默认笔名' : '设为默认笔名'}</span>
            </label>
            <button className="primary-button account-submit" disabled={savingPenName} type="submit">
              {savingPenName ? '正在保存…' : '保存笔名'}
            </button>
          </form>
        </section>

        <section
          className="account-section account-danger-section account-section-wide"
          aria-labelledby="account-danger-title"
        >
          <div className="account-section-heading">
            <div>
              <p className="workspace-step">账号生命周期</p>
              <h2 id="account-danger-title">导出与注销</h2>
            </div>
            <span>30 天恢复期</span>
          </div>
          <p className="account-section-intro">
            注销前先导出全部作品和账号资料。申请注销后账号进入 30 天恢复期，期间可以凭邮箱和密码恢复；期满后在线数据永久删除。
          </p>
          <div className="account-export-row">
            <div>
              <strong>全部账号数据</strong>
              <p>作品、设定、大纲、章节、版本和修改记录；不包含模型密钥。</p>
            </div>
            <button className="secondary-button" disabled={exporting} onClick={exportAccount} type="button">
              {exporting ? '正在导出…' : exported ? '再次导出' : '导出全部数据'}
            </button>
          </div>
          <form
            aria-label="注销申请表单"
            className="auth-form settings-form account-delete-form"
            onSubmit={requestDeletion}
          >
            <div className="account-delete-fields">
              <label className="field">
                <span>当前密码</span>
                <input
                  autoComplete="current-password"
                  onChange={(event) =>
                    setDeletion((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                  type="password"
                  value={deletion.password}
                />
              </label>
              <label className="field">
                <span>输入“注销账号”</span>
                <input
                  onChange={(event) =>
                    setDeletion((current) => ({ ...current, confirmation: event.target.value }))
                  }
                  placeholder="注销账号"
                  required
                  value={deletion.confirmation}
                />
              </label>
            </div>
            <button
              className="secondary-button danger-button"
              disabled={requestingDeletion || !exported}
              type="submit"
            >
              {requestingDeletion ? '正在提交…' : '申请注销账号'}
            </button>
            {!exported ? <p className="field-hint">完成一次数据导出后才能申请注销。</p> : null}
          </form>
          <p className="account-export-date">
            账号创建时间：{formatAccountDate(state.user.createdAt)}
          </p>
        </section>
      </div>
    </main>
  );
}
