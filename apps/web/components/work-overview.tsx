"use client";

import {
  ArrowLeft,
  BookMarked,
  Check,
  CheckCircle2,
  Circle,
  GitBranch,
  LoaderCircle,
  Mic2,
  PenLine,
  ScanSearch,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  chapterWorkspaceListResponseSchema,
  generationReadinessResponseSchema,
  styleDriftReportResponseSchema,
  styleDriftWorkspaceResponseSchema,
  styleProfileResponseSchema,
  workResponseSchema,
  type GenerationReadiness,
  type StyleDriftWorkspace,
  type Work,
  type WorkOverview as WorkOverviewData,
} from "@novel-brain/contracts";

import { ReadinessRemediation } from "./readiness-remediation";
import { StyleDriftFindings } from "./style-drift-findings";
import { getCsrfToken } from "../lib/csrf-client";

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
  const [styleWorkspace, setStyleWorkspace] = useState<StyleDriftWorkspace | null>(null);
  const [styleError, setStyleError] = useState("");
  const [styleBusy, setStyleBusy] = useState(false);
  const [approvingProfileId, setApprovingProfileId] = useState<string | null>(null);
  const [approvalReason, setApprovalReason] = useState("");
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
      const [readinessResponse, styleResponse] = await Promise.all([
        fetch(`/api/v1/works/${workId}/branches/${workData.mainBranch.id}/readiness`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/works/${workId}/branches/${workData.mainBranch.id}/style`, {
          cache: "no-store",
        }),
      ]);
      if (!readinessResponse.ok) {
        throw new Error(await readError(readinessResponse));
      }
      setWork(workData);
      setReadiness(generationReadinessResponseSchema.parse(await readinessResponse.json()).data);
      if (styleResponse.ok) {
        setStyleWorkspace(styleDriftWorkspaceResponseSchema.parse(await styleResponse.json()).data);
        setStyleError("");
      } else {
        setStyleError(await readError(styleResponse));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作品总览加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkCrossVolumeStyle() {
    if (!work || styleBusy) {
      return;
    }
    setStyleBusy(true);
    setStyleError("");
    try {
      const chaptersResponse = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`,
        { cache: "no-store" },
      );
      if (!chaptersResponse.ok) {
        throw new Error(await readError(chaptersResponse));
      }
      const chapters = chapterWorkspaceListResponseSchema.parse(await chaptersResponse.json()).data;
      if (chapters.length === 0) {
        throw new Error("还没有可检查的章节。");
      }
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/style/drift`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({
            scope: "cross_volume",
            fromChapter: chapters[0]!.number,
            toChapter: chapters.at(-1)!.number,
            model: {
              provider: "novel-brain",
              model: "风格规则检查 v1",
              parameters: {},
            },
            prompt: { key: "style-drift-review", version: 1 },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const report = styleDriftReportResponseSchema.parse(await response.json()).data;
      setStyleWorkspace((current) =>
        current ? { ...current, latestCrossVolumeReport: report } : current,
      );
    } catch (caught) {
      setStyleError(caught instanceof Error ? caught.message : "跨卷声线检查失败。");
    } finally {
      setStyleBusy(false);
    }
  }

  async function approveStyleProfile(profileId: string, version: number) {
    if (!work || !approvalReason.trim()) {
      return;
    }
    setStyleBusy(true);
    setStyleError("");
    try {
      const response = await fetch(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/style/profiles/${profileId}/approve`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await getCsrfToken(),
          },
          body: JSON.stringify({ version, rationale: approvalReason.trim() }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const approved = styleProfileResponseSchema.parse(await response.json()).data;
      setStyleWorkspace((current) =>
        current
          ? {
              ...current,
              profiles: current.profiles.map((profile) =>
                profile.scope === approved.scope &&
                profile.scopeId === approved.scopeId &&
                profile.dimension === approved.dimension &&
                profile.id !== approved.id &&
                profile.approvalStatus === "approved"
                  ? { ...profile, approvalStatus: "superseded", approval: null }
                  : profile.id === approved.id
                    ? approved
                    : profile,
              ),
            }
          : current,
      );
      setApprovingProfileId(null);
      setApprovalReason("");
    } catch (caught) {
      setStyleError(caught instanceof Error ? caught.message : "基线批准失败。");
    } finally {
      setStyleBusy(false);
    }
  }

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

      <section className="panel overview-style" aria-labelledby="overview-style-title">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">声线与风格</span>
            <h2 id="overview-style-title">跨卷一致性</h2>
          </div>
          <button
            className="btn btn-ghost btn-small"
            disabled={
              styleBusy ||
              !styleWorkspace ||
              styleWorkspace.profiles.every((profile) => profile.approvalStatus !== "approved")
            }
            onClick={() => void checkCrossVolumeStyle()}
            type="button"
          >
            {styleBusy ? (
              <LoaderCircle className="spin" size={14} aria-hidden="true" />
            ) : (
              <ScanSearch size={14} aria-hidden="true" />
            )}
            检查跨卷趋势
          </button>
        </div>
        {styleError ? (
          <div className="story-bible-notice danger" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>{styleError}</span>
          </div>
        ) : null}
        {styleWorkspace ? (
          <>
            <div className="overview-style-baselines">
              {styleWorkspace.profiles.length === 0 ? (
                <div className="style-drift-empty">
                  <Mic2 size={18} aria-hidden="true" />
                  还没有声线或风格样本。可从已签收正文建立基线。
                </div>
              ) : (
                styleWorkspace.profiles.map((profile) => (
                  <article
                    className={`overview-style-baseline status-${profile.approvalStatus}`}
                    data-style-profile={profile.approvalStatus}
                    key={profile.id}
                  >
                    <div>
                      <strong>{profile.name}</strong>
                      <span>
                        {profile.scope === "character" ? "人物声线" : "作品文风"} · 版本{" "}
                        {profile.version}
                      </span>
                      <small>来源：{profile.source.label}</small>
                    </div>
                    {profile.approvalStatus === "approved" ? (
                      <span className="badge style-approved">
                        <CheckCircle2 size={12} aria-hidden="true" />
                        作者已批准
                      </span>
                    ) : profile.approvalStatus === "pending" ? (
                      approvingProfileId === profile.id ? (
                        <form
                          className="overview-style-approval"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void approveStyleProfile(profile.id, profile.version);
                          }}
                        >
                          <textarea
                            aria-label="批准理由"
                            onChange={(event) => setApprovalReason(event.target.value)}
                            placeholder="说明为什么这份样本代表稳定声线或文风"
                            value={approvalReason}
                          />
                          <div>
                            <button
                              className="btn btn-primary btn-small"
                              disabled={!approvalReason.trim() || styleBusy}
                              type="submit"
                            >
                              确认批准
                            </button>
                            <button
                              className="btn btn-ghost btn-small"
                              onClick={() => {
                                setApprovingProfileId(null);
                                setApprovalReason("");
                              }}
                              type="button"
                            >
                              取消
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={() => {
                            setApprovingProfileId(profile.id);
                            setApprovalReason("");
                          }}
                          type="button"
                        >
                          批准为基线
                        </button>
                      )
                    ) : (
                      <span className="badge">
                        {profile.approvalStatus === "superseded" ? "已替换" : "未采用"}
                      </span>
                    )}
                  </article>
                ))
              )}
            </div>
            {styleWorkspace.latestCrossVolumeReport ? (
              <StyleDriftFindings report={styleWorkspace.latestCrossVolumeReport} />
            ) : (
              <p className="style-drift-empty">
                批准至少一条基线后，可检查全书区间的人物声线与文风趋势。
              </p>
            )}
          </>
        ) : (
          <p className="style-drift-empty">正在读取声线与风格样本。</p>
        )}
      </section>
    </>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "作品总览加载失败。";
}
