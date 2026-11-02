'use client';

import { useState } from 'react';
import type { ContinuityIssue } from '../../../../lib/chapter-generation-api';

export function ContinuityReviewPanel({
  issues,
  loading,
  busyId,
  error,
  notice,
  onIgnore,
}: {
  issues: ContinuityIssue[];
  loading: boolean;
  busyId?: string;
  error: string;
  notice: string;
  onIgnore: (issue: ContinuityIssue, reason: string) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const openCount = issues.filter((issue) => issue.status === 'open').length;

  return (
    <section
      aria-labelledby="continuity-review-title"
      className="writing-context-section continuity-review"
    >
      <div className="continuity-review-heading">
        <div>
          <h3 id="continuity-review-title">连续性提示</h3>
          <p>对照已确认设定检查正文，确认后再决定怎么改。</p>
        </div>
        {!loading && issues.length > 0 ? (
          <span>{openCount > 0 ? `${openCount} 条待处理` : '已全部处理'}</span>
        ) : null}
      </div>

      {loading ? <p className="writing-context-loading">正在检查本章…</p> : null}
      {error ? (
        <p className="form-message form-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message form-message-success" role="status">
          {notice}
        </p>
      ) : null}
      {!loading && issues.length === 0 ? (
        <p className="continuity-review-empty">这一章暂时没有发现前后设定冲突。</p>
      ) : null}

      <div className="continuity-issue-list">
        {issues.map((issue) => {
          const reason = reasons[issue.id] ?? '';
          return (
            <article
              className={`continuity-issue continuity-issue-${issue.status}`}
              data-testid={`continuity-issue-${issue.category}`}
              key={issue.id}
            >
              <div className="continuity-issue-heading">
                <strong>{issue.categoryLabel}</strong>
                <span
                  className={`continuity-status continuity-status-${issue.status}`}
                >
                  {issue.statusLabel}
                </span>
              </div>
              <p className="continuity-issue-message">{issue.message}</p>
              {issue.confirmedFact ? (
                <div className="continuity-confirmed-fact">
                  <span>已确认设定</span>
                  <p>
                    第 {issue.confirmedFact.chapterNumber} 章 ·{' '}
                    {issue.confirmedFact.statement}
                  </p>
                </div>
              ) : null}
              <div className="continuity-suggestion">
                <span>修改建议</span>
                <p>{issue.suggestion}</p>
              </div>

              {issue.status === 'open' ? (
                <div className="continuity-ignore">
                  <label htmlFor={`continuity-reason-${issue.id}`}>忽略原因</label>
                  <textarea
                    aria-label="忽略原因"
                    id={`continuity-reason-${issue.id}`}
                    onChange={(event) =>
                      setReasons((current) => ({
                        ...current,
                        [issue.id]: event.target.value,
                      }))
                    }
                    placeholder="例如：这是有意安排，后文会解释身体已经恢复。"
                    rows={2}
                    value={reason}
                  />
                  <button
                    className="text-button"
                    disabled={busyId === issue.id || !reason.trim()}
                    onClick={() => void onIgnore(issue, reason)}
                    type="button"
                  >
                    {busyId === issue.id ? '正在记录…' : '忽略这条提示'}
                  </button>
                </div>
              ) : (
                <div className="continuity-ignored-reason">
                  <span>忽略原因</span>
                  <p>{issue.ignoredReason}</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
