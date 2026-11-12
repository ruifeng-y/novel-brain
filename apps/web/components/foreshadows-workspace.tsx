"use client";

import {
  Check,
  ChevronRight,
  ClockAlert,
  GitCommitHorizontal,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  apiErrorSchema,
  chapterWorkspaceListResponseSchema,
  settingEntityListResponseSchema,
  storyLedgerMutationResponseSchema,
  storyLedgerWorkspaceResponseSchema,
  worldTimelineResponseSchema,
  type ChapterWorkspace,
  type SettingEntity,
  type StoryLedgerEntry,
  type StoryLedgerFinding,
  type StoryLedgerLifecycleAction,
  type StoryLedgerStatus,
  type StoryLedgerWorkspace,
  type TimelineEventDetail,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { fetchAllCursorPages } from "../lib/cursor-pagination";
import { fetchWorkOverview } from "../lib/work-api";

const kindLabels: Record<StoryLedgerEntry["kind"], string> = {
  plot_thread: "剧情线",
  foreshadow: "伏笔",
  character_arc: "人物弧",
};

const statusLabels: Record<StoryLedgerStatus, string> = {
  planned: "待埋设",
  planted: "已埋设",
  progressed: "推进中",
  paid_off: "已回收",
  failed_payoff: "回收失败",
  abandoned: "已放弃",
  deferred: "已延期",
};

const roleLabels: Record<StoryLedgerEntry["responsibleRole"], string> = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
  ensemble: "群像",
  author: "作者",
};

const threadTypeLabels: Record<
  Extract<StoryLedgerEntry, { kind: "plot_thread" }>["threadType"],
  string
> = {
  main: "主线",
  subplot: "支线",
  character: "人物线",
  faction: "势力线",
  world: "世界线",
  mystery: "悬疑线",
  romance: "感情线",
};

const findingLabels: Record<StoryLedgerFinding["code"], string> = {
  LEDGER_OVERDUE: "逾期未回收",
  LEDGER_DUPLICATE: "重复线索",
  LEDGER_PREMATURE_PAYOFF: "过早回收",
  LEDGER_WEAK_PAYOFF: "回收力度不足",
  LEDGER_UNSUPPORTED_PAYOFF: "缺少回收依据",
  LEDGER_INVALIDATED_PAYOFF: "前置事件已失效",
  LEDGER_NO_CAUSAL_PAYOFF: "缺少埋设因果",
};

const actionLabels: Record<StoryLedgerLifecycleAction, string> = {
  setup: "埋设",
  progress: "推进",
  payoff: "回收",
  fail_payoff: "失败回收",
  abandon: "放弃",
  defer: "延期",
};

interface CreateFormState {
  kind: StoryLedgerEntry["kind"];
  title: string;
  summary: string;
  responsibleRole: StoryLedgerEntry["responsibleRole"];
  status: "planned" | "planted";
  sourceChapterId: string;
  sourceEventId: string;
  targetFrom: string;
  targetTo: string;
  reason: string;
  prerequisiteEventIds: string[];
  evidenceQuote: string;
  importance: "must" | "optional";
  readerPromise: string;
  relatedCharacterIds: string[];
  relatedFactionIds: string[];
  threadType: Extract<StoryLedgerEntry, { kind: "plot_thread" }>["threadType"];
  stakes: string;
  tension: string;
  characterId: string;
  startState: string;
  desire: string;
  fear: string;
  lie: string;
  truth: string;
  endState: string;
}

interface EditFormState {
  entry: StoryLedgerEntry;
  title: string;
  summary: string;
  targetFrom: string;
  targetTo: string;
  importance: "must" | "optional";
  readerPromise: string;
  tension: string;
}

interface TransitionFormState {
  entry: StoryLedgerEntry;
  action: StoryLedgerLifecycleAction;
  reason: string;
  chapterId: string;
  quote: string;
  targetFrom: string;
  targetTo: string;
}

const initialCreateForm: CreateFormState = {
  kind: "foreshadow",
  title: "",
  summary: "",
  responsibleRole: "protagonist",
  status: "planned",
  sourceChapterId: "",
  sourceEventId: "",
  targetFrom: "1",
  targetTo: "20",
  reason: "",
  prerequisiteEventIds: [],
  evidenceQuote: "",
  importance: "must",
  readerPromise: "长线伏笔",
  relatedCharacterIds: [],
  relatedFactionIds: [],
  threadType: "main",
  stakes: "",
  tension: "",
  characterId: "",
  startState: "",
  desire: "",
  fear: "",
  lie: "",
  truth: "",
  endState: "",
};

