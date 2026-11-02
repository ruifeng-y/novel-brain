'use client';

import {
  CUSTOM_FIELD_TYPE_LABELS,
  ENTITY_SCOPE_LABELS,
  ENTITY_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  RELATION_PREDICATE_LABELS,
  type CustomFieldValue,
} from '@novel/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, friendlyError } from '../../../lib/auth-api';
import {
  createCustomField,
  createEntity,
  createRelation,
  loadEntity,
  searchEntities,
  updateEntity,
  type CustomFieldDefinition,
  type CustomFieldType,
  type Entity,
  type EntityDetail,
  type EntityInput,
  type EntityScope,
  type EntitySearchFilters,
  type EntityStatus,
  type EntityType,
  type Relation,
  type RelationPredicate,
} from '../../../lib/entities-api';
import { CharacterPanel } from './character-panel';
import { StructuredSettingsPanel } from './structured-settings-panel';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type FieldDraft = {
  label: string;
  type: CustomFieldType;
  options: string;
};

const ENTITY_TYPES = Object.entries(ENTITY_TYPE_LABELS) as Array<[EntityType, string]>;
const ENTITY_SCOPES = Object.entries(ENTITY_SCOPE_LABELS) as Array<[EntityScope, string]>;
const ENTITY_STATUSES = Object.entries(ENTITY_STATUS_LABELS) as Array<[EntityStatus, string]>;
const CUSTOM_FIELD_TYPES = Object.entries(CUSTOM_FIELD_TYPE_LABELS) as Array<
  [CustomFieldType, string]
>;
const RELATION_PREDICATES = Object.entries(RELATION_PREDICATE_LABELS) as Array<
  [RelationPredicate, string]
>;

function emptyEntity(type: EntityType = 'character'): EntityInput {
  return {
    name: '',
    aliases: [],
    type,
    summary: '',
    description: '',
    tags: [],
    scope: 'work',
    status: 'draft',
    customFields: {},
  };
}

function entityDraft(entity: Entity): EntityInput {
  return {
    name: entity.name,
    aliases: entity.aliases,
    type: entity.type,
    summary: entity.summary,
    description: entity.description,
    tags: entity.tags,
    scope: entity.scope,
    status: entity.status,
    customFields: entity.customFields,
  };
}

function splitValues(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function sameFilters(left: EntitySearchFilters, right: EntitySearchFilters): boolean {
  return (
    left.q === right.q &&
    left.type === right.type &&
    left.tag === right.tag &&
    left.status === right.status
  );
}

function settingsError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'ENTITY_NAME_CONFLICT') {
      return '这个栏目里已经有同名设定，换个名称再试。';
    }
    if (error.code === 'CUSTOM_FIELD_INVALID') {
      return '自定义字段的值不符合字段类型，请检查后再保存。';
    }
    if (error.code === 'RELATION_ENTITY_INVALID') {
      return '关系两端必须都是当前作品里的设定。';
    }
  }
  return friendlyError(error);
}

function upsertEntity(items: Entity[], saved: Entity): Entity[] {
  const exists = items.some((item) => item.id === saved.id);
  if (!exists) {
    return [saved, ...items];
  }
  return items.map((item) => (item.id === saved.id ? saved : item));
}

