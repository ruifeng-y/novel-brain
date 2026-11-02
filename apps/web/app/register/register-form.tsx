'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest, friendlyError, type User } from '../../lib/auth-api';

const RESEND_SECONDS = 60;

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) {
      return;
    }

    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function sendCode() {
    setError(undefined);
    setNotice(undefined);
    setSendingCode(true);

    try {
      await apiRequest<{ expiresInSeconds: number }>('/api/v1/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNotice('验证码已发送，请查收邮箱。');
      setResendIn(RESEND_SECONDS);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setSubmitting(true);

    try {
      await apiRequest<User>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, code, password }),
      });

      try {
        await apiRequest<User>('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
      } catch {
        setNotice('账号已创建，请登录。');
        router.push('/login');
        return;
      }

      router.replace('/workspace');
    } catch (requestError) {
      setError(friendlyError(requestError));
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

      <div className="field">
        <label htmlFor="register-code">验证码</label>
        <div className="code-row">
          <input
            autoComplete="one-time-code"
            id="register-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            pattern="\d{6}"
            placeholder="6 位数字"
            required
            value={code}
          />
          <button
            className="secondary-button"
            disabled={sendingCode || resendIn > 0}
            onClick={sendCode}
            type="button"
          >
            {sendingCode ? '发送中…' : resendIn > 0 ? `${resendIn} 秒后重发` : '发送验证码'}
          </button>
        </div>
      </div>

      <label className="field">
        <span>密码</span>
        <input
          autoComplete="new-password"
          minLength={8}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 8 位"
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
        {submitting ? '正在创建…' : '创建账号'}
      </button>

      <p className="auth-switch">
        已经有账号？<Link href="/login">直接登录</Link>
      </p>
    </form>
  );
}