export function ForeshadowsWorkspace({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [workspace, setWorkspace] = useState<StoryLedgerWorkspace | null>(null);
  const [chapters, setChapters] = useState<ChapterWorkspace[]>([]);
  const [entities, setEntities] = useState<SettingEntity[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEventDetail[]>([]);
  const [activeKind, setActiveKind] = useState<StoryLedgerEntry["kind"]>("foreshadow");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StoryLedgerStatus | "">("");
  const [importanceFilter, setImportanceFilter] = useState<"must" | "optional" | "">("");
  const [createForm, setCreateForm] = useState<CreateFormState | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [transitionForm, setTransitionForm] = useState<TransitionFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const basePath = work ? `/api/v1/works/${work.id}/branches/${work.mainBranch.id}` : "";
  const characterOptions = entities.filter((entity) => entity.type === "character");
  const factionOptions = entities.filter((entity) => entity.type === "faction");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workData = await fetchWorkOverview(workId);
      const branchPath = `/api/v1/works/${workData.id}/branches/${workData.mainBranch.id}`;
      const [ledgerResponse, chapterData, entityData, timelineResponse] = await Promise.all([
        fetch(`${branchPath}/ledger`, { cache: "no-store" }),
        fetchAllCursorPages(
          `${branchPath}/chapters`,
          chapterWorkspaceListResponseSchema.parse,
          "章节列表加载失败。",
        ),
        fetchAllCursorPages(
          `${branchPath}/entities`,
          settingEntityListResponseSchema.parse,
          "人物与势力加载失败。",
        ),
        fetch(`${branchPath}/world/timeline`, { cache: "no-store" }),
      ]);
      if (!ledgerResponse.ok) {
        throw new Error(await readError(ledgerResponse, "伏笔账本加载失败。"));
      }
      if (!timelineResponse.ok) {
        throw new Error(await readError(timelineResponse, "时间线加载失败。"));
      }
      setWork(workData);
      setWorkspace(storyLedgerWorkspaceResponseSchema.parse(await ledgerResponse.json()).data);
      setChapters(chapterData);
      setEntities(entityData);
      setTimelineEvents(
        worldTimelineResponseSchema.parse(await timelineResponse.json()).data.events,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "伏笔账本加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (!basePath) {
      return;
    }
    const response = await fetch(`${basePath}/ledger`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readError(response, "伏笔账本刷新失败。"));
    }
    setWorkspace(storyLedgerWorkspaceResponseSchema.parse(await response.json()).data);
  }, [basePath]);

  const kindEntries = useMemo(
    () => workspace?.entries.filter((entry) => entry.kind === activeKind) ?? [],
    [activeKind, workspace?.entries],
  );
  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return kindEntries.filter((entry) => {
      if (statusFilter && entry.status !== statusFilter) {
        return false;
      }
      if (
        importanceFilter &&
        (entry.kind !== "foreshadow" || entry.importance !== importanceFilter)
      ) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [
        entry.title,
        entry.summary,
        entry.kind === "foreshadow" ? entry.readerPromise : "",
        ...(entry.kind === "foreshadow"
          ? [
              ...entry.relatedCharacters.map((ref) => ref.label ?? ""),
              ...entry.relatedFactions.map((ref) => ref.label ?? ""),
            ]
          : []),
        ...(entry.kind === "character_arc" ? [entry.character.label ?? ""] : []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [importanceFilter, kindEntries, search, statusFilter]);

  const findingsByEntry = useMemo(() => {
    const grouped = new Map<string, StoryLedgerFinding[]>();
    for (const finding of workspace?.findings ?? []) {
      const group = grouped.get(finding.entryId) ?? [];
      group.push(finding);
      grouped.set(finding.entryId, group);
    }
    return grouped;
  }, [workspace?.findings]);

  const promises = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of workspace?.entries ?? []) {
      if (entry.kind !== "foreshadow") {
        continue;
      }
      counts.set(entry.readerPromise, (counts.get(entry.readerPromise) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  }, [workspace?.entries]);

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载伏笔账本">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载伏笔账本
      </section>
    );
  }

  if (error || !work || !workspace) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "伏笔账本加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  return (
    <div className="foreshadow-page">
      <section className="page-head">
        <div>
          <p className="eyebrow">剧情账本</p>
          <h1>埋下的，都要有回收计划</h1>
          <p className="page-sub">
            {work.title} · 记录剧情线、伏笔和人物弧；每条都保留来源、目标窗口与推进记录。
          </p>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-ghost"
            disabled={busy === "refresh"}
            onClick={() => void checkAgain()}
            type="button"
          >
            {busy === "refresh" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <RefreshCw size={15} aria-hidden="true" />
            )}
            重新检查
          </button>
          <button className="btn btn-primary" onClick={() => openCreate(activeKind)} type="button">
            <Plus size={15} aria-hidden="true" />
            新增{kindLabels[activeKind]}
          </button>
        </div>
      </section>

      {actionError ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="story-bible-notice" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="foreshadow-stat-grid" aria-label="账本概况">
        <article className="panel foreshadow-stat">
          <GitCommitHorizontal size={18} aria-hidden="true" />
          <div>
            <strong>{workspace.summary.open}</strong>
            <span>未收束记录</span>
          </div>
          <small>已写到第 {workspace.writtenThroughChapter} 章</small>
        </article>
        <article className="panel foreshadow-stat">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>{workspace.summary.mustPayoff}</strong>
            <span>必须回收</span>
          </div>
          <small>回收率目标 ≥ 90%</small>
        </article>
        <article className="panel foreshadow-stat warning">
          <ClockAlert size={18} aria-hidden="true" />
          <div>
            <strong>{workspace.summary.overdue}</strong>
            <span>逾期未回收</span>
          </div>
          <small>已越过计划回收窗口</small>
        </article>
        <article className="panel foreshadow-stat success">
          <Check size={18} aria-hidden="true" />
          <div>
            <strong>{workspace.summary.paidOff}</strong>
            <span>已回收</span>
          </div>
          <small>保留回收记录与证据</small>
        </article>
      </section>

      <div className="foreshadow-toolbar-row">
        <div className="segmented foreshadow-kind-tabs" role="tablist" aria-label="账本类型">
          {(["plot_thread", "foreshadow", "character_arc"] as const).map((kind) => (
            <button
              aria-selected={activeKind === kind}
              className={`seg${activeKind === kind ? " active" : ""}`}
              key={kind}
              onClick={() => {
                setActiveKind(kind);
                setStatusFilter("");
                setImportanceFilter("");
              }}
              role="tab"
              type="button"
            >
              {kindLabels[kind]}
              <span>{workspace.entries.filter((entry) => entry.kind === kind).length}</span>
            </button>
          ))}
        </div>
        <span className="foreshadow-progress">
          当前进度：写到第 {workspace.writtenThroughChapter} 章
        </span>
      </div>

      <div className="foreshadow-layout">
        <section className="panel foreshadow-main">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">{kindLabels[activeKind]}列表</span>
              <h2>{filteredEntries.length} 条记录</h2>
            </div>
            <div className="foreshadow-filters">
              <label className="mini-search">
                <Search size={14} aria-hidden="true" />
                <span className="sr-only">搜索账本</span>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索名称、人物、势力"
                  value={search}
                />
              </label>
              <label className="sr-only" htmlFor="ledger-status-filter">
                按状态筛选
              </label>
              <select
                className="select"
                id="ledger-status-filter"
                onChange={(event) => setStatusFilter(event.target.value as StoryLedgerStatus | "")}
                value={statusFilter}
              >
                <option value="">全部状态</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {activeKind === "foreshadow" ? (
                <>
                  <label className="sr-only" htmlFor="ledger-importance-filter">
                    按重要程度筛选
                  </label>
                  <select
                    className="select"
                    id="ledger-importance-filter"
                    onChange={(event) =>
                      setImportanceFilter(event.target.value as "must" | "optional" | "")
                    }
                    value={importanceFilter}
                  >
                    <option value="">全部重要程度</option>
                    <option value="must">必须回收</option>
                    <option value="optional">可选回收</option>
                  </select>
                </>
              ) : null}
            </div>
          </div>

          {editForm ? renderEditForm() : null}
          {transitionForm ? renderTransitionForm() : null}

          {filteredEntries.length === 0 ? (
            <div className="foreshadow-empty" data-ledger-empty>
              <GitCommitHorizontal size={26} aria-hidden="true" />
              <strong>还没有{kindLabels[activeKind]}记录</strong>
              <p>先把来源、目标窗口和回收条件写下来。</p>
            </div>
          ) : (
            <div className="foreshadow-list">
              {filteredEntries.map((entry) => renderEntry(entry))}
            </div>
          )}
        </section>

        <aside className="foreshadow-side">
          {createForm ? renderCreateForm() : null}

          <section className="panel foreshadow-check-panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">账本检查</span>
                <h2>需要处理的风险</h2>
              </div>
              <span className="badge alert-badge">{workspace.findings.length}</span>
            </div>
            {workspace.findings.length === 0 ? (
              <p className="foreshadow-side-note">目前没有发现逾期、重复或回收依据不足。</p>
            ) : (
              <div className="foreshadow-checks">
                {workspace.findings.map((finding) => {
                  const entry = workspace.entries.find(
                    (candidate) => candidate.id === finding.entryId,
                  );
                  return (
                    <div
                      className={`foreshadow-check-item severity-${finding.severity}`}
                      data-ledger-finding={finding.code}
                      key={`${finding.entryId}:${finding.code}:${finding.relatedEntryIds.join(",")}`}
                    >
                      <div>
                        <strong>{findingLabels[finding.code]}</strong>
                        <small>{finding.message}</small>
                        <span>{finding.remediation}</span>
                      </div>
                      {entry ? (
                        <button
                          className="icon-btn small"
                          onClick={() => {
                            setActiveKind(entry.kind);
                            setSearch(entry.title);
                          }}
                          title={`定位到${entry.title}`}
                          type="button"
                        >
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel foreshadow-promise-panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">读者承诺</span>
                <h2>这本书答应过什么</h2>
              </div>
            </div>
            {promises.length === 0 ? (
              <p className="foreshadow-side-note">新增伏笔后，这里会汇总承诺类型。</p>
            ) : (
              <div className="foreshadow-promises">
                {promises.map(([promise, count]) => (
                  <button
                    key={promise}
                    onClick={() => {
                      setActiveKind("foreshadow");
                      setSearch(promise);
                    }}
                    type="button"
                  >
                    <span>{promise}</span>
                    <small>{count} 条</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );

  function renderEntry(entry: StoryLedgerEntry) {
    const findings = findingsByEntry.get(entry.id) ?? [];
    const terminal = ["paid_off", "failed_payoff", "abandoned"].includes(entry.status);
    return (
      <article
        className={`foreshadow-row status-${entry.status}`}
        data-ledger-entry-id={entry.id}
        key={entry.id}
      >
        <div className="foreshadow-row-head">
          <div>
            <span className={`badge ledger-status-${entry.status}`}>
              {statusLabels[entry.status]}
            </span>
            <h3>{entry.title}</h3>
          </div>
          <div className="foreshadow-row-tools">
            <button
              aria-label={`编辑${entry.title}`}
              className="icon-btn small"
              onClick={() => openEdit(entry)}
              title="编辑"
              type="button"
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p>{entry.summary || "还没有摘要。"}</p>
        <div className="foreshadow-meta">
          <span>{kindDetail(entry)}</span>
          <span>责任角色：{roleLabels[entry.responsibleRole]}</span>
          <span>
            目标窗口：第 {entry.targetWindow.fromChapter}–{entry.targetWindow.toChapter} 章
          </span>
          <span>
            来源：
            {entry.sourceChapter
              ? `第 ${entry.sourceChapter.number} 章 · ${entry.sourceChapter.title}`
              : entry.sourceEvent?.label || "尚未埋设"}
          </span>
          {entry.kind === "foreshadow" ? <span>读者承诺：{entry.readerPromise}</span> : null}
        </div>
        {findings.length === 0 ? null : (
          <div className="foreshadow-check-tags">
            {findings.map((finding) => (
              <span
                className={`badge severity-${finding.severity}`}
                key={finding.code}
                title={finding.remediation}
              >
                {findingLabels[finding.code]}
              </span>
            ))}
          </div>
        )}
        <details className="foreshadow-history">
          <summary>
            <History size={14} aria-hidden="true" />
            查看推进与证据
            <span>{entry.history.length} 次</span>
          </summary>
          {entry.evidence.length > 0 ? (
            <div className="foreshadow-evidence">
              <span>现有证据</span>
              {entry.evidence.map((evidence, index) => (
                <blockquote key={`${evidence.label}:${index}`}>
                  {evidence.quote || evidence.label}
                </blockquote>
              ))}
            </div>
          ) : null}
          {entry.history.length === 0 ? (
            <p>还没有推进记录。</p>
          ) : (
            <ol>
              {entry.history.map((event) => (
                <li key={event.id}>
                  <strong>{actionLabels[event.action]}</strong>
                  <span>
                    {event.chapter
                      ? `第 ${event.chapter.number} 章 · ${event.chapter.title}`
                      : event.event?.label || "未指定来源"}
                  </span>
                  <p>{event.reason}</p>
                  {event.evidence.length > 0 ? (
                    <blockquote>
                      “{event.evidence[0]?.quote || event.evidence[0]?.label}”
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </details>
        {!terminal ? (
          <div className="foreshadow-actions">
            {entry.status === "planned" ? (
              <button
                className="text-btn"
                onClick={() => openTransition(entry, "setup")}
                type="button"
              >
                埋设
              </button>
            ) : (
              <>
                <button
                  className="text-btn"
                  onClick={() => openTransition(entry, "progress")}
                  type="button"
                >
                  推进
                </button>
                <button
                  className="text-btn"
                  onClick={() => openTransition(entry, "payoff")}
                  type="button"
                >
                  回收
                </button>
                <button
                  className="text-btn danger"
                  onClick={() => openTransition(entry, "fail_payoff")}
                  type="button"
                >
                  失败回收
                </button>
              </>
            )}
            <button
              className="text-btn"
              onClick={() => openTransition(entry, "defer")}
              type="button"
            >
              延期
            </button>
            <button
              className="text-btn danger"
              onClick={() => openTransition(entry, "abandon")}
              type="button"
            >
              放弃
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  function renderCreateForm() {
    if (!createForm) {
      return null;
    }
    const planted = createForm.status === "planted";
    const invalid =
      !createForm.title.trim() ||
      !createForm.summary.trim() ||
      Number(createForm.targetTo) < Number(createForm.targetFrom) ||
      (planted &&
        (!createForm.sourceChapterId || !createForm.reason.trim()) &&
        (!createForm.sourceEventId || !createForm.reason.trim())) ||
      (createForm.kind === "plot_thread" && !createForm.stakes.trim()) ||
      (createForm.kind === "foreshadow" && !createForm.readerPromise.trim()) ||
      (createForm.kind === "character_arc" && !createForm.characterId) ||
      (createForm.kind === "character_arc" &&
        [
          createForm.startState,
          createForm.desire,
          createForm.fear,
          createForm.lie,
          createForm.truth,
          createForm.endState,
        ].some((value) => !value.trim()));
    return (
      <form className="panel foreshadow-form" onSubmit={(event) => void createEntry(event)}>
        <div className="panel-head">
          <div>
            <span className="panel-kicker">新增记录</span>
            <h2>先写清回收条件</h2>
          </div>
          <button
            aria-label="关闭新增表单"
            className="icon-btn small"
            onClick={() => setCreateForm(null)}
            title="关闭"
            type="button"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="foreshadow-form-grid">
          <label>
            <span>记录类型</span>
            <select
              onChange={(event) =>
                setCreateForm((current) =>
                  current
                    ? {
                        ...current,
                        kind: event.target.value as StoryLedgerEntry["kind"],
                      }
                    : current,
                )
              }
              value={createForm.kind}
            >
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>名称</span>
            <input
              maxLength={200}
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, title: event.target.value } : current,
                )
              }
              placeholder="例如：忘川书缺页"
              value={createForm.title}
            />
          </label>
          <label className="foreshadow-form-wide">
            <span>摘要</span>
            <textarea
              maxLength={2000}
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, summary: event.target.value } : current,
                )
              }
              placeholder="这条记录想让读者记住什么？"
              rows={3}
              value={createForm.summary}
            />
          </label>
          <label>
            <span>责任角色</span>
            <select
              onChange={(event) =>
                setCreateForm((current) =>
                  current
                    ? {
                        ...current,
                        responsibleRole: event.target.value as StoryLedgerEntry["responsibleRole"],
                      }
                    : current,
                )
              }
              value={createForm.responsibleRole}
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>当前状态</span>
            <select
              onChange={(event) =>
                setCreateForm((current) =>
                  current
                    ? {
                        ...current,
                        status: event.target.value as "planned" | "planted",
                      }
                    : current,
                )
              }
              value={createForm.status}
            >
              <option value="planned">待埋设</option>
              <option value="planted">已埋设</option>
            </select>
          </label>
          <label>
            <span>目标起始章</span>
            <input
              min="1"
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, targetFrom: event.target.value } : current,
                )
              }
              type="number"
              value={createForm.targetFrom}
            />
          </label>
          <label>
            <span>目标结束章</span>
            <input
              min="1"
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, targetTo: event.target.value } : current,
                )
              }
              type="number"
              value={createForm.targetTo}
            />
          </label>
          <label>
            <span>来源章节</span>
            <select
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, sourceChapterId: event.target.value } : current,
                )
              }
              value={createForm.sourceChapterId}
            >
              <option value="">尚未选择</option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  第 {chapter.number} 章 · {chapter.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>来源事件</span>
            <select
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, sourceEventId: event.target.value } : current,
                )
              }
              value={createForm.sourceEventId}
            >
              <option value="">尚未选择</option>
              {timelineEvents.map((event) => (
                <option key={event.event.id} value={event.event.id}>
                  {event.event.label} · {event.storyTime.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>埋设原因</span>
            <input
              maxLength={1000}
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, reason: event.target.value } : current,
                )
              }
              placeholder="已埋设时必填"
              value={createForm.reason}
            />
          </label>
          <label className="foreshadow-form-wide">
            <span>前置事件</span>
            <select
              multiple
              onChange={(event) =>
                setCreateForm((current) =>
                  current
                    ? {
                        ...current,
                        prerequisiteEventIds: Array.from(
                          event.target.selectedOptions,
                          (option) => option.value,
                        ),
                      }
                    : current,
                )
              }
              size={Math.min(4, Math.max(2, timelineEvents.length))}
              value={createForm.prerequisiteEventIds}
            >
              {timelineEvents.map((event) => (
                <option key={event.event.id} value={event.event.id}>
                  {event.event.label} · {event.storyTime.label}
                </option>
              ))}
            </select>
          </label>
          <label className="foreshadow-form-wide">
            <span>初始证据</span>
            <textarea
              maxLength={5000}
              onChange={(event) =>
                setCreateForm((current) =>
                  current ? { ...current, evidenceQuote: event.target.value } : current,
                )
              }
              placeholder="可选：引用来源章节里能证明这条记录的文字。"
              rows={2}
              value={createForm.evidenceQuote}
            />
          </label>

          {createForm.kind === "foreshadow" ? (
            <>
              <label>
                <span>重要程度</span>
                <select
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current
                        ? {
                            ...current,
                            importance: event.target.value as "must" | "optional",
                          }
                        : current,
                    )
                  }
                  value={createForm.importance}
                >
                  <option value="must">必须回收</option>
                  <option value="optional">可选回收</option>
                </select>
              </label>
              <label>
                <span>读者承诺</span>
                <input
                  maxLength={500}
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current ? { ...current, readerPromise: event.target.value } : current,
                    )
                  }
                  value={createForm.readerPromise}
                />
              </label>
              <label>
                <span>关联人物</span>
                <select
                  multiple
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current
                        ? {
                            ...current,
                            relatedCharacterIds: Array.from(
                              event.target.selectedOptions,
                              (option) => option.value,
                            ),
                          }
                        : current,
                    )
                  }
                  size={Math.min(4, Math.max(2, characterOptions.length))}
                  value={createForm.relatedCharacterIds}
                >
                  {characterOptions.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>关联势力</span>
                <select
                  multiple
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current
                        ? {
                            ...current,
                            relatedFactionIds: Array.from(
                              event.target.selectedOptions,
                              (option) => option.value,
                            ),
                          }
                        : current,
                    )
                  }
                  size={Math.min(4, Math.max(2, factionOptions.length))}
                  value={createForm.relatedFactionIds}
                >
                  {factionOptions.map((faction) => (
                    <option key={faction.id} value={faction.id}>
                      {faction.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {createForm.kind === "plot_thread" ? (
            <>
              <label>
                <span>剧情线类型</span>
                <select
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current
                        ? {
                            ...current,
                            threadType: event.target.value as CreateFormState["threadType"],
                          }
                        : current,
                    )
                  }
                  value={createForm.threadType}
                >
                  {Object.entries(threadTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>张力（0–100）</span>
                <input
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current ? { ...current, tension: event.target.value } : current,
                    )
                  }
                  type="number"
                  value={createForm.tension}
                />
              </label>
              <label className="foreshadow-form-wide">
                <span>赌注</span>
                <textarea
                  maxLength={2000}
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current ? { ...current, stakes: event.target.value } : current,
                    )
                  }
                  rows={2}
                  value={createForm.stakes}
                />
              </label>
            </>
          ) : null}

          {createForm.kind === "character_arc" ? (
            <>
              <label className="foreshadow-form-wide">
                <span>弧光人物</span>
                <select
                  onChange={(event) =>
                    setCreateForm((current) =>
                      current ? { ...current, characterId: event.target.value } : current,
                    )
                  }
                  value={createForm.characterId}
                >
                  <option value="">请选择人物</option>
                  {characterOptions.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["startState", "起点状态"],
                  ["desire", "欲望"],
                  ["fear", "恐惧"],
                  ["lie", "谎言"],
                  ["truth", "真相"],
                  ["endState", "终点状态"],
                ] as const
              ).map(([key, label]) => (
                <label className="foreshadow-form-wide" key={key}>
                  <span>{label}</span>
                  <textarea
                    maxLength={2000}
                    onChange={(event) =>
                      setCreateForm((current) =>
                        current ? { ...current, [key]: event.target.value } : current,
                      )
                    }
                    rows={2}
                    value={createForm[key]}
                  />
                </label>
              ))}
            </>
          ) : null}
        </div>
        {planted && !createForm.sourceChapterId && !createForm.sourceEventId ? (
          <p className="foreshadow-form-hint">已埋设的记录必须选择来源章节或事件。</p>
        ) : null}
        <div className="foreshadow-form-actions">
          <button className="btn btn-ghost" onClick={() => setCreateForm(null)} type="button">
            取消
          </button>
          <button className="btn btn-primary" disabled={invalid || busy === "create"} type="submit">
            {busy === "create" ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
            保存记录
          </button>
        </div>
      </form>
    );
  }

  function renderEditForm() {
    if (!editForm) {
      return null;
    }
    return (
      <form className="foreshadow-inline-form" onSubmit={(event) => void saveEdit(event)}>
        <div className="panel-head">
          <div>
            <span className="panel-kicker">编辑记录</span>
            <h3>{editForm.entry.title}</h3>
          </div>
          <button
            aria-label="关闭编辑表单"
            className="icon-btn small"
            onClick={() => setEditForm(null)}
            title="关闭"
            type="button"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="foreshadow-form-grid">
          <label>
            <span>名称</span>
            <input
              onChange={(event) =>
                setEditForm((current) =>
                  current ? { ...current, title: event.target.value } : current,
                )
              }
              value={editForm.title}
            />
          </label>
          <label>
            <span>目标起始章</span>
            <input
              min="1"
              onChange={(event) =>
                setEditForm((current) =>
                  current ? { ...current, targetFrom: event.target.value } : current,
                )
              }
              type="number"
              value={editForm.targetFrom}
            />
          </label>
          <label>
            <span>目标结束章</span>
            <input
              min="1"
              onChange={(event) =>
                setEditForm((current) =>
                  current ? { ...current, targetTo: event.target.value } : current,
                )
              }
              type="number"
              value={editForm.targetTo}
            />
          </label>
          <label className="foreshadow-form-wide">
            <span>摘要</span>
            <textarea
              onChange={(event) =>
                setEditForm((current) =>
                  current ? { ...current, summary: event.target.value } : current,
                )
              }
              rows={2}
              value={editForm.summary}
            />
          </label>
          {editForm.entry.kind === "foreshadow" ? (
            <>
              <label>
                <span>重要程度</span>
                <select
                  onChange={(event) =>
                    setEditForm((current) =>
                      current
                        ? {
                            ...current,
                            importance: event.target.value as "must" | "optional",
                          }
                        : current,
                    )
                  }
                  value={editForm.importance}
                >
                  <option value="must">必须回收</option>
                  <option value="optional">可选回收</option>
                </select>
              </label>
              <label>
                <span>读者承诺</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) =>
                      current ? { ...current, readerPromise: event.target.value } : current,
                    )
                  }
                  value={editForm.readerPromise}
                />
              </label>
            </>
          ) : null}
          {editForm.entry.kind === "plot_thread" ? (
            <label>
              <span>张力（0–100）</span>
              <input
                max="100"
                min="0"
                onChange={(event) =>
                  setEditForm((current) =>
                    current ? { ...current, tension: event.target.value } : current,
                  )
                }
                type="number"
                value={editForm.tension}
              />
            </label>
          ) : null}
        </div>
        <div className="foreshadow-form-actions">
          <button className="btn btn-ghost" onClick={() => setEditForm(null)} type="button">
            取消
          </button>
          <button className="btn btn-primary" disabled={busy === "edit"} type="submit">
            {busy === "edit" ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : (
              <Save size={14} aria-hidden="true" />
            )}
            保存修改
          </button>
        </div>
      </form>
    );
  }

  function renderTransitionForm() {
    if (!transitionForm) {
      return null;
    }
    const needsSource = transitionForm.action !== "defer";
    const needsEvidence = ["payoff", "fail_payoff"].includes(transitionForm.action);
    return (
      <form className="foreshadow-inline-form" onSubmit={(event) => void submitTransition(event)}>
        <div className="panel-head">
          <div>
            <span className="panel-kicker">{actionLabels[transitionForm.action]}</span>
            <h3>{transitionForm.entry.title}</h3>
          </div>
          <button
            aria-label="关闭推进表单"
            className="icon-btn small"
            onClick={() => setTransitionForm(null)}
            title="关闭"
            type="button"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="foreshadow-form-grid">
          {needsSource ? (
            <label>
              <span>来源章节</span>
              <select
                onChange={(event) =>
                  setTransitionForm((current) =>
                    current ? { ...current, chapterId: event.target.value } : current,
                  )
                }
                value={transitionForm.chapterId}
              >
                <option value="">请选择章节</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    第 {chapter.number} 章 · {chapter.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                <span>新的目标起始章</span>
                <input
                  min="1"
                  onChange={(event) =>
                    setTransitionForm((current) =>
                      current ? { ...current, targetFrom: event.target.value } : current,
                    )
                  }
                  type="number"
                  value={transitionForm.targetFrom}
                />
              </label>
              <label>
                <span>新的目标结束章</span>
                <input
                  min="1"
                  onChange={(event) =>
                    setTransitionForm((current) =>
                      current ? { ...current, targetTo: event.target.value } : current,
                    )
                  }
                  type="number"
                  value={transitionForm.targetTo}
                />
              </label>
            </>
          )}
          <label className="foreshadow-form-wide">
            <span>原因</span>
            <textarea
              maxLength={1000}
              onChange={(event) =>
                setTransitionForm((current) =>
                  current ? { ...current, reason: event.target.value } : current,
                )
              }
              placeholder="写清作者这次推进或变更的判断。"
              rows={2}
              value={transitionForm.reason}
            />
          </label>
          {needsEvidence ? (
            <label className="foreshadow-form-wide">
              <span>回收证据</span>
              <textarea
                maxLength={5000}
                onChange={(event) =>
                  setTransitionForm((current) =>
                    current ? { ...current, quote: event.target.value } : current,
                  )
                }
                placeholder="引用能证明这条记录已经兑现的正文。"
                rows={2}
                value={transitionForm.quote}
              />
            </label>
          ) : null}
        </div>
        <div className="foreshadow-form-actions">
          <button className="btn btn-ghost" onClick={() => setTransitionForm(null)} type="button">
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={
              busy === "transition" ||
              !transitionForm.reason.trim() ||
              (needsSource && !transitionForm.chapterId) ||
              (needsEvidence && !transitionForm.quote.trim()) ||
              (transitionForm.action === "defer" &&
                Number(transitionForm.targetTo) < Number(transitionForm.targetFrom))
            }
            type="submit"
          >
            {busy === "transition" ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            确认{actionLabels[transitionForm.action]}
          </button>
        </div>
      </form>
    );
  }

  function openCreate(kind: StoryLedgerEntry["kind"]) {
    setActionError("");
    setNotice("");
    setEditForm(null);
    setTransitionForm(null);
    setCreateForm({ ...initialCreateForm, kind });
  }

  function openEdit(entry: StoryLedgerEntry) {
    setActionError("");
    setNotice("");
    setCreateForm(null);
    setTransitionForm(null);
    setEditForm({
      entry,
      title: entry.title,
      summary: entry.summary,
      targetFrom: String(entry.targetWindow.fromChapter),
      targetTo: String(entry.targetWindow.toChapter),
      importance: entry.kind === "foreshadow" ? entry.importance : "must",
      readerPromise: entry.kind === "foreshadow" ? entry.readerPromise : "",
      tension: entry.kind === "plot_thread" && entry.tension !== null ? String(entry.tension) : "",
    });
  }

  function openTransition(entry: StoryLedgerEntry, action: StoryLedgerLifecycleAction) {
    setActionError("");
    setNotice("");
    setCreateForm(null);
    setEditForm(null);
    setTransitionForm({
      entry,
      action,
      reason: "",
      chapterId: chapters[0]?.id ?? "",
      quote: "",
      targetFrom: String(entry.targetWindow.fromChapter),
      targetTo: String(entry.targetWindow.toChapter),
    });
  }

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm) {
      return;
    }
    setBusy("create");
    setActionError("");
    setNotice("");
    try {
      const targetWindow = {
        fromChapter: Number(createForm.targetFrom),
        toChapter: Number(createForm.targetTo),
      };
      const evidence = createForm.evidenceQuote.trim()
        ? [
            {
              kind: createForm.sourceChapterId ? "chapter" : "author_note",
              sourceId: createForm.sourceChapterId || null,
              label: createForm.sourceChapterId ? "来源章节" : "作者记录",
              quote: createForm.evidenceQuote.trim(),
              locator: "",
              confidence: null,
              strength: "strong",
            },
          ]
        : [];
      const common: Record<string, unknown> = {
        kind: createForm.kind,
        title: createForm.title.trim(),
        summary: createForm.summary.trim(),
        responsibleRole: createForm.responsibleRole,
        status: createForm.status,
        sourceChapterId: createForm.sourceChapterId || null,
        sourceEventId: createForm.sourceEventId || null,
        targetWindow,
        prerequisiteEventIds: createForm.prerequisiteEventIds,
        evidence,
        ...(createForm.status === "planted" ? { reason: createForm.reason.trim() } : {}),
      };
      let body: Record<string, unknown> = common;
      if (createForm.kind === "foreshadow") {
        body = {
          ...common,
          importance: createForm.importance,
          readerPromise: createForm.readerPromise.trim(),
          relatedCharacterIds: createForm.relatedCharacterIds,
          relatedFactionIds: createForm.relatedFactionIds,
        };
      } else if (createForm.kind === "plot_thread") {
        body = {
          ...common,
          threadType: createForm.threadType,
          stakes: createForm.stakes.trim(),
          tension: optionalNumber(createForm.tension),
        };
      } else {
        body = {
          ...common,
          characterId: createForm.characterId,
          startState: createForm.startState.trim(),
          desire: createForm.desire.trim(),
          fear: createForm.fear.trim(),
          lie: createForm.lie.trim(),
          truth: createForm.truth.trim(),
          endState: createForm.endState.trim(),
        };
      }
      const data = await mutate(`${basePath}/ledger/entries`, "POST", body);
      setWorkspace(data.workspace);
      setActiveKind(data.entry.kind);
      setCreateForm(null);
      setNotice(`${kindLabels[data.entry.kind]}已保存。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm) {
      return;
    }
    setBusy("edit");
    setActionError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {
        kind: editForm.entry.kind,
        version: editForm.entry.version,
        title: editForm.title.trim(),
        summary: editForm.summary.trim(),
        targetWindow: {
          fromChapter: Number(editForm.targetFrom),
          toChapter: Number(editForm.targetTo),
        },
      };
      if (editForm.entry.kind === "foreshadow") {
        body.importance = editForm.importance;
        body.readerPromise = editForm.readerPromise.trim();
      }
      if (editForm.entry.kind === "plot_thread") {
        body.tension = optionalNumber(editForm.tension);
      }
      const data = await mutate(`${basePath}/ledger/entries/${editForm.entry.id}`, "PATCH", body);
      setWorkspace(data.workspace);
      setEditForm(null);
      setNotice("记录已更新。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transitionForm) {
      return;
    }
    setBusy("transition");
    setActionError("");
    setNotice("");
    try {
      const chapter = chapters.find((candidate) => candidate.id === transitionForm.chapterId);
      const needsSource = transitionForm.action !== "defer";
      const evidence =
        ["payoff", "fail_payoff"].includes(transitionForm.action) && chapter
          ? [
              {
                kind: "chapter",
                sourceId: chapter.id,
                label: `第 ${chapter.number} 章`,
                quote: transitionForm.quote.trim(),
                locator: "",
                confidence: null,
                strength: "strong",
              },
            ]
          : [];
      const body: Record<string, unknown> = {
        version: transitionForm.entry.version,
        action: transitionForm.action,
        chapterId: needsSource ? transitionForm.chapterId || null : null,
        eventId: null,
        reason: transitionForm.reason.trim(),
        evidence,
        ...(transitionForm.action === "defer"
          ? {
              targetWindow: {
                fromChapter: Number(transitionForm.targetFrom),
                toChapter: Number(transitionForm.targetTo),
              },
            }
          : {}),
      };
      const data = await mutate(
        `${basePath}/ledger/entries/${transitionForm.entry.id}/transitions`,
        "POST",
        body,
      );
      setWorkspace(data.workspace);
      setTransitionForm(null);
      setNotice("记录状态已更新。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "状态更新失败。");
    } finally {
      setBusy("");
    }
  }

  async function checkAgain() {
    setBusy("refresh");
    setActionError("");
    setNotice("");
    try {
      await refresh();
      try {
        setChapters(
          await fetchAllCursorPages(
            `${basePath}/chapters`,
            chapterWorkspaceListResponseSchema.parse,
            "章节列表加载失败。",
          ),
        );
      } catch {
        // Keep the last successful chapter list when this refresh fails.
      }
      setNotice("检查已刷新。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "检查失败。");
    } finally {
      setBusy("");
    }
  }

  async function mutate(path: string, method: "POST" | "PATCH", body: unknown) {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
        "x-csrf-token": await getCsrfToken(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await readError(response, "保存失败。"));
    }
    return storyLedgerMutationResponseSchema.parse(await response.json()).data;
  }
}

function kindDetail(entry: StoryLedgerEntry): string {
  if (entry.kind === "plot_thread") {
    return `剧情线：${threadTypeLabels[entry.threadType]}`;
  }
  if (entry.kind === "foreshadow") {
    return entry.importance === "must" ? "必须回收" : "可选回收";
  }
  return `人物弧：${entry.character.label ?? "未命名人物"}`;
}

function optionalNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
