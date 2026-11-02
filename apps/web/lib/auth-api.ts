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
    if (error.code === 'VALIDATION_ERROR') {
      return '请补全作品信息后再试。';
    }
    if (error.code === 'WORK_NOT_FOUND') {
      return '没有找到这部作品，它可能已被删除。';
    }
    if (error.code === 'WORK_COMPLETED_READ_ONLY') {
      return '已完本作品默认只读。可以恢复连载，或到平行版本里继续修改。';
    }
    if (error.code === 'WORK_RESTORE_EXPIRED') {
      return '这部作品已超过 30 天恢复期，无法再恢复。';
    }
    if (error.code === 'WORK_RESTORE_REQUIRED') {
      return '请先恢复这部作品，再继续修改。';
    }
    if (error.code === 'WORK_STATUS_TRANSITION_INVALID') {
      return '当前状态不能这样切换，请先恢复或重新开启作品。';
    }
    if (
      error.code === 'UNSUPPORTED_MANUSCRIPT_FORMAT' ||
      error.code === 'MANUSCRIPT_EMPTY' ||
      error.code === 'DOCX_CONTENT_INVALID'
    ) {
      return '旧稿无法读取，请选择可用的 TXT、Markdown 或 Word 文件。';
    }
  }

  return error instanceof Error ? error.message : '请求失败，请稍后再试。';
}
