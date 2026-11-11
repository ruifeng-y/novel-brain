"use client";

import {
  Check,
  ClipboardCheck,
  FileWarning,
  Layers3,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiErrorSchema,
  batchCostReportResponseSchema,
  batchPlanResponseSchema,
  batchReviewClaimResponseSchema,
  batchReviewDecisionResponseSchema,
  batchReviewQueueListResponseSchema,
  workResponseSchema,
  type BatchReviewDecisionResult,
  type BatchReviewQueueItem,
  type BatchReviewRisk,
  type BatchReviewStatus,
  type BatchCostReport,
  type GenerationJobStatus,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

const riskLabels: Record<BatchReviewRisk, string> = {
  low: "低风险",
  medium: "需留意",
  high: "高风险",
};

const statusLabels: Record<BatchReviewStatus, string> = {
  pending: "待领取",
  claimed: "已领取",
  approved: "已批准",
  rejected: "已驳回",
  stale: "已过期",
};

export function BatchWorkspace({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [items, setItems] = useState<BatchReviewQueueItem[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    pending: 0,
    claimed: 0,
    highRisk: 0,
    stale: 0,
  });
  const [planStates, setPlanStates] = useState<
    Array<{ id: string; status: GenerationJobStatus; report: BatchCostReport | null }>
  >([]);
  const [risk, setRisk] = useState<"" | BatchReviewRisk>("");
  const [status, setStatus] = useState<"pending" | "claimed" | "">("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [highRiskConfirmed, setHighRiskConfirmed] = useState(false);
  const [results, setResults] = useState<Record<string, BatchReviewDecisionResult>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"claim" | "approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const params = new URLSearchParams({ limit: "100" });
      if (risk) {
        params.set("risk", risk);
      }
      if (status) {
        params.set("status", status);
      }
      const queueResponse = await fetch(
        `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/review-queue?${params}`,
        { cache: "no-store" },
      );
      if (!queueResponse.ok) {
        throw new Error(await readError(queueResponse));
      }
      const queue = batchReviewQueueListResponseSchema.parse(await queueResponse.json());
      const planIds = [...new Set(queue.data.map((item) => item.planId))].slice(0, 20);
      const plans = await Promise.all(
        planIds.map(async (planId) => {
          const response = await fetch(
            `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/batch-plans/${planId}`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            return null;
          }
          const plan = batchPlanResponseSchema.parse(await response.json()).data;
          const reportResponse = await fetch(
            `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/batch-plans/${planId}/cost-report?groupBy=volume`,
            { cache: "no-store" },
          );
          const report = reportResponse.ok
            ? batchCostReportResponseSchema.parse(await reportResponse.json()).data
            : null;
          return { id: plan.id, status: plan.status, report };
        }),
      );
      setWork(workData);
      setItems(queue.data);
      setCounts(queue.meta.counts);
      setPlanStates(
        plans.filter(
          (
            plan,
          ): plan is {
            id: string;
            status: GenerationJobStatus;
            report: BatchCostReport | null;
          } => plan !== null,
        ),
      );
      setSelected((current) => {
        const available = new Set(queue.data.map((item) => item.id));
        return new Set([...current].filter((id) => available.has(id)));
      });
      setActiveId((current) =>
        current && queue.data.some((item) => item.id === current)
          ? current
          : (queue.data[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "审核队列加载失败。");
    } finally {
      setLoading(false);
    }
  }, [risk, status, workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeItem = items.find((item) => item.id === activeId) ?? null;
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );
  const actionable = selectedItems.filter((item) => item.status === "claimed");
  const requiresIndividualConfirmation = actionable.some((item) => item.risk !== "low");

  function toggleItem(item: BatchReviewQueueItem) {
    if (item.status === "approved" || item.status === "rejected" || item.status === "stale") {
      setActiveId(item.id);
      return;
    }
    setActiveId(item.id);
    setHighRiskConfirmed(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  async function claimSelected() {
    if (selectedItems.length === 0) {
      return;
    }
    setBusy("claim");
    setError("");
    setNotice("");
    try {
      const csrf = await getCsrfToken();
      const response = await fetch(
        `/api/v1/works/${workId}/branches/${work!.mainBranch.id}/review-queue/claim`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({ itemIds: selectedItems.map((item) => item.id) }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const claimed = batchReviewClaimResponseSchema.parse(await response.json()).data;
      const byId = new Map(claimed.map((item) => [item.id, item]));
      setItems((current) => current.map((item) => byId.get(item.id) ?? item));
      setNotice(`已领取 ${claimed.length} 个审核项。`);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "领取审核项失败。");
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (actionable.length === 0) {
      return;
    }
    if (action === "approve" && actionable.length > 1 && requiresIndividualConfirmation) {
      setError("高风险或需留意事项必须逐项确认。");
      return;
    }
    if (action === "approve" && requiresIndividualConfirmation && !highRiskConfirmed) {
      setError("请先确认已逐项核对风险原因。");
      return;
    }
    if (action === "reject" && rejectReason.trim().length === 0) {
      setError("驳回时必须填写原因。");
      return;
    }
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const csrf = await getCsrfToken();
      const response = await fetch(
        `/api/v1/works/${workId}/branches/${work!.mainBranch.id}/review-queue/decisions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({
            items: actionable.map((item) => ({
              itemId: item.id,
              expectedVersion: item.version,
              action,
              ...(action === "reject" ? { reason: rejectReason.trim() } : {}),
            })),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const decision = batchReviewDecisionResponseSchema.parse(await response.json()).data;
      setResults((current) => {
        const next = { ...current };
        for (const result of decision.results) {
          next[result.itemId] = result;
        }
        return next;
      });
      const updated = new Map(
        decision.results.flatMap((result) => (result.item ? [[result.itemId, result.item]] : [])),
      );
      setItems((current) => current.map((item) => updated.get(item.id) ?? item));
      setSelected(new Set());
      setRejectReason("");
      setHighRiskConfirmed(false);
      setNotice(
        decision.failed > 0
          ? `已处理 ${decision.succeeded} 项，${decision.failed} 项需要刷新后重试。`
          : `已处理 ${decision.succeeded} 个审核项。`,
      );
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "提交审核决策失败。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-shell batch-review-page">
      <section className="page-head">
        <div>
          <p className="eyebrow">批量生产</p>
          <h1>审核队列</h1>
          <p>集中处理批量章节与卷边界审核，所有决策都会写入审计记录。</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden="true" />
          刷新队列
        </button>
      </section>

      <section className="batch-review-summary" aria-label="审核队列摘要">
        <SummaryMetric icon={ClipboardCheck} label="全部" value={counts.total} />
        <SummaryMetric icon={Layers3} label="待领取" value={counts.pending} />
        <SummaryMetric icon={Check} label="处理中" value={counts.claimed} />
        <SummaryMetric icon={ShieldAlert} label="高风险" value={counts.highRisk} tone="danger" />
        <SummaryMetric icon={FileWarning} label="已过期" value={counts.stale} tone="warning" />
      </section>

      {planStates.length > 0 ? (
        <section className="batch-review-plan-states" aria-label="批量任务状态">
          {planStates.map((plan) => (
            <div
              className={`batch-plan-state ${plan.status}${plan.report?.budget.status === "exhausted" ? " budget-exhausted" : ""}`}
              key={plan.id}
            >
              <span>{planStateLabel(plan.status)}</span>
              {plan.report ? (
                <small>
                  ¥{plan.report.totals.settledCostCny.toFixed(2)}
                  {plan.report.budget.remainingCostCny === null
                    ? " · 未设任务上限"
                    : ` · 剩余 ¥${plan.report.budget.remainingCostCny.toFixed(2)}`}
                </small>
              ) : null}
            </div>
          ))}
          {planStates.flatMap((plan) =>
            (plan.report?.hardStops ?? []).slice(0, 3).map((hardStop) => (
              <div
                className="batch-budget-alert"
                key={`${plan.id}:${hardStop.jobId}:${hardStop.occurredAt}`}
              >
                <strong>{budgetScopeLabel(hardStop.scope)}预算已耗尽</strong>
                <span>{hardStop.message}</span>
              </div>
            )),
          )}
        </section>
      ) : null}

      <section className="batch-review-toolbar" aria-label="审核筛选">
        <label>
          <span>状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="pending">待领取</option>
            <option value="claimed">已领取</option>
            <option value="">全部状态</option>
          </select>
        </label>
        <label>
          <span>风险</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)}>
            <option value="">全部风险</option>
            <option value="high">高风险</option>
            <option value="medium">需留意</option>
            <option value="low">低风险</option>
          </select>
        </label>
        <button
          className="primary-button"
          disabled={selectedItems.length === 0 || busy !== null}
          onClick={() => void claimSelected()}
        >
          {busy === "claim" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ClipboardCheck size={16} />
          )}
          领取所选
        </button>
      </section>

      {notice ? <div className="page-inline-note success">{notice}</div> : null}
      {error ? (
        <div className="page-inline-note error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="page-state-panel">
          <LoaderCircle className="spin" size={24} />
          <strong>正在加载审核队列</strong>
        </div>
      ) : items.length === 0 ? (
        <div className="page-state-panel">
          <ShieldCheck size={26} />
          <strong>当前没有待处理的审核项</strong>
          <span>新的批量审核进入队列后会显示在这里。</span>
        </div>
      ) : (
        <section className="batch-review-workspace">
          <div className="batch-review-list" aria-label="审核项">
            {items.map((item) => {
              const result = results[item.id];
              return (
                <button
                  className={`batch-review-item${activeId === item.id ? " active" : ""}`}
                  data-risk={item.risk}
                  data-status={item.status}
                  key={item.id}
                  onClick={() => toggleItem(item)}
                  type="button"
                >
                  <span className="batch-review-select" aria-hidden="true">
                    {selected.has(item.id) ? <Check size={14} /> : null}
                  </span>
                  <span className="batch-review-copy">
                    <strong>
                      {item.targetType === "volume"
                        ? (item.volumeTitle ?? "卷边界审核")
                        : `第 ${item.chapterNumber ?? "-"} 章 · ${item.chapterTitle ?? "未命名章节"}`}
                    </strong>
                    <small>{item.volumeTitle ?? "章节审核"}</small>
                  </span>
                  <span className={`risk-badge ${item.risk}`}>{riskLabels[item.risk]}</span>
                  <span className={`review-status ${item.status}`}>
                    {statusLabels[item.status]}
                  </span>
                  {result ? (
                    <span className={`review-result ${result.status}`}>
                      {result.status === "failed" ? "需重试" : "已处理"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <aside className="batch-review-detail" aria-label="审核详情">
            {activeItem ? (
              <>
                <div className="batch-review-detail-head">
                  <div>
                    <span className={`risk-badge ${activeItem.risk}`}>
                      {riskLabels[activeItem.risk]}
                    </span>
                    <h2>
                      {activeItem.targetType === "volume"
                        ? (activeItem.volumeTitle ?? "卷边界审核")
                        : (activeItem.chapterTitle ?? `第 ${activeItem.chapterNumber} 章`)}
                    </h2>
                  </div>
                  <span className={`review-status ${activeItem.status}`}>
                    {statusLabels[activeItem.status]}
                  </span>
                </div>

                <dl className="batch-review-facts">
                  <div>
                    <dt>质量报告</dt>
                    <dd>{qualityStateLabel(activeItem.quality.reportState)}</dd>
                  </div>
                  <div>
                    <dt>平均评分</dt>
                    <dd>
                      {activeItem.quality.scoreAverage === null
                        ? "暂无"
                        : activeItem.quality.scoreAverage.toFixed(1)}
                    </dd>
                  </div>
                  <div>
                    <dt>阻断项</dt>
                    <dd>{activeItem.quality.blockerCount}</dd>
                  </div>
                </dl>

                <div className="batch-review-reasons">
                  <h3>人工确认原因</h3>
                  {activeItem.riskReasons.length === 0 ? (
                    <p>没有额外风险说明。</p>
                  ) : (
                    <ul>
                      {activeItem.riskReasons.map((reason) => (
                        <li key={reason.code}>{reason.message}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {activeItem.findings.length > 0 ? (
                  <div className="batch-review-findings">
                    <h3>章节证据</h3>
                    <ul>
                      {activeItem.findings.map((finding) => (
                        <li key={finding.id}>
                          <strong>{severityLabel(finding.severity)}</strong>
                          {finding.quote ? <blockquote>{finding.quote}</blockquote> : null}
                          <p>{finding.recommendation}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {results[activeItem.id]?.status === "failed" ? (
                  <div className="page-inline-note error">{results[activeItem.id]?.message}</div>
                ) : null}

                <label className="batch-review-reason">
                  <span>驳回原因</span>
                  <textarea
                    disabled={activeItem.status !== "claimed" || busy !== null}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="说明需要修改或重新生成的原因"
                    rows={3}
                    value={rejectReason}
                  />
                </label>

                {actionable.some((item) => item.risk !== "low") ? (
                  <label className="batch-review-confirm">
                    <input
                      checked={highRiskConfirmed}
                      onChange={(event) => setHighRiskConfirmed(event.target.checked)}
                      type="checkbox"
                    />
                    <span>我已逐项核对风险原因和章节证据</span>
                  </label>
                ) : null}

                <div className="batch-review-actions">
                  <button
                    className="danger-button"
                    disabled={actionable.length === 0 || busy !== null}
                    onClick={() => void decide("reject")}
                  >
                    {busy === "reject" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <X size={16} />
                    )}
                    驳回
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      actionable.length === 0 ||
                      busy !== null ||
                      (requiresIndividualConfirmation && !highRiskConfirmed)
                    }
                    onClick={() => void decide("approve")}
                  >
                    {busy === "approve" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    批准所选
                  </button>
                </div>
              </>
            ) : (
              <div className="page-state-panel compact">
                <ClipboardCheck size={22} />
                <strong>选择一个审核项</strong>
              </div>
            )}
          </aside>
        </section>
      )}
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ClipboardCheck;
  label: string;
  value: number;
  tone?: "danger" | "warning";
}) {
  return (
    <div className={`batch-review-metric${tone ? ` ${tone}` : ""}`}>
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function qualityStateLabel(state: BatchReviewQueueItem["quality"]["reportState"]) {
  switch (state) {
    case "fresh":
      return "当前版本";
    case "stale":
      return "已过期";
    default:
      return "未生成";
  }
}

function planStateLabel(status: GenerationJobStatus) {
  switch (status) {
    case "queued":
      return "待开始";
    case "preparing":
      return "准备中";
    case "running":
      return "执行中";
    case "paused":
      return "已暂停";
    case "waiting_review":
      return "等待审核";
    case "completed":
      return "已完成";
    case "failed":
      return "执行失败";
    case "cancelled":
      return "已取消";
  }
}

function severityLabel(severity: BatchReviewQueueItem["findings"][number]["severity"]) {
  switch (severity) {
    case "P0":
      return "阻断";
    case "P1":
      return "高风险";
    case "P2":
      return "提醒";
    case "P3":
      return "建议";
  }
}

function budgetScopeLabel(scope: string | null) {
  switch (scope) {
    case "chapter":
      return "单章";
    case "volume":
      return "单卷";
    case "per_ten_thousand_characters":
      return "每万字";
    default:
      return "任务";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const parsed = apiErrorSchema.parse(await response.json());
    return parsed.error.message;
  } catch {
    return "请求失败，请稍后重试。";
  }
}
