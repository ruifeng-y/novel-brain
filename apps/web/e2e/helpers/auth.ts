import { expect, type APIRequestContext } from "@playwright/test";
import Redis from "ioredis";

const origin = "http://localhost:3000";
const mailBaseUrl = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:8025";

interface MailMessageSummary {
  id: string;
  provider: "maildev" | "mailpit";
  to: string;
  subject: string;
  snippet: string;
}

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
    const message = (await listMailMessages()).find((item) => item.to === email);
    const code = message?.snippet.match(/\d{6}/)?.[0];
    if (code) {
      return code;
    }
  }
  throw new Error(`Verification code not found for ${email}`);
}

export async function mailPasswordResetToken(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const message = (await listMailMessages()).find(
      (item) => item.to === email && item.subject === "墨舟密码重置",
    );
    if (!message) {
      continue;
    }
    const body = await readMailMessage(message);
    const token = /[?&]token=([A-Za-z0-9_-]+)/u.exec(body)?.[1];
    if (token) {
      return decodeURIComponent(token);
    }
  }
  throw new Error(`Password reset link not found for ${email}`);
}

async function listMailMessages(): Promise<MailMessageSummary[]> {
  const mailpitResponse = await fetch(`${mailBaseUrl}/api/v1/messages`);
  if (mailpitResponse.ok) {
    const payload = (await mailpitResponse.json()) as {
      messages: Array<{
        ID: string;
        Subject?: string;
        To?: Array<{ Address?: string }>;
        Snippet?: string;
      }>;
    };
    return payload.messages.map((message) => ({
      id: message.ID,
      provider: "mailpit",
      to: message.To?.[0]?.Address ?? "",
      subject: message.Subject ?? "",
      snippet: message.Snippet ?? "",
    }));
  }

  const maildevResponse = await fetch(`${mailBaseUrl}/api/email`);
  if (maildevResponse.ok) {
    const payload = (await maildevResponse.json()) as Array<{
      id: string;
      subject?: string;
      to?: Array<{ address?: string }>;
      text?: string;
      html?: string;
    }>;
    return payload.map((message) => ({
      id: message.id,
      provider: "maildev",
      to: message.to?.[0]?.address ?? "",
      subject: message.subject ?? "",
      snippet: `${message.text ?? ""}\n${message.html ?? ""}`,
    }));
  }

  throw new Error(`Mail API returned ${mailpitResponse.status} and ${maildevResponse.status}`);
}

async function readMailMessage(message: MailMessageSummary): Promise<string> {
  const response =
    message.provider === "mailpit"
      ? await fetch(`${mailBaseUrl}/api/v1/message/${message.id}`)
      : await fetch(`${mailBaseUrl}/email/${message.id}`);
  if (!response.ok) {
    throw new Error(`Mail detail API returned ${response.status}`);
  }
  if (message.provider === "mailpit") {
    const detail = (await response.json()) as { Text?: string; HTML?: string };
    return `${detail.Text ?? ""}\n${detail.HTML ?? ""}`;
  }
  const detail = (await response.json()) as { text?: string; html?: string };
  return `${detail.text ?? ""}\n${detail.html ?? ""}`;
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
): Promise<{ id: string; title: string; mainBranch: { id: string; headNodeId: string } }> {
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
    mainBranch: { id: string; headNodeId: string };
  };
}
