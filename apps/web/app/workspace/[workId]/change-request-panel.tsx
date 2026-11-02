'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CHANGE_RISK_OPTIONS,
  CHANGE_SOURCE_OPTIONS,
  analyzeChange,
  applyChange,
  branchChange,
  cancelChange,
  createChange,
  ignoreFalsePositive,
  loadChanges,
  loadChangeTargets,
  undoChange,
  type ChangeAffected,
  type ChangeCheck,
  type ChangeRequest,
  type ChangeTarget,
} from '../../../lib/changes-api';
import { friendlyError } from '../../../lib/auth-api';
import type { ChangeRisk, ChangeSource, ChangeTargetType } from '@novel/contracts';

type Notice =
  | { status: 'idle' }
  | { status: 'working'; message: string }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type FieldOption = {
  value: string;
  label: string;
};

const FIELD_OPTIONS: Record<ChangeTargetType, FieldOption[]> = {
  entity: [
    { value: 'summary', label: '一句话摘要' },
    { value: 'name', label: '名称' },
    { value: 'description', label: '详细描述' },
    { value: 'status', label: '状态' },
  ],
  faction: [
    { value: 'summary', label: '一句话摘要' },
    { value: 'name', label: '势力名称' },
    { value: 'description', label: '势力详情' },
    { value: 'status', label: '状态' },
  ],
  map: [
    { value: 'summary', label: '地点摘要' },
    { value: 'name', label: '地点名称' },
    { value: 'description', label: '地点详情' },
  ],
  power_item: [
    { value: 'summary', label: '能力或物品摘要' },
    { value: 'name', label: '名称' },
    { value: 'description', label: '规则与限制' },
  ],
  outline: [
    { value: 'chapterGoal', label: '本章目标' },
    { value: 'summary', label: '大纲摘要' },
    { value: 'details', label: '大纲细节' },
    { value: 'pov', label: '叙事视角' },
    { value: 'chapterEndHook', label: '章末钩子' },
  ],
  chapter: [
    { value: 'content', label: '正文内容' },
    { value: 'title', label: '章节标题' },
    { value: 'summary', label: '章节摘要' },
    { value: 'hook', label: '章末钩子' },
  ],
  fact: [{ value: 'statement', label: '已确认内容' }],
  knowledge: [{ value: 'knowledge', label: '人物认知（结构化内容）' }],
  plot_line: [
    { value: 'summary', label: '剧情线摘要' },
    { value: 'name', label: '剧情线名称' },
    { value: 'stakes', label: '赌注' },
    { value: 'status', label: '状态' },
  ],
  timeline: [
    { value: 'summary', label: '事件摘要' },
    { value: 'title', label: '事件名称' },
    { value: 'relativeTime', label: '相对时间' },
  ],
  story_bible: [
    { value: 'oneSentenceStory', label: '一句话故事' },
    { value: 'protagonist', label: '主角' },
    { value: 'worldIronLaw', label: '世界铁律' },
  ],
  work: [
    { value: 'title', label: '书名' },
    { value: 'penName', label: '笔名' },
    { value: 'genrePack', label: '题材' },
    { value: 'scale', label: '规模' },
    { value: 'targetPlatform', label: '目标平台' },
  ],
};

const AFFECTED_GROUPS: Array<{
  key: keyof ChangeAffected;
  label: string;
}> = [
  { key: 'entities', label: '设定条目' },
  { key: 'facts', label: '已确认设定' },
  { key: 'chapters', label: '章节' },
  { key: 'outlines', label: '大纲' },
  { key: 'plotLines', label: '剧情线' },
  { key: 'knowledge', label: '人物认知' },
  { key: 'maps', label: '地图地点' },
  { key: 'factions', label: '势力' },
  { key: 'powerItems', label: '力量与物品' },
  { key: 'timeline', label: '时间线' },
];

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '空';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function upsertChange(items: ChangeRequest[], next: ChangeRequest): ChangeRequest[] {
  const exists = items.some((item) => item.id === next.id);
  return exists ? items.map((item) => (item.id === next.id ? next : item)) : [next, ...items];
}

function statusClass(status: ChangeRequest['status']): string {
  if (status === 'applied') {
    return 'applied';
  }
  if (status === 'branched') {
    return 'branched';
  }
  if (status === 'canceled' || status === 'rejected') {
    return 'settled';
  }
  if (status === 'undone') {
    return 'settled';
  }
  return 'waiting';
}

