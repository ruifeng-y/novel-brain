"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Circle,
  Globe2,
  History,
  LoaderCircle,
  Lock,
  Map,
  Pencil,
  Plus,
  Shield,
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
  confirmedSettingListResponseSchema,
  settingEntityDeleteResponseSchema,
  settingEntityListResponseSchema,
  settingEntityResponseSchema,
  workResponseSchema,
  type ConfirmedSetting,
  type SettingEntity,
  type SettingEntityCreateRequest,
  type SettingEntityType,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

type ColumnKey = "world" | "characters" | "factions" | "map" | "power" | "items" | "timeline";

type EditorState = {
  mode: "create" | "edit";
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
  { key: "items", label: "物品功法", contentLabel: "物品功法", icon: Swords, supported: false },
  { key: "timeline", label: "时间线", contentLabel: "时间线", icon: History, supported: false },
];

const typeLabels: Record<SettingEntityType, string> = {
  world_rule: "世界规则",
  character: "人物档案",
  faction: "势力",
  map: "地图",
  power_system: "力量体系",
  golden_finger: "金手指",
};

const typeDescriptions: Record<SettingTypeColumn, string> = {
  world_rule: "硬规则与不可违背的世界边界",
  character: "身体状态、知识边界与关系摘要",
  faction: "组织立场、控制范围和人物关系",
  map: "地点层级、路径和场景边界",
  power_system: "层级、路径、突破条件和代价",
  golden_finger: "规则、代价、限制与成长",
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

export function SettingsCenter({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [entities, setEntities] = useState<SettingEntity[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedSetting[]>([]);
  const [activeColumn, setActiveColumn] = useState<ColumnKey>("world");
  const [view, setView] = useState<"columns" | "confirmed">("columns");
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
      const [entityResponse, confirmedResponse] = await Promise.all([
        fetch(`${basePath}/entities`, { cache: "no-store" }),
        fetch(`${basePath}/facts`, { cache: "no-store" }),
      ]);
      if (!entityResponse.ok) {
        throw new Error(await readError(entityResponse, "设定加载失败。"));
      }
      if (!confirmedResponse.ok) {
        throw new Error(await readError(confirmedResponse, "已确认设定加载失败。"));
      }
      setWork(workData);
      setEntities(settingEntityListResponseSchema.parse(await entityResponse.json()).data);
      setConfirmed(confirmedSettingListResponseSchema.parse(await confirmedResponse.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设定中心加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    return {
      world: entities.filter((entity) => entity.type === "world_rule").length,
      characters: entities.filter((entity) => entity.type === "character").length,
      factions: entities.filter((entity) => entity.type === "faction").length,
      map: entities.filter((entity) => entity.type === "map").length,
      power: entities.filter(
        (entity) => entity.type === "power_system" || entity.type === "golden_finger",
      ).length,
      items: 0,
      timeline: 0,
    } satisfies Record<ColumnKey, number>;
  }, [entities]);

  const selected =
    view === "columns" ? (entities.find((entity) => entity.id === selectedId) ?? null) : null;

  async function refreshProjection() {
    if (!work) {
      return;
    }
    const basePath = settingsPath(work);
    const [entityResponse, confirmedResponse] = await Promise.all([
      fetch(`${basePath}/entities`, { cache: "no-store" }),
      fetch(`${basePath}/facts`, { cache: "no-store" }),
    ]);
    if (entityResponse.ok) {
      setEntities(settingEntityListResponseSchema.parse(await entityResponse.json()).data);
    }
    if (confirmedResponse.ok) {
      setConfirmed(confirmedSettingListResponseSchema.parse(await confirmedResponse.json()).data);
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
  const visibleEntities =
    activeColumn === "world"
      ? entities.filter((entity) => entity.type === "world_rule")
      : activeColumn === "characters"
        ? entities.filter((entity) => entity.type === "character")
        : activeColumn === "factions"
          ? entities.filter((entity) => entity.type === "faction")
          : activeColumn === "map"
            ? entities.filter((entity) => entity.type === "map")
            : activeColumn === "power"
              ? entities.filter(
                  (entity) => entity.type === "power_system" || entity.type === "golden_finger",
                )
              : [];

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
            <span>M0 先维护世界规则、人物档案和金手指。</span>
          </div>
        </aside>

        <main className="settings-content">
          {view === "confirmed" ? (
            <ConfirmedSettings items={confirmed} />
          ) : editor ? (
            <SettingEditor
              busy={busy === "save"}
              editor={editor}
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

              {!activeColumnMeta.supported ? (
                <LaterColumnState column={activeColumnMeta.contentLabel} />
              ) : activeColumn === "power" ? (
                <PowerColumn entities={visibleEntities} onOpen={setSelectedId} />
              ) : visibleEntities.length === 0 ? (
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
          ) : selected ? (
            <EntityDetail
              busy={busy}
              entity={selected}
              onDelete={() => deleteEntity(selected)}
              onEdit={() => beginEdit(selected)}
              onEditAlias={() => beginEdit(selected, "alias")}
              onLock={() => lockEntity(selected)}
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
  editor,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  editor: EditorState;
  onCancel: () => void;
  onChange: (editor: EditorState) => void;
  onSave: () => void;
}) {
  const update = (field: keyof EditorState, value: string) => {
    onChange({ ...editor, [field]: value });
  };

  return (
    <section className="panel settings-editor" aria-labelledby="settings-editor-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">{editor.mode === "create" ? "新增设定" : "编辑设定"}</span>
          <h2 id="settings-editor-title">
            {editor.mode === "create" ? "先写清最小结构" : editor.name}
          </h2>
        </div>
        <button className="text-btn small" onClick={onCancel} type="button">
          取消
        </button>
      </div>

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>设定类型</span>
          <select
            disabled={editor.mode === "edit"}
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
          {editor.mode === "create" ? "创建设定" : "保存修改"}
        </button>
      </div>
    </section>
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

function PowerColumn({
  entities,
  onOpen,
}: {
  entities: SettingEntity[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="settings-later-note">
        <Sparkles size={16} aria-hidden="true" />
        <span>力量体系结构将在后续能力中补齐，M0 先维护主角金手指。</span>
      </div>
      {entities.length === 0 ? (
        <section className="panel settings-column-empty">
          <Zap size={20} aria-hidden="true" />
          <h2>还没有金手指</h2>
          <p>写清规则、代价、限制和成长，避免优势变成没有边界的捷径。</p>
        </section>
      ) : (
        <div className="settings-entity-list">
          {entities.map((entity) => (
            <EntityCard entity={entity} key={entity.id} onOpen={onOpen} />
          ))}
        </div>
      )}
    </>
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

function LaterColumnState({ column }: { column: string }) {
  return (
    <section className="panel settings-column-empty settings-later-column">
      <Circle size={20} aria-hidden="true" />
      <h2>{column}还没有开始</h2>
      <p>这个栏目将在后续能力中开放。</p>
      <small>M0 先维护世界规则、人物档案和金手指。</small>
    </section>
  );
}

function EntityDetail({
  busy,
  entity,
  onDelete,
  onEdit,
  onEditAlias,
  onLock,
}: {
  busy: string;
  entity: SettingEntity;
  onDelete: () => void;
  onEdit: () => void;
  onEditAlias: () => void;
  onLock: () => void;
}) {
  const locked = entity.status === "locked";
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
        <>
          <div className="settings-detail-block">
            <h3>当前身体状态</h3>
            <p>{entity.data.bodyState}</p>
          </div>
          <div className="settings-detail-block">
            <h3>知识边界</h3>
            <p>{entity.data.knowledgeBoundary}</p>
          </div>
          <div className="settings-detail-block">
            <h3>关系摘要</h3>
            <p>{entity.data.relationshipSummary}</p>
          </div>
        </>
      ) : entity.type === "faction" || entity.type === "map" || entity.type === "power_system" ? (
        <div className="settings-detail-block">
          <h3>{typeLabels[entity.type]}</h3>
          <p>{entity.data.details}</p>
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
          </>
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
  };
}

function createPayload(editor: EditorState): SettingEntityCreateRequest {
  const common = {
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
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

function patchPayload(editor: EditorState) {
  const common = {
    version: editor.version,
    name: editor.name.trim(),
    aliases: splitList(editor.aliases),
    summary: editor.summary.trim(),
    description: editor.description.trim(),
    tags: splitList(editor.tags),
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function settingsPath(work: WorkOverview): string {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
}

function columnForType(type: SettingEntityType): ColumnKey {
  return type === "world_rule"
    ? "world"
    : type === "character"
      ? "characters"
      : type === "faction"
        ? "factions"
        : type === "map"
          ? "map"
          : "power";
}

function typeForColumn(column: ColumnKey): SettingEntityType {
  return column === "characters"
    ? "character"
    : column === "factions"
      ? "faction"
      : column === "map"
        ? "map"
        : column === "power"
          ? "power_system"
          : "world_rule";
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
