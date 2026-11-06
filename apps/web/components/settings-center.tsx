"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Circle,
  GitPullRequest,
  Globe2,
  History,
  LoaderCircle,
  Lock,
  Map,
  MessageSquare,
  Pencil,
  Plus,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiErrorSchema,
  characterDetailResponseSchema,
  confirmedSettingListResponseSchema,
  customFieldDefinitionListResponseSchema,
  customFieldDefinitionResponseSchema,
  settingEntityDeleteResponseSchema,
  settingEntityListResponseSchema,
  settingEntityResponseSchema,
  settingChangeRequestListResponseSchema,
  settingChangeRequestResponseSchema,
  settingProposalListResponseSchema,
  settingProposalResponseSchema,
  workResponseSchema,
  type ConfirmedSetting,
  type CharacterDetail,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type SettingChangeRequest,
  type SettingConflictType,
  type SettingEntity,
  type SettingEntityCreateRequest,
  type SettingEntityType,
  type SettingProposal,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

type ColumnKey = "world" | "characters" | "factions" | "map" | "power" | "items" | "timeline";

type ViewMode = "columns" | "confirmed" | "fields";
type EditorMode = "create" | "edit" | "change";

type EditorState = {
  mode: EditorMode;
  entityId?: string;
  version?: number;
  type: SettingEntityType;
  name: string;
  aliases: string;
  summary: string;
  description: string;
  tags: string;
  rule: string;
  bodyState: string;
  knowledgeBoundary: string;
  relationshipSummary: string;
  goldenRules: string;
  cost: string;
  limits: string;
  growth: string;
  details: string;
  itemCategory: string;
  itemGrade: string;
  itemEffect: string;
  itemCost: string;
  itemOwnership: string;
  itemLimits: string;
  timelineEra: string;
  timelineStoryTime: string;
  timelineDuration: string;
  timelineEvent: string;
  customFields: Record<string, CustomFieldValue | null>;
  requestTitle: string;
  requestReason: string;
};

type ProposalInput = {
  reason: string;
  conflictType: SettingConflictType;
  evidenceLabel: string;
  evidenceQuote: string;
};

type FieldFormState = {
  key: string;
  label: string;
  fieldType: CustomFieldDefinition["fieldType"];
  appliesTo: CustomFieldDefinition["appliesTo"];
  required: boolean;
  options: string;
  relationTarget: CustomFieldDefinition["relationTarget"];
  sortOrder: string;
};

const COLUMNS: Array<{
  key: ColumnKey;
  label: string;
  contentLabel: string;
  icon: typeof Globe2;
  supported: boolean;
}> = [
  { key: "world", label: "世界", contentLabel: "世界规则", icon: Globe2, supported: true },
  { key: "factions", label: "势力", contentLabel: "势力", icon: Shield, supported: true },
  { key: "characters", label: "人物", contentLabel: "人物档案", icon: Users, supported: true },
  { key: "map", label: "地图", contentLabel: "地图", icon: Map, supported: true },
  { key: "power", label: "力量体系", contentLabel: "力量体系", icon: Zap, supported: true },
  { key: "items", label: "物品功法", contentLabel: "物品功法", icon: Swords, supported: true },
  { key: "timeline", label: "时间线", contentLabel: "时间线", icon: History, supported: true },
];

const typeLabels: Record<SettingEntityType, string> = {
  world_rule: "世界规则",
  character: "人物档案",
  faction: "势力",
  map: "地图",
  power_system: "力量体系",
  golden_finger: "金手指",
  item: "物品功法",
  timeline_event: "时间线事件",
};

const typeDescriptions: Record<SettingTypeColumn, string> = {
  world_rule: "硬规则与不可违背的世界边界",
  character: "身体状态、知识边界与关系摘要",
  faction: "组织立场、控制范围和人物关系",
  map: "地点层级、路径和场景边界",
  power_system: "层级、路径、突破条件和代价",
  golden_finger: "规则、代价、限制与成长",
  item: "品阶、效果、代价、归属与限制",
  timeline_event: "纪元、故事时间、持续时长与事件",
};

type SettingTypeColumn = SettingEntityType;

const sourceLabels: Record<ConfirmedSetting["source"], string> = {
  author: "作者创建",
  import: "导入识别",
  ai: "AI 提案",
  canon: "章节确认",
};

const statusLabels: Record<SettingEntity["status"], string> = {
  draft: "草稿",
  proposed: "待确认",
  locked: "已锁定",
  discarded: "已废弃",
};

const proposalStatusLabels: Record<SettingProposal["status"], string> = {
  pending: "待裁决",
  accepted: "已确认",
  rejected: "已驳回",
};

const changeRequestStatusLabels: Record<SettingChangeRequest["status"], string> = {
  pending: "待分析",
  approved: "已批准",
  rejected: "已驳回",
  applied: "已应用",
};

const relationshipTypeLabels: Record<
  CharacterDetail["relationships"][number]["relationType"],
  string
> = {
  kinship: "亲属",
  ally: "同盟",
  enemy: "敌对",
  mentor: "师承",
  student: "弟子",
  subordinate: "下级",
  superior: "上级",
  member_of: "隶属",
  located_at: "位于",
  controls: "控制",
  owns: "拥有",
};

const characterStateLabels: Record<
  CharacterDetail["stateTransitions"][number]["stateKind"],
  string
> = {
  body: "身体",
  limb: "肢体",
  location: "位置",
  ability: "能力",
  disguise: "伪装",
};

const knowledgeStateLabels: Record<CharacterDetail["knowledgeStates"][number]["state"], string> = {
  knowledge: "已知",
  belief: "相信",
  suspicion: "怀疑",
  misbelief: "误信",
  unknown: "未知",
};

const customFieldTypeLabels: Record<CustomFieldDefinition["fieldType"], string> = {
  text: "文本",
  long_text: "长文本",
  number: "数字",
  date: "日期",
  single_select: "单选",
  multi_select: "多选",
  boolean: "布尔",
  relation_ref: "关系引用",
};

const appliesToLabels: Record<CustomFieldDefinition["appliesTo"], string> = {
  all: "全部设定",
  world_rule: "世界规则",
  character: "人物",
  faction: "势力",
  map: "地图",
  power_system: "力量体系",
  golden_finger: "金手指",
  item: "物品功法",
  timeline_event: "时间线",
};

const conflictTypeLabels: Record<SettingConflictType, string> = {
  none: "无冲突",
  duplicate_name: "重名",
  alias_collision: "别名冲突",
  contradictory_fact: "事实矛盾",
  import_candidate: "导入候选冲突",
  ai_disagreement: "AI 建议分歧",
};

