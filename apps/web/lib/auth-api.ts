export type User = {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  status: 'active' | 'disabled' | 'pending_deletion' | 'deleted';
  deletionScheduledFor: string | null;
  createdAt: string;
};

export type AccountSession = {
  id: string;
  current: boolean;
  device: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
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
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: isFormData
      ? { ...init?.headers }
      : {
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
    if (error.code === 'INVALID_CURRENT_PASSWORD') {
      return '当前密码不正确，请重新输入。';
    }
    if (error.code === 'INVALID_RESET_TOKEN') {
      return '重置链接无效或已过期，请重新获取。';
    }
    if (error.code === 'ACCOUNT_PENDING_DELETION') {
      return '账号正在注销恢复期内，可以恢复后继续登录。';
    }
    if (error.code === 'ACCOUNT_DELETION_EXPIRED') {
      return '账号恢复期已经结束，无法继续恢复。';
    }
    if (error.code === 'EXPORT_REQUIRED') {
      return '请先导出全部账号数据，再申请注销。';
    }
    if (error.code === 'PEN_NAME_EXISTS') {
      return '这个笔名已经存在，请换一个。';
    }
    if (error.code === 'PEN_NAME_NOT_FOUND') {
      return '没有找到这个笔名。';
    }
    if (error.code === 'DEFAULT_PEN_NAME_REQUIRED') {
      return '请先把另一个笔名设为默认，再删除这个笔名。';
    }
    if (error.code === 'EMAIL_UNCHANGED') {
      return '新邮箱与当前邮箱相同。';
    }
    if (error.code === 'MAIL_UNAVAILABLE') {
      return '邮件暂时无法发送，请稍后再试。';
    }
    if (error.code === 'VALIDATION_ERROR') {
      return '请检查填写内容后再试。';
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

export function loadAccountSessions(): Promise<{ items: AccountSession[] }> {
  return apiRequest<{ items: AccountSession[] }>('/api/v1/auth/sessions');
}

export function logoutAllDevices(): Promise<void> {
  return apiRequest<void>('/api/v1/auth/logout-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
