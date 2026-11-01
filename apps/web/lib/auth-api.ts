export type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

type ErrorPayload = {
  code?: string;
  message?: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message?: string,
  ) {
    super(message ?? '请求失败，请稍后再试');
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ApiError(response.status, payload.code, payload.message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') {
      return '操作太频繁，请稍后再试。';
    }
    if (error.code === 'INVALID_CODE') {
      return '验证码不正确或已过期，请重新获取。';
    }
    if (error.code === 'INVALID_CREDENTIALS') {
      return '邮箱或密码不正确。';
    }
    if (error.code === 'EMAIL_ALREADY_REGISTERED') {
      return '这个邮箱已经注册，可以直接登录。';
    }
  }

  return error instanceof Error ? error.message : '请求失败，请稍后再试。';
}
