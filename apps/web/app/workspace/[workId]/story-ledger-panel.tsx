'use client';

import { useState, type FormEvent } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import {
  createForeshadow,
  createStoryThread,
  deleteStoryThread,
  loadStoryLedger,
  saveCharacterArc,
  updateForeshadow,
  updateStoryThread,
  type CharacterArc,
  type CharacterArcInput,
  type Foreshadow,
  type ForeshadowInput,
  type StoryArcStatus,
  type StoryForeshadowImportance,
  type StoryForeshadowStatus,
  type StoryLedger,
  type StoryThread,
  type StoryThreadInput,
  type StoryThreadMilestone,
  type StoryThreadStatus,
  type StoryThreadTensionPoint,
  type StoryThreadType,
} from '../../../lib/story-ledger-api';

type LedgerTab = 'threads' | 'foreshadows' | 'arcs';

type Notice =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

type ThreadDraft = {
  name: string;
  type: StoryThreadType;
  summary: string;
  stakes: string;
  participantIds: string[];
  plannedPayoffChapter: string;
  status: StoryThreadStatus;
  milestones: string;
  tensionCurve: string;
};

type ForeshadowDraft = {
  title: string;
  description: string;
  plantChapter: string;
  plannedPayoffChapter: string;
  importance: StoryForeshadowImportance;
  status: StoryForeshadowStatus;
};

type ArcDraft = {
  characterId: string;
  startState: string;
  desire: string;
  fear: string;
  lie: string;
  truth: string;
  turn: string;
  endState: string;
  status: StoryArcStatus;
};

const THREAD_TYPES: Array<{ value: StoryThreadType; label: string }> = [
  { value: 'main', label: '主线' },
  { value: 'sub', label: '支线' },
  { value: 'character', label: '人物线' },
  { value: 'faction', label: '势力线' },
  { value: 'mystery', label: '悬疑线' },
  { value: 'romance', label: '感情线' },
];

const THREAD_STATUSES: Array<{ value: StoryThreadStatus; label: string }> = [
  { value: 'active', label: '推进中' },
  { value: 'resolved', label: '已收束' },
  { value: 'abandoned', label: '已搁置' },
];

const FORESHADOW_IMPORTANCE: Array<{ value: StoryForeshadowImportance; label: string }> = [
  { value: 'must', label: '必须回收' },
  { value: 'optional', label: '可选回收' },
];

const FORESHADOW_STATUSES: Array<{ value: StoryForeshadowStatus; label: string }> = [
  { value: 'planted', label: '已埋设' },
  { value: 'paid_off', label: '已回收' },
  { value: 'abandoned', label: '已放弃' },
];

const ARC_STATUSES: Array<{ value: StoryArcStatus; label: string }> = [
  { value: 'active', label: '成长中' },
  { value: 'completed', label: '已完成' },
  { value: 'abandoned', label: '已放弃' },
];

function chapterLabel(value: number | null): string {
  return value === null ? '未定' : `第 ${value} 章`;
}

function blankThread(): ThreadDraft {
  return {
    name: '',
    type: 'main',
    summary: '',
    stakes: '',
    participantIds: [],
    plannedPayoffChapter: '',
    status: 'active',
    milestones: '',
    tensionCurve: '',
  };
}

function threadDraft(thread: StoryThread): ThreadDraft {
  return {
    name: thread.name,
    type: thread.type,
    summary: thread.summary,
    stakes: thread.stakes,
    participantIds: thread.participantIds,
    plannedPayoffChapter:
      thread.plannedPayoffChapter === null ? '' : String(thread.plannedPayoffChapter),
    status: thread.status,
    milestones: thread.milestones
      .map((milestone) => `第 ${milestone.chapterNumber} 章｜${milestone.description}`)
      .join('\n'),
    tensionCurve: thread.tensionCurve
      .map((point) => `第 ${point.chapterNumber} 章｜${point.tension}`)
      .join('\n'),
  };
}

function blankForeshadow(): ForeshadowDraft {
  return {
    title: '',
    description: '',
    plantChapter: '',
    plannedPayoffChapter: '',
    importance: 'must',
    status: 'planted',
  };
}

