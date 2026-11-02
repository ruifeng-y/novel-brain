'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, friendlyError } from '../../../lib/auth-api';
import {
  loadStoryBibleInsights,
  lockStoryBible,
  saveStoryBible,
  type StoryBible,
  type StoryBibleCard,
  type StoryBibleInsights,
} from '../../../lib/story-planning-api';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type CardDraft = Pick<StoryBibleCard, 'key' | 'title' | 'summary' | 'details'>;

function cardDrafts(cards: StoryBibleCard[]): CardDraft[] {
  return cards.map(({ key, title, summary, details }) => ({
    key,
    title,
    summary,
    details,
  }));
}

function cardsMatch(left: CardDraft[], right: StoryBibleCard[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightByKey = new Map(right.map((card) => [card.key, card]));
  return left.every((card) => {
    const saved = rightByKey.get(card.key);
    return saved?.summary === card.summary && saved.details === card.details;
  });
}

function changedCardTitles(cards: CardDraft[], saved: StoryBibleCard[]): string[] {
  const savedByKey = new Map(saved.map((card) => [card.key, card]));
  return cards
    .filter((card) => {
      const previous = savedByKey.get(card.key);
      return previous?.summary !== card.summary || previous.details !== card.details;
    })
    .map((card) => card.title);
}

function insightDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function chapterLabel(chapterNumber: number | null): string {
  return chapterNumber === null ? '未定' : `第 ${chapterNumber} 章`;
}

export function StoryPlanningPanel({
  workId,
  branchId,
  storyBible,
  initialInsights,
}: {
  workId: string;
  branchId: string;
  storyBible: StoryBible;
  initialInsights: StoryBibleInsights;
}) {
  const [bible, setBible] = useState(storyBible);
  const [cards, setCards] = useState<CardDraft[]>(() => cardDrafts(storyBible.cards));
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => new Set());
  const [insights, setInsights] = useState(initialInsights);
  const [bibleSave, setBibleSave] = useState<SaveState>({ status: 'idle' });
  const [lockSave, setLockSave] = useState<SaveState>({ status: 'idle' });
  const [pendingLockedSave, setPendingLockedSave] = useState<string[] | null>(null);
  const [changeReason, setChangeReason] = useState('');

  const filledCards = cards.filter((card) => card.summary.trim()).length;
  const complete = cards.length > 0 && filledCards === cards.length;

  function applySavedBible(saved: StoryBible, message: string) {
    setBible(saved);
    setCards(cardDrafts(saved.cards));
    setPendingLockedSave(null);
    setChangeReason('');
    setBibleSave({ status: 'saved', message });
  }

  async function refreshInsights() {
    try {
      setInsights(await loadStoryBibleInsights(workId, branchId));
    } catch {
      // The saved bible remains usable even if the reminder rail needs another refresh.
    }
  }

  async function persistStoryBible(confirmLockedChange = false) {
    if (!confirmLockedChange && cardsMatch(cards, bible.cards)) {
      setBibleSave({ status: 'saved', message: '没有需要保存的修改' });
      return;
    }

    setBibleSave({ status: 'saving' });
    try {
      const saved = await saveStoryBible(workId, branchId, {
        cards: cards.map(({ key, summary, details }) => ({ key, summary, details })),
        ...(confirmLockedChange
          ? {
              confirmLockedChange: true,
              changeReason: changeReason.trim(),
            }
          : {}),
      });
      applySavedBible(saved, confirmLockedChange ? '故事圣经修改已确认并记录' : '故事圣经已保存');
      await refreshInsights();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STORY_BIBLE_LOCKED') {
        setPendingLockedSave(changedCardTitles(cards, bible.cards));
        setBibleSave({ status: 'idle' });
        return;
      }
      setBibleSave({ status: 'error', message: friendlyError(error) });
    }
  }

  async function onSaveStoryBible(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistStoryBible(false);
  }

  async function onConfirmLockedSave() {
    if (!changeReason.trim()) {
      return;
    }
    await persistStoryBible(true);
  }

  async function onLockStoryBible() {
    setLockSave({ status: 'saving' });
    try {
      const saved = await lockStoryBible(workId, branchId);
      setBible(saved);
      setCards(cardDrafts(saved.cards));
      setLockSave({ status: 'saved', message: '故事圣经已锁定' });
      setBibleSave({ status: 'idle' });
      await refreshInsights();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STORY_BIBLE_INCOMPLETE') {
        setLockSave({
          status: 'error',
          message: '还有卡片没有填写一句话摘要，补全后才能锁定。',
        });
        return;
      }
      setLockSave({ status: 'error', message: friendlyError(error) });
    }
  }

  function updateCard(key: string, field: 'summary' | 'details', value: string) {
    setCards((current) =>
      current.map((card) => (card.key === key ? { ...card, [field]: value } : card)),
    );
  }

  function toggleCard(key: string) {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <>
      <div className="story-bible-layout">
        <section className="story-bible-main" aria-labelledby="story-bible-title">
          <div className="story-bible-heading">
            <div>
              <p className="workspace-step">一页纸创作纲领</p>
              <h2 id="story-bible-title">故事圣经</h2>
              <p>先把这本书不可动摇的核心写清，再逐张卡片补足可直接用于写作的细节。</p>
            </div>
            <div className="story-bible-status" aria-label="故事圣经完成状态">
              <span className={bible.locked ? 'bible-lock-state locked' : 'bible-lock-state'}>
                {bible.locked ? '已锁定' : '编辑中'}
              </span>
              <strong>
                {filledCards}/{cards.length}
              </strong>
              <p>张卡片已填写摘要</p>
            </div>
          </div>

          {bible.locked ? (
            <div className="locked-bible-notice">
              <strong>这本故事圣经已经锁定</strong>
              <p>后续修改需要明确确认并填写原因，保存后会进入最近修改记录。</p>
            </div>
          ) : null}

          <form className="auth-form story-bible-form" onSubmit={onSaveStoryBible}>
            <div className="story-bible-card-grid">
              {cards.map((card, index) => {
                const expanded = expandedCards.has(card.key);
                return (
                  <article
                    className={`story-bible-card${card.summary.trim() ? ' filled' : ''}`}
                    key={card.key}
                  >
                    <div className="story-bible-card-heading">
                      <div>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <h3>{card.title}</h3>
                      </div>
                      <span className="story-bible-card-state">
                        {card.summary.trim() ? '已填写' : '待补'}
                      </span>
                    </div>
                    <label className="field story-bible-summary">
                      <span>一句话摘要</span>
                      <textarea
                        aria-label={card.title}
                        maxLength={2_000}
                        onChange={(event) =>
                          updateCard(card.key, 'summary', event.currentTarget.value)
                        }
                        placeholder={`写下${card.title}的核心判断`}
                        rows={4}
                        value={card.summary}
                      />
                    </label>
                    <button
                      aria-controls={`story-bible-details-${card.key}`}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? '收起' : '展开'}第 ${index + 1} 张卡片详细设定`}
                      className="text-button story-bible-toggle"
                      onClick={() => toggleCard(card.key)}
                      type="button"
                    >
                      {expanded ? '收起详细设定' : '展开详细设定'}
                    </button>
                    {expanded ? (
                      <label
                        className="field story-bible-detail"
                        id={`story-bible-details-${card.key}`}
                      >
                        <span>详细设定</span>
                        <textarea
                          aria-label={`${card.title}详细设定`}
                          maxLength={12_000}
                          onChange={(event) =>
                            updateCard(card.key, 'details', event.currentTarget.value)
                          }
                          placeholder="写清规则、限制、代价、例子和不能违背的边界"
                          rows={6}
                          value={card.details}
                        />
                      </label>
                    ) : null}
                  </article>
                );
              })}
            </div>

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

            {pendingLockedSave ? (
              <div className="locked-change-confirm" role="alertdialog" aria-modal="false">
                <p className="workspace-step">需要确认</p>
                <h3>这次保存会修改已锁定的故事圣经</h3>
                <p>
                  将修改：
                  {pendingLockedSave.length > 0 ? pendingLockedSave.join('、') : '故事圣经内容'}
                </p>
                <label className="field">
                  <span>修改原因</span>
                  <textarea
                    aria-label="修改原因"
                    maxLength={500}
                    onChange={(event) => setChangeReason(event.currentTarget.value)}
                    placeholder="说明为什么必须修改，以及是否已处理对后文的影响"
                    rows={3}
                    value={changeReason}
                  />
                </label>
                <div className="locked-change-actions">
                  <button
                    className="primary-button"
                    disabled={!changeReason.trim() || bibleSave.status === 'saving'}
                    onClick={() => void onConfirmLockedSave()}
                    type="button"
                  >
                    {bibleSave.status === 'saving' ? '正在确认…' : '确认并保存修改'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPendingLockedSave(null);
                      setChangeReason('');
                    }}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            <div className="planning-actions story-bible-actions">
              <button
                className="primary-button"
                disabled={bibleSave.status === 'saving' || pendingLockedSave !== null}
                type="submit"
              >
                {bibleSave.status === 'saving' ? '正在保存…' : '保存故事圣经'}
              </button>
              {!bible.locked ? (
                <button
                  className="secondary-button"
                  disabled={!complete || lockSave.status === 'saving'}
                  onClick={() => void onLockStoryBible()}
                  type="button"
                >
                  {lockSave.status === 'saving' ? '正在锁定…' : '锁定故事圣经'}
                </button>
              ) : null}
              <p>
                {complete
                  ? '九张卡片都已填写，可以锁定。'
                  : `还差 ${cards.length - filledCards} 张卡片即可锁定。`}
              </p>
            </div>
            {lockSave.status === 'error' ? (
              <p className="form-message form-message-error" role="alert">
                {lockSave.message}
              </p>
            ) : null}
            {lockSave.status === 'saved' ? (
              <p className="form-message form-message-success" role="status">
                {lockSave.message}
              </p>
            ) : null}
          </form>
        </section>

        <aside className="story-bible-rail" aria-labelledby="story-bible-rail-title">
          <div className="story-bible-rail-heading">
            <p className="workspace-step">写作时先看这里</p>
            <h2 id="story-bible-rail-title">提醒与变化</h2>
            <p>每次保存后刷新，只显示当前这部作品、这条创作线里的内容。</p>
          </div>

          <section className="bible-rail-section" aria-labelledby="continuity-reminder-title">
            <div className="bible-rail-section-heading">
              <h3 id="continuity-reminder-title">连续性提醒</h3>
              <span>{insights.continuityReminders.length}</span>
            </div>
            {insights.continuityReminders.length === 0 ? (
              <p className="bible-rail-empty">暂时没有待处理的连续性提醒。</p>
            ) : (
              <ul className="bible-rail-list">
                {insights.continuityReminders.map((reminder) => (
                  <li key={reminder.id}>
                    <div className="bible-rail-item-meta">
                      <span>
                        第 {reminder.chapterNumber} 章 · {reminder.categoryLabel}
                      </span>
                      <strong>{reminder.severityLabel}</strong>
                    </div>
                    <p>{reminder.message}</p>
                    <small>{reminder.suggestion}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bible-rail-section" aria-labelledby="unresolved-foreshadow-title">
            <div className="bible-rail-section-heading">
              <h3 id="unresolved-foreshadow-title">未回收伏笔</h3>
              <span>{insights.unresolvedForeshadows.length}</span>
            </div>
            {insights.unresolvedForeshadows.length === 0 ? (
              <p className="bible-rail-empty">暂时没有未回收伏笔。</p>
            ) : (
              <ul className="bible-rail-list">
                {insights.unresolvedForeshadows.map((foreshadow) => (
                  <li key={foreshadow.id}>
                    <div className="bible-rail-item-meta">
                      <strong>{foreshadow.title}</strong>
                      <span>{foreshadow.importanceLabel}</span>
                    </div>
                    <p>{foreshadow.description}</p>
                    <small>
                      埋设：{chapterLabel(foreshadow.setupChapter)} · 计划回收：
                      {chapterLabel(foreshadow.plannedPayoffChapter)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bible-rail-section" aria-labelledby="recent-bible-changes-title">
            <div className="bible-rail-section-heading">
              <h3 id="recent-bible-changes-title">最近修改</h3>
              <span>{insights.recentChanges.length}</span>
            </div>
            {insights.recentChanges.length === 0 ? (
              <p className="bible-rail-empty">保存或锁定故事圣经后，这里会留下记录。</p>
            ) : (
              <ul className="bible-rail-list">
                {insights.recentChanges.map((change) => (
                  <li key={change.id}>
                    <div className="bible-rail-item-meta">
                      <strong>{change.actionLabel}</strong>
                      <time dateTime={change.createdAt}>{insightDate(change.createdAt)}</time>
                    </div>
                    <p>{change.reason}</p>
                    <small>
                      {change.authorName}
                      {change.changedCardTitles.length > 0
                        ? ` · ${change.changedCardTitles.join('、')}`
                        : ''}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
