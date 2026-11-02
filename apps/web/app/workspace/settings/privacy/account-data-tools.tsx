'use client';

import {
  ACCOUNT_AUDIT_ACTION_LABELS,
  type AccountAuditAction,
  type AccountAuditItem,
  type AccountExportJob,
} from '@novel/contracts';
import { useEffect, useState } from 'react';
import {
  accountAuditExportUrl,
  loadAccountAudit,
  loadAccountExport,
  loadAccountExports,
  startAccountExport,
} from '../../../../lib/account-data-api';

const AUDIT_ACTIONS = Object.entries(ACCOUNT_AUDIT_ACTION_LABELS) as Array<
  [AccountAuditAction, string]
>;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatSize(value: number | null): string {
  if (value === null) {
    return '';
  }
  if (value < 1_024) {
    return `${value} B`;
  }
  if (value < 1_024 * 1_024) {
    return `${Math.round(value / 1_024)} KB`;
  }
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function exportCountLabel(job: AccountExportJob): string {
  const counts = job.summary?.counts;
  if (!counts) {
    return '正在整理全部数据';
  }
  return `${counts.works ?? 0} 部作品 · ${counts.chapters ?? 0} 章 · ${counts.settings ?? 0} 条设定 · ${counts.auditAccount ?? 0} 条账号审计`;
}

export function AccountDataTools() {
  const [jobs, setJobs] = useState<AccountExportJob[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [auditItems, setAuditItems] = useState<AccountAuditItem[]>([]);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditAction, setAuditAction] = useState<AccountAuditAction | ''>('');
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditNotice, setAuditNotice] = useState('');

  async function refreshJobs() {
    try {
      const result = await loadAccountExports();
      setJobs(result.items);
      return result.items;
    } catch {
      setExportNotice('暂时无法读取导出记录，请稍后重试。');
      return [];
    }
  }

  async function runAuditSearch(
    query = auditQuery,
    action = auditAction,
  ): Promise<void> {
    setAuditLoading(true);
    setAuditNotice('');
    try {
      const result = await loadAccountAudit({
        q: query,
        ...(action ? { action } : {}),
        limit: 50,
      });
      setAuditItems(result.items);
    } catch {
      setAuditNotice('暂时无法读取审计记录，请稍后重试。');
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([loadAccountExports(), loadAccountAudit({ limit: 50 })])
      .then(([exportResult, auditResult]) => {
        if (!active) {
          return;
        }
        setJobs(exportResult.items);
        setAuditItems(auditResult.items);
      })
      .catch(() => {
        if (active) {
          setAuditNotice('暂时无法读取账号数据，请稍后重试。');
        }
      })
      .finally(() => {
        if (active) {
          setAuditLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const activeIds = jobs
      .filter((job) => job.status === 'queued' || job.status === 'running')
      .map((job) => job.id);
    if (activeIds.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void Promise.all(activeIds.map((id) => loadAccountExport(id)))
        .then((updated) => {
          setJobs((current) => {
            const byId = new Map(updated.map((job) => [job.id, job]));
            return current.map((job) => byId.get(job.id) ?? job);
          });
        })
        .catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [jobs]);

  async function startExport() {
    setExporting(true);
    setExportNotice('');
    try {
      const created = await startAccountExport();
      setJobs((current) => [created, ...current.filter((job) => job.id !== created.id)]);
      setExportNotice('正在后台整理全部数据，完成后这里会出现下载按钮。');
      await refreshJobs();
    } catch {
      setExportNotice('导出没有启动，请稍后重试。');
    } finally {
      setExporting(false);
    }
  }

  const latest = jobs[0];
  const auditHref = accountAuditExportUrl({
    q: auditQuery,
    ...(auditAction ? { action: auditAction } : {}),
  });

  return (
    <section className="privacy-center-section" id="data-tools">
      <div className="privacy-center-heading">
        <div>
          <p className="workspace-step">你的数据</p>
          <h2>导出与审计</h2>
        </div>
        <span>完整导出不包含密码、会话令牌或模型 Key</span>
      </div>

      <div className="account-data-tools">
        <article className="account-export-tool" aria-labelledby="account-export-title">
          <div className="account-tool-heading">
            <div>
              <p className="workspace-step">一键打包</p>
              <h3 id="account-export-title">导出全部作者数据</h3>
            </div>
            <button
              className="primary-button"
              disabled={exporting}
              onClick={() => void startExport()}
              type="button"
            >
              {exporting ? '正在启动…' : '导出全部数据'}
            </button>
          </div>
          <p>
            包含作品、故事圣经、设定、人物、地图、正文、正史、生成记录、修改请求和审计记录。
            文件在后台生成，7 天内可重新下载。
          </p>
          {exportNotice ? (
            <p className="form-message form-message-success" role="status">
              {exportNotice}
            </p>
          ) : null}
          {latest ? (
            <div className="account-export-current" aria-live="polite">
              <div>
                <strong>
                  {latest.status === 'completed'
                    ? latest.fileName ?? '完整数据包'
                    : latest.statusLabel}
                </strong>
                <span>{exportCountLabel(latest)}</span>
                <small>
                  {formatDate(latest.createdAt)}
                  {latest.fileSize ? ` · ${formatSize(latest.fileSize)}` : ''}
                </small>
                {latest.status === 'queued' || latest.status === 'running' ? (
                  <div className="account-export-progress" aria-label="导出进度">
                    <span style={{ width: `${Math.max(4, latest.progress)}%` }} />
                  </div>
                ) : null}
                {latest.error ? <p className="account-tool-error">{latest.error}</p> : null}
              </div>
              {latest.downloadUrl ? (
                <a className="secondary-button" href={latest.downloadUrl}>
                  下载数据包
                </a>
              ) : (
                <span className={`export-status export-status-${latest.status}`}>
                  {latest.statusLabel}
                </span>
              )}
            </div>
          ) : null}
          {jobs.length > 1 ? (
            <div className="account-export-history" aria-label="最近导出">
              {jobs.slice(1, 4).map((job) => (
                <div key={job.id}>
                  <span>{formatDate(job.createdAt)}</span>
                  <strong>{job.fileName ?? job.statusLabel}</strong>
                  {job.downloadUrl ? <a href={job.downloadUrl}>下载</a> : null}
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <article className="account-audit-tool" aria-labelledby="account-audit-title">
          <div className="account-tool-heading">
            <div>
              <p className="workspace-step">账号足迹</p>
              <h3 id="account-audit-title">账号审计</h3>
            </div>
            <a className="text-button" href={auditHref}>
              导出 CSV
            </a>
          </div>
          <form
            className="account-audit-search"
            onSubmit={(event) => {
              event.preventDefault();
              void runAuditSearch();
            }}
          >
            <label className="field">
              <span>搜索审计记录</span>
              <input
                maxLength={200}
                onChange={(event) => setAuditQuery(event.target.value)}
                placeholder="登录、Key、导出、确认…"
                value={auditQuery}
              />
            </label>
            <label className="field">
              <span>操作类型</span>
              <select
                onChange={(event) =>
                  setAuditAction(event.target.value as AccountAuditAction | '')
                }
                value={auditAction}
              >
                <option value="">全部操作</option>
                {AUDIT_ACTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" disabled={auditLoading} type="submit">
              {auditLoading ? '正在查询…' : '搜索'}
            </button>
          </form>
          {auditNotice ? (
            <p className="form-message form-message-error" role="alert">
              {auditNotice}
            </p>
          ) : null}
          <div className="account-audit-list" aria-live="polite">
            {auditLoading && auditItems.length === 0 ? (
              <p className="account-tool-empty">正在读取账号审计…</p>
            ) : auditItems.length === 0 ? (
              <p className="account-tool-empty">没有匹配的审计记录。</p>
            ) : (
              auditItems.map((item) => (
                <div className="account-audit-item" key={item.id}>
                  <div>
                    <span>{item.actionLabel}</span>
                    <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  </div>
                  <strong>{item.title}</strong>
                  {item.detail ? <p>{item.detail}</p> : null}
                  <small>
                    {item.targetType}
                    {item.ip ? ` · ${item.ip}` : ''}
                  </small>
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
