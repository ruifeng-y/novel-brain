import { expect, type APIRequestContext } from "@playwright/test";
import Redis from "ioredis";

const origin = "http://localhost:3000";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
}

export async function resetRateLimits(): Promise<void> {
  const redis = new Redis(process.env.E2E_REDIS_URL ?? "redis://localhost:6379/1", {
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

export async function getCsrf(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/auth/csrf");
  expect(response.ok()).toBe(true);
  return (await response.json()).data.token as string;
}

export async function mailCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch("http://127.0.0.1:8025/api/v1/messages");
    const messages = (await response.json()) as {
      messages: Array<{ To?: Array<{ Address?: string }>; Snippet?: string }>;
    };
    const message = messages.messages.find((item) => item.To?.[0]?.Address === email);
    const code = message?.Snippet?.match(/\d{6}/)?.[0];
    if (code) {
      return code;
    }
  }
  throw new Error(`Verification code not found for ${email}`);
}

export async function mailPasswordResetToken(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch("http://127.0.0.1:8025/api/v1/messages");
    const messages = (await response.json()) as {
      messages: Array<{
        ID: string;
        Subject?: string;
        To?: Array<{ Address?: string }>;
      }>;
    };
    const message = messages.messages.find(
      (item) => item.To?.[0]?.Address === email && item.Subject === "墨舟密码重置",
    );
    if (!message) {
      continue;
    }
    const detailResponse = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
    const detail = (await detailResponse.json()) as { Text?: string; HTML?: string };
    const body = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`;
    const token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(body)?.[1];
    if (token) {
      return decodeURIComponent(token);
    }
  }
  throw new Error(`Password reset link not found for ${email}`);
}

export async function sendCode(request: APIRequestContext, email: string): Promise<void> {
  const token = await getCsrf(request);
  const response = await request.post("/api/v1/auth/register/send-code", {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { email },
  });
  expect(response.status()).toBe(200);
}

export async function registerUser(
  request: APIRequestContext,
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  await sendCode(request, email);
  const token = await getCsrf(request);
  const response = await request.post("/api/v1/auth/register", {
    headers: { Origin: origin, "X-CSRF-Token": token },
    data: { email, code: await mailCode(email), password, displayName },
  });
  expect(response.status()).toBe(200);
  const sessionCookie = /nb_session=([^;]+)/.exec(response.headers()["set-cookie"] ?? "")?.[1];
  if (!sessionCookie) {
    throw new Error("Registration did not return nb_session");
  }
  return sessionCookie;
}

export async function createWork(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<{ id: string; title: string; mainBranch: { id: string } }> {
  const token = await getCsrf(request);
  const response = await request.post("/api/v1/works", {
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: payload,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data as {
    id: string;
    title: string;
    mainBranch: { id: string };
  };
}
