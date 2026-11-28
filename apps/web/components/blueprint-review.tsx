"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpenText,
  Check,
  CheckCheck,
  CirclePause,
  CircleSlash2,
  CloudOff,
  Gauge,
  KeyRound,
  ListChecks,
  LoaderCircle,
  PackageOpen,
  PenLine,
  RefreshCw,
  Route,
  Scale,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  STORY_BIBLE_CARD_TITLES,
  apiErrorSchema,
  workBlueprintResponseSchema,
  type BlueprintCoreSettingDraft,
  type BlueprintDraftPatchOperation,
  type BlueprintMissingField,
  type BlueprintOutlineDraft,
  type BlueprintOutlineNodeDraft,
  type BlueprintSceneCardDraft,
  type BlueprintStoryBibleDraft,
  type SettingEntityType,
  type WorkBlueprint,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { settingTypeLabels } from "../lib/setting-labels";
import { requestWorkContextRefresh } from "../lib/work-context-events";
import { fetchWorkOverview } from "../lib/work-api";
import { isWorkReadonly, readonlyScopeLabel } from "../lib/work-presentation";

const STATUS_LABELS: Record<WorkBlueprint["status"], string> = {
  queued: "排队中",
  running: "生成中",
  waiting_model_config: "等待模型配置",
  budget_paused: "预算暂停",
  waiting_review: "待你确认",
  failed: "生成失败",
  confirmed: "已确认",
  cancelled: "已取消",
};

const STEP_LABELS: Record<WorkBlueprint["currentStep"], string> = {
  prepare: "准备生成资料",
  story_bible: "故事圣经",
  core_settings: "核心设定",
  outline: "初始大纲",
  validate: "一致性检查",
  await_review: "等待作者确认",
};

const SEVERITY_LABELS = {
  P0: "必须解决",
  P1: "建议处理",
  P2: "可选优化",
} as const;

const SETTING_ICONS: Record<SettingEntityType, LucideIcon> = {
  world_rule: Scale,
  character: UserRound,
  faction: Shield,
  map: Route,
  power_system: Gauge,
  golden_finger: BookOpenText,
  item: PackageOpen,
  timeline_event: Sparkles,
};

type EditingSection = "story" | "settings" | "outline";
type EditingDraft = {
  storyBible: BlueprintStoryBibleDraft;
  coreSettings: BlueprintCoreSettingDraft[];
  outline: BlueprintOutlineDraft;
};

interface VolumeView {
  volume: BlueprintOutlineNodeDraft;
  acts: BlueprintOutlineNodeDraft[];
  chapters: BlueprintOutlineNodeDraft[];
  scenesByChapter: Map<string, BlueprintOutlineNodeDraft[]>;
  sceneCardsByNode: Map<string, BlueprintSceneCardDraft>;
  contract: BlueprintOutlineDraft["volumeContracts"][number] | null;
}

