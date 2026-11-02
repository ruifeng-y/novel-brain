'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, friendlyError, type User } from '../../lib/auth-api';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('reason');
    const params = new URLSearchParams(window.location.search);
    if (params.get('passwordChanged')) {
      setNotice('密码已修改，请用新密码登录。');
    } else if (params.get('passwordReset')) {
      setNotice('密码已重置，请用新密码登录。');
    } else if (params.get('emailChanged')) {
      setNotice('邮箱已修改，请用新邮箱登录。');
    } else if (params.get('recovered')) {
      setNotice('账号已恢复，请重新登录。');
    } else if (params.get('deletionRequested')) {
      setNotice('注销申请已提交，30 天内可以恢复。');
    } else if (reason === 'deleted') {
      setNotice('账号已退出登录。');
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setErrorCode(undefined);
    setNotice(undefined);
    setSubmitting(true);

    try {
      await apiRequest<User>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.replace('/workspace');
    } catch (requestError) {
      setError(friendlyError(requestError));
      if (requestError instanceof ApiError) {
        setErrorCode(requestError.code);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>邮箱</span>
        <input
          autoComplete="email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </label>

      <label className="field">
        <span>密码</span>
        <input
          autoComplete="current-password"
          minLength={1}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {error ? (
        <p className="form-message form-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message form-message-success" role="status">
          {notice}
        </p>
      ) : null}
      {errorCode === 'ACCOUNT_PENDING_DELETION' ? (
        <p className="auth-recovery-link">
          <Link href={`/recover-account?email=${encodeURIComponent(email)}`}>恢复这个账号</Link>
        </p>
      ) : null}

      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? '正在登录…' : '登录'}
      </button>

      <p className="auth-switch">
        <Link href="/forgot-password">忘记密码</Link>
        <span> · </span>
        还没有账号？<Link href="/register">创建账号</Link>
      </p>
    </form>
  );
}