function checkClass(status: ChangeCheck['status'], ignored: boolean): string {
  if (ignored) {
    return 'ignored';
  }
  if (status === 'conflict') {
    return 'conflict';
  }
  return status === 'warning' ? 'warning' : 'passed';
}

export function ChangeRequestPanel({ workId, branchId }: { workId: string; branchId: string }) {
  const [targets, setTargets] = useState<ChangeTarget[]>([]);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>({ status: 'idle' });
  const [formOpen, setFormOpen] = useState(false);
  const [targetKey, setTargetKey] = useState('');
  const [field, setField] = useState('summary');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<ChangeSource>('author');
  const [risk, setRisk] = useState<ChangeRisk>('medium');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [branchName, setBranchName] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [undoReason, setUndoReason] = useState('');
  const [ignoreCheckId, setIgnoreCheckId] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([loadChangeTargets(workId, branchId), loadChanges(workId, branchId)])
      .then(([targetResult, changeResult]) => {
        if (!active) {
          return;
        }
        setTargets(targetResult.items);
        setChanges(changeResult.items);
        setSelectedId(changeResult.items[0]?.id ?? null);
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

  const selected = changes.find((item) => item.id === selectedId) ?? null;
  const selectedTarget = targets.find((target) => thisTargetKey(target) === targetKey);
  const fields = selectedTarget ? FIELD_OPTIONS[selectedTarget.type] : [];
  const affectedCount = selected
    ? Object.values(selected.impact?.affected ?? {}).reduce(
        (total, items) => total + items.length,
        0,
      )
    : 0;

  const groupedTargets = useMemo(() => {
    const groups = new Map<string, ChangeTarget[]>();
    for (const target of targets) {
      groups.set(target.typeLabel, [...(groups.get(target.typeLabel) ?? []), target]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  }, [targets]);

  function thisTargetKey(target: ChangeTarget): string {
    return `${target.type}::${target.id ?? 'branch'}`;
  }

  function chooseTarget(value: string) {
    setTargetKey(value);
    const target = targets.find((item) => thisTargetKey(item) === value);
    setField(FIELD_OPTIONS[target?.type ?? 'entity'][0]?.value ?? 'summary');
  }

  function updateInList(next: ChangeRequest) {
    setChanges((current) => upsertChange(current, next));
    setSelectedId(next.id);
  }

  async function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTarget || !title.trim() || !reason.trim() || !after.trim()) {
      return;
    }
    setNotice({ status: 'working', message: '正在检查影响范围…' });
    try {
      let beforeValue: Record<string, unknown> = {};
      let afterValue: Record<string, unknown> = {};
      try {
        beforeValue = parseFieldValue(field, before);
        afterValue = parseFieldValue(field, after);
      } catch {
        setNotice({ status: 'error', message: '人物认知需要填写有效的结构化内容。' });
        return;
      }
      const created = await createChange(workId, branchId, {
        title: title.trim(),
        reason: reason.trim(),
        targetType: selectedTarget.type,
        targetId: selectedTarget.id,
        oldValue: beforeValue,
        newValue: afterValue,
        source,
        risk,
      });
      const analyzed = await analyzeChange(workId, branchId, created.id);
      updateInList(analyzed);
      setNotice({ status: 'saved', message: '影响范围已整理完成。' });
      setFormOpen(false);
      setTitle('');
      setReason('');
      setBefore('');
      setAfter('');
      setTargetKey('');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function runApply(mode: 'apply' | 'repair') {
    if (!selected) {
      return;
    }
    setNotice({
      status: 'working',
      message: mode === 'repair' ? '正在应用修复后的修改…' : '正在应用修改…',
    });
    try {
      const next = await applyChange(workId, branchId, selected.id, {
        mode,
        ...(mode === 'repair' ? { repairNotes: repairNotes.trim() } : {}),
      });
      updateInList(next);
      setNotice({ status: 'saved', message: '修改已应用，版本记录已保留。' });
      setRepairNotes('');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function runBranch() {
    if (!selected || !branchName.trim()) {
      return;
    }
    setNotice({ status: 'working', message: '正在创建平行版本…' });
    try {
      const next = await branchChange(workId, branchId, selected.id, branchName.trim());
      updateInList(next);
      setNotice({ status: 'saved', message: '平行版本已创建，主线内容没有被覆盖。' });
      setBranchName('');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function runCancel() {
    if (!selected) {
      return;
    }
    setNotice({ status: 'working', message: '正在取消这次修改…' });
    try {
      const next = await cancelChange(
        workId,
        branchId,
        selected.id,
        cancelReason.trim() || undefined,
      );
      updateInList(next);
      setNotice({ status: 'saved', message: '修改请求已取消。' });
      setCancelReason('');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function runUndo() {
    if (!selected) {
      return;
    }
    setNotice({ status: 'working', message: '正在撤销这次修改…' });
    try {
      const next = await undoChange(workId, branchId, selected.id, undoReason.trim() || undefined);
      updateInList(next);
      setNotice({ status: 'saved', message: '修改已撤销，撤销记录已保留。' });
      setUndoReason('');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function submitFalsePositive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !ignoreCheckId || !ignoreReason.trim()) {
      return;
    }
    setNotice({ status: 'working', message: '正在记录误报原因…' });
    try {
      const next = await ignoreFalsePositive(
        workId,
        branchId,
        selected.id,
        ignoreCheckId,
        ignoreReason.trim(),
      );
      updateInList(next);
      setSelectedId(next.id);
      setNotice({ status: 'saved', message: '误报已忽略，影响范围已重新整理。' });
      setIgnoreCheckId(null);
      setIgnoreReason('');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  return (
    <section className="change-center" aria-labelledby="change-center-title">
      <div className="change-center-heading">
        <div>
          <p className="workspace-step">先看影响，再做决定</p>
          <h2 id="change-center-title">修改请求</h2>
          <p>
            每次修改都先整理差异、原因和影响范围。安全修改可以直接应用，影响已写内容的修改会先提醒你处理。
          </p>
        </div>
        <div className="change-center-summary">
          <strong>{changes.length}</strong>
          <span>条修改记录</span>
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

      <div className="change-action-row">
        <button
          className="primary-button"
          onClick={() => setFormOpen((current) => !current)}
          type="button"
        >
          {formOpen ? '收起表单' : '发起修改请求'}
        </button>
        <span>修改在确认前不会写入故事内容。</span>
      </div>

      {formOpen ? (
        <form className="change-form" onSubmit={submitChange}>
          <div className="change-form-grid">
            <label className="field change-form-wide">
              <span>修改对象</span>
              <select
                onChange={(event) => chooseTarget(event.currentTarget.value)}
                required
                value={targetKey}
              >
                <option value="">选择要修改的内容</option>
                {groupedTargets.map(([label, options]) => (
                  <optgroup key={label} label={label}>
                    {options.map((target) => (
                      <option key={thisTargetKey(target)} value={thisTargetKey(target)}>
                        {target.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              <span>修改字段</span>
              <select
                disabled={!selectedTarget}
                onChange={(event) => setField(event.currentTarget.value)}
                value={field}
              >
                {fields.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>来源</span>
              <select
                onChange={(event) => setSource(event.currentTarget.value as ChangeSource)}
                value={source}
              >
                {CHANGE_SOURCE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field change-form-wide">
              <span>标题</span>
              <input
                maxLength={200}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="用一句话说明这次想改什么"
                required
                value={title}
              />
            </label>
            <label className="field change-form-wide">
              <span>修改原因</span>
              <textarea
                maxLength={2_000}
                onChange={(event) => setReason(event.currentTarget.value)}
                placeholder="为什么必须改，以及你希望解决什么问题"
                required
                rows={3}
                value={reason}
              />
            </label>
            <label className="field">
              <span>风险判断</span>
              <select
                onChange={(event) => setRisk(event.currentTarget.value as ChangeRisk)}
                value={risk}
              >
                {CHANGE_RISK_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field change-form-wide">
              <span>修改前</span>
              <textarea
                onChange={(event) => setBefore(event.currentTarget.value)}
                placeholder="可以留空；填写后会显示在差异里"
                rows={4}
                value={before}
              />
            </label>
            <label className="field change-form-wide">
              <span>修改后</span>
              <textarea
                onChange={(event) => setAfter(event.currentTarget.value)}
                required
                rows={4}
                value={after}
              />
            </label>
          </div>
          <div className="change-form-actions">
            <button className="primary-button" disabled={notice.status === 'working'} type="submit">
              {notice.status === 'working' ? '正在检查…' : '整理差异与影响'}
            </button>
            <button className="text-button" onClick={() => setFormOpen(false)} type="button">
              暂不提交
            </button>
          </div>
        </form>
      ) : null}

      <div className="change-layout">
        <aside className="change-list" aria-label="修改记录列表">
          {changes.length === 0 ? (
            <p className="change-empty">还没有修改记录。</p>
          ) : (
            changes.map((change) => (
              <button
                aria-current={selectedId === change.id ? 'true' : undefined}
                className={
                  selectedId === change.id ? 'change-list-item active' : 'change-list-item'
                }
                key={change.id}
                onClick={() => setSelectedId(change.id)}
                type="button"
              >
                <span className={`change-status ${statusClass(change.status)}`}>
                  {change.statusLabel}
                </span>
                <strong>{change.title}</strong>
                <span>{change.targetLabel}</span>
                <small>
                  {change.riskLabel} · {change.sourceLabel}
                </small>
              </button>
            ))
          )}
        </aside>

        <div className="change-detail">
          {!selected ? (
            <div className="change-empty">
              <h3>选择一条修改记录</h3>
              <p>这里会显示差异、原因、影响范围和六项检查结果。</p>
            </div>
          ) : (
            <>
              <div className="change-detail-heading">
                <div>
                  <p className="workspace-step">
                    {selected.targetTypeLabel} · {selected.riskLabel}
                  </p>
                  <h3>{selected.title}</h3>
                  <p>{selected.reason}</p>
                </div>
                <span className={`change-status ${statusClass(selected.status)}`}>
                  {selected.statusLabel}
                </span>
              </div>

              <dl className="change-meta">
                <div>
                  <dt>修改对象</dt>
                  <dd>{selected.targetLabel}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>{selected.sourceLabel}</dd>
                </div>
                <div>
                  <dt>最近更新</dt>
                  <dd>{new Date(selected.updatedAt).toLocaleString('zh-CN')}</dd>
                </div>
              </dl>

              <section className="change-diff" aria-labelledby="change-diff-title">
                <h4 id="change-diff-title">差异</h4>
                {selected.diff.map((entry) => (
                  <div className="change-diff-row" key={entry.field}>
                    <strong>{entry.field}</strong>
                    <div>
                      <span>修改前</span>
                      <pre>{displayValue(entry.before)}</pre>
                    </div>
                    <div>
                      <span>修改后</span>
                      <pre>{displayValue(entry.after)}</pre>
                    </div>
                  </div>
                ))}
              </section>

              {selected.impact ? (
                <>
                  <section
                    className={`change-impact-summary ${selected.impact.classification}`}
                    aria-labelledby="change-impact-title"
                  >
                    <div>
                      <p className="workspace-step">影响范围</p>
                      <h4 id="change-impact-title">{selected.impact.classificationLabel}</h4>
                      <p>{selected.impact.summary}</p>
                    </div>
                    <div className="change-confidence">
                      <strong>{Math.round(selected.impact.confidence * 100)}%</strong>
                      <span>判断可信度</span>
                    </div>
                  </section>

                  {affectedCount > 0 ? (
                    <section className="change-affected" aria-labelledby="change-affected-title">
                      <h4 id="change-affected-title">受影响内容</h4>
                      <div className="change-affected-grid">
                        {AFFECTED_GROUPS.map((group) => {
                          const items = selected.impact?.affected[group.key] ?? [];
                          if (items.length === 0) {
                            return null;
                          }
                          return (
                            <article key={group.key}>
                              <h5>
                                {group.label} <span>{items.length}</span>
                              </h5>
                              <ul>
                                {items.map((item) => (
                                  <li key={item.id}>
                                    <strong>{item.title}</strong>
                                    <span>{item.detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ) : (
                    <p className="change-empty">没有其他内容受到影响。</p>
                  )}

                  <section className="change-checks" aria-labelledby="change-checks-title">
                    <h4 id="change-checks-title">六项检查</h4>
                    <div className="change-check-list">
                      {selected.impact.checks.map((check) => (
                        <article
                          className={`change-check ${checkClass(check.status, check.ignored)}`}
                          key={check.id}
                        >
                          <div className="change-check-heading">
                            <strong>{check.label}</strong>
                            <span>{check.ignored ? '误报已忽略' : check.statusLabel}</span>
                          </div>
                          <p>{check.summary}</p>
                          {check.status !== 'passed' && !check.ignored ? (
                            <>
                              <small>{check.suggestion}</small>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setIgnoreCheckId(check.id);
                                  setIgnoreReason('');
                                }}
                                type="button"
                              >
                                忽略这条误报
                              </button>
                            </>
                          ) : null}
                          {check.ignored ? <small>原因：{check.ignoredReason}</small> : null}
                          {ignoreCheckId === check.id ? (
                            <form className="change-ignore-form" onSubmit={submitFalsePositive}>
                              <label className="field">
                                <span>为什么这是误报</span>
                                <textarea
                                  onChange={(event) => setIgnoreReason(event.currentTarget.value)}
                                  required
                                  rows={2}
                                  value={ignoreReason}
                                />
                              </label>
                              <div className="change-form-actions">
                                <button className="secondary-button" type="submit">
                                  记录原因并忽略
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() => setIgnoreCheckId(null)}
                                  type="button"
                                >
                                  返回
                                </button>
                              </div>
                            </form>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <p className="change-empty">还没有完成影响分析。</p>
              )}

              {selected.status === 'waiting_confirmation' &&
              selected.impact?.classification === 'safe' ? (
                <section className="change-decision" aria-labelledby="change-decision-title">
                  <h4 id="change-decision-title">应用修改</h4>
                  <p>这次修改没有影响其他内容，确认后会把新版本写入故事。</p>
                  <div className="change-form-actions">
                    <button
                      className="primary-button"
                      disabled={notice.status === 'working'}
                      onClick={() => void runApply('apply')}
                      type="button"
                    >
                      应用这次修改
                    </button>
                  </div>
                </section>
              ) : null}

              {selected.status === 'waiting_confirmation' &&
              selected.impact?.classification === 'repairable' ? (
                <section className="change-decision repair" aria-labelledby="change-repair-title">
                  <h4 id="change-repair-title">修复后应用</h4>
                  <p>
                    先处理受影响的章节或设定，再写下你如何修复。确认后会应用这次修改并保留记录。
                  </p>
                  <label className="field">
                    <span>修复说明</span>
                    <textarea
                      onChange={(event) => setRepairNotes(event.currentTarget.value)}
                      placeholder="例如：已核对第 3 章，正文与新的伤势一致。"
                      rows={3}
                      value={repairNotes}
                    />
                  </label>
                  <div className="change-form-actions">
                    <button
                      className="primary-button"
                      disabled={!repairNotes.trim() || notice.status === 'working'}
                      onClick={() => void runApply('repair')}
                      type="button"
                    >
                      修复并应用
                    </button>
                  </div>
                </section>
              ) : null}

              {selected.status === 'waiting_confirmation' &&
              selected.impact?.classification === 'structural' ? (
                <section
                  className="change-decision structural"
                  aria-labelledby="change-branch-title"
                >
                  <h4 id="change-branch-title">另开平行版本</h4>
                  <p>
                    这次修改会影响已经写定或锁定的内容。新建一条平行版本继续尝试，主线不会被覆盖。
                  </p>
                  <label className="field">
                    <span>平行版本名称</span>
                    <input
                      maxLength={120}
                      onChange={(event) => setBranchName(event.currentTarget.value)}
                      placeholder="例如：断碑修正版"
                      value={branchName}
                    />
                  </label>
                  <div className="change-form-actions">
                    <button
                      className="primary-button"
                      disabled={!branchName.trim() || notice.status === 'working'}
                      onClick={() => void runBranch()}
                      type="button"
                    >
                      创建平行版本
                    </button>
                  </div>
                </section>
              ) : null}

              {selected.status === 'applied' ? (
                <section className="change-decision undo" aria-labelledby="change-undo-title">
                  <h4 id="change-undo-title">撤销这次修改</h4>
                  <p>撤销会恢复修改前的内容，同时把这次撤销保存为新的版本记录。</p>
                  <label className="field">
                    <span>撤销原因（可选）</span>
                    <textarea
                      maxLength={2_000}
                      onChange={(event) => setUndoReason(event.currentTarget.value)}
                      placeholder="例如：先保留原来的写法。"
                      rows={2}
                      value={undoReason}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={notice.status === 'working'}
                    onClick={() => void runUndo()}
                    type="button"
                  >
                    撤销这次修改
                  </button>
                </section>
              ) : null}

              {['draft', 'waiting_confirmation', 'failed'].includes(selected.status) ? (
                <section className="change-cancel" aria-labelledby="change-cancel-title">
                  <h4 id="change-cancel-title">取消这次修改</h4>
                  <label className="field">
                    <span>取消原因（可选）</span>
                    <input
                      maxLength={2_000}
                      onChange={(event) => setCancelReason(event.currentTarget.value)}
                      placeholder="记录为什么暂时不改"
                      value={cancelReason}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={notice.status === 'working'}
                    onClick={() => void runCancel()}
                    type="button"
                  >
                    取消修改
                  </button>
                </section>
              ) : null}

              {selected.decisionReason ? (
                <p className="change-decision-note">处理记录：{selected.decisionReason}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function parseFieldValue(field: string, value: string): Record<string, unknown> {
  if (field === 'knowledge') {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error('Knowledge must be an array');
    }
    return { knowledge: parsed };
  }
  return { [field]: value };
}
