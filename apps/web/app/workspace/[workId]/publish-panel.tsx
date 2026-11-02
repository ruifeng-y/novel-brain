'use client';

import {
  EXPORT_FORMAT_LABELS,
  type ExportFormat,
  type PublishCheckResponse,
  type PublishReaderPreview,
  type PublishSuggestions,
} from '@novel/contracts';
import { useEffect, useMemo, useState } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import { loadBranches, type ParallelVersion } from '../../../lib/branches-api';
import {
  generatePublishSuggestions,
  loadPublishPreview,
  runPublishCheck,
} from '../../../lib/publish-api';

export function PublishPanel({
  workId,
  initialBranchId,
}: {
  workId: string;
  initialBranchId: string;
}) {
  const [branches, setBranches] = useState<ParallelVersion[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [preview, setPreview] = useState<PublishReaderPreview | null>(null);
  const [suggestions, setSuggestions] = useState<PublishSuggestions | null>(null);
  const [check, setCheck] = useState<PublishCheckResponse | null>(null);
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [readerMode, setReaderMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    loadBranches(workId)
      .then((response) => {
        setBranches(response.items);
        if (!response.items.some((branch) => branch.id === branchId)) {
          setBranchId(response.items[0]?.id ?? initialBranchId);
        }
      })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', message: friendlyError(error) });
      });
  }, [branchId, initialBranchId, workId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSuggestions(null);
    setCheck(null);
    setReaderMode(false);
    loadPublishPreview(workId, branchId)
      .then((response) => {
        if (!cancelled) {
          setPreview(response);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNotice({ kind: 'error', message: friendlyError(error) });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, workId]);

  const displayTitle = suggestions?.titles[0] ?? preview?.title ?? '';
  const displaySynopsis = suggestions?.synopsis ?? preview?.synopsis ?? '';
  const displayTags = suggestions?.tags ?? preview?.tags ?? [];
  const chapterTitleByNumber = useMemo(
    () =>
      new Map(
        (suggestions?.chapterTitles ?? []).map((chapter) => [chapter.chapterNumber, chapter.title]),
      ),
    [suggestions?.chapterTitles],
  );

  async function handleGenerate() {
    setGenerating(true);
    setNotice(null);
    try {
      const generated = await generatePublishSuggestions(workId, branchId);
      setSuggestions(generated);
      setNotice({ kind: 'success', message: '发布建议已经生成，可以先读者预览再决定。' });
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) });
    } finally {
      setGenerating(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setNotice(null);
    try {
      const result = await runPublishCheck(workId, branchId, format);
      setCheck(result);
      setNotice({ kind: 'success', message: '发布检查已完成。' });
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) });
    } finally {
      setChecking(false);
    }
  }

  async function copyReport() {
    if (!check) {
      return;
    }
    try {
      await navigator.clipboard.writeText(check.report);
      setNotice({ kind: 'success', message: '检查结果已复制。' });
    } catch {
      setNotice({ kind: 'error', message: '复制失败，请下载检查结果。' });
    }
  }

  function downloadReport() {
    if (!check || !preview) {
      return;
    }
    const blob = new Blob([check.report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${preview.title}-发布检查.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="publish-board" aria-labelledby="publish-board-title">
      <div className="publish-heading">
        <div>
          <p className="workspace-step">发布准备</p>
          <h2 id="publish-board-title">发布准备</h2>
          <p>整理书名、简介和标签，用读者视角检查前三章，再把检查结果带到发布平台。</p>
        </div>
        <span>V1 只导出文件，不会连接或上传到发布平台。</span>
      </div>

      <div className="publish-toolbar">
        <label className="field">
          <span>发布版本</span>
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            disabled={branches.length === 0}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.isMain ? '（主线）' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void handleGenerate()}
          disabled={loading || generating}
        >
          {generating ? '正在生成建议…' : '生成发布建议'}
        </button>
      </div>

      <div className="publish-layout">
        <section className="publish-suggestions" aria-labelledby="publish-suggestions-title">
          <div className="publish-section-heading">
            <h3 id="publish-suggestions-title">作品包装建议</h3>
            <span>{suggestions ? '已生成' : '等待生成'}</span>
          </div>
          {suggestions ? (
            <div className="publish-suggestion-content">
              <div>
                <strong>书名备选</strong>
                <ul className="publish-title-options">
                  {suggestions.titles.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>简介建议</strong>
                <p>{suggestions.synopsis}</p>
              </div>
              <div>
                <strong>标签建议</strong>
                <div className="publish-tags">
                  {suggestions.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <div>
                <strong>前三章章节名</strong>
                <ol>
                  {suggestions.chapterTitles.map((chapter) => (
                    <li key={chapter.chapterNumber}>
                      第 {chapter.chapterNumber} 章 · {chapter.title}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <p className="publish-empty">
              配置规划模型后，可以一次得到书名、简介、标签和前三章章节名建议。
            </p>
          )}
        </section>

        <section className="publish-reader-shell" aria-labelledby="publish-reader-title">
          <div className="publish-section-heading">
            <h3 id="publish-reader-title">读者预览</h3>
            <button
              className="text-button"
              type="button"
              onClick={() => setReaderMode((current) => !current)}
              disabled={loading || !preview}
            >
              {readerMode ? '退出读者预览' : '打开读者预览'}
            </button>
          </div>
          {readerMode && preview ? (
            <article className="publish-reader" aria-label="读者预览">
              <p className="publish-reader-genre">{preview.genreLabel}</p>
              <h4>{displayTitle}</h4>
              <p className="publish-reader-author">{preview.penName}</p>
              <p className="publish-reader-synopsis">{displaySynopsis}</p>
              <div className="publish-tags">
                {displayTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="publish-reader-chapters">
                {preview.chapters.map((chapter) => (
                  <section key={chapter.chapterNumber}>
                    <h5>
                      第 {chapter.chapterNumber} 章 ·{' '}
                      {chapterTitleByNumber.get(chapter.chapterNumber) ?? chapter.title}
                    </h5>
                    {chapter.content
                      .replace(/\r\n/g, '\n')
                      .split('\n')
                      .filter((paragraph) => paragraph.trim())
                      .map((paragraph, index) => (
                        <p key={`${chapter.chapterNumber}-${index}`}>{paragraph.trim()}</p>
                      ))}
                  </section>
                ))}
              </div>
            </article>
          ) : (
            <p className="publish-empty">
              打开后会按读者看到的顺序显示作品信息、简介和前三章正文。
            </p>
          )}
        </section>
      </div>

      <section className="publish-check-shell" aria-labelledby="publish-check-title">
        <div className="publish-section-heading">
          <h3 id="publish-check-title">发布检查</h3>
          <span>结果可以复制或下载</span>
        </div>
        <div className="publish-check-toolbar">
          <label className="field">
            <span>检查导出格式</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              {Object.entries(EXPORT_FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleCheck()}
            disabled={loading || checking}
          >
            {checking ? '正在检查…' : '运行发布检查'}
          </button>
        </div>

        {check ? (
          <div className="publish-check-content" aria-label="发布检查结果">
            <div className="publish-check-summary">
              <strong>{displayTitle}</strong>
              <span>{formatDate(check.generatedAt)}</span>
            </div>
            <div className="publish-check-list">
              {check.checks.map((item) => (
                <article key={item.key} className={`publish-check-item ${item.status}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.statusLabel}</span>
                  </div>
                  <p>{item.summary}</p>
                  {item.details.map((detail) => (
                    <small key={detail}>{detail}</small>
                  ))}
                </article>
              ))}
            </div>
            <div className="publish-check-actions">
              <button className="secondary-button" type="button" onClick={() => void copyReport()}>
                复制检查结果
              </button>
              <button className="secondary-button" type="button" onClick={downloadReport}>
                下载检查结果
              </button>
            </div>
          </div>
        ) : (
          <p className="publish-empty">
            检查前三章钩子、章节字数、敏感内容、AI 内容标识、版权和导出格式。
          </p>
        )}
      </section>

      {notice ? (
        <p
          className={`form-message ${
            notice.kind === 'error' ? 'form-message-error' : 'form-message-success'
          }`}
        >
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