function foreshadowDraft(foreshadow: Foreshadow): ForeshadowDraft {
  return {
    title: foreshadow.title,
    description: foreshadow.description,
    plantChapter: foreshadow.plantChapter === null ? '' : String(foreshadow.plantChapter),
    plannedPayoffChapter:
      foreshadow.plannedPayoffChapter === null ? '' : String(foreshadow.plannedPayoffChapter),
    importance: foreshadow.importance,
    status: foreshadow.status,
  };
}

function blankArc(characterId = ''): ArcDraft {
  return {
    characterId,
    startState: '',
    desire: '',
    fear: '',
    lie: '',
    truth: '',
    turn: '',
    endState: '',
    status: 'active',
  };
}

function arcDraft(arc: CharacterArc): ArcDraft {
  return {
    characterId: arc.characterId,
    startState: arc.startState,
    desire: arc.desire,
    fear: arc.fear,
    lie: arc.lie,
    truth: arc.truth,
    turn: arc.turn,
    endState: arc.endState,
    status: arc.status,
  };
}

function parseChapter(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const number = Number(trimmed);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseMilestones(value: string): StoryThreadMilestone[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [chapterPart, ...descriptionParts] = line.split(/[｜|]/);
      const chapterNumber = Number(chapterPart?.match(/\d+/)?.[0]);
      return {
        chapterNumber,
        description: descriptionParts.join('｜').trim(),
      };
    })
    .filter(
      (milestone) =>
        Number.isInteger(milestone.chapterNumber) &&
        milestone.chapterNumber > 0 &&
        milestone.description.length > 0,
    );
}

function parseTensionCurve(value: string): StoryThreadTensionPoint[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const numbers = line.match(/\d+/g)?.map(Number) ?? [];
      return {
        chapterNumber: numbers[0] ?? 0,
        tension: numbers.at(-1) ?? 0,
      };
    })
    .filter(
      (point) =>
        Number.isInteger(point.chapterNumber) &&
        point.chapterNumber > 0 &&
        Number.isInteger(point.tension) &&
        point.tension >= 1 &&
        point.tension <= 10,
    );
}

