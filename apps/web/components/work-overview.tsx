"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  BookMarked,
  BookOpenCheck,
  Check,
  CheckCircle2,
  Circle,
  Database,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Mic2,
  PenLine,
  ScanSearch,
  ShieldAlert,
  TriangleAlert,
  Type,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  chapterWorkspaceListResponseSchema,
  generationReadinessResponseSchema,
  settingEntityListResponseSchema,
  styleDriftReportResponseSchema,
  styleDriftWorkspaceResponseSchema,
  styleProfileResponseSchema,
  storyLedgerWorkspaceResponseSchema,
  workResponseSchema,
  type ChapterWorkspace,
  type GenerationReadiness,
  type SettingEntity,
  type StyleDriftWorkspace,
  type StoryLedgerWorkspace,
  type Work,
  type WorkOverview as WorkOverviewData,
} from "@novel-brain/contracts";

import { ReadinessRemediation } from "./readiness-remediation";
import { StyleDriftFindings } from "./style-drift-findings";
import { VolumeAuditPanel } from "./volume-audit-panel";
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

const chapterStatusLabels: Record<ChapterWorkspace["status"], string> = {
  planned: "待写",
  writing: "写作中",
  waiting_review: "待审核",
  changes_requested: "需修改",
  approved: "已批准",
  locked: "已锁定",
  published: "已发布",
  rejected: "已驳回",
};

