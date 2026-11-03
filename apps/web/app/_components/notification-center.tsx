'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/auth-api';
import { loadBatchJobs, loadReviewQueue } from '../../lib/batch-jobs-api';
import { type Work } from '../../lib/works-api';

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  href: string;
  unread: boolean;
};

const READ_KEY = 'novelbrain:read-notifications';

export function NotificationCenter({
  onClose,
  onUnreadChange,
}: {
  onClose: () => void;
  onUnreadChange: (count: number) => void;
}) {
  const pathname = usePathname();
  const workId = pathname.match(/^\/workspace\/([0-9a-f-]{36})/)?.[1];
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>(
    'idle',
  );
  const [readIds, setReadIds] = useState<string[]>(() => readStoredIds());

  useEffect(() => {
    if (!workId) {
      setItems([]);
      setStatus('empty');
      onUnreadChange(0);
      return;
    }
    let active = true;
    setStatus('loading');
    apiRequest<Work>(`/api/v1/works/${workId}`)
      .then(async (work) => {
        if (!work.mainBranch) {
          return [];
        }
        const [jobs, queue] = await Promise.all([
          loadBatchJobs(work.id, work.mainBranch.id),
          loadReviewQueue(work.id, work.mainBranch.id),
        ]);
        const next: NotificationItem[] = [];
        for (const job of jobs.items) {
          if (job.status === 'failed') {
            next.push({
              id: `job:${job.id}:failed`,
              title: '创作任务失败',
              detail: `${job.chapterNumbers.length} 章的任务需要检查错误后重试。`,
              time: job.updatedAt,
              href: `/workspace/${workId}/batch`,
              unread: true,
            });
          } else if (job.status === 'waiting_review') {
            next.push({
              id: `job:${job.id}:review`,
              title: '有章节等待确认',
              detail: `${job.waitingReviewChapterCount} 章已生成，等待你审核。`,
              time: job.updatedAt,
              href: `/workspace/${workId}/batch`,
              unread: true,
            });
          } else if (['queued', 'preparing', 'running'].includes(job.status)) {
            next.push({
              id: `job:${job.id}:running`,
              title: '创作任务进行中',
              detail: `${job.chapterNumbers.length} 章的任务已完成 ${job.progress}%。`,
              time: job.updatedAt,
              href: `/workspace/${workId}/batch`,
              unread: true,
            });
          }
        }
        for (const item of queue.items) {
          if (item.continuityIssues.length > 0) {
            next.push({
              id: `review:${item.id}:continuity`,
              title: '连续性告警',
              detail: `第 ${item.chapterNumber} 章有 ${item.continuityIssues.length} 个问题待处理。`,
              time: item.updatedAt,
              href: `/workspace/${workId}/batch`,
              unread: true,
            });
          }
        }
        return next.sort((left, right) => right.time.localeCompare(left.time)).slice(0, 20);
      })
      .then((next) => {
        if (!active) {
          return;
        }
        const stored = readStoredIds();
        const withState = next.map((item) => ({
          ...item,
          unread: !stored.includes(item.id),
        }));
        setItems(withState);
        setStatus(withState.length > 0 ? 'ready' : 'empty');
        onUnreadChange(withState.filter((item) => item.unread).length);
      })
      .catch(() => {
        if (active) {
          setStatus('error');
          onUnreadChange(0);
        }
      });
    return () => {
      active = false;
    };
  }, [onUnreadChange, workId]);

  function markAllRead() {
    const all = [...new Set([...readIds, ...items.map((item) => item.id)])];
    writeStoredIds(all);
    setReadIds(all);
    setItems((current) => current.map((item) => ({ ...item, unread: false })));
    onUnreadChange(0);
  }

  function markRead(id: string) {
    const next = [...new Set([...readStoredIds(), id])];
    writeStoredIds(next);
    setReadIds(next);
    onUnreadChange(Math.max(0, items.filter((item) => item.unread && item.id !== id).length));
    onClose();
  }

  return (
    <section aria-label="通知中心" className="app-popover app-notification-panel" role="dialog">
      <div className="app-notification-heading">
        <div>
          <p className="app-popover-kicker">通知中心</p>
          <h2>{items.filter((item) => item.unread).length} 条未读</h2>
        </div>
        <button className="text-button" onClick={markAllRead} type="button">
          全部标为已读
        </button>
      </div>
      {!workId ? (
        <p className="app-popover-empty">进入一部作品后查看任务与审核通知。</p>
      ) : null}
      {status === 'loading' ? <p className="app-popover-empty">正在整理通知…</p> : null}
      {status === 'error' ? (
        <p className="app-popover-empty">通知暂时无法加载，请稍后再试。</p>
      ) : null}
      {status === 'empty' ? <p className="app-popover-empty">还没有新通知。</p> : null}
      {status === 'ready' ? (
        <div className="app-notification-list">
          {items.map((item) => (
            <Link
              className={item.unread ? 'unread' : ''}
              href={item.href}
              key={item.id}
              onClick={() => markRead(item.id)}
            >
              <span className="app-notification-dot" aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <small>{formatTime(item.time)}</small>
              </div>
              {item.unread ? <em>未读</em> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function readStoredIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(READ_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredIds(ids: string[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(READ_KEY, JSON.stringify(ids));
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
