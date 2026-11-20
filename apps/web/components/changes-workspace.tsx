"use client";

import {
  Check,
  GitBranch,
  GitCompareArrows,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  apiErrorSchema,
  branchComparisonResponseSchema,
  branchCreateRequestSchema,
  branchCreateResponseSchema,
  changeAnalysisResponseSchema,
  changeApplyRequestSchema,
  changeApplyResponseSchema,
  changeRequestCreateRequestSchema,
  changeRequestListResponseSchema,
  changeRequestResponseSchema,
  mergeApplyRequestSchema,
  mergeApplyResponseSchema,
  mergeItemDecisionRequestSchema,
  mergeItemDecisionResponseSchema,
  versionRollbackRequestSchema,
  versionRollbackResponseSchema,
  type ChangeImpact,
  type ChangeRequest,
  type ChangeRisk,
  type MergeItem,
  type WorkOverview,
} from "@novel-brain/contracts";
import { useCallback, useEffect, useState } from "react";

import { getCsrfToken } from "../lib/csrf-client";
import { fetchWorkOverview, selectActiveBranch } from "../lib/work-api";
import { branchLabel } from "../lib/work-presentation";

const riskLabels: Record<ChangeRisk, string> = {
  low: "低风险",
  medium: "需留意",
  high: "高风险",
};

const statusLabels: Record<ChangeRequest["status"], string> = {
  draft: "草稿",
  analyzing: "分析中",
  awaiting_confirmation: "待确认",
  applying: "应用中",
  applied: "已应用",
  rejected: "已驳回",
  cancelled: "已取消",
  failed: "失败",
  branched: "已拉分支",
};

const impactCategoryLabels: Record<ChangeImpact["category"], string> = {
  safe: "安全",
  repairable: "可修复",
  structural: "结构性冲突",
};

const objectTypeLabels: Record<MergeItem["objectType"], string> = {
  chapter: "章节正文",
  entity: "设定",
  fact: "已确认事实",
  outline: "大纲",
  ledger: "剧情账本",
};

const mergeStatusLabels: Record<MergeItem["status"], string> = {
  pending: "待决定",
  accepted: "已接受",
  rejected: "已拒绝",
  applied: "已摘取",
  stale: "已过期",
};

const changeKindLabels: Record<MergeItem["changeKind"], string> = {
  added: "新增",
  removed: "删除",
  changed: "变更",
  unchanged: "未变化",
};

const targetTypeLabels: Record<ChangeRequest["targetType"], string> = {
  entity: "设定",
  chapter: "章节",
  outline: "大纲",
  fact: "已确认事实",
  ledger: "剧情账本",
  work: "作品",
};

const objectTypeOptions = ["entity", "chapter", "outline", "fact", "ledger"] as const;

type RevertCandidate = {
  branchId: string;
  targetNodeId: string;
  expectedHeadNodeId: string;
  changeTitle: string;
};

type ContractSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

