'use client';

import Link from 'next/link';
import { useState } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import { searchWork } from '../../../lib/search-api';
import type { WorkSearchResult } from '@novel/contracts';

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'ready'; result: WorkSearchResult }
  | { status: 'error'; message: string };

export function WorkSearchPanel({
  branchId,
  workId,
}: {
  branchId: string;
  workId: string;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phrase = query.trim();
    if (!phrase) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'searching' });
    try {
      setState({ status: 'ready', result: await searchWork(workId, branchId, phrase) });
    } catch (error) {
      setState({ status: 'error', message: friendlyError(error) });
    }
  }

  return (
    <section className="work-search-panel" aria-labelledby="work-search-title">
      <div className="work-search-heading">
        <div>
          <p className="workspace-step">设定、大纲与正文</p>
          <h2 id="work-search-title">全书搜索</h2>
        </div>
        <p>输入名称、别名、章目标或正文片段，一次找到相关引用。</p>
      </div>
      <form className="work-search-form" onSubmit={(event) => void onSubmit(event)}>
        <label className="field">
          <span>搜索内容</span>
          <input
            aria-label="全书搜索"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="例如：断碑、沈砚、母亲留下的剑痕"
            value={query}
          />
        </label>
        <button className="primary-button" disabled={state.status === 'searching'} type="submit">
          {state.status === 'searching' ? '正在搜索…' : '搜索全书'}
        </button>
      </form>

      {state.status === 'error' ? (
        <p className="form-message form-message-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === 'ready' && state.result.items.length === 0 ? (
        <p className="work-search-empty">没有找到匹配的设定、大纲或正文。</p>
      ) : null}
      {state.status === 'ready' && state.result.items.length > 0 ? (
        <ul className="work-search-results" aria-label="搜索结果">
          {state.result.items.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              <span className={`work-search-type work-search-type-${item.type}`}>
                {item.typeLabel}
              </span>
              <div>
                {item.type === 'chapter' && item.chapterNumber ? (
                  <Link href={`/workspace/${workId}/write?chapter=${item.chapterNumber}`}>
                    {item.title}
                  </Link>
                ) : (
                  <strong>{item.title}</strong>
                )}
                <p>{item.snippet}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
