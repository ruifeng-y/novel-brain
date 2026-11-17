"use client";

import {
  BookOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  workListResponseSchema,
  type Work,
  type WorkGenre,
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
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [status, setStatus] = useState("");
  const [busyWorkId, setBusyWorkId] = useState("");
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
    [genre, query, status, view],
  );

  const load = useCallback(async () => loadPage(null, false), [loadPage]);

  async function restoreWork(work: Work) {
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

  async function purgeWork(work: Work) {
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
                  {genreLabels[work.genre]} · {scaleLabels[work.scaleTarget]} · 每章约{" "}
                  {work.chapterLengthTarget.toLocaleString("zh-CN")} 字
                </p>
                <small>最近编辑 {formatDate(work.updatedAt)}</small>
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
                        disabled={
                          busyWorkId === work.id ||
                          !work.purgeAfter ||
                          new Date(work.purgeAfter).getTime() > Date.now()
                        }
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
                    <Link className="text-btn small" href={`/workspace/${work.id}/work-settings`}>
                      管理
                    </Link>
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