export function SettingsCenterPanel({
  workId,
  branchId,
  initialEntities,
  initialCustomFields,
  initialRelations,
}: {
  workId: string;
  branchId: string;
  initialEntities: Entity[];
  initialCustomFields: CustomFieldDefinition[];
  initialRelations: Relation[];
}) {
  const [catalog, setCatalog] = useState(initialEntities);
  const [items, setItems] = useState(initialEntities);
  const [customFields, setCustomFields] = useState(initialCustomFields);
  const [relations, setRelations] = useState(initialRelations);
  const [selectedId, setSelectedId] = useState<string | null>(initialEntities[0]?.id ?? null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [draft, setDraft] = useState<EntityInput>(() =>
    initialEntities[0] ? entityDraft(initialEntities[0]) : emptyEntity(),
  );
  const [activeFilters, setActiveFilters] = useState<EntitySearchFilters>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [statusQuery, setStatusQuery] = useState<'' | EntityStatus>('');
  const [listState, setListState] = useState<SaveState>({ status: 'idle' });
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>({
    label: '',
    type: 'text',
    options: '',
  });
  const [fieldState, setFieldState] = useState<SaveState>({ status: 'idle' });
  const [relationState, setRelationState] = useState<SaveState>({ status: 'idle' });
  const [relationFrom, setRelationFrom] = useState(selectedId ?? '');
  const [relationPredicate, setRelationPredicate] = useState<RelationPredicate>('subordinate');
  const [relationTo, setRelationTo] = useState('');
  const [relationValidFrom, setRelationValidFrom] = useState('');
  const [relationValidTo, setRelationValidTo] = useState('');
  const [relationSource, setRelationSource] = useState('作者录入');
  const editIntentRef = useRef(0);
  const filtersRef = useRef<EntitySearchFilters>({});

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let active = true;
    setSaveState({ status: 'idle' });
    loadEntity(workId, branchId, selectedId)
      .then((entity) => {
        if (!active) {
          return;
        }
        setDetail(entity);
        setDraft(entityDraft(entity));
      })
      .catch((error: unknown) => {
        if (active) {
          setSaveState({ status: 'error', message: settingsError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [branchId, selectedId, workId]);

  async function applyFilters(next: EntitySearchFilters) {
    setListState({ status: 'saving' });
    setActiveFilters(next);
    filtersRef.current = next;
    try {
      const result = await searchEntities(workId, branchId, next);
      setItems(result.items);
      setListState({ status: 'idle' });
    } catch (error) {
      setListState({ status: 'error', message: settingsError(error) });
    }
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void applyFilters({
      ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
      ...(activeFilters.type ? { type: activeFilters.type } : {}),
      ...(tagQuery.trim() ? { tag: tagQuery.trim() } : {}),
      ...(statusQuery ? { status: statusQuery } : {}),
    });
  }

  function chooseType(type: EntityType | undefined) {
    void applyFilters({
      ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
      ...(type ? { type } : {}),
      ...(tagQuery.trim() ? { tag: tagQuery.trim() } : {}),
      ...(statusQuery ? { status: statusQuery } : {}),
    });
  }

  function startNewEntity() {
    editIntentRef.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDraft(emptyEntity(activeFilters.type));
    setSaveState({ status: 'idle' });
  }

  function openEntity(entityId: string) {
    editIntentRef.current += 1;
    setSelectedId(entityId);
    setRelationFrom(entityId);
    setSaveState({ status: 'idle' });
    setRelationState({ status: 'idle' });
  }

  function updateDraft<K extends keyof EntityInput>(key: K, value: EntityInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateCustomField(key: string, value: CustomFieldValue) {
    setDraft((current) => ({
      ...current,
      customFields: {
        ...current.customFields,
        [key]: value,
      },
    }));
  }

  async function onSaveEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = editIntentRef.current + 1;
    editIntentRef.current = intent;
    const filtersAtSave = filtersRef.current;
    setSaveState({ status: 'saving' });
    try {
      const saved = selectedId
        ? await updateEntity(workId, branchId, selectedId, draft)
        : await createEntity(workId, branchId, draft);
      setCatalog((current) => upsertEntity(current, saved));
      const refreshed = await searchEntities(workId, branchId, filtersAtSave);
      if (sameFilters(filtersRef.current, filtersAtSave)) {
        setItems(refreshed.items);
      }
      if (intent !== editIntentRef.current) {
        return;
      }
      setSelectedId(saved.id);
      setRelationFrom(saved.id);
      const savedDetail = await loadEntity(workId, branchId, saved.id);
      if (intent !== editIntentRef.current) {
        return;
      }
      setDetail(savedDetail);
      setDraft(entityDraft(savedDetail));
      setSaveState({ status: 'saved', message: '设定已保存' });
    } catch (error) {
      if (intent === editIntentRef.current) {
        setSaveState({ status: 'error', message: settingsError(error) });
      }
    }
  }

  async function onAddField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldState({ status: 'saving' });
    try {
      const created = await createCustomField(workId, branchId, {
        label: fieldDraft.label,
        type: fieldDraft.type,
        ...(fieldDraft.type === 'single_select' || fieldDraft.type === 'multi_select'
          ? { options: splitValues(fieldDraft.options) }
          : {}),
      });
      setCustomFields((current) => [...current, created]);
      setFieldDraft({ label: '', type: 'text', options: '' });
      setFieldState({ status: 'saved', message: '字段已添加' });
    } catch (error) {
      setFieldState({ status: 'error', message: settingsError(error) });
    }
  }

  async function onAddRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!relationFrom || !relationTo) {
      return;
    }
    setRelationState({ status: 'saving' });
    try {
      const created = await createRelation(workId, branchId, {
        fromEntityId: relationFrom,
        predicate: relationPredicate,
        toEntityId: relationTo,
        validFrom: relationValidFrom.trim() || null,
        validTo: relationValidTo.trim() || null,
        source: relationSource.trim() || '作者录入',
      });
      setRelations((current) => [...current, created]);
      setRelationTo('');
      setRelationValidFrom('');
      setRelationValidTo('');
      setRelationState({ status: 'saved', message: '关系已添加' });
    } catch (error) {
      setRelationState({ status: 'error', message: settingsError(error) });
    }
  }

  const visibleRelations = relations.filter((relation) =>
    selectedId
      ? relation.fromEntity.id === selectedId || relation.toEntity.id === selectedId
      : true,
  );
  const structuredEntity = selectedId
    ? (items.find((entity) => entity.id === selectedId) ??
      catalog.find((entity) => entity.id === selectedId) ??
      detail)
    : null;

  return (
    <section className="settings-center-board" aria-labelledby="settings-center-title">
      <div className="settings-center-heading">
        <div>
          <p className="workspace-step">世界观、人物与物件</p>
          <h2 id="settings-center-title">设定中心</h2>
          <p>把散落在脑中的世界信息整理成可搜索、可关联、能被章节和大纲引用的条目。</p>
        </div>
        <div className="settings-center-count" aria-label="设定数量">
          <strong>{catalog.length}</strong>
          <span>个设定</span>
        </div>
      </div>

      <div className="settings-center-layout">
        <aside className="settings-browser" aria-label="设定目录">
          <form className="settings-search" onSubmit={onSearch}>
            <label className="field">
              <span>搜索设定</span>
              <input
                aria-label="搜索设定"
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="名称、别名、摘要或标签"
                value={searchQuery}
              />
            </label>
            <div className="settings-filter-row">
              <label className="field">
                <span>按标签筛选</span>
                <input
                  aria-label="按标签筛选"
                  onChange={(event) => setTagQuery(event.currentTarget.value)}
                  placeholder="例如：主角"
                  value={tagQuery}
                />
              </label>
              <label className="field">
                <span>按状态筛选</span>
                <select
                  aria-label="按状态筛选"
                  onChange={(event) =>
                    setStatusQuery(event.currentTarget.value as '' | EntityStatus)
                  }
                  value={statusQuery}
                >
                  <option value="">全部状态</option>
                  {ENTITY_STATUSES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="secondary-button"
              disabled={listState.status === 'saving'}
              type="submit"
            >
              {listState.status === 'saving' ? '正在搜索…' : '搜索'}
            </button>
          </form>

          <nav className="settings-type-nav" aria-label="设定栏目">
            <button
              aria-pressed={activeFilters.type === undefined}
              onClick={() => chooseType(undefined)}
              type="button"
            >
              全部
            </button>
            {ENTITY_TYPES.map(([type, label]) => (
              <button
                aria-pressed={activeFilters.type === type}
                key={type}
                onClick={() => chooseType(type)}
                type="button"
              >
                {label}
              </button>
            ))}
          </nav>

          <button
            className="primary-button settings-new-button"
            onClick={startNewEntity}
            type="button"
          >
            新建设定
          </button>

          {listState.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {listState.message}
            </p>
          ) : null}

          {items.length === 0 ? (
            <p className="settings-list-empty">这个栏目还没有设定。</p>
          ) : (
            <ul className="settings-entity-list">
              {items.map((entity) => (
                <li key={entity.id}>
                  <button
                    aria-current={selectedId === entity.id ? 'page' : undefined}
                    onClick={() => openEntity(entity.id)}
                    type="button"
                  >
                    <span className={`settings-entity-mark settings-entity-mark-${entity.type}`}>
                      {entity.typeLabel.slice(0, 1)}
                    </span>
                    <span className="settings-entity-copy">
                      <span className="settings-entity-title">
                        <strong>{entity.name}</strong>
                        <small>{entity.statusLabel}</small>
                      </span>
                      <span>{entity.summary || '还没有一句话摘要'}</span>
                      <small>
                        {entity.typeLabel}
                        {entity.tags.length > 0 ? ` · ${entity.tags.join('、')}` : ''}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="settings-editor">
          <div className="settings-editor-heading">
            <div>
              <p className="workspace-step">{selectedId ? '编辑已有条目' : '新条目'}</p>
              <h3>{selectedId ? draft.name || '未命名设定' : '新建设定'}</h3>
              <p>先写清作者自己能一眼认出的信息，再用自定义字段补足题材细节。</p>
            </div>
            <button
              aria-expanded={fieldsOpen}
              className="secondary-button"
              onClick={() => setFieldsOpen((current) => !current)}
              type="button"
            >
              字段设置
            </button>
          </div>

          {fieldsOpen ? (
            <div className="settings-field-manager">
              <div className="settings-subheading">
                <div>
                  <h4>自定义字段</h4>
                  <p>这里新增的字段会立刻出现在所有设定的编辑表单里。</p>
                </div>
                <span>{customFields.length} 个字段</span>
              </div>
              {customFields.length > 0 ? (
                <ul className="settings-field-list">
                  {customFields.map((field) => (
                    <li key={field.id}>
                      <strong>{field.label}</strong>
                      <span>{field.typeLabel}</span>
                      {field.options.length > 0 ? <small>{field.options.join('、')}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="settings-list-empty">还没有自定义字段。</p>
              )}
              <form className="settings-field-form" onSubmit={onAddField}>
                <label className="field">
                  <span>字段名称</span>
                  <input
                    aria-label="字段名称"
                    onChange={(event) => {
                      const label = event.currentTarget.value;
                      setFieldDraft((current) => ({ ...current, label }));
                    }}
                    placeholder="例如：旧伤备注"
                    required
                    value={fieldDraft.label}
                  />
                </label>
                <label className="field">
                  <span>字段类型</span>
                  <select
                    aria-label="字段类型"
                    onChange={(event) => {
                      const type = event.currentTarget.value as CustomFieldType;
                      setFieldDraft((current) => ({
                        ...current,
                        type,
                      }));
                    }}
                    value={fieldDraft.type}
                  >
                    {CUSTOM_FIELD_TYPES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {fieldDraft.type === 'single_select' || fieldDraft.type === 'multi_select' ? (
                  <label className="field">
                    <span>可选值</span>
                    <input
                      aria-label="可选值"
                      onChange={(event) => {
                        const options = event.currentTarget.value;
                        setFieldDraft((current) => ({
                          ...current,
                          options,
                        }));
                      }}
                      placeholder="用逗号分隔，例如：炼气，筑基，金丹"
                      required
                      value={fieldDraft.options}
                    />
                  </label>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={fieldState.status === 'saving'}
                  type="submit"
                >
                  {fieldState.status === 'saving' ? '正在添加…' : '添加字段'}
                </button>
                {fieldState.status === 'error' ? (
                  <p className="form-message form-message-error" role="alert">
                    {fieldState.message}
                  </p>
                ) : null}
                {fieldState.status === 'saved' ? (
                  <p className="form-message form-message-success" role="status">
                    {fieldState.message}
                  </p>
                ) : null}
              </form>
            </div>
          ) : null}

          <form className="settings-entity-form" onSubmit={onSaveEntity}>
            <div className="settings-form-grid">
              <label className="field">
                <span>名称</span>
                <input
                  aria-label="名称"
                  maxLength={200}
                  onChange={(event) => updateDraft('name', event.currentTarget.value)}
                  placeholder="作者和读者都会用到的正式名称"
                  required
                  value={draft.name}
                />
              </label>
              <label className="field">
                <span>别名</span>
                <input
                  aria-label="别名"
                  onChange={(event) =>
                    updateDraft('aliases', splitValues(event.currentTarget.value))
                  }
                  placeholder="用逗号分隔，例如：守碑少年，残剑客"
                  value={draft.aliases.join('，')}
                />
              </label>
              <label className="field">
                <span>类型</span>
                <select
                  aria-label="类型"
                  onChange={(event) => updateDraft('type', event.currentTarget.value as EntityType)}
                  value={draft.type}
                >
                  {ENTITY_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>作用域</span>
                <select
                  aria-label="作用域"
                  onChange={(event) =>
                    updateDraft('scope', event.currentTarget.value as EntityScope)
                  }
                  value={draft.scope}
                >
                  {ENTITY_SCOPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>状态</span>
                <select
                  aria-label="状态"
                  onChange={(event) =>
                    updateDraft('status', event.currentTarget.value as EntityStatus)
                  }
                  value={draft.status}
                >
                  {ENTITY_STATUSES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>标签</span>
                <input
                  aria-label="标签"
                  onChange={(event) => updateDraft('tags', splitValues(event.currentTarget.value))}
                  placeholder="用逗号分隔，例如：主角，剑修"
                  value={draft.tags.join('，')}
                />
              </label>
            </div>

            <label className="field">
              <span>一句话摘要</span>
              <textarea
                aria-label="一句话摘要"
                maxLength={2_000}
                onChange={(event) => updateDraft('summary', event.currentTarget.value)}
                placeholder="让作者在列表里一眼认出这个设定"
                rows={3}
                value={draft.summary}
              />
            </label>
            <label className="field">
              <span>详细描述</span>
              <textarea
                aria-label="详细描述"
                maxLength={30_000}
                onChange={(event) => updateDraft('description', event.currentTarget.value)}
                placeholder="写清背景、规则、限制和不能违背的边界"
                rows={7}
                value={draft.description}
              />
            </label>

            {customFields.length > 0 ? (
              <fieldset className="settings-custom-fields">
                <legend>题材字段</legend>
                <div className="settings-form-grid">
                  {customFields.map((field) => (
                    <CustomFieldControl
                      entities={catalog}
                      field={field}
                      key={field.id}
                      onChange={(value) => updateCustomField(field.key, value)}
                      value={draft.customFields[field.key] ?? null}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}

            {saveState.status === 'error' ? (
              <p className="form-message form-message-error" role="alert">
                {saveState.message}
              </p>
            ) : null}
            {saveState.status === 'saved' ? (
              <p className="form-message form-message-success" role="status">
                {saveState.message}
              </p>
            ) : null}

            <div className="settings-editor-actions">
              <button
                className="primary-button"
                disabled={saveState.status === 'saving'}
                type="submit"
              >
                {saveState.status === 'saving' ? '正在保存…' : '保存设定'}
              </button>
              <p>保存后就能在搜索、关系和被引用清单里找到它。</p>
            </div>
          </form>

          {selectedId && draft.type === 'character' ? (
            <CharacterPanel branchId={branchId} characterId={selectedId} workId={workId} />
          ) : null}

          {structuredEntity ? (
            <StructuredSettingsPanel
              branchId={branchId}
              entities={catalog}
              entity={structuredEntity}
              workId={workId}
            />
          ) : null}
        </div>

        <aside className="settings-context" aria-label="关系与引用">
          <section className="settings-context-section" aria-labelledby="settings-references-title">
            <div className="settings-subheading">
              <div>
                <h3 id="settings-references-title">被哪些内容引用</h3>
                <p>按名称和别名匹配当前创作线里的章节与章纲。</p>
              </div>
              <span>
                {(detail?.references.chapters.length ?? 0) +
                  (detail?.references.outlines.length ?? 0)}
              </span>
            </div>
            {!detail ? (
              <p className="settings-list-empty">选择一个设定后查看引用。</p>
            ) : detail.references.chapters.length === 0 &&
              detail.references.outlines.length === 0 ? (
              <p className="settings-list-empty">暂时没有被章节或章纲引用。</p>
            ) : (
              <div className="settings-reference-groups">
                {detail.references.chapters.length > 0 ? (
                  <div>
                    <h4>章节</h4>
                    <ul>
                      {detail.references.chapters.map((chapter) => (
                        <li key={chapter.id}>
                          <strong>
                            第 {chapter.chapterNumber} 章 · {chapter.title}
                          </strong>
                          <span>{chapter.statusLabel}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {detail.references.outlines.length > 0 ? (
                  <div>
                    <h4>章纲</h4>
                    <ul>
                      {detail.references.outlines.map((outline) => (
                        <li key={outline.chapterNumber}>
                          <strong>第 {outline.chapterNumber} 章章纲</strong>
                          <span>{outline.matchedFields.join('、')}</span>
                          <small>{outline.chapterGoal}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="settings-context-section" aria-labelledby="settings-relations-title">
            <div className="settings-subheading">
              <div>
                <h3 id="settings-relations-title">设定关系</h3>
                <p>用固定关系词连接条目，并记录有效期和来源。</p>
              </div>
              <span>{visibleRelations.length}</span>
            </div>

            {visibleRelations.length === 0 ? (
              <p className="settings-list-empty">还没有关系。</p>
            ) : (
              <ul className="settings-relation-list">
                {visibleRelations.map((relation) => (
                  <li key={relation.id}>
                    <strong>
                      {relation.fromEntity.name} {relation.predicateLabel} {relation.toEntity.name}
                    </strong>
                    <span>
                      {relation.validFrom || '起点未定'} 至 {relation.validTo || '至今'}
                    </span>
                    <small>{relation.source}</small>
                  </li>
                ))}
              </ul>
            )}

            <form className="settings-relation-form" onSubmit={onAddRelation}>
              <label className="field">
                <span>关系起点</span>
                <select
                  aria-label="关系起点"
                  onChange={(event) => setRelationFrom(event.currentTarget.value)}
                  required
                  value={relationFrom}
                >
                  <option value="">选择起点</option>
                  {catalog.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name} · {entity.typeLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>关系类型</span>
                <select
                  aria-label="关系类型"
                  onChange={(event) =>
                    setRelationPredicate(event.currentTarget.value as RelationPredicate)
                  }
                  value={relationPredicate}
                >
                  {RELATION_PREDICATES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>关系终点</span>
                <select
                  aria-label="关系终点"
                  onChange={(event) => setRelationTo(event.currentTarget.value)}
                  required
                  value={relationTo}
                >
                  <option value="">选择终点</option>
                  {catalog.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name} · {entity.typeLabel}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-filter-row">
                <label className="field">
                  <span>有效起点</span>
                  <input
                    aria-label="有效起点"
                    onChange={(event) => setRelationValidFrom(event.currentTarget.value)}
                    placeholder="例如：第 2 章"
                    value={relationValidFrom}
                  />
                </label>
                <label className="field">
                  <span>有效结束</span>
                  <input
                    aria-label="有效结束"
                    onChange={(event) => setRelationValidTo(event.currentTarget.value)}
                    placeholder="留空表示至今"
                    value={relationValidTo}
                  />
                </label>
              </div>
              <label className="field">
                <span>关系来源</span>
                <input
                  aria-label="关系来源"
                  onChange={(event) => setRelationSource(event.currentTarget.value)}
                  value={relationSource}
                />
              </label>
              <button
                className="secondary-button"
                disabled={relationState.status === 'saving' || !relationFrom || !relationTo}
                type="submit"
              >
                {relationState.status === 'saving' ? '正在添加…' : '添加关系'}
              </button>
              {relationState.status === 'error' ? (
                <p className="form-message form-message-error" role="alert">
                  {relationState.message}
                </p>
              ) : null}
              {relationState.status === 'saved' ? (
                <p className="form-message form-message-success" role="status">
                  {relationState.message}
                </p>
              ) : null}
            </form>
          </section>
        </aside>
      </div>
    </section>
  );
}

function CustomFieldControl({
  field,
  value,
  entities,
  onChange,
}: {
  field: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  entities: Entity[];
  onChange: (value: CustomFieldValue) => void;
}) {
  if (field.type === 'text') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <input
          aria-label={field.label}
          onChange={(event) => onChange(event.currentTarget.value)}
          value={typeof value === 'string' ? value : ''}
        />
      </label>
    );
  }
  if (field.type === 'number') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <input
          aria-label={field.label}
          onChange={(event) =>
            onChange(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))
          }
          type="number"
          value={typeof value === 'number' ? value : ''}
        />
      </label>
    );
  }
  if (field.type === 'date') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <input
          aria-label={field.label}
          onChange={(event) => onChange(event.currentTarget.value || null)}
          type="date"
          value={typeof value === 'string' ? value : ''}
        />
      </label>
    );
  }
  if (field.type === 'single_select') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select
          aria-label={field.label}
          onChange={(event) => onChange(event.currentTarget.value || null)}
          value={typeof value === 'string' ? value : ''}
        >
          <option value="">暂不选择</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="settings-choice-field">
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label key={option}>
            <input
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.currentTarget.checked
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
  if (field.type === 'boolean') {
    return (
      <label className="settings-checkbox-field">
        <input
          aria-label={field.label}
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{field.label}</span>
      </label>
    );
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      <select
        aria-label={field.label}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        value={typeof value === 'string' ? value : ''}
      >
        <option value="">暂不选择</option>
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name} · {entity.typeLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