function TensionCurve({ points }: { points: StoryThreadTensionPoint[] }) {
  if (points.length === 0) {
    return <p className="ledger-muted">还没有记录张力变化。</p>;
  }

  const chartWidth = 280;
  const chartHeight = 78;
  const padding = 9;
  const minChapter = Math.min(...points.map((point) => point.chapterNumber));
  const maxChapter = Math.max(...points.map((point) => point.chapterNumber));
  const span = Math.max(1, maxChapter - minChapter);
  const coordinates = points.map((point) => ({
    x: padding + ((point.chapterNumber - minChapter) / span) * (chartWidth - padding * 2),
    y: chartHeight - padding - ((point.tension - 1) / 9) * (chartHeight - padding * 2),
  }));

  return (
    <div className="ledger-tension">
      <svg
        aria-label="张力曲线"
        className="ledger-tension-chart"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <line
          className="ledger-tension-axis"
          x1={padding}
          x2={chartWidth - padding}
          y1={chartHeight - padding}
          y2={chartHeight - padding}
        />
        {coordinates.length > 1 ? (
          <polyline
            className="ledger-tension-line"
            points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
          />
        ) : null}
        {coordinates.map((point, index) => (
          <circle
            className="ledger-tension-point"
            cx={point.x}
            cy={point.y}
            key={`${points[index].chapterNumber}-${points[index].tension}`}
            r={3.5}
          />
        ))}
      </svg>
      <div className="ledger-tension-labels">
        {points.map((point) => (
          <span key={`${point.chapterNumber}-${point.tension}`}>
            {point.chapterNumber} 章 · {point.tension}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StoryLedgerPanel({
  workId,
  branchId,
  initialLedger,
}: {
  workId: string;
  branchId: string;
  initialLedger: StoryLedger;
}) {
  const [ledger, setLedger] = useState(initialLedger);
  const [tab, setTab] = useState<LedgerTab>('threads');
  const [notice, setNotice] = useState<Notice>({ status: 'idle' });
  const [threadEditor, setThreadEditor] = useState<{ id?: string } | null>(null);
  const [threadForm, setThreadForm] = useState<ThreadDraft>(blankThread);
  const [foreshadowEditor, setForeshadowEditor] = useState<{ id?: string } | null>(null);
  const [foreshadowForm, setForeshadowForm] = useState<ForeshadowDraft>(blankForeshadow);
  const [arcEditor, setArcEditor] = useState<{ id?: string } | null>(null);
  const [arcForm, setArcForm] = useState<ArcDraft>(() =>
    blankArc(initialLedger.characters[0]?.id ?? ''),
  );

  function updateThreadForm<Key extends keyof ThreadDraft>(key: Key, value: ThreadDraft[Key]) {
    setThreadForm((current) => ({ ...current, [key]: value }));
  }

  function updateForeshadowForm<Key extends keyof ForeshadowDraft>(
    key: Key,
    value: ForeshadowDraft[Key],
  ) {
    setForeshadowForm((current) => ({ ...current, [key]: value }));
  }

  function updateArcForm<Key extends keyof ArcDraft>(key: Key, value: ArcDraft[Key]) {
    setArcForm((current) => ({ ...current, [key]: value }));
  }

  function setThreadParticipant(characterId: string, checked: boolean) {
    setThreadForm((current) => ({
      ...current,
      participantIds: checked
        ? [...current.participantIds, characterId]
        : current.participantIds.filter((id) => id !== characterId),
    }));
  }

  async function refresh(message: string) {
    setLedger(await loadStoryLedger(workId, branchId));
    setNotice({ status: 'saved', message });
  }

  async function saveThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice({ status: 'saving' });
    const input: StoryThreadInput = {
      name: threadForm.name.trim(),
      type: threadForm.type,
      summary: threadForm.summary.trim(),
      stakes: threadForm.stakes.trim(),
      participantIds: threadForm.participantIds,
      plannedPayoffChapter: parseChapter(threadForm.plannedPayoffChapter),
      status: threadForm.status,
      milestones: parseMilestones(threadForm.milestones),
      tensionCurve: parseTensionCurve(threadForm.tensionCurve),
    };
    try {
      if (threadEditor?.id) {
        await updateStoryThread(workId, branchId, threadEditor.id, input);
      } else {
        await createStoryThread(workId, branchId, input);
      }
      setThreadEditor(null);
      setThreadForm(blankThread());
      await refresh('剧情线已保存');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function saveForeshadow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice({ status: 'saving' });
    const input: ForeshadowInput = {
      title: foreshadowForm.title.trim(),
      description: foreshadowForm.description.trim(),
      plantChapter: parseChapter(foreshadowForm.plantChapter),
      plannedPayoffChapter: parseChapter(foreshadowForm.plannedPayoffChapter),
      importance: foreshadowForm.importance,
      status: foreshadowForm.status,
    };
    try {
      if (foreshadowEditor?.id) {
        await updateForeshadow(workId, branchId, foreshadowEditor.id, input);
      } else {
        await createForeshadow(workId, branchId, input);
      }
      setForeshadowEditor(null);
      setForeshadowForm(blankForeshadow());
      await refresh('伏笔已保存');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function payOffForeshadow(foreshadow: Foreshadow) {
    setNotice({ status: 'saving' });
    try {
      await updateForeshadow(workId, branchId, foreshadow.id, { status: 'paid_off' });
      await refresh('伏笔已回收');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function saveArc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice({ status: 'saving' });
    const input: CharacterArcInput = {
      characterId: arcForm.characterId,
      startState: arcForm.startState.trim(),
      desire: arcForm.desire.trim(),
      fear: arcForm.fear.trim(),
      lie: arcForm.lie.trim(),
      truth: arcForm.truth.trim(),
      turn: arcForm.turn.trim(),
      endState: arcForm.endState.trim(),
      status: arcForm.status,
    };
    try {
      await saveCharacterArc(workId, branchId, input);
      setArcEditor(null);
      setArcForm(blankArc(ledger.characters[0]?.id ?? ''));
      await refresh('人物弧已保存');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  async function removeThread(thread: StoryThread) {
    if (!window.confirm(`删除剧情线《${thread.name}》？`)) {
      return;
    }
    setNotice({ status: 'saving' });
    try {
      await deleteStoryThread(workId, branchId, thread.id);
      await refresh('剧情线已删除');
    } catch (error) {
      setNotice({ status: 'error', message: friendlyError(error) });
    }
  }

  return (
    <section
      aria-labelledby="story-ledger-title"
      className="planning-section story-ledger"
      id="story-ledger"
    >
      <div className="planning-section-heading ledger-heading">
        <div>
          <p className="workspace-step">把重要的线放在同一处</p>
          <h2 id="story-ledger-title">剧情线、伏笔与人物弧</h2>
          <p>记录每条线要向哪里走、欠下什么承诺，以及人物为什么会在关键时刻改变。</p>
        </div>
        <div className="ledger-progress">
          <strong>{ledger.threads.filter((thread) => thread.status === 'active').length}</strong>
          <span>条剧情线正在推进</span>
        </div>
      </div>

      <section aria-labelledby="story-ledger-health-title" className="ledger-health">
        <div className="ledger-health-heading">
          <div>
            <h3 id="story-ledger-health-title">剧情体检</h3>
            <p>
              {ledger.checks.writtenThroughChapter === null
                ? '还没有已写章节，先按计划整理线索。'
                : `目前写到第 ${ledger.checks.writtenThroughChapter} 章。`}
            </p>
          </div>
          <span>{ledger.checks.items.length === 0 ? '暂未发现问题' : '需要处理'}</span>
        </div>
        <div className="ledger-health-counts">
          <div>
            <strong>{ledger.checks.summary.overdueForeshadows}</strong>
            <span>过期伏笔</span>
          </div>
          <div>
            <strong>{ledger.checks.summary.unclosedThreads}</strong>
            <span>未收束剧情线</span>
          </div>
          <div>
            <strong>{ledger.checks.summary.motivationBreaks}</strong>
            <span>动机断点</span>
          </div>
        </div>
        {ledger.checks.items.length === 0 ? (
          <p className="ledger-empty">目前没有发现需要处理的结构问题。</p>
        ) : (
          <ul className="ledger-check-list">
            {ledger.checks.items.map((check) => (
              <li key={check.id}>
                <div>
                  <strong>{check.title}</strong>
                  <span>{check.kindLabel}</span>
                </div>
                <p>{check.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {notice.status === 'saved' ? (
        <p className="form-message form-message-success" role="status">
          {notice.message}
        </p>
      ) : null}
      {notice.status === 'error' ? (
        <p className="form-message form-message-error" role="alert">
          {notice.message}
        </p>
      ) : null}

      <div aria-label="账本分类" className="ledger-tabs" role="tablist">
        <button
          aria-selected={tab === 'threads'}
          className={tab === 'threads' ? 'ledger-tab active' : 'ledger-tab'}
          onClick={() => setTab('threads')}
          role="tab"
          type="button"
        >
          剧情线
        </button>
        <button
          aria-selected={tab === 'foreshadows'}
          className={tab === 'foreshadows' ? 'ledger-tab active' : 'ledger-tab'}
          onClick={() => setTab('foreshadows')}
          role="tab"
          type="button"
        >
          伏笔
        </button>
        <button
          aria-selected={tab === 'arcs'}
          className={tab === 'arcs' ? 'ledger-tab active' : 'ledger-tab'}
          onClick={() => setTab('arcs')}
          role="tab"
          type="button"
        >
          人物弧
        </button>
      </div>

      {tab === 'threads' ? (
        <section aria-labelledby="plot-lines-title" className="ledger-tab-panel" role="tabpanel">
          <div className="ledger-panel-heading">
            <div>
              <h3 id="plot-lines-title">剧情线</h3>
              <p>写清赌注和里程碑，并用张力曲线看这条线是否该起势。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setThreadEditor({});
                setThreadForm(blankThread());
                setNotice({ status: 'idle' });
              }}
              type="button"
            >
              新建剧情线
            </button>
          </div>

          {threadEditor ? (
            <form className="auth-form ledger-form" onSubmit={saveThread}>
              <div className="ledger-form-grid">
                <label className="field">
                  <span>剧情线名称</span>
                  <input
                    maxLength={200}
                    onChange={(event) => updateThreadForm('name', event.currentTarget.value)}
                    required
                    value={threadForm.name}
                  />
                </label>
                <label className="field">
                  <span>剧情类型</span>
                  <select
                    onChange={(event) =>
                      updateThreadForm('type', event.currentTarget.value as StoryThreadType)
                    }
                    value={threadForm.type}
                  >
                    {THREAD_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field ledger-form-wide">
                  <span>剧情线摘要</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateThreadForm('summary', event.currentTarget.value)}
                    rows={3}
                    value={threadForm.summary}
                  />
                </label>
                <label className="field ledger-form-wide">
                  <span>赌注</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateThreadForm('stakes', event.currentTarget.value)}
                    placeholder="如果这条线失败，人物会失去什么？"
                    required
                    rows={3}
                    value={threadForm.stakes}
                  />
                </label>
                <label className="field">
                  <span>计划收束章</span>
                  <input
                    inputMode="numeric"
                    min={1}
                    onChange={(event) =>
                      updateThreadForm('plannedPayoffChapter', event.currentTarget.value)
                    }
                    type="number"
                    value={threadForm.plannedPayoffChapter}
                  />
                </label>
                <label className="field">
                  <span>剧情线状态</span>
                  <select
                    onChange={(event) =>
                      updateThreadForm('status', event.currentTarget.value as StoryThreadStatus)
                    }
                    value={threadForm.status}
                  >
                    {THREAD_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field ledger-form-wide">
                  <span>里程碑</span>
                  <textarea
                    onChange={(event) => updateThreadForm('milestones', event.currentTarget.value)}
                    placeholder={
                      '一行一个里程碑，例如：\n第 3 章｜残剑认主\n第 12 章｜守碑人交出剑诀'
                    }
                    rows={4}
                    value={threadForm.milestones}
                  />
                </label>
                <label className="field ledger-form-wide">
                  <span>张力曲线</span>
                  <textarea
                    onChange={(event) =>
                      updateThreadForm('tensionCurve', event.currentTarget.value)
                    }
                    placeholder={
                      '一行一个节点，张力用 1 到 10 表示，例如：\n第 1 章｜3\n第 8 章｜7\n第 18 章｜10'
                    }
                    rows={4}
                    value={threadForm.tensionCurve}
                  />
                </label>
              </div>
              <fieldset className="ledger-participants">
                <legend>参与者</legend>
                {ledger.characters.length === 0 ? (
                  <p className="ledger-muted">先在设定中心建立人物，再把他们加入剧情线。</p>
                ) : (
                  <div className="ledger-participant-options">
                    {ledger.characters.map((character) => (
                      <label key={character.id}>
                        <input
                          checked={threadForm.participantIds.includes(character.id)}
                          onChange={(event) =>
                            setThreadParticipant(character.id, event.currentTarget.checked)
                          }
                          type="checkbox"
                        />
                        {character.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <div className="planning-actions">
                <button
                  className="primary-button"
                  disabled={notice.status === 'saving'}
                  type="submit"
                >
                  {notice.status === 'saving' ? '正在保存…' : '保存剧情线'}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setThreadEditor(null);
                    setThreadForm(blankThread());
                  }}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          ) : null}

          {ledger.threads.length === 0 ? (
            <div className="planning-empty">
              <h4>还没有剧情线</h4>
              <p>先记录主线，再补人物线、势力线、悬疑线和感情线。</p>
            </div>
          ) : (
            <div className="ledger-thread-grid">
              {ledger.threads.map((thread) => (
                <article className="ledger-thread-card" key={thread.id}>
                  <div className="ledger-card-heading">
                    <div>
                      <span>{thread.typeLabel}</span>
                      <h4>{thread.name}</h4>
                    </div>
                    <span className={`ledger-status ${thread.status}`}>{thread.statusLabel}</span>
                  </div>
                  {thread.summary ? <p>{thread.summary}</p> : null}
                  <dl className="ledger-card-facts">
                    <div>
                      <dt>赌注</dt>
                      <dd>{thread.stakes}</dd>
                    </div>
                    <div>
                      <dt>参与者</dt>
                      <dd>
                        {thread.participants.length > 0
                          ? thread.participants.map((participant) => participant.name).join('、')
                          : '尚未指定'}
                      </dd>
                    </div>
                    <div>
                      <dt>计划收束</dt>
                      <dd>{chapterLabel(thread.plannedPayoffChapter)}</dd>
                    </div>
                  </dl>
                  {thread.milestones.length > 0 ? (
                    <ul className="ledger-milestones">
                      {thread.milestones.map((milestone) => (
                        <li key={`${thread.id}-${milestone.chapterNumber}`}>
                          第 {milestone.chapterNumber} 章：{milestone.description}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <TensionCurve points={thread.tensionCurve} />
                  <div className="ledger-card-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        setThreadEditor({ id: thread.id });
                        setThreadForm(threadDraft(thread));
                        setNotice({ status: 'idle' });
                      }}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() => void removeThread(thread)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'foreshadows' ? (
        <section
          aria-labelledby="ledger-foreshadows-title"
          className="ledger-tab-panel"
          role="tabpanel"
        >
          <div className="ledger-panel-heading">
            <div>
              <h3 id="ledger-foreshadows-title">伏笔</h3>
              <p>埋下时就写清计划回收的位置，避免重要承诺只埋不收。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setForeshadowEditor({});
                setForeshadowForm(blankForeshadow());
                setNotice({ status: 'idle' });
              }}
              type="button"
            >
              记录新伏笔
            </button>
          </div>

          {foreshadowEditor ? (
            <form className="auth-form ledger-form" onSubmit={saveForeshadow}>
              <div className="ledger-form-grid">
                <label className="field ledger-form-wide">
                  <span>伏笔名称</span>
                  <input
                    maxLength={200}
                    onChange={(event) => updateForeshadowForm('title', event.currentTarget.value)}
                    required
                    value={foreshadowForm.title}
                  />
                </label>
                <label className="field ledger-form-wide">
                  <span>伏笔内容</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) =>
                      updateForeshadowForm('description', event.currentTarget.value)
                    }
                    required
                    rows={3}
                    value={foreshadowForm.description}
                  />
                </label>
                <label className="field">
                  <span>埋设章</span>
                  <input
                    inputMode="numeric"
                    min={1}
                    onChange={(event) =>
                      updateForeshadowForm('plantChapter', event.currentTarget.value)
                    }
                    type="number"
                    value={foreshadowForm.plantChapter}
                  />
                </label>
                <label className="field">
                  <span>计划回收章</span>
                  <input
                    inputMode="numeric"
                    min={1}
                    onChange={(event) =>
                      updateForeshadowForm('plannedPayoffChapter', event.currentTarget.value)
                    }
                    type="number"
                    value={foreshadowForm.plannedPayoffChapter}
                  />
                </label>
                <label className="field">
                  <span>重要程度</span>
                  <select
                    onChange={(event) =>
                      updateForeshadowForm(
                        'importance',
                        event.currentTarget.value as StoryForeshadowImportance,
                      )
                    }
                    value={foreshadowForm.importance}
                  >
                    {FORESHADOW_IMPORTANCE.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>伏笔状态</span>
                  <select
                    onChange={(event) =>
                      updateForeshadowForm(
                        'status',
                        event.currentTarget.value as StoryForeshadowStatus,
                      )
                    }
                    value={foreshadowForm.status}
                  >
                    {FORESHADOW_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="planning-actions">
                <button
                  className="primary-button"
                  disabled={notice.status === 'saving'}
                  type="submit"
                >
                  {notice.status === 'saving' ? '正在保存…' : '保存伏笔'}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setForeshadowEditor(null);
                    setForeshadowForm(blankForeshadow());
                  }}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          ) : null}

          {ledger.foreshadows.length === 0 ? (
            <div className="planning-empty">
              <h4>还没有记录伏笔</h4>
              <p>每个重要线索都先写清埋设章和计划回收章。</p>
            </div>
          ) : (
            <ul className="ledger-foreshadow-list">
              {ledger.foreshadows.map((foreshadow) => (
                <li key={foreshadow.id}>
                  <div className="ledger-foreshadow-main">
                    <div className="ledger-card-heading">
                      <div>
                        <span>{foreshadow.importanceLabel}</span>
                        <h4>{foreshadow.title}</h4>
                      </div>
                      <span className={`ledger-status ${foreshadow.status}`}>
                        {foreshadow.statusLabel}
                      </span>
                    </div>
                    <p>{foreshadow.description}</p>
                    <small>
                      埋设：{chapterLabel(foreshadow.plantChapter)} · 计划回收：
                      {chapterLabel(foreshadow.plannedPayoffChapter)}
                    </small>
                  </div>
                  <div className="ledger-card-actions">
                    {foreshadow.status === 'planted' ? (
                      <button
                        className="text-button"
                        onClick={() => void payOffForeshadow(foreshadow)}
                        type="button"
                      >
                        标记已回收
                      </button>
                    ) : null}
                    <button
                      className="text-button"
                      onClick={() => {
                        setForeshadowEditor({ id: foreshadow.id });
                        setForeshadowForm(foreshadowDraft(foreshadow));
                        setNotice({ status: 'idle' });
                      }}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'arcs' ? (
        <section
          aria-labelledby="character-arcs-title"
          className="ledger-tab-panel"
          role="tabpanel"
        >
          <div className="ledger-panel-heading">
            <div>
              <h3 id="character-arcs-title">人物弧</h3>
              <p>从起点写到终点，把欲望、恐惧和谎言连成能推动选择的动机链。</p>
            </div>
            <button
              className="secondary-button"
              disabled={ledger.characters.length === 0}
              onClick={() => {
                setArcEditor({});
                setArcForm(blankArc(ledger.characters[0]?.id ?? ''));
                setNotice({ status: 'idle' });
              }}
              type="button"
            >
              新建人物弧
            </button>
          </div>

          {arcEditor ? (
            <form className="auth-form ledger-form" onSubmit={saveArc}>
              <div className="ledger-form-grid">
                <label className="field">
                  <span>人物</span>
                  <select
                    aria-label="人物"
                    onChange={(event) => updateArcForm('characterId', event.currentTarget.value)}
                    required
                    value={arcForm.characterId}
                  >
                    <option value="">选择人物</option>
                    {ledger.characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>人物弧状态</span>
                  <select
                    onChange={(event) =>
                      updateArcForm('status', event.currentTarget.value as StoryArcStatus)
                    }
                    value={arcForm.status}
                  >
                    {ARC_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field ledger-form-wide">
                  <span>起点</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('startState', event.currentTarget.value)}
                    rows={2}
                    value={arcForm.startState}
                  />
                </label>
                <label className="field">
                  <span>欲望</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('desire', event.currentTarget.value)}
                    rows={3}
                    value={arcForm.desire}
                  />
                </label>
                <label className="field">
                  <span>恐惧</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('fear', event.currentTarget.value)}
                    rows={3}
                    value={arcForm.fear}
                  />
                </label>
                <label className="field">
                  <span>谎言</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('lie', event.currentTarget.value)}
                    rows={3}
                    value={arcForm.lie}
                  />
                </label>
                <label className="field">
                  <span>真相</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('truth', event.currentTarget.value)}
                    rows={3}
                    value={arcForm.truth}
                  />
                </label>
                <label className="field ledger-form-wide">
                  <span>转折</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('turn', event.currentTarget.value)}
                    rows={2}
                    value={arcForm.turn}
                  />
                </label>
                <label className="field ledger-form-wide">
                  <span>终点</span>
                  <textarea
                    maxLength={2_000}
                    onChange={(event) => updateArcForm('endState', event.currentTarget.value)}
                    rows={2}
                    value={arcForm.endState}
                  />
                </label>
              </div>
              <div className="planning-actions">
                <button
                  className="primary-button"
                  disabled={notice.status === 'saving'}
                  type="submit"
                >
                  {notice.status === 'saving' ? '正在保存…' : '保存人物弧'}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setArcEditor(null);
                    setArcForm(blankArc(ledger.characters[0]?.id ?? ''));
                  }}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          ) : null}

          {ledger.characterArcs.length === 0 ? (
            <div className="planning-empty">
              <h4>还没有人物弧</h4>
              <p>先为核心人物写一条完整的动机链，再让剧情线里的选择有根。</p>
            </div>
          ) : (
            <div className="ledger-arc-grid">
              {ledger.characterArcs.map((arc) => (
                <article className="ledger-arc-card" key={arc.id}>
                  <div className="ledger-card-heading">
                    <div>
                      <span>人物弧</span>
                      <h4>{arc.character.name}</h4>
                    </div>
                    <span className={`ledger-status ${arc.status}`}>{arc.statusLabel}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>起点</dt>
                      <dd>{arc.startState || '待补'}</dd>
                    </div>
                    <div>
                      <dt>欲望</dt>
                      <dd>{arc.desire || '待补'}</dd>
                    </div>
                    <div>
                      <dt>恐惧</dt>
                      <dd>{arc.fear || '待补'}</dd>
                    </div>
                    <div>
                      <dt>谎言</dt>
                      <dd>{arc.lie || '待补'}</dd>
                    </div>
                    <div>
                      <dt>真相</dt>
                      <dd>{arc.truth || '待补'}</dd>
                    </div>
                    <div>
                      <dt>转折</dt>
                      <dd>{arc.turn || '待补'}</dd>
                    </div>
                    <div>
                      <dt>终点</dt>
                      <dd>{arc.endState || '待补'}</dd>
                    </div>
                  </dl>
                  <div className="ledger-card-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        setArcEditor({ id: arc.id });
                        setArcForm(arcDraft(arc));
                        setNotice({ status: 'idle' });
                      }}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
