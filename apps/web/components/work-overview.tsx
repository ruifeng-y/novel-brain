"use client";

import {
  ArrowLeft,
  BookMarked,
  Check,
  Circle,
  GitBranch,
  LoaderCircle,
  PenLine,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  generationReadinessResponseSchema,
  workResponseSchema,
  type GenerationReadiness,
  type Work,
  type WorkOverview as WorkOverviewData,
} from "@novel-brain/contracts";

import { ReadinessRemediation } from "./readiness-remediation";

const statusLabels: Record<Work["status"], string> = {
  draft: "草稿",
  preparing: "筹备中",
  serializing: "连载中",
  paused: "暂停",
  completed: "已完本",
  archived: "已归档",
};

const scaleLabels: Record<Work["scaleTarget"], string> = {
  short: "短篇",
  medium: "中篇",
  long: "长篇",
  epic: "超长篇",
};

const genreLabels: Record<Work["genre"], string> = {
  xianxia: "仙侠",
  history: "历史",
  urban: "都市",
};

export function WorkOverview({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverviewData | null>(null);
  const [readiness, setReadiness] = useState<GenerationReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const workData = workResponseSchema.parse(await response.json()).data;
      const readinessResponse = await fetch(
        `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/readiness`,
        { cache: "no-store" },
      );
      if (!readinessResponse.ok) {
        throw new Error(await readError(readinessResponse));
      }
      setWork(workData);
      setReadiness(generationReadinessResponseSchema.parse(await readinessResponse.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品总览加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载作品总览">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载作品总览
      </section>
    );
  }

  if (error || !work) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "作品总览加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">作品总览</p>
          <div className="title-with-badge">
            <h1>{work.title}</h1>
            <span className={`badge work-status-${work.status}`}>{statusLabels[work.status]}</span>
            <span className="badge">
              {genreLabels[work.genre]} · {scaleLabels[work.scaleTarget]}
            </span>
          </div>
          <p className="page-sub">
            {work.penName} · 每章约 {work.chapterLengthTarget.toLocaleString("zh-CN")} 字
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href="/workspace">
            <ArrowLeft size={15} aria-hidden="true" />
            返回工作台
          </Link>
          {work.status === "archived" ? (
            <button className="btn btn-primary" disabled type="button">
              <PenLine size={15} aria-hidden="true" />
              继续写作
            </button>
          ) : (
            <Link className="btn btn-primary" href={`/workspace/${workId}/write`}>
              <PenLine size={15} aria-hidden="true" />
              继续写作
            </Link>
          )}
        </div>
      </section>

      {work.status === "archived" ? (
        <div className="model-notice warning">作品已归档，当前为只读状态。</div>
      ) : null}

      <article className="overview-hero">
        <div className={`overview-cover project-cover-${work.genre}`}>
          <small>{genreLabels[work.genre]}</small>
          <strong>{work.title.slice(0, 8)}</strong>
          <em>{scaleLabels[work.scaleTarget]}</em>
        </div>
        <div className="overview-copy">
          <span className="panel-kicker">
            <GitBranch size={14} aria-hidden="true" />
            当前创作线
          </span>
          <h2>主创作线</h2>
          <p>
            {work.templatePack
              ? `${work.templatePack.label} · ${String(work.templatePack.fields.world ?? "")}`
              : work.idea
                ? work.idea
                : "还没有故事灵感"}
          </p>
          <div className="overview-meta">
            <span>作品状态 {statusLabels[work.status]}</span>
            <span>创作线状态 {work.mainBranch.status === "active" ? "可写作" : "已归档"}</span>
            <span>当前版本 {work.mainBranch.headNodeId.slice(0, 8)}</span>
          </div>
        </div>
      </article>

      <section className="overview-grid">
        <article className="panel overview-readiness">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">准备度</span>
              <h2>准备度</h2>
            </div>
            <span className="badge">
              {work.readiness.completed} / {work.readiness.total}
            </span>
          </div>
          <div className="readiness-list">
            {work.readiness.items.map((item) => (
              <div className={`readiness-item ${item.ready ? "done" : ""}`} key={item.key}>
                <span className="readiness-check">
                  {item.ready ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Circle size={12} aria-hidden="true" />
                  )}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.ready ? "已就绪" : "待准备"}</small>
                </div>
              </div>
            ))}
          </div>
          {readiness ? (
            <div className="overview-remediation">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">下一步</span>
                  <h3>缺项与提醒</h3>
                </div>
                <span className="badge">
                  {readiness.blockers} 阻断 · {readiness.warnings} 提醒
                </span>
              </div>
              <ReadinessRemediation readiness={readiness} />
            </div>
          ) : null}
        </article>

        <aside className="panel compact-panel">
          <div className="panel-head">
            <h2>下一步</h2>
          </div>
          <ul className="overview-next-list">
            <li>
              <Link className="overview-next-link" href={`/workspace/${workId}/bible`}>
                <BookMarked size={16} aria-hidden="true" />
                <div>
                  <strong>完善故事圣经</strong>
                  <small>生成、编辑并锁定九卡故事方向</small>
                </div>
              </Link>
            </li>
            <li>
              <Link className="overview-next-link" href={`/workspace/${workId}/settings`}>
                <BookMarked size={16} aria-hidden="true" />
                <div>
                  <strong>整理最小设定</strong>
                  <small>世界规则、人物状态和金手指</small>
                </div>
              </Link>
            </li>
            <li>
              <Link className="overview-next-link" href={`/workspace/${workId}/outline`}>
                <PenLine size={16} aria-hidden="true" />
                <div>
                  <strong>准备第一章</strong>
                  <small>先写章纲，再进入写作台</small>
                </div>
              </Link>
            </li>
          </ul>
        </aside>
      </section>
    </>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "作品总览加载失败。";
}
