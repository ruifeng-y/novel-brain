"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  LoaderCircle,
  ScanSearch,
  ShieldAlert,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  apiErrorSchema,
  settingsImportResponseSchema,
  workResponseSchema,
  type ImportCandidate,
  type ImportConflict,
  type SettingsImport,
  type WorkGenre,
  type WorkScaleTarget,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

interface SettingsImportPanelProps {
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

const candidateTypeLabels: Record<ImportCandidate["type"], string> = {
  character: "人物",
  faction: "势力",
  map: "地图",
  power_system: "力量体系",
  golden_finger: "金手指",
};

export function SettingsImportPanel({
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
}: SettingsImportPanelProps) {
  const confirmKey = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [settingsImport, setSettingsImport] = useState<SettingsImport | null>(null);
  const [busy, setBusy] = useState<"scan" | "decision" | "confirm" | null>(null);
  const [error, setError] = useState("");

  const unresolvedConflicts =
    settingsImport?.report.conflicts.filter((conflict) => conflict.decision === "pending") ?? [];
  const canConfirm = Boolean(
    settingsImport?.canConfirm && unresolvedConflicts.length === 0 && title.trim(),
  );

  async function readFixture(file: File) {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (![".txt", ".md", ".markdown"].includes(extension)) {
      setSelectedFile(null);
      setSettingsImport(null);
      setError("请选择 TXT 或 Markdown 设定文件。");
      return;
    }
    setSelectedFile(file);
    setSettingsImport(null);
    setError("");
    setText(await file.text());
  }

  async function recognize() {
    setBusy("scan");
    setError("");
    setSettingsImport(null);
    confirmKey.current = null;
    try {
      const csrfToken = await getCsrfToken();
      let response: Response;
      if (selectedFile) {
        const body = new FormData();
        body.append("file", selectedFile);
        body.append("sourceName", selectedFile.name);
        response = await fetch("/api/v1/imports", {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body,
        });
      } else {
        response = await fetch("/api/v1/imports", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ text }),
        });
      }
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setSettingsImport(settingsImportResponseSchema.parse(await response.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设定识别失败，请重试。");
    } finally {
      setBusy(null);
    }
  }

