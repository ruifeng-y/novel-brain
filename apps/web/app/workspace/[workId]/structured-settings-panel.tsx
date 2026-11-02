'use client';

import {
  ITEM_TECHNIQUE_KIND_LABELS,
  STORY_DURATION_UNIT_LABELS,
  type GoldenFingerInput,
  type ItemTechniqueProfileInput,
  type PowerBreakthroughInput,
  type PowerLevelInput,
  type PowerPathInput,
  type StoryAbsoluteDate,
  type StoryDuration,
  type TimelineEraInput,
  type TimelineNodeInput,
} from '@novel/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, friendlyError } from '../../../lib/auth-api';
import type { Entity } from '../../../lib/entities-api';
import {
  checkPowerBreakthrough,
  createGoldenFinger,
  createItemOwnership,
  createTimelineEra,
  createTimelineNode,
  endItemOwnership,
  loadGoldenFingers,
  loadItemTechnique,
  loadPowerSystem,
  loadTimeline,
  saveItemTechnique,
  savePowerSystem,
  updateGoldenFinger,
  type BreakthroughCheck,
  type GoldenFinger,
  type ItemTechniqueProfile,
  type PowerSystemProfile,
  type Timeline,
} from '../../../lib/worldbuilding-api';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type EntityOption = {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
};

const ITEM_KINDS = Object.entries(ITEM_TECHNIQUE_KIND_LABELS) as Array<
  [keyof typeof ITEM_TECHNIQUE_KIND_LABELS, string]
>;
const DURATION_UNITS = Object.entries(STORY_DURATION_UNIT_LABELS) as Array<
  [keyof typeof STORY_DURATION_UNIT_LABELS, string]
>;

function splitLines(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function splitItems(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function splitResourceItems(value: string): Array<{ name: string; amount: number }> {
  return splitItems(value)
    .map((item) => {
      const [name, rawAmount] = item.split(/[:：]/);
      return {
        name: name?.trim() ?? '',
        amount: Number(rawAmount?.trim() ?? 0),
      };
    })
    .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0);
}

function parseStoryDate(value: string): StoryAbsoluteDate | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d+)(?:[-/年](\d+))?(?:[-/月](\d+))?日?$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    ...(match[2] ? { month: Number(match[2]) } : {}),
    ...(match[3] ? { day: Number(match[3]) } : {}),
    note: '',
  };
}

function structuredError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'ITEM_OWNERSHIP_CONFLICT') {
      return '这件物品已有当前归属，先结束上一段归属再添加。';
    }
    if (error.code === 'GOLDEN_FINGER_NAME_CONFLICT') {
      return '这个归属下已经有同名金手指，换个名称再试。';
    }
    if (error.code === 'TIMELINE_ERA_NAME_CONFLICT') {
      return '这条时间线里已经有同名纪元。';
    }
    if (error.code === 'TIMELINE_ERA_INVALID' || error.code === 'TIMELINE_NODE_INVALID') {
      return '请选择当前时间线里的纪元和事件。';
    }
    if (error.code === 'VALIDATION_ERROR') {
      return '有几项内容不符合格式，请按提示检查后再保存。';
    }
  }
  return friendlyError(error);
}

function eligibleOwners(entities: Entity[], type: 'golden' | 'item'): EntityOption[] {
  return entities
    .filter((entity) =>
      type === 'golden'
        ? entity.type === 'character' || entity.type === 'power_system'
        : entity.type === 'character' || entity.type === 'faction',
    )
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      typeLabel: entity.typeLabel,
    }));
}

export function StructuredSettingsPanel({
  workId,
  branchId,
  entity,
  entities,
}: {
  workId: string;
  branchId: string;
  entity: Entity;
  entities: Entity[];
}) {
  if (entity.type === 'power_system') {
    return (
      <PowerSystemEditor branchId={branchId} entity={entity} entities={entities} workId={workId} />
    );
  }
  if (entity.type === 'character') {
    return (
      <GoldenFingerEditor branchId={branchId} entities={entities} owner={entity} workId={workId} />
    );
  }
  if (entity.type === 'item_technique') {
    return (
      <ItemTechniqueEditor
        branchId={branchId}
        entity={entity}
        entities={entities}
        workId={workId}
      />
    );
  }
  if (entity.type === 'timeline') {
    return <TimelineEditor branchId={branchId} entity={entity} workId={workId} />;
  }
  return null;
}

