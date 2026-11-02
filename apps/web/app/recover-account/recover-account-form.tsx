'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError } from '../../lib/auth-api';

export function RecoverAccountForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setEmail(new URLSearchParams(window.location.search).get('email') ?? '');
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await apiRequest<void>('/api/v1/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setNotice('账号已恢复，正在前往登录。');
      window.setTimeout(() => router.replace('/login?recovered=1'), 700);
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        requestError.code === 'ACCOUNT_DELETION_EXPIRED'
      ) {
        setError('恢复期已经结束，这个账号无法继续恢复。');
      } else {
        setError(friendlyError(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field">
        <span>邮箱</span>
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label className="field">
        <span>密码</span>
        <input
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
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
      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? '正在恢复…' : '恢复账号'}
      </button>
      <p className="auth-switch">
        <Link href="/login">返回登录</Link>
      </p>
    </form>
  );
}