export function SettingsCenter({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [entities, setEntities] = useState<SettingEntity[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedSetting[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [proposals, setProposals] = useState<SettingProposal[]>([]);
  const [changeRequests, setChangeRequests] = useState<SettingChangeRequest[]>([]);
  const [characterDetail, setCharacterDetail] = useState<CharacterDetail | null>(null);
  const [characterDetailLoading, setCharacterDetailLoading] = useState(false);
  const [characterDetailError, setCharacterDetailError] = useState("");
  const [activeColumn, setActiveColumn] = useState<ColumnKey>("world");
  const [view, setView] = useState<ViewMode>("columns");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse, "作品加载失败。"));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const basePath = settingsPath(workData);
      const [entityResponse, confirmedResponse, fieldResponse] = await Promise.all([
        fetch(`${basePath}/entities`, { cache: "no-store" }),
        fetch(`${basePath}/facts`, { cache: "no-store" }),
        fetch(`${basePath}/custom-fields`, { cache: "no-store" }),
      ]);
      if (!entityResponse.ok) {
        throw new Error(await readError(entityResponse, "设定加载失败。"));
      }
      if (!confirmedResponse.ok) {
        throw new Error(await readError(confirmedResponse, "已确认设定加载失败。"));
      }
      if (!fieldResponse.ok) {
        throw new Error(await readError(fieldResponse, "自定义字段加载失败。"));
      }
      setWork(workData);
      setEntities(settingEntityListResponseSchema.parse(await entityResponse.json()).data);
      setConfirmed(confirmedSettingListResponseSchema.parse(await confirmedResponse.json()).data);
      setCustomFields(
        customFieldDefinitionListResponseSchema.parse(await fieldResponse.json()).data,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设定中心加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshDetail = useCallback(
    async (entityId: string, entityType: SettingEntityType) => {
      if (!work) {
        return;
      }
      const basePath = settingsPath(work);
      const [proposalResponse, changeResponse] = await Promise.all([
        fetch(`${basePath}/entities/${entityId}/proposals`, { cache: "no-store" }),
        fetch(`${basePath}/entities/${entityId}/change-requests`, { cache: "no-store" }),
      ]);
      if (proposalResponse.ok) {
        setProposals(settingProposalListResponseSchema.parse(await proposalResponse.json()).data);
      }
      if (changeResponse.ok) {
        setChangeRequests(
          settingChangeRequestListResponseSchema.parse(await changeResponse.json()).data,
        );
      }
      setCharacterDetail(null);
      setCharacterDetailError("");
      if (entityType !== "character") {
        setCharacterDetailLoading(false);
        return;
      }
      setCharacterDetailLoading(true);
      try {
        const response = await fetch(`${basePath}/characters/${entityId}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readError(response, "人物档案加载失败。"));
        }
        setCharacterDetail(characterDetailResponseSchema.parse(await response.json()).data);
      } catch (caught) {
        setCharacterDetailError(caught instanceof Error ? caught.message : "人物档案加载失败。");
      } finally {
        setCharacterDetailLoading(false);
      }
    },
    [work],
  );

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.id === selectedId) ?? null,
    [entities, selectedId],
  );

  useEffect(() => {
    if (view !== "columns" || !selectedEntity) {
      setProposals([]);
      setChangeRequests([]);
      setCharacterDetail(null);
      setCharacterDetailError("");
      setCharacterDetailLoading(false);
      return;
    }
    void refreshDetail(selectedEntity.id, selectedEntity.type);
  }, [refreshDetail, selectedEntity, view]);

  const counts = useMemo(() => {
    return {
      world: entities.filter((entity) => entity.type === "world_rule").length,
      characters: entities.filter((entity) => entity.type === "character").length,
      factions: entities.filter((entity) => entity.type === "faction").length,
      map: entities.filter((entity) => entity.type === "map").length,
      power: entities.filter(
        (entity) => entity.type === "power_system" || entity.type === "golden_finger",
      ).length,
      items: entities.filter((entity) => entity.type === "item").length,
      timeline: entities.filter((entity) => entity.type === "timeline_event").length,
    } satisfies Record<ColumnKey, number>;
  }, [entities]);

  const selected =
    view === "columns" ? (entities.find((entity) => entity.id === selectedId) ?? null) : null;

  async function refreshProjection() {
    if (!work) {
      return;
    }
    const basePath = settingsPath(work);
    const [entityResponse, confirmedResponse, fieldResponse] = await Promise.all([
      fetch(`${basePath}/entities`, { cache: "no-store" }),
      fetch(`${basePath}/facts`, { cache: "no-store" }),
      fetch(`${basePath}/custom-fields`, { cache: "no-store" }),
    ]);
    if (entityResponse.ok) {
      setEntities(settingEntityListResponseSchema.parse(await entityResponse.json()).data);
    }
    if (confirmedResponse.ok) {
      setConfirmed(confirmedSettingListResponseSchema.parse(await confirmedResponse.json()).data);
    }
    if (fieldResponse.ok) {
      setCustomFields(
        customFieldDefinitionListResponseSchema.parse(await fieldResponse.json()).data,
      );
    }
  }

  async function createEntity() {
    if (!work || !editor) {
      return;
    }
    setBusy("save");
    setActionError("");
    setNotice("");
    try {
      const created = await mutateEntity(
        `${settingsPath(work)}/entities`,
        "POST",
        createPayload(editor),
        "设定创建失败。",
      );
      setEntities((current) => [...current, created]);
      setSelectedId(created.id);
      setActiveColumn(columnForType(created.type));
      setEditor(null);
      setNotice(`“${created.name}”已创建。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function saveEntity() {
    if (!work || !editor || !editor.entityId || !editor.version) {
      return;
    }
    setBusy("save");
    setActionError("");
    setNotice("");
    try {
      if (editor.mode === "change") {
        const request = await mutateChangeRequest(
          `${settingsPath(work)}/entities/${editor.entityId}/change-requests`,
          {
            version: editor.version,
            title: editor.requestTitle.trim(),
            reason: editor.requestReason.trim(),
            after: changePayload(editor),
            conflictType: "none",
            evidence: [authorNote(editor.requestReason)],
          },
          "修改请求提交失败。",
        );
        setChangeRequests((current) => [...current, request]);
        setEditor(null);
        setNotice(`“${request.title}”已提交，等待影响分析。`);
        await refreshDetail(editor.entityId, editor.type);
        return;
      }
      const updated = await mutateEntity(
        `${settingsPath(work)}/entities/${editor.entityId}`,
        "PATCH",
        patchPayload(editor),
        "设定保存失败。",
      );
      setEntities((current) =>
        current.map((entity) => (entity.id === updated.id ? updated : entity)),
      );
      setSelectedId(updated.id);
      setEditor(null);
      setNotice(`“${updated.name}”已保存。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function createProposal(entity: SettingEntity, input: ProposalInput) {
    if (!work) {
      return;
    }
    setBusy(`proposal-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const proposal = await mutateProposal(
        `${settingsPath(work)}/entities/${entity.id}/proposals`,
        {
          version: entity.version,
          reason: input.reason.trim(),
          conflictType: input.conflictType,
          evidence: [
            {
              kind: "author_note",
              sourceId: null,
              label: input.evidenceLabel.trim() || "作者说明",
              quote: input.evidenceQuote.trim() || input.reason.trim(),
              locator: "",
              confidence: null,
            },
          ],
        },
        "提案提交失败。",
      );
      setProposals((current) => [...current, proposal]);
      await refreshProjection();
      await refreshDetail(entity.id, entity.type);
      setNotice(`“${entity.name}”已提交提案，等待裁决。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "提案提交失败。");
    } finally {
      setBusy("");
    }
  }

  async function decideProposal(
    entity: SettingEntity,
    proposal: SettingProposal,
    decision: "accept" | "reject",
    reason: string,
  ) {
    if (!work) {
      return;
    }
    setBusy(`decision-${proposal.id}`);
    setActionError("");
    setNotice("");
    try {
      const decided = await mutateProposal(
        `${settingsPath(work)}/entities/${entity.id}/proposals/${proposal.id}/decision`,
        {
          decision,
          reason: reason.trim() || (decision === "accept" ? "作者确认提案" : "作者驳回提案"),
          conflictType: decision === "accept" ? "none" : proposal.conflictType,
          evidence: proposal.evidence.length > 0 ? proposal.evidence : [authorNote(reason)],
        },
        decision === "accept" ? "提案确认失败。" : "提案驳回失败。",
      );
      setProposals((current) =>
        current.map((candidate) => (candidate.id === decided.id ? decided : candidate)),
      );
      await refreshProjection();
      await refreshDetail(entity.id, entity.type);
      setNotice(decision === "accept" ? "提案已确认并锁定。" : "提案已驳回，设定已废弃。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "提案裁决失败。");
    } finally {
      setBusy("");
    }
  }

  async function createCustomField(form: FieldFormState) {
    if (!work) {
      return;
    }
    setBusy("custom-field");
    setActionError("");
    setNotice("");
    try {
      const definition = await mutateCustomField(
        `${settingsPath(work)}/custom-fields`,
        "POST",
        {
          key: form.key.trim(),
          label: form.label.trim(),
          fieldType: form.fieldType,
          appliesTo: form.appliesTo,
          required: form.required,
          options: splitList(form.options),
          relationTarget: form.relationTarget,
          sortOrder: Number(form.sortOrder) || 0,
        },
        "自定义字段创建失败。",
      );
      setCustomFields((current) => [...current, definition]);
      setNotice(`字段“${definition.label}”已创建。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "自定义字段创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function toggleCustomField(definition: CustomFieldDefinition) {
    if (!work) {
      return;
    }
    setBusy(`field-${definition.id}`);
    setActionError("");
    setNotice("");
    try {
      const updated = await mutateCustomField(
        `${settingsPath(work)}/custom-fields/${definition.id}`,
        "PATCH",
        { schemaVersion: definition.schemaVersion, enabled: !definition.enabled },
        "自定义字段更新失败。",
      );
      setCustomFields((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setNotice(`字段“${updated.label}”已${updated.enabled ? "启用" : "停用"}。`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "自定义字段更新失败。");
    } finally {
      setBusy("");
    }
  }

  async function lockEntity(entity: SettingEntity) {
    if (!work) {
      return;
    }
    setBusy(`lock-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const locked = await mutateEntity(
        `${settingsPath(work)}/entities/${entity.id}/lock`,
        "POST",
        { version: entity.version },
        "设定锁定失败。",
      );
      setEntities((current) =>
        current.map((candidate) => (candidate.id === locked.id ? locked : candidate)),
      );
      setSelectedId(locked.id);
      setEditor(null);
      setNotice(`“${locked.name}”已锁定并进入已确认设定。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定锁定失败。");
    } finally {
      setBusy("");
    }
  }

  async function deleteEntity(entity: SettingEntity) {
    if (!work) {
      return;
    }
    if (!window.confirm(`确定删除“${entity.name}”吗？`)) {
      return;
    }
    setBusy(`delete-${entity.id}`);
    setActionError("");
    setNotice("");
    try {
      const response = await mutateDelete(
        `${settingsPath(work)}/entities/${entity.id}`,
        "设定删除失败。",
      );
      if (!response.deleted) {
        throw new Error("设定删除失败。");
      }
      setEntities((current) => current.filter((candidate) => candidate.id !== entity.id));
      setSelectedId(null);
      setNotice(`“${entity.name}”已删除。`);
      await refreshProjection();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "设定删除失败。");
    } finally {
      setBusy("");
    }
  }

  function selectColumn(key: ColumnKey) {
    setActiveColumn(key);
    setView("columns");
    setEditor(null);
    setActionError("");
  }

  function beginCreate(type: SettingEntityType = "world_rule") {
    setView("columns");
    setEditor(emptyEditor(type));
    setActionError("");
    setNotice("");
  }

  function beginEdit(entity: SettingEntity, focus: "general" | "alias" = "general") {
    setEditor(editorFromEntity(entity));
    setActionError("");
    setNotice("");
    window.setTimeout(() => {
      const id = focus === "alias" ? "setting-aliases" : "setting-name";
      document.getElementById(id)?.focus();
    }, 0);
  }

  function beginChangeRequest(entity: SettingEntity) {
    const next = editorFromEntity(entity);
    next.mode = "change";
    next.requestTitle = `修改“${entity.name}”`;
    next.requestReason = "";
    setEditor(next);
    setActionError("");
    setNotice("");
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载设定中心">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载设定中心
      </section>
    );
  }

  if (error || !work) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "设定中心加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  const activeColumnMeta = COLUMNS.find((column) => column.key === activeColumn) ?? COLUMNS[0]!;
  const visibleEntities = entitiesForColumn(entities, activeColumn);

  return (
    <>
      <section className="page-head settings-head">
        <div>
          <p className="eyebrow">作品设定</p>
          <div className="title-with-badge">
            <h1>设定中心</h1>
            <span className="badge">{work.title}</span>
            <span className="badge">{confirmed.length} 条已确认</span>
          </div>
          <p className="page-sub">把世界规则、人物状态和金手指整理成后续写作能遵守的边界。</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${workId}/overview`}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回总览
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setView("fields");
              setEditor(null);
              setActionError("");
            }}
            type="button"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            自定义字段
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setView("confirmed");
              setEditor(null);
              setActionError("");
            }}
            type="button"
          >
            <Check size={15} aria-hidden="true" />
            查看已确认设定
          </button>
          <button className="btn btn-primary" onClick={() => beginCreate()} type="button">
            <Plus size={15} aria-hidden="true" />
            新增设定
          </button>
        </div>
      </section>

      {actionError ? (
        <div className="settings-center-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="settings-center-notice success" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="settings-workspace-grid">
        <aside className="panel settings-column-nav" aria-label="设定分类">
          <div className="settings-column-nav-head">
            <span className="panel-kicker">设定分类</span>
            <strong>7 个栏目</strong>
          </div>
          {COLUMNS.map((column) => {
            const Icon = column.icon;
            const active = view === "columns" && activeColumn === column.key;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`settings-column-item${active ? " active" : ""}`}
                key={column.key}
                onClick={() => selectColumn(column.key)}
                type="button"
              >
                <Icon size={17} aria-hidden="true" />
                <span>{column.label}</span>
                <small>{counts[column.key]}</small>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            );
          })}
          <div className="settings-column-note">
            <Sparkles size={15} aria-hidden="true" />
            <span>七个栏目都使用真实设定数据；锁定或提案中的条目要先完成状态流转。</span>
          </div>
        </aside>

        <main className="settings-content">
          {view === "confirmed" ? (
            <ConfirmedSettings items={confirmed} />
          ) : view === "fields" ? (
            <CustomFieldsPanel
              busy={busy}
              definitions={customFields}
              onCreate={createCustomField}
              onToggle={toggleCustomField}
            />
          ) : editor ? (
            <SettingEditor
              busy={busy === "save"}
              customFieldDefinitions={customFields}
              editor={editor}
              entities={entities}
              onCancel={() => setEditor(null)}
              onChange={setEditor}
              onSave={() => (editor.mode === "create" ? createEntity() : saveEntity())}
            />
          ) : (
            <section aria-labelledby="settings-column-title">
              <div className="panel settings-column-head">
                <div>
                  <span className="panel-kicker">
                    第 {COLUMNS.indexOf(activeColumnMeta) + 1} 栏
                  </span>
                  <h2 id="settings-column-title">{activeColumnMeta.contentLabel}</h2>
                  <p>{columnDescription(activeColumn)}</p>
                </div>
                {activeColumnMeta.supported ? (
                  <button
                    className="btn btn-primary btn-small"
                    onClick={() => beginCreate(typeForColumn(activeColumn))}
                    type="button"
                  >
                    <Plus size={14} aria-hidden="true" />
                    新增{activeColumnMeta.contentLabel}
                  </button>
                ) : (
                  <span className="badge">后续开放</span>
                )}
              </div>

              {visibleEntities.length === 0 ? (
                <ColumnEmptyState
                  label={activeColumnMeta.contentLabel}
                  onCreate={() => beginCreate(typeForColumn(activeColumn))}
                />
              ) : (
                <div className="settings-entity-list">
                  {visibleEntities.map((entity) => (
                    <EntityCard entity={entity} key={entity.id} onOpen={setSelectedId} />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>

        <aside className="settings-detail-rail" aria-label="设定详情">
          {view === "confirmed" ? (
            <section className="panel settings-detail-empty">
              <Lock size={18} aria-hidden="true" />
              <h2>已确认内容只读</h2>
              <p>这里展示已经锁定的设定，修改需要回到对应栏目发起新的修改。</p>
            </section>
          ) : view === "fields" ? (
            <section className="panel settings-detail-empty">
              <SlidersHorizontal size={18} aria-hidden="true" />
              <h2>字段变更只追加</h2>
              <p>停用字段会保留历史值；新增字段不会破坏已有设定。</p>
            </section>
          ) : selected ? (
            <EntityDetail
              changeRequests={changeRequests}
              busy={busy}
              characterDetail={characterDetail}
              characterDetailError={characterDetailError}
              characterDetailLoading={characterDetailLoading}
              customFieldDefinitions={customFields}
              entity={selected}
              key={selected.id}
              onChangeRequest={() => beginChangeRequest(selected)}
              onCreateProposal={(input) => createProposal(selected, input)}
              onDelete={() => deleteEntity(selected)}
              onDecideProposal={(proposal, decision, reason) =>
                decideProposal(selected, proposal, decision, reason)
              }
              onEdit={() => beginEdit(selected)}
              onEditAlias={() => beginEdit(selected, "alias")}
              onLock={() => lockEntity(selected)}
              onRetryCharacterDetail={() => refreshDetail(selected.id, selected.type)}
              proposals={proposals}
            />
          ) : (
            <section className="panel settings-detail-empty">
              <Circle size={18} aria-hidden="true" />
              <h2>选择一条设定</h2>
              <p>查看状态、来源、版本和类型专属字段。</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function SettingEditor({
  busy,
  customFieldDefinitions,
  editor,
  entities,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  customFieldDefinitions: CustomFieldDefinition[];
  editor: EditorState;
  entities: SettingEntity[];
  onCancel: () => void;
  onChange: (editor: EditorState) => void;
  onSave: () => void;
}) {
  const update = <Key extends keyof EditorState>(field: Key, value: EditorState[Key]) => {
    onChange({ ...editor, [field]: value });
  };
  const applicableFields = customFieldDefinitions.filter(
    (definition) =>
      definition.enabled &&
      (definition.appliesTo === "all" || definition.appliesTo === editor.type),
  );
  const changeMode = editor.mode === "change";

  return (
    <section className="panel settings-editor" aria-labelledby="settings-editor-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">
            {editor.mode === "create" ? "新增设定" : changeMode ? "修改请求" : "编辑设定"}
          </span>
          <h2 id="settings-editor-title">
            {editor.mode === "create"
              ? "先写清最小结构"
              : changeMode
                ? "锁定设定只能提交修改请求"
                : editor.name}
          </h2>
        </div>
        <button className="text-btn small" onClick={onCancel} type="button">
          取消
        </button>
      </div>

      {changeMode ? (
        <div className="settings-form-grid settings-change-request-form">
          <label className="settings-field">
            <span>修改标题</span>
            <input
              maxLength={120}
              onChange={(event) => update("requestTitle", event.target.value)}
              required
              value={editor.requestTitle}
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span>修改原因</span>
            <textarea
              onChange={(event) => update("requestReason", event.target.value)}
              placeholder="说明正文、设定或连续性检查为什么需要这次修改"
              required
              rows={3}
              value={editor.requestReason}
            />
          </label>
        </div>
      ) : null}

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>设定类型</span>
          <select
            disabled={editor.mode !== "create"}
            onChange={(event) => {
              const type = event.target.value as SettingEntityType;
              const next = emptyEditor(type);
              next.mode = editor.mode;
              if (editor.entityId) {
                next.entityId = editor.entityId;
              }
              if (editor.version) {
                next.version = editor.version;
              }
              onChange(next);
            }}
            value={editor.type}
          >
            <option value="world_rule">世界规则</option>
            <option value="character">人物档案</option>
            <option value="faction">势力</option>
            <option value="map">地图</option>
            <option value="power_system">力量体系</option>
            <option value="golden_finger">金手指</option>
            <option value="item">物品功法</option>
            <option value="timeline_event">时间线事件</option>
          </select>
        </label>
        <label className="settings-field">
          <span>名称</span>
          <input
            id="setting-name"
            maxLength={120}
            onChange={(event) => update("name", event.target.value)}
            required
            value={editor.name}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>别名</span>
          <input
            id="setting-aliases"
            onChange={(event) => update("aliases", event.target.value)}
            placeholder="用逗号分隔"
            value={editor.aliases}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>一句话摘要</span>
          <input
            maxLength={500}
            onChange={(event) => update("summary", event.target.value)}
            required
            value={editor.summary}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>详细说明</span>
          <textarea
            onChange={(event) => update("description", event.target.value)}
            rows={3}
            value={editor.description}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>标签</span>
          <input
            onChange={(event) => update("tags", event.target.value)}
            placeholder="用逗号分隔"
            value={editor.tags}
          />
        </label>
      </div>

      <div className="settings-type-fields">
        <h3>{typeLabels[editor.type]}</h3>
        <p>{typeDescriptions[editor.type]}</p>
        {editor.type === "world_rule" ? (
          <label className="settings-field">
            <span>世界规则</span>
            <textarea
              onChange={(event) => update("rule", event.target.value)}
              required
              rows={4}
              value={editor.rule}
            />
          </label>
        ) : editor.type === "character" ? (
          <div className="settings-form-grid">
            <label className="settings-field settings-field-wide">
              <span>当前身体状态</span>
              <textarea
                onChange={(event) => update("bodyState", event.target.value)}
                required
                rows={3}
                value={editor.bodyState}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>知识边界</span>
              <textarea
                onChange={(event) => update("knowledgeBoundary", event.target.value)}
                required
                rows={3}
                value={editor.knowledgeBoundary}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>关系摘要</span>
              <textarea
                onChange={(event) => update("relationshipSummary", event.target.value)}
                required
                rows={3}
                value={editor.relationshipSummary}
              />
            </label>
          </div>
        ) : editor.type === "faction" || editor.type === "map" || editor.type === "power_system" ? (
          <label className="settings-field">
            <span>{typeLabels[editor.type]}</span>
            <textarea
              onChange={(event) => update("details", event.target.value)}
              required
              rows={4}
              value={editor.details}
            />
          </label>
        ) : editor.type === "item" ? (
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>分类</span>
              <input
                onChange={(event) => update("itemCategory", event.target.value)}
                required
                value={editor.itemCategory}
              />
            </label>
            <label className="settings-field">
              <span>品阶</span>
              <input
                onChange={(event) => update("itemGrade", event.target.value)}
                value={editor.itemGrade}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>效果</span>
              <textarea
                onChange={(event) => update("itemEffect", event.target.value)}
                required
                rows={3}
                value={editor.itemEffect}
              />
            </label>
            <label className="settings-field">
              <span>代价</span>
              <textarea
                onChange={(event) => update("itemCost", event.target.value)}
                rows={3}
                value={editor.itemCost}
              />
            </label>
            <label className="settings-field">
              <span>归属</span>
              <input
                onChange={(event) => update("itemOwnership", event.target.value)}
                value={editor.itemOwnership}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>限制</span>
              <textarea
                onChange={(event) => update("itemLimits", event.target.value)}
                rows={3}
                value={editor.itemLimits}
              />
            </label>
          </div>
        ) : editor.type === "timeline_event" ? (
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>纪元</span>
              <input
                onChange={(event) => update("timelineEra", event.target.value)}
                value={editor.timelineEra}
              />
            </label>
            <label className="settings-field">
              <span>故事时间</span>
              <input
                onChange={(event) => update("timelineStoryTime", event.target.value)}
                required
                value={editor.timelineStoryTime}
              />
            </label>
            <label className="settings-field">
              <span>持续时长</span>
              <input
                onChange={(event) => update("timelineDuration", event.target.value)}
                value={editor.timelineDuration}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>事件</span>
              <textarea
                onChange={(event) => update("timelineEvent", event.target.value)}
                required
                rows={4}
                value={editor.timelineEvent}
              />
            </label>
          </div>
        ) : (
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>规则</span>
              <textarea
                onChange={(event) => update("goldenRules", event.target.value)}
                required
                rows={3}
                value={editor.goldenRules}
              />
            </label>
            <label className="settings-field">
              <span>代价</span>
              <textarea
                onChange={(event) => update("cost", event.target.value)}
                required
                rows={3}
                value={editor.cost}
              />
            </label>
            <label className="settings-field">
              <span>限制</span>
              <textarea
                onChange={(event) => update("limits", event.target.value)}
                required
                rows={3}
                value={editor.limits}
              />
            </label>
            <label className="settings-field">
              <span>成长</span>
              <textarea
                onChange={(event) => update("growth", event.target.value)}
                required
                rows={3}
                value={editor.growth}
              />
            </label>
          </div>
        )}
      </div>

      {applicableFields.length > 0 ? (
        <div className="settings-type-fields">
          <h3>自定义字段</h3>
          <p>这些字段会进入设定详情、筛选和后续写作参考。</p>
          <div className="settings-form-grid">
            {applicableFields.map((definition) => (
              <CustomFieldControl
                definition={definition}
                entities={entities}
                key={definition.id}
                onChange={(value) =>
                  update("customFields", { ...editor.customFields, [definition.key]: value })
                }
                value={editor.customFields[definition.key]}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="settings-editor-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel} type="button">
          取消
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={onSave} type="button">
          {busy ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <Check size={15} aria-hidden="true" />
          )}
          {editor.mode === "create" ? "创建设定" : changeMode ? "提交修改请求" : "保存修改"}
        </button>
      </div>
    </section>
  );
}

function CustomFieldControl({
  definition,
  entities,
  onChange,
  value,
}: {
  definition: CustomFieldDefinition;
  entities: SettingEntity[];
  onChange: (value: CustomFieldValue | null) => void;
  value: CustomFieldValue | null | undefined;
}) {
  const label = `${definition.label}${definition.required ? "（必填）" : ""}`;
  if (definition.fieldType === "boolean") {
    return (
      <label className="settings-field settings-check-field">
        <span>{label}</span>
        <input
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
    );
  }
  if (definition.fieldType === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="settings-field settings-field-wide settings-check-group">
        <legend>{label}</legend>
        {definition.options.map((option) => (
          <label key={option}>
            <input
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
              type="checkbox"
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (definition.fieldType === "single_select") {
    return (
      <label className="settings-field">
        <span>{label}</span>
        <select
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          <option value="">请选择</option>
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (definition.fieldType === "relation_ref") {
    const targets = entities.filter((entity) => entity.type === definition.relationTarget);
    return (
      <label className="settings-field">
        <span>{label}</span>
        <select
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          <option value="">请选择</option>
          {targets.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (definition.fieldType === "long_text") {
    return (
      <label className="settings-field settings-field-wide">
        <span>{label}</span>
        <textarea
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
          rows={3}
          value={typeof value === "string" ? value : ""}
        />
      </label>
    );
  }
  const inputType =
    definition.fieldType === "number"
      ? "number"
      : definition.fieldType === "date"
        ? "date"
        : "text";
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        onChange={(event) =>
          onChange(
            definition.fieldType === "number"
              ? event.target.value === ""
                ? null
                : Number(event.target.value)
              : event.target.value === ""
                ? null
                : event.target.value,
          )
        }
        type={inputType}
        value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
      />
    </label>
  );
}

function EntityCard({ entity, onOpen }: { entity: SettingEntity; onOpen: (id: string) => void }) {
  return (
    <article className="panel settings-entity-card">
      <div className="settings-entity-card-head">
        <div>
          <span className="panel-kicker">{typeLabels[entity.type]}</span>
          <h3>{entity.name}</h3>
        </div>
        <span className={`badge settings-status-${entity.status}`}>
          {statusLabels[entity.status]}
        </span>
      </div>
      <p>{entity.summary}</p>
      <div className="settings-entity-meta">
        <span>第 {entity.version} 版</span>
        <span>{sourceLabels[entity.source]}</span>
        <span>{entity.aliases.length > 0 ? `别名：${entity.aliases.join("、")}` : "暂无别名"}</span>
      </div>
      <button className="btn btn-ghost btn-small" onClick={() => onOpen(entity.id)} type="button">
        查看设定详情
      </button>
    </article>
  );
}

function CustomFieldsPanel({
  busy,
  definitions,
  onCreate,
  onToggle,
}: {
  busy: string;
  definitions: CustomFieldDefinition[];
  onCreate: (form: FieldFormState) => void;
  onToggle: (definition: CustomFieldDefinition) => void;
}) {
  const [form, setForm] = useState<FieldFormState>(blankFieldForm());
  const [showForm, setShowForm] = useState(false);
  const update = <Key extends keyof FieldFormState>(field: Key, value: FieldFormState[Key]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="panel settings-custom-fields" aria-labelledby="custom-fields-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">项目级字段</span>
          <h2 id="custom-fields-title">自定义字段</h2>
          <p>让设定结构适配这本书；新增字段只追加，不会改动已有字段和数据。</p>
        </div>
        <button
          className="btn btn-primary btn-small"
          onClick={() => setShowForm((current) => !current)}
          type="button"
        >
          <Plus size={14} aria-hidden="true" />
          新增字段
        </button>
      </div>

      <div className="settings-note">
        <Sparkles size={15} aria-hidden="true" />
        <span>字段会进入设定详情、筛选和后续写作参考，不是普通备注。</span>
      </div>

      {showForm ? (
        <div className="settings-field-form">
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>字段标识</span>
              <input
                onChange={(event) => update("key", event.target.value)}
                placeholder="例如 fate"
                value={form.key}
              />
            </label>
            <label className="settings-field">
              <span>字段名称</span>
              <input
                onChange={(event) => update("label", event.target.value)}
                placeholder="例如 命格"
                value={form.label}
              />
            </label>
            <label className="settings-field">
              <span>字段类型</span>
              <select
                onChange={(event) =>
                  update("fieldType", event.target.value as FieldFormState["fieldType"])
                }
                value={form.fieldType}
              >
                {Object.entries(customFieldTypeLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>适用对象</span>
              <select
                onChange={(event) =>
                  update("appliesTo", event.target.value as FieldFormState["appliesTo"])
                }
                value={form.appliesTo}
              >
                {Object.entries(appliesToLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {form.fieldType === "single_select" || form.fieldType === "multi_select" ? (
              <label className="settings-field settings-field-wide">
                <span>选项</span>
                <input
                  onChange={(event) => update("options", event.target.value)}
                  placeholder="用逗号分隔"
                  value={form.options}
                />
              </label>
            ) : null}
            {form.fieldType === "relation_ref" ? (
              <label className="settings-field">
                <span>关系引用目标</span>
                <select
                  onChange={(event) =>
                    update(
                      "relationTarget",
                      (event.target.value || null) as FieldFormState["relationTarget"],
                    )
                  }
                  value={form.relationTarget ?? ""}
                >
                  <option value="">请选择</option>
                  {Object.entries(appliesToLabels)
                    .filter(([type]) => type !== "all")
                    .map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <label className="settings-field">
              <span>排序</span>
              <input
                min={0}
                onChange={(event) => update("sortOrder", event.target.value)}
                type="number"
                value={form.sortOrder}
              />
            </label>
            <label className="settings-field settings-check-field">
              <span>必填</span>
              <input
                checked={form.required}
                onChange={(event) => update("required", event.target.checked)}
                type="checkbox"
              />
            </label>
          </div>
          <div className="settings-editor-actions">
            <button className="btn btn-ghost" onClick={() => setShowForm(false)} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy === "custom-field"}
              onClick={() => {
                onCreate(form);
                setForm(blankFieldForm());
                setShowForm(false);
              }}
              type="button"
            >
              <Check size={15} aria-hidden="true" />
              创建字段
            </button>
          </div>
        </div>
      ) : null}

      {definitions.length === 0 ? (
        <section className="settings-column-empty">
          <SlidersHorizontal size={20} aria-hidden="true" />
          <h2>还没有自定义字段</h2>
          <p>先创建最小字段，再让设定详情和后续写作逐步使用它。</p>
        </section>
      ) : (
        <div className="settings-custom-field-list">
          <div className="settings-custom-field-head">
            <span>字段</span>
            <span>类型</span>
            <span>适用范围</span>
            <span>规则</span>
            <span>状态</span>
            <span />
          </div>
          {definitions.map((definition) => (
            <div className="settings-custom-field-row" key={definition.id}>
              <div>
                <strong>{definition.label}</strong>
                <small>{definition.key}</small>
              </div>
              <span>{customFieldTypeLabels[definition.fieldType]}</span>
              <span>{appliesToLabels[definition.appliesTo]}</span>
              <span>
                {definition.required ? "必填" : "选填"}
                {definition.options.length > 0 ? ` · ${definition.options.join("、")}` : ""}
              </span>
              <span
                className={`badge ${definition.enabled ? "settings-status-locked" : "settings-status-discarded"}`}
              >
                {definition.enabled ? "启用" : "停用"}
              </span>
              <button
                aria-label={`${definition.enabled ? "停用" : "启用"}${definition.label}`}
                className="text-btn small"
                disabled={busy === `field-${definition.id}`}
                onClick={() => onToggle(definition)}
                type="button"
              >
                {definition.enabled ? "停用" : "启用"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ColumnEmptyState({ label, onCreate }: { label: string; onCreate: () => void }) {
  return (
    <section className="panel settings-column-empty">
      <Circle size={20} aria-hidden="true" />
      <h2>还没有{label}</h2>
      <p>先记录最小必要信息，再逐步补充关系、状态和来源。</p>
      <button className="btn btn-primary btn-small" onClick={onCreate} type="button">
        <Plus size={14} aria-hidden="true" />
        新增{label}
      </button>
    </section>
  );
}

function EntityDetail({
  busy,
  changeRequests,
  characterDetail,
  characterDetailError,
  characterDetailLoading,
  customFieldDefinitions,
  entity,
  onChangeRequest,
  onCreateProposal,
  onDecideProposal,
  onDelete,
  onEdit,
  onEditAlias,
  onLock,
  onRetryCharacterDetail,
  proposals,
}: {
  busy: string;
  changeRequests: SettingChangeRequest[];
  characterDetail: CharacterDetail | null;
  characterDetailError: string;
  characterDetailLoading: boolean;
  customFieldDefinitions: CustomFieldDefinition[];
  entity: SettingEntity;
  onChangeRequest: () => void;
  onCreateProposal: (input: ProposalInput) => void;
  onDecideProposal: (
    proposal: SettingProposal,
    decision: "accept" | "reject",
    reason: string,
  ) => void;
  onDelete: () => void;
  onEdit: () => void;
  onEditAlias: () => void;
  onLock: () => void;
  onRetryCharacterDetail: () => void;
  proposals: SettingProposal[];
}) {
  const locked = entity.status === "locked";
  const proposed = entity.status === "proposed";
  const discarded = entity.status === "discarded";
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalReason, setProposalReason] = useState("");
  const [conflictType, setConflictType] = useState<SettingConflictType>("none");
  const [evidenceLabel, setEvidenceLabel] = useState("作者说明");
  const [evidenceQuote, setEvidenceQuote] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const applicableFields = customFieldDefinitions.filter(
    (definition) =>
      (definition.enabled || entity.customFields[definition.key] !== undefined) &&
      (definition.appliesTo === "all" || definition.appliesTo === entity.type),
  );
  return (
    <section className="panel settings-entity-detail" aria-labelledby="settings-detail-title">
      <div className="settings-detail-head">
        <div>
          <span className="panel-kicker">{typeLabels[entity.type]}</span>
          <h2 id="settings-detail-title">{entity.name}</h2>
        </div>
        <span className={`badge settings-status-${entity.status}`}>
          {statusLabels[entity.status]}
        </span>
      </div>
      <p className="settings-detail-summary">{entity.summary}</p>
      <dl className="settings-detail-meta">
        <div>
          <dt>来源</dt>
          <dd>{sourceLabels[entity.source]}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{statusLabels[entity.status]}</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>第 {entity.version} 版</dd>
        </div>
        <div>
          <dt>别名</dt>
          <dd>{entity.aliases.length > 0 ? entity.aliases.join("、") : "暂无别名"}</dd>
        </div>
      </dl>

      <div className="settings-detail-block">
        <h3>详细说明</h3>
        <p>{entity.description || "尚未补充详细说明。"}</p>
      </div>

      {entity.type === "world_rule" ? (
        <div className="settings-detail-block">
          <h3>世界规则</h3>
          <p>内容：{entity.data.rule}</p>
        </div>
      ) : entity.type === "character" ? (
        <div className="settings-character-domain">
          {characterDetailLoading ? (
            <div className="settings-detail-block settings-character-loading" role="status">
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              <span>正在加载人物档案</span>
            </div>
          ) : characterDetailError ? (
            <div className="settings-detail-block settings-character-error" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{characterDetailError}</span>
              <button className="text-btn small" onClick={onRetryCharacterDetail} type="button">
                重试
              </button>
            </div>
          ) : characterDetail ? (
            <>
              <div className="settings-detail-block">
                <h3>基本档案</h3>
                <dl className="settings-character-grid">
                  <div>
                    <dt>欲望</dt>
                    <dd>{characterDetail.profile.desire || "尚未记录"}</dd>
                  </div>
                  <div>
                    <dt>恐惧</dt>
                    <dd>{characterDetail.profile.fear || "尚未记录"}</dd>
                  </div>
                  <div>
                    <dt>目标</dt>
                    <dd>{characterDetail.profile.goal || "尚未记录"}</dd>
                  </div>
                  <div>
                    <dt>伪装</dt>
                    <dd>{characterDetail.profile.disguise || "尚未记录"}</dd>
                  </div>
                  <div>
                    <dt>声线样本</dt>
                    <dd>{characterDetail.profile.voiceSample || "尚未记录"}</dd>
                  </div>
                  <div>
                    <dt>声线提示</dt>
                    <dd>{characterDetail.profile.voiceGuide || "尚未记录"}</dd>
                  </div>
                </dl>
              </div>

              <div className="settings-detail-block">
                <h3>关系</h3>
                {characterDetail.relationships.length === 0 ? (
                  <p>还没有类型化关系。</p>
                ) : (
                  <ul className="settings-character-records">
                    {characterDetail.relationships.map((relationship) => (
                      <li key={relationship.id}>
                        <div>
                          <strong>
                            {relationshipTypeLabels[relationship.relationType]} ·{" "}
                            {relationship.target.label ?? "未命名目标"}
                          </strong>
                          <span>{formatValidity(relationship.validity)}</span>
                        </div>
                        <small>
                          {relationship.sourceChapterId ? "来源：章节记录" : "来源：作者补录"}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="settings-detail-block">
                <h3>状态历史</h3>
                {characterDetail.stateTransitions.length === 0 ? (
                  <p>还没有身体、位置或能力状态记录。</p>
                ) : (
                  <ul className="settings-character-records">
                    {characterDetail.stateTransitions.map((state) => (
                      <li key={state.id}>
                        <div>
                          <strong>
                            {characterStateLabels[state.stateKind]} · {state.stateKey}
                          </strong>
                          <span>{formatValidity(state.validity)}</span>
                        </div>
                        <p>{state.value}</p>
                        {state.target?.label ? <small>地点：{state.target.label}</small> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="settings-detail-block">
                <h3>角色认知与引用</h3>
                {characterDetail.knowledgeStates.length === 0 ? (
                  <p>还没有角色认知记录。</p>
                ) : (
                  <ul className="settings-character-records">
                    {characterDetail.knowledgeStates.map((state) => (
                      <li key={state.id}>
                        <div>
                          <strong>{knowledgeStateLabels[state.state]}</strong>
                          <span>{formatValidity(state.validity)}</span>
                        </div>
                        <p>{state.claimedContent || "明确记录为未知。"}</p>
                        <small>
                          {state.sourceChapterId ? "来源：章节记录" : "来源：作者补录"} ·{" "}
                          客观事实引用已保留
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="settings-detail-block">
                <h3>设定体检</h3>
                {characterDetail.health.length === 0 ? (
                  <p>基础检查通过。</p>
                ) : (
                  <ul className="settings-health-list">
                    {characterDetail.health.map((finding) => (
                      <li className={`severity-${finding.severity}`} key={finding.code}>
                        <span>{finding.severity === "blocker" ? "阻断" : "提醒"}</span>
                        <p>{finding.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="settings-detail-block">
              <p>尚未载入人物专用档案。</p>
            </div>
          )}
        </div>
      ) : entity.type === "faction" || entity.type === "map" || entity.type === "power_system" ? (
        <div className="settings-detail-block">
          <h3>{typeLabels[entity.type]}</h3>
          <p>{entity.data.details}</p>
        </div>
      ) : entity.type === "item" ? (
        <div className="settings-golden-grid">
          <div>
            <span>分类</span>
            <strong>{entity.data.category}</strong>
          </div>
          <div>
            <span>品阶</span>
            <strong>{entity.data.grade || "未定"}</strong>
          </div>
          <div>
            <span>归属</span>
            <strong>{entity.data.ownership || "未记录"}</strong>
          </div>
          <div>
            <span>效果</span>
            <strong>{entity.data.effect}</strong>
          </div>
          <div>
            <span>代价</span>
            <strong>{entity.data.cost || "未记录"}</strong>
          </div>
          <div>
            <span>限制</span>
            <strong>{entity.data.limits || "未记录"}</strong>
          </div>
        </div>
      ) : entity.type === "timeline_event" ? (
        <div className="settings-golden-grid">
          <div>
            <span>纪元</span>
            <strong>{entity.data.era || "未记录"}</strong>
          </div>
          <div>
            <span>故事时间</span>
            <strong>{entity.data.storyTime}</strong>
          </div>
          <div>
            <span>持续时长</span>
            <strong>{entity.data.duration || "未记录"}</strong>
          </div>
          <div>
            <span>事件</span>
            <strong>{entity.data.event}</strong>
          </div>
        </div>
      ) : (
        <div className="settings-golden-grid">
          <div>
            <span>规则</span>
            <strong>{entity.data.rules}</strong>
          </div>
          <div>
            <span>代价</span>
            <strong>{entity.data.cost}</strong>
          </div>
          <div>
            <span>限制</span>
            <strong>{entity.data.limits}</strong>
          </div>
          <div>
            <span>成长</span>
            <strong>{entity.data.growth}</strong>
          </div>
        </div>
      )}

      {applicableFields.length > 0 ? (
        <div className="settings-detail-block">
          <h3>自定义字段</h3>
          <dl className="settings-detail-meta">
            {applicableFields.map((definition) => (
              <div key={definition.id}>
                <dt>{definition.label}</dt>
                <dd>{formatCustomFieldValue(entity.customFields[definition.key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {proposals.length > 0 ? (
        <div className="settings-detail-block settings-proposal-history">
          <h3>提案与证据</h3>
          {proposals.map((proposal) => {
            const pending = proposal.status === "pending";
            const decisionReason = decisionReasons[proposal.id] ?? "作者确认提案";
            return (
              <article className="settings-proposal-card" key={proposal.id}>
                <div className="settings-proposal-head">
                  <strong>{proposalStatusLabels[proposal.status]}</strong>
                  <span className="badge">{conflictTypeLabels[proposal.conflictType]}</span>
                </div>
                <p>{proposal.reason}</p>
                <ul className="settings-evidence-list">
                  {proposal.evidence.map((evidence, index) => (
                    <li key={`${proposal.id}-${index}`}>
                      <strong>{evidence.label}</strong>
                      <span>{evidence.quote || "未提供摘录"}</span>
                      {evidence.locator ? <small>{evidence.locator}</small> : null}
                    </li>
                  ))}
                </ul>
                {pending && proposed ? (
                  <div className="settings-proposal-decision">
                    <label className="settings-field">
                      <span>裁决理由</span>
                      <input
                        onChange={(event) =>
                          setDecisionReasons((current) => ({
                            ...current,
                            [proposal.id]: event.target.value,
                          }))
                        }
                        value={decisionReason}
                      />
                    </label>
                    {proposal.conflictType !== "none" ? (
                      <p className="settings-inline-warning">
                        该提案仍有冲突，需要先解决冲突才能确认。
                      </p>
                    ) : null}
                    <div className="settings-detail-actions">
                      <button
                        className="btn btn-primary btn-small"
                        disabled={
                          busy === `decision-${proposal.id}` || proposal.conflictType !== "none"
                        }
                        onClick={() => onDecideProposal(proposal, "accept", decisionReason)}
                        type="button"
                      >
                        <Check size={14} aria-hidden="true" />
                        确认提案
                      </button>
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={busy === `decision-${proposal.id}`}
                        onClick={() => onDecideProposal(proposal, "reject", decisionReason)}
                        type="button"
                      >
                        驳回提案
                      </button>
                    </div>
                  </div>
                ) : null}
                {proposal.status !== "pending" && proposal.decisionReason ? (
                  <p className="settings-inline-note">裁决：{proposal.decisionReason}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {changeRequests.length > 0 ? (
        <div className="settings-detail-block settings-change-history">
          <h3>修改请求</h3>
          {changeRequests.map((request) => (
            <article className="settings-change-card" key={request.id}>
              <div className="settings-proposal-head">
                <strong>{request.title}</strong>
                <span className="badge">{changeRequestStatusLabels[request.status]}</span>
              </div>
              <p>{request.reason}</p>
              <dl className="settings-detail-meta">
                <div>
                  <dt>原版本</dt>
                  <dd>第 {request.entityVersion} 版</dd>
                </div>
                <div>
                  <dt>冲突</dt>
                  <dd>{conflictTypeLabels[request.conflictType]}</dd>
                </div>
                <div>
                  <dt>提交时间</dt>
                  <dd>{formatDateTime(request.createdAt)}</dd>
                </div>
              </dl>
              <ul className="settings-evidence-list">
                {request.evidence.map((evidence, index) => (
                  <li key={`${request.id}-${index}`}>
                    <strong>{evidence.label}</strong>
                    <span>{evidence.quote || "未提供摘录"}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {showProposalForm && !locked && !proposed && !discarded ? (
        <div className="settings-proposal-form">
          <h3>提交提案</h3>
          <label className="settings-field settings-field-wide">
            <span>提案理由</span>
            <textarea
              onChange={(event) => setProposalReason(event.target.value)}
              placeholder="说明这条设定为什么需要作者确认"
              rows={3}
              value={proposalReason}
            />
          </label>
          <label className="settings-field">
            <span>冲突类型</span>
            <select
              onChange={(event) => setConflictType(event.target.value as SettingConflictType)}
              value={conflictType}
            >
              {Object.entries(conflictTypeLabels).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>证据来源</span>
            <input
              onChange={(event) => setEvidenceLabel(event.target.value)}
              value={evidenceLabel}
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span>证据摘录</span>
            <textarea
              onChange={(event) => setEvidenceQuote(event.target.value)}
              rows={3}
              value={evidenceQuote}
            />
          </label>
          <div className="settings-detail-actions">
            <button
              className="btn btn-primary btn-small"
              disabled={busy === `proposal-${entity.id}` || proposalReason.trim().length === 0}
              onClick={() => {
                onCreateProposal({
                  reason: proposalReason,
                  conflictType,
                  evidenceLabel,
                  evidenceQuote,
                });
                setShowProposalForm(false);
              }}
              type="button"
            >
              <MessageSquare size={14} aria-hidden="true" />
              提交提案
            </button>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => setShowProposalForm(false)}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="settings-detail-actions">
        {locked ? (
          <>
            <button className="btn btn-ghost btn-small" disabled type="button">
              <Lock size={14} aria-hidden="true" />
              已锁定 · 别名需修改请求
            </button>
            <button className="btn btn-ghost btn-small" disabled type="button">
              <Lock size={14} aria-hidden="true" />
              已锁定 · 删除需修改请求
            </button>
            <button className="btn btn-primary btn-small" disabled type="button">
              <Lock size={14} aria-hidden="true" />
              已锁定 · 编辑需修改请求
            </button>
            <button className="btn btn-primary btn-small" onClick={onChangeRequest} type="button">
              <GitPullRequest size={14} aria-hidden="true" />
              发起修改请求
            </button>
          </>
        ) : proposed ? (
          <p className="settings-inline-note">待确认提案正在等待裁决，完成后才能继续编辑。</p>
        ) : discarded ? (
          <p className="settings-inline-note">这条设定已废弃，不能再编辑或锁定。</p>
        ) : (
          <>
            <button className="btn btn-ghost btn-small" onClick={onEditAlias} type="button">
              <Pencil size={14} aria-hidden="true" />
              编辑别名
            </button>
            <button
              className="btn btn-ghost btn-small"
              disabled={busy === `delete-${entity.id}`}
              onClick={onDelete}
              type="button"
            >
              删除设定
            </button>
            <button className="btn btn-ghost btn-small" onClick={onEdit} type="button">
              <Pencil size={14} aria-hidden="true" />
              编辑设定
            </button>
            <button
              className="btn btn-primary btn-small"
              disabled={busy === `lock-${entity.id}`}
              onClick={onLock}
              type="button"
            >
              {busy === `lock-${entity.id}` ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <Lock size={14} aria-hidden="true" />
              )}
              锁定设定
            </button>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => setShowProposalForm((current) => !current)}
              type="button"
            >
              <MessageSquare size={14} aria-hidden="true" />
              提交提案
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function ConfirmedSettings({ items }: { items: ConfirmedSetting[] }) {
  return (
    <section className="panel confirmed-settings" aria-labelledby="confirmed-settings-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">只读视图</span>
          <h2 id="confirmed-settings-title">已确认设定</h2>
          <p>这里的内容已锁定，后续写作会把它作为稳定边界。</p>
        </div>
        <span className="badge">{items.length} 条</span>
      </div>
      {items.length === 0 ? (
        <div className="confirmed-settings-empty">
          <Check size={18} aria-hidden="true" />
          <p>还没有已确认设定。锁定世界规则、人物档案或金手指后会出现在这里。</p>
        </div>
      ) : (
        <div className="confirmed-settings-list">
          {items.map((item) => (
            <article key={item.id}>
              <div>
                <span className="tag">
                  {item.kind === "fact" ? "章节事实" : typeLabels[item.type]}
                </span>
                <strong>{item.name}</strong>
              </div>
              <p>{item.summary}</p>
              <div className="confirmed-setting-meta">
                <span>来源：{sourceLabels[item.source]}</span>
                <span>状态：已确认</span>
                <span>第 {item.version} 版</span>
                <span>{formatDateTime(item.lockedAt)} 锁定</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function emptyEditor(type: SettingEntityType): EditorState {
  return {
    mode: "create",
    type,
    name: "",
    aliases: "",
    summary: "",
    description: "",
    tags: "",
    rule: "",
    bodyState: "",
    knowledgeBoundary: "",
    relationshipSummary: "",
    goldenRules: "",
    cost: "",
    limits: "",
    growth: "",
    details: "",
    itemCategory: "",
    itemGrade: "",
    itemEffect: "",
    itemCost: "",
    itemOwnership: "",
    itemLimits: "",
    timelineEra: "",
    timelineStoryTime: "",
    timelineDuration: "",
    timelineEvent: "",
    customFields: {},
    requestTitle: "",
    requestReason: "",
  };
}

function editorFromEntity(entity: SettingEntity): EditorState {
  return {
    mode: "edit",
    entityId: entity.id,
    version: entity.version,
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases.join("，"),
    summary: entity.summary,
    description: entity.description,
    tags: entity.tags.join("，"),
    rule: entity.type === "world_rule" ? entity.data.rule : "",
    bodyState: entity.type === "character" ? entity.data.bodyState : "",
    knowledgeBoundary: entity.type === "character" ? entity.data.knowledgeBoundary : "",
    relationshipSummary: entity.type === "character" ? entity.data.relationshipSummary : "",
    goldenRules: entity.type === "golden_finger" ? entity.data.rules : "",
    cost: entity.type === "golden_finger" ? entity.data.cost : "",
    limits: entity.type === "golden_finger" ? entity.data.limits : "",
    growth: entity.type === "golden_finger" ? entity.data.growth : "",
    details:
      entity.type === "faction" || entity.type === "map" || entity.type === "power_system"
        ? entity.data.details
        : "",
    itemCategory: entity.type === "item" ? entity.data.category : "",
    itemGrade: entity.type === "item" ? entity.data.grade : "",
    itemEffect: entity.type === "item" ? entity.data.effect : "",
    itemCost: entity.type === "item" ? entity.data.cost : "",
    itemOwnership: entity.type === "item" ? entity.data.ownership : "",
    itemLimits: entity.type === "item" ? entity.data.limits : "",
    timelineEra: entity.type === "timeline_event" ? entity.data.era : "",
    timelineStoryTime: entity.type === "timeline_event" ? entity.data.storyTime : "",
    timelineDuration: entity.type === "timeline_event" ? entity.data.duration : "",
    timelineEvent: entity.type === "timeline_event" ? entity.data.event : "",
    customFields: { ...entity.customFields },
    requestTitle: "",
    requestReason: "",
  };
}

function createPayload(editor: EditorState): SettingEntityCreateRequest {
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
    customFields: compactCustomFields(editor.customFields),
  };
  if (editor.type === "world_rule") {
    return { type: "world_rule", ...common, data: { rule: editor.rule.trim() } };
  }
  if (editor.type === "character") {
    return {
      type: "character",
      ...common,
      data: {
        bodyState: editor.bodyState.trim(),
        knowledgeBoundary: editor.knowledgeBoundary.trim(),
        relationshipSummary: editor.relationshipSummary.trim(),
      },
    };
  }
  if (editor.type === "faction" || editor.type === "map" || editor.type === "power_system") {
    return {
      type: editor.type,
      ...common,
      data: { details: editor.details.trim() },
    };
  }
  if (editor.type === "golden_finger") {
    return {
      type: "golden_finger",
      ...common,
      data: {
        rules: editor.goldenRules.trim(),
        cost: editor.cost.trim(),
        limits: editor.limits.trim(),
        growth: editor.growth.trim(),
      },
    };
  }
  if (editor.type === "item") {
    return {
      type: "item",
      ...common,
      data: {
        category: editor.itemCategory.trim(),
        grade: editor.itemGrade.trim(),
        effect: editor.itemEffect.trim(),
        cost: editor.itemCost.trim(),
        ownership: editor.itemOwnership.trim(),
        limits: editor.itemLimits.trim(),
      },
    };
  }
  return {
    type: "timeline_event",
    ...common,
    data: {
      era: editor.timelineEra.trim(),
      storyTime: editor.timelineStoryTime.trim(),
      duration: editor.timelineDuration.trim(),
      event: editor.timelineEvent.trim(),
    },
  };
}

function patchPayload(editor: EditorState) {
  return {
    version: editor.version,
    ...changePayload(editor),
  };
}

function changePayload(editor: EditorState) {
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
    customFields: compactCustomFields(editor.customFields),
  };
  if (editor.type === "world_rule") {
    return { ...common, data: { rule: editor.rule.trim() } };
  }
  if (editor.type === "character") {
    return {
      ...common,
      data: {
        bodyState: editor.bodyState.trim(),
        knowledgeBoundary: editor.knowledgeBoundary.trim(),
        relationshipSummary: editor.relationshipSummary.trim(),
      },
    };
  }
  if (editor.type === "faction" || editor.type === "map" || editor.type === "power_system") {
    return {
      ...common,
      data: { details: editor.details.trim() },
    };
  }
  if (editor.type === "golden_finger") {
    return {
      ...common,
      data: {
        rules: editor.goldenRules.trim(),
        cost: editor.cost.trim(),
        limits: editor.limits.trim(),
        growth: editor.growth.trim(),
      },
    };
  }
  if (editor.type === "item") {
    return {
      ...common,
      data: {
        category: editor.itemCategory.trim(),
        grade: editor.itemGrade.trim(),
        effect: editor.itemEffect.trim(),
        cost: editor.itemCost.trim(),
        ownership: editor.itemOwnership.trim(),
        limits: editor.itemLimits.trim(),
      },
    };
  }
  return {
    ...common,
    data: {
      era: editor.timelineEra.trim(),
      storyTime: editor.timelineStoryTime.trim(),
      duration: editor.timelineDuration.trim(),
      event: editor.timelineEvent.trim(),
    },
  };
}

async function mutateEntity(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  fallback: string,
): Promise<SettingEntity> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingEntityResponseSchema.parse(await response.json()).data;
}

async function mutateProposal(
  path: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<SettingProposal> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingProposalResponseSchema.parse(await response.json()).data;
}

async function mutateChangeRequest(
  path: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<SettingChangeRequest> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingChangeRequestResponseSchema.parse(await response.json()).data;
}

async function mutateCustomField(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  fallback: string,
): Promise<CustomFieldDefinition> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return customFieldDefinitionResponseSchema.parse(await response.json()).data;
}

async function mutateDelete(path: string, fallback: string) {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return settingEntityDeleteResponseSchema.parse(await response.json()).data;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}

function splitList(value: string): string[] {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactCustomFields(
  values: Record<string, CustomFieldValue | null>,
): Record<string, CustomFieldValue | null> {
  const next: Record<string, CustomFieldValue | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function authorNote(reason: string) {
  return {
    kind: "author_note" as const,
    sourceId: null,
    label: "作者说明",
    quote: reason.trim() || "作者提交的设定变更",
    locator: "",
    confidence: null,
  };
}

function formatCustomFieldValue(value: CustomFieldValue | undefined): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join("、") : "未填写";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (value === undefined || value === null || value === "") {
    return "未填写";
  }
  return String(value);
}

function blankFieldForm(): FieldFormState {
  return {
    key: "",
    label: "",
    fieldType: "text",
    appliesTo: "all",
    required: false,
    options: "",
    relationTarget: null,
    sortOrder: "0",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatValidity(validity: CharacterDetail["relationships"][number]["validity"]): string {
  const chapterRange =
    validity.toChapter === null
      ? `第 ${validity.fromChapter} 章起`
      : `第 ${validity.fromChapter}–${validity.toChapter} 章`;
  const storyRange = validity.fromStoryTime
    ? [
        validity.fromStoryTime.era,
        validity.fromStoryTime.label,
        validity.toStoryTime ? `至 ${validity.toStoryTime.label}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return storyRange ? `${chapterRange} · ${storyRange}` : chapterRange;
}

function settingsPath(work: WorkOverview): string {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

function columnForType(type: SettingEntityType): ColumnKey {
  if (type === "world_rule") {
    return "world";
  }
  if (type === "character") {
    return "characters";
  }
  if (type === "faction") {
    return "factions";
  }
  if (type === "map") {
    return "map";
  }
  if (type === "item") {
    return "items";
  }
  if (type === "timeline_event") {
    return "timeline";
  }
  return "power";
}

function typeForColumn(column: ColumnKey): SettingEntityType {
  if (column === "characters") {
    return "character";
  }
  if (column === "factions") {
    return "faction";
  }
  if (column === "map") {
    return "map";
  }
  if (column === "power") {
    return "power_system";
  }
  if (column === "items") {
    return "item";
  }
  if (column === "timeline") {
    return "timeline_event";
  }
  return "world_rule";
}

function entitiesForColumn(entities: SettingEntity[], column: ColumnKey): SettingEntity[] {
  if (column === "power") {
    return entities.filter(
      (entity) => entity.type === "power_system" || entity.type === "golden_finger",
    );
  }
  const type = typeForColumn(column);
  return entities.filter((entity) => entity.type === type);
}

function columnDescription(column: ColumnKey): string {
  const descriptions: Record<ColumnKey, string> = {
    world: "记录不可违背的世界规则，以及规则生效的边界。",
    characters: "记录人物当前身体状态、知识边界和关系摘要。",
    factions: "势力、控制区和组织关系。",
    map: "地点层级、旅行时间和地图标记。",
    power: "记录力量体系，以及金手指的规则、代价、限制和成长。",
    items: "物品、功法、归属和流转。",
    timeline: "故事时间、事件和行程。",
  };
  return descriptions[column];
}
