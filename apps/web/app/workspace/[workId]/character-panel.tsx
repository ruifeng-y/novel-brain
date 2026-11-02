'use client';

import type {
  CharacterKnowledgeInput,
  CharacterProfileInput,
  CharacterStateSaveInput,
} from '@novel/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, friendlyError } from '../../../lib/auth-api';
import {
  loadCharacter,
  saveCharacterProfile,
  saveCharacterState,
  type CharacterDetail,
} from '../../../lib/characters-api';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type StateDraft = {
  body: string;
  power: string;
  location: string;
  possessions: string;
  disguise: string;
  knowledge: CharacterKnowledgeInput[];
  reason: string;
  source: string;
};

const EMPTY_PROFILE: CharacterProfileInput = {
  desire: '',
  fear: '',
  secret: '',
  voice: '',
  arc: '',
};

const EMPTY_KNOWLEDGE: CharacterKnowledgeInput = {
  title: '',
  objectiveTruth: '',
  characterBelief: '',
  validFrom: '',
  validTo: null,
  source: '作者录入',
};

const FIELD_LABELS: Record<string, string> = {
  body: '身体状态',
  power: '力量状态',
  location: '所在地',
  possessions: '持有物',
  disguise: '伪装',
  knowledge: '知识状态',
};

function emptyState(): StateDraft {
  return {
    body: '',
    power: '',
    location: '',
    possessions: '',
    disguise: '',
    knowledge: [],
    reason: '',
    source: '作者录入',
  };
}

function detailToState(detail: CharacterDetail): StateDraft {
  return {
    body: detail.state.body,
    power: detail.state.power,
    location: detail.state.location,
    possessions: detail.state.possessions,
    disguise: detail.state.disguise,
    knowledge: detail.state.knowledge,
    reason: '',
    source: '作者录入',
  };
}