export function WorkOverview({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverviewData | null>(null);
  const [readiness, setReadiness] = useState<GenerationReadiness | null>(null);
  const [styleWorkspace, setStyleWorkspace] = useState<StyleDriftWorkspace | null>(null);
  const [chapters, setChapters] = useState<ChapterWorkspace[]>([]);
  const [entities, setEntities] = useState<SettingEntity[]>([]);
  const [ledger, setLedger] = useState<StoryLedgerWorkspace | null>(null);
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
      const basePath = `/api/v1/works/${workId}/branches/${workData.mainBranch.id}`;
      const [readinessResponse, styleResponse, chaptersResponse, entitiesResponse, ledgerResponse] =
        await Promise.all([
          fetch(`${basePath}/readiness`, { cache: "no-store" }),
          fetch(`${basePath}/style`, { cache: "no-store" }),
          fetch(`${basePath}/chapters`, { cache: "no-store" }),
          fetch(`${basePath}/entities`, { cache: "no-store" }),
          fetch(`${basePath}/ledger`, { cache: "no-store" }),
        ]);
      if (!readinessResponse.ok) {
        throw new Error(await readError(readinessResponse));
      }
      setWork(workData);
      setReadiness(generationReadinessResponseSchema.parse(await readinessResponse.json()).data);
      setChapters(
        chaptersResponse.ok
          ? chapterWorkspaceListResponseSchema.parse(await chaptersResponse.json()).data
          : [],
      );
      setEntities(
        entitiesResponse.ok
          ? settingEntityListResponseSchema.parse(await entitiesResponse.json()).data
          : [],
      );
      setLedger(
        ledgerResponse.ok
          ? storyLedgerWorkspaceResponseSchema.parse(await ledgerResponse.json()).data
          : null,
      );
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

  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const confirmedSettings = entities.filter((entity) => entity.status === "locked").length;
  const pendingReminders = readiness ? readiness.blockers + readiness.warnings : 0;
  const readinessPercent =
    work.readiness.total > 0
      ? Math.round((work.readiness.completed / work.readiness.total) * 100)
      : 0;
  const latestChapterNumber = chapters.reduce(
    (highest, chapter) => Math.max(highest, chapter.number),
    0,
  );
  const nextChapter = chapters.find((chapter) => chapter.status === "planned") ?? null;
  const nextChapterNumber = nextChapter?.number ?? latestChapterNumber + 1;
  const nextChapterHref = nextChapter
    ? `/workspace/${workId}/write?chapterId=${nextChapter.id}`
    : `/workspace/${workId}/write`;
  const recentChapters = [...chapters]
    .sort((left, right) => right.number - left.number)
    .slice(0, 3);

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
            <Link className="btn btn-primary" href={nextChapterHref}>
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
          <div className="overview-progress">
            <div className="progress">
              <span style={{ width: `${readinessPercent}%` }} />
            </div>
            <span>
              准备度 {work.readiness.completed} / {work.readiness.total}
            </span>
          </div>
          <div className="overview-meta">
            <span>作品状态 {statusLabels[work.status]}</span>
            <span>创作线状态 {work.mainBranch.status === "active" ? "可写作" : "已归档"}</span>
            <span>当前版本 {work.mainBranch.headNodeId.slice(0, 8)}</span>
          </div>
        </div>
        <div className="overview-next">
          <span>下一章</span>
          <strong>第 {nextChapterNumber} 章</strong>
          <p>{nextChapter?.title || "待创建章节"}</p>
          <Link className="text-btn small" href={nextChapterHref}>
            进入写作台 <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
          <small>
            {pendingReminders > 0 ? `已准备 ${pendingReminders} 条提醒` : "暂无待处理提醒"}
          </small>
        </div>
      </article>

      <div className="stat-grid overview-stats">
        <article className="stat-card">
          <span className="stat-icon jade">
            <Type size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{totalWords.toLocaleString("zh-CN")}</strong>
            <span>累计字数</span>
          </div>
          <small>已写 {chapters.length} 章</small>
        </article>
        <article className="stat-card">
          <span className="stat-icon cinnabar">
            <BookOpenCheck size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{chapters.length}</strong>
            <span>已写章节</span>
          </div>
          <small>最近第 {latestChapterNumber || 0} 章</small>
        </article>
        <article className="stat-card">
          <span className="stat-icon gold">
            <Database size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{confirmedSettings}</strong>
            <span>已确认设定</span>
          </div>
          <small>共 {entities.length} 条设定</small>
        </article>
        <article className="stat-card">
          <span className="stat-icon blue">
            <ShieldAlert size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{pendingReminders}</strong>
            <span>待处理提醒</span>
          </div>
          <small>
            {readiness?.blockers ?? 0} 阻断 · {readiness?.warnings ?? 0} 提醒
          </small>
        </article>
        <article className="stat-card">
          <span className="stat-icon gold">
            <Gauge size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{readinessPercent}%</strong>
            <span>准备度</span>
          </div>
          <small>
            {work.readiness.completed} / {work.readiness.total} 项
          </small>
        </article>
        <article className="stat-card">
          <span className="stat-icon cinnabar">
            <GitCommitHorizontal size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{ledger?.summary.open ?? 0}</strong>
            <span>未回收伏笔</span>
          </div>
          <small>{ledger?.summary.overdue ?? 0} 条逾期</small>
        </article>
      </div>

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

      <section className="overview-grid overview-grid-wide">
        <section className="panel overview-chapters" aria-labelledby="overview-chapters-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">最近章节</span>
              <h3 id="overview-chapters-title">写到哪儿了</h3>
            </div>
            <Link className="text-btn small" href={`/workspace/${workId}/write`}>
              打开写作台 <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {recentChapters.length === 0 ? (
            <p className="style-drift-empty">还没有章节。可以先从大纲创建第一章。</p>
          ) : (
            <div className="overview-chapter-list">
              {recentChapters.map((chapter) => (
                <Link
                  className="overview-chapter"
                  href={`/workspace/${workId}/write?chapterId=${chapter.id}`}
                  key={chapter.id}
                >
                  <span className="chapter-no">{chapter.number}</span>
                  <span>
                    <strong>{chapter.title}</strong>
                    <small>{chapter.wordCount.toLocaleString("zh-CN")} 字</small>
                  </span>
                  <span className="badge">{chapterStatusLabels[chapter.status]}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel overview-links" aria-labelledby="overview-links-title">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">快捷入口</span>
              <h3 id="overview-links-title">下一步去哪里</h3>
            </div>
          </div>
          <div className="quick-link-grid">
            <Link href={`/workspace/${workId}/bible`}>
              <BookMarked size={17} aria-hidden="true" />
              <span>故事圣经</span>
              <small>九卡与完成度</small>
            </Link>
            <Link href={`/workspace/${workId}/settings`}>
              <GitBranch size={17} aria-hidden="true" />
              <span>设定中心</span>
              <small>人物、势力、地图</small>
            </Link>
            <Link href={`/workspace/${workId}/outline`}>
              <PenLine size={17} aria-hidden="true" />
              <span>大纲工作台</span>
              <small>卷纲、幕纲与章纲</small>
            </Link>
            <Link href={`/workspace/${workId}/foreshadows`}>
              <GitCommitHorizontal size={17} aria-hidden="true" />
              <span>伏笔账本</span>
              <small>埋设、推进与回收</small>
            </Link>
          </div>
        </section>
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

      <VolumeAuditPanel branchId={work.mainBranch.id} workId={work.id} />
    </>
  );
}

async function readError(response: Response): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : "作品总览加载失败。";
}
