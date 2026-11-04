import { expect, type APIRequestContext } from "@playwright/test";
import Redis from "ioredis";

const origin = "http://localhost:3000";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
}

export async function resetRateLimits(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

async function csrf(request: APIRequestContext): Promise<string> {
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

export async function sendCode(request: APIRequestContext, email: string): Promise<void> {
  const token = await csrf(request);
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
  const token = await csrf(request);
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
