'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import {
  exportAudit,
  loadVersionGraph,
  rollbackVersion,
  searchAudit,
  type AuditItem,
  type GraphNode,
  type VersionGraph,
} from '../../../lib/versions-api';

type Notice =
  | { status: 'idle' }
  | { status: 'working'; message: string }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type PositionedNode = {
  node: GraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

const KIND_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  branch: { fill: '#f4efe3', stroke: '#b7aa91', text: '#5d5343' },
  chapter_version: { fill: '#eef7ef', stroke: '#8db49a', text: '#27533a' },
  edit: { fill: '#eef3f8', stroke: '#93a8ba', text: '#334e63' },
  change: { fill: '#f8f1e7', stroke: '#c3a87e', text: '#664c2c' },
  undo: { fill: '#f8eef0', stroke: '#c79aa3', text: '#713b48' },
  rollback: { fill: '#f5ebf2', stroke: '#b28eaa', text: '#613b58' },
  merge: { fill: '#edf5f4', stroke: '#84aaa5', text: '#285e58' },
};

function shortTitle(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function VersionHistoryPanel({ workId, branchId }: { workId: string; branchId: string }) {
  const [graph, setGraph] = useState<VersionGraph | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState<GraphNode | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');
  const [notice, setNotice] = useState<Notice>({ status: 'idle' });

  useEffect(() => {
    let active = true;
    Promise.all([loadVersionGraph(workId, branchId), searchAudit(workId, branchId, '')])
      .then(([graphResult, auditResult]) => {
        if (!active) {
          return;
        }
        setGraph(graphResult);
        setAudit(auditResult.items);
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

  const versions = useMemo(
    () =>
      (graph?.nodes ?? [])
        .filter((node): node is GraphNode & { type: 'version' } => node.type === 'version')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [graph],
  );

  const layout = useMemo(() => {
    if (!graph) {
      return null;
    }
    const branchIndex = new Map(graph.branches.map((branch, index) => [branch.id, index]));
    const ordered = [...graph.nodes].sort((left, right) => {
      const time = left.createdAt.localeCompare(right.createdAt);
      if (time !== 0) {
        return time;
      }
      return left.type === 'branch' ? -1 : 1;
    });
    const positions = new Map<string, PositionedNode>();
    ordered.forEach((node, index) => {
      const lane = branchIndex.get(node.branchId) ?? 0;
      positions.set(node.id, {
        node,
        x: 56 + index * 132,
        y: 58 + lane * 82,
        width: node.type === 'branch' ? 108 : 116,
        height: node.type === 'branch' ? 42 : 48,
      });
    });
    return {
      width: Math.max(760, 120 + ordered.length * 132),
      height: Math.max(230, 92 + graph.branches.length * 82),
      positions,
    };
  }, [graph]);

  async function refreshAudit(nextQuery = appliedQuery) {
    const result = await searchAudit(workId, branchId, nextQuery);
    setAudit(result.items);
    setAppliedQuery(nextQuery);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice({ status: 'working', message: '正在查找操作记录…' });
    try {
      await refreshAudit(query.trim());
      setNotice({ status: 'idle' });
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function submitRollback() {
    if (!rollbackTarget || !rollbackReason.trim()) {
      return;
    }
    setNotice({ status: 'working', message: '正在回到这个版本…' });
    try {
      const result = await rollbackVersion(
        workId,
        branchId,
        rollbackTarget.id,
        rollbackReason.trim(),
      );
      setGraph(result.graph);
      setRollbackTarget(null);
      setRollbackReason('');
      await refreshAudit('');
      setNotice({ status: 'saved', message: '已回到这个版本，并保留了新的回滚记录。' });
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function downloadAudit() {
    setNotice({ status: 'working', message: '正在整理操作记录…' });
    try {
      await exportAudit(workId, branchId, appliedQuery);
      setNotice({ status: 'saved', message: '操作记录已导出。' });
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  return (
    <section className="version-history" aria-labelledby="version-history-title">
      <div className="version-history-heading">
        <div>
          <p className="workspace-step">每一步都可追溯</p>
          <h2 id="version-history-title">版本图</h2>
          <p>查看正文、设定和大纲的修改轨迹；回到任一版本都会生成一条新的回滚记录。</p>
        </div>
        <dl className="version-history-summary">
          <div>
            <dt>创作线</dt>
            <dd>{graph?.summary.branchCount ?? 0}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{graph?.summary.versionCount ?? 0}</dd>
          </div>
          <div>
            <dt>合并点</dt>
            <dd>{graph?.summary.mergeCount ?? 0}</dd>
          </div>
        </dl>
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

      {graph && layout ? (
        <div className="version-graph-section" role="region" aria-label="版本关系图">
          <div className="version-graph-legend" aria-label="图例">
            <span>
              <i className="legend-branch" />
              创作线
            </span>
            <span>
              <i className="legend-version" />
              正文版本
            </span>
            <span>
              <i className="legend-edit" />
              内容修改
            </span>
            <span>
              <i className="legend-merge" />
              合并点
            </span>
            <span>
              <i className="legend-rollback" />
              回滚
            </span>
          </div>
          <div className="version-graph-scroll">
            <svg
              aria-label="版本关系图"
              className="version-graph"
              role="img"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
            >
              <defs>
                <marker
                  id="version-arrow"
                  markerHeight="6"
                  markerWidth="6"
                  orient="auto"
                  refX="5"
                  refY="3"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill="#a7afa8" />
                </marker>
              </defs>
              {graph.branches.map((branch, index) => (
                <g key={`lane:${branch.id}`}>
                  <line
                    stroke="#e4e2da"
                    strokeWidth="1"
                    x1="20"
                    x2={layout.width - 20}
                    y1={58 + index * 82 + 24}
                    y2={58 + index * 82 + 24}
                  />
                  <text className="version-lane-label" x="20" y={58 + index * 82 - 8}>
                    {branch.isMain ? '主线' : branch.name}
                  </text>
                </g>
              ))}
              {graph.edges.map((edge) => {
                const from = layout.positions.get(edge.from);
                const to = layout.positions.get(edge.to);
                if (!from || !to) {
                  return null;
                }
                const x1 = from.x + from.width;
                const y1 = from.y + from.height / 2;
                const x2 = to.x;
                const y2 = to.y + to.height / 2;
                if (edge.kind === 'fork') {
                  return (
                    <path
                      className="version-edge fork"
                      d={`M${x1},${y1} C${x1 + 38},${y1} ${x2 - 38},${y2} ${x2},${y2}`}
                      fill="none"
                      key={edge.id}
                      markerEnd="url(#version-arrow)"
                    />
                  );
                }
                if (edge.kind === 'rollback') {
                  return (
                    <path
                      className="version-edge rollback"
                      d={`M${x1},${y1} C${x1 + 28},${y1 - 26} ${x2 - 28},${y2 + 26} ${x2},${y2}`}
                      fill="none"
                      key={edge.id}
                    />
                  );
                }
                if (edge.kind === 'merge') {
                  return (
                    <path
                      className="version-edge merge"
                      d={`M${x1},${y1} C${x1 + 36},${y1 + 22} ${x2 - 36},${y2} ${x2},${y2}`}
                      fill="none"
                      key={edge.id}
                    />
                  );
                }
                return (
                  <line
                    className="version-edge sequence"
                    key={edge.id}
                    markerEnd="url(#version-arrow)"
                    x1={x1}
                    x2={x2}
                    y1={y1}
                    y2={y2}
                  />
                );
              })}
              {[...layout.positions.values()].map(({ node, x, y, width, height }) => {
                const colors = KIND_COLORS[node.kind] ?? KIND_COLORS.edit;
                return (
                  <g
                    aria-label={`${node.kindLabel}：${node.title}`}
                    className={node.type === 'version' ? 'version-node clickable' : 'version-node'}
                    key={node.id}
                    onClick={() => {
                      if (node.type === 'version') {
                        setRollbackTarget(node);
                        setRollbackReason('');
                      }
                    }}
                    role={node.type === 'version' ? 'button' : undefined}
                    tabIndex={node.type === 'version' ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (node.type === 'version' && (event.key === 'Enter' || event.key === ' ')) {
                        setRollbackTarget(node);
                        setRollbackReason('');
                      }
                    }}
                  >
                    <rect
                      fill={colors.fill}
                      height={height}
                      rx="7"
                      stroke={colors.stroke}
                      width={width}
                      x={x}
                      y={y}
                    />
                    <text className="version-node-kind" fill={colors.text} x={x + 9} y={y + 14}>
                      {node.kindLabel}
                    </text>
                    <text className="version-node-title" fill="#27342d" x={x + 9} y={y + 30}>
                      {shortTitle(node.title)}
                    </text>
                    <text className="version-node-time" fill="#7d877f" x={x + 9} y={y + 42}>
                      {timeLabel(node.createdAt)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      ) : (
        <p className="change-empty">正在整理版本图…</p>
      )}

      <div className="version-history-layout">
        <section className="version-list" aria-label="版本列表">
          <div className="version-section-heading">
            <div>
              <h3>版本记录</h3>
              <p>选择任一版本，可以把当前创作线恢复到那个时点。</p>
            </div>
            <span>{versions.length}</span>
          </div>
          <div className="version-list-items">
            {versions.map((version) => (
              <article
                className={version.isCurrent ? 'version-list-item current' : 'version-list-item'}
                key={version.id}
              >
                <div>
                  <span className={`version-kind ${version.kind}`}>{version.kindLabel}</span>
                  <strong>{version.title}</strong>
                  <small>
                    {version.branchName} · {timeLabel(version.createdAt)}
                  </small>
                  {version.reason ? <p>{version.reason}</p> : null}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setRollbackTarget(version);
                    setRollbackReason('');
                  }}
                  type="button"
                >
                  回到这个版本
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="audit-center" aria-label="操作记录">
          <div className="version-section-heading">
            <div>
              <h3>操作记录</h3>
              <p>按修改内容、原因或操作类型查找，也可以导出备查。</p>
            </div>
          </div>
          <form className="audit-search" onSubmit={submitSearch}>
            <label className="field">
              <span>搜索操作记录</span>
              <input
                maxLength={200}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="例如：回滚、撤销、第 3 章"
                value={query}
              />
            </label>
            <button className="secondary-button" type="submit">
              查找
            </button>
            <button className="text-button" onClick={() => void downloadAudit()} type="button">
              导出记录
            </button>
          </form>
          <div className="audit-list">
            {audit.length === 0 ? (
              <p className="change-empty">没有找到符合条件的操作记录。</p>
            ) : (
              audit.map((item) => (
                <article className="audit-item" key={item.id}>
                  <div>
                    <span>{item.actionLabel}</span>
                    <strong>{item.title}</strong>
                  </div>
                  {item.detail ? <p>{item.detail}</p> : null}
                  <small>
                    {item.actorName} · {timeLabel(item.createdAt)}
                  </small>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      {rollbackTarget ? (
        <section className="rollback-confirm" aria-label="确认回滚">
          <div>
            <p className="workspace-step">回滚会保留全部历史</p>
            <h3>回到：{rollbackTarget.title}</h3>
            <p>设定、大纲、正文和已确认内容会一起恢复，并生成一条新的回滚记录。</p>
          </div>
          <label className="field">
            <span>回滚原因</span>
            <textarea
              maxLength={2_000}
              onChange={(event) => setRollbackReason(event.currentTarget.value)}
              placeholder="为什么需要回到这个版本"
              rows={2}
              value={rollbackReason}
            />
          </label>
          <div className="rollback-actions">
            <button
              className="primary-button"
              disabled={!rollbackReason.trim() || notice.status === 'working'}
              onClick={() => void submitRollback()}
              type="button"
            >
              确认回滚
            </button>
            <button className="text-button" onClick={() => setRollbackTarget(null)} type="button">
              暂不处理
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
