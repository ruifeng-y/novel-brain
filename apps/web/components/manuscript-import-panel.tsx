"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileUp,
  GitMerge,
  LoaderCircle,
  Scissors,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  apiErrorSchema,
  chunkedImportProgressResponseSchema,
  manuscriptImportConfirmResponseSchema,
  manuscriptImportResponseSchema,
  type ChunkedImportProgress,
  type ManuscriptImport,
  type ManuscriptImportChapter,
  type WorkGenre,
  type WorkScaleTarget,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

interface ManuscriptImportPanelProps {
  title: string;
  setTitle: (value: string) => void;
  penName: string;
  setPenName: (value: string) => void;
  genre: WorkGenre;
  setGenre: (value: WorkGenre) => void;
  scaleTarget: WorkScaleTarget;
  setScaleTarget: (value: WorkScaleTarget) => void;
  chapterLengthTarget: number;
  setChapterLengthTarget: (value: number) => void;
  onCreated: (workId: string) => void;
}

type BusyState = "recognize" | "confirm" | null;

export function ManuscriptImportPanel({
  title,
  setTitle,
  penName,
  setPenName,
  genre,
  setGenre,
  scaleTarget,
  setScaleTarget,
  chapterLengthTarget,
  setChapterLengthTarget,
  onCreated,
}: ManuscriptImportPanelProps) {
  const confirmKey = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [manuscriptImport, setManuscriptImport] = useState<ManuscriptImport | null>(null);
  const [chapters, setChapters] = useState<ManuscriptImportChapter[]>([]);
  const [busy, setBusy] = useState<BusyState>(null);
  const [chunkProgress, setChunkProgress] = useState<ChunkedImportProgress | null>(null);
  const [error, setError] = useState("");
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitOffset, setSplitOffset] = useState(1);

  const canConfirm = Boolean(
    manuscriptImport &&
    manuscriptImport.status !== "empty" &&
    chapters.length > 0 &&
    chapters.every((chapter) => chapter.title.trim()) &&
    title.trim() &&
    busy === null,
  );

  function resetPreview(nextFile: File | null = null) {
    setFile(nextFile);
    setManuscriptImport(null);
    setChapters([]);
    setSplitIndex(null);
    setError("");
    confirmKey.current = null;
    setChunkProgress(null);
  }

  function selectFile(nextFile: File | undefined) {
    if (!nextFile) {
      return;
    }
    const extension = nextFile.name.slice(nextFile.name.lastIndexOf(".")).toLowerCase();
    if (![".txt", ".md", ".markdown"].includes(extension)) {
      resetPreview(null);
      setError("请选择 TXT 或 Markdown 旧稿文件");
      return;
    }
    resetPreview(nextFile);
  }

  async function recognize() {
    if (!file) {
      return;
    }
    setBusy("recognize");
    setError("");
    setManuscriptImport(null);
    setChapters([]);
    setSplitIndex(null);
    confirmKey.current = null;
    try {
      const csrfToken = await getCsrfToken();
      if (file.size > 1024 * 1024) {
        const text = await file.text();
        const chunks = splitIntoChunks(text, 500_000);
        let response = await fetch("/api/v1/imports/manuscripts/chunked/start", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ sourceName: file.name, chunkCount: chunks.length }),
        });
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        let progress = chunkedImportProgressResponseSchema.parse(await response.json()).data;
        setChunkProgress(progress);
        for (const [sequence, sourceText] of chunks.entries()) {
          response = await fetch(`/api/v1/imports/manuscripts/${progress.importId}/chunks`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify({ sequence, sourceText }),
          });
          if (!response.ok) {
            throw new Error(await readError(response));
          }
          progress = chunkedImportProgressResponseSchema.parse(await response.json()).data;
          setChunkProgress(progress);
        }
        while (progress.status === "queued" || progress.status === "processing") {
          response = await fetch(`/api/v1/imports/manuscripts/${progress.importId}/process`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: "{}",
          });
          if (!response.ok) {
            throw new Error(await readError(response));
          }
          progress = chunkedImportProgressResponseSchema.parse(await response.json()).data;
          setChunkProgress(progress);
        }
        if (progress.status !== "awaiting_confirmation") {
          throw new Error("分块导入未能完成，请检查后重试。");
        }
        const previewResponse = await fetch(`/api/v1/imports/manuscripts/${progress.importId}`, {
          cache: "no-store",
        });
        if (!previewResponse.ok) {
          throw new Error(await readError(previewResponse));
        }
        const parsed = manuscriptImportResponseSchema.parse(await previewResponse.json()).data;
        setManuscriptImport(parsed);
        setChapters(parsed.chapters);
        return;
      }
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/v1/imports/manuscripts", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body,
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const parsed = manuscriptImportResponseSchema.parse(await response.json()).data;
      setManuscriptImport(parsed);
      setChapters(parsed.chapters);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "旧稿识别失败，请重试。");
    } finally {
      setBusy(null);
    }
  }

  function updateTitle(index: number, nextTitle: string) {
    setChapters((current) =>
      current.map((chapter, chapterIndex) =>
        chapterIndex === index ? { ...chapter, title: nextTitle } : chapter,
      ),
    );
  }

  function beginSplit(index: number) {
    const chapter = chapters[index];
    if (!chapter || chapter.content.length < 2) {
      return;
    }
    const paragraphBreak = chapter.content.indexOf("\n\n", Math.floor(chapter.content.length / 3));
    const initialOffset =
      paragraphBreak > 0 && paragraphBreak < chapter.content.length - 1
        ? paragraphBreak + 2
        : Math.max(1, Math.floor(chapter.content.length / 2));
    setSplitIndex(index);
    setSplitOffset(initialOffset);
    setError("");
  }

  function confirmSplit() {
    if (splitIndex === null) {
      return;
    }
    const chapter = chapters[splitIndex];
    if (!chapter) {
      return;
    }
    const offset = safeSplitOffset(chapter.content, splitOffset);
    const left = chapter.content.slice(0, offset);
    const right = chapter.content.slice(offset);
    if (!left || !right) {
      setError("拆分位置需要同时保留前后两段正文");
      return;
    }
    const next = [
      ...chapters.slice(0, splitIndex),
      { ...chapter, content: left },
      {
        order: splitIndex + 2,
        title: "拆分章节",
        content: right,
        wordCount: countWords(right),
      },
      ...chapters.slice(splitIndex + 1),
    ].map((item, index) => ({ ...item, order: index + 1 }));
    setChapters(next);
    setSplitIndex(null);
    setError("");
  }

  function mergeNext(index: number) {
    const chapter = chapters[index];
    const nextChapter = chapters[index + 1];
    if (!chapter || !nextChapter) {
      setError("没有可合并的下一章");
      return;
    }
    const merged = {
      ...chapter,
      content: chapter.content + nextChapter.content,
      wordCount: chapter.wordCount + nextChapter.wordCount,
    };
    setChapters(
      [...chapters.slice(0, index), merged, ...chapters.slice(index + 2)].map(
        (item, itemIndex) => ({
          ...item,
          order: itemIndex + 1,
        }),
      ),
    );
    setSplitIndex(null);
    setError("");
  }

  async function confirmImport() {
    if (!manuscriptImport || !canConfirm) {
      return;
    }
    setBusy("confirm");
    setError("");
    confirmKey.current ??= crypto.randomUUID();
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/imports/manuscripts/${manuscriptImport.id}/confirm`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": confirmKey.current,
        },
        body: JSON.stringify({
          title,
          ...(penName.trim() ? { penName: penName.trim() } : {}),
          genre,
          scaleTarget,
          chapterLengthTarget,
          chapters: chapters.map((chapter) => ({
            title: chapter.title.trim(),
            content: chapter.content,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const work = manuscriptImportConfirmResponseSchema.parse(await response.json()).data.work;
      onCreated(work.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品创建失败，请重试。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="creation-layout manuscript-import-layout">
      <section className="panel manuscript-import-panel">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">导入旧稿</span>
            <h2>把已经写下的部分带进来</h2>
          </div>
          <span className="badge">TXT · Markdown</span>
        </div>
        <div className="settings-note">
          <FileText size={15} aria-hidden="true" />
          <span>默认只识别章节、保留原文，不会自动抽取人物或已确认设定。</span>
        </div>

        <label className="settings-upload manuscript-upload" htmlFor="manuscript-file">
          <FileUp size={22} aria-hidden="true" />
          <strong>上传旧稿文件</strong>
          <span>TXT 或 Markdown；大于 1 MB 时自动分块处理</span>
          <input
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            disabled={busy !== null}
            id="manuscript-file"
            onChange={(event) => selectFile(event.target.files?.[0])}
            type="file"
          />
        </label>

        <div className="manuscript-file-row">
          <div>
            <span>当前文件</span>
            <strong>{file?.name ?? "尚未选择"}</strong>
          </div>
          <button
            className="btn btn-ghost"
            disabled={!file || busy !== null}
            onClick={recognize}
            type="button"
          >
            {busy === "recognize" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <FileText size={15} aria-hidden="true" />
            )}
            {busy === "recognize" ? "识别中" : "识别章节"}
          </button>
        </div>

        {error ? (
          <div className="model-notice danger" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {chunkProgress && chunkProgress.status !== "awaiting_confirmation" ? (
          <div className="model-notice" role="status">
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
            <span>
              已处理 {chunkProgress.processedChunks} / {chunkProgress.chunkCount} 个分块
            </span>
          </div>
        ) : null}

        {manuscriptImport?.status === "empty" ? (
          <section className="manuscript-empty-state">
            <FileText size={24} aria-hidden="true" />
            <h3>旧稿里没有可导入的正文</h3>
            <p>请检查文件内容或换一份 TXT、Markdown 文件。</p>
          </section>
        ) : null}

        {manuscriptImport && manuscriptImport.status !== "empty" ? (
          <section className="manuscript-chapter-report" aria-labelledby="manuscript-report-title">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">章节切分预览</span>
                <h3 id="manuscript-report-title">识别到 {chapters.length} 章</h3>
              </div>
              <span
                className={
                  manuscriptImport.status === "partial" ? "badge gold-badge" : "badge jade-badge"
                }
              >
                {manuscriptImport.status === "partial" ? "部分识别" : "保留原文"}
              </span>
            </div>

            {manuscriptImport.status === "partial" ? (
              <div className="model-notice warning" role="status">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>部分内容未识别到章节标题，正文已经保留，可以继续调整切分。</span>
              </div>
            ) : null}

            <div className="manuscript-chapter-list">
              {chapters.map((chapter, index) => (
                <article
                  className="manuscript-chapter-row"
                  data-testid="manuscript-chapter-row"
                  key={`${chapter.order}-${index}`}
                >
                  <div className="manuscript-chapter-head">
                    <span className="badge">第 {index + 1} 章</span>
                    <label className="auth-field manuscript-title-field">
                      <span>第 {index + 1} 章标题</span>
                      <input
                        aria-label={`第 ${index + 1} 章标题`}
                        disabled={busy !== null}
                        maxLength={200}
                        onChange={(event) => updateTitle(index, event.target.value)}
                        value={chapter.title}
                      />
                    </label>
                    <small>{chapter.wordCount.toLocaleString("zh-CN")} 字</small>
                  </div>
                  <pre className="manuscript-content-preview">{chapter.content}</pre>
                  <div className="manuscript-row-actions">
                    <button
                      className="btn btn-ghost"
                      disabled={busy !== null || chapter.content.length < 2}
                      onClick={() => beginSplit(index)}
                      type="button"
                    >
                      <Scissors size={14} aria-hidden="true" />
                      拆分第 {index + 1} 章
                    </button>
                    <button
                      className="btn btn-ghost"
                      disabled={busy !== null || index === chapters.length - 1}
                      onClick={() => mergeNext(index)}
                      type="button"
                    >
                      <GitMerge size={14} aria-hidden="true" />
                      合并第 {index + 1} 章与下一章
                    </button>
                  </div>
                  {splitIndex === index ? (
                    <div className="manuscript-split-editor">
                      <label>
                        <span>拆分位置</span>
                        <input
                          aria-label="拆分位置"
                          disabled={busy !== null}
                          max={Math.max(1, chapter.content.length - 1)}
                          min={1}
                          onChange={(event) => setSplitOffset(Number(event.target.value))}
                          type="range"
                          value={splitOffset}
                        />
                      </label>
                      <small>
                        前半 {splitOffset} 字 · 后半 {chapter.content.length - splitOffset} 字
                      </small>
                      <div>
                        <button
                          className="btn btn-ghost"
                          disabled={busy !== null}
                          onClick={() => setSplitIndex(null)}
                          type="button"
                        >
                          取消
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={busy !== null}
                          onClick={confirmSplit}
                          type="button"
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                          确认拆分
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="settings-confirm manuscript-confirm">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">确认开书</span>
              <h3>确认后创建作品和主创作线</h3>
            </div>
            <span className="badge">
              {chapters.length > 0 ? `${chapters.length} 章待导入` : "等待识别"}
            </span>
          </div>
          <div className="creation-field-grid">
            <label className="auth-field">
              <span>书名</span>
              <input
                disabled={busy !== null}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <label className="auth-field">
              <span>笔名</span>
              <input
                disabled={busy !== null}
                maxLength={50}
                onChange={(event) => setPenName(event.target.value)}
                placeholder="默认使用账号显示名"
                value={penName}
              />
            </label>
            <label className="auth-field">
              <span>题材</span>
              <select
                disabled={busy !== null}
                onChange={(event) => setGenre(event.target.value as WorkGenre)}
                value={genre}
              >
                <option value="xianxia">仙侠</option>
                <option value="history">历史</option>
                <option value="urban">都市</option>
              </select>
            </label>
            <label className="auth-field">
              <span>故事规模</span>
              <select
                disabled={busy !== null}
                onChange={(event) => setScaleTarget(event.target.value as WorkScaleTarget)}
                value={scaleTarget}
              >
                <option value="short">短篇 · 3 到 10 万字</option>
                <option value="medium">中篇 · 30 到 50 万字</option>
                <option value="long">长篇 · 100 到 300 万字</option>
                <option value="epic">超长篇 · 1000 万字以上</option>
              </select>
            </label>
            <label className="auth-field">
              <span>章节字数</span>
              <input
                disabled={busy !== null}
                max={10000}
                min={1000}
                onChange={(event) => setChapterLengthTarget(Number(event.target.value))}
                type="number"
                value={chapterLengthTarget}
              />
            </label>
          </div>
          <div className="model-form-actions">
            <button
              className="btn btn-primary"
              disabled={!canConfirm}
              onClick={confirmImport}
              type="button"
            >
              {busy === "confirm" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={15} aria-hidden="true" />
              )}
              {busy === "confirm" ? "正在导入" : "确认并创建作品"}
            </button>
          </div>
        </section>
      </section>

      <aside className="panel settings-import-summary manuscript-import-summary">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">导入说明</span>
            <h2>先看章节，再开始写</h2>
          </div>
          <FileUp size={18} aria-hidden="true" />
        </div>
        <ul className="creation-checklist">
          <li>识别后会按原顺序列出每一章</li>
          <li>可以改标题、拆分章节或合并相邻章节</li>
          <li>调整只改变章节边界，原文不会丢失</li>
          <li>默认不生成人物候选或已确认设定</li>
        </ul>
        {file ? (
          <div className="settings-import-source">
            <span>本次来源</span>
            <strong>{file.name}</strong>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function safeSplitOffset(content: string, requested: number): number {
  const bounded = Math.min(Math.max(1, requested), content.length - 1);
  const previous = content.charCodeAt(bounded - 1);
  const next = content.charCodeAt(bounded);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? bounded + 1
    : bounded;
}

function countWords(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function splitIntoChunks(text: string, targetLength: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + targetLength);
    if (
      end < text.length &&
      end > offset &&
      text.charCodeAt(end - 1) >= 0xd800 &&
      text.charCodeAt(end - 1) <= 0xdbff
    ) {
      end -= 1;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks.length ? chunks : [""];
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "请求失败，请重试。";
}
