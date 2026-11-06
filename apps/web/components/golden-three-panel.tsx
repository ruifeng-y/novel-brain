"use client";

import { Check, LoaderCircle, Lock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  GOLDEN_THREE_REVIEW_DIMENSIONS,
  GOLDEN_THREE_REVIEW_DIMENSION_LABELS,
  apiErrorSchema,
  goldenThreeWorkspaceResponseSchema,
  type GoldenThreeCandidate,
  type GoldenThreeReviewDimension,
  type GoldenThreeWorkspace,
} from "@novel-brain/contracts";

import { getCsrfToken } from "../lib/csrf-client";

export function GoldenThreePanel({ workId, branchId }: { workId: string; branchId: string }) {
  const [workspace, setWorkspace] = useState<GoldenThreeWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [overrideRationale, setOverrideRationale] = useState("");
  const path = `/api/v1/works/${workId}/branches/${branchId}/golden-three`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "黄金三章加载失败。"));
      }
      setWorkspace(goldenThreeWorkspaceResponseSchema.parse(await response.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "黄金三章加载失败。");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectCandidate(candidate: GoldenThreeCandidate) {
    setBusy(`select:${candidate.id}`);
    setActionError("");
    try {
      const response = await fetch(`${path}/candidates/${candidate.id}/select`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({ version: candidate.version }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "候选方向选定失败。"));
      }
      setWorkspace(goldenThreeWorkspaceResponseSchema.parse(await response.json()).data);
      setOverrideRationale("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "候选方向选定失败。");
    } finally {
      setBusy("");
    }
  }

  async function lockCandidate(candidate: GoldenThreeCandidate, override = false) {
    setBusy("lock");
    setActionError("");
    try {
      const response = await fetch(`${path}/candidates/${candidate.id}/lock`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({
          version: candidate.version,
          ...(override
            ? {
                override: {
                  policy: "author_override_v1",
                  rationale: overrideRationale.trim(),
                },
              }
            : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "黄金三章锁定失败。"));
      }
      setWorkspace(goldenThreeWorkspaceResponseSchema.parse(await response.json()).data);
      setOverrideRationale("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "黄金三章锁定失败。");
    } finally {
      setBusy("");
    }
  }

  async function generateCandidates() {
    setBusy("generate");
    setActionError("");
    try {
      const response = await fetch(`${path}/candidates/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({ candidateCount: 3 }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "候选生成失败。"));
      }
      setWorkspace(goldenThreeWorkspaceResponseSchema.parse(await response.json()).data);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "候选生成失败。");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <section className="panel works-loading" aria-label="正在加载黄金三章">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        正在加载黄金三章
      </section>
    );
  }

  if (error || !workspace) {
    return (
      <section className="works-error" role="alert">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>{error || "黄金三章加载失败。"}</span>
        <button className="text-btn small" onClick={load} type="button">
          重试
        </button>
      </section>
    );
  }

  const selected =
    workspace.candidates.find((candidate) => candidate.id === workspace.selectedCandidateId) ??
    null;
  const failedDimensions = selected?.reviewSummary.failedDimensions ?? [];
  const reviewComplete = (selected?.reviewSummary.completed ?? 0) === 6;
  const canOverride = Boolean(selected && reviewComplete && failedDimensions.length > 0);
  const lockLabel = workspace.lock
    ? "黄金三章已锁定"
    : selected && failedDimensions.length > 0
      ? "六维评审未达标 · 暂不可锁定"
      : selected
        ? "锁定黄金三章"
        : "选定候选后可锁定";

  return (
    <section className="panel golden-three-panel" aria-labelledby="golden-three-title">
      <div className="panel-head golden-three-head">
        <div>
          <span className="panel-kicker">黄金三章</span>
          <h2 id="golden-three-title">黄金三章候选</h2>
          <p>对比候选方向、六维评分和原文证据；作者选定后才能锁定为后续写作基线。</p>
        </div>
        <button className="btn btn-ghost btn-small" onClick={load} type="button">
          刷新
        </button>
      </div>

      {actionError ? (
        <div className="story-bible-notice danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {workspace.candidates.length === 0 ? (
        <div className="golden-three-empty">
          <h3>还没有黄金三章候选</h3>
          <p>用第 1–3 章的当前版本生成 2–3 个方向，再并排比较章节内容、六维评分和证据。</p>
          <button
            className="btn btn-primary"
            disabled={busy === "generate"}
            onClick={() => void generateCandidates()}
            type="button"
          >
            {busy === "generate" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : null}
            生成 3 个候选
          </button>
        </div>
      ) : (
        <>
          <div className="golden-three-candidate-grid">
            {workspace.candidates.map((candidate) => {
              const isSelected = candidate.id === workspace.selectedCandidateId;
              return (
                <article
                  className={`golden-three-candidate${isSelected ? " selected" : ""}${
                    candidate.status === "locked" ? " locked" : ""
                  }`}
                  data-golden-candidate-id={candidate.id}
                  key={candidate.id}
                >
                  <div className="golden-three-candidate-head">
                    <div>
                      <span className={`badge ${statusClass(candidate.status)}`}>
                        {statusLabel(candidate.status)}
                      </span>
                      <h3>{candidate.label}</h3>
                    </div>
                    {candidate.status !== "selected" && candidate.status !== "locked" ? (
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={busy === `select:${candidate.id}`}
                        onClick={() => void selectCandidate(candidate)}
                        type="button"
                      >
                        {busy === `select:${candidate.id}` ? (
                          <LoaderCircle className="spin" size={14} aria-hidden="true" />
                        ) : null}
                        选定这个方向
                      </button>
                    ) : (
                      <span className="badge jade-badge">已选定</span>
                    )}
                  </div>
                  <div className="golden-three-chapters">
                    {candidate.pins.map((pin) => (
                      <section key={pin.chapterId}>
                        <span>
                          第 {pin.chapterNumber} 章 · {pin.chapterTitle}
                        </span>
                        <p>{pin.content}</p>
                      </section>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="golden-three-review">
            <div className="golden-three-section-head">
              <div>
                <span className="panel-kicker">六维评审</span>
                <h3>分数与证据并排比较</h3>
              </div>
              <span className="badge">达标线 4/5</span>
            </div>
            {GOLDEN_THREE_REVIEW_DIMENSIONS.map((dimension) => (
              <div
                className="golden-three-review-row"
                key={dimension}
                style={{
                  gridTemplateColumns: `minmax(140px, 0.7fr) repeat(${workspace.candidates.length}, minmax(0, 1fr))`,
                }}
              >
                <strong>{GOLDEN_THREE_REVIEW_DIMENSION_LABELS[dimension]}</strong>
                {workspace.candidates.map((candidate) => {
                  const review = candidate.reviews.find((entry) => entry.dimension === dimension);
                  return (
                    <div
                      className={`golden-three-review-cell${scoreClass(review?.score)}`}
                      key={candidate.id}
                    >
                      <b>{review ? `${review.score}/5` : "待评审"}</b>
                      {review ? (
                        <>
                          <p>{review.evidence.passage}</p>
                          <small>{review.evidence.locator}</small>
                        </>
                      ) : (
                        <small>还没有这一维度的证据</small>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="golden-three-lock-panel">
        <div>
          <span className="panel-kicker">作者确认</span>
          <h3>{workspace.lock ? "黄金三章已锁定" : "锁定前检查"}</h3>
          {workspace.lock ? (
            <p>后续章节会沿用已选定候选的方向；需要修改时请另开创作线。</p>
          ) : selected ? (
            <p>已选定「{selected.label}」。必需维度达到 4/5 后才能锁定。</p>
          ) : (
            <p>先选定一个候选方向，再完成六维评审。</p>
          )}
          {failedDimensions.length > 0 ? (
            <ul className="golden-three-failures">
              {failedDimensions.map((dimension) => (
                <li key={dimension}>{dimensionLabel(dimension)}未达标</li>
              ))}
            </ul>
          ) : null}
        </div>
        {workspace.lock ? (
          <div className="golden-three-locked-note" role="status">
            <Check size={16} aria-hidden="true" />
            <span>风格基线已保存</span>
          </div>
        ) : (
          <div className="golden-three-lock-actions">
            <button
              className="btn btn-primary"
              disabled={!workspace.gate.canLock || busy === "lock" || !selected}
              onClick={() => selected && void lockCandidate(selected)}
              type="button"
            >
              {busy === "lock" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Lock size={15} aria-hidden="true" />
              )}
              {lockLabel}
            </button>
            {canOverride ? (
              <details className="golden-three-override">
                <summary>作者例外锁定</summary>
                <label>
                  <span>例外理由</span>
                  <textarea
                    maxLength={2000}
                    onChange={(event) => setOverrideRationale(event.target.value)}
                    placeholder="说明为什么接受当前评审结果，以及后续如何补足。"
                    rows={3}
                    value={overrideRationale}
                  />
                </label>
                <button
                  className="btn btn-ghost"
                  disabled={overrideRationale.trim().length < 10 || busy === "lock"}
                  onClick={() => selected && void lockCandidate(selected, true)}
                  type="button"
                >
                  记录理由并锁定
                </button>
              </details>
            ) : null}
          </div>
        )}
      </div>

      {workspace.styleBaseline ? (
        <div className="golden-three-baseline">
          <div className="golden-three-section-head">
            <div>
              <span className="panel-kicker">风格基线</span>
              <h3>开篇样本已归档</h3>
            </div>
            <span className="badge jade-badge">3 段样本</span>
          </div>
          <div className="golden-three-baseline-samples">
            {workspace.styleBaseline.profile.excerpts.map((sample) => (
              <p key={sample.chapterVersionId}>{sample.excerpt}</p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function statusLabel(status: GoldenThreeCandidate["status"]): string {
  switch (status) {
    case "draft":
      return "待评审";
    case "reviewed":
      return "评审完成";
    case "selected":
      return "当前方向";
    case "locked":
      return "已锁定";
  }
}

function statusClass(status: GoldenThreeCandidate["status"]): string {
  switch (status) {
    case "draft":
      return "gold-badge";
    case "reviewed":
      return "";
    case "selected":
      return "jade-badge";
    case "locked":
      return "jade-badge";
  }
}

function scoreClass(score: number | undefined): string {
  if (score === undefined) {
    return "";
  }
  return score >= 4 ? " passed" : " failed";
}

function dimensionLabel(dimension: GoldenThreeReviewDimension): string {
  return GOLDEN_THREE_REVIEW_DIMENSION_LABELS[dimension];
}

async function readError(response: Response, fallback: string): Promise<string> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.message : fallback;
}
