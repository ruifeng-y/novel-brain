"use client";

import { ArrowLeft, LoaderCircle, MailCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  apiErrorSchema,
  resetPasswordResponseSchema,
  sendPasswordResetResponseSchema,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { AuthShell } from "./auth-shell";

type RecoveryMode = "forgot" | "reset";

const errorMessages: Record<string, string> = {
  AUTH_CODE_INVALID: "重置链接无效、已使用或已过期，请重新申请。",
  AUTH_RATE_LIMITED: "操作过于频繁，请稍后再试。",
  AUTH_PASSWORD_WEAK: "密码至少 12 位，并且必须同时包含字母和数字。",
  AUTH_CSRF_INVALID: "页面校验已失效，请刷新后重试。",
  AUTH_ORIGIN_INVALID: "当前请求来源不受信任。",
  VALIDATION_INVALID: "请检查邮箱和密码格式。",
};

export function PasswordRecoveryForm({ mode, token = "" }: { mode: RecoveryMode; token?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    getCsrfToken()
      .then((value) => {
        if (active) {
          setCsrfToken(value);
        }
      })
      .catch(() => {
        if (active) {
          setError("暂时无法连接账号服务，请刷新页面重试。");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (mode === "reset" && password !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        sendPasswordResetResponseSchema.parse(
          await postJson("/api/v1/auth/password/forgot", csrfToken, { email }),
        );
        setSuccess("如果该邮箱已注册，重置链接会发送到邮箱。链接 30 分钟内有效。");
      } else {
        resetPasswordResponseSchema.parse(
          await postJson("/api/v1/auth/password/reset", csrfToken, { token, password }),
        );
        setSuccess("密码已重置，请使用新密码重新登录。");
        setPassword("");
        setConfirmation("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !csrfToken || (mode === "reset" && !token);

  return (
    <AuthShell activeTab={mode === "forgot" ? "forgot" : "reset"}>
      {error ? (
        <div className="auth-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="auth-notice success" role="status">
          <MailCheck size={16} aria-hidden="true" />
          {success}
        </div>
      ) : null}
      {mode === "reset" && !token ? (
        <div className="auth-notice warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          这个重置链接不完整，请重新申请。
        </div>
      ) : null}

      <form className="auth-form" onSubmit={submit}>
        <h2>{mode === "forgot" ? "找回密码" : "设置新密码"}</h2>
        <p className="auth-help">
          {mode === "forgot"
            ? "输入注册邮箱，我们会发送一封重置链接。"
            : "新密码至少 12 位，并同时包含字母和数字。"}
        </p>

        {mode === "forgot" ? (
          <label className="auth-field">
            <span>邮箱</span>
            <input
              autoComplete="email"
              disabled={submitting}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
        ) : (
          <>
            <label className="auth-field">
              <span>新密码</span>
              <input
                autoComplete="new-password"
                disabled={submitting || Boolean(success)}
                minLength={12}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 12 位，包含字母和数字"
                required
                type="password"
                value={password}
              />
            </label>
            <label className="auth-field">
              <span>再次输入新密码</span>
              <input
                autoComplete="new-password"
                disabled={submitting || Boolean(success)}
                minLength={12}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="再输入一次"
                required
                type="password"
                value={confirmation}
              />
            </label>
          </>
        )}

        <button
          className="btn btn-primary auth-submit"
          disabled={disabled || Boolean(success)}
          type="submit"
        >
          {submitting ? (
            <>
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
              {mode === "forgot" ? "发送中" : "重置中"}
            </>
          ) : mode === "forgot" ? (
            "发送重置链接"
          ) : (
            "重置密码"
          )}
        </button>

        <div className="auth-form-row auth-recovery-links">
          <Link className="text-link" href="/login">
            <ArrowLeft size={14} aria-hidden="true" />
            返回登录
          </Link>
          {mode === "forgot" ? (
            <Link className="text-link" href="/register">
              还没有账号？
            </Link>
          ) : (
            <Link className="text-link" href="/forgot-password">
              重新发送链接
            </Link>
          )}
        </div>
      </form>
    </AuthShell>
  );
}

function readError(payload: unknown): string {
  const parsed = apiErrorSchema.safeParse(payload);
  if (!parsed.success) {
    return "请求失败，请稍后重试。";
  }
  return errorMessages[parsed.data.error.code] ?? parsed.data.error.message;
}

async function postJson(path: string, csrfToken: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(readError(body));
  }
  return body;
}
