'use client';

import { useEffect, useState } from 'react';
import { friendlyError } from '../../../../lib/auth-api';
import {
  updateOutlineNode,
  type OutlineNode,
} from '../../../../lib/story-planning-api';

type GoldenDraft = {
  chapterGoal: string;
  pov: string;
  sceneBeats: string;
  chapterEndHook: string;
};

function draftFromNode(node: OutlineNode): GoldenDraft {
  return {
    chapterGoal: node.chapterGoal,
    pov: node.pov,
    sceneBeats: node.sceneBeats.join('\n'),
    chapterEndHook: node.chapterEndHook,
  };
}

export function GoldenThreePanel({
  workId,
  branchId,
  nodes,
}: {
  workId: string;
  branchId: string;
  nodes: OutlineNode[];
}) {
  const chapters = nodes
    .filter((node) => node.level === 'chapter')
    .sort((left, right) => (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0))
    .slice(0, 3);
  const [drafts, setDrafts] = useState<Record<string, GoldenDraft>>(() =>
    Object.fromEntries(chapters.map((chapter) => [chapter.id, draftFromNode(chapter)])),
  );
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setDrafts(
      Object.fromEntries(chapters.map((chapter) => [chapter.id, draftFromNode(chapter)])),
    );
  }, [nodes]);

  function updateDraft(chapterId: string, key: keyof GoldenDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [chapterId]: {
        ...(current[chapterId] ?? { chapterGoal: '', pov: '', sceneBeats: '', chapterEndHook: '' }),
        [key]: value,
      },
    }));
  }

  async function saveChapter(chapter: OutlineNode) {
    const draft = drafts[chapter.id];
    if (!draft) {
      return;
    }
    setBusyId(chapter.id);
    setNotice('');
    setError('');
    try {
      await updateOutlineNode(workId, branchId, chapter.id, {
        chapterGoal: draft.chapterGoal.trim(),
        pov: draft.pov.trim(),
        sceneBeats: draft.sceneBeats
          .split(/\r?\n/)
          .map((beat) => beat.trim())
          .filter(Boolean),
        chapterEndHook: draft.chapterEndHook.trim(),
        ...(chapter.locked
          ? { confirmLockedChange: true, changeReason: '更新黄金三章开篇策略' }
          : {}),
      });
      setNotice(`第 ${chapter.chapterNumber ?? 1} 章黄金三章策略已保存`);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="golden-three-panel" aria-labelledby="golden-three-title">
      <div className="works-section-heading">
        <div>
          <p className="workspace-step">开篇策略</p>
          <h2 id="golden-three-title">黄金三章开篇策略</h2>
        </div>
        <span>{chapters.length} / 3 章</span>
      </div>
      <p className="golden-three-intro">
        前三章决定读者是否留下：第一钩子、主角出场、世界规则、第一个爽点和三章章末钩子要一起设计。
      </p>

      {chapters.length === 0 ? (
        <p className="dashboard-empty">还没有前三章。先在结构树里建立至少一个章节点。</p>
      ) : (
        <div className="golden-three-grid">
          {chapters.map((chapter, index) => {
            const draft = drafts[chapter.id] ?? draftFromNode(chapter);
            return (
              <article className="golden-three-card" key={chapter.id}>
                <div className="golden-three-heading">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>
                      第 {chapter.chapterNumber ?? index + 1} 章 · {chapter.title}
                    </strong>
                    <small>{chapter.locked ? '已锁定，保存会记录修改原因' : '可编辑'}</small>
                  </div>
                </div>
                <label className="field">
                  <span>章目标</span>
                  <textarea
                    aria-label={`第 ${index + 1} 章章目标`}
                    onChange={(event) =>
                      updateDraft(chapter.id, 'chapterGoal', event.target.value)
                    }
                    rows={2}
                    value={draft.chapterGoal}
                  />
                </label>
                <label className="field">
                  <span>叙事视角</span>
                  <input
                    aria-label={`第 ${index + 1} 章视角`}
                    onChange={(event) => updateDraft(chapter.id, 'pov', event.target.value)}
                    value={draft.pov}
                  />
                </label>
                <label className="field">
                  <span>场景节拍</span>
                  <textarea
                    aria-label={`第 ${index + 1} 章场景节拍`}
                    onChange={(event) =>
                      updateDraft(chapter.id, 'sceneBeats', event.target.value)
                    }
                    rows={3}
                    value={draft.sceneBeats}
                  />
                </label>
                <label className="field">
                  <span>章末钩子</span>
                  <textarea
                    aria-label={`第 ${index + 1} 章章末钩子`}
                    onChange={(event) =>
                      updateDraft(chapter.id, 'chapterEndHook', event.target.value)
                    }
                    rows={2}
                    value={draft.chapterEndHook}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={busyId === chapter.id}
                  onClick={() => void saveChapter(chapter)}
                  type="button"
                >
                  {busyId === chapter.id ? '正在保存…' : `保存第 ${index + 1} 章`}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {notice ? (
        <p className="form-message form-message-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-message form-message-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