export function BlueprintReview({ workId }: { workId: string }) {
  const router = useRouter();
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [blueprintState, setBlueprint] = useState<WorkBlueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [selectedVolumeId, setSelectedVolumeId] = useState("");
  const [editingSection, setEditingSection] = useState<EditingSection | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditingDraft | null>(null);
  const [acknowledgingField, setAcknowledgingField] = useState("");
  const [acknowledgementReason, setAcknowledgementReason] = useState("");
  const [budgetTokens, setBudgetTokens] = useState("");
  const [budgetCostCny, setBudgetCostCny] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setEmpty(false);
    try {
      const workData = await fetchWorkOverview(workId);
      setWork(workData);
      await loadBlueprint(workData, setBlueprint, setEmpty);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "故事蓝图加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshBlueprint = useCallback(async () => {
    if (!work) {
      return;
    }
    try {
      await loadBlueprint(work, setBlueprint, setEmpty);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "故事蓝图刷新失败。");
    }
  }, [work]);

  useEffect(() => {
    if (!blueprintState || !["queued", "running"].includes(blueprintState.status)) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshBlueprint();
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [blueprintState, refreshBlueprint]);

  useEffect(() => {
    if (!blueprintState || blueprintState.status !== "budget_paused") {
      return;
    }
    setBudgetTokens(String(Math.min(600_000, Math.ceil(blueprintState.budget.maxTokens * 1.5))));
    setBudgetCostCny(
      Math.min(
        10,
        Math.max(0.1, Number((blueprintState.budget.maxCostCny * 1.25).toFixed(2))),
      ).toFixed(2),
    );
  }, [blueprintState]);

  const outlineView = useMemo(() => {
    const outline =
      editingSection === "outline" && editingDraft
        ? editingDraft.outline
        : (blueprintState?.outlineDraft ?? null);
    return outline ? buildVolumeViews(outline) : [];
  }, [blueprintState?.outlineDraft, editingDraft, editingSection]);

  useEffect(() => {
    if (outlineView.length === 0) {
      setSelectedVolumeId("");
      return;
    }
    if (!outlineView.some((volume) => volume.volume.id === selectedVolumeId)) {
      setSelectedVolumeId(outlineView[0]!.volume.id);
    }
  }, [outlineView, selectedVolumeId]);

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载故事蓝图">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载故事蓝图
      </section>
    );
  }

  if (error || (!work && !empty)) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "故事蓝图加载失败。"}</span>
        <button className="text-btn small" onClick={() => void load()} type="button">
          重试
        </button>
      </section>
    );
  }

  if (!work) {
    return null;
  }

  if (empty || !blueprintState) {
    return (
      <>
        <section className="page-head">
          <div>
            <p className="eyebrow">开书蓝图 · {work.title}</p>
            <h1>审阅故事蓝图</h1>
            <p className="page-sub">这一创作线还没有生成故事蓝图。</p>
          </div>
          <Link className="btn btn-ghost" href={`/workspace/${workId}/overview`}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回作品总览
          </Link>
        </section>
        <section className="panel blueprint-empty">
          <span className="blueprint-status-icon">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <div>
            <h2>还没有故事蓝图</h2>
            <p>使用故事灵感开书后，系统会自动准备故事圣经、核心设定和初始大纲。</p>
          </div>
        </section>
      </>
    );
  }

  const blueprint: WorkBlueprint = blueprintState;
  const readonly = isWorkReadonly(work.status, work.mainBranch.status);
  const canEdit = blueprint.allowedActions.includes("edit") && !readonly;
  const activeVolume =
    outlineView.find((volume) => volume.volume.id === selectedVolumeId) ?? outlineView[0] ?? null;
  const storyCards =
    editingSection === "story" && editingDraft?.storyBible
      ? editingDraft.storyBible.cards
      : (blueprint.storyBibleDraft?.cards ?? []);
  const settings =
    editingSection === "settings" && editingDraft
      ? editingDraft.coreSettings
      : blueprint.coreSettingsDraft;
  const openCriticalConflicts = blueprint.conflicts.filter(
    (conflict) => conflict.severity === "P0" && conflict.status === "open",
  );
  const acknowledgedKeys = new Set(
    blueprint.acknowledgements.map((acknowledgement) => acknowledgement.fieldKey),
  );
  const unacknowledgedRequired = blueprint.missingFields.filter(
    (field) => field.required && !acknowledgedKeys.has(field.key),
  );
  const incompleteStoryCards = storyCards.filter((card) => !card.complete);
  const confirmBlockReason = confirmationBlockReason(
    blueprint,
    openCriticalConflicts.length,
    unacknowledgedRequired.length,
    incompleteStoryCards.length,
  );
  const statusPanel = statusPanelContent(blueprint, openCriticalConflicts.length);
  const StatusIcon = statusPanel.icon;
  const currentStepIndex = Math.max(
    0,
    (
      ["prepare", "story_bible", "core_settings", "outline", "validate", "await_review"] as const
    ).indexOf(blueprint.currentStep) + 1,
  );
  const tokenPercent =
    blueprint.budget.maxTokens > 0
      ? Math.min(100, Math.round((blueprint.cost.totalTokens / blueprint.budget.maxTokens) * 100))
      : 0;
  const costPercent =
    blueprint.budget.maxCostCny > 0
      ? Math.min(100, Math.round((blueprint.cost.costCny / blueprint.budget.maxCostCny) * 100))
      : 0;

  function beginEdit(section: EditingSection) {
    if (!canEdit) {
      return;
    }
    setActionError("");
    if (!blueprint.storyBibleDraft || !blueprint.outlineDraft) {
      setActionError("候选尚未完整生成，暂时不能编辑。");
      return;
    }
    setEditingDraft({
      storyBible: cloneJson(blueprint.storyBibleDraft),
      coreSettings: cloneJson(blueprint.coreSettingsDraft),
      outline: cloneJson(blueprint.outlineDraft),
    });
    setEditingSection(section);
  }

  function cancelEdit() {
    setEditingSection(null);
    setEditingDraft(null);
    setActionError("");
  }

  async function saveEdit() {
    if (!canEdit || !editingSection || !editingDraft) {
      return;
    }
    const operations =
      editingSection === "story"
        ? storyPatchOperations(blueprint, editingDraft.storyBible)
        : editingSection === "settings"
          ? settingPatchOperations(blueprint, editingDraft.coreSettings)
          : outlinePatchOperations(blueprint, editingDraft.outline);
    if (operations.length === 0) {
      cancelEdit();
      return;
    }
    setBusyAction(`save-${editingSection}`);
    setActionError("");
    try {
      const next = await persistDraftOperations(workId, blueprint, operations);
      setBlueprint(next);
      setEditingSection(null);
      setEditingDraft(null);
      requestWorkContextRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "修改保存失败。");
    } finally {
      setBusyAction("");
    }
  }

  async function acknowledgeNotApplicable(field: BlueprintMissingField) {
    const reason = acknowledgementReason.trim();
    if (reason.length < 2) {
      setActionError("请填写至少两个字符的不适用理由。");
      return;
    }
    const existingIndex = blueprint.acknowledgements.findIndex(
      (acknowledgement) => acknowledgement.fieldKey === field.key,
    );
    const operation: BlueprintDraftPatchOperation = {
      op: existingIndex >= 0 ? "replace" : "add",
      path: existingIndex >= 0 ? `/acknowledgements/${existingIndex}` : "/acknowledgements/-",
      value: { fieldKey: field.key, decision: "not_applicable", reason },
    };
    setBusyAction(`acknowledge-${field.key}`);
    setActionError("");
    try {
      const next = await mutateBlueprint(
        blueprintPath(workId, blueprint.branchId, "draft"),
        "PATCH",
        { expectedVersion: blueprint.version, operations: [operation] },
      );
      setBlueprint(next);
      setAcknowledgingField("");
      setAcknowledgementReason("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "不适用理由保存失败。");
    } finally {
      setBusyAction("");
    }
  }

  async function runLifecycleAction(action: "retry" | "cancel" | "budget" | "confirm") {
    if (readonly && action !== "confirm") {
      return;
    }
    setBusyAction(action);
    setActionError("");
    try {
      if (action === "retry") {
        setBlueprint(
          await mutateBlueprint(blueprintPath(workId, blueprint.branchId, "retry"), "POST"),
        );
      } else if (action === "cancel") {
        setBlueprint(
          await mutateBlueprint(blueprintPath(workId, blueprint.branchId, "cancel"), "POST", {
            expectedVersion: blueprint.version,
          }),
        );
      } else if (action === "budget") {
        const maxTokens = Number(budgetTokens);
        const maxCostCny = Number(budgetCostCny);
        if (
          !Number.isInteger(maxTokens) ||
          maxTokens <= blueprint.cost.totalTokens ||
          maxTokens <= blueprint.budget.maxTokens ||
          maxTokens > 600_000 ||
          !Number.isFinite(maxCostCny) ||
          maxCostCny <= blueprint.cost.costCny ||
          maxCostCny <= blueprint.budget.maxCostCny ||
          maxCostCny > 10
        ) {
          throw new Error(
            `预算必须高于已用 ${formatNumber(blueprint.cost.totalTokens)} Token 和 ${formatCny(blueprint.cost.costCny)}，且不超过上限。`,
          );
        }
        setBlueprint(
          await mutateBlueprint(blueprintPath(workId, blueprint.branchId, "budget"), "POST", {
            expectedVersion: blueprint.version,
            maxTokens,
            maxCostCny,
          }),
        );
      } else {
        if (!blueprint.draftHash) {
          throw new Error("故事蓝图仍在更新，请稍后再确认。");
        }
        const next = await mutateBlueprint(
          blueprintPath(workId, blueprint.branchId, "confirm"),
          "POST",
          {
            expectedVersion: blueprint.version,
            draftHash: blueprint.draftHash,
            acknowledgements: blueprint.acknowledgements,
            confirmed: true,
          },
          { "Idempotency-Key": crypto.randomUUID() },
        );
        setBlueprint(next);
        requestWorkContextRefresh();
        router.push(`/workspace/${workId}/overview`);
      }
      requestWorkContextRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败，请重试。");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section
      className="page blueprint-page"
      data-blueprint-status={blueprint.status}
      data-blueprint-version={blueprint.version}
    >
      <div className="page-head blueprint-page-head">
        <div>
          <p className="eyebrow">
            开书蓝图 · {work.title} ·{" "}
            {work.genre === "xianxia" ? "仙侠" : work.genre === "history" ? "历史" : "都市"}
          </p>
          <div className="title-with-badge">
            <h1>审阅故事蓝图</h1>
            <span className={`badge ${blueprint.status === "waiting_review" ? "gold-badge" : ""}`}>
              {STATUS_LABELS[blueprint.status]}
            </span>
            <span className="badge">
              {blueprint.estimate.planned.volumes} 卷 / {blueprint.estimate.planned.chapters} 章
            </span>
          </div>
          <p className="page-sub">
            先看故事圣经、核心设定和初始大纲。确认后这些内容才会成为后续写作基线。
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${workId}/overview`}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回作品总览
          </Link>
          {blueprint.storyBibleDraft || blueprint.outlineDraft ? (
            <button
              className="btn btn-ghost"
              onClick={() =>
                document.getElementById("blueprint-review-gates")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              type="button"
            >
              <ListChecks size={15} aria-hidden="true" />
              查看待处理项
            </button>
          ) : null}
        </div>
      </div>

      {readonly ? (
        <div className="model-notice warning">
          {work.status === "archived"
            ? "作品已归档，当前为只读状态。"
            : work.status === "completed"
              ? "作品已完本，当前为只读状态。"
              : "当前创作线已归档，当前为只读状态。"}
        </div>
      ) : null}

      <article aria-live="polite" className={`panel blueprint-status-card ${statusPanel.tone}`}>
        <span className="blueprint-status-icon">
          <StatusIcon
            className={["queued", "running"].includes(blueprint.status) ? "spin" : undefined}
            size={18}
            aria-hidden="true"
          />
        </span>
        <div className="blueprint-status-copy">
          <span className="panel-kicker">{statusPanel.kicker}</span>
          <h2>{statusPanel.title}</h2>
          <p>{statusPanel.detail}</p>
        </div>
        <div className="blueprint-status-actions">
          {blueprint.status === "waiting_model_config" && !readonly ? (
            <Link
              className="btn btn-primary btn-small"
              href="/workspace/settings/account#model-config-title"
            >
              <Settings size={14} aria-hidden="true" />
              打开模型设置
            </Link>
          ) : null}
          {blueprint.allowedActions.includes("retry") && !readonly ? (
            <button
              className="btn btn-ghost btn-small"
              disabled={busyAction !== ""}
              onClick={() => void runLifecycleAction("retry")}
              type="button"
            >
              {busyAction === "retry" ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              {blueprint.status === "failed"
                ? "从检查点重试"
                : blueprint.status === "waiting_model_config"
                  ? "配置完成后重试"
                  : "重新投递"}
            </button>
          ) : null}
          {blueprint.allowedActions.includes("cancel") && !readonly ? (
            <button
              className="btn btn-ghost btn-small"
              disabled={busyAction !== ""}
              onClick={() => void runLifecycleAction("cancel")}
              type="button"
            >
              {busyAction === "cancel" ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <CircleSlash2 size={14} aria-hidden="true" />
              )}
              {blueprint.status === "running" ? "取消生成" : "取消蓝图"}
            </button>
          ) : null}
          {blueprint.status === "confirmed" && !readonly ? (
            <Link className="btn btn-primary btn-small" href={`/workspace/${workId}/write`}>
              <PenLine size={14} aria-hidden="true" />
              开始写第一章
            </Link>
          ) : null}
        </div>
      </article>

      {blueprint.status === "budget_paused" && !readonly ? (
        <section className="panel blueprint-budget-recovery" aria-label="调整故事蓝图预算">
          <div className="blueprint-inline-recovery">
            <label htmlFor="blueprint-token-budget">Token 上限</label>
            <input
              className="input"
              id="blueprint-token-budget"
              min={Math.max(20_000, blueprint.budget.maxTokens + 1)}
              max={600_000}
              onChange={(event) => setBudgetTokens(event.target.value)}
              step={1_000}
              type="number"
              value={budgetTokens}
            />
            <label htmlFor="blueprint-cost-budget">费用上限（元）</label>
            <input
              className="input"
              id="blueprint-cost-budget"
              min={Math.max(0.1, blueprint.budget.maxCostCny + 0.01)}
              max={10}
              onChange={(event) => setBudgetCostCny(event.target.value)}
              step={0.01}
              type="number"
              value={budgetCostCny}
            />
            <div className="blueprint-inline-actions">
              <button
                className="btn btn-primary btn-small"
                disabled={busyAction !== "" || !blueprint.allowedActions.includes("resume_budget")}
                onClick={() => void runLifecycleAction("budget")}
                type="button"
              >
                {busyAction === "budget" ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : (
                  <CirclePause size={14} aria-hidden="true" />
                )}
                提高预算并继续
              </button>
              <span className="blueprint-budget-help">
                新上限必须高于已用成本，提交后会从当前检查点继续。
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {actionError ? (
        <div className="story-bible-notice danger blueprint-action-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className="blueprint-metric-grid">
        <article className="blueprint-metric" aria-label="故事蓝图生成进度">
          <span>生成进度</span>
          <strong>{blueprint.progress}%</strong>
          <div className="progress jade">
            <span style={{ width: `${blueprint.progress}%` }} />
          </div>
          <small>
            {currentStepIndex} / 6 个阶段 · {STEP_LABELS[blueprint.currentStep]}
          </small>
        </article>
        <article className="blueprint-metric">
          <span>Token 用量</span>
          <strong>{formatNumber(blueprint.cost.totalTokens)}</strong>
          <div className="progress">
            <span style={{ width: `${tokenPercent}%` }} />
          </div>
          <small>预算上限 {formatNumber(blueprint.budget.maxTokens)}</small>
        </article>
        <article className="blueprint-metric">
          <span>费用与预算</span>
          <strong>
            {formatCny(blueprint.cost.costCny)} / {formatCny(blueprint.budget.maxCostCny)}
          </strong>
          <div className="progress gold">
            <span style={{ width: `${costPercent}%` }} />
          </div>
          <small>
            {costPercent >= 100
              ? "已达到预算上限"
              : `预计还会使用约 ${formatCny(Math.max(0, blueprint.estimate.estimatedCostCny - blueprint.cost.costCny))}`}
          </small>
        </article>
        <article className="blueprint-metric blueprint-metric-note">
          <span>当前检查点</span>
          <strong>{STEP_LABELS[blueprint.currentStep]}</strong>
          <small>
            候选版本 v{blueprint.version} · {formatDateTime(blueprint.updatedAt)}
          </small>
        </article>
      </div>

      {storyCards.length === 0 &&
      blueprint.coreSettingsDraft.length === 0 &&
      !blueprint.outlineDraft ? (
        <section className="panel blueprint-empty">
          <span className="blueprint-status-icon">
            <LoaderCircle
              className={["queued", "running"].includes(blueprint.status) ? "spin" : undefined}
              size={18}
              aria-hidden="true"
            />
          </span>
          <div>
            <h2>候选正在准备</h2>
            <p>故事圣经、核心设定和初始大纲完成后会依次出现在这里。</p>
          </div>
        </section>
      ) : (
        <div className="blueprint-review-layout">
          <div className="blueprint-main-column">
            <section className="panel blueprint-section" aria-labelledby="blueprint-story-title">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">故事圣经 · 九卡</span>
                  <h2 id="blueprint-story-title">故事圣经</h2>
                </div>
                <div className="blueprint-panel-meta">
                  <span className="badge jade-badge">
                    {storyCards.filter((card) => card.complete).length} / 9{" "}
                    {blueprint.status === "confirmed" ? "已锁定" : "完整"}
                  </span>
                  <span className="badge">候选 v{blueprint.version}</span>
                </div>
                {canEdit && blueprint.storyBibleDraft ? (
                  <div className="blueprint-edit-actions">
                    {editingSection === "story" ? (
                      <>
                        <button
                          className="btn btn-primary btn-small"
                          disabled={busyAction !== ""}
                          onClick={() => void saveEdit()}
                          type="button"
                        >
                          保存九卡
                        </button>
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={cancelEdit}
                          type="button"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={editingSection !== null}
                        onClick={() => beginEdit("story")}
                        type="button"
                      >
                        <PenLine size={14} aria-hidden="true" />
                        编辑九卡
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              {storyCards.length === 0 ? (
                <p className="blueprint-placeholder">故事圣经正在生成。</p>
              ) : (
                <div className="story-bible-grid">
                  {storyCards.map((card, index) => {
                    const cardTitle = STORY_BIBLE_CARD_TITLES[card.key];
                    return (
                      <article
                        className={`story-bible-card${card.complete ? "" : " is-incomplete"}`}
                        key={card.key}
                      >
                        <div className="story-bible-card-head">
                          <span>
                            <Sparkles size={15} aria-hidden="true" />
                            {cardTitle}
                          </span>
                          <strong>{card.complete ? "完成" : "待补"}</strong>
                        </div>
                        {editingSection === "story" ? (
                          <textarea
                            aria-label={`${cardTitle}内容`}
                            className="input blueprint-card-editor"
                            onChange={(event) => {
                              setEditingDraft((current) => {
                                if (!current) {
                                  return current;
                                }
                                const cards = current.storyBible.cards.map((entry, cardIndex) =>
                                  cardIndex === index
                                    ? {
                                        ...entry,
                                        content: event.target.value,
                                        complete: event.target.value.trim().length > 0,
                                      }
                                    : entry,
                                );
                                return { ...current, storyBible: { cards } };
                              });
                            }}
                            value={card.content}
                          />
                        ) : (
                          <p>{card.content || "等待补全"}</p>
                        )}
                        {card.key === "worldLaws" && card.worldRules.length > 0 ? (
                          <ul className="blueprint-world-rules">
                            {card.worldRules.map((rule) => (
                              <li key={rule.id}>
                                <strong>{rule.name}</strong>
                                <span>{rule.constraint}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="panel blueprint-section" aria-labelledby="blueprint-settings-title">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">核心设定</span>
                  <h2 id="blueprint-settings-title">核心设定候选</h2>
                </div>
                <div className="blueprint-panel-meta">
                  <span className="badge jade-badge">{settings.length} 条候选</span>
                  {unacknowledgedRequired.length > 0 ? (
                    <span className="badge alert-badge">
                      {unacknowledgedRequired.length} 个必填项待处理
                    </span>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="blueprint-edit-actions">
                    {editingSection === "settings" ? (
                      <>
                        <button
                          className="btn btn-primary btn-small"
                          disabled={busyAction !== ""}
                          onClick={() => void saveEdit()}
                          type="button"
                        >
                          保存设定
                        </button>
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={cancelEdit}
                          type="button"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={editingSection !== null}
                        onClick={() => beginEdit("settings")}
                        type="button"
                      >
                        <PenLine size={14} aria-hidden="true" />
                        编辑设定
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              {settings.length === 0 ? (
                <p className="blueprint-placeholder">核心设定正在生成。</p>
              ) : (
                <div className="blueprint-setting-grid">
                  {settings.map((setting, index) => {
                    const Icon = SETTING_ICONS[setting.type];
                    return (
                      <article className="blueprint-setting-card" key={setting.candidateId}>
                        <span className="blueprint-setting-icon">
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        {editingSection === "settings" ? (
                          <div className="blueprint-setting-editor">
                            <label>
                              <span>名称</span>
                              <input
                                className="input"
                                onChange={(event) => {
                                  setEditingDraft((current) => {
                                    if (!current) {
                                      return current;
                                    }
                                    return {
                                      ...current,
                                      coreSettings: current.coreSettings.map(
                                        (entry, settingIndex) =>
                                          settingIndex === index
                                            ? { ...entry, name: event.target.value }
                                            : entry,
                                      ),
                                    };
                                  });
                                }}
                                value={setting.name}
                              />
                            </label>
                            <label>
                              <span>摘要</span>
                              <textarea
                                className="input"
                                onChange={(event) => {
                                  setEditingDraft((current) => {
                                    if (!current) {
                                      return current;
                                    }
                                    return {
                                      ...current,
                                      coreSettings: current.coreSettings.map(
                                        (entry, settingIndex) =>
                                          settingIndex === index
                                            ? { ...entry, summary: event.target.value }
                                            : entry,
                                      ),
                                    };
                                  });
                                }}
                                value={setting.summary}
                              />
                            </label>
                            <label>
                              <span>描述</span>
                              <textarea
                                className="input"
                                onChange={(event) => {
                                  setEditingDraft((current) => {
                                    if (!current) {
                                      return current;
                                    }
                                    return {
                                      ...current,
                                      coreSettings: current.coreSettings.map(
                                        (entry, settingIndex) =>
                                          settingIndex === index
                                            ? { ...entry, description: event.target.value }
                                            : entry,
                                      ),
                                    };
                                  });
                                }}
                                value={setting.description}
                              />
                            </label>
                          </div>
                        ) : (
                          <div>
                            <strong>
                              {settingTypeLabels[setting.type]} · {setting.name}
                            </strong>
                            <p>{setting.summary}</p>
                          </div>
                        )}
                        <span className="state-chip">
                          {setting.required ? "必填" : "候选"} ·{" "}
                          {setting.required ? "已给出" : "可选"}
                        </span>
                      </article>
                    );
                  })}
                </div>
              )}

              {blueprint.missingFields.length > 0 ? (
                <div className="blueprint-missing-list">
                  <h3>需要补齐或说明</h3>
                  {blueprint.missingFields.map((field) => {
                    const acknowledgement = blueprint.acknowledgements.find(
                      (entry) => entry.fieldKey === field.key,
                    );
                    const editingAcknowledgement = acknowledgingField === field.key;
                    return (
                      <article
                        className="blueprint-required-field"
                        data-field-state={acknowledgement ? "not_applicable" : "missing"}
                        key={field.key}
                      >
                        <span className="blueprint-setting-icon">
                          <PackageOpen size={16} aria-hidden="true" />
                        </span>
                        <div>
                          <strong>{authorFacingMissingLabel(field)}</strong>
                          <p>{authorFacingMissingMessage(field)}</p>
                          <span className="state-chip">
                            {acknowledgement
                              ? "已标记不适用"
                              : field.required
                                ? "必填缺失"
                                : "可选提醒"}
                          </span>
                          {acknowledgement ? (
                            <p className="blueprint-na-evidence">{acknowledgement.reason}</p>
                          ) : null}
                        </div>
                        {canEdit ? (
                          <div className="blueprint-required-actions">
                            {editingAcknowledgement ? (
                              <div className="blueprint-na-editor">
                                <label htmlFor={`blueprint-na-${field.key}`}>不适用理由</label>
                                <textarea
                                  className="input"
                                  id={`blueprint-na-${field.key}`}
                                  onChange={(event) => setAcknowledgementReason(event.target.value)}
                                  placeholder="说明为什么这次开书不需要这一项"
                                  rows={2}
                                  value={acknowledgementReason}
                                />
                                <div className="blueprint-na-actions">
                                  <button
                                    className="btn btn-ghost btn-small"
                                    onClick={() => {
                                      setAcknowledgingField("");
                                      setAcknowledgementReason("");
                                    }}
                                    type="button"
                                  >
                                    取消
                                  </button>
                                  <button
                                    className="btn btn-primary btn-small"
                                    disabled={
                                      acknowledgementReason.trim().length < 2 || busyAction !== ""
                                    }
                                    onClick={() => void acknowledgeNotApplicable(field)}
                                    type="button"
                                  >
                                    确认不适用
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="btn btn-ghost btn-small"
                                onClick={() => {
                                  setAcknowledgingField(field.key);
                                  setAcknowledgementReason(acknowledgement?.reason ?? "");
                                }}
                                type="button"
                              >
                                {acknowledgement ? "修改理由" : "标记不适用"}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="panel blueprint-section" aria-labelledby="blueprint-outline-title">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">初始大纲基线</span>
                  <h2 id="blueprint-outline-title">初始大纲基线</h2>
                </div>
                <div className="blueprint-panel-meta">
                  <span className="badge">{outlineView.length} 卷</span>
                  <span className="badge">
                    {outlineView.reduce((sum, volume) => sum + volume.chapters.length, 0)} 章
                  </span>
                  <span className="badge">
                    {outlineView.reduce(
                      (sum, volume) =>
                        sum +
                        [...volume.scenesByChapter.values()].reduce(
                          (sceneSum, scenes) => sceneSum + scenes.length,
                          0,
                        ),
                      0,
                    )}{" "}
                    场景
                  </span>
                </div>
                {canEdit ? (
                  <div className="blueprint-edit-actions">
                    {editingSection === "outline" ? (
                      <>
                        <button
                          className="btn btn-primary btn-small"
                          disabled={busyAction !== ""}
                          onClick={() => void saveEdit()}
                          type="button"
                        >
                          保存章纲
                        </button>
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={cancelEdit}
                          type="button"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={editingSection !== null}
                        onClick={() => beginEdit("outline")}
                        type="button"
                      >
                        <PenLine size={14} aria-hidden="true" />
                        编辑章纲
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              {!activeVolume ? (
                <p className="blueprint-placeholder">初始大纲正在生成。</p>
              ) : (
                <div className="blueprint-outline-board">
                  <div aria-label="初始大纲卷" className="blueprint-volume-list" role="tablist">
                    {outlineView.map((volume, index) => {
                      const active = volume.volume.id === activeVolume.volume.id;
                      return (
                        <button
                          aria-controls="blueprint-volume-detail"
                          aria-selected={active}
                          className={active ? "active" : ""}
                          data-blueprint-volume={index + 1}
                          id={`blueprint-volume-tab-${index + 1}`}
                          key={volume.volume.id}
                          onClick={() => setSelectedVolumeId(volume.volume.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                              return;
                            }
                            event.preventDefault();
                            const offset = event.key === "ArrowRight" ? 1 : -1;
                            const nextIndex =
                              (index + offset + outlineView.length) % outlineView.length;
                            const next = outlineView[nextIndex]!;
                            setSelectedVolumeId(next.volume.id);
                            document
                              .getElementById(`blueprint-volume-tab-${nextIndex + 1}`)
                              ?.focus();
                          }}
                          role="tab"
                          tabIndex={active ? 0 : -1}
                          type="button"
                        >
                          <span>第 {index + 1} 卷</span>
                          <strong>{volume.volume.title}</strong>
                          <small>
                            {volume.chapters.length} 章 ·{" "}
                            {[...volume.scenesByChapter.values()].reduce(
                              (sum, scenes) => sum + scenes.length,
                              0,
                            )}{" "}
                            场景
                          </small>
                        </button>
                      );
                    })}
                  </div>
                  <div
                    aria-labelledby={`blueprint-volume-tab-${outlineView.findIndex((volume) => volume.volume.id === activeVolume.volume.id) + 1}`}
                    className="blueprint-volume-detail"
                    id="blueprint-volume-detail"
                    role="tabpanel"
                  >
                    <div className="blueprint-volume-head">
                      <div>
                        <span className="panel-kicker">
                          第{" "}
                          {outlineView.findIndex(
                            (volume) => volume.volume.id === activeVolume.volume.id,
                          ) + 1}{" "}
                          卷
                        </span>
                        {editingSection === "outline" ? (
                          <input
                            aria-label="卷标题"
                            className="input blueprint-volume-title-editor"
                            onChange={(event) =>
                              updateOutlineNode(
                                activeVolume.volume.id,
                                { title: event.target.value },
                                setEditingDraft,
                              )
                            }
                            value={activeVolume.volume.title}
                          />
                        ) : (
                          <h3>{activeVolume.volume.title}</h3>
                        )}
                      </div>
                      <span className="badge jade-badge">
                        {activeVolume.contract ? "卷契约已生成" : "等待卷契约"}
                      </span>
                    </div>
                    {editingSection === "outline" ? (
                      <textarea
                        aria-label="卷摘要"
                        className="input blueprint-volume-summary-editor"
                        onChange={(event) =>
                          updateOutlineNode(
                            activeVolume.volume.id,
                            { summary: event.target.value },
                            setEditingDraft,
                          )
                        }
                        rows={3}
                        value={activeVolume.volume.summary}
                      />
                    ) : (
                      <p>{activeVolume.volume.summary || "这一卷还没有摘要。"}</p>
                    )}
                    {activeVolume.contract ? (
                      <div className="blueprint-volume-contract">
                        <div>
                          <span>卷目标</span>
                          {editingSection === "outline" ? (
                            <textarea
                              aria-label="卷目标"
                              className="input"
                              onChange={(event) =>
                                updateVolumeContract(
                                  activeVolume.volume.id,
                                  { objective: event.target.value },
                                  setEditingDraft,
                                )
                              }
                              rows={2}
                              value={activeVolume.contract.objective}
                            />
                          ) : (
                            <strong>{activeVolume.contract.objective}</strong>
                          )}
                        </div>
                        <div>
                          <span>核心冲突</span>
                          {editingSection === "outline" ? (
                            <textarea
                              aria-label="卷核心冲突"
                              className="input"
                              onChange={(event) =>
                                updateVolumeContract(
                                  activeVolume.volume.id,
                                  { conflict: event.target.value },
                                  setEditingDraft,
                                )
                              }
                              rows={2}
                              value={activeVolume.contract.conflict}
                            />
                          ) : (
                            <strong>{activeVolume.contract.conflict}</strong>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <div className="blueprint-act-strip" aria-label="本卷三幕">
                      {activeVolume.acts.map((act, index) => (
                        <span key={act.id}>
                          <strong>第 {index + 1} 幕</strong>
                          {act.title}
                        </span>
                      ))}
                    </div>
                    <div className="blueprint-chapter-table">
                      <div className="blueprint-table-head">
                        <span>章节</span>
                        <span>章纲</span>
                        <span>钩子 / 场景</span>
                        <span>状态</span>
                      </div>
                      {activeVolume.chapters.map((chapter) => {
                        const scenes = activeVolume.scenesByChapter.get(chapter.id) ?? [];
                        return (
                          <div className="blueprint-table-row" key={chapter.id}>
                            <strong>第 {chapter.chapterNumber ?? "?"} 章</strong>
                            {editingSection === "outline" ? (
                              <input
                                aria-label={`第 ${chapter.chapterNumber ?? "?"} 章标题`}
                                className="input"
                                onChange={(event) =>
                                  updateOutlineNode(
                                    chapter.id,
                                    { title: event.target.value },
                                    setEditingDraft,
                                  )
                                }
                                value={chapter.title}
                              />
                            ) : (
                              <span>{chapter.title}</span>
                            )}
                            <small>
                              {chapter.brief?.goal || chapter.summary || "等待完整章纲"}
                              {chapter.brief?.requiredFacts.length
                                ? ` · 必用事实：${chapter.brief.requiredFacts.join("、")}`
                                : ""}
                              {` · ${scenes.length} 个场景`}
                              {chapter.hook ? ` · 钩子：${chapter.hook}` : ""}
                            </small>
                            <em>已规划</em>
                            {editingSection === "outline" && chapter.brief ? (
                              <div className="blueprint-chapter-editor">
                                <label>
                                  <span>目标</span>
                                  <textarea
                                    aria-label={`第 ${chapter.chapterNumber ?? "?"} 章目标`}
                                    className="input"
                                    onChange={(event) =>
                                      updateChapterBrief(
                                        chapter.id,
                                        { goal: event.target.value },
                                        setEditingDraft,
                                      )
                                    }
                                    rows={2}
                                    value={chapter.brief.goal}
                                  />
                                </label>
                                <label>
                                  <span>POV</span>
                                  <input
                                    aria-label={`第 ${chapter.chapterNumber ?? "?"} 章视角`}
                                    className="input"
                                    onChange={(event) =>
                                      updateChapterBrief(
                                        chapter.id,
                                        { pov: event.target.value },
                                        setEditingDraft,
                                      )
                                    }
                                    value={chapter.brief.pov}
                                  />
                                </label>
                                <label>
                                  <span>地点</span>
                                  <input
                                    aria-label={`第 ${chapter.chapterNumber ?? "?"} 章地点`}
                                    className="input"
                                    onChange={(event) =>
                                      updateChapterBrief(
                                        chapter.id,
                                        { location: event.target.value },
                                        setEditingDraft,
                                      )
                                    }
                                    value={chapter.brief.location}
                                  />
                                </label>
                                <label>
                                  <span>有序节拍</span>
                                  <textarea
                                    aria-label={`第 ${chapter.chapterNumber ?? "?"} 章节拍`}
                                    className="input"
                                    onChange={(event) =>
                                      updateChapterBrief(
                                        chapter.id,
                                        { sceneBeats: splitMultiline(event.target.value) },
                                        setEditingDraft,
                                      )
                                    }
                                    rows={3}
                                    value={chapter.brief.sceneBeats.join("\n")}
                                  />
                                </label>
                                <label>
                                  <span>必用事实</span>
                                  <textarea
                                    aria-label={`第 ${chapter.chapterNumber ?? "?"} 章必用事实`}
                                    className="input"
                                    onChange={(event) =>
                                      updateChapterBrief(
                                        chapter.id,
                                        { requiredFacts: splitMultiline(event.target.value) },
                                        setEditingDraft,
                                      )
                                    }
                                    rows={2}
                                    value={chapter.brief.requiredFacts.join("\n")}
                                  />
                                </label>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="blueprint-scene-strip">
                      {activeVolume.chapters.flatMap((chapter) =>
                        (activeVolume.scenesByChapter.get(chapter.id) ?? []).map(
                          (scene, sceneIndex) => {
                            const card = activeVolume.sceneCardsByNode.get(scene.id);
                            return (
                              <article className="blueprint-scene-card" key={scene.id}>
                                <div className="blueprint-scene-card-head">
                                  <span>
                                    场景 {chapter.chapterNumber ?? "?"}-{sceneIndex + 1}
                                  </span>
                                  <strong>{card?.title ?? scene.title}</strong>
                                </div>
                                {editingSection === "outline" && card ? (
                                  <div className="blueprint-scene-card-editor">
                                    <label>
                                      <span>标题</span>
                                      <input
                                        aria-label={`场景 ${chapter.chapterNumber ?? "?"}-${sceneIndex + 1} 标题`}
                                        className="input"
                                        onChange={(event) =>
                                          updateSceneCard(
                                            card.nodeId,
                                            { title: event.target.value },
                                            setEditingDraft,
                                          )
                                        }
                                        value={card.title}
                                      />
                                    </label>
                                    <label>
                                      <span>POV</span>
                                      <input
                                        aria-label={`场景 ${chapter.chapterNumber ?? "?"}-${sceneIndex + 1} 视角`}
                                        className="input"
                                        onChange={(event) =>
                                          updateSceneCard(
                                            card.nodeId,
                                            { povLabel: event.target.value },
                                            setEditingDraft,
                                          )
                                        }
                                        value={card.povLabel}
                                      />
                                    </label>
                                    <label>
                                      <span>地点</span>
                                      <input
                                        aria-label={`场景 ${chapter.chapterNumber ?? "?"}-${sceneIndex + 1} 地点`}
                                        className="input"
                                        onChange={(event) =>
                                          updateSceneCard(
                                            card.nodeId,
                                            { locationLabel: event.target.value },
                                            setEditingDraft,
                                          )
                                        }
                                        value={card.locationLabel}
                                      />
                                    </label>
                                    <label>
                                      <span>时间</span>
                                      <input
                                        aria-label={`场景 ${chapter.chapterNumber ?? "?"}-${sceneIndex + 1} 时间`}
                                        className="input"
                                        onChange={(event) =>
                                          updateSceneCard(
                                            card.nodeId,
                                            { storyTime: event.target.value },
                                            setEditingDraft,
                                          )
                                        }
                                        value={card.storyTime}
                                      />
                                    </label>
                                    <label>
                                      <span>有序节拍</span>
                                      <textarea
                                        aria-label={`场景 ${chapter.chapterNumber ?? "?"}-${sceneIndex + 1} 节拍`}
                                        className="input"
                                        onChange={(event) =>
                                          updateSceneCard(
                                            card.nodeId,
                                            { beats: splitMultiline(event.target.value) },
                                            setEditingDraft,
                                          )
                                        }
                                        rows={3}
                                        value={card.beats.join("\n")}
                                      />
                                    </label>
                                    <label>
                                      <span>信息释放</span>
                                      <textarea
                                        aria-label={`场景 ${chapter.chapterNumber ?? "?"}-${sceneIndex + 1} 信息释放`}
                                        className="input"
                                        onChange={(event) =>
                                          updateSceneCard(
                                            card.nodeId,
                                            {
                                              informationReleases: splitMultiline(
                                                event.target.value,
                                              ),
                                            },
                                            setEditingDraft,
                                          )
                                        }
                                        rows={2}
                                        value={card.informationReleases.join("\n")}
                                      />
                                    </label>
                                  </div>
                                ) : card ? (
                                  <dl>
                                    <div>
                                      <dt>POV</dt>
                                      <dd>{card.povLabel}</dd>
                                    </div>
                                    <div>
                                      <dt>地点</dt>
                                      <dd>{card.locationLabel}</dd>
                                    </div>
                                    <div>
                                      <dt>时间</dt>
                                      <dd>{card.storyTime}</dd>
                                    </div>
                                    <div>
                                      <dt>有序节拍</dt>
                                      <dd>{card.beats.join(" → ")}</dd>
                                    </div>
                                    <div>
                                      <dt>信息释放</dt>
                                      <dd>
                                        {card.informationReleases.length > 0
                                          ? card.informationReleases.join("、")
                                          : "无"}
                                      </dd>
                                    </div>
                                  </dl>
                                ) : (
                                  <small>场景卡等待生成</small>
                                )}
                              </article>
                            );
                          },
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section
              aria-labelledby="blueprint-gates-title"
              className="panel blueprint-section"
              id="blueprint-review-gates"
            >
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">缺失项与冲突</span>
                  <h2 id="blueprint-gates-title">确认前还要看什么</h2>
                </div>
                <span className="badge alert-badge">
                  {unacknowledgedRequired.length} 个必填项 · {openCriticalConflicts.length}{" "}
                  条必须解决
                </span>
              </div>
              <div className="blueprint-gate-columns">
                <div className="blueprint-gate-list">
                  <h3>缺失项</h3>
                  {blueprint.missingFields.length === 0 ? (
                    <p className="blueprint-placeholder">当前没有缺失项。</p>
                  ) : (
                    blueprint.missingFields.map((field) => (
                      <article className="blueprint-gate-item" key={field.key}>
                        <span
                          className={`gate-severity ${
                            acknowledgedKeys.has(field.key)
                              ? "optional"
                              : field.required
                                ? "required"
                                : "warning"
                          }`}
                        >
                          {acknowledgedKeys.has(field.key)
                            ? "已处理"
                            : field.required
                              ? "必填"
                              : SEVERITY_LABELS[field.severity]}
                        </span>
                        <div>
                          <strong>{authorFacingMissingLabel(field)}</strong>
                          <small>{authorFacingMissingMessage(field)}</small>
                        </div>
                        {!acknowledgedKeys.has(field.key) && field.required && canEdit ? (
                          <button
                            className="text-btn small"
                            onClick={() => {
                              setAcknowledgingField(field.key);
                              setAcknowledgementReason("");
                            }}
                            type="button"
                          >
                            去处理
                          </button>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
                <div className="blueprint-gate-list">
                  <h3>冲突检查</h3>
                  {blueprint.conflicts.length === 0 ? (
                    <p className="blueprint-placeholder">当前没有发现冲突。</p>
                  ) : (
                    blueprint.conflicts.map((conflict) => (
                      <article
                        className={`blueprint-conflict${
                          conflict.severity === "P0" && conflict.status === "open"
                            ? " is-unresolved"
                            : ""
                        }`}
                        data-conflict-state={conflict.status}
                        data-severity={conflict.severity}
                        key={conflict.id}
                      >
                        <span
                          className={`gate-severity ${
                            conflict.severity === "P0"
                              ? "danger"
                              : conflict.severity === "P1"
                                ? "warning"
                                : "optional"
                          }`}
                        >
                          {conflict.status === "resolved"
                            ? "已解决"
                            : SEVERITY_LABELS[conflict.severity]}
                        </span>
                        <div>
                          <strong>{conflict.title}</strong>
                          <small>{conflict.detail}</small>
                        </div>
                        <span className="badge">
                          {conflict.status === "resolved" ? "留档" : "提醒"}
                        </span>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>

          <aside className="blueprint-rail">
            <section
              className="panel blueprint-confirm-card"
              aria-labelledby="blueprint-confirm-title"
            >
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">确认门禁</span>
                  <h2 id="blueprint-confirm-title">确认蓝图</h2>
                </div>
                <span className={`badge ${confirmBlockReason ? "gold-badge" : "jade-badge"}`}>
                  {confirmBlockReason ? "待处理" : "可确认"}
                </span>
              </div>
              <div className="blueprint-check-list">
                <GateRow
                  complete={incompleteStoryCards.length === 0 && storyCards.length === 9}
                  detail={`${storyCards.filter((card) => card.complete).length} / 9 完整`}
                  label="九卡故事圣经"
                />
                <GateRow
                  complete={unacknowledgedRequired.length === 0}
                  detail={
                    unacknowledgedRequired.length > 0
                      ? `${unacknowledgedRequired.length} 个必填项待处理`
                      : "必填项已给出或已说明"
                  }
                  label="核心设定"
                />
                <GateRow
                  complete={openCriticalConflicts.length === 0}
                  detail={
                    openCriticalConflicts.length > 0
                      ? `${openCriticalConflicts.length} 条未处理`
                      : "必须解决的冲突已处理"
                  }
                  label="必须解决的冲突"
                />
                <GateRow
                  complete={Boolean(blueprint.outlineDraft)}
                  detail={
                    activeVolume
                      ? `${outlineView.length} 卷 / ${outlineView.reduce(
                          (sum, volume) => sum + volume.chapters.length,
                          0,
                        )} 章`
                      : "等待初始大纲"
                  }
                  label="初始大纲"
                />
              </div>
              <div className="blueprint-version-line">
                <span>草案版本</span>
                <strong>v{blueprint.version}</strong>
                <span>确认后</span>
                <strong>锁定并进入总览</strong>
              </div>
              <button
                className="btn btn-primary btn-block"
                disabled={
                  Boolean(confirmBlockReason) ||
                  busyAction !== "" ||
                  readonly ||
                  !blueprint.allowedActions.includes("confirm")
                }
                onClick={() => void runLifecycleAction("confirm")}
                type="button"
              >
                {busyAction === "confirm" ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <BadgeCheck size={15} aria-hidden="true" />
                )}
                确认蓝图
              </button>
              <p className={`blueprint-confirm-reason${confirmBlockReason ? "" : " is-ready"}`}>
                {readonly
                  ? `${readonlyScopeLabel(work.status, work.mainBranch.status)}，不能确认。`
                  : confirmBlockReason || "门禁已通过，可以锁定故事蓝图。"}
              </p>
            </section>

            <section className="panel blueprint-side-note">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">作者提示</span>
                  <h3>确认不会开始写正文</h3>
                </div>
              </div>
              <p>确认只锁定故事圣经、核心设定和初始大纲。第一章正文仍为空，由你之后主动开始。</p>
              <div className="blueprint-side-facts">
                <div>
                  <span>预计章节</span>
                  <strong>{blueprint.estimate.planned.chapters}</strong>
                </div>
                <div>
                  <span>会生成正文</span>
                  <strong>否</strong>
                </div>
                <div>
                  <span>候选来源</span>
                  <strong>本次生成</strong>
                </div>
              </div>
            </section>

            <section className="panel blueprint-side-note blueprint-cost-note">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">费用明细</span>
                  <h3>实际用量</h3>
                </div>
                <span
                  className={`badge ${
                    blueprint.cost.costCny <= blueprint.budget.maxCostCny
                      ? "jade-badge"
                      : "alert-badge"
                  }`}
                >
                  {blueprint.status === "cancelled"
                    ? "已取消 · 不再计费"
                    : blueprint.cost.costCny <= blueprint.budget.maxCostCny
                      ? "预算内"
                      : "已超预算"}
                </span>
              </div>
              <div className="blueprint-cost-rows">
                <div>
                  <span>输入 Token</span>
                  <strong>{formatNumber(blueprint.cost.inputTokens)}</strong>
                </div>
                <div>
                  <span>输出 Token</span>
                  <strong>{formatNumber(blueprint.cost.outputTokens)}</strong>
                </div>
                <div>
                  <span>预估总费用</span>
                  <strong>{formatCny(blueprint.estimate.estimatedCostCny)}</strong>
                </div>
                <div className="total">
                  <span>当前实际费用</span>
                  <strong>{formatCny(blueprint.cost.costCny)}</strong>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

function GateRow({
  complete,
  detail,
  label,
}: {
  complete: boolean;
  detail: string;
  label: string;
}) {
  return (
    <div className={complete ? "is-complete" : "is-warning"}>
      {complete ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <AlertTriangle size={16} aria-hidden="true" />
      )}
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function statusPanelContent(
  blueprint: WorkBlueprint,
  openCriticalConflicts: number,
): {
  detail: string;
  icon: LucideIcon;
  kicker: string;
  title: string;
  tone: string;
} {
  if (blueprint.status === "waiting_review" && openCriticalConflicts > 0) {
    return {
      detail: `有 ${openCriticalConflicts} 条冲突会阻止确认。处理后可继续查看建议项，不必把提醒全部清空。`,
      icon: ShieldAlert,
      kicker: "需要处理冲突",
      title: "候选已齐，先处理必须解决的冲突",
      tone: "tone-red",
    };
  }
  switch (blueprint.status) {
    case "queued":
      return {
        detail: "任务已进入后台队列，关闭页面不会中断生成。",
        icon: LoaderCircle,
        kicker: "后台排队中",
        title: "正在生成故事蓝图",
        tone: "tone-blue",
      };
    case "running":
      return {
        detail: `当前阶段：${STEP_LABELS[blueprint.currentStep]}。关闭页面不会中断任务，完成后会在站内通知。`,
        icon: LoaderCircle,
        kicker: "后台生成中",
        title: "正在整理故事圣经、核心设定和初始大纲",
        tone: "tone-blue",
      };
    case "waiting_model_config":
      return {
        detail: "故事蓝图尚未开始调用模型，也不会消耗费用。配置完成后会从第一步继续。",
        icon: KeyRound,
        kicker: "等待模型配置",
        title: "还差一个可用的模型连接",
        tone: "tone-gold",
      };
    case "budget_paused":
      return {
        detail: "故事圣经和核心设定已保留，提高预算后可从当前检查点继续。",
        icon: CirclePause,
        kicker: "预算暂停",
        title: "下一次模型调用会超过当前预算",
        tone: "tone-gold",
      };
    case "failed":
      return {
        detail: "已完成的候选和检查点都已保留。可以从检查点重试，不会重复已完成的调用。",
        icon: CloudOff,
        kicker: "生成失败",
        title: "故事蓝图生成中断",
        tone: "tone-red",
      };
    case "waiting_review":
      return {
        detail: "九卡故事圣经、核心设定与初始大纲已生成。确认前，它们只作为候选保留。",
        icon: CheckCheck,
        kicker: "生成完成",
        title: "候选已齐，等待你的确认",
        tone: "tone-jade",
      };
    case "confirmed":
      return {
        detail: `${blueprint.confirmedAt ? formatDateTime(blueprint.confirmedAt) : "刚刚"}确认。第一章正文尚未生成，章节状态全部为“已规划”。`,
        icon: BadgeCheck,
        kicker: "蓝图已确认",
        title: "故事圣经、核心设定和初始大纲已锁定",
        tone: "tone-jade",
      };
    case "cancelled":
      return {
        detail: "可以继续查看已完成的候选。取消后不会直接继续生成。",
        icon: CircleSlash2,
        kicker: "已取消生成",
        title: "候选和检查点仍然保留",
        tone: "tone-muted",
      };
  }
}

function confirmationBlockReason(
  blueprint: WorkBlueprint,
  openCriticalConflicts: number,
  unacknowledgedRequired: number,
  incompleteStoryCards: number,
): string {
  if (blueprint.status !== "waiting_review") {
    return "故事蓝图尚未进入作者确认阶段。";
  }
  if (openCriticalConflicts > 0) {
    return `必须先处理 ${openCriticalConflicts} 条必须解决的冲突。`;
  }
  if (unacknowledgedRequired > 0) {
    return `还需要补全或说明 ${unacknowledgedRequired} 个必填项。`;
  }
  if (incompleteStoryCards > 0) {
    return `还有 ${incompleteStoryCards} 张故事圣经卡未完成。`;
  }
  if (!blueprint.storyBibleDraft || !blueprint.outlineDraft) {
    return "候选内容尚未完整生成。";
  }
  if (!blueprint.allowedActions.includes("confirm")) {
    return "当前候选还有未满足的确认条件。";
  }
  return "";
}

const GENRE_MISSING_LABELS: Record<string, string> = {
  blessedLands: "洞天福地",
  factions: "核心势力",
  map: "地图",
  powerSystem: "力量体系",
  specialElements: "题材特有元素",
  world: "世界设定",
};

function authorFacingMissingLabel(field: BlueprintMissingField): string {
  if (/[\u3400-\u9fff]/u.test(field.label)) {
    return field.label;
  }
  const [, key = field.label] = field.key.split(":");
  if (field.key.startsWith("core_setting:")) {
    return settingTypeLabels[key as SettingEntityType] ?? "核心设定";
  }
  if (field.key.startsWith("genre_pack:")) {
    return GENRE_MISSING_LABELS[key] ?? "题材必填项";
  }
  return field.required ? "必填项" : "可选提醒";
}

function authorFacingMissingMessage(field: BlueprintMissingField): string {
  const label = authorFacingMissingLabel(field);
  if (field.key.startsWith("genre_pack:")) {
    return `题材包要求补充${label}，也可以标记不适用并说明理由。`;
  }
  if (field.key.startsWith("core_setting:")) {
    return `核心设定需要补充${label}，也可以标记不适用并说明理由。`;
  }
  return field.message;
}

function buildVolumeViews(outline: BlueprintOutlineDraft): VolumeView[] {
  const childrenByParent = new Map<string, BlueprintOutlineNodeDraft[]>();
  for (const node of outline.nodes) {
    if (!node.parentId) {
      continue;
    }
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.sortOrder - right.sortOrder);
  }
  const sceneCardsByNode = new Map(outline.sceneCards.map((card) => [card.nodeId, card]));
  return outline.nodes
    .filter((node) => node.level === "volume")
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((volume) => {
      const acts = (childrenByParent.get(volume.id) ?? []).filter((node) => node.level === "act");
      const chapters = acts
        .flatMap((act) =>
          (childrenByParent.get(act.id) ?? []).filter((node) => node.level === "chapter"),
        )
        .sort(
          (left, right) =>
            (left.chapterNumber ?? left.sortOrder) - (right.chapterNumber ?? right.sortOrder),
        );
      const scenesByChapter = new Map(
        chapters.map((chapter) => [
          chapter.id,
          (childrenByParent.get(chapter.id) ?? [])
            .filter((node) => node.level === "scene")
            .sort((left, right) => left.sortOrder - right.sortOrder),
        ]),
      );
      const contract =
        outline.volumeContracts.find((candidate) => candidate.nodeId === volume.id) ?? null;
      return {
        volume,
        acts,
        chapters,
        scenesByChapter,
        sceneCardsByNode,
        contract,
      };
    });
}

function storyPatchOperations(
  blueprint: WorkBlueprint,
  draft: BlueprintStoryBibleDraft,
): BlueprintDraftPatchOperation[] {
  return draft.cards.flatMap((card, index) => {
    const original = blueprint.storyBibleDraft?.cards[index];
    const operations: BlueprintDraftPatchOperation[] = [];
    if (card.content !== original?.content) {
      operations.push({
        op: "replace",
        path: `/storyBible/cards/${index}/content`,
        value: card.content,
      });
    }
    if (card.complete !== original?.complete) {
      operations.push({
        op: "replace",
        path: `/storyBible/cards/${index}/complete`,
        value: card.complete,
      });
    }
    return operations;
  });
}

function settingPatchOperations(
  blueprint: WorkBlueprint,
  draft: BlueprintCoreSettingDraft[],
): BlueprintDraftPatchOperation[] {
  return draft.flatMap((setting, index) => {
    const original = blueprint.coreSettingsDraft[index];
    const operations: BlueprintDraftPatchOperation[] = [];
    if (setting.name !== original?.name) {
      operations.push({
        op: "replace",
        path: `/coreSettings/${index}/name`,
        value: setting.name,
      });
    }
    if (setting.summary !== original?.summary) {
      operations.push({
        op: "replace",
        path: `/coreSettings/${index}/summary`,
        value: setting.summary,
      });
    }
    if (setting.description !== original?.description) {
      operations.push({
        op: "replace",
        path: `/coreSettings/${index}/description`,
        value: setting.description,
      });
    }
    return operations;
  });
}

function outlinePatchOperations(
  blueprint: WorkBlueprint,
  draft: BlueprintOutlineDraft,
): BlueprintDraftPatchOperation[] {
  const nodeOperations = draft.nodes.flatMap((node, index) => {
    const original = blueprint.outlineDraft?.nodes[index];
    const operations: BlueprintDraftPatchOperation[] = [];
    if (node.title !== original?.title) {
      operations.push({
        op: "replace",
        path: `/outline/nodes/${index}/title`,
        value: node.title,
      });
    }
    if (node.summary !== original?.summary) {
      operations.push({
        op: "replace",
        path: `/outline/nodes/${index}/summary`,
        value: node.summary,
      });
    }
    if (node.hook !== original?.hook) {
      operations.push({
        op: "replace",
        path: `/outline/nodes/${index}/hook`,
        value: node.hook,
      });
    }
    if (node.foreshadow !== original?.foreshadow) {
      operations.push({
        op: "replace",
        path: `/outline/nodes/${index}/foreshadow`,
        value: node.foreshadow,
      });
    }
    if (node.tension !== original?.tension) {
      operations.push({
        op: "replace",
        path: `/outline/nodes/${index}/tension`,
        value: node.tension,
      });
    }
    if (JSON.stringify(node.brief) !== JSON.stringify(original?.brief)) {
      operations.push({
        op: "replace",
        path: `/outline/nodes/${index}/brief`,
        value: node.brief,
      });
    }
    return operations;
  });
  const contractOperations = draft.volumeContracts.flatMap((contract, index) => {
    const original = blueprint.outlineDraft?.volumeContracts[index];
    const operations: BlueprintDraftPatchOperation[] = [];
    if (contract.objective !== original?.objective) {
      operations.push({
        op: "replace",
        path: `/outline/volumeContracts/${index}/objective`,
        value: contract.objective,
      });
    }
    if (contract.conflict !== original?.conflict) {
      operations.push({
        op: "replace",
        path: `/outline/volumeContracts/${index}/conflict`,
        value: contract.conflict,
      });
    }
    if (JSON.stringify(contract.turningPoints) !== JSON.stringify(original?.turningPoints)) {
      operations.push({
        op: "replace",
        path: `/outline/volumeContracts/${index}/turningPoints`,
        value: contract.turningPoints,
      });
    }
    if (JSON.stringify(contract.exitConditions) !== JSON.stringify(original?.exitConditions)) {
      operations.push({
        op: "replace",
        path: `/outline/volumeContracts/${index}/exitConditions`,
        value: contract.exitConditions,
      });
    }
    return operations;
  });
  const sceneCardOperations = draft.sceneCards.flatMap((card, index) => {
    const original = blueprint.outlineDraft?.sceneCards[index];
    const operations: BlueprintDraftPatchOperation[] = [];
    for (const key of [
      "title",
      "povLabel",
      "locationLabel",
      "storyTime",
      "beats",
      "informationReleases",
      "tension",
    ] as const) {
      if (JSON.stringify(card[key]) !== JSON.stringify(original?.[key])) {
        operations.push({
          op: "replace",
          path: `/outline/sceneCards/${index}/${key}`,
          value: card[key],
        });
      }
    }
    return operations;
  });
  return [...nodeOperations, ...contractOperations, ...sceneCardOperations];
}

function updateOutlineNode(
  nodeId: string,
  patch: Partial<BlueprintOutlineNodeDraft>,
  update: Dispatch<SetStateAction<EditingDraft | null>>,
) {
  update((current) => {
    if (!current) {
      return current;
    }
    return {
      ...current,
      outline: {
        ...current.outline,
        nodes: current.outline.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...patch } : node,
        ),
      },
    };
  });
}

function updateChapterBrief(
  nodeId: string,
  patch: Partial<NonNullable<BlueprintOutlineNodeDraft["brief"]>>,
  update: Dispatch<SetStateAction<EditingDraft | null>>,
) {
  update((current) => {
    if (!current) {
      return current;
    }
    return {
      ...current,
      outline: {
        ...current.outline,
        nodes: current.outline.nodes.map((node) =>
          node.id === nodeId && node.brief ? { ...node, brief: { ...node.brief, ...patch } } : node,
        ),
      },
    };
  });
}

function updateVolumeContract(
  nodeId: string,
  patch: Partial<BlueprintOutlineDraft["volumeContracts"][number]>,
  update: Dispatch<SetStateAction<EditingDraft | null>>,
) {
  update((current) => {
    if (!current) {
      return current;
    }
    return {
      ...current,
      outline: {
        ...current.outline,
        volumeContracts: current.outline.volumeContracts.map((contract) =>
          contract.nodeId === nodeId ? { ...contract, ...patch } : contract,
        ),
      },
    };
  });
}

function updateSceneCard(
  nodeId: string,
  patch: Partial<BlueprintSceneCardDraft>,
  update: Dispatch<SetStateAction<EditingDraft | null>>,
) {
  update((current) => {
    if (!current) {
      return current;
    }
    return {
      ...current,
      outline: {
        ...current.outline,
        sceneCards: current.outline.sceneCards.map((card) =>
          card.nodeId === nodeId ? { ...card, ...patch } : card,
        ),
      },
    };
  });
}

function splitMultiline(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function loadBlueprint(
  work: WorkOverview,
  setBlueprint: (blueprint: WorkBlueprint | null) => void,
  setEmpty: (empty: boolean) => void,
) {
  const response = await fetch(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`,
    { cache: "no-store" },
  );
  if (response.status === 404) {
    setBlueprint(null);
    setEmpty(true);
    return;
  }
  if (!response.ok) {
    throw new Error(await readError(response, "故事蓝图加载失败。"));
  }
  setBlueprint(workBlueprintResponseSchema.parse(await response.json()).data);
  setEmpty(false);
}

async function mutateBlueprint(
  path: string,
  method: "PATCH" | "POST",
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<WorkBlueprint> {
  const response = await fetch(path, {
    method,
    headers: {
      "x-csrf-token": await getCsrfToken(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "故事蓝图操作失败。"));
  }
  return workBlueprintResponseSchema.parse(await response.json()).data;
}

async function persistDraftOperations(
  workId: string,
  blueprint: WorkBlueprint,
  operations: BlueprintDraftPatchOperation[],
): Promise<WorkBlueprint> {
  let current = blueprint;
  for (let index = 0; index < operations.length; index += 100) {
    current = await mutateBlueprint(blueprintPath(workId, current.branchId, "draft"), "PATCH", {
      expectedVersion: current.version,
      operations: operations.slice(index, index + 100),
    });
  }
  return current;
}

function blueprintPath(
  workId: string,
  branchId: string,
  action: "draft" | "retry" | "budget" | "cancel" | "confirm",
): string {
  return `/api/v1/works/${workId}/branches/${branchId}/blueprint/${action}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? authorFacingError(parsed.data.error.message) : fallback;
}

function authorFacingError(message: string): string {
  return message
    .replaceAll("not_applicable", "不适用")
    .replace(/\bP0\b/gu, "必须解决")
    .replace(/\bP1\b/gu, "建议处理")
    .replace(/\bP2\b/gu, "可选优化")
    .replace(/draft hash/giu, "候选版本");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatCny(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
