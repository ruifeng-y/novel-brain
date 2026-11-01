'use client';

import { useState } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import {
  saveChapterOutline,
  saveStoryBible,
  type ChapterOutline,
  type StoryBible,
} from '../../../lib/story-planning-api';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

export function StoryPlanningPanel({
  workId,
  branchId,
  storyBible,
  chapterOutline,
}: {
  workId: string;
  branchId: string;
  storyBible: StoryBible;
  chapterOutline: ChapterOutline;
}) {
  const [bibleSave, setBibleSave] = useState<SaveState>({ status: 'idle' });
  const [outlineSave, setOutlineSave] = useState<SaveState>({ status: 'idle' });

  async function onSaveStoryBible(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBibleSave({ status: 'saving' });

    try {
      await saveStoryBible(workId, branchId, {
        oneSentenceStory: String(form.get('oneSentenceStory') ?? ''),
        protagonist: String(form.get('protagonist') ?? ''),
        worldIronLaw: String(form.get('worldIronLaw') ?? ''),
      });
      setBibleSave({ status: 'saved', message: '故事圣经已保存' });
    } catch (error) {
      setBibleSave({ status: 'error', message: friendlyError(error) });
    }
  }

  async function onSaveChapterOutline(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sceneBeats = String(form.get('sceneBeats') ?? '')
      .split(/\r?\n/)
      .map((beat) => beat.trim())
      .filter(Boolean);
    setOutlineSave({ status: 'saving' });

    try {
      await saveChapterOutline(workId, branchId, 1, {
        chapterGoal: String(form.get('chapterGoal') ?? ''),
        pov: String(form.get('pov') ?? ''),
        sceneBeats,
        chapterEndHook: String(form.get('chapterEndHook') ?? ''),
      });
      setOutlineSave({ status: 'saved', message: '章纲已保存' });
    } catch (error) {
      setOutlineSave({ status: 'error', message: friendlyError(error) });
    }
  }

  return (
    <div className="planning-columns">
      <section className="planning-section" aria-labelledby="story-bible-title">
        <div className="planning-section-heading">
          <p className="workspace-step">一页纸创作纲领</p>
          <h2 id="story-bible-title">故事圣经</h2>
          <p>先写清这本书不可动摇的核心，后面每一章都从这里出发。</p>
        </div>

        <form className="auth-form planning-form" onSubmit={onSaveStoryBible}>
          <label className="field">
            <span>一句话故事</span>
            <textarea
              defaultValue={storyBible.oneSentenceStory}
              maxLength={500}
              name="oneSentenceStory"
              placeholder="用一句话说清谁、想要什么、要付出什么代价"
              required
              rows={3}
            />
          </label>
          <label className="field">
            <span>主角</span>
            <input
              defaultValue={storyBible.protagonist}
              maxLength={200}
              name="protagonist"
              placeholder="例如：沈砚，外冷内热的边城剑客"
              required
            />
          </label>
          <label className="field">
            <span>世界铁律</span>
            <textarea
              defaultValue={storyBible.worldIronLaw}
              maxLength={500}
              name="worldIronLaw"
              placeholder="这个世界绝不能打破的一条规则"
              required
              rows={3}
            />
          </label>

          {bibleSave.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {bibleSave.message}
            </p>
          ) : null}
          {bibleSave.status === 'saved' ? (
            <p className="form-message form-message-success" role="status">
              {bibleSave.message}
            </p>
          ) : null}

          <div className="planning-actions">
            <button
              className="primary-button"
              disabled={bibleSave.status === 'saving'}
              type="submit"
            >
              {bibleSave.status === 'saving' ? '正在保存…' : '保存故事圣经'}
            </button>
          </div>
        </form>
      </section>

      <section className="planning-section" aria-labelledby="chapter-outline-title">
        <div className="planning-section-heading">
          <p className="workspace-step">第一章准备</p>
          <h2 id="chapter-outline-title">章纲</h2>
          <p>把这一章要完成的事拆成清楚的场景节拍。</p>
        </div>

        <form className="auth-form planning-form" onSubmit={onSaveChapterOutline}>
          <label className="field">
            <span>章目标</span>
            <textarea
              defaultValue={chapterOutline.chapterGoal}
              maxLength={1_000}
              name="chapterGoal"
              placeholder="这一章结束时，故事必须向前推进到哪里"
              required
              rows={2}
            />
          </label>
          <label className="field">
            <span>叙事视角</span>
            <input
              defaultValue={chapterOutline.pov}
              maxLength={120}
              name="pov"
              placeholder="这一章由谁的眼睛来看"
              required
            />
          </label>
          <label className="field">
            <span>场景节拍</span>
            <textarea
              defaultValue={chapterOutline.sceneBeats.join('\n')}
              name="sceneBeats"
              placeholder={'一行一个节拍，例如：\n沈砚逃入荒寺避雨\n断碑浮现旧日剑痕'}
              required
              rows={5}
            />
          </label>
          <label className="field">
            <span>章末钩子</span>
            <textarea
              defaultValue={chapterOutline.chapterEndHook}
              maxLength={500}
              name="chapterEndHook"
              placeholder="读者看到最后一句，为什么还想翻下一章"
              required
              rows={3}
            />
          </label>

          {outlineSave.status === 'error' ? (
            <p className="form-message form-message-error" role="alert">
              {outlineSave.message}
            </p>
          ) : null}
          {outlineSave.status === 'saved' ? (
            <p className="form-message form-message-success" role="status">
              {outlineSave.message}
            </p>
          ) : null}

          <div className="planning-actions">
            <button
              className="primary-button"
              disabled={outlineSave.status === 'saving'}
              type="submit"
            >
              {outlineSave.status === 'saving' ? '正在保存…' : '保存章纲'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
