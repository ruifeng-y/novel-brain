"use client";

import {
  ArrowLeft,
  Check,
  Circle,
  LoaderCircle,
  Lock,
  Pencil,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  storyBibleResponseSchema,
  workResponseSchema,
  type StoryBible,
  type StoryBibleCard,
  type Work,
  type WorkOverview,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

const statusLabels: Record<StoryBible["status"], string> = {
  draft: "草稿",
  proposed: "待确认",
  locked: "已锁定",
};

const genreLabels: Record<Work["genre"], string> = {
  xianxia: "仙侠",
  history: "历史",
  urban: "都市",
};

export function StoryBibleWorkspace({ workId }: { workId: string }) {
  const [work, setWork] = useState<WorkOverview | null>(null);
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workResponse = await fetch(`/api/v1/works/${workId}`, { cache: "no-store" });
      if (!workResponse.ok) {
        throw new Error(await readError(workResponse, "作品加载失败。"));
      }
      const workData = workResponseSchema.parse(await workResponse.json()).data;
      const bibleResponse = await fetch(
        `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/story-bible`,
        { cache: "no-store" },
      );
      if (!bibleResponse.ok) {
        throw new Error(await readError(bibleResponse, "故事圣经加载失败。"));
      }
      setWork(workData);
      setStoryBible(storyBibleResponseSchema.parse(await bibleResponse.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "故事圣经加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (!work) {
      return;
    }
    await runAction("generate", async () => {
      setStoryBible(
        await mutateStoryBible(
          `${storyBiblePath(work)}/generate`,
          "POST",
          {},
          "故事圣经生成失败。",
        ),
      );
      setActionMessage("九卡提案已生成，请逐卡检查后再锁定。");
    });
  }

  async function saveCard(card: StoryBibleCard) {
    if (!work || !storyBible) {
      return;
    }
    await runAction(`save-${card.key}`, async () => {
      setStoryBible(
        await mutateStoryBible(
          storyBiblePath(work),
          "PATCH",
          {
            version: storyBible.version,
            cards: [{ key: card.key, content: draftContent }],
          },
          "卡片保存失败。",
        ),
      );
      setEditingKey(null);
      setDraftContent("");
      setActionMessage(`“${card.title}”已保存。`);
    });
  }

  async function lock() {
    if (!work || !storyBible) {
      return;
    }
    await runAction("lock", async () => {
      setStoryBible(
        await mutateStoryBible(
          `${storyBiblePath(work)}/lock`,
          "POST",
          { version: storyBible.version },
          "故事圣经锁定失败。",
        ),
      );
      setEditingKey(null);
      setActionMessage("故事圣经已锁定。");
    });
  }

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key);
    setActionError("");
    setActionMessage("");
    try {
      await action();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  function beginEdit(card: StoryBibleCard) {
    setEditingKey(card.key);
    setDraftContent(card.content);
    setActionError("");
    setActionMessage("");
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载故事圣经">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载故事圣经
      </section>
    );
  }

  if (error || !work || !storyBible) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "故事圣经加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  const locked = storyBible.status === "locked";
  const empty = storyBible.readiness.completed === 0;
  const missingCount = storyBible.readiness.missingCards.length;
  const supported = work.genre === "xianxia";

  return (
    <>
      <section className="page-head story-bible-head">
        <div>
          <p className="eyebrow">故事圣经</p>
          <div className="title-with-badge">
            <h1>{work.title}</h1>
            <span className={`badge story-bible-status-${storyBible.status}`}>
              {statusLabels[storyBible.status]}
            </span>
            {locked ? (
              <span className="badge story-bible-locked-badge">
                <Lock size={12} aria-hidden="true" />
                {formatLockedAt(storyBible.lockedAt)}
              </span>
            ) : null}
          </div>
          <p className="page-sub">
            {genreLabels[work.genre]} · 九卡故事圣经 · 第 {storyBible.version} 版 ·{" "}
            {storyBible.readiness.completed} / 9 已完成
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" href={`/workspace/${workId}/overview`}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回总览
          </Link>
          <button
            className="btn btn-ghost"
            disabled={locked || !supported || busy === "generate"}
            onClick={generate}
            title={supported ? "生成九卡提案" : "M0 故事圣经仅支持仙侠题材"}
            type="button"
          >
            {busy === "generate" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Sparkles size={15} aria-hidden="true" />
            )}
            {storyBible.status === "proposed" ? "重新生成提案" : "生成九卡提案"}
          </button>
          <button
            className="btn btn-primary"
            disabled={!storyBible.readiness.canLock || busy === "lock"}
            onClick={lock}
            title={
              locked
                ? "故事圣经已锁定"
                : storyBible.readiness.canLock
                  ? "锁定故事圣经"
                  : `还差 ${missingCount} 张卡片`
            }
            type="button"
          >
            {busy === "lock" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Lock size={15} aria-hidden="true" />
            )}
            {locked ? "故事圣经已锁定" : "锁定故事圣经"}
          </button>
        </div>
      </section>

      {actionError ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}
      {actionMessage ? (
        <div className="story-bible-notice success" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{actionMessage}</span>
        </div>
      ) : null}
      {locked ? (
        <div className="story-bible-notice locked">
          <Lock size={16} aria-hidden="true" />
          <span>故事圣经已锁定，修改需要发起修改请求。</span>
        </div>
      ) : null}
      {!supported ? (
        <div className="story-bible-notice warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>M0 故事圣经仅支持仙侠题材，当前作品暂时只能查看空九卡。</span>
        </div>
      ) : null}
      {storyBible.status === "proposed" ? (
        <section
          className="story-bible-proposal panel"
          aria-labelledby="story-bible-proposal-title"
        >
          <div>
            <span className="panel-kicker">待确认提案</span>
            <h2 id="story-bible-proposal-title">AI 已生成九卡提案</h2>
            <p>请检查每张卡片，直接修改后再锁定。生成提案不会自动锁定故事圣经。</p>
          </div>
          <span className="badge story-bible-status-proposed">
            {formatGeneratedAt(storyBible.proposal?.generatedAt ?? null)}
          </span>
        </section>
      ) : null}
      {empty && !locked ? (
        <section className="story-bible-empty panel" aria-labelledby="story-bible-empty-title">
          <div>
            <span className="panel-kicker">空状态</span>
            <h2 id="story-bible-empty-title">故事圣经还没开始</h2>
            <p>
              {supported
                ? "先根据作品想法生成九卡提案，再补主角、金手指和世界铁律。"
                : "当前 M0 先支持仙侠故事圣经，历史与都市模板将在后续能力中开放。"}
            </p>
          </div>
          <button
            className="btn btn-primary"
            disabled={!supported || busy === "generate"}
            onClick={generate}
            type="button"
          >
            <Sparkles size={15} aria-hidden="true" />
            {supported ? "生成九卡提案" : "当前仅支持仙侠"}
          </button>
        </section>
      ) : null}

      <div className="story-bible-layout">
        <aside className="panel story-bible-nav" aria-label="故事圣经九卡">
          <div className="story-bible-nav-head">
            <div>
              <span className="panel-kicker">九卡完成度</span>
              <strong>{storyBible.readiness.completed} / 9</strong>
            </div>
            <span className={`badge story-bible-status-${storyBible.status}`}>
              {statusLabels[storyBible.status]}
            </span>
          </div>
          <div className="story-bible-progress" aria-hidden="true">
            <span style={{ width: `${(storyBible.readiness.completed / 9) * 100}%` }} />
          </div>
          <p className="story-bible-nav-note">
            {locked
              ? "九卡已锁定，修改需要发起修改请求。"
              : missingCount === 0
                ? "九卡完整，可以锁定。"
                : `还有 ${missingCount} 张卡片需要补充。`}
          </p>
          <nav className="story-bible-nav-list">
            {storyBible.cards.map((card, index) => (
              <a className="story-bible-nav-item" href={`#bible-${card.key}`} key={card.key}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{card.title}</strong>
                  <small>{card.complete ? "已填写" : "待补充"}</small>
                </div>
                {card.complete ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Circle size={12} aria-hidden="true" />
                )}
              </a>
            ))}
          </nav>
        </aside>

        <main className="story-bible-main">
          {storyBible.cards.map((card, index) => {
            const editing = editingKey === card.key;
            return (
              <article className="panel story-bible-card" id={`bible-${card.key}`} key={card.key}>
                <div className="story-bible-card-head">
                  <div>
                    <span className="story-bible-card-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2>{card.title}</h2>
                  </div>
                  <div className="story-bible-card-actions">
                    <span className={`badge ${card.complete ? "story-bible-complete" : ""}`}>
                      {card.complete ? "已填写" : "待补充"}
                    </span>
                    <button
                      aria-label={locked ? `已锁定 · ${card.title}需修改请求` : `编辑${card.title}`}
                      className="icon-btn small"
                      disabled={locked || editing}
                      onClick={() => beginEdit(card)}
                      title={locked ? `已锁定 · ${card.title}需修改请求` : `编辑${card.title}`}
                      type="button"
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {editing ? (
                  <div className="story-bible-editor">
                    <label htmlFor={`bible-editor-${card.key}`}>编辑{card.title}</label>
                    <textarea
                      id={`bible-editor-${card.key}`}
                      onChange={(event) => setDraftContent(event.target.value)}
                      rows={8}
                      value={draftContent}
                    />
                    <div className="story-bible-editor-actions">
                      <button
                        className="btn btn-ghost"
                        disabled={busy === `save-${card.key}`}
                        onClick={() => {
                          setEditingKey(null);
                          setDraftContent("");
                        }}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={busy === `save-${card.key}`}
                        onClick={() => saveCard(card)}
                        type="button"
                      >
                        {busy === `save-${card.key}` ? (
                          <LoaderCircle className="spin" size={15} aria-hidden="true" />
                        ) : (
                          <Check size={15} aria-hidden="true" />
                        )}
                        保存卡片
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={`story-bible-card-copy${card.complete ? "" : " empty"}`}>
                    {card.content || "尚未填写。编辑这张卡片，补充故事方向。"}
                  </p>
                )}
              </article>
            );
          })}
        </main>

        <aside className="story-bible-rail">
          <section
            className="panel story-bible-readiness"
            aria-labelledby="story-bible-readiness-title"
          >
            <div className="panel-head">
              <div>
                <span className="panel-kicker">准备度</span>
                <h2 id="story-bible-readiness-title">
                  {storyBible.readiness.status === "ready"
                    ? "九卡已完整"
                    : `还差 ${missingCount} 张`}
                </h2>
              </div>
              <span className="badge">{storyBible.readiness.completed} / 9</span>
            </div>
            <div className="story-bible-progress" aria-hidden="true">
              <span style={{ width: `${(storyBible.readiness.completed / 9) * 100}%` }} />
            </div>
            {missingCount > 0 ? (
              <ul className="story-bible-missing-list">
                {storyBible.readiness.missingCards.map((card) => (
                  <li key={card.key}>
                    <Circle size={11} aria-hidden="true" />
                    {card.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="story-bible-ready-copy">
                故事圣经已满足锁定条件。锁定后，后续写作会遵守这九张卡片。
              </p>
            )}
          </section>

          <section
            className="panel story-bible-version"
            aria-labelledby="story-bible-version-title"
          >
            <span className="panel-kicker">当前状态</span>
            <h2 id="story-bible-version-title">{statusLabels[storyBible.status]}</h2>
            <dl>
              <div>
                <dt>版本</dt>
                <dd>第 {storyBible.version} 版</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{formatDateTime(storyBible.updatedAt)}</dd>
              </div>
              {locked ? (
                <div>
                  <dt>锁定时间</dt>
                  <dd>{formatDateTime(storyBible.lockedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

function storyBiblePath(work: WorkOverview): string {
  return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
}

async function mutateStoryBible(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  fallback: string,
): Promise<StoryBible> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return storyBibleResponseSchema.parse(await response.json()).data;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}

function formatLockedAt(value: string | null): string {
  return value ? `${formatDateTime(value)} 锁定` : "已锁定";
}

function formatGeneratedAt(value: string | null): string {
  return value ? `${formatDateTime(value)} 生成` : "刚刚生成";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "尚未记录";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
