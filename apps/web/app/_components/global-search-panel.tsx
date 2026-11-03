'use client';

import { ENTITY_TYPE_LABELS, type WorkSearchItem } from '@novel/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/auth-api';
import { searchWork } from '../../lib/search-api';
import { type Work, type WorkListResponse } from '../../lib/works-api';

type SearchGroup = {
  key: string;
  label: string;
  items: Array<{
    id: string;
    title: string;
    snippet: string;
    href: string;
  }>;
};

const GROUP_ORDER = [
  'work',
  'character',
  'faction',
  'map',
  'world',
  'power_system',
  'item_technique',
  'timeline',
  'outline',
  'chapter',
  'fact',
];

const GROUP_LABELS: Record<string, string> = {
  work: '作品',
  outline: '大纲',
  chapter: '章节正文',
  fact: '已确认设定',
  ...ENTITY_TYPE_LABELS,
};

export function GlobalSearchPanel({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const workId = pathname.match(/^\/workspace\/([0-9a-f-]{36})/)?.[1];
  const [query, setQuery] = useState('');
  const [work, setWork] = useState<Work | null>(null);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!workId) {
      setWork(null);
      return;
    }
    let active = true;
    apiRequest<Work>(`/api/v1/works/${workId}`)
      .then((loaded) => {
        if (active) {
          setWork(loaded);
        }
      })
      .catch(() => {
        if (active) {
          setWork(null);
        }
      });
    return () => {
      active = false;
    };
  }, [workId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups([]);
      setStatus('idle');
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setStatus('loading');
      const workPromise = apiRequest<WorkListResponse>(
        `/api/v1/works?view=active&search=${encodeURIComponent(trimmed)}`,
      );
      const branchPromise =
        workId && work?.mainBranch
          ? searchWork(workId, work.mainBranch.id, trimmed, 40)
          : Promise.resolve(null);
      Promise.all([workPromise, branchPromise])
        .then(([workResults, branchResults]) => {
          if (!active) {
            return;
          }
          const items = new Map<string, SearchGroup>();
          for (const result of workResults.items.slice(0, 6)) {
            addItem(items, 'work', {
              id: result.id,
              title: result.title,
              snippet: `${result.penName} · ${result.statusLabel} · ${result.genrePackLabel}`,
              href: `/workspace/${result.id}`,
            });
          }
          if (workId) {
            for (const item of branchResults?.items ?? []) {
              addItem(items, groupKey(item), toSearchLink(item, workId));
            }
          }
          setGroups(
            [...items.values()].sort(
              (left, right) =>
                GROUP_ORDER.indexOf(left.key) - GROUP_ORDER.indexOf(right.key),
            ),
          );
          setStatus('ready');
        })
        .catch(() => {
          if (active) {
            setGroups([]);
            setStatus('error');
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, work?.mainBranch, workId]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section aria-label="全局搜索" className="app-popover app-search-panel" role="dialog">
      <label className="app-search-field">
        <span>全局搜索</span>
        <input
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索作品、人物、势力、地图、大纲、正文或已确认设定"
          type="search"
          value={query}
        />
      </label>
      {!workId ? (
        <p className="app-popover-hint">当前不在作品内，先显示作品搜索结果。</p>
      ) : null}
      {status === 'loading' ? <p className="app-popover-empty">正在搜索…</p> : null}
      {status === 'error' ? (
        <p className="app-popover-empty">搜索暂时失败，请稍后再试。</p>
      ) : null}
      {status === 'ready' && total === 0 ? (
        <p className="app-popover-empty">没有找到匹配内容。</p>
      ) : null}
      <div className="app-search-results">
        {groups.map((group) => (
          <div className="app-search-group" key={group.key}>
            <p className="app-search-group-title">
              {group.label}
              <span>{group.items.length}</span>
            </p>
            {group.items.map((item) => (
              <Link href={item.href} key={`${group.key}-${item.id}`} onClick={onClose}>
                <strong>
                  <Highlight query={query} text={item.title} />
                </strong>
                <small>
                  <Highlight query={query} text={item.snippet} />
                </small>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function addItem(
  groups: Map<string, SearchGroup>,
  key: string,
  item: SearchGroup['items'][number],
) {
  const group = groups.get(key) ?? {
    key,
    label: GROUP_LABELS[key] ?? key,
    items: [],
  };
  group.items.push(item);
  groups.set(key, group);
}

function groupKey(item: WorkSearchItem): string {
  if (item.type === 'setting') {
    return item.entityType ?? 'setting';
  }
  return item.type;
}

function toSearchLink(item: WorkSearchItem, workId: string): SearchGroup['items'][number] {
  if (item.type === 'chapter') {
    return {
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      href: `/workspace/${workId}/write?chapter=${item.chapterNumber ?? 1}`,
    };
  }
  if (item.type === 'outline') {
    return {
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      href: `/workspace/${workId}/outline`,
    };
  }
  if (item.type === 'fact') {
    return {
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      href: `/workspace/${workId}/settings?tab=confirmed`,
    };
  }
  return {
    id: item.id,
    title: item.title,
    snippet: item.snippet,
    href: `/workspace/${workId}/settings?tab=${settingsTab(item.entityType)}&entity=${item.id}`,
  };
}

function settingsTab(entityType?: string): string {
  if (entityType === 'character') {
    return 'character';
  }
  if (entityType === 'faction') {
    return 'faction';
  }
  if (entityType === 'map') {
    return 'map';
  }
  if (entityType === 'power_system') {
    return 'power';
  }
  if (entityType === 'item_technique') {
    return 'item';
  }
  if (entityType === 'timeline') {
    return 'timeline';
  }
  return 'world';
}

function Highlight({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) {
    return <>{text}</>;
  }
  const index = text.toLocaleLowerCase('zh-CN').indexOf(trimmed.toLocaleLowerCase('zh-CN'));
  if (index < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + trimmed.length)}</mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}
