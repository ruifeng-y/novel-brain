'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiRequest, friendlyError } from '../../lib/auth-api';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await apiRequest<{ accepted: boolean }>('/api/v1/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNotice('如果这个邮箱已注册，重置邮件已经发出。请检查收件箱和垃圾邮件。');
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field">
        <span>注册邮箱</span>
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
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
        {submitting ? '正在发送…' : '发送重置邮件'}
      </button>
      <p className="auth-switch">
        想起密码了？<Link href="/login">返回登录</Link>
      </p>
    </form>
  );
}
