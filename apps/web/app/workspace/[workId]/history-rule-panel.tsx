'use client';

import { useState, type FormEvent } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import {
  runHistoryChecks,
  type HistoryCheckResult,
  type HistoryCheckStatus,
} from '../../../lib/history-api';
import type { Entity } from '../../../lib/entities-api';
import type { MapOverview } from '../../../lib/maps-api';

const STATUS_LABELS: Record<HistoryCheckStatus, string> = {
  passed: '通过',
  needs_attention: '需确认',
  not_applicable: '暂无资料',
};

export function HistoryRulePanel({
  workId,
  branchId,
  entities,
  mapOverview,
}: {
  workId: string;
  branchId: string;
  entities: Entity[];
  mapOverview: MapOverview;
}) {
  const armies = entities.filter((entity) => entity.subtype === 'military');
  const [text, setText] = useState('');
  const [armyEntityId, setArmyEntityId] = useState('');
  const [fromNodeId, setFromNodeId] = useState('');
  const [toNodeId, setToNodeId] = useState('');
  const [plannedDays, setPlannedDays] = useState('3');
  const [result, setResult] = useState<HistoryCheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setError('');
    try {
      const days = Number(plannedDays);
      const movementReady =
        armyEntityId &&
        fromNodeId &&
        toNodeId &&
        Number.isInteger(days) &&
        days > 0;
      const checked = await runHistoryChecks(workId, branchId, {
        text,
        ...(movementReady
          ? {
              armyMovement: {
                armyEntityId,
                fromNodeId,
                toNodeId,
                plannedDays: days,
              },
            }
          : {}),
      });
      setResult(checked);
    } catch (checkError) {
      setError(friendlyError(checkError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="history-check-board" aria-labelledby="history-check-title">
      <div className="history-check-heading">
        <div>
          <p className="workspace-step">架空古代 · 规则核验</p>
          <h2 id="history-check-title">历史规则检查</h2>
          <p>核对时代错置、官制层级、军队调动、粮草和地理距离，结果只作修改提示。</p>
        </div>
        <span>{result ? `${result.issues.length} 个问题` : '等待检查'}</span>
      </div>

      <form className="history-check-form" onSubmit={check}>
        <label className="field history-check-passage">
          <span>试写片段</span>
          <textarea
            aria-label="试写片段"
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="粘贴一段正文，检查是否出现不属于架空古代的事物或制度。"
            rows={4}
            value={text}
          />
        </label>
        <div className="history-check-grid">
          <label className="field">
            <span>调动军队</span>
            <select
              aria-label="调动军队"
              onChange={(event) => setArmyEntityId(event.currentTarget.value)}
              value={armyEntityId}
            >
              <option value="">暂不检查军队</option>
              {armies.map((army) => (
                <option key={army.id} value={army.id}>
                  {army.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>出发地</span>
            <select
              aria-label="出发地"
              onChange={(event) => setFromNodeId(event.currentTarget.value)}
              value={fromNodeId}
            >
              <option value="">选择出发地</option>
              {mapOverview.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>目的地</span>
            <select
              aria-label="目的地"
              onChange={(event) => setToNodeId(event.currentTarget.value)}
              value={toNodeId}
            >
              <option value="">选择目的地</option>
              {mapOverview.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>计划行军天数</span>
            <input
              aria-label="计划行军天数"
              min={1}
              onChange={(event) => setPlannedDays(event.currentTarget.value)}
              type="number"
              value={plannedDays}
            />
          </label>
        </div>
        <button className="primary-button" disabled={running} type="submit">
          {running ? '正在检查…' : '开始检查'}
        </button>
        {error ? (
          <p className="form-message form-message-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {result ? (
        <div className="history-check-results">
          <div className="history-check-summary" aria-label="检查结果">
            {result.checks.map((item) => (
              <article
                className={`history-check-item history-check-${item.status}`}
                key={item.key}
              >
                <div>
                  <h3>{item.label}</h3>
                  <span>{STATUS_LABELS[item.status]}</span>
                </div>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>

          {result.issues.length > 0 ? (
            <ol className="history-issue-list">
              {result.issues.map((issue, index) => (
                <li key={`${issue.category}-${index}`}>
                  <strong>{issue.message}</strong>
                  <span>{issue.suggestion}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="history-check-clear">本次检查没有发现需要修改的地方。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