function characterError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'CHARACTER_NOT_FOUND') {
      return '没有找到这个人物，它可能已被删除。';
    }
    if (error.code === 'VALIDATION_ERROR') {
      return '请检查人物档案和状态内容后再保存。';
    }
  }
  return friendlyError(error);
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CharacterPanel({
  workId,
  branchId,
  characterId,
}: {
  workId: string;
  branchId: string;
  characterId: string;
}) {
  const [detail, setDetail] = useState<CharacterDetail | null>(null);
  const [profile, setProfile] = useState<CharacterProfileInput>(EMPTY_PROFILE);
  const [stateDraft, setStateDraft] = useState<StateDraft>(emptyState);
  const [loadState, setLoadState] = useState<SaveState>({ status: 'idle' });
  const [profileState, setProfileState] = useState<SaveState>({ status: 'idle' });
  const [stateSave, setStateSave] = useState<SaveState>({ status: 'idle' });

  useEffect(() => {
    let active = true;
    setLoadState({ status: 'saving' });
    setProfileState({ status: 'idle' });
    setStateSave({ status: 'idle' });
    loadCharacter(workId, branchId, characterId)
      .then((loaded) => {
        if (!active) {
          return;
        }
        setDetail(loaded);
        setProfile({
          desire: loaded.profile.desire,
          fear: loaded.profile.fear,
          secret: loaded.profile.secret,
          voice: loaded.profile.voice,
          arc: loaded.profile.arc,
        });
        setStateDraft(detailToState(loaded));
        setLoadState({ status: 'idle' });
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadState({ status: 'error', message: characterError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [branchId, characterId, workId]);

  function updateProfile<K extends keyof CharacterProfileInput>(
    key: K,
    value: CharacterProfileInput[K],
  ) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateState<K extends keyof Omit<StateDraft, 'knowledge' | 'reason' | 'source'>>(
    key: K,
    value: StateDraft[K],
  ) {
    setStateDraft((current) => ({ ...current, [key]: value }));
  }

  function updateKnowledge(index: number, patch: Partial<CharacterKnowledgeInput>) {
    setStateDraft((current) => ({
      ...current,
      knowledge: current.knowledge.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  function addKnowledge() {
    setStateDraft((current) => ({
      ...current,
      knowledge: [...current.knowledge, { ...EMPTY_KNOWLEDGE }],
    }));
  }

  function removeKnowledge(index: number) {
    setStateDraft((current) => ({
      ...current,
      knowledge: current.knowledge.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileState({ status: 'saving' });
    try {
      const saved = await saveCharacterProfile(workId, branchId, characterId, profile);
      setDetail((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                ...saved,
              },
            }
          : current,
      );
      setProfileState({ status: 'saved', message: '人物档案已保存' });
    } catch (error) {
      setProfileState({ status: 'error', message: characterError(error) });
    }
  }

  async function onSaveState(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStateSave({ status: 'saving' });
    const input: CharacterStateSaveInput = {
      body: stateDraft.body,
      power: stateDraft.power,
      location: stateDraft.location,
      possessions: stateDraft.possessions,
      disguise: stateDraft.disguise,
      knowledge: stateDraft.knowledge,
      reason: stateDraft.reason.trim() || '作者更新人物状态',
      source: stateDraft.source.trim() || '作者录入',
    };
    try {
      const saved = await saveCharacterState(workId, branchId, characterId, input);
      setDetail(saved);
      setStateDraft(detailToState(saved));
      setStateSave({ status: 'saved', message: '当前状态已保存' });
    } catch (error) {
      setStateSave({ status: 'error', message: characterError(error) });
    }
  }

  if (loadState.status === 'saving') {
    return <p className="character-panel-loading">正在打开人物档案…</p>;
  }

  if (loadState.status === 'error') {
    return (
      <p className="form-message form-message-error" role="alert">
        {loadState.message}
      </p>
    );
  }

  return (
    <section className="character-panel" aria-labelledby="character-panel-title">
      <div className="character-panel-heading">
        <div>
          <p className="workspace-step">人物档案与当前状态</p>
          <h3 id="character-panel-title">{detail?.character.name ?? '人物'}</h3>
          <p>先写清人物想要什么、怕什么，再记录他在当前时点知道什么、身在何处。</p>
        </div>
        <span>{detail?.state.version ? `第 ${detail.state.version} 版状态` : '尚未记录状态'}</span>
      </div>

      <form className="character-profile-form" onSubmit={onSaveProfile}>
        <div className="character-section-heading">
          <div>
            <h4>人物档案</h4>
            <p>欲望、恐惧和秘密推动选择，声纹约束说话方式，弧光记录人物会走向哪里。</p>
          </div>
        </div>
        <div className="character-profile-grid">
          <label className="field">
            <span>欲望</span>
            <textarea
              aria-label="欲望"
              onChange={(event) => updateProfile('desire', event.currentTarget.value)}
              placeholder="他最想得到什么？"
              rows={3}
              value={profile.desire}
            />
          </label>
          <label className="field">
            <span>恐惧</span>
            <textarea
              aria-label="恐惧"
              onChange={(event) => updateProfile('fear', event.currentTarget.value)}
              placeholder="他最怕失去什么？"
              rows={3}
              value={profile.fear}
            />
          </label>
          <label className="field">
            <span>秘密</span>
            <textarea
              aria-label="秘密"
              onChange={(event) => updateProfile('secret', event.currentTarget.value)}
              placeholder="他隐瞒了什么？"
              rows={3}
              value={profile.secret}
            />
          </label>
          <label className="field">
            <span>声纹</span>
            <textarea
              aria-label="声纹"
              onChange={(event) => updateProfile('voice', event.currentTarget.value)}
              placeholder="常用句长、语气、口头习惯和回避的话题"
              rows={3}
              value={profile.voice}
            />
          </label>
        </div>
        <label className="field">
          <span>弧光</span>
          <textarea
            aria-label="弧光"
            onChange={(event) => updateProfile('arc', event.currentTarget.value)}
            placeholder="他从哪里出发，会在关键转折后变成什么样？"
            rows={3}
            value={profile.arc}
          />
        </label>

        <div className="character-relations">
          <div>
            <h5>人物关系</h5>
            <p>人物关系沿用设定关系，可记录亲属、敌对、师承等关系与有效期。</p>
          </div>
          {detail?.profile.relationships.length ? (
            <ul>
              {detail.profile.relationships.map((relation) => (
                <li key={relation.id}>
                  <strong>
                    {relation.fromEntity.name} {relation.predicateLabel} {relation.toEntity.name}
                  </strong>
                  <span>
                    {relation.validFrom || '起点未定'} 至 {relation.validTo || '至今'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="character-empty">还没有人物关系，可在右侧「设定关系」中添加。</p>
          )}
        </div>

        {profileState.status === 'error' ? (
          <p className="form-message form-message-error" role="alert">
            {profileState.message}
          </p>
        ) : null}
        {profileState.status === 'saved' ? (
          <p className="form-message form-message-success" role="status">
            {profileState.message}
          </p>
        ) : null}
        <div className="character-form-actions">
          <button
            className="primary-button"
            disabled={profileState.status === 'saving'}
            type="submit"
          >
            {profileState.status === 'saving' ? '正在保存…' : '保存人物档案'}
          </button>
        </div>
      </form>

      <form className="character-state-form" onSubmit={onSaveState}>
        <div className="character-section-heading">
          <div>
            <h4>当前状态</h4>
            <p>状态会随剧情推进更新，每次保存都会留下变更原因和前后记录。</p>
          </div>
          <span>{detail?.state.updatedAt ? formatTime(detail.state.updatedAt) : '尚未保存'}</span>
        </div>
        <div className="character-state-grid">
          <label className="field">
            <span>身体状态</span>
            <textarea
              aria-label="身体状态"
              onChange={(event) => updateState('body', event.currentTarget.value)}
              placeholder="伤势、体力、残疾、恢复进度"
              rows={2}
              value={stateDraft.body}
            />
          </label>
          <label className="field">
            <span>力量状态</span>
            <textarea
              aria-label="力量状态"
              onChange={(event) => updateState('power', event.currentTarget.value)}
              placeholder="境界、能力、代价、暂时限制"
              rows={2}
              value={stateDraft.power}
            />
          </label>
          <label className="field">
            <span>所在地</span>
            <input
              aria-label="所在地"
              onChange={(event) => updateState('location', event.currentTarget.value)}
              placeholder="当前所在的地点"
              value={stateDraft.location}
            />
          </label>
          <label className="field">
            <span>持有物</span>
            <textarea
              aria-label="持有物"
              onChange={(event) => updateState('possessions', event.currentTarget.value)}
              placeholder="随身物品、武器、凭证"
              rows={2}
              value={stateDraft.possessions}
            />
          </label>
          <label className="field">
            <span>伪装</span>
            <textarea
              aria-label="伪装"
              onChange={(event) => updateState('disguise', event.currentTarget.value)}
              placeholder="外貌、身份、气息或言行上的掩饰"
              rows={2}
              value={stateDraft.disguise}
            />
          </label>
        </div>

        <div className="character-knowledge-heading">
          <div>
            <h5>知识状态</h5>
            <p>把实际发生的事和人物以为的事分开写，再标出这段认知的有效期。</p>
          </div>
          <button className="secondary-button" onClick={addKnowledge} type="button">
            添加知识
          </button>
        </div>

        {stateDraft.knowledge.length === 0 ? (
          <p className="character-empty">还没有记录人物知道或相信的事。</p>
        ) : (
          <div className="character-knowledge-list">
            {stateDraft.knowledge.map((entry, index) => {
              const suffix = index + 1;
              return (
                <fieldset className="character-knowledge-entry" key={entry.id ?? `new-${index}`}>
                  <legend>知识 {suffix}</legend>
                  <div className="character-state-grid">
                    <label className="field">
                      <span>知识主题 {suffix}</span>
                      <input
                        aria-label={`知识主题 ${suffix}`}
                        onChange={(event) =>
                          updateKnowledge(index, { title: event.currentTarget.value })
                        }
                        placeholder="例如：父母之死"
                        required
                        value={entry.title}
                      />
                    </label>
                    <label className="field">
                      <span>实际发生 {suffix}</span>
                      <textarea
                        aria-label={`实际发生 ${suffix}`}
                        onChange={(event) =>
                          updateKnowledge(index, {
                            objectiveTruth: event.currentTarget.value,
                          })
                        }
                        placeholder="故事里真正发生过什么"
                        required
                        rows={2}
                        value={entry.objectiveTruth}
                      />
                    </label>
                    <label className="field">
                      <span>人物以为 {suffix}</span>
                      <textarea
                        aria-label={`人物以为 ${suffix}`}
                        onChange={(event) =>
                          updateKnowledge(index, {
                            characterBelief: event.currentTarget.value,
                          })
                        }
                        placeholder="这个人物此刻相信什么"
                        required
                        rows={2}
                        value={entry.characterBelief}
                      />
                    </label>
                    <label className="field">
                      <span>有效期起点 {suffix}</span>
                      <input
                        aria-label={`有效期起点 ${suffix}`}
                        onChange={(event) =>
                          updateKnowledge(index, { validFrom: event.currentTarget.value })
                        }
                        placeholder="例如：第 1 章"
                        required
                        value={entry.validFrom}
                      />
                    </label>
                    <label className="field">
                      <span>有效期终点 {suffix}</span>
                      <input
                        aria-label={`有效期终点 ${suffix}`}
                        onChange={(event) =>
                          updateKnowledge(index, {
                            validTo: event.currentTarget.value || null,
                          })
                        }
                        placeholder="留空表示仍然有效"
                        value={entry.validTo ?? ''}
                      />
                    </label>
                    <label className="field">
                      <span>知识来源 {suffix}</span>
                      <input
                        aria-label={`知识来源 ${suffix}`}
                        onChange={(event) =>
                          updateKnowledge(index, { source: event.currentTarget.value })
                        }
                        placeholder="例如：第 1 章手稿"
                        value={entry.source}
                      />
                    </label>
                  </div>
                  <button
                    className="text-button character-remove-knowledge"
                    onClick={() => removeKnowledge(index)}
                    type="button"
                  >
                    移除这条知识
                  </button>
                </fieldset>
              );
            })}
          </div>
        )}

        <div className="character-state-grid character-change-meta">
          <label className="field">
            <span>状态变更原因</span>
            <input
              aria-label="状态变更原因"
              onChange={(event) => {
                const reason = event.currentTarget.value;
                setStateDraft((current) => ({ ...current, reason }));
              }}
              placeholder="例如：第 3 章左臂骨折"
              value={stateDraft.reason}
            />
          </label>
          <label className="field">
            <span>状态来源</span>
            <input
              aria-label="状态来源"
              onChange={(event) => {
                const source = event.currentTarget.value;
                setStateDraft((current) => ({ ...current, source }));
              }}
              placeholder="例如：第 3 章手稿"
              value={stateDraft.source}
            />
          </label>
        </div>

        {stateSave.status === 'error' ? (
          <p className="form-message form-message-error" role="alert">
            {stateSave.message}
          </p>
        ) : null}
        {stateSave.status === 'saved' ? (
          <p className="form-message form-message-success" role="status">
            {stateSave.message}
          </p>
        ) : null}
        <div className="character-form-actions">
          <button className="primary-button" disabled={stateSave.status === 'saving'} type="submit">
            {stateSave.status === 'saving' ? '正在保存…' : '保存当前状态'}
          </button>
          <p>每次保存都会追加记录，不会覆盖之前的版本。</p>
        </div>
      </form>

      <section className="character-history" aria-labelledby="character-history-title">
        <div className="character-section-heading">
          <div>
            <h4 id="character-history-title">状态变更记录</h4>
            <p>按时间倒序显示，可以回看当时的状态和改变原因。</p>
          </div>
          <span>{detail?.history.length ?? 0} 条</span>
        </div>
        {!detail?.history.length ? (
          <p className="character-empty">保存当前状态后，这里会出现第一条记录。</p>
        ) : (
          <ol>
            {detail.history.map((revision) => (
              <li key={revision.id}>
                <div className="character-history-title">
                  <strong>第 {revision.version} 次更新</strong>
                  <time dateTime={revision.createdAt}>{formatTime(revision.createdAt)}</time>
                </div>
                <p>
                  {revision.reason}
                  {revision.source ? ` · ${revision.source}` : ''}
                </p>
                <small>
                  更新了
                  {revision.changedFields
                    .map((field) => FIELD_LABELS[field] ?? '其他内容')
                    .join('、')}
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
