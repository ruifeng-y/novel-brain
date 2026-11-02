'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, friendlyError } from '../../../lib/auth-api';
import {
  UPDATE_CADENCE_OPTIONS,
  removeWorkCover,
  uploadWorkCover,
  type Work,
} from '../../../lib/works-api';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type ProfileDraft = {
  targetReader: string;
  chapterWordCount: string;
  updateCadence: string;
  styleSamples: string;
  taboos: string;
  synopsis: string;
  tags: string;
};

function draftFromWork(work: Work): ProfileDraft {
  return {
    targetReader: work.targetReader,
    chapterWordCount: String(work.chapterWordCount),
    updateCadence: work.updateCadence,
    styleSamples: work.styleSamples,
    taboos: work.taboos,
    synopsis: work.synopsis,
    tags: work.tags.join('，'),
  };
}

function splitTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function profileError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WORK_COVER_INVALID') {
      return '封面只支持 PNG、JPEG 或 WebP，且文件不能超过 10 MB。';
    }
    if (error.code === 'WORK_COVER_NOT_FOUND') {
      return '这部作品还没有封面。';
    }
    if (error.code === 'VALIDATION_ERROR') {
      return '请检查作品资料，章节字数需要在 500 到 20000 字之间。';
    }
  }
  return friendlyError(error);
}

export function WorkProfilePanel({
  work,
  onWorkChange,
}: {
  work: Work;
  onWorkChange: (work: Work) => void;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromWork(work));
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [coverState, setCoverState] = useState<SaveState>({ status: 'idle' });

  useEffect(() => {
    setDraft(draftFromWork(work));
  }, [work]);

  function update<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tags = splitTags(draft.tags);
    if (tags.length > 20) {
      setSaveState({ status: 'error', message: '标签最多保留 20 个。' });
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      const updated = await apiRequest<Work>(`/api/v1/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          targetReader: draft.targetReader,
          chapterWordCount: Number(draft.chapterWordCount),
          updateCadence: draft.updateCadence,
          styleSamples: draft.styleSamples,
          taboos: draft.taboos,
          synopsis: draft.synopsis,
          tags,
          changeReason: '更新作品资料',
        }),
      });
      onWorkChange(updated);
      setDraft(draftFromWork(updated));
      setSaveState({ status: 'saved', message: '作品资料已保存' });
    } catch (error) {
      setSaveState({ status: 'error', message: profileError(error) });
    }
  }

  async function changeCover(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCoverState({ status: 'error', message: '封面文件不能超过 10 MB。' });
      return;
    }
    setCoverState({ status: 'saving' });
    try {
      const updated = await uploadWorkCover(work.id, file);
      onWorkChange(updated);
      setCoverState({ status: 'saved', message: '封面已更新' });
    } catch (error) {
      setCoverState({ status: 'error', message: profileError(error) });
    }
  }

  async function clearCover() {
    setCoverState({ status: 'saving' });
    try {
      await removeWorkCover(work.id);
      onWorkChange({
        ...work,
        coverUrl: null,
        coverMimeType: null,
        coverWidth: null,
        coverHeight: null,
        coverSize: null,
        coverUpdatedAt: null,
      });
      setCoverState({ status: 'saved', message: '封面已移除' });
    } catch (error) {
      setCoverState({ status: 'error', message: profileError(error) });
    }
  }

  const disabled = work.readOnly;

  return (
    <section className="work-profile-board" aria-labelledby="work-profile-title">
      <div className="work-profile-heading">
        <div>
          <p className="workspace-step">读者与写作约定</p>
          <h2 id="work-profile-title">作品资料</h2>
          <p>把目标读者、更新节奏和不能碰的边界写清楚，后续章节生成会沿用这些约定。</p>
        </div>
        {disabled ? <span className="work-profile-readonly">已完本只读</span> : null}
      </div>

      <div className="work-profile-layout">
        <form className="work-profile-form" onSubmit={saveProfile}>
          <div className="work-profile-grid">
            <label className="field">
              <span>目标读者</span>
              <input
                disabled={disabled}
                maxLength={200}
                onChange={(event) => update('targetReader', event.currentTarget.value)}
                placeholder="例如：喜欢长线伏笔和升级感的男频读者"
                value={draft.targetReader}
              />
            </label>
            <label className="field">
              <span>章节字数</span>
              <input
                disabled={disabled}
                max={20_000}
                min={500}
                onChange={(event) => update('chapterWordCount', event.currentTarget.value)}
                step={100}
                type="number"
                value={draft.chapterWordCount}
              />
            </label>
            <label className="field">
              <span>更新节奏</span>
              <select
                disabled={disabled}
                onChange={(event) => update('updateCadence', event.currentTarget.value)}
                value={draft.updateCadence}
              >
                {Array.from(
                  new Set([...UPDATE_CADENCE_OPTIONS, draft.updateCadence].filter(Boolean)),
                ).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>作品标签</span>
              <input
                disabled={disabled}
                onChange={(event) => update('tags', event.currentTarget.value)}
                placeholder="用逗号分隔，例如：升级流，长线伏笔，群像"
                value={draft.tags}
              />
            </label>
          </div>

          <label className="field">
            <span>简介</span>
            <textarea
              disabled={disabled}
              maxLength={4_000}
              onChange={(event) => update('synopsis', event.currentTarget.value)}
              placeholder="写给读者看的作品简介，不剧透结局"
              rows={4}
              value={draft.synopsis}
            />
          </label>
          <label className="field">
            <span>风格样本</span>
            <textarea
              disabled={disabled}
              maxLength={20_000}
              onChange={(event) => update('styleSamples', event.currentTarget.value)}
              placeholder="贴一段最能代表这本书语感的文字"
              rows={5}
              value={draft.styleSamples}
            />
          </label>
          <label className="field">
            <span>禁忌</span>
            <textarea
              disabled={disabled}
              maxLength={2_000}
              onChange={(event) => update('taboos', event.currentTarget.value)}
              placeholder="例如：不写无代价复活，不写误会拖章"
              rows={3}
              value={draft.taboos}
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

          <button
            className="primary-button"
            disabled={disabled || saveState.status === 'saving'}
            type="submit"
          >
            {saveState.status === 'saving' ? '正在保存…' : '保存作品资料'}
          </button>
        </form>

        <aside className="work-cover-editor" aria-labelledby="work-cover-title">
          <div>
            <p className="workspace-step">封面</p>
            <h3 id="work-cover-title">作品封面</h3>
          </div>
          <div className="work-cover-frame">
            {work.coverUrl ? (
              <img alt={`《${work.title}》封面`} src={work.coverUrl} />
            ) : (
              <span>还没有上传封面</span>
            )}
          </div>
          <label className="field">
            <span>封面图片</span>
            <input
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled || coverState.status === 'saving'}
              onChange={(event) => void changeCover(event.currentTarget.files?.[0])}
              type="file"
            />
          </label>
          <p className="field-hint">支持 PNG、JPEG、WebP，最大 10 MB。</p>
          {work.coverUrl ? (
            <button
              className="text-button danger-text"
              disabled={disabled || coverState.status === 'saving'}
              onClick={() => void clearCover()}
              type="button"
            >
              移除封面
            </button>
          ) : null}
          {coverState.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {coverState.message}
            </p>
          ) : null}
          {coverState.status === 'saved' ? (
            <p className="form-message form-message-success" role="status">
              {coverState.message}
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