function PowerSystemEditor({
  workId,
  branchId,
  entity,
  entities,
}: {
  workId: string;
  branchId: string;
  entity: Entity;
  entities: Entity[];
}) {
  const [profile, setProfile] = useState<PowerSystemProfile | null>(null);
  const [levelsText, setLevelsText] = useState('');
  const [pathsText, setPathsText] = useState('');
  const [breakthroughsText, setBreakthroughsText] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [fromLevel, setFromLevel] = useState('');
  const [toLevel, setToLevel] = useState('');
  const [conditionsMetText, setConditionsMetText] = useState('');
  const [resourcesAvailableText, setResourcesAvailableText] = useState('');
  const [checkState, setCheckState] = useState<SaveState>({ status: 'idle' });
  const [checkResult, setCheckResult] = useState<BreakthroughCheck | null>(null);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setSaveState({ status: 'idle' });
    loadPowerSystem(workId, branchId, entity.id)
      .then((loaded) => {
        if (!active) {
          return;
        }
        setProfile(loaded);
        setLevelsText(
          loaded.levels.map((level) => `${level.name}|${level.description}`).join('\n'),
        );
        setPathsText(
          loaded.paths
            .map((path) => `${path.name}|${path.description}|${path.levels.join('、')}`)
            .join('\n'),
        );
        setBreakthroughsText(
          loaded.breakthroughs
            .map(
              (rule) =>
                `${rule.fromLevel}→${rule.toLevel}|${rule.conditions.join('、')}|${rule.costs.join('、')}|${rule.bottlenecks.join('、')}|${rule.counters.join('、')}|${rule.resources.map((resource) => `${resource.name}:${resource.amount}`).join('、')}`,
            )
            .join('\n'),
        );
        setFromLevel(loaded.levels[0]?.name ?? '');
        setToLevel(loaded.levels[1]?.name ?? '');
      })
      .catch((error: unknown) => {
        if (active) {
          setSaveState({ status: 'error', message: structuredError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, entity.id, workId]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const levels: PowerLevelInput[] = splitLines(levelsText).map((line, index) => {
      const [name, description = ''] = line.split('|');
      return {
        name: name.trim(),
        order: index + 1,
        description: description.trim(),
      };
    });
    const paths: PowerPathInput[] = splitLines(pathsText).map((line) => {
      const [name, description = '', rawLevels = ''] = line.split('|');
      return {
        name: name.trim(),
        description: description.trim(),
        levels: splitItems(rawLevels),
      };
    });
    const breakthroughs: PowerBreakthroughInput[] = splitLines(breakthroughsText).map((line) => {
      const [
        levelsPart,
        conditions = '',
        costs = '',
        bottlenecks = '',
        counters = '',
        resources = '',
      ] = line.split('|');
      const [fromLevelValue, toLevelValue = ''] = levelsPart.split(/→|->/);
      return {
        fromLevel: fromLevelValue.trim(),
        toLevel: toLevelValue.trim(),
        conditions: splitItems(conditions),
        costs: splitItems(costs),
        bottlenecks: splitItems(bottlenecks),
        counters: splitItems(counters),
        resources: splitResourceItems(resources),
      };
    });
    setSaveState({ status: 'saving' });
    try {
      const saved = await savePowerSystem(workId, branchId, entity.id, {
        levels,
        paths,
        breakthroughs,
      });
      setProfile(saved);
      setFromLevel(saved.levels[0]?.name ?? '');
      setToLevel(saved.levels[1]?.name ?? '');
      setSaveState({ status: 'saved', message: '力量体系规则已保存' });
    } catch (error) {
      setSaveState({ status: 'error', message: structuredError(error) });
    }
  }

  async function onCheckBreakthrough(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckState({ status: 'saving' });
    setCheckResult(null);
    try {
      const result = await checkPowerBreakthrough(workId, branchId, entity.id, {
        fromLevel,
        toLevel,
        conditionsMet: splitLines(conditionsMetText),
        resourcesAvailable: splitResourceItems(resourcesAvailableText),
      });
      setCheckResult(result);
      setCheckState({ status: 'idle' });
    } catch (error) {
      setCheckState({ status: 'error', message: structuredError(error) });
    }
  }

  return (
    <section className="structured-settings" aria-labelledby="power-rules-title">
      <div className="structured-settings-heading">
        <div>
          <p className="workspace-step">成长规则</p>
          <h3 id="power-rules-title">力量体系规则</h3>
          <p>按从低到高写清层级，再补上路径、突破条件、代价、瓶颈、克制和资源。</p>
        </div>
        <span>{profile?.totalLevels ?? 0} 个层级</span>
      </div>

      <form className="structured-form" onSubmit={onSave}>
        <label className="field">
          <span>层级（每行一个，格式：名称｜说明）</span>
          <textarea
            aria-label="力量层级"
            onChange={(event) => setLevelsText(event.currentTarget.value)}
            placeholder={'炼气|引气入体\n筑基|道基初成\n金丹|结成金丹'}
            rows={6}
            value={levelsText}
          />
        </label>
        <label className="field">
          <span>路径（每行一个，格式：名称｜说明｜可用层级）</span>
          <textarea
            aria-label="力量路径"
            onChange={(event) => setPathsText(event.currentTarget.value)}
            placeholder="剑修|以剑意破境|炼气、筑基、金丹"
            rows={4}
            value={pathsText}
          />
        </label>
        <label className="field">
          <span>突破规则（每行一条：起点→终点｜条件｜代价｜瓶颈｜克制｜资源名称:数量）</span>
          <textarea
            aria-label="突破规则"
            onChange={(event) => setBreakthroughsText(event.currentTarget.value)}
            placeholder="炼气→筑基|剑意初成、心境无隙|十年寿元|经脉未固|雷法、镇魂钟|下品灵石:3"
            rows={5}
            value={breakthroughsText}
          />
        </label>
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
        <button className="primary-button" disabled={saveState.status === 'saving'} type="submit">
          {saveState.status === 'saving' ? '正在保存…' : '保存力量体系'}
        </button>
      </form>

      <div className="structured-subsection">
        <div className="structured-settings-heading">
          <div>
            <h4>突破校验</h4>
            <p>填入已经满足的条件和现有资源，看看还差什么。</p>
          </div>
        </div>
        <form className="structured-form" onSubmit={onCheckBreakthrough}>
          <div className="structured-grid">
            <label className="field">
              <span>当前层级</span>
              <select
                aria-label="当前层级"
                onChange={(event) => setFromLevel(event.currentTarget.value)}
                required
                value={fromLevel}
              >
                <option value="">选择层级</option>
                {(profile?.levels ?? []).map((level) => (
                  <option key={level.name} value={level.name}>
                    {level.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>目标层级</span>
              <select
                aria-label="目标层级"
                onChange={(event) => setToLevel(event.currentTarget.value)}
                required
                value={toLevel}
              >
                <option value="">选择层级</option>
                {(profile?.levels ?? []).map((level) => (
                  <option key={level.name} value={level.name}>
                    {level.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="structured-grid">
            <label className="field">
              <span>已满足条件（每行一条）</span>
              <textarea
                aria-label="已满足条件"
                onChange={(event) => setConditionsMetText(event.currentTarget.value)}
                placeholder="剑意初成"
                rows={3}
                value={conditionsMetText}
              />
            </label>
            <label className="field">
              <span>现有资源（每行：名称:数量）</span>
              <textarea
                aria-label="现有资源"
                onChange={(event) => setResourcesAvailableText(event.currentTarget.value)}
                placeholder="下品灵石:2"
                rows={3}
                value={resourcesAvailableText}
              />
            </label>
          </div>
          <button
            className="secondary-button structured-action"
            disabled={checkState.status === 'saving'}
            type="submit"
          >
            {checkState.status === 'saving' ? '正在检查…' : '检查突破'}
          </button>
          {checkState.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {checkState.message}
            </p>
          ) : null}
          {checkResult ? (
            <div
              className={`breakthrough-result ${checkResult.allowed ? 'allowed' : 'blocked'}`}
              role="status"
            >
              <strong>{checkResult.allowed ? '可以突破' : '还差一些条件'}</strong>
              {checkResult.missingConditions.length > 0 ? (
                <p>缺条件：{checkResult.missingConditions.join('、')}</p>
              ) : null}
              {checkResult.missingResources.length > 0 ? (
                <p>
                  缺资源：
                  {checkResult.missingResources
                    .map(
                      (resource) =>
                        `${resource.name}（还差 ${resource.required - resource.available}）`,
                    )
                    .join('、')}
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>

      <GoldenFingerEditor branchId={branchId} entities={entities} owner={entity} workId={workId} />
    </section>
  );
}

function GoldenFingerEditor({
  workId,
  branchId,
  owner,
  entities,
}: {
  workId: string;
  branchId: string;
  owner: Entity;
  entities: Entity[];
}) {
  const [items, setItems] = useState<GoldenFinger[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ownerEntityId, setOwnerEntityId] = useState(owner.id);
  const [name, setName] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [costsText, setCostsText] = useState('');
  const [limitsText, setLimitsText] = useState('');
  const [growthText, setGrowthText] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const owners = eligibleOwners(entities, 'golden');

  useEffect(() => {
    let active = true;
    loadGoldenFingers(workId, branchId, owner.id)
      .then((result) => {
        if (active) {
          setItems(result.items);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSaveState({ status: 'error', message: structuredError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, owner.id, workId]);

  function resetForm() {
    setEditingId(null);
    setOwnerEntityId(owner.id);
    setName('');
    setRulesText('');
    setCostsText('');
    setLimitsText('');
    setGrowthText('');
  }

  function editGoldenFinger(item: GoldenFinger) {
    setEditingId(item.id);
    setOwnerEntityId(item.ownerEntityId);
    setName(item.name);
    setRulesText(item.rules.join('\n'));
    setCostsText(item.costs.join('\n'));
    setLimitsText(item.limits.join('\n'));
    setGrowthText(
      item.growthCurve.map((point) => `${point.stage}|${point.description}`).join('\n'),
    );
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: GoldenFingerInput = {
      ownerEntityId,
      name,
      rules: splitLines(rulesText),
      costs: splitLines(costsText),
      limits: splitLines(limitsText),
      growthCurve: splitLines(growthText).map((line) => {
        const [stage, description = ''] = line.split('|');
        return { stage: stage.trim(), description: description.trim() };
      }),
    };
    setSaveState({ status: 'saving' });
    try {
      if (editingId) {
        await updateGoldenFinger(workId, branchId, editingId, input);
      } else {
        await createGoldenFinger(workId, branchId, input);
      }
      const refreshed = await loadGoldenFingers(workId, branchId, owner.id);
      setItems(refreshed.items);
      resetForm();
      setSaveState({ status: 'saved', message: '金手指已保存' });
    } catch (error) {
      setSaveState({ status: 'error', message: structuredError(error) });
    }
  }

  return (
    <div className="structured-subsection">
      <div className="structured-settings-heading">
        <div>
          <h4>金手指</h4>
          <p>写清规则、代价、限制和成长阶段，避免它变成没有边界的万能能力。</p>
        </div>
        <span>{items.length} 项</span>
      </div>

      {items.length > 0 ? (
        <ul className="structured-record-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.ownerEntity.name}</span>
                <small>
                  {item.rules.length} 条规则 · {item.costs.length} 项代价 · {item.limits.length}{' '}
                  条限制 · {item.growthCurve.length} 个成长阶段
                </small>
              </div>
              <button className="text-button" onClick={() => editGoldenFinger(item)} type="button">
                编辑
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-list-empty">还没有金手指。</p>
      )}

      <form className="structured-form" onSubmit={onSave}>
        <div className="structured-grid">
          <label className="field">
            <span>金手指归属</span>
            <select
              aria-label="金手指归属"
              onChange={(event) => setOwnerEntityId(event.currentTarget.value)}
              value={ownerEntityId}
            >
              {owners.map((ownerOption) => (
                <option key={ownerOption.id} value={ownerOption.id}>
                  {ownerOption.name} · {ownerOption.typeLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>金手指名称</span>
            <input
              aria-label="金手指名称"
              onChange={(event) => setName(event.currentTarget.value)}
              required
              value={name}
            />
          </label>
        </div>
        <div className="structured-grid">
          <label className="field">
            <span>规则（每行一条）</span>
            <textarea
              aria-label="金手指规则"
              onChange={(event) => setRulesText(event.currentTarget.value)}
              rows={4}
              value={rulesText}
            />
          </label>
          <label className="field">
            <span>代价（每行一条）</span>
            <textarea
              aria-label="金手指代价"
              onChange={(event) => setCostsText(event.currentTarget.value)}
              rows={4}
              value={costsText}
            />
          </label>
        </div>
        <div className="structured-grid">
          <label className="field">
            <span>限制（每行一条）</span>
            <textarea
              aria-label="金手指限制"
              onChange={(event) => setLimitsText(event.currentTarget.value)}
              rows={4}
              value={limitsText}
            />
          </label>
          <label className="field">
            <span>成长曲线（每行：阶段｜说明）</span>
            <textarea
              aria-label="金手指成长曲线"
              onChange={(event) => setGrowthText(event.currentTarget.value)}
              placeholder="初醒|只能借炼气修士的最后一剑"
              rows={4}
              value={growthText}
            />
          </label>
        </div>
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
        <div className="structured-actions">
          <button
            className="secondary-button"
            disabled={saveState.status === 'saving'}
            type="submit"
          >
            {saveState.status === 'saving' ? '正在保存…' : editingId ? '保存金手指' : '添加金手指'}
          </button>
          {editingId ? (
            <button className="text-button" onClick={resetForm} type="button">
              取消编辑
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function ItemTechniqueEditor({
  workId,
  branchId,
  entity,
  entities,
}: {
  workId: string;
  branchId: string;
  entity: Entity;
  entities: Entity[];
}) {
  const [profile, setProfile] = useState<ItemTechniqueProfile | null>(null);
  const [kind, setKind] = useState<ItemTechniqueProfileInput['kind']>('item');
  const [grade, setGrade] = useState('');
  const [effectsText, setEffectsText] = useState('');
  const [costsText, setCostsText] = useState('');
  const [restrictionsText, setRestrictionsText] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [ownershipState, setOwnershipState] = useState<SaveState>({ status: 'idle' });
  const [ownerEntityId, setOwnerEntityId] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [source, setSource] = useState('作者录入');
  const [endedAt, setEndedAt] = useState('');
  const owners = eligibleOwners(entities, 'item');

  function applyProfile(loaded: ItemTechniqueProfile) {
    setProfile(loaded);
    setKind(loaded.kind);
    setGrade(loaded.grade);
    setEffectsText(loaded.effects.join('\n'));
    setCostsText(loaded.costs.join('\n'));
    setRestrictionsText(loaded.restrictions.join('\n'));
    if (!ownerEntityId && owners[0]) {
      setOwnerEntityId(owners[0].id);
    }
  }

  useEffect(() => {
    let active = true;
    loadItemTechnique(workId, branchId, entity.id)
      .then((loaded) => {
        if (active) {
          applyProfile(loaded);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSaveState({ status: 'error', message: structuredError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, entity.id, workId]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState({ status: 'saving' });
    try {
      const saved = await saveItemTechnique(workId, branchId, entity.id, {
        kind,
        grade,
        effects: splitLines(effectsText),
        costs: splitLines(costsText),
        restrictions: splitLines(restrictionsText),
      });
      applyProfile(saved);
      setSaveState({ status: 'saved', message: '物品功法已保存' });
    } catch (error) {
      setSaveState({ status: 'error', message: structuredError(error) });
    }
  }

  async function onAddOwnership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownerEntityId) {
      return;
    }
    setOwnershipState({ status: 'saving' });
    try {
      await createItemOwnership(workId, branchId, entity.id, {
        ownerEntityId,
        fromTime,
        source,
      });
      applyProfile(await loadItemTechnique(workId, branchId, entity.id));
      setFromTime('');
      setSource('作者录入');
      setOwnershipState({ status: 'saved', message: '归属已记录' });
    } catch (error) {
      setOwnershipState({ status: 'error', message: structuredError(error) });
    }
  }

  async function onEndOwnership(ownershipId: string) {
    if (!endedAt.trim()) {
      setOwnershipState({ status: 'error', message: '先填写归属结束时间。' });
      return;
    }
    setOwnershipState({ status: 'saving' });
    try {
      await endItemOwnership(workId, branchId, entity.id, ownershipId, endedAt);
      applyProfile(await loadItemTechnique(workId, branchId, entity.id));
      setEndedAt('');
      setOwnershipState({ status: 'saved', message: '这段归属已结束' });
    } catch (error) {
      setOwnershipState({ status: 'error', message: structuredError(error) });
    }
  }

  return (
    <section className="structured-settings" aria-labelledby="item-rules-title">
      <div className="structured-settings-heading">
        <div>
          <p className="workspace-step">品阶与归属</p>
          <h3 id="item-rules-title">物品功法规则</h3>
          <p>记录品阶、效果、代价和限制，并留下可追溯的归属历史。</p>
        </div>
        <span>{profile?.currentOwner?.ownerName ?? '暂无归属'}</span>
      </div>

      <form className="structured-form" onSubmit={onSave}>
        <div className="structured-grid">
          <label className="field">
            <span>类别</span>
            <select
              aria-label="物品功法类别"
              onChange={(event) =>
                setKind(event.currentTarget.value as ItemTechniqueProfileInput['kind'])
              }
              value={kind}
            >
              {ITEM_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>品阶</span>
            <input
              aria-label="物品品阶"
              onChange={(event) => setGrade(event.currentTarget.value)}
              placeholder="例如：天阶"
              value={grade}
            />
          </label>
        </div>
        <label className="field">
          <span>效果（每行一条）</span>
          <textarea
            aria-label="物品效果"
            onChange={(event) => setEffectsText(event.currentTarget.value)}
            rows={4}
            value={effectsText}
          />
        </label>
        <div className="structured-grid">
          <label className="field">
            <span>代价（每行一条）</span>
            <textarea
              aria-label="物品代价"
              onChange={(event) => setCostsText(event.currentTarget.value)}
              rows={4}
              value={costsText}
            />
          </label>
          <label className="field">
            <span>限制（每行一条）</span>
            <textarea
              aria-label="物品限制"
              onChange={(event) => setRestrictionsText(event.currentTarget.value)}
              rows={4}
              value={restrictionsText}
            />
          </label>
        </div>
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
        <button
          className="primary-button structured-action"
          disabled={saveState.status === 'saving'}
          type="submit"
        >
          {saveState.status === 'saving' ? '正在保存…' : '保存物品功法'}
        </button>
      </form>

      <div className="structured-subsection">
        <div className="structured-settings-heading">
          <div>
            <h4>归属历史</h4>
            <p>同一时间只能有一个当前归属，结束上一段后才能转交。</p>
          </div>
          <span>{profile?.ownerships.length ?? 0} 段</span>
        </div>
        {profile?.ownerships.length ? (
          <ul className="structured-record-list">
            {profile.ownerships.map((ownership) => (
              <li key={ownership.id}>
                <div>
                  <strong>{ownership.ownerEntity.name}</strong>
                  <span>
                    {ownership.fromTime || '起点未定'} 至 {ownership.endedAt || '至今'}
                  </span>
                  <small>{ownership.source}</small>
                </div>
                {ownership.current ? (
                  <div className="ownership-end">
                    <input
                      aria-label="当前归属结束时间"
                      onChange={(event) => setEndedAt(event.currentTarget.value)}
                      placeholder="例如：第 3 章"
                      value={endedAt}
                    />
                    <button
                      className="secondary-button"
                      disabled={ownershipState.status === 'saving'}
                      onClick={() => void onEndOwnership(ownership.id)}
                      type="button"
                    >
                      结束归属
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-list-empty">还没有归属记录。</p>
        )}
        <form className="structured-form" onSubmit={onAddOwnership}>
          <div className="structured-grid">
            <label className="field">
              <span>归属对象</span>
              <select
                aria-label="归属对象"
                onChange={(event) => setOwnerEntityId(event.currentTarget.value)}
                required
                value={ownerEntityId}
              >
                <option value="">选择归属对象</option>
                {owners.map((ownerOption) => (
                  <option key={ownerOption.id} value={ownerOption.id}>
                    {ownerOption.name} · {ownerOption.typeLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>归属起始</span>
              <input
                aria-label="归属起始"
                onChange={(event) => setFromTime(event.currentTarget.value)}
                placeholder="例如：第 1 章"
                value={fromTime}
              />
            </label>
          </div>
          <label className="field">
            <span>归属来源</span>
            <input
              aria-label="归属来源"
              onChange={(event) => setSource(event.currentTarget.value)}
              value={source}
            />
          </label>
          {ownershipState.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {ownershipState.message}
            </p>
          ) : null}
          {ownershipState.status === 'saved' ? (
            <p className="form-message form-message-success" role="status">
              {ownershipState.message}
            </p>
          ) : null}
          <button
            className="secondary-button structured-action"
            disabled={ownershipState.status === 'saving' || !ownerEntityId}
            type="submit"
          >
            {ownershipState.status === 'saving' ? '正在记录…' : '添加归属'}
          </button>
        </form>
      </div>
    </section>
  );
}

function TimelineEditor({
  workId,
  branchId,
  entity,
}: {
  workId: string;
  branchId: string;
  entity: Entity;
}) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [eraName, setEraName] = useState('');
  const [eraSummary, setEraSummary] = useState('');
  const [eraStart, setEraStart] = useState('');
  const [eraEnd, setEraEnd] = useState('');
  const [eraState, setEraState] = useState<SaveState>({ status: 'idle' });
  const [nodeTitle, setNodeTitle] = useState('');
  const [nodeSummary, setNodeSummary] = useState('');
  const [nodeEraId, setNodeEraId] = useState('');
  const [nodeAbsoluteDate, setNodeAbsoluteDate] = useState('');
  const [nodeRelativeTime, setNodeRelativeTime] = useState('');
  const [nodeRelativeTo, setNodeRelativeTo] = useState('');
  const [durationAmount, setDurationAmount] = useState('');
  const [durationUnit, setDurationUnit] = useState<StoryDuration['unit']>('day');
  const [nodeState, setNodeState] = useState<SaveState>({ status: 'idle' });

  function applyTimeline(loaded: Timeline) {
    setTimeline(loaded);
    setNodeEraId(loaded.eras[0]?.id ?? '');
  }

  useEffect(() => {
    let active = true;
    loadTimeline(workId, branchId, entity.id)
      .then((loaded) => {
        if (active) {
          applyTimeline(loaded);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setEraState({ status: 'error', message: structuredError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, entity.id, workId]);

  async function onCreateEra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startDate = parseStoryDate(eraStart);
    const endDate = parseStoryDate(eraEnd);
    if ((eraStart.trim() && !startDate) || (eraEnd.trim() && !endDate)) {
      setEraState({ status: 'error', message: '纪元日期请按“年-月-日”填写。' });
      return;
    }
    const input: TimelineEraInput = {
      name: eraName,
      summary: eraSummary,
      startDate,
      endDate,
    };
    setEraState({ status: 'saving' });
    try {
      await createTimelineEra(workId, branchId, entity.id, input);
      applyTimeline(await loadTimeline(workId, branchId, entity.id));
      setEraName('');
      setEraSummary('');
      setEraStart('');
      setEraEnd('');
      setEraState({ status: 'saved', message: '纪元已添加' });
    } catch (error) {
      setEraState({ status: 'error', message: structuredError(error) });
    }
  }

  async function onCreateNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const absoluteDate = parseStoryDate(nodeAbsoluteDate);
    if (nodeAbsoluteDate.trim() && !absoluteDate) {
      setNodeState({ status: 'error', message: '绝对日期请按“年-月-日”填写。' });
      return;
    }
    const duration =
      durationAmount.trim() && Number(durationAmount) > 0
        ? { amount: Number(durationAmount), unit: durationUnit }
        : null;
    const input: TimelineNodeInput = {
      title: nodeTitle,
      summary: nodeSummary,
      eraId: nodeEraId || null,
      absoluteDate,
      relativeTime: nodeRelativeTime,
      relativeToNodeId: nodeRelativeTo || null,
      duration,
      orderIndex: timeline?.nodes.length ?? 0,
    };
    setNodeState({ status: 'saving' });
    try {
      await createTimelineNode(workId, branchId, entity.id, input);
      applyTimeline(await loadTimeline(workId, branchId, entity.id));
      setNodeTitle('');
      setNodeSummary('');
      setNodeAbsoluteDate('');
      setNodeRelativeTime('');
      setNodeRelativeTo('');
      setDurationAmount('');
      setNodeState({ status: 'saved', message: '事件节点已添加' });
    } catch (error) {
      setNodeState({ status: 'error', message: structuredError(error) });
    }
  }

  return (
    <section className="structured-settings" aria-labelledby="timeline-rules-title">
      <div className="structured-settings-heading">
        <div>
          <p className="workspace-step">故事时间</p>
          <h3 id="timeline-rules-title">时间线</h3>
          <p>用纪元和事件节点整理故事时间，绝对日期与相对时间可以一起使用。</p>
        </div>
        <span>{timeline?.nodes.length ?? 0} 个事件</span>
      </div>

      <div className="structured-subsection">
        <div className="structured-settings-heading">
          <div>
            <h4>纪元</h4>
            <p>每个纪元可以记录起止日期和一句说明。</p>
          </div>
          <span>{timeline?.eras.length ?? 0} 个纪元</span>
        </div>
        {timeline?.eras.length ? (
          <ul className="structured-record-list">
            {timeline.eras.map((era) => (
              <li key={era.id}>
                <div>
                  <strong>{era.name}</strong>
                  <span>
                    {era.startDateLabel || '起点未定'} 至 {era.endDateLabel || '至今'}
                  </span>
                  <small>{era.summary || '还没有说明'}</small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-list-empty">还没有纪元。</p>
        )}
        <form className="structured-form" onSubmit={onCreateEra}>
          <div className="structured-grid">
            <label className="field">
              <span>纪元名称</span>
              <input
                aria-label="纪元名称"
                onChange={(event) => setEraName(event.currentTarget.value)}
                required
                value={eraName}
              />
            </label>
            <label className="field">
              <span>纪元说明</span>
              <input
                aria-label="纪元说明"
                onChange={(event) => setEraSummary(event.currentTarget.value)}
                value={eraSummary}
              />
            </label>
          </div>
          <div className="structured-grid">
            <label className="field">
              <span>纪元起始（年-月-日）</span>
              <input
                aria-label="纪元起始"
                onChange={(event) => setEraStart(event.currentTarget.value)}
                placeholder="1-1-1"
                value={eraStart}
              />
            </label>
            <label className="field">
              <span>纪元结束（年-月-日）</span>
              <input
                aria-label="纪元结束"
                onChange={(event) => setEraEnd(event.currentTarget.value)}
                placeholder="120-12-31"
                value={eraEnd}
              />
            </label>
          </div>
          {eraState.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {eraState.message}
            </p>
          ) : null}
          {eraState.status === 'saved' ? (
            <p className="form-message form-message-success" role="status">
              {eraState.message}
            </p>
          ) : null}
          <button
            className="secondary-button structured-action"
            disabled={eraState.status === 'saving'}
            type="submit"
          >
            {eraState.status === 'saving' ? '正在添加…' : '添加纪元'}
          </button>
        </form>
      </div>

      <div className="structured-subsection">
        <div className="structured-settings-heading">
          <div>
            <h4>事件节点</h4>
            <p>可以写绝对日期，也可以用“三日后”这样的相对时间和持续时长。</p>
          </div>
        </div>
        {timeline?.nodes.length ? (
          <ol className="timeline-node-list">
            {timeline.nodes.map((node) => (
              <li key={node.id}>
                <div>
                  <strong>{node.title}</strong>
                  <span>
                    {[node.era?.name, node.absoluteDateLabel, node.relativeTime, node.durationLabel]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <small>{node.summary || '还没有说明'}</small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="settings-list-empty">还没有事件节点。</p>
        )}
        <form className="structured-form" onSubmit={onCreateNode}>
          <div className="structured-grid">
            <label className="field">
              <span>事件标题</span>
              <input
                aria-label="事件标题"
                onChange={(event) => setNodeTitle(event.currentTarget.value)}
                required
                value={nodeTitle}
              />
            </label>
            <label className="field">
              <span>所属纪元</span>
              <select
                aria-label="所属纪元"
                onChange={(event) => setNodeEraId(event.currentTarget.value)}
                value={nodeEraId}
              >
                <option value="">不指定纪元</option>
                {(timeline?.eras ?? []).map((era) => (
                  <option key={era.id} value={era.id}>
                    {era.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>事件说明</span>
            <textarea
              aria-label="事件说明"
              onChange={(event) => setNodeSummary(event.currentTarget.value)}
              rows={3}
              value={nodeSummary}
            />
          </label>
          <div className="structured-grid">
            <label className="field">
              <span>绝对日期（年-月-日，可留空）</span>
              <input
                aria-label="事件绝对日期"
                onChange={(event) => setNodeAbsoluteDate(event.currentTarget.value)}
                placeholder="12-4-9"
                value={nodeAbsoluteDate}
              />
            </label>
            <label className="field">
              <span>相对时间</span>
              <input
                aria-label="事件相对时间"
                onChange={(event) => setNodeRelativeTime(event.currentTarget.value)}
                placeholder="例如：三日后"
                value={nodeRelativeTime}
              />
            </label>
          </div>
          <div className="structured-grid">
            <label className="field">
              <span>相对哪个事件</span>
              <select
                aria-label="相对哪个事件"
                onChange={(event) => setNodeRelativeTo(event.currentTarget.value)}
                value={nodeRelativeTo}
              >
                <option value="">不指定事件</option>
                {(timeline?.nodes ?? []).map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="structured-grid structured-duration">
              <label className="field">
                <span>持续时长</span>
                <input
                  aria-label="持续时长"
                  min={1}
                  onChange={(event) => setDurationAmount(event.currentTarget.value)}
                  type="number"
                  value={durationAmount}
                />
              </label>
              <label className="field">
                <span>时长单位</span>
                <select
                  aria-label="时长单位"
                  onChange={(event) =>
                    setDurationUnit(event.currentTarget.value as StoryDuration['unit'])
                  }
                  value={durationUnit}
                >
                  {DURATION_UNITS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {nodeState.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {nodeState.message}
            </p>
          ) : null}
          {nodeState.status === 'saved' ? (
            <p className="form-message form-message-success" role="status">
              {nodeState.message}
            </p>
          ) : null}
          <button
            className="secondary-button structured-action"
            disabled={nodeState.status === 'saving'}
            type="submit"
          >
            {nodeState.status === 'saving' ? '正在添加…' : '添加事件节点'}
          </button>
        </form>
      </div>
    </section>
  );
}
