"use client";

import { ArrowLeft, LoaderCircle, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  apiErrorSchema,
  genrePackListResponseSchema,
  workResponseSchema,
  type GenrePackDefinition,
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
  const [templateKey, setTemplateKey] = useState<WorkGenre>("xianxia");
  const [packs, setPacks] = useState<GenrePackDefinition[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/genre-packs", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response, "题材包加载失败。"));
        }
        return genrePackListResponseSchema.parse(await response.json()).data;
      })
      .then((items) => {
        if (!cancelled) {
          setPacks(latestGenrePacks(items));
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setPacksError(caught instanceof Error ? caught.message : "题材包加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPacksLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createWork(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "settings_import" || mode === "manuscript_import") {
      return;
    }
    setBusy(true);
    setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      if (mode === "template" && packs.length === 0) {
        throw new Error(packsError || "题材包尚未加载完成，请稍后重试。");
      }
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
                  disabled={packsLoading || packs.length === 0}
                  onChange={(event) => {
                    const next = event.target.value as WorkGenre;
                    setTemplateKey(next);
                    setGenre(next);
                  }}
                  value={templateKey}
                >
                  {packs.length === 0 ? (
                    <option value={templateKey}>
                      {packsLoading ? "题材包加载中…" : "题材包不可用"}
                    </option>
                  ) : (
                    packs.map((pack) => (
                      <option key={pack.key} value={pack.key}>
                        {pack.label} · {String(pack.fields.world ?? "")}
                      </option>
                    ))
                  )}
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

            {packsError ? <div className="model-notice danger">{packsError}</div> : null}
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
                    : templatePreview(packs, templateKey)}
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

async function readError(response: Response, fallback = "作品创建失败。"): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}

function genreLabel(genre: WorkGenre): string {
  return genre === "xianxia" ? "仙侠" : genre === "history" ? "历史" : "都市";
}

function latestGenrePacks(packs: GenrePackDefinition[]): GenrePackDefinition[] {
  const latest = new Map<WorkGenre, GenrePackDefinition>();
  for (const pack of packs) {
    if (!latest.has(pack.key) || latest.get(pack.key)!.version < pack.version) {
      latest.set(pack.key, pack);
    }
  }
  return ["xianxia", "history", "urban"].flatMap((key) => {
    const pack = latest.get(key as WorkGenre);
    return pack ? [pack] : [];
  });
}

function templatePreview(packs: GenrePackDefinition[], templateKey: WorkGenre): string {
  const pack = packs.find((candidate) => candidate.key === templateKey);
  return pack ? `${pack.label} · ${String(pack.fields.world ?? "")}` : "题材包加载中…";
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
