'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError } from '../../lib/auth-api';

export function ResetPasswordForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致。');
      return;
    }
    if (!token) {
      setError('重置链接不完整，请重新获取。');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest<void>('/api/v1/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      setNotice('新密码已保存，正在前往登录。');
      window.setTimeout(() => router.replace('/login?passwordReset=1'), 700);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === 'INVALID_RESET_TOKEN') {
        setError('重置链接无效或已过期，请重新获取。');
      } else {
        setError(friendlyError(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {!token && !error ? (
        <p className="form-message form-message-error" role="alert">
          重置链接不完整，请重新获取。
        </p>
      ) : null}
      <label className="field">
        <span>新密码</span>
        <input
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="至少 8 位"
          required
          type="password"
          value={newPassword}
        />
      </label>
      <label className="field">
        <span>再次输入新密码</span>
        <input
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </label>
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
      <button className="primary-button" disabled={submitting || !token} type="submit">
        {submitting ? '正在保存…' : '保存新密码'}
      </button>
      <p className="auth-switch">
        链接失效了？<Link href="/forgot-password">重新获取</Link>
      </p>
    </form>
  );
}