  async function decideConflict(
    conflict: ImportConflict,
    decision: "use_primary" | "use_secondary",
  ) {
    if (!settingsImport) {
      return;
    }
    setBusy("decision");
    setError("");
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(
        `/api/v1/imports/${settingsImport.id}/conflicts/${conflict.id}/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setSettingsImport(settingsImportResponseSchema.parse(await response.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "冲突裁决失败，请重试。");
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    if (!settingsImport || !canConfirm) {
      return;
    }
    setBusy("confirm");
    setError("");
    confirmKey.current ??= crypto.randomUUID();
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/imports/${settingsImport.id}/confirm`, {
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
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const work = workResponseSchema.parse(await response.json()).data;
      onCreated(work.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品创建失败，请重试。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="creation-layout settings-import-layout">
      <section className="panel settings-import-panel">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">导入设定</span>
            <h2>把人物、势力、地图和体系带进来</h2>
          </div>
          <span className="badge">部分或完整设定</span>
        </div>
        <div className="settings-note">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>系统先识别候选，不会直接覆盖现有作品。你可以只导入已经写好的部分。</span>
        </div>

        <fieldset className="settings-import-fields" disabled={busy !== null}>
          <label className="settings-upload" htmlFor="settings-file">
            <FileUp size={22} aria-hidden="true" />
            <strong>上传设定文件</strong>
            <span>TXT 或 Markdown，最大 256 KB</span>
            <input
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              id="settings-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void readFixture(file);
                }
              }}
              type="file"
            />
          </label>
          <label className="auth-field">
            <span>粘贴设定</span>
            <textarea
              onChange={(event) => {
                setText(event.target.value);
                setSelectedFile(null);
                setSettingsImport(null);
                confirmKey.current = null;
              }}
              placeholder={
                "例如：\n人物：沈砚，外门杂役，左臂骨折。\n势力：太玄门、血河宗。\n地图：人界 → 东境 → 忘川渡。"
              }
              rows={7}
              value={text}
            />
          </label>
        </fieldset>

        {error ? (
          <div className="model-notice danger" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="model-form-actions">
          <button
            className="btn btn-ghost"
            disabled={busy !== null || !text.trim()}
            onClick={recognize}
            type="button"
          >
            {busy === "scan" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <ScanSearch size={15} aria-hidden="true" />
            )}
            {busy === "scan" ? "识别中" : "开始识别"}
          </button>
        </div>

        {settingsImport ? (
          <ImportReport busy={busy} onDecide={decideConflict} settingsImport={settingsImport} />
        ) : null}

        <section className="settings-confirm">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">确认开书</span>
              <h3>确认后创建一部新作品</h3>
            </div>
            <span className="badge">{settingsImport ? "识别结果已保留" : "等待识别"}</span>
          </div>
          <div className="creation-field-grid">
            <label className="auth-field">
              <span>书名</span>
              <input
                disabled={busy !== null}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                required
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
              disabled={!canConfirm || busy !== null}
              onClick={confirmImport}
              type="button"
            >
              {busy === "confirm" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : unresolvedConflicts.length > 0 ? (
                <ShieldAlert size={15} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={15} aria-hidden="true" />
              )}
              {unresolvedConflicts.length > 0
                ? `先裁决 ${unresolvedConflicts.length} 条冲突`
                : "确认并创建作品"}
            </button>
          </div>
        </section>
      </section>

      <aside className="panel settings-import-summary">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">导入说明</span>
            <h2>识别后再决定</h2>
          </div>
          <FileUp size={18} aria-hidden="true" />
        </div>
        <ul className="creation-checklist">
          <li>人物、势力、地图、力量体系和金手指会分别列出</li>
          <li>每条候选都保留原文和识别把握程度</li>
          <li>冲突未裁决前不能创建作品</li>
          <li>确认后建立新作品和主创作线，不覆盖同名作品</li>
        </ul>
        {settingsImport?.sourceName ? (
          <div className="settings-import-source">
            <span>本次来源</span>
            <strong>{settingsImport.sourceName}</strong>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ImportReport({
  settingsImport,
  busy,
  onDecide,
}: {
  settingsImport: SettingsImport;
  busy: "scan" | "decision" | "confirm" | null;
  onDecide: (conflict: ImportConflict, decision: "use_primary" | "use_secondary") => void;
}) {
  const { accepted, pending, conflicts, unparsed } = settingsImport.report;
  return (
    <section className="settings-import-report" aria-labelledby="settings-import-report-title">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">识别报告</span>
          <h3 id="settings-import-report-title">识别结果</h3>
        </div>
        <span className="badge jade-badge">
          {settingsImport.canConfirm ? "可以确认" : "等待裁决"}
        </span>
      </div>

      <div className="settings-report-stats">
        <strong>已接受 {accepted.length}</strong>
        <strong>待确认 {pending.length}</strong>
        <strong>冲突 {conflicts.length}</strong>
        <strong>无法解析 {unparsed.length}</strong>
      </div>

      {accepted.length > 0 ? <CandidateGroup title="已接受" candidates={accepted} /> : null}
      {pending.length > 0 ? <CandidateGroup title="待确认" candidates={pending} /> : null}

      {conflicts.length > 0 ? (
        <div className="settings-conflict-list">
          <h4>需要裁决</h4>
          {conflicts.map((conflict, index) => (
            <article className="settings-conflict-card" key={conflict.id}>
              <div className="settings-conflict-head">
                <span className="badge alert-badge">冲突 {index + 1}</span>
                <strong>{conflict.summary}</strong>
              </div>
              <div className="settings-conflict-options">
                {conflict.candidates.map((candidate, candidateIndex) => (
                  <div key={candidate.id}>
                    <span>{candidateIndex === 0 ? "第一条" : "第二条"}</span>
                    <strong>{candidate.summary || candidate.name}</strong>
                    <p>{candidate.sourceExcerpt}</p>
                  </div>
                ))}
              </div>
              {conflict.decision === "pending" ? (
                <div className="settings-conflict-actions">
                  <button
                    className="btn btn-ghost"
                    disabled={busy !== null}
                    onClick={() => onDecide(conflict, "use_primary")}
                    type="button"
                  >
                    采用第一条
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busy !== null}
                    onClick={() => onDecide(conflict, "use_secondary")}
                    type="button"
                  >
                    采用第二条
                  </button>
                </div>
              ) : (
                <div className="settings-conflict-resolved">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  已裁决 · {conflict.decision === "use_primary" ? "采用第一条" : "采用第二条"}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {unparsed.length > 0 ? (
        <div className="settings-unparsed">
          <h4>无法解析</h4>
          {unparsed.map((item) => (
            <div key={`${item.sourceExcerpt}-${item.reason}`}>
              <p>{item.sourceExcerpt}</p>
              <span>{item.reason}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CandidateGroup({ title, candidates }: { title: string; candidates: ImportCandidate[] }) {
  return (
    <div className="settings-candidate-group">
      <h4>{title}</h4>
      <div className="settings-candidate-list">
        {candidates.map((candidate) => (
          <article className="settings-candidate" key={candidate.id}>
            <div>
              <span className="badge">{candidateTypeLabels[candidate.type]}</span>
              <strong>{candidate.name}</strong>
              <small>{Math.round(candidate.confidence * 100)}% 把握</small>
            </div>
            {candidate.summary ? <p>{candidate.summary}</p> : null}
            <blockquote>{candidate.sourceExcerpt}</blockquote>
          </article>
        ))}
      </div>
    </div>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "请求失败，请重试。";
}
