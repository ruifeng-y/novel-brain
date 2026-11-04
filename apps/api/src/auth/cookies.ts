import type { Response } from "express";

export const SESSION_COOKIE = "nb_session";
export const CSRF_COOKIE = "nb_csrf";

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((cookies, pair) => {
    const separator = pair.indexOf("=");
    if (separator < 0) {
      return cookies;
    }
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

function secureCookie(): boolean {
  return (
    process.env.COOKIE_SECURE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false")
  );
}

export function setSessionCookie(response: Response, token: string, maxAgeSeconds: number): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  });
}

export function setCsrfCookie(response: Response, token: string): void {
  response.cookie(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(SESSION_COOKIE, { path: "/" });
  response.clearCookie(CSRF_COOKIE, { path: "/" });
}