export function ChangesWorkspace({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [activeBranchId, setActiveBranchId] = useState("");
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [impacts, setImpacts] = useState<ChangeImpact[]>([]);
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [targetType, setTargetType] = useState<ChangeRequest["targetType"]>("entity");
  const [targetId, setTargetId] = useState("");
  const [targetVersion, setTargetVersion] = useState(1);
  const [objectType, setObjectType] = useState("entity");
  const [beforeText, setBeforeText] = useState("{}");
  const [afterText, setAfterText] = useState("{}");
  const [risk, setRisk] = useState<ChangeRisk>("low");
  const [branchName, setBranchName] = useState("");
  const [branchReason, setBranchReason] = useState("");
  const [sourceNodeId, setSourceNodeId] = useState("");
  const [confirmChangeHighRisk, setConfirmChangeHighRisk] = useState(false);
  const [confirmMergeHighRisk, setConfirmMergeHighRisk] = useState(false);
  const [revertCandidate, setRevertCandidate] = useState<RevertCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeBranch =
    work?.branches.find((branch) => branch.id === activeBranchId) ?? work?.mainBranch;

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const workData = await fetchWorkOverview(workId);
      setWork(workData);
      const branch = workData.mainBranch;
      setActiveBranchId(branch.id);
      setSourceNodeId((current) => current || branch.headNodeId);
      const changesResponse = await fetch(
        `/api/v1/works/${workId}/branches/${branch.id}/changes?limit=50`,
        { cache: "no-store" },
      );
      if (!changesResponse.ok) {
        throw new Error(await readError(changesResponse));
      }
      setChanges(
        parseContract(
          changeRequestListResponseSchema,
          await changesResponse.json(),
          "修改记录格式异常，请刷新后重试",
        ).data,
      );
      const comparisonBranch = workData.branches.find((entry) => entry.id !== branch.id);
      setSourceBranchId((current) => current || comparisonBranch?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "修改中心加载失败");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postJson(
    path: string,
    body: unknown = {},
    additionalHeaders: Record<string, string> = {},
  ) {
    const csrfToken = await getCsrfToken();
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
        ...additionalHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    return response;
  }

  async function createChange() {
    if (!activeBranch) {
      return;
    }
    setBusy("create");
    setError("");
    try {
      const response = await postJson(
        `/api/v1/works/${workId}/branches/${activeBranch.id}/changes`,
        parseContract(
          changeRequestCreateRequestSchema,
          {
            title,
            reason,
            targetVersion,
            targetType,
            targetId,
            objectType,
            before: parseObject(beforeText),
            after: parseObject(afterText),
            risk,
            source: "author",
          },
          "请检查修改请求的标题、目标、原因和前后值",
        ),
        {
          "Idempotency-Key": crypto.randomUUID(),
        },
      );
      parseContract(
        changeRequestResponseSchema,
        await response.json(),
        "修改请求已提交，但返回结果异常，请刷新确认",
      );
      setTitle("");
      setReason("");
      setBeforeText("{}");
      setAfterText("{}");
      setNotice("修改请求已创建");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建修改请求失败");
    } finally {
      setBusy("");
    }
  }

  async function analyze(change: ChangeRequest) {
    if (!activeBranch) {
      return;
    }
    setBusy(`analyze:${change.id}`);
    setError("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(
        `/api/v1/works/${workId}/branches/${activeBranch.id}/changes/${change.id}/analyze`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const result = parseContract(
        changeAnalysisResponseSchema,
        await response.json(),
        "影响分析结果异常，请刷新后重试",
      ).data;
      setImpacts(result.impacts);
      setChanges((current) =>
        current.map((item) => (item.id === result.change.id ? result.change : item)),
      );
      setNotice("影响分析已完成");
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "影响分析失败");
    } finally {
      setBusy("");
    }
  }

  async function apply(change: ChangeRequest) {
    if (!activeBranch?.headNodeId) {
      return;
    }
    const previousHeadNodeId = activeBranch.headNodeId;
    setBusy(`apply:${change.id}`);
    setError("");
    try {
      const response = await postJson(
        `/api/v1/works/${workId}/branches/${activeBranch.id}/changes/${change.id}/apply`,
        parseContract(
          changeApplyRequestSchema,
          {
            version: change.version,
            expectedTargetVersion: change.targetVersion,
            reason: change.reason,
            confirmHighRisk: confirmChangeHighRisk,
          },
          "请检查高风险确认和修改状态",
        ),
      );
      const applied = parseContract(
        changeApplyResponseSchema,
        await response.json(),
        "修改已提交，但返回结果异常，请刷新确认",
      ).data;
      setRevertCandidate({
        branchId: activeBranch.id,
        targetNodeId: previousHeadNodeId,
        expectedHeadNodeId: applied.versionNodeId,
        changeTitle: change.title,
      });
      setConfirmChangeHighRisk(false);
      setNotice("修改已应用，并保留新的历史版本");
      await load();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "应用修改失败");
    } finally {
      setBusy("");
    }
  }

  async function revertLastChange() {
    if (!revertCandidate) {
      return;
    }
    setBusy("revert");
    setError("");
    try {
      const response = await postJson(
        `/api/v1/works/${workId}/branches/${revertCandidate.branchId}/rollback`,
        parseContract(
          versionRollbackRequestSchema,
          {
            targetNodeId: revertCandidate.targetNodeId,
            expectedHeadNodeId: revertCandidate.expectedHeadNodeId,
            reason: `撤销修改：${revertCandidate.changeTitle}`,
          },
          "无法撤销此次修改，请刷新后重试",
        ),
      );
      parseContract(
        versionRollbackResponseSchema,
        await response.json(),
        "撤销已提交，但返回结果异常，请刷新确认",
      );
      setRevertCandidate(null);
      setNotice("最近一次修改已撤销，并保留完整历史");
      await load();
    } catch (revertError) {
      setError(revertError instanceof Error ? revertError.message : "撤销修改失败");
    } finally {
      setBusy("");
    }
  }

  async function createBranch() {
    if (!activeBranch?.headNodeId) {
      return;
    }
    setBusy("branch");
    setError("");
    try {
      const response = await postJson(
        `/api/v1/works/${workId}/branches`,
        parseContract(
          branchCreateRequestSchema,
          {
            name: branchName,
            sourceNodeId: sourceNodeId || activeBranch.headNodeId,
            reason: branchReason,
          },
          "请检查平行版本名称、来源版本和原因",
        ),
      );
      const branch = parseContract(
        branchCreateResponseSchema,
        await response.json(),
        "平行版本已提交，但返回结果异常，请刷新确认",
      ).data;
      setBranchName("");
      setBranchReason("");
      setNotice("平行版本已创建");
      selectActiveBranch(workId, branch.id);
    } catch (branchError) {
      setError(branchError instanceof Error ? branchError.message : "创建平行版本失败");
    } finally {
      setBusy("");
    }
  }

  async function compare() {
    if (!activeBranch || !sourceBranchId) {
      return;
    }
    setBusy("compare");
    setError("");
    try {
      const response = await fetch(
        `/api/v1/works/${workId}/branches/${activeBranch.id}/compare/${sourceBranchId}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setMergeItems(
        parseContract(
          branchComparisonResponseSchema,
          await response.json(),
          "比较结果异常，请重新比较",
        ).data.items,
      );
      setNotice("逐对象比较已完成");
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : "比较失败");
    } finally {
      setBusy("");
    }
  }

  async function decide(item: MergeItem, action: "accept" | "reject") {
    if (!activeBranch) {
      return;
    }
    setBusy(`decide:${item.id}`);
    setError("");
    try {
      const response = await postJson(
        `/api/v1/works/${workId}/branches/${activeBranch.id}/merge-items/${item.id}/decision`,
        parseContract(
          mergeItemDecisionRequestSchema,
          {
            version: item.version,
            action,
            reason: action === "accept" ? "作者选择摘取该对象" : "作者拒绝摘取该对象",
          },
          "请检查摘取决策",
        ),
      );
      const updated = parseContract(
        mergeItemDecisionResponseSchema,
        await response.json(),
        "摘取决策已提交，但返回结果异常，请刷新确认",
      ).data;
      setMergeItems((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "记录摘取决策失败");
    } finally {
      setBusy("");
    }
  }

  async function applyAccepted() {
    if (!activeBranch) {
      return;
    }
    const itemIds = mergeItems.filter((item) => item.status === "accepted").map((item) => item.id);
    if (!itemIds.length) {
      setError("请先接受至少一个比较项");
      return;
    }
    setBusy("apply-merge");
    setError("");
    try {
      const response = await postJson(
        `/api/v1/works/${workId}/branches/${activeBranch.id}/merge-items/apply`,
        parseContract(
          mergeApplyRequestSchema,
          {
            itemIds,
            expectedTargetHeadNodeId: activeBranch.headNodeId,
            confirmHighRisk: confirmMergeHighRisk,
          },
          "请检查已接受的摘取项和高风险确认",
        ),
      );
      parseContract(
        mergeApplyResponseSchema,
        await response.json(),
        "摘取已提交，但返回结果异常，请刷新确认",
      );
      setConfirmMergeHighRisk(false);
      setNotice("选择性摘取已应用并记录合并通知");
      await compare();
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "应用摘取失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page-stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">修改与版本</span>
          <h1>修改中心</h1>
          <p>先分析影响，再应用修改；平行版本只做逐对象摘取。</p>
        </div>
        <div className="row-actions">
          {work && work.branches.length > 1 ? (
            <label className="field compact-field">
              <span>当前创作线</span>
              <select
                onChange={(event) => {
                  selectActiveBranch(workId, event.target.value);
                }}
                value={activeBranchId}
              >
                {work.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branchLabel(branch.name)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="btn ghost" onClick={() => void load()} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        </div>
      </header>
      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="inline-notice">{notice}</div> : null}
      {loading ? <div className="panel">正在加载修改中心…</div> : null}
      <div className="changes-layout">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>新建修改请求</h2>
              <p>记录目标、原因、前后值和风险等级。</p>
            </div>
            <Plus size={18} aria-hidden="true" />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>标题</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>风险</span>
              <select value={risk} onChange={(event) => setRisk(event.target.value as ChangeRisk)}>
                {Object.entries(riskLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>目标类型</span>
              <select
                value={targetType}
                onChange={(event) =>
                  setTargetType(event.target.value as ChangeRequest["targetType"])
                }
              >
                {Object.entries(targetTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>目标对象 ID</span>
              <input value={targetId} onChange={(event) => setTargetId(event.target.value)} />
            </label>
            <label className="field">
              <span>目标对象版本</span>
              <input
                min={1}
                onChange={(event) => setTargetVersion(Number(event.target.value))}
                type="number"
                value={targetVersion}
              />
            </label>
            <label className="field">
              <span>对象类型</span>
              <select value={objectType} onChange={(event) => setObjectType(event.target.value)}>
                {objectTypeOptions.map((value) => (
                  <option key={value} value={value}>
                    {objectTypeLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>原因</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <label className="field">
              <span>旧值 JSON</span>
              <textarea
                value={beforeText}
                onChange={(event) => setBeforeText(event.target.value)}
              />
            </label>
            <label className="field">
              <span>新值 JSON</span>
              <textarea value={afterText} onChange={(event) => setAfterText(event.target.value)} />
            </label>
          </div>
          <button
            className="btn primary"
            disabled={busy === "create" || !targetId.trim()}
            onClick={() => void createChange()}
            type="button"
          >
            {busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
            创建修改请求
          </button>
        </section>
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>平行版本</h2>
              <p>从当前版本点创建独立分支，再从其他分支逐对象摘取。</p>
            </div>
            <GitBranch size={18} aria-hidden="true" />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>名称</span>
              <input value={branchName} onChange={(event) => setBranchName(event.target.value)} />
            </label>
            <label className="field full">
              <span>来源版本 ID</span>
              <input
                value={sourceNodeId}
                onChange={(event) => setSourceNodeId(event.target.value)}
              />
            </label>
            <label className="field full">
              <span>原因</span>
              <textarea
                value={branchReason}
                onChange={(event) => setBranchReason(event.target.value)}
              />
            </label>
          </div>
          <button
            className="btn"
            disabled={busy === "branch"}
            onClick={() => void createBranch()}
            type="button"
          >
            <GitBranch size={16} aria-hidden="true" />
            创建平行版本
          </button>
          <div className="compare-row">
            <label className="field">
              <span>来源分支</span>
              <select
                value={sourceBranchId}
                onChange={(event) => setSourceBranchId(event.target.value)}
              >
                <option value="">选择分支</option>
                {work?.branches
                  .filter((branch) => branch.id !== activeBranch?.id)
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branchLabel(branch.name)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="btn"
              disabled={busy === "compare" || !sourceBranchId}
              onClick={() => void compare()}
              type="button"
            >
              <GitCompareArrows size={16} aria-hidden="true" />
              比较
            </button>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>修改记录</h2>
            <p>{changes.length} 个修改请求</p>
          </div>
        </div>
        <div className="changes-list">
          {changes.map((change) => (
            <article className="change-row" key={change.id}>
              <div>
                <strong>{change.title}</strong>
                <span>{change.reason}</span>
                <small>
                  {statusLabels[change.status]} · {riskLabels[change.risk]} · v{change.version}
                </small>
              </div>
              <div className="row-actions">
                <button
                  className="btn small"
                  disabled={
                    busy === `analyze:${change.id}` ||
                    ["applied", "rejected", "cancelled", "branched"].includes(change.status)
                  }
                  onClick={() => void analyze(change)}
                  type="button"
                >
                  <Search size={14} aria-hidden="true" />
                  分析
                </button>
                <button
                  className="btn small"
                  disabled={
                    busy === `apply:${change.id}` || change.status !== "awaiting_confirmation"
                  }
                  onClick={() => void apply(change)}
                  type="button"
                >
                  <Play size={14} aria-hidden="true" />
                  应用
                </button>
              </div>
            </article>
          ))}
          {!changes.length ? <div className="empty-state">还没有修改请求。</div> : null}
        </div>
        {impacts.length ? (
          <div className="impact-list">
            {impacts.map((impact) => (
              <div key={impact.id}>
                <strong>{impactCategoryLabels[impact.category]}</strong>
                <span>{impact.summary}</span>
              </div>
            ))}
          </div>
        ) : null}
        {revertCandidate ? (
          <div className="change-revert" role="status">
            <div>
              <strong>最近应用：{revertCandidate.changeTitle}</strong>
              <span>撤销后仍可找回当前内容。</span>
            </div>
            <button
              className="btn small"
              disabled={busy === "revert"}
              onClick={() => void revertLastChange()}
              type="button"
            >
              {busy === "revert" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <RotateCcw size={14} aria-hidden="true" />
              )}
              撤销最近一次修改
            </button>
          </div>
        ) : null}
        <label className="check-row">
          <input
            checked={confirmChangeHighRisk}
            onChange={(event) => setConfirmChangeHighRisk(event.target.checked)}
            type="checkbox"
          />
          <span>我已确认高风险修改</span>
        </label>
      </section>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>逐对象摘取</h2>
            <p>{mergeItems.length} 个对象差异</p>
          </div>
          <button
            className="btn primary"
            disabled={busy === "apply-merge"}
            onClick={() => void applyAccepted()}
            type="button"
          >
            <Check size={16} aria-hidden="true" />
            应用已接受项
          </button>
        </div>
        <div className="merge-list">
          {mergeItems.map((item) => (
            <article className="merge-row" key={item.id}>
              <div>
                <strong>
                  {objectTypeLabels[item.objectType]} · {item.objectKey}
                </strong>
                <span>{item.conflict ? "目标分支已有不同版本" : "目标分支尚无此对象"}</span>
                <small>
                  {changeKindLabels[item.changeKind]} · {riskLabels[item.risk]} ·{" "}
                  {mergeStatusLabels[item.status]}
                </small>
              </div>
              <div className="row-actions">
                <button
                  className="btn small"
                  onClick={() => void decide(item, "accept")}
                  type="button"
                >
                  <Check size={14} aria-hidden="true" />
                  接受
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => void decide(item, "reject")}
                  type="button"
                >
                  <X size={14} aria-hidden="true" />
                  拒绝
                </button>
              </div>
            </article>
          ))}
          {!mergeItems.length ? <div className="empty-state">选择来源分支后进行比较。</div> : null}
        </div>
        <label className="check-row">
          <input
            checked={confirmMergeHighRisk}
            onChange={(event) => setConfirmMergeHighRisk(event.target.checked)}
            type="checkbox"
          />
          <span>我已确认高风险摘取</span>
        </label>
      </section>
    </div>
  );
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("前后值必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function parseContract<T>(schema: ContractSchema<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(message);
  }
  return result.data;
}

async function readError(response: Response): Promise<string> {
  try {
    const parsed = apiErrorSchema.parse(await response.json());
    return parsed.error.message;
  } catch {
    return `请求失败（${response.status}）`;
  }
}
