"use client";

import {
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiErrorSchema,
  volumeAuditReportResponseSchema,
  volumeAuditWorkspaceResponseSchema,
  type VolumeAuditFinding,
  type VolumeAuditReport,
  type VolumeAuditWorkspace,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

const severityLabels: Record<VolumeAuditFinding["severity"], string> = {
  P0: "阻断",
  P1: "阻断",
  P2: "提醒",
  P3: "关注",
};

const codeLabels: Record<VolumeAuditFinding["code"], string> = {
  FACT_CONTRADICTION: "事实冲突",
  TIMELINE_CONFLICT: "时间或顺序矛盾",
  UNDISCLOSED_KNOWLEDGE: "角色知道不该知道的事",
  MOTIVATION_BREAK: "动机断裂",
  LOCATION_CONFLICT: "地图或地点矛盾",
  STYLE_DRIFT: "文风漂移",
  WEAK_CHAPTER_END_HOOK: "章末钩子偏弱",
  UNRESOLVED_LEDGER_ENTRY: "剧情线或伏笔未收束",
  ANTAGONIST_UNDERESTIMATION: "反派判断失真",
  POWER_INFLATION: "战力膨胀",
  VOLUME_CHAPTER_UNAUDITED: "章节尚未审计",
};

const statusLabels: Record<VolumeAuditReport["status"], string> = {
  passed: "未见阻断项",
  warnings: "有提醒",
  blocked: "存在阻断项",
};

export function VolumeAuditPanel({ branchId, workId }: { branchId: string; workId: string }) {
  const [workspace, setWorkspace] = useState<VolumeAuditWorkspace | null>(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<"accepted" | "changes_requested">("changes_requested");
  const [rationale, setRationale] = useState("");

  const basePath = `/api/v1/works/${workId}/branches/${branchId}/volume-audits`;
  const latestReport = workspace?.latestReport ?? null;
  const report = latestReport?.volumeNodeId === selectedVolumeId ? latestReport : null;
  const selectedVolume = useMemo(
    () => workspace?.volumes.find((volume) => volume.nodeId === selectedVolumeId) ?? null,
    [selectedVolumeId, workspace?.volumes],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(basePath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const data = volumeAuditWorkspaceResponseSchema.parse(await response.json()).data;
      setWorkspace(data);
      setSelectedVolumeId((current) => current || data.volumes[0]?.nodeId || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "卷末审计加载失败。");
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAudit() {
    if (!selectedVolumeId || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(basePath, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({ volumeNodeId: selectedVolumeId }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const nextReport = volumeAuditReportResponseSchema.parse(await response.json()).data;
      setWorkspace((current) =>
        current
          ? {
              ...current,
              latestReport: nextReport,
              volumes: current.volumes.map((volume) =>
                volume.nodeId === nextReport.volumeNodeId
                  ? { ...volume, latestReportId: nextReport.id }
                  : volume,
              ),
            }
          : current,
      );
      setDecision(nextReport.status === "blocked" ? "changes_requested" : "accepted");
      setRationale("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "卷末审计失败。");
    } finally {
      setBusy(false);
    }
  }

  async function signoff() {
    if (!report || !rationale.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${basePath}/${report.id}/signoff`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({
          version: report.version,
          decision,
          rationale: rationale.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const signed = volumeAuditReportResponseSchema.parse(await response.json()).data;
      setWorkspace((current) => (current ? { ...current, latestReport: signed } : current));
      setRationale("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "签收记录保存失败。");
    } finally {
      setBusy(false);
    }
  }

  const canAccept = report?.status !== "blocked" && Boolean(workspace?.goldenThreeLocked);

  return (
    <section className="panel overview-volume-audit" aria-labelledby="volume-audit-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">卷末验收</span>
          <h2 id="volume-audit-title">卷末审计</h2>
        </div>
        <button
          className="btn btn-ghost btn-small"
          disabled={!selectedVolumeId || busy}
          onClick={() => void runAudit()}
          type="button"
        >
          {busy ? (
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
          ) : report ? (
            <RefreshCw size={14} aria-hidden="true" />
          ) : (
            <ScanSearch size={14} aria-hidden="true" />
          )}
          {report ? "重新审计" : "开始卷末审计"}
        </button>
      </div>

      {error ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <p className="style-drift-empty">
          <LoaderCircle className="spin" size={16} aria-hidden="true" /> 正在读取卷末审计记录。
        </p>
      ) : !workspace || workspace.volumes.length === 0 ? (
        <p className="style-drift-empty">
          <BookOpenCheck size={17} aria-hidden="true" /> 先在大纲里建好卷和章节，再进行卷末审计。
        </p>
      ) : (
        <>
          <div className="volume-audit-toolbar">
            <label>
              选择卷
              <select
                aria-label="选择卷"
                onChange={(event) => setSelectedVolumeId(event.target.value)}
                value={selectedVolumeId}
              >
                {workspace.volumes.map((volume) => (
                  <option key={volume.nodeId} value={volume.nodeId}>
                    {volume.title}（第 {volume.chapterFrom}–{volume.chapterTo} 章）
                  </option>
                ))}
              </select>
            </label>
            {selectedVolume ? (
              <span className="badge">
                已写 {selectedVolume.writtenChapters} / {selectedVolume.chapterCount} 章
              </span>
            ) : null}
            {workspace.goldenThreeLocked ? (
              <span className="badge volume-audit-golden">
                <CheckCircle2 size={12} aria-hidden="true" /> 黄金三章已锁定
              </span>
            ) : (
              <span className="badge volume-audit-missing">黄金三章待锁定</span>
            )}
          </div>

          {!report ? (
            <p className="style-drift-empty">
              审计会汇总章节检查、剧情账本、时间线和人物状态证据，不会用模型自评替代正文证据。
            </p>
          ) : (
            <div className="volume-audit-report" data-volume-audit-status={report.status}>
              <div className="volume-audit-summary">
                <div>
                  <span className={`badge volume-audit-status-${report.status}`}>
                    {statusLabels[report.status]}
                  </span>
                  <strong>
                    第 {report.chapterFrom}–{report.chapterTo} 章 · 已审计 {report.coverage.length}{" "}
                    章
                  </strong>
                </div>
                <div className="volume-audit-counts">
                  <span>未收束 {report.summary.unresolvedLedger}</span>
                  <span>动机 {report.summary.motivation}</span>
                  <span>反派 {report.summary.antagonist}</span>
                  <span>战力 {report.summary.powerInflation}</span>
                  <span>地图时间 {report.summary.mapTime}</span>
                  <span>知识边界 {report.summary.knowledgeLeak}</span>
                </div>
              </div>

              {report.findings.length === 0 ? (
                <p className="volume-audit-clean">
                  <CheckCircle2 size={15} aria-hidden="true" /> 本卷未发现需要处理的卷级问题。
                </p>
              ) : (
                <div className="volume-audit-findings">
                  {report.findings.map((finding) => (
                    <article
                      className={`volume-audit-finding severity-${finding.severity.toLowerCase()}`}
                      data-volume-audit-finding={finding.code}
                      key={finding.id}
                    >
                      <div className="volume-audit-finding-head">
                        <span className={`badge critic-severity-${finding.severity.toLowerCase()}`}>
                          {severityLabels[finding.severity]}
                        </span>
                        <strong>{codeLabels[finding.code]}</strong>
                        {finding.chapterNumber ? <span>第 {finding.chapterNumber} 章</span> : null}
                        {finding.upstreamFindingId ? <span>章节检查</span> : null}
                      </div>
                      <p>{finding.recommendation}</p>
                      <div className="volume-audit-evidence">
                        {finding.evidence.slice(0, 2).map((evidence) => (
                          <blockquote key={`${evidence.startOffset}-${evidence.endOffset}`}>
                            <p>“{evidence.quote}”</p>
                            <small>{evidence.locator}</small>
                            <span>{evidence.explanation}</span>
                          </blockquote>
                        ))}
                      </div>
                      {finding.chapterId ? (
                        <Link
                          className="text-btn small"
                          href={`/workspace/${workId}/write?chapterId=${finding.chapterId}`}
                        >
                          去写作台定位
                        </Link>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}

              {report.signoff ? (
                <div className="volume-audit-signoff-record">
                  <ClipboardCheck size={15} aria-hidden="true" />
                  <div>
                    <strong>
                      {report.signoff.decision === "accepted" ? "作者已签收" : "作者要求修改"}
                    </strong>
                    <p>{report.signoff.rationale}</p>
                    <small>{formatDateTime(report.signoff.signedOffAt)}</small>
                  </div>
                </div>
              ) : (
                <form
                  className="volume-audit-signoff"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void signoff();
                  }}
                >
                  <div className="volume-audit-signoff-head">
                    <strong>作者签收</strong>
                    <small>签收记录会写入审计日志；未通过时请说明需要补足的证据。</small>
                  </div>
                  <label>
                    验收结论
                    <select
                      aria-label="验收结论"
                      onChange={(event) =>
                        setDecision(event.target.value as "accepted" | "changes_requested")
                      }
                      value={decision}
                    >
                      <option disabled={!canAccept} value="accepted">
                        通过卷末验收
                      </option>
                      <option value="changes_requested">要求修改</option>
                    </select>
                  </label>
                  <label>
                    签收意见
                    <textarea
                      aria-label="签收意见"
                      onChange={(event) => setRationale(event.target.value)}
                      placeholder="说明你核对过的证据、仍需修改的章节或接受的例外"
                      value={rationale}
                    />
                  </label>
                  {!canAccept ? (
                    <p className="volume-audit-signoff-hint">
                      存在阻断项或黄金三章尚未锁定时，只能记录修改意见。
                    </p>
                  ) : null}
                  <button
                    className="btn btn-primary btn-small"
                    disabled={busy || rationale.trim().length < 10}
                    type="submit"
                  >
                    保存签收记录
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "卷末审计请求失败。";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
