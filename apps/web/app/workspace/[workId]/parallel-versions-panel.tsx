'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ParallelVersionKind } from '@novel/contracts';
import { friendlyError } from '../../../lib/auth-api';
import {
  PARALLEL_VERSION_KIND_LABELS,
  cherryPickParallelVersion,
  compareParallelVersion,
  createParallelVersion,
  loadBranches,
  loadVersionPoints,
  type CompareItem,
  type CompareResult,
  type ParallelVersion,
  type VersionPoint,
} from '../../../lib/branches-api';

type Notice =
  | { status: 'idle' }
  | { status: 'working'; message: string }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type PickKey = `chapter:${string}` | `setting:${string}` | `outline:${string}`;

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '空';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join('、') : '空';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function statusLabel(item: CompareItem): string {
  if (item.conflict) {
    return '两边都改过';
  }
  if (item.status === 'changed') {
    return '有差异';
  }
  if (item.status === 'only_compared') {
    return '只在平行版本中';
  }
  if (item.status === 'only_source') {
    return '只在主线中';
  }
  return '一致';
}

export function ParallelVersionsPanel({ workId, branchId }: { workId: string; branchId: string }) {
  const [branches, setBranches] = useState<ParallelVersion[]>([]);
  const [versionPoints, setVersionPoints] = useState<VersionPoint[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<PickKey>>(new Set());
  const [notice, setNotice] = useState<Notice>({ status: 'idle' });
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<ParallelVersionKind>('alternate_ending');
  const [versionPointId, setVersionPointId] = useState('current');

  useEffect(() => {
    let active = true;
    Promise.all([loadBranches(workId), loadVersionPoints(workId, branchId)])
      .then(([branchResult, pointResult]) => {
        if (!active) {
          return;
        }
        setBranches(branchResult.items);
        setVersionPoints(pointResult.items);
        const firstParallel = branchResult.items.find((item) => !item.isMain);
        if (firstParallel) {
          setSelectedBranchId(firstParallel.id);
          void openComparison(firstParallel.id);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setNotice({ status: 'error', message: friendlyError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, workId]);

  const parallelVersions = useMemo(() => branches.filter((branch) => !branch.isMain), [branches]);
  const selectedBranch = parallelVersions.find((branch) => branch.id === selectedBranchId) ?? null;
  const selectedCount = selectedItems.size;

  async function openComparison(parallelBranchId: string, showNotice = true) {
    setSelectedBranchId(parallelBranchId);
    setSelectedItems(new Set());
    setComparison(null);
    if (showNotice) {
      setNotice({ status: 'working', message: '正在整理并排内容…' });
    }
    try {
      const result = await compareParallelVersion(workId, branchId, parallelBranchId);
      setComparison(result);
      if (showNotice) {
        setNotice({ status: 'idle' });
      }
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !reason.trim()) {
      return;
    }
    setNotice({ status: 'working', message: '正在创建平行版本…' });
    try {
      const created = await createParallelVersion(workId, {
        sourceBranchId: branchId,
        versionPointId,
        name: name.trim(),
        reason: reason.trim(),
        kind,
      });
      setBranches((current) => [...current, created]);
      setName('');
      setReason('');
      setVersionPointId('current');
      await openComparison(created.id, false);
      setNotice({ status: 'saved', message: '平行版本已创建' });
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function submitPickup() {
    if (!selectedBranch || selectedItems.size === 0) {
      return;
    }
    setNotice({ status: 'working', message: '正在把选中内容带回主线…' });
    try {
      const items = [...selectedItems].map((value) => {
        const [type, id] = value.split(':') as ['chapter' | 'setting' | 'outline', string];
        return { type, id };
      });
      const result = await cherryPickParallelVersion(workId, selectedBranch.id, branchId, items);
      const parts = [
        result.summary.applied > 0 ? `${result.summary.applied} 项已写入主线` : '',
        result.summary.pending > 0 ? `${result.summary.pending} 项等待确认` : '',
        result.summary.skipped > 0 ? `${result.summary.skipped} 项未处理` : '',
      ].filter(Boolean);
      setSelectedItems(new Set());
      await openComparison(selectedBranch.id, false);
      setNotice({ status: 'saved', message: parts.join('，') });
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  function toggleItem(key: PickKey) {
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <section className="parallel-versions" aria-labelledby="parallel-versions-title">
      <div className="parallel-versions-heading">
        <div>
          <p className="workspace-step">从已保存版本再出发</p>
          <h2 id="parallel-versions-title">平行版本</h2>
          <p>从任意已保存版本点分出独立创作线，比较后再选择要带回主线的内容。</p>
        </div>
        <div className="parallel-versions-count">
          <strong>{parallelVersions.length}</strong>
          <span>个平行版本</span>
        </div>
      </div>

      {notice.status === 'saved' || notice.status === 'working' ? (
        <p className="form-message form-message-success" role="status">
          {notice.message}
        </p>
      ) : null}
      {notice.status === 'error' ? (
        <p className="form-message form-message-error" role="alert">
          {notice.message}
        </p>
      ) : null}

      <form className="parallel-version-form" onSubmit={submitCreate}>
        <label className="field">
          <span>平行版本名称</span>
          <input
            maxLength={120}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例如：母亲回音的另一版"
            required
            value={name}
          />
        </label>
        <label className="field">
          <span>分叉版本点</span>
          <select
            onChange={(event) => setVersionPointId(event.currentTarget.value)}
            value={versionPointId}
          >
            {versionPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>版本类型</span>
          <select
            onChange={(event) => setKind(event.currentTarget.value as ParallelVersionKind)}
            value={kind}
          >
            {Object.entries(PARALLEL_VERSION_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field parallel-version-reason">
          <span>创建原因</span>
          <textarea
            maxLength={2_000}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="为什么需要另开一条创作线"
            required
            rows={2}
            value={reason}
          />
        </label>
        <button
          className="primary-button parallel-version-submit"
          disabled={!name.trim() || !reason.trim() || notice.status === 'working'}
          type="submit"
        >
          创建平行版本
        </button>
      </form>

      <div className="parallel-version-list" aria-label="平行版本列表">
        {parallelVersions.length === 0 ? (
          <p className="change-empty">还没有平行版本。选择版本点后即可开始。</p>
        ) : (
          parallelVersions.map((branch) => (
            <button
              aria-current={selectedBranchId === branch.id ? 'true' : undefined}
              className={
                selectedBranchId === branch.id
                  ? 'parallel-version-card active'
                  : 'parallel-version-card'
              }
              key={branch.id}
              onClick={() => void openComparison(branch.id)}
              type="button"
            >
              <span className="parallel-version-status">{branch.statusLabel}</span>
              <strong>{branch.name}</strong>
              <span>{branch.kindLabel}</span>
              <small>
                来源 {branch.parentBranchName ?? '主线'} · {branch.forkPoint.label}
              </small>
            </button>
          ))
        )}
      </div>

      {selectedBranch ? (
        <section className="parallel-compare" aria-label="并排比较">
          <div className="parallel-compare-heading">
            <div>
              <p className="workspace-step">
                {selectedBranch.kindLabel} · {selectedBranch.forkPoint.label}
              </p>
              <h3>{selectedBranch.name}</h3>
              <p>{selectedBranch.reason}</p>
            </div>
            {comparison ? (
              <dl className="parallel-compare-summary">
                <div>
                  <dt>设定差异</dt>
                  <dd>{comparison.summary.settingsChanged}</dd>
                </div>
                <div>
                  <dt>大纲差异</dt>
                  <dd>{comparison.summary.outlinesChanged}</dd>
                </div>
                <div>
                  <dt>正文差异</dt>
                  <dd>{comparison.summary.chaptersChanged}</dd>
                </div>
                <div>
                  <dt>事实差异</dt>
                  <dd>{comparison.summary.factsChanged}</dd>
                </div>
                <div>
                  <dt>人物与地图</dt>
                  <dd>{comparison.summary.charactersChanged + comparison.summary.mapsChanged}</dd>
                </div>
                <div>
                  <dt>两边都改</dt>
                  <dd>{comparison.summary.conflicts}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          {comparison ? (
            <>
              <CompareGroup
                title="设定"
                type="setting"
                items={comparison.settings}
                selectedItems={selectedItems}
                onToggle={toggleItem}
              />
              <CompareGroup
                title="大纲"
                type="outline"
                items={comparison.outlines}
                selectedItems={selectedItems}
                onToggle={toggleItem}
              />
              <CompareGroup
                title="正文"
                type="chapter"
                items={comparison.chapters}
                selectedItems={selectedItems}
                onToggle={toggleItem}
              />
              <CompareGroup
                title="已确认事实"
                type="setting"
                items={comparison.facts}
                selectable={false}
                selectedItems={selectedItems}
                onToggle={toggleItem}
              />
              <CompareGroup
                title="人物状态"
                type="setting"
                items={comparison.characters}
                selectable={false}
                selectedItems={selectedItems}
                onToggle={toggleItem}
              />
              <CompareGroup
                title="地图地点"
                type="setting"
                items={comparison.maps}
                selectable={false}
                selectedItems={selectedItems}
                onToggle={toggleItem}
              />
              <div className="parallel-pickup-actions">
                <button
                  className="primary-button"
                  disabled={selectedCount === 0 || notice.status === 'working'}
                  onClick={() => void submitPickup()}
                  type="button"
                >
                  摘取选中内容到主线
                </button>
                <span>只处理勾选内容</span>
              </div>
            </>
          ) : (
            <p className="change-empty">正在整理并排内容…</p>
          )}
        </section>
      ) : null}
    </section>
  );
}

function CompareGroup({
  title,
  type,
  items,
  selectable = true,
  selectedItems,
  onToggle,
}: {
  title: string;
  type: 'setting' | 'outline' | 'chapter';
  items: CompareItem[];
  selectable?: boolean;
  selectedItems: Set<PickKey>;
  onToggle: (key: PickKey) => void;
}) {
  return (
    <div className="parallel-compare-group">
      <div className="parallel-compare-group-heading">
        <h4>{title}</h4>
        <span>{items.filter((item) => item.status !== 'same').length} 处差异</span>
      </div>
      {items.length === 0 ? (
        <p className="parallel-compare-empty">这一类还没有内容。</p>
      ) : (
        <div className="parallel-compare-items">
          {items.map((item) => {
            const key = `${type}:${item.comparedId ?? item.id}` as PickKey;
            const canPick = selectable && Boolean(item.comparedId) && item.status !== 'same';
            return (
              <article
                className={
                  item.conflict ? 'parallel-compare-item conflict' : 'parallel-compare-item'
                }
                key={`${type}:${item.id}`}
              >
                <div className="parallel-compare-item-heading">
                  <div>
                    <strong>{item.label}</strong>
                    <span>{statusLabel(item)}</span>
                  </div>
                  {canPick ? (
                    <label className="parallel-pickup-check">
                      <input
                        checked={selectedItems.has(key)}
                        onChange={() => onToggle(key)}
                        type="checkbox"
                      />
                      摘取{type === 'setting' ? '设定：' : ''}
                      {item.label}
                    </label>
                  ) : null}
                </div>
                {item.fields.map((field) => (
                  <div className="parallel-field-row" key={field.field}>
                    <strong>{field.label}</strong>
                    <div>
                      <span>主线</span>
                      <p>{displayValue(field.before)}</p>
                    </div>
                    <div>
                      <span>平行版本</span>
                      <p>{displayValue(field.after)}</p>
                    </div>
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
