"use client";

import {
  Archive,
  BookOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiErrorSchema,
  workListResponseSchema,
  workResponseSchema,
  workTrashResponseSchema,
  type WorkGenre,
  type WorkListItem,
  type WorkStatus,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

const genreLabels: Record<WorkGenre, string> = {
  xianxia: "仙侠",
  history: "历史",
  urban: "都市",
};

const statusLabels: Record<WorkStatus, string> = {
  draft: "筹备中",
  preparing: "筹备中",
  serializing: "连载中",
  paused: "暂停",
  completed: "已完本",
  archived: "已归档",
};

const scaleLabels = {
  short: "短篇",
  medium: "中篇",
  long: "长篇",
  epic: "超长篇",
} as const;

export function WorksDashboard({ displayName }: { displayName: string }) {
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [status, setStatus] = useState("");
  const [words, setWords] = useState("");
  const [recent, setRecent] = useState("");
  const [busyWorkId, setBusyWorkId] = useState("");
  const [manageWork, setManageWork] = useState<WorkListItem | null>(null);
  const manageDialogRef = useRef<HTMLElement | null>(null);
  const manageCloseRef = useRef<HTMLButtonElement | null>(null);
  const manageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"active" | "archived" | "trash">(
    searchParams.get("trash") === "true" ? "trash" : "active",
  );

  const loadPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError("");
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (query.trim()) {
          params.set("q", query.trim());
        }
        if (genre) {
          params.set("genre", genre);
        }
        if (view === "archived") {
          params.set("status", "archived");
        } else if (view === "active" && status) {
          params.set("status", status);
        }
        if (words) {
          params.set("words", words);
        }
        if (recent) {
          params.set("recent", recent);
        }
        if (view === "trash") {
          params.set("trash", "true");
        }
        if (cursor) {
          params.set("cursor", cursor);
        }
        const response = await fetch(`/api/v1/works?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        const page = workListResponseSchema.parse(await response.json());
        setWorks((current) => (append ? [...current, ...page.data] : page.data));
        setNextCursor(page.meta.nextCursor);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "作品库加载失败。");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [genre, query, recent, status, view, words],
  );

  const load = useCallback(async () => loadPage(null, false), [loadPage]);

  const closeManage = useCallback(() => {
    setManageWork(null);
    window.requestAnimationFrame(() => manageTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!manageWork) return;
    manageCloseRef.current?.focus();
    const dialog = manageDialogRef.current;
    if (!dialog) return;
    const modal = dialog;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeManage();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...modal.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeManage, manageWork]);

  async function restoreWork(work: WorkListItem) {
    setBusyWorkId(work.id);
    setError("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(
        `/api/v1/works/${work.id}/${work.deletedAt ? "trash/restore" : "restore"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ version: work.version }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品恢复失败。");
    } finally {
      setBusyWorkId("");
    }
  }

  async function archiveWork(work: WorkListItem) {
    setBusyWorkId(work.id);
    setError("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      workResponseSchema.parse(await response.json());
      closeManage();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品归档失败。");
    } finally {
      setBusyWorkId("");
    }
  }

  async function trashWork(work: WorkListItem) {
    if (!window.confirm(`移入回收站《${work.title}》？30 天内仍可恢复。`)) return;
    setBusyWorkId(work.id);
    setError("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}/trash`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      workTrashResponseSchema.parse(await response.json());
      closeManage();
      setView("trash");
      router.push("/workspace?trash=true");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移入回收站失败。");
    } finally {
      setBusyWorkId("");
    }
  }

  async function purgeWork(work: WorkListItem) {
    if (!window.confirm(`永久删除《${work.title}》？此操作不可恢复。`)) return;
    setBusyWorkId(work.id);
    setError("");
    try {
      const token = await getCsrfToken();
      const response = await fetch(`/api/v1/works/${work.id}/purge`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ version: work.version }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "永久删除失败。");
    } finally {
      setBusyWorkId("");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">个人工作室</p>
          <h1>工作台</h1>
          <p className="page-sub">{displayName}，今天想把故事推进到哪里？</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={load} type="button">
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </button>
          <Link className="btn btn-primary" href="/workspace/new-project">
            <Plus size={15} aria-hidden="true" />
            新建作品
          </Link>
        </div>
      </section>

      <section className="works-toolbar" aria-label="作品筛选">
        <div className="works-view-tabs" aria-label="作品视图">
          <button
            aria-pressed={view === "active"}
            className={view === "active" ? "active" : ""}
            onClick={() => {
              setStatus("");
              setView("active");
            }}
            type="button"
          >
            作品
          </button>
          <button
            aria-pressed={view === "archived"}
            className={view === "archived" ? "active" : ""}
            onClick={() => {
              setStatus("");
              setView("archived");
            }}
            type="button"
          >
            已归档
          </button>
          <button
            aria-pressed={view === "trash"}
            className={view === "trash" ? "active" : ""}
            onClick={() => {
              setStatus("");
              setView("trash");
            }}
            type="button"
          >
            回收站
          </button>
        </div>
        <label className="works-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">搜索作品</span>
          <input
            aria-label="搜索作品"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索书名或笔名"
            value={query}
          />
        </label>
        <label>
          <span className="sr-only">题材筛选</span>
          <select
            aria-label="题材筛选"
            onChange={(event) => setGenre(event.target.value)}
            value={genre}
          >
            <option value="">全部题材</option>
            <option value="xianxia">仙侠</option>
            <option value="history">历史</option>
            <option value="urban">都市</option>
          </select>
        </label>
        <label>
          <span className="sr-only">状态筛选</span>
          <select
            aria-label="状态筛选"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">全部状态</option>
            <option value="preparing">筹备中</option>
            <option value="serializing">连载中</option>
            <option value="paused">暂停</option>
            <option value="completed">已完本</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <label>
          <span className="sr-only">字数筛选</span>
          <select
            aria-label="字数筛选"
            onChange={(event) => setWords(event.target.value)}
            value={words}
          >
            <option value="">全部字数</option>
            <option value="lt1m">100 万字以下</option>
            <option value="1m-2m">100–200 万字</option>
            <option value="gt2m">200 万字以上</option>
          </select>
        </label>
        <label>
          <span className="sr-only">最近编辑</span>
          <select
            aria-label="最近编辑"
            onChange={(event) => setRecent(event.target.value)}
            value={recent}
          >
            <option value="">全部时间</option>
            <option value="day">24 小时内</option>
            <option value="week">7 天内</option>
            <option value="month">30 天内</option>
          </select>
        </label>
      </section>

      {error ? (
        <div className="works-error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <span>{error}</span>
          <button className="text-btn small" onClick={load} type="button">
            重试
          </button>
        </div>
      ) : null}

      {loading ? (
        <section className="panel works-loading" aria-label="正在加载作品">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          正在加载作品
        </section>
      ) : works.length === 0 && !error ? (
        <section className="panel workspace-empty" aria-labelledby="workspace-empty-title">
          <div className="empty-icon" aria-hidden="true">
            <BookOpen size={24} />
          </div>
          <div>
            <h2 id="workspace-empty-title">还没有作品</h2>
            <p>从一句话想法开始，先建一个故事蓝图。</p>
          </div>
          <Link className="btn btn-primary" href="/workspace/new-project">
            新建作品
          </Link>
        </section>
      ) : (
        <section className="project-grid" aria-label="我的作品">
          {works.map((work) => (
            <article className="project-card" key={work.id}>
              <div className={`project-cover project-cover-${work.genre}`}>
                {work.coverImageUrl ? (
                  <img alt="" src={work.coverImageUrl} />
                ) : (
                  <>
                    <span>{genreLabels[work.genre]}</span>
                    <strong>{work.title.slice(0, 8)}</strong>
                  </>
                )}
              </div>
              <div className="project-info">
                <div className="project-title-row">
                  <h2>{work.title}</h2>
                  <span className={`badge work-status-${work.status}`}>
                    {statusLabels[work.status]}
                  </span>
                </div>
                <p>
                  主线 · {genreLabels[work.genre]} · {formatWordCount(work.metrics.totalWordCount)}{" "}
                  · {scaleLabels[work.scaleTarget]}
                </p>
                <div
                  aria-label={`已完成 ${work.metrics.progress.writtenChapters} / ${work.metrics.progress.plannedChapters} 章`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={work.metrics.progress.percent}
                  className="project-progress"
                  role="progressbar"
                >
                  <span style={{ width: `${work.metrics.progress.percent}%` }} />
                </div>
                <time dateTime={work.metrics.lastEditedAt}>
                  最近编辑 {formatDate(work.metrics.lastEditedAt)} · 已完成{" "}
                  {work.metrics.progress.writtenChapters} / {work.metrics.progress.plannedChapters}{" "}
                  章
                </time>
                <div className="project-metrics">
                  <span>质量 {work.metrics.qualityScore ?? "--"}</span>
                  <span>未回收伏笔 {work.metrics.unrecoveredForeshadowCount}</span>
                </div>
                {work.deletedAt ? (
                  <small>
                    {work.canPurge
                      ? "已完成导出，可永久删除"
                      : work.exportReady
                        ? "导出已完成，保留期结束后可永久删除"
                        : "永久删除前必须先完成导出"}
                  </small>
                ) : null}
                <div className="project-actions">
                  {work.deletedAt ? (
                    <>
                      <button
                        className="text-btn small"
                        disabled={busyWorkId === work.id}
                        onClick={() => restoreWork(work)}
                        type="button"
                      >
                        {busyWorkId === work.id ? (
                          <LoaderCircle className="spin" size={13} aria-hidden="true" />
                        ) : (
                          <RotateCcw size={13} aria-hidden="true" />
                        )}
                        恢复
                      </button>
                      <button
                        className="text-btn small danger-text"
                        disabled={busyWorkId === work.id || !work.canPurge}
                        onClick={() => purgeWork(work)}
                        type="button"
                      >
                        永久删除
                      </button>
                    </>
                  ) : work.status === "archived" ? (
                    <button
                      className="text-btn small"
                      disabled={busyWorkId === work.id}
                      onClick={() => restoreWork(work)}
                      type="button"
                    >
                      {busyWorkId === work.id ? (
                        <LoaderCircle className="spin" size={13} aria-hidden="true" />
                      ) : (
                        <RotateCcw size={13} aria-hidden="true" />
                      )}
                      恢复
                    </button>
                  ) : (
                    <Link className="text-btn small" href={`/workspace/${work.id}/overview`}>
                      打开总览
                    </Link>
                  )}
                  {work.deletedAt ? null : (
                    <button
                      className="text-btn small"
                      onClick={(event) => {
                        manageTriggerRef.current = event.currentTarget;
                        setManageWork(work);
                      }}
                      type="button"
                    >
                      管理
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {nextCursor ? (
            <button
              className="btn btn-ghost works-load-more"
              disabled={loadingMore}
              onClick={() => loadPage(nextCursor, true)}
              type="button"
            >
              {loadingMore ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
              加载更多作品
            </button>
          ) : null}
        </section>
      )}

      {manageWork ? (
        <div className="modal-backdrop dashboard-action-backdrop" role="presentation">
          <section
            aria-labelledby="works-dashboard-manage-title"
            aria-modal="true"
            className="modal dashboard-action-dialog"
            ref={manageDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="modal-head">
              <div>
                <span className="panel-kicker">作品操作</span>
                <h2 id="works-dashboard-manage-title">{manageWork.title}</h2>
              </div>
              <button
                aria-label="关闭"
                className="text-btn small"
                onClick={closeManage}
                ref={manageCloseRef}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="work-action-list">
                <Link className="btn btn-ghost" href={`/workspace/${manageWork.id}/work-settings`}>
                  作品设置
                </Link>
                {manageWork.status === "archived" ? null : (
                  <>
                    <button
                      className="btn btn-ghost"
                      disabled={busyWorkId === manageWork.id}
                      onClick={() => archiveWork(manageWork)}
                      type="button"
                    >
                      {busyWorkId === manageWork.id ? (
                        <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <Archive size={15} aria-hidden="true" />
                      )}
                      归档
                    </button>
                    <button
                      className="btn btn-ghost danger-text"
                      disabled={busyWorkId === manageWork.id}
                      onClick={() => trashWork(manageWork)}
                      type="button"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      移入回收站
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "作品库加载失败。";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatWordCount(value: number): string {
  if (value >= 10_000) {
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / 10_000)} 万字`;
  }
  return `${value.toLocaleString("zh-CN")} 字`;
}
