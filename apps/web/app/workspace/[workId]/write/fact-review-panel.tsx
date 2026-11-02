'use client';

import { useEffect, useState } from 'react';
import { friendlyError } from '../../../../lib/auth-api';
import {
  confirmFactProposal,
  loadFactProposals,
  rejectFactProposal,
  updateFactProposal,
  type FactProposal,
  type FactProposalStatus,
} from '../../../../lib/chapter-generation-api';

const STATUS_LABELS: Record<FactProposalStatus, string> = {
  proposed: '待确认',
  confirmed: '已确认',
  rejected: '已驳回',
};

export function FactReviewPanel({
  workId,
  branchId,
  chapterNumber,
  refreshKey,
}: {
  workId: string;
  branchId: string;
  chapterNumber: number;
  refreshKey: string;
}) {
  const [items, setItems] = useState<FactProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    loadFactProposals(workId, branchId, chapterNumber)
      .then((result) => {
        if (active) {
          setItems(result.items);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(friendlyError(loadError));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [branchId, chapterNumber, refreshKey, workId]);

  function updateLocalStatement(proposalId: string, statement: string) {
    setItems((current) =>
      current.map((item) => (item.id === proposalId ? { ...item, statement } : item)),
    );
  }

  async function saveEdit(item: FactProposal) {
    await runAction(item.id, async () => {
      const updated = await updateFactProposal(
        workId,
        branchId,
        chapterNumber,
        item.id,
        item.statement,
      );
      replaceItem(updated);
      setNotice('事实修改已保存');
    });
  }

  async function confirm(item: FactProposal) {
    await runAction(item.id, async () => {
      const result = await confirmFactProposal(
        workId,
        branchId,
        chapterNumber,
        item.id,
        item.statement,
      );
      replaceItem(result.proposal);
      setNotice('已加入已确认设定，下一章会继续遵守。');
    });
  }

  async function reject(item: FactProposal) {
    await runAction(item.id, async () => {
      const rejected = await rejectFactProposal(workId, branchId, chapterNumber, item.id);
      replaceItem(rejected);
      setNotice('这条事实已驳回，不会用于下一章。');
    });
  }

  async function runAction(itemId: string, action: () => Promise<void>) {
    setBusyId(itemId);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (actionError) {
      setError(friendlyError(actionError));
    } finally {
      setBusyId(undefined);
    }
  }

  function replaceItem(next: FactProposal) {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  const pendingCount = items.filter((item) => item.status === 'proposed').length;
  const confirmedCount = items.filter((item) => item.status === 'confirmed').length;

  return (
    <section aria-labelledby="chapter-facts-title" className="writing-context-section fact-review">
      <div className="fact-review-heading">
        <div>
          <h3 id="chapter-facts-title">本章事实</h3>
          <p>从正文里整理出来的设定。确认后，下一章会继续遵守。</p>
        </div>
        {!loading && items.length > 0 ? (
          <span>
            {pendingCount > 0 ? `${pendingCount} 条待确认` : `${confirmedCount} 条已确认`}
          </span>
        ) : null}
      </div>

      {loading ? <p className="writing-context-loading">正在整理本章事实…</p> : null}
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

      {!loading && items.length === 0 ? (
        <p className="fact-review-empty">这一章还没有整理出可确认的事实。</p>
      ) : null}

      <div className="fact-proposal-list">
        {items.map((item) => (
          <article
            className={`fact-proposal fact-proposal-${item.status}`}
            data-testid={`fact-proposal-${item.type}`}
            key={item.id}
          >
            <div className="fact-proposal-heading">
              <span className="fact-type">{item.typeLabel}</span>
              <span className={`fact-status fact-status-${item.status}`}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>

            {item.status === 'proposed' ? (
              <label className="fact-statement-field">
                <span>事实内容</span>
                <textarea
                  aria-label={`事实内容：${item.typeLabel}`}
                  disabled={busyId === item.id}
                  onChange={(event) => updateLocalStatement(item.id, event.target.value)}
                  rows={3}
                  value={item.statement}
                />
              </label>
            ) : (
              <p className="fact-statement">{item.statement}</p>
            )}

            <div className="fact-source">
              <span>来源原句</span>
              <blockquote>{item.sourceSentence}</blockquote>
            </div>

            {item.status === 'proposed' ? (
              <div className="fact-actions">
                <button
                  className="text-button"
                  disabled={busyId === item.id}
                  onClick={() => void saveEdit(item)}
                  type="button"
                >
                  保存修改
                </button>
                <button
                  className="secondary-button"
                  disabled={busyId === item.id}
                  onClick={() => void confirm(item)}
                  type="button"
                >
                  确认采用
                </button>
                <button
                  className="text-button fact-reject"
                  disabled={busyId === item.id}
                  onClick={() => void reject(item)}
                  type="button"
                >
                  驳回
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
