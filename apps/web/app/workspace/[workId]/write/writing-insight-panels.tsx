'use client';

import { useState } from 'react';
import type {
  ChapterVersion,
  ContinuityIssue,
  WritingInsights,
} from '../../../../lib/chapter-generation-api';
import { diffLines } from '../../../../lib/text-diff';

export type AssistantOutput = {
  id: string;
  kind: 'hook_options' | 'title' | 'summary';
  content: string;
  createdAt: string;
};

export function SuggestionsPanel({
  suggestions,
  loading,
  error,
  notice,
  busyId,
  outputs,
  onIgnore,
  onLocate,
  onApplyTitle,
  onSaveSummary,
  onAppendHook,
}: {
  suggestions: ContinuityIssue[];
  loading: boolean;
  error: string;
  notice: string;
  busyId?: string;
  outputs: AssistantOutput[];
  onIgnore: (issue: ContinuityIssue, reason: string) => Promise<void>;
  onLocate: (issue: ContinuityIssue) => void;
  onApplyTitle: (title: string) => Promise<void>;
  onSaveSummary: (summary: string) => Promise<void>;
  onAppendHook: (hook: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const openCount = suggestions.filter((issue) => issue.status === 'open').length;

  return (
    <section aria-labelledby="writing-suggestions-title" className="writing-context-section">
      <div className="writing-insight-heading">
        <div>
          <h3 id="writing-suggestions-title">编辑建议</h3>
          <p>从正文和写作要求里整理出的可执行修改建议。</p>
        </div>
        {!loading && suggestions.length > 0 ? (
          <span>{openCount > 0 ? `${openCount} 条待处理` : '已全部处理'}</span>
        ) : null}
      </div>

      {loading ? <p className="writing-context-loading">正在整理建议…</p> : null}
      {error ? (
        <p className="form-message form-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message form-message-success" role="status">
          {notice}
        </p>
      ) : null}

      {outputs.length > 0 ? (
        <div className="assistant-output-list">
          {outputs.map((output) => (
            <article className="assistant-output" key={output.id}>
              <strong>
                {output.kind === 'title'
                  ? '标题建议'
                  : output.kind === 'summary'
                    ? '本章摘要'
                    : '章末钩子备选'}
              </strong>
              {output.kind === 'hook_options' ? (
                <HookOptions content={output.content} onAppendHook={onAppendHook} />
              ) : (
                <p>{output.content}</p>
              )}
              {output.kind === 'title' ? (
                <button
                  className="secondary-button"
                  onClick={() => void onApplyTitle(output.content)}
                  type="button"
                >
                  使用这个标题
                </button>
              ) : null}
              {output.kind === 'summary' ? (
                <button
                  className="secondary-button"
                  onClick={() => void onSaveSummary(output.content)}
                  type="button"
                >
                  保存摘要
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {!loading && suggestions.length === 0 && outputs.length === 0 ? (
        <p className="writing-insight-empty">这一章暂时没有编辑建议。</p>
      ) : null}

      <div className="writing-suggestion-list">
        {suggestions.map((issue) => {
          const reason = reasons[issue.id] ?? '';
          return (
            <article className={`writing-suggestion writing-suggestion-${issue.status}`} key={issue.id}>
              <div className="writing-suggestion-heading">
                <strong>{issue.categoryLabel}</strong>
                <span className={`continuity-status continuity-status-${issue.status}`}>
                  {issue.statusLabel}
                </span>
              </div>
              <p>{issue.message}</p>
              <blockquote>{issue.sourceSentence}</blockquote>
              <div className="writing-suggestion-advice">
                <span>建议</span>
                <p>{issue.suggestion}</p>
              </div>
              <div className="writing-suggestion-actions">
                <button className="text-button" onClick={() => onLocate(issue)} type="button">
                  定位原文
                </button>
              </div>
              {issue.status === 'open' ? (
                <div className="continuity-ignore">
                  <label htmlFor={`suggestion-reason-${issue.id}`}>忽略原因</label>
                  <textarea
                    aria-label="忽略原因"
                    id={`suggestion-reason-${issue.id}`}
                    onChange={(event) =>
                      setReasons((current) => ({
                        ...current,
                        [issue.id]: event.target.value,
                      }))
                    }
                    placeholder="例如：这是有意保留的写法，后文会解释。"
                    rows={2}
                    value={reason}
                  />
                  <button
                    className="text-button"
                    disabled={busyId === issue.id || !reason.trim()}
                    onClick={() => void onIgnore(issue, reason)}
                    type="button"
                  >
                    {busyId === issue.id ? '正在记录…' : '忽略这条建议'}
                  </button>
                </div>
              ) : (
                <div className="continuity-ignored-reason">
                  <span>忽略原因</span>
                  <p>{issue.ignoredReason}</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function HookOptions({
  content,
  onAppendHook,
}: {
  content: string;
  onAppendHook: (hook: string) => void;
}) {
  const hooks = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[.、]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return (
    <ol className="hook-option-list">
      {hooks.map((hook, index) => (
        <li key={`${index}-${hook}`}>
          <span>{hook}</span>
          <button className="text-button" onClick={() => onAppendHook(hook)} type="button">
            放到章末
          </button>
        </li>
      ))}
    </ol>
  );
}

export function ForeshadowPanel({
  insights,
  loading,
}: {
  insights: WritingInsights | null;
  loading: boolean;
}) {
  return (
    <section aria-labelledby="writing-foreshadows-title" className="writing-context-section">
      <div className="writing-insight-heading">
        <div>
          <h3 id="writing-foreshadows-title">伏笔</h3>
          <p>还没兑现的叙事承诺，写这一章时可以顺手照看。</p>
        </div>
      </div>
      {loading ? <p className="writing-context-loading">正在整理伏笔…</p> : null}
      {!loading && (!insights || insights.foreshadows.length === 0) ? (
        <p className="writing-insight-empty">暂时没有未回收伏笔。</p>
      ) : null}
      <div className="writing-insight-list">
        {insights?.foreshadows.map((foreshadow) => (
          <article className="writing-insight-card" key={foreshadow.id}>
            <div>
              <strong>{foreshadow.title}</strong>
              <span>{foreshadow.importanceLabel}</span>
            </div>
            <p>{foreshadow.description}</p>
            <small>
              埋设：{chapterLabel(foreshadow.setupChapter)} · 计划回收：
              {chapterLabel(foreshadow.plannedPayoffChapter)}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CharacterStatePanel({
  insights,
  loading,
}: {
  insights: WritingInsights | null;
  loading: boolean;
}) {
  return (
    <section aria-labelledby="writing-characters-title" className="writing-context-section">
      <div className="writing-insight-heading">
        <div>
          <h3 id="writing-characters-title">人物状态</h3>
          <p>身体、力量、所在地和随身物，以下一章写作时的最新状态为准。</p>
        </div>
      </div>
      {loading ? <p className="writing-context-loading">正在整理人物状态…</p> : null}
      {!loading && (!insights || insights.characters.length === 0) ? (
        <p className="writing-insight-empty">还没有记录人物当前状态。</p>
      ) : null}
      <div className="writing-insight-list">
        {insights?.characters.map((character) => (
          <article className="writing-insight-card" key={character.id}>
            <div>
              <strong>{character.name}</strong>
              <span>{character.knowledgeCount} 条认知</span>
            </div>
            <dl className="character-state-grid">
              <div>
                <dt>身体</dt>
                <dd>{character.body || '未记录'}</dd>
              </div>
              <div>
                <dt>力量</dt>
                <dd>{character.power || '未记录'}</dd>
              </div>
              <div>
                <dt>所在地</dt>
                <dd>{character.location || '未记录'}</dd>
              </div>
              <div>
                <dt>持有物</dt>
                <dd>{character.possessions || '未记录'}</dd>
              </div>
              <div>
                <dt>伪装</dt>
                <dd>{character.disguise || '无'}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

const VERSION_SOURCE_LABELS: Record<ChapterVersion['source'], string> = {
  generated: '生成',
  manual: '手动保存',
  restored: '恢复',
};

export function VersionHistoryPanel({
  versions,
  selectedVersionId,
  currentContent,
  restoringId,
  onSelect,
  onRestore,
}: {
  versions: ChapterVersion[];
  selectedVersionId?: string;
  currentContent: string;
  restoringId?: string;
  onSelect: (versionId: string) => void;
  onRestore: (version: ChapterVersion) => Promise<void>;
}) {
  const selected = versions.find((version) => version.id === selectedVersionId);
  const diff = selected ? diffLines(selected.content, currentContent) : [];

  return (
    <section aria-labelledby="writing-versions-title" className="writing-context-section">
      <div className="writing-insight-heading">
        <div>
          <h3 id="writing-versions-title">版本历史</h3>
          <p>每次手动保存和恢复都会留下版本，历史不会被覆盖。</p>
        </div>
      </div>
      {versions.length === 0 ? (
        <p className="writing-insight-empty">还没有保存过版本。</p>
      ) : null}
      <div className="version-list">
        {versions.map((version) => (
          <button
            aria-pressed={selectedVersionId === version.id}
            className="version-item"
            key={version.id}
            onClick={() => onSelect(version.id)}
            type="button"
          >
            <span>版本 {version.version}</span>
            <small>
              {VERSION_SOURCE_LABELS[version.source]} · {version.wordCount.toLocaleString('zh-CN')} 字
            </small>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="version-compare">
          <div className="version-compare-heading">
            <strong>与当前正文对比</strong>
            <button
              className="secondary-button"
              disabled={restoringId === selected.id}
              onClick={() => void onRestore(selected)}
              type="button"
            >
              {restoringId === selected.id ? '正在恢复…' : `恢复版本 ${selected.version}`}
            </button>
          </div>
          <div className="version-diff" data-testid="version-diff">
            {diff.map((line, index) => (
              <div className={`version-diff-line version-diff-${line.kind}`} key={`${index}-${line.text}`}>
                <span aria-hidden="true">
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                </span>
                <p>{line.text || ' '}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function chapterLabel(chapterNumber: number | null): string {
  return chapterNumber ? `第 ${chapterNumber} 章` : '未定';
}
