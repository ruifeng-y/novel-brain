"use client";

import { ArrowLeft, LoaderCircle, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  apiErrorSchema,
  workResponseSchema,
  type WorkCreateRequest,
  type WorkGenre,
  type WorkScaleTarget,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";
import { ManuscriptImportPanel } from "./manuscript-import-panel";
import { SettingsImportPanel } from "./settings-import-panel";

type CreationMode = WorkCreateRequest["mode"] | "settings_import" | "manuscript_import";

const modeLabels: Array<{ value: CreationMode; label: string }> = [
  { value: "idea", label: "一句话想法" },
  { value: "blank", label: "空白作品" },
  { value: "template", label: "题材模板" },
  { value: "settings_import", label: "导入设定" },
  { value: "manuscript_import", label: "导入旧稿" },
];

export function NewProjectWizard() {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [mode, setMode] = useState<CreationMode>("idea");
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [penName, setPenName] = useState("");
  const [genre, setGenre] = useState<WorkGenre>("xianxia");
  const [scaleTarget, setScaleTarget] = useState<WorkScaleTarget>("long");
  const [chapterLengthTarget, setChapterLengthTarget] = useState(3000);
  const [templateKey, setTemplateKey] = useState<"xianxia">("xianxia");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createWork(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "settings_import" || mode === "manuscript_import") {
      return;
    }
    setBusy(true);
    setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const csrfToken = await getCsrfToken();
      const common = {
        title,
        ...(penName.trim() ? { penName: penName.trim() } : {}),
        genre,
        scaleTarget,
        chapterLengthTarget,
      };
      const payload: WorkCreateRequest =
        mode === "idea"
          ? { mode, idea, ...common }
          : mode === "template"
            ? { mode, templateKey, ...common }
            : { mode, ...common };
      const response = await fetch("/api/v1/works", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const work = workResponseSchema.parse(await response.json()).data;
      router.push(`/workspace/${work.id}/overview`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品创建失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">新建作品</p>
          <h1>把一个想法，长成一本书</h1>
          <p className="page-sub">先说你最想讲的那句话，剩下的可以边写边补。</p>
        </div>
        <Link className="btn btn-ghost" href="/workspace">
          <ArrowLeft size={15} aria-hidden="true" />
          返回工作台
        </Link>
      </section>

      <section className="mode-switch" aria-label="新建作品入口">
        {modeLabels.map((item) => (
          <button
            aria-pressed={mode === item.value}
            className={mode === item.value ? "active" : ""}
            key={item.value}
            onClick={() => {
              setMode(item.value);
              setError("");
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </section>

      {mode === "settings_import" ? (
        <SettingsImportPanel
          chapterLengthTarget={chapterLengthTarget}
          genre={genre}
          onCreated={(workId) => {
            router.push(`/workspace/${workId}/overview`);
            router.refresh();
          }}
          penName={penName}
          scaleTarget={scaleTarget}
          setChapterLengthTarget={setChapterLengthTarget}
          setGenre={setGenre}
          setPenName={setPenName}
          setScaleTarget={setScaleTarget}
          setTitle={setTitle}
          title={title}
        />
      ) : mode === "manuscript_import" ? (
        <ManuscriptImportPanel
          chapterLengthTarget={chapterLengthTarget}
          genre={genre}
          onCreated={(workId) => {
            router.push(`/workspace/${workId}/overview`);
            router.refresh();
          }}
          penName={penName}
          scaleTarget={scaleTarget}
          setChapterLengthTarget={setChapterLengthTarget}
          setGenre={setGenre}
          setPenName={setPenName}
          setScaleTarget={setScaleTarget}
          setTitle={setTitle}
          title={title}
        />
      ) : (
        <div className="creation-layout">
          <form className="panel creation-form" onSubmit={createWork}>
            <div className="panel-head">
              <div>
                <span className="panel-kicker">故事起点</span>
                <h2>先把方向定下来</h2>
              </div>
              <span className="badge">{modeLabels.find((item) => item.value === mode)?.label}</span>
            </div>

            <label className="auth-field">
              <span>书名</span>
              <input
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </label>

            {mode === "idea" ? (
              <label className="creation-field">
                <span>故事灵感</span>
                <textarea
                  minLength={10}
                  onChange={(event) => setIdea(event.target.value)}
                  placeholder="例如：一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。"
                  required
                  rows={6}
                  value={idea}
                />
              </label>
            ) : null}

            {mode === "template" ? (
              <label className="auth-field">
                <span>题材模板</span>
                <select
                  onChange={(event) => setTemplateKey(event.target.value as "xianxia")}
                  value={templateKey}
                >
                  <option value="xianxia">仙侠 · 修真文明</option>
                </select>
              </label>
            ) : null}

            <div className="creation-field-grid">
              <label className="auth-field">
                <span>笔名</span>
                <input
                  maxLength={50}
                  onChange={(event) => setPenName(event.target.value)}
                  placeholder="默认使用账号显示名"
                  value={penName}
                />
              </label>
              <label className="auth-field">
                <span>题材</span>
                <select
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
                  max={10000}
                  min={1000}
                  onChange={(event) => setChapterLengthTarget(Number(event.target.value))}
                  required
                  type="number"
                  value={chapterLengthTarget}
                />
              </label>
            </div>

            {error ? <div className="model-notice danger">{error}</div> : null}

            <div className="model-form-actions">
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <Plus size={15} aria-hidden="true" />
                )}
                创建作品并进入总览
              </button>
            </div>
          </form>

          <aside className="panel creation-preview">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">创建预览</span>
                <h2>{title || "你的下一本书"}</h2>
              </div>
              <Sparkles size={18} aria-hidden="true" />
            </div>
            <div className="creation-cover">
              <small>
                {genreLabel(genre)} · {scaleLabel(scaleTarget)}
              </small>
              <strong>{title || "故事蓝图"}</strong>
              <p>
                {mode === "idea"
                  ? idea || "先写下一句最想讲的故事。"
                  : mode === "blank"
                    ? "空白起步，不预设任何故事事实。"
                    : "仙侠模板 · 修真文明"}
              </p>
            </div>
            <ul className="creation-checklist">
              <li>创建后自动建立主创作线</li>
              <li>写入初始版本</li>
              <li>总览显示准备度和规模目标</li>
            </ul>
          </aside>
        </div>
      )}
    </>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "作品创建失败。";
}

function genreLabel(genre: WorkGenre): string {
  return genre === "xianxia" ? "仙侠" : genre === "history" ? "历史" : "都市";
}

function scaleLabel(scale: WorkScaleTarget): string {
  return scale === "short"
    ? "短篇"
    : scale === "medium"
      ? "中篇"
      : scale === "long"
        ? "长篇"
        : "超长篇";
}
