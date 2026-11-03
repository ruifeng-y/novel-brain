'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { friendlyError } from '../../../../lib/auth-api';
import {
  loadConfirmedFacts,
  type ConfirmedFact,
  type FactType,
} from '../../../../lib/chapter-generation-api';

const FACT_TYPES: Array<{ value: '' | FactType; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'event', label: '事件' },
  { value: 'body_state', label: '身体状态' },
  { value: 'character_knowledge', label: '角色认知' },
];

function formatFactDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ConfirmedFactsPanel({
  workId,
  branchId,
}: {
  workId: string;
  branchId: string;
}) {
  const [items, setItems] = useState<ConfirmedFact[]>([]);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | FactType>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadConfirmedFacts(workId, branchId)
      .then((response) => {
        if (active) {
          setItems(response.items);
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(friendlyError(requestError));
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
  }, [branchId, workId]);

  const filtered = items.filter((fact) => {
    const matchesType = !typeFilter || fact.type === typeFilter;
    const haystack = `${fact.statement} ${fact.sourceSentence}`.toLowerCase();
    return matchesType && (!keyword.trim() || haystack.includes(keyword.trim().toLowerCase()));
  });

  return (
    <section className="confirmed-facts-panel" aria-labelledby="confirmed-facts-title">
      <div className="settings-center-heading">
        <div>
          <p className="workspace-step">后续生成必须遵守</p>
          <h2 id="confirmed-facts-title">已确认设定</h2>
          <p>这些事实来自已确认章节，后续章节生成会继续遵守。</p>
        </div>
        <div className="settings-center-count" aria-label="已确认设定数量">
          <strong>{items.length}</strong>
          <span>条事实</span>
        </div>
      </div>

      <div className="confirmed-facts-toolbar">
        <label className="field">
          <span>搜索事实</span>
          <input
            aria-label="搜索事实"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按关键词搜索"
            value={keyword}
          />
        </label>
        <label className="field">
          <span>类型</span>
          <select
            aria-label="事实类型"
            onChange={(event) => setTypeFilter(event.target.value as '' | FactType)}
            value={typeFilter}
          >
            {FACT_TYPES.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="form-message form-message-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-list-empty">正在读取已确认设定…</p>
      ) : filtered.length === 0 ? (
        <p className="settings-list-empty">还没有符合条件的已确认设定。</p>
      ) : (
        <div className="confirmed-facts-list">
          {filtered.map((fact) => (
            <article className="confirmed-fact-row" key={fact.id}>
              <div className="confirmed-fact-main">
                <div className="confirmed-fact-meta">
                  <span>{fact.typeLabel}</span>
                  <small>第 {fact.chapterNumber} 章 · {formatFactDate(fact.confirmedAt)}</small>
                </div>
                <strong>{fact.statement}</strong>
                <p>来源原句：{fact.sourceSentence}</p>
                <small>有效期：长期有效</small>
              </div>
              <Link
                className="text-button"
                href={`/workspace/${workId}/write?chapter=${fact.chapterNumber}`}
              >
                回到来源章节
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
