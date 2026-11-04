"use client";

import { Check, LoaderCircle, LockKeyhole, MailCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiErrorSchema,
  authSessionResponseSchema,
  sendRegistrationCodeResponseSchema,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

type AuthMode = "login" | "register";

interface AuthFormProps {
  mode: AuthMode;
  sessionExpired?: boolean;
  permissionDenied?: boolean;
}

const errorMessages: Record<string, string> = {
  AUTH_CODE_INVALID: "验证码错误或已过期，请重新获取。",
  AUTH_RATE_LIMITED: "操作过于频繁，请稍后再试。",
  AUTH_EMAIL_TAKEN: "这个邮箱已经注册，可以直接登录。",
  AUTH_LOGIN_FAILED: "邮箱或密码不正确。",
  AUTH_CSRF_INVALID: "页面校验已失效，请刷新后重试。",
  AUTH_ORIGIN_INVALID: "当前请求来源不受信任。",
  AUTH_SESSION_INVALID: "登录状态已失效，请重新登录。",
  VALIDATION_INVALID: "请检查邮箱、验证码和密码格式。",
};

export function AuthForm({ mode, sessionExpired, permissionDenied }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [csrfError, setCsrfError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadCsrf() {
      try {
        const token = await getCsrfToken();
        if (active) {
          setCsrfToken(token);
        }
      } catch {
        if (active) {
          setCsrfError("暂时无法连接账号服务，请刷新页面重试。");
        }
      }
    }
    void loadCsrf();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (codeCooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCodeCooldown((value) => value - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  async function sendCode() {
    setError("");
    setSuccess("");
    setSendingCode(true);
    try {
      const response = await fetch("/api/v1/auth/register/send-code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        throw new Error(readError(await response.json()));
      }
      sendRegistrationCodeResponseSchema.parse(await response.json());
      setSuccess("验证码已发送，请检查邮箱。");
      setCodeCooldown(60);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "验证码发送失败。");
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(
          mode === "login" ? { email, password } : { email, password, code, displayName },
        ),
      });
      if (!response.ok) {
        throw new Error(readError(await response.json()));
      }
      authSessionResponseSchema.parse(await response.json());
      router.replace("/workspace");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !csrfToken || Boolean(csrfError);

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

          <div className="auth-tabs" role="tablist" aria-label="账号入口">
            <Link
              className={`auth-tab${mode === "login" ? " active" : ""}`}
              href="/login"
              role="tab"
              aria-selected={mode === "login"}
            >
              登录
            </Link>
            <Link
              className={`auth-tab${mode === "register" ? " active" : ""}`}
              href="/register"
              role="tab"
              aria-selected={mode === "register"}
            >
              注册
            </Link>
          </div>

          {sessionExpired ? (
            <div className="auth-notice warning" role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              登录状态已失效，请重新登录。
            </div>
          ) : null}
          {permissionDenied ? (
            <div className="auth-notice danger" role="status">
              <LockKeyhole size={16} aria-hidden="true" />
              当前账号无权访问此页面。
            </div>
          ) : null}
          {csrfError ? (
            <div className="auth-notice danger" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              {csrfError}
            </div>
          ) : null}
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

          <form className="auth-form" onSubmit={submit}>
            <h2>{mode === "login" ? "欢迎回来" : "创建作者账号"}</h2>
            <p className="auth-help">
              {mode === "login" ? "登录后继续上次的创作。" : "邮箱验证码注册，不需要额外验证。"}
            </p>

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

            {mode === "register" ? (
              <>
                <div className="auth-code-row">
                  <label className="auth-field">
                    <span>验证码</span>
                    <input
                      autoComplete="one-time-code"
                      disabled={submitting}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="6 位验证码"
                      required
                      value={code}
                    />
                  </label>
                  <button
                    className="btn btn-ghost auth-code-button"
                    disabled={sendingCode || codeCooldown > 0 || !email || !csrfToken}
                    onClick={sendCode}
                    type="button"
                  >
                    {sendingCode
                      ? "发送中"
                      : codeCooldown > 0
                        ? `${codeCooldown} 秒后重发`
                        : "发送验证码"}
                  </button>
                </div>
                <label className="auth-field">
                  <span>显示名称</span>
                  <input
                    autoComplete="nickname"
                    disabled={submitting}
                    maxLength={50}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="林见鹿"
                    required
                    value={displayName}
                  />
                </label>
              </>
            ) : null}

            <label className="auth-field">
              <span>密码</span>
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                disabled={submitting}
                minLength={mode === "register" ? 12 : undefined}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "register" ? "至少 12 位，包含字母和数字" : "输入密码"}
                required
                type="password"
                value={password}
              />
            </label>

            <button className="btn btn-primary auth-submit" disabled={disabled} type="submit">
              {submitting ? (
                <>
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  {mode === "login" ? "登录中" : "注册中"}
                </>
              ) : mode === "login" ? (
                "登录"
              ) : (
                "注册并进入"
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function readError(payload: unknown): string {
  const parsed = apiErrorSchema.safeParse(payload);
  if (!parsed.success) {
    return "请求失败，请稍后重试。";
  }
  return errorMessages[parsed.data.error.code] ?? parsed.data.error.message;
}
