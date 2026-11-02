export type PenName = {
  id: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PenNameListResponse = {
  items: PenName[];
};

export function formatAccountDate(value: string | null): string {
  if (!value) {
    return '未设置';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
