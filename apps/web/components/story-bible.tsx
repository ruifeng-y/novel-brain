"use client";

import {
  ArrowLeft,
  Check,
  Circle,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorSchema,
  storyBibleChangeRequestResponseSchema,
  storyBibleResponseSchema,
  storyBibleVersionListResponseSchema,
  workResponseSchema,
  type StoryBible,
  type StoryBibleCard,
  type StoryBibleVersion,
  type StoryBibleWorldRule,
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

const versionActionLabels: Record<StoryBibleVersion["action"], string> = {
  proposed: "生成提案",
  edited: "编辑卡片",
  locked: "锁定",
  unlocked: "解锁",
};

type WorldRuleDraft = Omit<StoryBibleWorldRule, "id"> & {
  id?: string;
  clientKey: string;
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
  const [draftReason, setDraftReason] = useState("");
  const [draftWorldRules, setDraftWorldRules] = useState<WorldRuleDraft[]>([]);
  const [history, setHistory] = useState<StoryBibleVersion[]>([]);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [changeCardKey, setChangeCardKey] = useState("oneSentence");
  const [changeTitle, setChangeTitle] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeContent, setChangeContent] = useState("");
  const [changeRequestIdempotencyKey, setChangeRequestIdempotencyKey] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");

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
      const bibleData = storyBibleResponseSchema.parse(await bibleResponse.json()).data;
      const versionsResponse = await fetch(
        `/api/v1/works/${workId}/branches/${workData.mainBranch.id}/story-bible/versions`,
        { cache: "no-store" },
      );
      if (!versionsResponse.ok) {
        throw new Error(await readError(versionsResponse, "版本历史加载失败。"));
      }
      setStoryBible(bibleData);
      setHistory(storyBibleVersionListResponseSchema.parse(await versionsResponse.json()).data);
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
      const updated = await mutateStoryBible(
        `${storyBiblePath(work)}/generate`,
        "POST",
        {},
        "故事圣经生成失败。",
      );
      setStoryBible(updated);
      await refreshHistory(work);
      setActionMessage("九卡提案已生成，请逐卡检查后再锁定。");
    });
  }

  async function saveCard(card: StoryBibleCard) {
    if (!work || !storyBible) {
      return;
    }
    if (!draftReason.trim()) {
      setActionError("请填写本次修改原因。");
      return;
    }
    await runAction(`save-${card.key}`, async () => {
      const worldRules =
        card.key === "worldLaws"
          ? draftWorldRules.map((rule) => ({
              ...(rule.id ? { id: rule.id } : {}),
              name: rule.name,
              constraint: rule.constraint,
              scope: rule.scope,
              exceptions: rule.exceptions,
            }))
          : undefined;
      const content =
        card.key === "worldLaws"
          ? (worldRules?.map((rule) => `${rule.name}：${rule.constraint}`).join("\n") ?? "")
          : draftContent;
      const updated = await mutateStoryBible(
        storyBiblePath(work),
        "PATCH",
        {
          version: storyBible.version,
          reason: draftReason,
          cards: [{ key: card.key, content, ...(worldRules ? { worldRules } : {}) }],
        },
        "卡片保存失败。",
      );
      setStoryBible(updated);
      await refreshHistory(work);
      setEditingKey(null);
      setDraftContent("");
      setDraftReason("");
      setDraftWorldRules([]);
      setActionMessage(`“${card.title}”已保存。`);
    });
  }

  async function lock() {
    if (!work || !storyBible) {
      return;
    }
    await runAction("lock", async () => {
      const updated = await mutateStoryBible(
        `${storyBiblePath(work)}/lock`,
        "POST",
        { version: storyBible.version },
        "故事圣经锁定失败。",
      );
      setStoryBible(updated);
      await refreshHistory(work);
      setEditingKey(null);
      setActionMessage("故事圣经已锁定。");
    });
  }

  async function submitChangeRequest() {
    if (!work || !storyBible) {
      return;
    }
    const card = storyBible.cards.find((candidate) => candidate.key === changeCardKey);
    if (!card) {
      return;
    }
    await runAction("change-request", async () => {
      const csrfToken = await getCsrfToken();
      const response = await fetch(`${storyBiblePath(work)}/change-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": changeRequestIdempotencyKey,
        },
        body: JSON.stringify({
          version: storyBible.version,
          cardKey: card.key,
          title: changeTitle,
          reason: changeReason,
          after: {
            ...card,
            content: changeContent,
            complete: changeContent.trim().length > 0,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "修改请求创建失败。"));
      }
      storyBibleChangeRequestResponseSchema.parse(await response.json());
      setChangeRequestOpen(false);
      setChangeTitle("");
      setChangeReason("");
      setChangeContent("");
      setChangeRequestIdempotencyKey("");
      setActionMessage("修改请求已创建，等待影响分析。");
    });
  }

  async function unlockStoryBible() {
    if (!work || !storyBible) {
      return;
    }
    await runAction("unlock", async () => {
      const updated = await mutateStoryBible(
        `${storyBiblePath(work)}/unlock`,
        "POST",
        { version: storyBible.version, reason: unlockReason },
        "故事圣经解锁失败。",
      );
      setStoryBible(updated);
      await refreshHistory(work);
      setUnlockOpen(false);
      setUnlockReason("");
      setActionMessage("故事圣经已解锁，本次操作已记录。");
    });
  }

  async function refreshHistory(targetWork: WorkOverview) {
    const response = await fetch(
      `/api/v1/works/${targetWork.id}/branches/${targetWork.mainBranch.id}/story-bible/versions`,
      { cache: "no-store" },
    );
    if (response.ok) {
      setHistory(storyBibleVersionListResponseSchema.parse(await response.json()).data);
    }
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
    setDraftWorldRules((card.worldRules ?? []).map((rule) => ({ ...rule, clientKey: rule.id })));
    setDraftReason("");
    setActionError("");
    setActionMessage("");
  }

  function openChangeRequest() {
    const card = storyBible?.cards[0];
    setChangeCardKey(card?.key ?? "oneSentence");
    setChangeContent(card?.content ?? "");
    setChangeTitle("");
    setChangeReason("");
    setChangeRequestIdempotencyKey(crypto.randomUUID());
    setChangeRequestOpen(true);
  }

  function selectChangeCard(key: string) {
    const card = storyBible?.cards.find((candidate) => candidate.key === key);
    setChangeCardKey(key);
    setChangeContent(card?.content ?? "");
  }

  function updateWorldRule(index: number, patch: Partial<WorldRuleDraft>) {
    setDraftWorldRules((rules) =>
      rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)),
    );
  }

  function addWorldRule() {
    setDraftWorldRules((rules) => [
      ...rules,
      {
        clientKey: crypto.randomUUID(),
        name: "",
        constraint: "",
        scope: "",
        exceptions: [],
      },
    ]);
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
          <button className="btn btn-ghost" onClick={openChangeRequest} type="button">
            发起修改请求
          </button>
          <button className="btn btn-ghost" onClick={() => setUnlockOpen(true)} type="button">
            解锁并记录原因
          </button>
        </div>
      ) : null}
      {locked && changeRequestOpen ? (
        <section className="story-bible-change-request panel">
          <div>
            <span className="panel-kicker">锁定修改入口</span>
            <h2>发起修改请求</h2>
            <p>请求会记录旧值、新值和原因，等待后续影响分析。</p>
          </div>
          <label>
            修改卡片
            <select
              value={changeCardKey}
              onChange={(event) => selectChangeCard(event.target.value)}
            >
              {storyBible.cards
                .filter((card) => card.key !== "worldLaws")
                .map((card) => (
                  <option key={card.key} value={card.key}>
                    {card.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            修改请求标题
            <input
              aria-label="修改请求标题"
              onChange={(event) => setChangeTitle(event.target.value)}
              value={changeTitle}
            />
          </label>
          <label>
            修改请求原因
            <textarea
              aria-label="修改请求原因"
              onChange={(event) => setChangeReason(event.target.value)}
              rows={3}
              value={changeReason}
            />
          </label>
          <label>
            修改后的内容
            <textarea
              aria-label="修改后的内容"
              onChange={(event) => setChangeContent(event.target.value)}
              rows={5}
              value={changeContent}
            />
          </label>
          <div className="story-bible-editor-actions">
            <button
              className="btn btn-ghost"
              onClick={() => setChangeRequestOpen(false)}
              type="button"
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy === "change-request"}
              onClick={submitChangeRequest}
              type="button"
            >
              {busy === "change-request" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : null}
              提交修改请求
            </button>
          </div>
        </section>
      ) : null}
      {locked && unlockOpen ? (
        <section className="story-bible-change-request panel">
          <div>
            <span className="panel-kicker">锁定审计</span>
            <h2>解锁故事圣经</h2>
            <p>解锁会保留一条可追溯记录，并记录操作者、时间和原因。</p>
          </div>
          <label>
            解锁原因
            <textarea
              aria-label="解锁原因"
              onChange={(event) => setUnlockReason(event.target.value)}
              rows={3}
              value={unlockReason}
            />
          </label>
          <div className="story-bible-editor-actions">
            <button className="btn btn-ghost" onClick={() => setUnlockOpen(false)} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy === "unlock"}
              onClick={unlockStoryBible}
              type="button"
            >
              {busy === "unlock" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : null}
              确认解锁
            </button>
          </div>
        </section>
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
                    {card.key === "worldLaws" ? (
                      <div className="story-bible-world-rules">
                        {draftWorldRules.map((rule, ruleIndex) => (
                          <fieldset className="story-bible-world-rule" key={rule.clientKey}>
                            <legend>世界铁律 {ruleIndex + 1}</legend>
                            <label>
                              规则名称
                              <input
                                aria-label={`规则 ${ruleIndex + 1} 名称`}
                                onChange={(event) =>
                                  updateWorldRule(ruleIndex, { name: event.target.value })
                                }
                                value={rule.name}
                              />
                            </label>
                            <label>
                              适用约束
                              <textarea
                                aria-label={`规则 ${ruleIndex + 1} 约束`}
                                onChange={(event) =>
                                  updateWorldRule(ruleIndex, { constraint: event.target.value })
                                }
                                rows={3}
                                value={rule.constraint}
                              />
                            </label>
                            <label>
                              适用范围
                              <input
                                aria-label={`规则 ${ruleIndex + 1} 范围`}
                                onChange={(event) =>
                                  updateWorldRule(ruleIndex, { scope: event.target.value })
                                }
                                value={rule.scope}
                              />
                            </label>
                            <label>
                              例外（每行一条）
                              <textarea
                                aria-label={`规则 ${ruleIndex + 1} 例外`}
                                onChange={(event) =>
                                  updateWorldRule(ruleIndex, {
                                    exceptions: event.target.value
                                      .split("\n")
                                      .map((value) => value.trim())
                                      .filter(Boolean),
                                  })
                                }
                                rows={2}
                                value={rule.exceptions.join("\n")}
                              />
                            </label>
                            <button
                              className="btn btn-ghost"
                              onClick={() =>
                                setDraftWorldRules((rules) =>
                                  rules.filter((_, index) => index !== ruleIndex),
                                )
                              }
                              type="button"
                            >
                              <Trash2 size={13} aria-hidden="true" />
                              删除这条
                            </button>
                          </fieldset>
                        ))}
                        <button className="btn btn-ghost" onClick={addWorldRule} type="button">
                          <Plus size={14} aria-hidden="true" />
                          添加世界铁律
                        </button>
                      </div>
                    ) : (
                      <label htmlFor={`bible-editor-${card.key}`}>编辑{card.title}</label>
                    )}
                    {card.key !== "worldLaws" ? (
                      <textarea
                        id={`bible-editor-${card.key}`}
                        onChange={(event) => setDraftContent(event.target.value)}
                        rows={8}
                        value={draftContent}
                      />
                    ) : null}
                    <label>
                      修改原因
                      <textarea
                        aria-label="修改原因"
                        onChange={(event) => setDraftReason(event.target.value)}
                        rows={2}
                        value={draftReason}
                      />
                    </label>
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
                  <>
                    <p className={`story-bible-card-copy${card.complete ? "" : " empty"}`}>
                      {card.content || "尚未填写。编辑这张卡片，补充故事方向。"}
                    </p>
                    {card.key === "worldLaws" && card.worldRules.length > 0 ? (
                      <div className="story-bible-rule-summary">
                        {card.worldRules.map((rule) => (
                          <div key={rule.id}>
                            <strong>{rule.name}</strong>
                            <span>{rule.scope}</span>
                            {rule.exceptions.length > 0 ? (
                              <small>例外：{rule.exceptions.join("；")}</small>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
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
            {storyBible.readiness.issues.length > 0 ? (
              <ul className="story-bible-missing-list">
                {storyBible.readiness.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.key}-${issue.message}`}>
                    <TriangleAlert size={11} aria-hidden="true" />
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : missingCount > 0 ? (
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

          <section
            className="panel story-bible-version"
            aria-labelledby="story-bible-history-title"
          >
            <span className="panel-kicker">版本历史</span>
            <h2 id="story-bible-history-title">最近版本</h2>
            {history.length > 0 ? (
              <ol className="story-bible-history">
                {history.slice(0, 5).map((version) => (
                  <li key={version.id}>
                    <strong>
                      第 {version.version} 版 · {versionActionLabels[version.action]}
                    </strong>
                    <span>{version.reason}</span>
                    <small>{formatDateTime(version.createdAt)}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="story-bible-ready-copy">还没有历史版本。</p>
            )}
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
