'use client';

import {
  EXPORT_FORMAT_LABELS,
  EXPORT_PRESET_LABELS,
  type ExportFormat,
  type ExportHistoryItem,
  type ExportPreview,
  type ExportPreset,
  type ExportScope,
} from '@novel/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { friendlyError } from '../../../lib/auth-api';
import { loadBranches, type ParallelVersion } from '../../../lib/branches-api';
import { loadChapters, type ChapterListItem } from '../../../lib/chapter-generation-api';
import { createExport, loadExports, previewExport } from '../../../lib/exports-api';
import { loadOutlineNodes, type OutlineNode } from '../../../lib/story-planning-api';

type ScopeType = ExportScope['type'];

const SCOPE_OPTIONS: Array<{ type: ScopeType; label: string }> = [
  { type: 'chapter', label: '当前章' },
  { type: 'chapters', label: '选中章节' },
  { type: 'range', label: '自定义区间' },
  { type: 'volume', label: '整卷' },
  { type: 'book', label: '全本' },
];

export function ExportPanel({
  workId,
  initialBranchId,
}: {
  workId: string;
  initialBranchId: string;
}) {
  const [branches, setBranches] = useState<ParallelVersion[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [outlines, setOutlines] = useState<OutlineNode[]>([]);
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [preset, setPreset] = useState<ExportPreset>('generic');
  const [scopeType, setScopeType] = useState<ScopeType>('chapter');
  const [currentChapter, setCurrentChapter] = useState(1);
  const [selectedChapterNumbers, setSelectedChapterNumbers] = useState<number[]>([]);
  const [startChapter, setStartChapter] = useState(1);
  const [endChapter, setEndChapter] = useState(1);
  const [volumeId, setVolumeId] = useState('');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  const volumes = useMemo(
    () => outlines.filter((outline) => outline.level === 'volume'),
    [outlines],
  );

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

  const refreshHistory = useCallback(async () => {
    const response = await loadExports(workId, branchId);
    setHistory(response.items);
  }, [branchId, workId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    Promise.all([
      loadChapters(workId, branchId),
      loadOutlineNodes(workId, branchId),
      loadExports(workId, branchId),
    ])
      .then(([chapterResponse, outlineResponse, exportResponse]) => {
        if (cancelled) {
          return;
        }
        const written = chapterResponse.items.filter((chapter) => chapter.hasContent);
        setChapters(chapterResponse.items);
        setOutlines(outlineResponse.items);
        setHistory(exportResponse.items);
        const firstChapter = written[0]?.chapterNumber ?? chapterResponse.items[0]?.chapterNumber;
        if (firstChapter) {
          setCurrentChapter(firstChapter);
          setStartChapter(firstChapter);
          setEndChapter(firstChapter);
        }
        setSelectedChapterNumbers(written.slice(0, 1).map((chapter) => chapter.chapterNumber));
        setVolumeId(outlineResponse.items.find((outline) => outline.level === 'volume')?.id ?? '');
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

  const hasPendingExport = history.some(
    (item) => item.status === 'queued' || item.status === 'running',
  );
  useEffect(() => {
    if (!hasPendingExport) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshHistory();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [hasPendingExport, refreshHistory]);

  function scopeInput(): ExportScope | null {
    if (scopeType === 'chapter') {
      return { type: 'chapter', chapterNumber: currentChapter };
    }
    if (scopeType === 'chapters') {
      return selectedChapterNumbers.length > 0
        ? { type: 'chapters', chapterNumbers: selectedChapterNumbers }
        : null;
    }
    if (scopeType === 'range') {
      return { type: 'range', startChapter, endChapter };
    }
    if (scopeType === 'volume') {
      return volumeId ? { type: 'volume', volumeId } : null;
    }
    return { type: 'book' };
  }

  async function handlePreview() {
    const scope = scopeInput();
    if (!scope) {
      setNotice({ kind: 'error', message: '请先选择要导出的章节或卷。' });
      return;
    }
    setPreviewing(true);
    setNotice(null);
    try {
      setPreview(
        await previewExport(workId, branchId, {
          format,
          scope,
          options: { preset, encoding: 'utf-8' },
        }),
      );
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExport() {
    const scope = scopeInput();
    if (!scope) {
      setNotice({ kind: 'error', message: '请先选择要导出的章节或卷。' });
      return;
    }
    setExporting(true);
    setNotice(null);
    try {
      const created = await createExport(workId, branchId, {
        format,
        scope,
        options: { preset, encoding: 'utf-8' },
      });
      await refreshHistory();
      setNotice({
        kind: 'success',
        message:
          created.status === 'completed'
            ? '导出完成，可以下载了。'
            : '已在后台开始整理，完成后会出现在下载历史。',
      });
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) });
    } finally {
      setExporting(false);
    }
  }

  function toggleChapter(chapterNumber: number) {
    setSelectedChapterNumbers((current) =>
      current.includes(chapterNumber)
        ? current.filter((number) => number !== chapterNumber)
        : [...current, chapterNumber].sort((left, right) => left - right),
    );
  }

  return (
    <section className="export-board" aria-labelledby="export-board-title">
      <div className="export-heading">
        <div>
          <p className="workspace-step">交付</p>
          <h2 id="export-board-title">导出与平台预设</h2>
          <p>选好章节和格式后，先看目录与前几章，再生成文件。</p>
        </div>
        <span>下载文件保留 7 天</span>
      </div>

      <div className="export-layout">
        <div className="export-controls">
          <div className="export-select-row">
            <label className="field">
              <span>导出分支</span>
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
            <label className="field">
              <span>导出格式</span>
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
            <label className="field">
              <span>格式预设</span>
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value as ExportPreset)}
              >
                {Object.entries(EXPORT_PRESET_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="export-scope-group">
            <span className="export-group-label">导出范围</span>
            <div className="export-scope-tabs" role="group" aria-label="导出范围">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  aria-pressed={scopeType === option.type}
                  className={scopeType === option.type ? 'active' : ''}
                  onClick={() => setScopeType(option.type)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="export-scope-detail">
            {scopeType === 'chapter' ? (
              <label className="field">
                <span>章节</span>
                <select
                  value={currentChapter}
                  onChange={(event) => setCurrentChapter(Number(event.target.value))}
                >
                  {chapters
                    .filter((chapter) => chapter.hasContent)
                    .map((chapter) => (
                      <option key={chapter.chapterNumber} value={chapter.chapterNumber}>
                        第 {chapter.chapterNumber} 章 · {chapter.title}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {scopeType === 'chapters' ? (
              <fieldset className="export-chapter-picker">
                <legend>选择章节</legend>
                <div>
                  {chapters.map((chapter) => (
                    <label key={chapter.chapterNumber}>
                      <input
                        type="checkbox"
                        checked={selectedChapterNumbers.includes(chapter.chapterNumber)}
                        disabled={!chapter.hasContent}
                        onChange={() => toggleChapter(chapter.chapterNumber)}
                      />
                      <span>选择第 {chapter.chapterNumber} 章</span>
                      <small>{chapter.title}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {scopeType === 'range' ? (
              <div className="export-range-row">
                <label className="field">
                  <span>起始章</span>
                  <input
                    type="number"
                    min={1}
                    value={startChapter}
                    onChange={(event) => setStartChapter(Number(event.target.value))}
                  />
                </label>
                <span>到</span>
                <label className="field">
                  <span>结束章</span>
                  <input
                    type="number"
                    min={1}
                    value={endChapter}
                    onChange={(event) => setEndChapter(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
            {scopeType === 'volume' ? (
              <label className="field">
                <span>卷</span>
                <select value={volumeId} onChange={(event) => setVolumeId(event.target.value)}>
                  {volumes.map((volume) => (
                    <option key={volume.id} value={volume.id}>
                      {volume.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {scopeType === 'book' ? (
              <p className="export-all-note">
                {chapters.filter((chapter) => chapter.hasContent).length} 章已写正文
              </p>
            ) : null}
          </div>

          <div className="export-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void handlePreview()}
              disabled={loading || previewing}
            >
              {previewing ? '正在预览…' : '预览导出'}
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleExport()}
              disabled={loading || exporting}
            >
              {exporting ? '正在导出…' : '开始导出'}
            </button>
          </div>

          {notice ? (
            <p
              className={`form-message ${
                notice.kind === 'error' ? 'form-message-error' : 'form-message-success'
              }`}
            >
              {notice.message}
            </p>
          ) : null}
        </div>

        <div className="export-preview" aria-label="导出预览">
          <div className="export-section-heading">
            <h3>预览</h3>
            <span>{preview ? `${preview.chapterCount} 章` : '尚未生成'}</span>
          </div>
          {preview ? (
            <>
              <div className="export-preview-meta">
                <span>{preview.scopeLabel}</span>
                <span>{EXPORT_FORMAT_LABELS[preview.format]}</span>
                <span>{EXPORT_PRESET_LABELS[preview.preset]}</span>
                <span>{preview.wordCount.toLocaleString('zh-CN')} 字</span>
              </div>
              <div className="export-toc">
                {preview.tableOfContents.map((group) => (
                  <div key={`${group.volumeTitle}-${group.chapters[0]?.chapterNumber ?? 0}`}>
                    {group.volumeTitle ? <strong>{group.volumeTitle}</strong> : null}
                    <ol>
                      {group.chapters.map((chapter) => (
                        <li key={chapter.chapterNumber}>
                          第 {chapter.chapterNumber} 章 · {chapter.title}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              <pre>{preview.sample}</pre>
            </>
          ) : (
            <p className="export-empty">选择范围后点“预览导出”，这里会显示前几章和目录。</p>
          )}
        </div>
      </div>

      <div className="export-history" aria-label="下载历史">
        <div className="export-section-heading">
          <h3>下载历史</h3>
          <span>{history.length} 个文件</span>
        </div>
        {history.length > 0 ? (
          <div className="export-history-list">
            {history.map((item) => (
              <article key={item.id}>
                <div className="export-history-main">
                  <strong>{item.fileName ?? `${EXPORT_FORMAT_LABELS[item.format]} 文件`}</strong>
                  <p>
                    {item.scopeLabel} · {item.chapterCount} 章 · {item.presetLabel}
                  </p>
                  <small>
                    {formatDate(item.createdAt)} · {item.branch.name}
                  </small>
                </div>
                <div className="export-history-side">
                  <span className={`export-status export-status-${item.status}`}>
                    {item.statusLabel}
                  </span>
                  {item.status === 'queued' || item.status === 'running' ? (
                    <small>{item.progress}%</small>
                  ) : null}
                  {item.downloadUrl ? (
                    <a className="secondary-button" href={item.downloadUrl} download>
                      下载 {item.formatLabel}
                    </a>
                  ) : null}
                  {item.status === 'expired' ? <small>请重新导出</small> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="export-empty">还没有导出文件。</p>
        )}
      </div>
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
