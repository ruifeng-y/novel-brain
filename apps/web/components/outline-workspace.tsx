"use client";

import {
  BookMarked,
  Check,
  Circle,
  FilePlus2,
  FileText,
  LoaderCircle,
  PenLine,
  Plus,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiErrorSchema,
  chapterReadinessResponseSchema,
  chapterWorkspaceListResponseSchema,
  chapterWorkspaceResponseSchema,
  workResponseSchema,
  type ChapterReadiness,
  type ChapterWorkspace,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

interface BriefForm {
  order: string;
  title: string;
  goal: string;
  pov: string;
  location: string;
  sceneBeats: string;
  requiredFacts: string;
}

const initialForm: BriefForm = {
  order: "1",
  title: "",
  goal: "",
  pov: "",
  location: "",
  sceneBeats: "",
  requiredFacts: "",
};

const chapterStatusLabels: Record<ChapterWorkspace["status"], string> = {
  planned: "已规划",
  writing: "写作中",
  waiting_review: "待审",
  changes_requested: "要求修改",
  approved: "已批准",
  locked: "已锁定",
  published: "已发布",
  rejected: "已驳回",
};

export function OutlineWorkspace({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [chapters, setChapters] = useState<ChapterWorkspace[]>([]);
  const [outlineReadiness, setOutlineReadiness] = useState<ChapterReadiness | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<BriefForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse, "作品加载失败。"));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const branchPath = `/api/v1/works/${workId}/branches/${workData.mainBranch.id}`;
      const [chaptersResponse, readinessResponse] = await Promise.all([
        fetch(`${branchPath}/chapters`, { cache: "no-store" }),
        fetch(`${branchPath}/outline/readiness`, { cache: "no-store" }),
      ]);
      if (!chaptersResponse.ok) {
        throw new Error(await readError(chaptersResponse, "章纲加载失败。"));
      }
      if (!readinessResponse.ok) {
        throw new Error(await readError(readinessResponse, "准备度加载失败。"));
      }
      const chapterData = chapterWorkspaceListResponseSchema.parse(
        await chaptersResponse.json(),
      ).data;
      setWork(workData);
      setChapters(chapterData);
      setOutlineReadiness(
        chapterReadinessResponseSchema.parse(await readinessResponse.json()).data,
      );
      setSelectedId((current) =>
        current && chapterData.some((chapter) => chapter.id === current)
          ? current
          : (chapterData[0]?.id ?? null),
      );
      setForm((current) => ({
        ...current,
        order: String(nextChapterOrder(chapterData)),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "章纲加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedId) ?? null,
    [chapters, selectedId],
  );
  const formComplete = validBriefForm(form);

  async function createChapter() {
    if (!work || !formComplete) {
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      const chapter = await mutateChapter(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`,
        "POST",
        {
          number: Number(form.order),
          title: form.title.trim(),
          brief: briefPayload(form),
        },
        "章纲创建失败。",
      );
      setChapters((current) =>
        [...current, chapter].sort((left, right) => left.number - right.number),
      );
      setSelectedId(chapter.id);
      setForm({
        ...initialForm,
        order: String(chapter.number + 1),
      });
      const readiness = await fetchOutlineReadiness(work);
      setOutlineReadiness(readiness);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "章纲创建失败。");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载大纲工作台">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载大纲工作台
      </section>
    );
  }

  if (error || !work) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "大纲工作台加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="page-head outline-page-head">
        <div>
          <p className="eyebrow">章节规划</p>
          <h1>大纲工作台</h1>
          <p className="page-sub">
            {work.title} · 先写清本章目标、POV、地点、场景节拍和必用事实，再进入写作台。
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${work.id}/settings`}>
            <BookMarked size={15} aria-hidden="true" />
            检查已确认设定
          </Link>
        </div>
      </section>

      {actionError ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className="outline-workspace-grid">
        <aside className="panel outline-chapter-index" aria-labelledby="outline-chapter-list-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">主创作线</span>
              <h2 id="outline-chapter-list-title">章节列表</h2>
            </div>
            <span className="badge">{chapters.length} 章</span>
          </div>
          {chapters.length === 0 ? (
            <div className="outline-index-empty">
              <FileText size={20} aria-hidden="true" />
              <p>第一篇章纲会出现在这里。</p>
            </div>
          ) : (
            <div className="outline-chapter-list">
              {chapters.map((chapter) => (
                <button
                  className={`outline-chapter-item${chapter.id === selectedId ? " active" : ""}`}
                  key={chapter.id}
                  onClick={() => setSelectedId(chapter.id)}
                  type="button"
                >
                  <span>{String(chapter.number).padStart(2, "0")}</span>
                  <div>
                    <strong>{chapter.title}</strong>
                    <small>{chapterStatusLabels[chapter.status]}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="outline-main-column">
          {selected ? (
            <section className="panel outline-brief-detail" aria-labelledby="outline-detail-title">
              <div className="outline-detail-head">
                <div>
                  <span className="panel-kicker">第 {selected.number} 章</span>
                  <h2 id="outline-detail-title">{selected.title}</h2>
                </div>
                <span className={`badge chapter-status-${selected.status}`}>
                  {chapterStatusLabels[selected.status]}
                </span>
              </div>
              <div className="outline-detail-meta">
                <span>POV · {selected.brief?.pov}</span>
                <span>地点 · {selected.brief?.location}</span>
                <span>{selected.wordCount.toLocaleString("zh-CN")} 字</span>
              </div>
              <div className="outline-brief-section">
                <span>本章目标</span>
                <p>{selected.brief?.goal}</p>
              </div>
              <div className="outline-brief-section">
                <span>场景节拍</span>
                <ol className="outline-beat-list">
                  {selected.brief?.sceneBeats.map((beat, index) => (
                    <li key={`${selected.id}-beat-${index}`}>
                      <small>{String(index + 1).padStart(2, "0")}</small>
                      <p>{beat}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="outline-brief-section">
                <span>必须遵守</span>
                <div className="outline-fact-chips">
                  {selected.brief?.requiredFacts.map((fact) => (
                    <span key={`${selected.id}-${fact}`}>{fact}</span>
                  ))}
                </div>
              </div>
              <div className="outline-detail-actions">
                <Link
                  className="btn btn-primary"
                  href={`/workspace/${work.id}/write?chapterId=${selected.id}`}
                >
                  <PenLine size={15} aria-hidden="true" />
                  打开写作台
                </Link>
              </div>
            </section>
          ) : (
            <section className="panel outline-empty-state" aria-labelledby="outline-empty-title">
              <span className="empty-icon">
                <FilePlus2 size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 id="outline-empty-title">还没有章纲</h2>
                <p>先定义本章要完成什么，再让场景节拍和必用事实把边界钉住。</p>
              </div>
            </section>
          )}

          <form
            className="panel outline-brief-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createChapter();
            }}
          >
            <div className="panel-head">
              <div>
                <span className="panel-kicker">新章纲</span>
                <h2>把这一章写清楚</h2>
              </div>
              <span className="badge">必填</span>
            </div>
            <div className="outline-form-grid">
              <label>
                <span>章节序号</span>
                <input
                  min="1"
                  onChange={(event) => updateForm("order", event.target.value)}
                  required
                  type="number"
                  value={form.order}
                />
              </label>
              <label>
                <span>章节标题</span>
                <input
                  maxLength={200}
                  onChange={(event) => updateForm("title", event.target.value)}
                  required
                  value={form.title}
                />
              </label>
              <label className="outline-form-wide">
                <span>章目标</span>
                <textarea
                  onChange={(event) => updateForm("goal", event.target.value)}
                  required
                  rows={3}
                  value={form.goal}
                />
              </label>
              <label>
                <span>POV</span>
                <input
                  maxLength={200}
                  onChange={(event) => updateForm("pov", event.target.value)}
                  required
                  value={form.pov}
                />
              </label>
              <label>
                <span>地点</span>
                <input
                  maxLength={200}
                  onChange={(event) => updateForm("location", event.target.value)}
                  required
                  value={form.location}
                />
              </label>
              <label className="outline-form-wide">
                <span>场景节拍（一行一个）</span>
                <textarea
                  onChange={(event) => updateForm("sceneBeats", event.target.value)}
                  required
                  rows={5}
                  value={form.sceneBeats}
                />
              </label>
              <label className="outline-form-wide">
                <span>必用事实（一行一个）</span>
                <textarea
                  onChange={(event) => updateForm("requiredFacts", event.target.value)}
                  required
                  rows={3}
                  value={form.requiredFacts}
                />
              </label>
            </div>
            <div className="outline-form-actions">
              <span>
                {formComplete ? "信息完整，可以创建章纲。" : "填写全部必填项后才能创建。"}
              </span>
              <button className="btn btn-primary" disabled={!formComplete || busy} type="submit">
                {busy ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <Plus size={15} aria-hidden="true" />
                )}
                创建章纲
              </button>
            </div>
          </form>
        </main>

        <aside className="panel outline-readiness-panel" aria-labelledby="outline-readiness-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">写前检查</span>
              <h2 id="outline-readiness-title">生成准备度</h2>
            </div>
            <span className={`badge outline-readiness-${outlineReadiness?.status ?? "not_ready"}`}>
              {readinessLabel(outlineReadiness)}
            </span>
          </div>
          <p className="outline-readiness-note">
            故事圣经、已确认设定和完整章纲都就绪后，才能进入稳定写作。
          </p>
          <div className="outline-readiness-list">
            {(selected?.readiness.items ?? outlineReadiness?.items ?? []).map((item) => (
              <div className={`outline-readiness-item${item.ready ? " ready" : ""}`} key={item.key}>
                <span>
                  {item.ready ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Circle size={11} aria-hidden="true" />
                  )}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <small>
                    {item.ready
                      ? item.key === "brief"
                        ? "章纲已完整"
                        : "已就绪"
                      : item.missing.join("；")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );

  function updateForm(field: keyof BriefForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }
}

function validBriefForm(form: BriefForm): boolean {
  return (
    Number.isInteger(Number(form.order)) &&
    Number(form.order) > 0 &&
    form.title.trim().length > 0 &&
    form.goal.trim().length > 0 &&
    form.pov.trim().length > 0 &&
    form.location.trim().length > 0 &&
    splitLines(form.sceneBeats).length > 0 &&
    splitLines(form.requiredFacts).length > 0
  );
}

function briefPayload(form: BriefForm) {
  return {
    goal: form.goal.trim(),
    pov: form.pov.trim(),
    location: form.location.trim(),
    sceneBeats: splitLines(form.sceneBeats),
    requiredFacts: splitLines(form.requiredFacts),
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function nextChapterOrder(chapters: ChapterWorkspace[]): number {
  return Math.max(0, ...chapters.map((chapter) => chapter.number)) + 1;
}

function readinessLabel(readiness: ChapterReadiness | null): string {
  if (readiness?.status === "ready") {
    return "已就绪";
  }
  if (readiness?.status === "partial") {
    return "部分就绪";
  }
  return "未就绪";
}

async function fetchOutlineReadiness(work: WorkOverview): Promise<ChapterReadiness> {
  const response = await fetch(
    `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/readiness`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "准备度加载失败。"));
  }
  return chapterReadinessResponseSchema.parse(await response.json()).data;
}

async function mutateChapter(
  path: string,
  method: "POST",
  body: Record<string, unknown>,
  fallback: string,
): Promise<ChapterWorkspace> {
  const response = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": await getCsrfToken(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return chapterWorkspaceResponseSchema.parse(await response.json()).data;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
